import assert from 'node:assert/strict';
import test from 'node:test';
import { validateImage, parseAssessment } from '../server/pest.js';
import { verifyGroundedText } from '../server/grounding.js';

test('image validation rejects remote URLs, forged headers and oversized images', () => {
  assert.throws(() => validateImage('https://example.com/x.png'));
  assert.throws(() => validateImage('data:image/png;base64,aGVsbG8='));
  assert.throws(() => validateImage('data:image/png;base64,' + Buffer.alloc(4*1024*1024+1).toString('base64')));
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=';
  assert.equal(validateImage(image), image);
});
test('structured assessments require visible evidence and valid field types', () => {
  const valid = {status:'uncertain',observation:'图像不清晰',candidates:[],nextPhotos:['虫体近照'],actions:['观察叶背']};
  assert.deepEqual(parseAssessment(JSON.stringify(valid)),valid);
  assert.throws(() => parseAssessment(JSON.stringify({...valid,status:'suspected'})));
  assert.throws(() => parseAssessment(JSON.stringify({...valid,actions:'施药'})));
  assert.throws(() => parseAssessment('not json'));
});
test('grounding rejects invented numbers and guaranteed returns', () => {
  assert.ok(verifyGroundedText('预计收益201元', '测算201元'));
  assert.equal(verifyGroundedText('预计收益500元', '测算201元'),false);
  assert.equal(verifyGroundedText('未来 5 日内安排施肥', '未来 3 日有雨'),false);
  assert.equal(verifyGroundedText('保证收益', '测算201元'),false);
});
import { readSse } from '../server/sse.js';
test('SSE parser preserves split Chinese UTF-8 and CRLF frames', async () => {
  const bytes = new TextEncoder().encode('event: text\r\ndata: {"text":"害虫"}\r\n\r\ndata: [DONE]\n\n');
  const stream = new ReadableStream<Uint8Array>({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}});
  const frames: string[]=[];for await(const frame of readSse(stream))frames.push(frame);
  assert.deepEqual(frames,['{"text":"害虫"}','[DONE]']);
});
