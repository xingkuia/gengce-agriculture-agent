import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fromArrayBuffer} from 'geotiff';
const root=resolve('data/soil/hubei'),target=join(root,'soil-hubei');
const source=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
if(source.status!=='complete')throw new Error('Soil dataset is incomplete');
const mask=await readFile(join(root,'validity-mask.bin'));
const properties=['phh2o','soc','sand','clay'];
const output=Buffer.alloc(mask.length*8,255);
for(let band=0;band<4;band++){
  const layer=source.layers.find(l=>l.property===properties[band]),bytes=await readFile(join(root,layer.file));
  if(createHash('sha256').update(bytes).digest('hex')!==layer.sha256)throw new Error('Source checksum mismatch');
  const image=await(await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength))).getImage();
  const raw=await image.readRasters({samples:[0],interleave:true}),noData=image.getGDALNoData();
  if(raw.length!==mask.length)throw new Error('Grid size mismatch');
  for(let i=0;i<raw.length;i++)if(mask[i]&&raw[i]!==noData&&raw[i]>=0&&raw[i]<65535)output.writeUInt16LE(raw[i],i*8+band*2);
}
await mkdir(target,{recursive:true});
await writeFile(join(target,'soil.bin'),output);
const first=source.layers[0];
await writeFile(join(target,'manifest.json'),JSON.stringify({dataset:source.dataset,license:source.license,source:source.source,depth:source.depth,statistic:source.statistic,bounds:first.boundsWgs84,width:first.width,height:first.height,properties,divisor:10,noData:65535,layout:'row-major, 4 interleaved uint16 little-endian values per pixel',bytes:output.length,sha256:createHash('sha256').update(output).digest('hex')},null,2));
await writeFile(join(target,'README.md'),await readFile(join(root,'README.md')));
console.log(`Prepared offline soil data: ${target} (${output.length} bytes)`);
