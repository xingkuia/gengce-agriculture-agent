import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SKILLS } from '../server/skills.js';
import { GROUNDED_EXPRESSION_RULE, buildSkillPrompt, selectQuestionSkill } from '../server/skill-guidance.js';
import { generateAgentResponse, getAgentForSkill, streamAgentResponse } from '../server/mastra/agents.js';
import { identifyPest, parseAssessment } from '../server/pest.js';

test('question intent takes priority over incidental fertilizer/weather keywords',()=>{
  for(const [question,skill] of [
    ['这次施肥成本多少钱','economics'],['明天下雨还能追肥吗','agronomy'],
    ['土壤 pH 是什么意思','soil'],['未来降雨情况','weather'],
    ['叶片发黄是不是虫害','pest-vision'],['下季种什么更省工','crop-selection'],
    ['昨天浇过水还需要灌溉吗','agronomy'],['灌溉要花多少钱','economics']
  ])assert.equal(selectQuestionSkill(question),skill,question);
});

test('registered skills have actionable evidence and limits, and load only selected specialists',()=>{
  assert.equal(SKILLS.length,8);
  for(const skill of SKILLS){assert.ok(skill.guidance?.requiredEvidence.length);assert.ok(skill.guidance?.clarification);assert.ok(skill.guidance?.limits.length);}
  const prompt=buildSkillPrompt(['economics','economics']);
  assert.ok(prompt.includes(GROUNDED_EXPRESSION_RULE));
  assert.equal(prompt.split('专业：economics').length,2);
  assert.ok(!prompt.includes('专业：weather'));
  assert.match(prompt,/不能用全季总成本替代/);assert.match(prompt,/只作数据/);
});

test('summary and vision requests actually contain selected skill instructions',async()=>{
  const original={...process.env};const requests:Array<{messages:Array<{content:unknown}>}>=[];
  const assessment={status:'uncertain',observation:'图像不清晰',candidates:[],nextPhotos:['补拍叶背近照'],actions:['先观察受害部位']};
  const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);const isVision=Boolean(body.response_format)||JSON.stringify(body.messages).includes('pest-vision');const content=isVision?JSON.stringify(assessment):'缺少材料数量和单价，请先提供本次作业投入。';if(body.stream){res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8'});res.write(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`);res.write(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{total_tokens:12}})}\n\n`);res.end('data: [DONE]\n\n');return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content}}]}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  process.env.MODEL_PROVIDER='qwen';process.env.MODEL_API_KEY='test';process.env.MODEL_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
    const result=await generateAgentResponse({agent:getAgentForSkill('economics'),system:buildSkillPrompt(['economics']),user:JSON.stringify({question:'施肥多少钱'})});
    assert.equal(result.usedModel,true);assert.match(String(requests[0].messages[0].content),/专业：economics/);
    assert.equal(JSON.parse(String(requests[0].messages[1].content)).question,'施肥多少钱');
    await identifyPest('data:image/png;base64,iVBORw0KGgo=','测试地块');
    assert.match(String(requests[1].messages[0].content),/专业：pest-vision/);
    assert.match(String(requests[1].messages[0].content),/JSON/);
    assert.ok(Array.isArray(requests[1].messages[1].content));
    assert.ok(requests[1].messages[1].content.some((part: { type?: string }) => part.type === 'image' || part.type === 'image_url'));
  }finally{server.close();process.env=original;}
});

test('Mastra agents stream text deltas before completion', async () => {
  const original={...process.env};const deltas:string[]=[];
  const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());if(!body.stream){res.writeHead(400);res.end();return;}res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8'});res.write(`data: ${JSON.stringify({choices:[{delta:{content:'观察'}}]})}\n\n`);await new Promise(resolve=>setTimeout(resolve,25));res.write(`data: ${JSON.stringify({choices:[{delta:{content:'叶背'},finish_reason:'stop'}]})}\n\n`);res.end('data: [DONE]\n\n');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.MODEL_PROVIDER='qwen';process.env.MODEL_API_KEY='test';process.env.MODEL_BASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.MODEL_NAME='test-summary';
  try{
    const result=await streamAgentResponse({agent:getAgentForSkill('economics'),system:buildSkillPrompt(['economics']),user:'检查',onDelta:text=>deltas.push(text)});
    assert.deepEqual(deltas,['观察','叶背']);
    assert.equal(result.text,'观察叶背');
  }finally{server.close();process.env=original;}
});

test('vision rejects contradictory no-pest candidates and uncertainty without followup photos',()=>{
  const base={status:'uncertain',observation:'图像模糊',candidates:[],nextPhotos:[],actions:['现场检查']};
  assert.throws(()=>parseAssessment(JSON.stringify(base)));
  assert.throws(()=>parseAssessment(JSON.stringify({...base,status:'no_pest_visible',candidates:[{name:'蚜虫',evidence:'虫体',distinguishing:'待确认'}]})));
});
