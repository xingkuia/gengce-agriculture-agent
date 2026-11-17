import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fromArrayBuffer} from 'geotiff';
import {downloadSoilTiles} from './soil-tiles.mjs';

const directory=resolve('data/soil/hubei');
await mkdir(directory,{recursive:true});
const bbox=[108.3,29.0,116.2,33.3];
const layers=[['phh2o','pH（水浸提）','pH × 10','pH'],['soc','土壤有机碳','dg/kg','g/kg'],['sand','砂粒含量','g/kg','%'],['clay','黏粒含量','g/kg','%']];
const manifest={dataset:'ISRIC SoilGrids 2.0',license:'CC BY 4.0',source:'https://maps.isric.org/',documentation:'https://docs.isric.org/globaldata/soilgrids/wcs.html',unitsDocumentation:'https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_01.html',region:'湖北覆盖矩形，包含部分相邻省份；未按行政边界掩膜',requestedBoundsWgs84:bbox,depth:'0-5cm',statistic:'mean',outputCRS:'EPSG:4326',sourceResolution:'250 m native grid; WCS reprojected output, see actual pixel size',createdAt:new Date().toISOString(),status:'downloading',layers:[]};
const save=()=>writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await save();
let validityMask,referenceGrid;
for(const [property,name,storedUnit,unit] of layers){
  const url=new URL('https://maps.isric.org/mapserv');
  const coverageId=`${property}_0-5cm_mean`;
  for(const [k,v]of Object.entries({map:`/map/${property}.map`,SERVICE:'WCS',VERSION:'2.0.1',REQUEST:'GetCoverage',COVERAGEID:coverageId,FORMAT:'GEOTIFF_INT16',SUBSETTINGCRS:'http://www.opengis.net/def/crs/EPSG/0/4326',OUTPUTCRS:'http://www.opengis.net/def/crs/EPSG/0/4326'}))url.searchParams.set(k,v);
  url.searchParams.append('SUBSET',`X(${bbox[0]},${bbox[2]})`);url.searchParams.append('SUBSET',`Y(${bbox[1]},${bbox[3]})`);
  const filename=`${coverageId}_hubei_bbox.tif`,path=join(directory,filename);
  let bytes;
  try{bytes=await readFile(path);console.log(`${property}: verify existing file`);}catch{}
  if(!bytes){
    if(property!=='phh2o'){bytes=await downloadSoilTiles(property,referenceGrid,directory);}
    for(let attempt=0;!bytes && attempt<3;attempt++){
      try{
        console.log(`${property}: downloading (attempt ${attempt+1})`);
        const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        bytes=Buffer.from(await response.arrayBuffer());
        if(!['49492a00','4d4d002a','49492b00','4d4d002b'].includes(bytes.subarray(0,4).toString('hex')))throw new Error('Not a TIFF: '+bytes.toString('utf8',0,300));
        break;
      }catch(error){console.log(`${property}: ${error.message}`);if(attempt===2)throw error;await new Promise(r=>setTimeout(r,3000));}
    }
  }
  const tiff=await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const image=await tiff.getImage(),bounds=image.getBoundingBox(),noData=image.getGDALNoData(),geoKeys=image.getGeoKeys();
  if(geoKeys.GeographicTypeGeoKey!==4326||image.getWidth()<1000||image.getHeight()<1000)throw new Error(`${property}: unexpected CRS or dimensions`);
  if(bounds[0]>bbox[0]+.01||bounds[1]>bbox[1]+.01||bounds[2]<bbox[2]-.01||bounds[3]<bbox[3]-.01)throw new Error(`${property}: missing requested coverage`);
  const raster=await image.readRasters({samples:[0],interleave:true});
  if(property==='phh2o'){
    validityMask=Uint8Array.from(raster,v=>v!==noData&&Number.isFinite(v)&&v>0&&v<=140?1:0);
    referenceGrid={width:image.getWidth(),height:image.getHeight(),bounds};
  } else if(image.getWidth()!==referenceGrid.width||image.getHeight()!==referenceGrid.height||bounds.some((v,i)=>Math.abs(v-referenceGrid.bounds[i])>1e-8))throw new Error(`${property}: grid is not aligned with pH`);
  let count=0,min=Infinity,max=-Infinity;
  for(let index=0;index<raster.length;index++){const value=raster[index];if(!validityMask[index]||value===noData||!Number.isFinite(value))continue;count++;min=Math.min(min,value);max=Math.max(max,value);}
  if(count===0||min<0||(property==='phh2o'&&max>140)||(['sand','clay'].includes(property)&&max>1000))throw new Error(`${property}: invalid data values ${min}..${max}`);
  await writeFile(path+'.part',bytes);await rename(path+'.part',path);
  const entry={property,name,file:filename,coverageId,coverageRequest:url.toString(),acquisition:property==='phh2o'?'Single official WCS coverage response':'Official WCS 4x4 subrequests, SCALESIZE aligned to pH output grid, then lossless 16-bit integer mosaic; see scripts/soil-tiles.mjs',verifiedAt:new Date().toISOString(),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:image.getWidth(),height:image.getHeight(),boundsWgs84:bounds,pixelSizeDegrees:image.getResolution().slice(0,2),noData,storedUnit,conversion:'raw / 10',unit,validPixels:count,missingPixels:raster.length-count,min:min/10,max:max/10};
  // Point samples are checks of georeferencing and conversion, not field measurements.
  entry.samples=[['襄阳',112.211,32.087],['武汉',114.321,30.348],['宜昌',111.286,30.692],['参考栅格点A',112.26,31.65],['参考栅格点B',112.8,30.2],['参考栅格点C',111.8,30.8]].map(([place,lon,lat])=>{
    const x=Math.floor((lon-bounds[0])/(bounds[2]-bounds[0])*image.getWidth()),y=Math.floor((bounds[3]-lat)/(bounds[3]-bounds[1])*image.getHeight());
    const index=y*image.getWidth()+x,raw=raster[index];return {place,longitude:lon,latitude:lat,value:!validityMask[index]||raw===noData?null:raw/10,unit};
  });
  manifest.layers.push(entry);await save();
  console.log(`${property}: verified ${image.getWidth()}x${image.getHeight()}, ${(bytes.length/1048576).toFixed(2)} MiB, ${count} valid pixels`);
}
await writeFile(join(directory,'validity-mask.bin'),validityMask);
manifest.validityMask={file:'validity-mask.bin',layout:'row-major, 1 byte per pixel; 1=usable, 0=unavailable',rule:'phh2o raw > 0 and <= 140 and not tagged NoData; applied to all aligned layers. Zero clay/sand values inside valid cells remain valid.'};
manifest.status='complete';manifest.totalBytes=manifest.layers.reduce((n,l)=>n+l.bytes,0)+validityMask.length;await save();
console.log(`Complete: ${directory}, ${(manifest.totalBytes/1048576).toFixed(2)} MiB`);
