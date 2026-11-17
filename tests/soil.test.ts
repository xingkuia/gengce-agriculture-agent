import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getSoil,regionalPrior} from '../server/tools/soil.js';
import type {Plot} from '../server/types.js';
const plot:Plot={id:'test',farmId:'farm',name:'测试田',areaMu:5,soilTexture:'壤土',irrigation:'未填写',drainage:'良好',currentCrop:'冬小麦',rotation:'稻麦',note:''};
test('soil fallback distinguishes HTTP errors, timeouts and network failures',async()=>{
  const original=globalThis.fetch;
  const originalDir=process.env.SOIL_DATA_DIR;process.env.SOIL_DATA_DIR='data/soil/missing-test-data';
  try {
    for(const [mock,expected] of [
      [async()=>new Response('',{status:503}),'HTTP 503'],
      [async()=>{throw new DOMException('timeout','TimeoutError')},'毫秒未完成'],
      [async()=>{throw new TypeError('fetch failed')},'无法连接']
    ] as const){globalThis.fetch=mock as typeof fetch;const soil=await getSoil(plot,{latitude:32,longitude:112});assert.equal(soil.isFallback,true);assert.ok(soil.note.includes(expected));}
    assert.ok(!regionalPrior(plot).note.includes('超时'));
  } finally {globalThis.fetch=original;if(originalDir===undefined)delete process.env.SOIL_DATA_DIR;else process.env.SOIL_DATA_DIR=originalDir;}
});

test('offline grid converts units, rejects missing pixels and preserves manual soil without networking',async()=>{
  const original=globalThis.fetch;
  const originalDir=process.env.SOIL_DATA_DIR;
  const fixtureDir=await mkdtemp(join(tmpdir(),'gengce-soil-fixture-'));
  let networkCalls=0;
  globalThis.fetch=async()=>{networkCalls++;throw new Error('offline test must not access network')};
  try {
    // Synthetic 2x2 grid: the south-east pixel is valid; other pixels are missing.
    // No downloaded dataset or environment-specific path is required.
    const pixels=Buffer.alloc(2*2*8,255);
    [74,209,349,262].forEach((value,band)=>pixels.writeUInt16LE(value,3*8+band*2));
    await writeFile(join(fixtureDir,'manifest.json'),JSON.stringify({
      dataset:'Synthetic test fixture',depth:'0-5cm',divisor:10,
      properties:['phh2o','soc','sand','clay'],width:2,height:2,bounds:[110,30,114,34]
    }));
    await writeFile(join(fixtureDir,'soil.bin'),pixels);
    process.env.SOIL_DATA_DIR=fixtureDir;
    const soil=await getSoil(plot,{latitude:31.65,longitude:112.26});
    assert.equal(soil.source,'soilgrids-local');assert.equal(soil.ph,7.4);assert.equal(soil.organicCarbon,20.9);assert.equal(soil.sandPercent,34.9);assert.equal(soil.clayPercent,26.2);
    const outside=await getSoil(plot,{latitude:40,longitude:116});assert.equal(outside.isFallback,true);assert.match(outside.note,/覆盖范围/);
    const water=await getSoil(plot,{latitude:32.087,longitude:112.211});assert.equal(water.isFallback,true);assert.match(water.note,/无有效数据/);
    const manual={...regionalPrior(plot),source:'manual' as const,isFallback:false,ph:6.9};
    const saved=await getSoil(plot,{latitude:31.65,longitude:112.26},manual);assert.equal(saved.source,'manual');assert.equal(saved.ph,6.9);
    assert.equal(networkCalls,0,'local data, missing pixels and manual values must never access the network');
  } finally {
    globalThis.fetch=original;
    if(originalDir===undefined)delete process.env.SOIL_DATA_DIR;else process.env.SOIL_DATA_DIR=originalDir;
    await rm(fixtureDir,{recursive:true,force:true});
  }
});
