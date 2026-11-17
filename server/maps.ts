import type { IncomingMessage, ServerResponse } from 'node:http';

export async function handleMapApi(req: IncomingMessage,res:ServerResponse,url:URL):Promise<boolean> {
  if(url.pathname==='/api/maps/config') {
    res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
    res.end(JSON.stringify({key:process.env.AMAP_JS_KEY??'',configured:Boolean(process.env.AMAP_JS_KEY && process.env.AMAP_SECURITY_CODE)}));return true;
  }
  const prefix='/_AMapService/';
  if(!url.pathname.startsWith(prefix)) return false;
  if(req.method!=='GET' || !process.env.AMAP_SECURITY_CODE){res.writeHead(503);res.end('地图服务尚未配置');return true;}
  const path=url.pathname.slice(prefix.length);
  if(!/^(v3|v4|v5)\/[a-zA-Z0-9/_-]+$/.test(path)){res.writeHead(400);res.end();return true;}
  const target=new URL(path,path.startsWith('v4/map/styles')?'https://webapi.amap.com/':'https://restapi.amap.com/');
  target.search=url.search;target.searchParams.set('jscode',process.env.AMAP_SECURITY_CODE);
  try {
    const headers:Record<string,string>={};
    for(const key of ['referer','user-agent','origin','x-requested-with','x-info']) {const value=req.headers[key];if(typeof value==='string')headers[key]=value;}
    const upstream=await fetch(target,{headers,signal:AbortSignal.timeout(12000),redirect:'error'});
    const callback=target.searchParams.get('callback');
    res.writeHead(upstream.status,{'content-type':callback&&/^[\w.$]+$/.test(callback)?'application/javascript; charset=utf-8':upstream.headers.get('content-type')??'application/json','cache-control':'no-store'});
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {res.writeHead(502);res.end('地图服务连接失败，请稍后重试');}
  return true;
}
