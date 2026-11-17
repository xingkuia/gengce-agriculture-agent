import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fromArrayBuffer,writeArrayBuffer} from 'geotiff';

// Small requests avoid the long-running full-province WCS query. Cached pieces
// allow interrupted downloads to resume without repeating successful requests.
export async function downloadSoilTiles(property,grid,directory){
  const cache=join(directory,'.download-cache');await mkdir(cache,{recursive:true});
  const [west,south,east,north]=grid.bounds;
  const dx=(east-west)/grid.width,dy=(north-south)/grid.height;
  const output=new Uint16Array(grid.width*grid.height);output.fill(65535);
  const jobs=Array.from({length:16},(_,index)=>({row:Math.floor(index/4),col:index%4}));
  const processTile=async({row,col})=>{
    const x0=Math.floor(col*grid.width/4),x1=Math.floor((col+1)*grid.width/4),y0=Math.floor(row*grid.height/4),y1=Math.floor((row+1)*grid.height/4);
    const width=x1-x0,height=y1-y0;
    const file=join(cache,`${property}_${grid.width}x${grid.height}_${col}_${row}.tif`);
    let buffer;
    try{buffer=await readFile(file);}catch{}
    if(!buffer){
      const url=new URL('https://maps.isric.org/mapserv');
      for(const [k,v]of Object.entries({map:`/map/${property}.map`,SERVICE:'WCS',VERSION:'2.0.1',REQUEST:'GetCoverage',COVERAGEID:`${property}_0-5cm_mean`,FORMAT:'GEOTIFF_INT16',SUBSETTINGCRS:'http://www.opengis.net/def/crs/EPSG/0/4326',OUTPUTCRS:'http://www.opengis.net/def/crs/EPSG/0/4326',SCALESIZE:`x(${width}),y(${height})`}))url.searchParams.set(k,v);
      url.searchParams.append('SUBSET',`X(${west+x0*dx},${west+x1*dx})`);url.searchParams.append('SUBSET',`Y(${north-y1*dy},${north-y0*dy})`);
      for(let attempt=0;attempt<3;attempt++){
        try{
          console.log(`${property}: tile ${row*4+col+1}/16 (attempt ${attempt+1})`);
          const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
          if(!response.ok)throw new Error(`HTTP ${response.status}`);
          buffer=Buffer.from(await response.arrayBuffer());
          if(!['49492a00','4d4d002a'].includes(buffer.subarray(0,4).toString('hex')))throw new Error(buffer.toString('utf8',0,250));
          break;
        }catch(error){if(attempt===2)throw error;console.log(error.message);await new Promise(r=>setTimeout(r,2000));}
      }
    }
    const tiff=await fromArrayBuffer(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)),image=await tiff.getImage();
    if(image.getWidth()!==width||image.getHeight()!==height)throw new Error(`WCS scale mismatch: ${image.getWidth()}x${image.getHeight()} expected ${width}x${height}`);
    const bounds=image.getBoundingBox(),expected=[west+x0*dx,north-y1*dy,west+x1*dx,north-y0*dy];
    if(bounds.some((v,i)=>Math.abs(v-expected[i])>1e-7))throw new Error('Tile georeferencing mismatch');
    const raw=await image.readRasters({samples:[0],interleave:true}),nodata=image.getGDALNoData();
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const value=raw[y*width+x];output[(y0+y)*grid.width+x0+x]=value===nodata?65535:value;}
    await writeFile(file,buffer);
  };
  let next=0;
  const worker=async()=>{while(next<jobs.length)await processTile(jobs[next++]);};
  await Promise.all([worker(),worker()]);
  const bytes=Buffer.from(writeArrayBuffer(output,{width:grid.width,height:grid.height,BitsPerSample:[16],SampleFormat:[1],GeographicTypeGeoKey:4326,GTModelTypeGeoKey:2,GTRasterTypeGeoKey:1,ModelPixelScale:[dx,dy,0],ModelTiepoint:[0,0,0,west,north,0],GDAL_NODATA:'65535'}));
  const check=await (await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))).getImage();
  const decoded=await check.readRasters({samples:[0],interleave:true});
  for(let i=0;i<output.length;i++)if(decoded[i]!==output[i])throw new Error('GeoTIFF mosaic roundtrip mismatch');
  return bytes;
}
