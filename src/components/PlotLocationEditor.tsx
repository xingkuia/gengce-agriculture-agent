import { useEffect, useRef, useState } from 'react';
import { polygonArea, toGcj, validBoundary, type Coordinate, type PlotLocation } from '../../server/geo.js';
import type { Farm } from '../types';

// Vendor objects stay at the SDK boundary; persisted data uses PlotLocation.
type SDK = Record<string, any>;
let sdkPromise: Promise<SDK> | null=null;
function loadMap():Promise<SDK> {
  if(sdkPromise) return sdkPromise;
  sdkPromise=(async()=>{
    const config=await fetch('/api/maps/config').then(r=>r.json());
    if(!config.configured) throw new Error('尚未配置地图服务，可先手填经纬度和登记面积。');
    const w=window as unknown as SDK;
    w._AMapSecurityConfig={serviceHost:location.origin+'/_AMapService'};
    if(w.AMap) return w.AMap;
    return await new Promise<SDK>((resolve,reject)=>{
      const script=document.createElement('script');
      const timer=setTimeout(()=>{script.remove();reject(new Error('地图加载超时，请检查网络或 Key 配置后重试。'));},18000);
      script.src='https://webapi.amap.com/maps?v=2.0&plugin=AMap.Geocoder&key='+encodeURIComponent(config.key);
      script.onload=()=>{clearTimeout(timer);w.AMap?resolve(w.AMap):reject(new Error('地图加载失败，请检查 Key。'));};
      script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('地图连接失败，请检查网络后重试。'));};
      document.head.appendChild(script);
    });
  })().catch(e=>{sdkPromise=null;throw e;});
  return sdkPromise;
}
export function PlotLocationEditor({value,farm,areaMu,onChange,onArea,disabled,onDrawingChange,mode='plot',onRegion,onResolving,showManual=true}: {
  value:PlotLocation|null;farm?:Farm;areaMu:string;onChange:(l:PlotLocation|null)=>void;onArea:(area:string)=>void;disabled:boolean;onDrawingChange:(drawing:boolean)=>void;mode?:"plot"|"farm";onRegion?:(region:{province:string;city:string;district:string})=>void;onResolving?:(pending:boolean)=>void;showManual?:boolean;
}) {
  const container=useRef<HTMLDivElement>(null),map=useRef<SDK|null>(null),sdk=useRef<SDK|null>(null),overlays=useRef<SDK[]>([]);
  const current=useRef({value,onChange,disabled,mode,onRegion,onResolving});current.current={value,onChange,disabled,mode,onRegion,onResolving};
  const [attempt,setAttempt]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(''),[searching,setSearching]=useState(false),[satellite,setSatellite]=useState(false);
  const requestVersion=useRef(0);
  const [address,setAddress]=useState('');
  const resolveRegion=(point:Coordinate)=>{
    const version=++requestVersion.current;current.current.onResolving?.(true);setAddress('正在获取省市区…');
    const timer=setTimeout(()=>{if(version!==requestVersion.current||!map.current)return;++requestVersion.current;current.current.onResolving?.(false);setAddress('位置已选定，地址获取超时，请手动补填省市区。');},10000);
    new sdk.current!.Geocoder().getAddress(point,(status:string,result:SDK)=>{
      clearTimeout(timer);if(version!==requestVersion.current||!map.current)return;current.current.onResolving?.(false);
      if(status==='complete'&&result.regeocode?.addressComponent){const a=result.regeocode.addressComponent;const province=typeof a.province==='string'?a.province:'';const city=typeof a.city==='string'&&a.city?a.city:['北京市','上海市','天津市','重庆市'].includes(province)?province:typeof a.district==='string'?a.district:'';current.current.onRegion?.({province,city,district:typeof a.district==='string'?a.district:''});setAddress(result.regeocode.formattedAddress??'');}
      else setAddress('位置已选定，省市区未能自动获取，请在下方补填。');
    });
  };
  const pick=(point:Coordinate)=>{current.current.onChange({longitude:point[0],latitude:point[1],coordinateSystem:'GCJ-02',source:'map',boundary:(current.current.value?.boundary??[]).map(p=>current.current.value?.coordinateSystem==='WGS84'?toGcj(p):p),measuredAreaM2:current.current.value?.measuredAreaM2??null,areaSource:current.current.value?.areaSource??'manual'});if(current.current.mode==='farm')resolveRegion(point);};
  const [drawing,setDrawing]=useState(false),[vertices,setVertices]=useState<Coordinate[]>([]);
  useEffect(()=>{onDrawingChange(drawing);return()=>onDrawingChange(false);},[drawing,onDrawingChange]);
  const draw=useRef(false);draw.current=drawing;
  const [lat,setLat]=useState(value?String(value.latitude):''),[lon,setLon]=useState(value?String(value.longitude):'');
  const [system,setSystem]=useState<'WGS84'|'GCJ-02'>(value?.coordinateSystem??'WGS84');
  useEffect(()=>{setLat(value?String(value.latitude):'');setLon(value?String(value.longitude):'');setSystem(value?.coordinateSystem??'WGS84');},[value]);
  useEffect(()=>{
    let active=true;setError('');setReady(false);
    loadMap().then(A=>{
      if(!active || !container.current)return;
      sdk.current=A;
      const l=current.current.value;
      const center=l?(l.coordinateSystem==='WGS84'?toGcj([l.longitude,l.latitude]):[l.longitude,l.latitude]):toGcj([farm?.longitude??114.3,farm?.latitude??30.5]);
      const m=new A.Map(container.current,{center,zoom:l?17:14,viewMode:'2D'});map.current=m;
      m.on('click',(e:SDK)=>{if(current.current.disabled)return;const point:Coordinate=[e.lnglat.getLng(),e.lnglat.getLat()];if(draw.current)setVertices(v=>[...v,point]);else pick(point);});
      setReady(true);
    }).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;++requestVersion.current;current.current.onResolving?.(false);map.current?.destroy();map.current=null;overlays.current=[];};
  },[attempt,farm?.id]);
  useEffect(()=>{
    const m=map.current,A=sdk.current;if(!m||!A||!ready)return;
    m.remove(overlays.current);const items:SDK[]=[];
    if(value){const point:Coordinate=[value.longitude,value.latitude];items.push(new A.Marker({position:value.coordinateSystem==='WGS84'?toGcj(point):point}));}
    const path=drawing?vertices:(value?.boundary??[]).map(p=>value?.coordinateSystem==='WGS84'?toGcj(p):p);
    if(path.length)items.push(new A.Polygon({path,strokeColor:'#276548',fillColor:'#467b5d',fillOpacity:0.2,strokeWeight:2}));
    m.add(items);overlays.current=items;
  },[value,vertices,drawing,ready]);
  const finish=()=>{
    if(!validBoundary(vertices)){setError('边界至少需要 3 个顶点，不能交叉或重复，请撤销后调整。');return;}
    const longitude=vertices.reduce((s,p)=>s+p[0],0)/vertices.length,latitude=vertices.reduce((s,p)=>s+p[1],0)/vertices.length;
    onChange({longitude,latitude,coordinateSystem:'GCJ-02',source:'boundary',boundary:vertices,measuredAreaM2:polygonArea(vertices),areaSource:'manual'});setDrawing(false);setVertices([]);setError('');
  };
  const addressSearch=()=>{
    if(!search.trim()||!sdk.current||!map.current)return;
    setSearching(true);setError('');
    new sdk.current.Geocoder().getLocation(search,(status:string,result:SDK)=>{setSearching(false);if(status==='complete'&&result.geocodes?.length){const p=result.geocodes[0].location;map.current?.setZoomAndCenter(17,p);if(current.current.mode==='farm')pick([p.getLng(),p.getLat()]);}else setError(`未找到该地址，请补充省市、村庄名称，或直接在地图上定位。${typeof result==='string'?result:String(result?.info??'')}`);});
  };
  const applyManual=()=>{
    if(!lat.trim()||!lon.trim()||!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon))||Math.abs(Number(lat))>90||Math.abs(Number(lon))>180){setError('请填写有效经纬度，纬度 −90～90，经度 −180～180。');return;}
    const l:PlotLocation={latitude:Number(lat),longitude:Number(lon),coordinateSystem:system,source:'manual',boundary:[],measuredAreaM2:null,areaSource:'manual'};
    onChange(l);map.current?.setZoomAndCenter(17,system==='WGS84'?toGcj([l.longitude,l.latitude]):[l.longitude,l.latitude]);setError('');
  };
  const measured=value?.measuredAreaM2;
  return <section className="plot-location-editor" aria-label={mode==='farm'?'基地地图定位':'地块位置与边界'}>
    <h4>{mode==='farm'?'基地位置':'地块位置与边界'}</h4>{mode==='farm'?<p>搜索基地地址，或在地图上点击选定位置，省市区将自动填入。</p>:<p>{value?'已设置独立位置':'尚未设置地块位置，环境查询暂用基地坐标。'} 登记面积用于投入和收益测算。</p>}
    <div className="plot-map-search"><input aria-label="搜索村庄或地址" placeholder="输入省市、村庄或详细地址" value={search} onChange={e=>setSearch(e.target.value)} disabled={!ready||disabled} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addressSearch();}}}/><button type="button" onClick={addressSearch} disabled={!ready||disabled||searching||!search.trim()}>{searching?'搜索中…':'搜索地址'}</button></div>
    <div ref={container} className="plot-map" aria-label={mode==='farm'?'高德地图，点击设置基地位置':'高德地图，点击设置地块位置'} />
    {!ready&&!error&&<p role="status">正在加载地图…</p>}
    {error&&<p className="inline-error" role="alert">{error} {!ready&&<button type="button" onClick={()=>setAttempt(a=>a+1)}>重试地图</button>}</p>}
    <div className="plot-map-tools"><button type="button" disabled={!ready||disabled} onClick={()=>{const next=!satellite;setSatellite(next);const A=sdk.current!;map.current?.setLayers(next?[new A.TileLayer.Satellite(),new A.TileLayer.RoadNet()]:[new A.TileLayer()]);}}>{satellite?'切换普通地图':'切换卫星图'}</button>
    {mode==='plot' && (!drawing?<button type="button" disabled={!ready||disabled} onClick={()=>{setVertices([]);setDrawing(true);setError('');}}>绘制边界</button>:<><button type="button" disabled={disabled||vertices.length<3} onClick={finish}>完成边界（{vertices.length} 点）</button><button type="button" disabled={disabled||!vertices.length} onClick={()=>setVertices(v=>v.slice(0,-1))}>撤销一点</button><button type="button" onClick={()=>{setDrawing(false);setVertices([]);}}>取消绘制</button></>)}
    {!!value?.boundary.length&&<button type="button" disabled={disabled} onClick={()=>onChange({...value,boundary:[],measuredAreaM2:null,areaSource:'manual'})}>清除边界</button>}</div>
    {drawing&&<p role="status">沿田边依次点击，最后点击“完成边界”。绘制期间请先完成或取消，再保存档案。</p>}
    {showManual&&<details><summary>手动输入经纬度</summary><p>GPS 坐标选 WGS84；从高德拾取的坐标选 GCJ-02。应用新坐标会清除原边界。</p><div className="plot-coordinate-fields"><label>经度<input name="plotLongitude" type="number" step="any" value={lon} onChange={e=>setLon(e.target.value)} disabled={disabled}/></label><label>纬度<input name="plotLatitude" type="number" step="any" value={lat} onChange={e=>setLat(e.target.value)} disabled={disabled}/></label><label>坐标类型<select value={system} onChange={e=>setSystem(e.target.value as typeof system)} disabled={disabled}><option>WGS84</option><option>GCJ-02</option></select></label><button type="button" disabled={disabled||drawing} onClick={applyManual}>应用坐标</button></div></details>}
    {mode==='farm'&&address&&<p role="status">{address}</p>}
    {value&&<p>定位：{value.longitude.toFixed(6)}, {value.latitude.toFixed(6)} · {value.coordinateSystem} · {mode==='farm'?'基地定位':value.source==='manual'?'手动录入':value.source==='map'?'地图选点':'边界定位'} <button type="button" disabled={disabled} onClick={()=>{++requestVersion.current;current.current.onResolving?.(false);setAddress('');onChange(null);}}>清除位置</button></p>}
    {measured!=null&&<div className="plot-area-comparison"><span>登记面积 <strong>{areaMu||'未填写'} 亩</strong></span><span>地图测算 <strong>{(measured/ (2000/3)).toFixed(2)} 亩</strong>（{measured.toFixed(0)} 平方米）</span><button type="button" disabled={disabled||drawing} onClick={()=>{onArea((measured/(2000/3)).toFixed(2));onChange({...value!,areaSource:'boundary'});}}>采用测算面积</button><p>边界测算供参考，请核对田埂、沟渠和实际种植范围。{Number(areaMu)>0&&Math.abs(Number(areaMu)-measured/(2000/3))/Number(areaMu)>.1?'两种面积相差超过 10%，请确认。':''}</p></div>}
  </section>;
}
