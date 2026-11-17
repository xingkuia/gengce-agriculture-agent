import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('farm and plot lifecycle preserves history and supports an empty workspace', async () => {
  const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));
  const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
  const folder=await mkdtemp(join(tmpdir(),'gengce-management-'));
  const child=spawn(process.execPath,['--import','tsx',resolve('server/index.ts')],{env:{...process.env,PORT:String(port),DATABASE_PATH:join(folder,'test.db'),APP_ROOT:process.cwd(),MODEL_PROVIDER:'mock',MODEL_API_KEY:''},stdio:'ignore',windowsHide:true});
  const base=`http://127.0.0.1:${port}`;
  const req=async(path:string,method='GET',body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  try {
    let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);
    const firstPlot=(await req('/api/bootstrap')).data.activePlotId;
    const seededWorkspace=(await req('/api/workspace')).data;
    const seededPlots=seededWorkspace.farms.flatMap((f:{plots:Array<{id:string}>})=>f.plots);
    assert.equal(seededPlots.length,3);
    for(const seededPlot of seededPlots){
      const seededPayload=await req('/api/bootstrap?plotId='+seededPlot.id);
      assert.equal(seededPayload.status,200,seededPlot.id);
      assert.ok(seededPayload.data.plotContext,seededPlot.id);
    }
    for(const [message,agent,expected] of [
      ['这次施肥成本多少钱','economics','不能用全季成本代替'],
      ['叶片发黄是不是虫害','pest-vision','尚未进行图片识别'],
      ['昨天浇过水还要灌溉吗','agronomy','最近一次同类作业']
    ]){
      const started=await req('/api/runs','POST',{plotId:firstPlot,mode:'question',message});assert.equal(started.status,202);
      let run=(await req('/api/runs/'+started.data.runId)).data;
      for(let i=0;i<100&&run.status==='running';i++){await new Promise(r=>setTimeout(r,50));run=(await req('/api/runs/'+started.data.runId)).data;}
      assert.equal(run.status,'completed',run.summary);assert.ok(run.summary.includes(expected));assert.ok(run.events.some((e:{agent:string;kind:string})=>e.agent===agent&&e.kind==='answer'));
    }
    const farm={name:'集成测试基地',province:'湖北省',city:'武汉市',district:'江夏区',latitude:30.4,longitude:114.3};
    assert.equal((await req('/api/farms','POST',{...farm,latitude:100})).status,400);
    const created=await req('/api/farms','POST',farm);assert.equal(created.status,201);const farmId=created.data.id;
    assert.equal((await req('/api/farms/'+farmId+'/pin','PATCH',{isPinned:'yes'})).status,400);
    assert.equal((await req('/api/farms/'+farmId+'/pin','PATCH',{isPinned:true})).status,200);
    assert.equal((await req('/api/workspace')).data.farms.find((f:{id:string})=>f.id===farmId).isPinned,true);
    assert.equal((await req('/api/farms','POST',farm)).status,409);
    const plot={farmId,name:'测试田',areaMu:12.5,soilTexture:'壤土',irrigation:'沟灌',drainage:'良好',currentCrop:'冬小麦',rotation:'稻麦轮作',note:'测试档案'};
    assert.equal((await req('/api/plots','POST',{...plot,areaMu:0})).status,400);
    const added=await req('/api/plots','POST',plot);assert.equal(added.status,201);const plotId=added.data.id;
    const blankPlot=await req('/api/plots','POST',{farmId,name:'待补全田',areaMu:2,soilTexture:'',irrigation:'',drainage:'',currentCrop:'',rotation:'',note:''});
    assert.equal(blankPlot.status,201);
    const storedBlank=(await req('/api/workspace')).data.farms.flatMap((f:{plots:Array<Record<string,unknown>>})=>f.plots).find((p:{id:string})=>p.id===blankPlot.data.id);
    assert.deepEqual([storedBlank.soilTexture,storedBlank.irrigation,storedBlank.drainage,storedBlank.currentCrop,storedBlank.rotation],['','','','','']);
    const hint=await req('/api/plots/location-hints','POST',{longitude:114.31,latitude:30.41,coordinateSystem:'WGS84'});
    assert.equal(hint.status,200);assert.ok(['soilgrids','soilgrids-local','regional-prior'].includes(hint.data.source));
    assert.equal((await req('/api/bootstrap?plotId='+plotId)).data.activePlotId,plotId);
    assert.equal((await req('/api/bootstrap?plotId='+plotId)).data.farms.find((f:{id:string})=>f.id===farmId).isPinned,true);
    assert.equal((await req('/api/farms/'+farmId+'/pin','PATCH',{isPinned:false})).status,200);
    assert.equal((await req('/api/workspace')).data.farms.find((f:{id:string})=>f.id===farmId).isPinned,false);
    assert.equal((await req('/api/plots/'+plotId,'PATCH',{...plot,name:'改名田',areaMu:15})).status,200);
    assert.equal((await req('/api/plots','POST',{...plot,name:'改名田'})).status,409);
    const location={longitude:114.31,latitude:30.41,coordinateSystem:'GCJ-02',source:'boundary',boundary:[[114.31,30.41],[114.311,30.41],[114.311,30.411],[114.31,30.411]],measuredAreaM2:999,areaSource:'manual'};
    assert.equal((await req('/api/plots/'+plotId,'PATCH',{...plot,location})).status,200);
    const stored=(await req('/api/bootstrap?plotId='+plotId)).data.farms.flatMap((f:{plots:unknown[]})=>f.plots).find((p:{id:string})=>p.id===plotId);
    assert.equal(stored.areaMu,12.5);assert.equal(stored.location.boundary.length,4);assert.ok(stored.location.measuredAreaM2>10000);assert.notEqual(stored.location.measuredAreaM2,999);
    assert.equal((await req('/api/plots/'+plotId,'PATCH',{...plot,location:{...location,latitude:100}})).status,400);
    assert.equal((await req('/api/plots/'+plotId,'PATCH',{...plot,location:{...location,boundary:[location.boundary[0],location.boundary[2],location.boundary[1],location.boundary[3]]}})).status,400);
    const chatId='management-test';
    const turns=[{id:'user',role:'user',kind:'message',content:'此记录应该保留',createdAt:new Date().toISOString()}];
    assert.equal((await req('/api/chats/'+chatId,'PUT',{plotId,turns})).status,200);
    const manual={texture:'黏土',clayPercent:35,sandPercent:20,ph:6.5,organicCarbon:2,drainage:'良好',note:'实测'};
    assert.equal((await req('/api/plots/'+plotId+'/soil','POST',manual)).status,200);
    assert.equal((await req('/api/farms/'+farmId,'PATCH',{...farm,name:'修改后的基地',latitude:31})).status,200);
    const context=(await req('/api/bootstrap?plotId='+plotId)).data.plotContext;
    assert.equal(context.soil.source,'manual');assert.equal(context.soil.ph,6.5);assert.ok(Date.parse(context.updatedAt)<Date.now()-3600000);
    assert.equal((await req('/api/plots/'+plotId,'DELETE')).status,200);
    assert.equal((await req('/api/chats/'+chatId)).data.turns[0].content,turns[0].content);
    assert.notEqual((await req('/api/bootstrap?plotId='+plotId)).data.activePlotId,plotId);
    assert.equal((await req('/api/plots/'+plotId+'/restore','POST')).status,200);
    assert.equal((await req('/api/farms/'+farmId,'DELETE')).status,200);
    assert.ok(!(await req('/api/workspace')).data.farms.some((f:{id:string})=>f.id===farmId));
    assert.equal((await req('/api/farms/'+farmId+'/restore','POST')).status,200);
    assert.ok((await req('/api/workspace')).data.farms.find((f:{id:string})=>f.id===farmId).plots.some((p:{id:string})=>p.id===plotId));
    const all=(await req('/api/workspace')).data.farms;
    for(const f of all)assert.equal((await req('/api/farms/'+f.id,'DELETE')).status,200);
    assert.equal((await req('/api/workspace')).data.farms.length,0);
    assert.equal((await req('/api/farms/'+farmId+'/restore','POST')).status,200);
    assert.equal((await req('/api/bootstrap')).data.activePlotId,plotId);
  } finally {child.kill();}
});
