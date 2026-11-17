import {readFile,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {plotPosition} from '../geo.js';
import type {Plot} from '../types.js';
export async function readLocalSoil(plot:Plot,farm:{latitude:number;longitude:number}){
  const root=process.env.SOIL_DATA_DIR??resolve(process.env.APP_ROOT??'.','data/soil/hubei/soil-hubei');
  try {
    const m=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
    if(m.divisor!==10||m.properties?.join(',')!=='phh2o,soc,sand,clay'||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<=0||m.height<=0||!Array.isArray(m.bounds)||m.bounds.length!==4||!m.bounds.every(Number.isFinite))return {reason:'本地土壤数据清单无效'};
    const [west,south,east,north]=m.bounds,point=plotPosition(plot,farm);
    if(!Number.isFinite(point.longitude)||!Number.isFinite(point.latitude)||point.longitude<west||point.longitude>=east||point.latitude<=south||point.latitude>north)return {reason:'地块位置超出本地湖北土壤数据覆盖范围'};
    const x=Math.floor((point.longitude-west)/(east-west)*m.width),y=Math.floor((north-point.latitude)/(north-south)*m.height);
    const file=await open(join(root,'soil.bin'),'r');
    try {
      if((await file.stat()).size!==m.width*m.height*8)return {reason:'本地土壤数据文件不完整'};
      const buffer=Buffer.alloc(8);const {bytesRead}=await file.read(buffer,0,8,(y*m.width+x)*8);
      if(bytesRead!==8)return {reason:'本地土壤像元读取不完整'};
      const values=Array.from({length:4},(_,i)=>buffer.readUInt16LE(i*2));
      if(values.some(v=>v===65535)||values[0]<=0||values[0]>140||values[2]>1000||values[3]>1000)return {reason:'地块所在本地土壤像元无有效数据（可能为水域或其他缺测区域）'};
      return {values:values.map(v=>v/10),dataset:String(m.dataset),depth:String(m.depth)};
    } finally {await file.close();}
  }catch(error){
    if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return {missing:true,reason:'本地土壤数据文件未安装'};
    return {reason:'本地土壤数据读取失败，请检查文件及清单'};
  }
}
