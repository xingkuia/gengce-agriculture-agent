import test from 'node:test';
import assert from 'node:assert/strict';
import {polygonArea,validBoundary,toGcj,toWgs,plotPosition} from '../server/geo.js';
test('field area validates simple boundaries and rejects crossings or duplicate vertices',()=>{
  const square:[number,number][]=[[114,30],[114.001,30],[114.001,30.001],[114,30.001]];
  assert.ok(validBoundary(square));assert.ok(polygonArea(square)>10600&&polygonArea(square)<10800);
  assert.ok(!validBoundary([square[0],square[2],square[1],square[3]]));
  assert.ok(!validBoundary([...square,square[0]]));
  assert.ok(!validBoundary([[114,30],[114.001,30],[114.002,30]]));
});
test('map coordinates round trip and environment queries prefer independent plot coordinates',()=>{
  const point:[number,number]=[114.3,30.4],gcj=toGcj(point),back=toWgs(gcj);
  assert.ok(Math.abs(gcj[0]-point[0])>.001);
  assert.ok(Math.abs(back[0]-point[0])<1e-7&&Math.abs(back[1]-point[1])<1e-7);
  const farm={longitude:112,latitude:32};assert.deepEqual(plotPosition({},farm),farm);
  const pos=plotPosition({location:{longitude:gcj[0],latitude:gcj[1],coordinateSystem:'GCJ-02',source:'map',boundary:[],measuredAreaM2:null,areaSource:'manual'}},farm);
  assert.ok(Math.abs(pos.longitude-point[0])<1e-7);
});
