import { deflateSync } from "node:zlib";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const edgePath =
  process.env.EDGE_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const localPort = Number(process.env.APP_PORT ?? 8798);
const externalAppUrl = process.env.APP_URL;
const appUrl = externalAppUrl ?? `http://127.0.0.1:${localPort}/`;
const debuggingPort = Number(process.env.CDP_PORT ?? (20000 + Math.floor(Math.random() * 30000)));
const profile = await mkdtemp(join(tmpdir(), "gengce-ui-check-"));
const screenshotDir = join(process.cwd(), "test-results", "ui");
await mkdir(screenshotDir, { recursive: true });

const appModelServer = externalAppUrl
  ? null
  : createHttpServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "invalid json" } }));
        return;
      }
      const system = body.messages?.find(message => message.role === "system")?.content ?? "";
      let content = "已按本轮地块证据完成核对。天气、土壤和价格仍需结合田间观察及当地行情确认。";
      if (String(system).includes("MCP 只读工具规划器")) {
        const userText = String(body.messages?.find(message => message.role === "user")?.content ?? "{}");
        const planning = JSON.parse(userText);
        const weatherTool = planning.tools?.find(tool => tool.name === "read_field_weather");
        content = JSON.stringify({
          calls: weatherTool
            ? [{
                toolId: weatherTool.toolId,
                arguments: { plot: planning.plotContext?.plotName ?? "当前地块" },
                reason: "读取当前地块未来天气，作为本轮风险判断的外部证据"
              }]
            : []
        });
      }
      if (body.stream) {
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, 12) } }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(12) } }] })}\n\n`);
        response.write(`data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { total_tokens: 36 }
        })}\n\n`);
        response.end("data: [DONE]\n\n");
        return;
      }
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        choices: [{ message: { content } }],
        usage: { total_tokens: 36 }
      }));
    });

if (appModelServer) {
  await new Promise(resolve => appModelServer.listen(0, "127.0.0.1", resolve));
}
const appModelPort = appModelServer?.address()?.port;

const appService = externalAppUrl
  ? null
  : spawn(process.execPath, [join(process.cwd(), "dist-server", "index.js")], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ROOT: process.cwd(),
        DATABASE_PATH: join(profile, "agri.db"),
        PORT: String(localPort),
        MODEL_PROVIDER: "qwen",
        MODEL_API_KEY: "ui-check-key",
        MODEL_BASE_URL: `http://127.0.0.1:${appModelPort}/v1`,
        MODEL_NAME: "qwen-ui-check"
      },
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true
    });

if (appService) {
  await waitForServer(appUrl);
}

const edge = spawn(
  edgePath,
  [
    "--headless",
    "--inprivate",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--hide-scrollbars",
    "--no-first-run",
    "--disable-features=msEdgeSigninWithSystemAccount,msEdgeSync,msEdgeSignin",
    "--no-default-browser-check",
    `--remote-debugging-port=${debuggingPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    "--window-size=1440,1000",
    "about:blank"
  ],
  { stdio: ["ignore", "ignore", "ignore"], windowsHide: true }
);

let socket;
try {
  const page = await waitForPage(debuggingPort);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let messageId = 0;
  const pending = new Map();
  const consoleErrors = [];
  socket.addEventListener("message", (message) => {
    const payload = JSON.parse(String(message.data));
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(payload.error.message));
      else resolve(payload.result);
      return;
    }
    if(process.env.CHECK_MAP_LIVE==='true' && payload.method==='Network.responseReceived' && payload.params.response.url.includes('_AMapService')) console.log('Map response',new URL(payload.params.response.url).pathname,payload.params.response.status,payload.params.response.mimeType);
    if(process.env.CHECK_MAP_LIVE==='true' && payload.method==='Network.loadingFailed')console.log('Network failure',payload.params.errorText);
    if (payload.method === "Runtime.exceptionThrown") {
      consoleErrors.push(payload.params.exceptionDetails.text);
    }
    if (
      payload.method === "Runtime.consoleAPICalled" &&
      payload.params.type === "error"
    ) {
      consoleErrors.push(
        payload.params.args.map((argument) => argument.value ?? argument.description).join(" ")
      );
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.exception?.value ??
        result.exceptionDetails.text
      );
    }
    return result.result?.value;
  };
  const capture = async (name) => {
    const result = await send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    });
    await writeFile(join(screenshotDir, name), Buffer.from(result.data, "base64"));
  };

  await send("Network.enable");
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.bringToFront");
  await send("Page.navigate", { url: appUrl });
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".assistant-welcome"))'),
    20_000,
    "桌面农业助手未渲染"
  );
  await evaluate('document.querySelector(".goal-picker-trigger").click()');
  await waitFor(() => evaluate('document.querySelectorAll(".goal-picker-option").length === 4'), 3000, "目标面板未展开");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await capture("desktop-goal-picker.png");
  await evaluate('document.querySelector(".goal-picker-option input[value=low_risk]").click()');
  if (!await evaluate('document.querySelector(".goal-picker-trigger").textContent.includes("低风险")')) throw new Error("种植目标未更新");
  await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))');
  if (await evaluate('Boolean(document.querySelector(".goal-picker-panel"))')) throw new Error("Escape 未关闭目标面板");
  await evaluate('document.querySelector(".goal-picker-trigger").click()');
  await evaluate('document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles:true}))');
  await waitFor(() => evaluate('!document.querySelector(".goal-picker-panel")'), 3000, "点击外部未关闭目标面板");
  await evaluate('document.querySelector(".goal-picker-trigger").click()');
  await evaluate('document.querySelector(".goal-picker-option input[value=profit]").click()');
  await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))');
  const readTinyText = () =>
    evaluate(
      `(() => [...document.querySelectorAll("body *")]
        .filter((element) => {
          const text = element.textContent?.trim();
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return text && element.children.length === 0 && rect.width > 0 && rect.height > 0 &&
            Number.parseFloat(style.fontSize) < 8;
        })
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          text: element.textContent.trim().slice(0, 40),
          size: getComputedStyle(element).fontSize
        }))
        .slice(0, 20))()`
    );
  const initialTinyText = await readTinyText();
  if (initialTinyText.length) {
    throw new Error(`首屏存在小于 8px 的可见文字：${JSON.stringify(initialTinyText)}`);
  }
  const accountIdentity = await evaluate(`(() => ({
    avatar: document.querySelector(".account-compact-avatar")?.textContent?.trim() ?? "",
    name: document.querySelector(".account-compact strong")?.textContent?.trim() ?? "",
    subtitle: document.querySelector(".account-compact small")?.textContent?.trim() ?? ""
  }))()`);
  if (accountIdentity.avatar !== "耕" || accountIdentity.name !== "耕策智能体") {
    throw new Error(`演示账号品牌未更新：${JSON.stringify(accountIdentity)}`);
  }
  if (/qwen|deepseek/i.test(accountIdentity.subtitle)) {
    throw new Error(`账号卡仍显示模型标识：${accountIdentity.subtitle}`);
  }
  if (await evaluate('document.querySelectorAll(".welcome-prompts button").length') !== 4) throw new Error("首页必须恰好四个快捷入口");
  await capture("desktop-runtime.png");
  await evaluate(`[...document.querySelectorAll(".evaluation-link")].find(button=>button.textContent.includes("能力中心"))?.click()`);
  await waitFor(()=>evaluate('Boolean(document.querySelector(".capability-view"))'),5000,'能力中心未打开');
  await waitFor(()=>evaluate('Boolean(document.querySelector(".capability-tabs")) && !document.querySelector(".capability-skeleton")'),8000,'能力中心数据未加载');
  if(await evaluate('document.documentElement.scrollWidth > innerWidth'))throw new Error('能力中心桌面横向溢出');
  const hasSeededDemoMcp = await evaluate(`fetch('/api/capabilities').then(r=>r.json()).then(data=>data.mcpServers.some(server=>server.name==='内置mcp'))`);
  if(!hasSeededDemoMcp){
    await evaluate(`[...document.querySelectorAll(".capability-panel-heading button")].find(button=>button.textContent.includes("添加服务"))?.click()`);
    await waitFor(()=>evaluate('Boolean(document.querySelector(".mcp-editor"))'),3000,'MCP 新建表单未展开');
    await evaluate(`(() => {
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      const name=document.querySelector('.mcp-editor input');
      setter.call(name,'内置mcp');
      name.dispatchEvent(new Event('input',{bubbles:true}));
      const transport=document.querySelector('.mcp-editor select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(transport,'stdio');
      transport.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await waitFor(()=>evaluate('document.querySelectorAll(".mcp-editor select").length === 2'),3000,'MCP stdio 表单未切换');
    await evaluate(`(() => {
      const selects=document.querySelectorAll('.mcp-editor select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(selects[1],'node');
      selects[1].dispatchEvent(new Event('change',{bubbles:true}));
      const argsLabel=[...document.querySelectorAll('.mcp-editor label')].find(label=>label.textContent.includes('参数'));
      const args=argsLabel?.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(args,${JSON.stringify(join(process.cwd(), "tests", "fixtures", "fake-mcp-server.mjs"))});
      args.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await new Promise(resolve=>setTimeout(resolve,80));
    await evaluate(`[...document.querySelectorAll('.capability-editor-actions button')].find(button=>button.textContent.includes('保存服务'))?.click()`);
  }
  await waitFor(()=>evaluate('document.querySelector(".capability-view")?.textContent.includes("内置mcp")'),5000,'MCP 服务创建未显示');
  await evaluate(`[...document.querySelectorAll(".mcp-item .capability-inline-actions button")].find(button=>button.textContent.includes("发现工具"))?.click()`);
  await waitFor(()=>evaluate('document.querySelector(".capability-view")?.textContent.includes("只读可自动") && document.querySelector(".capability-view")?.textContent.includes("仅手动")'),8000,'MCP 只读状态标签未显示');
  await capture("desktop-capabilities-mcp.png");
  await evaluate(`[...document.querySelectorAll(".capability-tabs button")].find(button=>button.textContent.includes("技能库"))?.click()`);
  await waitFor(()=>evaluate('Boolean(document.querySelector(".skill-item"))'),3000,'能力中心技能页未显示');
  await evaluate(`[...document.querySelectorAll(".skill-item")].find(item=>item.textContent.includes("气象风险"))?.querySelector("button")?.click()`);
  await waitFor(()=>evaluate('document.querySelector(".capability-view")?.textContent.includes("个人副本")'),5000,'系统技能复制未显示');
  await capture("desktop-capabilities-skills.png");
  await evaluate(`[...document.querySelectorAll(".capability-tabs button")].find(button=>button.textContent.includes("知识库"))?.click()`);
  await waitFor(()=>evaluate('Boolean(document.querySelector(".knowledge-item")) || document.querySelector(".capability-view")?.textContent.includes("还没有知识库")'),3000,'能力中心知识页未显示');
  await waitFor(()=>evaluate('Boolean(document.querySelector(\'.knowledge-document a[href^="https://nyt.hubei.gov.cn/"]\'))'),5000,'官方知识来源链接未显示');
  if(!await evaluate('document.querySelector(".capability-view")?.textContent.includes("湖北省2026年秋冬季主要农作物科学施肥技术指导方案")'))throw new Error('官方农技示例资料未显示');
  await capture("desktop-capabilities-knowledge.png");
  await evaluate(`[...document.querySelectorAll(".capability-panel-heading button")].find(button=>button.textContent.includes("新建知识库"))?.click()`);
  await waitFor(()=>evaluate('Boolean(document.querySelector(".capability-editor"))'),3000,'知识库新建表单未展开');
  await evaluate(`(() => {
    const input=document.querySelector('.capability-editor input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'界面验收知识库');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    const textarea=document.querySelector('.capability-editor textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'用于界面验收');
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
    [...document.querySelectorAll('.capability-editor-actions button')].find(button=>button.textContent.includes('创建'))?.click();
  })()`);
  await waitFor(()=>evaluate('document.querySelector(".capability-view")?.textContent.includes("界面验收知识库")'),5000,'知识库创建未显示');
  await evaluate(`[...document.querySelectorAll(".capability-tabs button")].find(button=>button.textContent.includes("MCP 服务"))?.click()`);
  await waitFor(()=>evaluate('document.querySelector(".capability-view")?.textContent.includes("只读可自动")'),3000,'MCP 工具状态在窄屏切换前丢失');
  await send("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve=>setTimeout(resolve,260));
  if(await evaluate('document.documentElement.scrollWidth > innerWidth'))throw new Error('MCP 能力中心窄屏横向溢出');
  await capture("mobile-capabilities-mcp.png");
  await evaluate(`[...document.querySelectorAll(".capability-tabs button")].find(button=>button.textContent.includes("知识库"))?.click()`);
  await waitFor(()=>evaluate('document.querySelector(".capability-view")?.textContent.includes("界面验收知识库")'),3000,'窄屏知识库页未显示');
  if(await evaluate('document.documentElement.scrollWidth > innerWidth'))throw new Error('知识库能力中心窄屏横向溢出');
  await capture("mobile-capabilities.png");
  await send("Emulation.setDeviceMetricsOverride", {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(`[...document.querySelectorAll(".capability-tabs button")].find(button=>button.textContent.includes("MCP 服务"))?.click()`);
  await waitFor(()=>evaluate('Boolean(document.querySelector(".mcp-tool-mode"))'),3000,'MCP 工具执行方式未显示');
  await evaluate(`(() => {
    const row=[...document.querySelectorAll('.mcp-tool')].find(item=>item.textContent.includes('read_field_weather'));
    const select=row?.querySelector('.mcp-tool-mode');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'confirm');
    select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await waitFor(()=>evaluate(`fetch('/api/capabilities').then(r=>r.json()).then(data=>data.mcpServers.some(server=>server.name==='内置mcp'&&server.tools.some(tool=>tool.name==='read_field_weather'&&tool.executionMode==='confirm')))`),5000,'MCP 调用前确认策略未保存');
  await capture("desktop-capabilities-mcp-confirm.png");
  await evaluate(`(async () => {
    const bootstrap=await fetch('/api/bootstrap').then(r=>r.json());
    const capabilities=await fetch('/api/capabilities?accountId='+encodeURIComponent(bootstrap.account.id)+'&plotId='+encodeURIComponent(bootstrap.activePlotId)).then(r=>r.json());
    const server=capabilities.mcpServers.find(item=>item.name==='内置mcp');
    await fetch('/api/capability-bindings',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        capabilityType:'mcp',
        capabilityId:server.id,
        scopeType:'plot',
        scopeId:bootstrap.activePlotId,
        enabled:true
      })
    });
  })()`);
  await evaluate('document.querySelector(".business-drawer-header button")?.click()');
  await evaluate(`(() => {
    const input=document.querySelector('.assistant-composer textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'请读取当前地块未来天气，并据此说明田间风险。');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.closest('form').requestSubmit();
  })()`);
  await waitFor(()=>evaluate('Boolean(document.querySelector(".mcp-approval-card"))'),30_000,'只读 MCP 调用前确认卡片未出现');
  const approvalCardVisible=await evaluate(`(() => {
    const card=document.querySelector('.mcp-approval-card');
    const thread=document.querySelector('.assistant-thread-scroll');
    const a=card.getBoundingClientRect(),b=thread.getBoundingClientRect();
    return a.top>=b.top&&a.bottom<=b.bottom&&!document.querySelector('.mcp-approval-details[open]');
  })()`);
  if(!approvalCardVisible)throw new Error('MCP 调用确认卡片不可见或参数未默认折叠');
  if(!await evaluate('document.querySelector(".mcp-approval-card")?.textContent.includes("内置mcp")'))throw new Error('MCP 调用确认缺少服务来源');
  await capture("desktop-mcp-approval.png");
  await new Promise(resolve=>setTimeout(resolve,700));
  await send("Page.reload",{ignoreCache:true});
  await waitFor(()=>evaluate('Boolean(document.querySelector(".mcp-approval-card"))'),20_000,'刷新后 MCP 确认请求未恢复');
  await send("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('document.querySelector(".assistant-expert-panel .expert-close")?.click()');
  await new Promise(resolve=>setTimeout(resolve,260));
  if(await evaluate('document.documentElement.scrollWidth > innerWidth'))throw new Error('MCP 调用确认窄屏横向溢出');
  await capture("mobile-mcp-approval.png");
  await send("Emulation.setDeviceMetricsOverride", {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('document.querySelector(".mcp-approval-actions button:last-child")?.click()');
  await waitFor(()=>evaluate('Boolean(document.querySelector(".mcp-approval-outcome.is-approved")) && !document.querySelector(".running-skeleton")'),30_000,'MCP 调用允许后未继续完成');
  if(!await evaluate(`fetch('/api/capabilities').then(r=>r.json()).then(data=>data.recentCalls.some(call=>call.toolName==='read_field_weather'&&call.status==='success'))`))throw new Error('MCP 调用允许后没有生成审计记录');
  await capture("desktop-mcp-approved.png");
  await evaluate(`(async () => {
    const bootstrap=await fetch('/api/bootstrap').then(r=>r.json());
    const capabilities=await fetch('/api/capabilities?accountId='+encodeURIComponent(bootstrap.account.id)+'&plotId='+encodeURIComponent(bootstrap.activePlotId)).then(r=>r.json());
    const server=capabilities.mcpServers.find(item=>item.name==='内置mcp');
    await fetch('/api/capability-bindings',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        capabilityType:'mcp',
        capabilityId:server.id,
        scopeType:'plot',
        scopeId:bootstrap.activePlotId,
        enabled:false
      })
    });
  })()`);
  await evaluate('document.querySelector(".account-compact")?.click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".farm-manager-toolbar"))'), 5000, '基地管理未打开');
  await evaluate('[...document.querySelectorAll(".farm-manager-toolbar button")].find(b=>b.textContent.includes("新建基地")).click()');
  const fillManagedForm = async (values) => {
    await waitFor(
      () => evaluate(`Boolean(document.querySelector('.farm-edit-form input[name="${Object.keys(values)[0]}"]'))`),
      3000,
      "基地或地块编辑表单未就绪"
    );
    return evaluate(`(() => {
      const values=${JSON.stringify(values)};
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      for(const [key,value] of Object.entries(values)) {
        const input=document.querySelector('.farm-edit-form input[name="'+key+'"]');
        if(!input)throw new Error('缺少表单字段：'+key);
        setter.call(input,String(value)); input.dispatchEvent(new Event('input',{bubbles:true}));
      }
      const form=document.querySelector('.farm-edit-form');
      if(!form)throw new Error('基地或地块编辑表单未就绪');
      form.requestSubmit();
    })()`);
  };
  if(process.env.CHECK_MAP_LIVE==='true') {
    await waitFor(()=>evaluate('Boolean(document.querySelector(".plot-map canvas"))'),25000,'基地地图未显示');
    await evaluate(`(()=>{const el=document.querySelector('[aria-label="搜索村庄或地址"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'湖北省武汉市江夏区纸坊街道');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate('document.querySelector(".plot-map-search button").click()');
    await waitFor(()=>evaluate(`document.querySelector('input[name="province"]').value.includes('湖北') && document.querySelector('input[name="district"]').value.includes('江夏')`),15000,'基地搜索未自动填入省市区');
    await evaluate('document.querySelector(".plot-map").scrollIntoView({block:"center"})');
    await new Promise(r=>setTimeout(r,350));
    const rect=await evaluate('(()=>{const r=document.querySelector(".plot-map").getBoundingClientRect();return {x:r.x+r.width/2+45,y:r.y+r.height/2+25}})()');
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1});
    await waitFor(()=>evaluate('!document.querySelector(".farm-edit-actions .primary-button").disabled'),15000,'基地选点地址解析未结束');
    await capture('desktop-farm-map.png');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('document.querySelector(".plot-location-editor").scrollIntoView({block:"start"})');
    if(await evaluate('document.documentElement.scrollWidth>innerWidth'))throw new Error('基地地图窄屏溢出');
    await capture('mobile-farm-map.png');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await fillManagedForm({name:'界面验收基地'});
  } else {
  await fillManagedForm({name:'界面验收基地',province:'湖北省',city:'武汉市',district:'江夏区',latitude:30.4,longitude:114.3});
  }
  await waitFor(() => evaluate('[...document.querySelectorAll(".farm-management-heading h4")].some(e=>e.textContent==="界面验收基地")'),5000,'基地创建未显示');
  await waitFor(() => evaluate('document.querySelector(".assistant-sidebar").textContent.includes("界面验收基地")'), 3000, '基地未同步侧栏');
  await evaluate(`document.querySelector('[aria-label="基地操作 界面验收基地"]').click()`);
  await evaluate(`[...document.querySelectorAll('.sidebar-item-menu button')].find(b=>b.textContent.includes('置顶基地')).click()`);
  await waitFor(()=>evaluate(`document.querySelector('[data-farm-group="pinned"]').textContent.includes('界面验收基地')`),5000,'基地置顶失败');
  await send('Page.reload',{ignoreCache:true});
  await waitFor(()=>evaluate(`document.querySelector('[data-farm-group="pinned"]')?.textContent.includes('界面验收基地')`),15000,'重载后置顶状态丢失');
  await evaluate(`document.querySelector('[aria-label="基地操作 界面验收基地"]').click()`);
  await capture('sidebar-farm-menu.png');
  await evaluate(`[...document.querySelectorAll('.sidebar-item-menu button')].find(b=>b.textContent.includes('取消置顶')).click()`);
  await waitFor(()=>evaluate(`document.querySelector('[data-farm-group="regular"]').textContent.includes('界面验收基地')`),5000,'取消置顶失败');
  await evaluate(`document.querySelector('[aria-label="基地操作 界面验收基地"]').click()`);
  await evaluate(`[...document.querySelectorAll('.sidebar-item-menu button')].find(b=>b.textContent.includes('编辑基地')).click()`);
  await waitFor(()=>evaluate(`document.querySelector('.farm-edit-form input[name="name"]')?.value === '界面验收基地'`),5000,'侧栏编辑基地未打开对应表单');
  await evaluate('document.querySelector(".business-drawer-header button").click()');
  await evaluate('document.querySelector(".account-compact").click()');
  await waitFor(()=>evaluate('Boolean(document.querySelector(".farm-manager-toolbar"))'),5000,'管理入口未恢复');

  if(process.env.CHECK_MAP_LIVE==='true') {
    const farm=await evaluate(`fetch('/api/workspace').then(r=>r.json()).then(w=>w.farms.find(f=>f.name==='界面验收基地'))`);
    if(!Number.isFinite(farm.longitude)||!Number.isFinite(farm.latitude)||farm.province!=='湖北省')throw new Error('基地地图档案未保存');
    await evaluate(`document.querySelector('[aria-label="编辑基地 界面验收基地"]').click()`);
    await waitFor(()=>evaluate('Boolean(document.querySelector(".plot-map canvas"))'),15000,'编辑基地未显示地图');
    if(!await evaluate(`document.querySelector('.plot-location-editor').textContent.includes('${farm.longitude.toFixed(6)}')`))throw new Error('基地保存后坐标未恢复');
    await evaluate('document.querySelector(".farm-editor-heading button").click()');
  }
  await waitFor(()=>evaluate('[...document.querySelectorAll(".farm-management-row")].some(r=>r.querySelector("h4").textContent==="界面验收基地")'),5000,'基地管理列表尚未加载');
  await evaluate('[...document.querySelectorAll(".farm-management-row")].find(r=>r.querySelector("h4").textContent==="界面验收基地").querySelector(".farm-row-actions button:last-child").click()');
  const blankFieldsArePlaceholders=await evaluate(`(() => {
    const keys=['soilTexture','irrigation','drainage','currentCrop','rotation'];
    return keys.every(key=>{const input=document.querySelector('.farm-edit-form input[name="'+key+'"]');return input && input.value==='' && input.placeholder==='未填写';});
  })()`);
  if(!blankFieldsArePlaceholders)throw new Error('地块未填写字段应为空白占位符');
  await fillManagedForm({name:'界面验收田',areaMu:8.5,soilTexture:'壤土',irrigation:'沟灌',drainage:'良好',currentCrop:'冬小麦',rotation:'稻麦轮作'});
  await waitFor(() => evaluate('[...document.querySelectorAll(".farm-plot-select strong")].some(e=>e.textContent==="界面验收田")'),5000,'地块未创建');
  await evaluate(`document.querySelector('[aria-label="编辑地块 界面验收田"]').click()`);
  if(process.env.CHECK_MAP_LIVE === 'true') {
    await waitFor(()=>evaluate('Boolean(document.querySelector(".plot-map canvas"))'),25000,'高德地图没有渲染');
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="搜索村庄或地址"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'湖北省武汉市江夏区纸坊街道');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate('document.querySelector(".plot-map-search button").click()');
    await waitFor(()=>evaluate('!document.querySelector(".plot-map-search button").disabled'),15000,'地址搜索超时');
    if(await evaluate('document.querySelector(".plot-location-editor").textContent.includes("未找到该地址")'))throw new Error('高德真实地址搜索失败：'+await evaluate('document.querySelector(".plot-location-editor .inline-error")?.textContent'));
    await evaluate('document.querySelector(".plot-map").scrollIntoView({block:"center"})');
    await new Promise(r=>setTimeout(r,400));
    const rect=await evaluate('(()=>{const r=document.querySelector(".plot-map").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()');
    const click=async(dx,dy)=>{const x=rect.x+rect.width/2+dx,y=rect.y+rect.height/2+dy;await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});await new Promise(r=>setTimeout(r,150));};
    await click(0,0);
    await waitFor(()=>evaluate('document.querySelector(".plot-location-editor").textContent.includes("地图选点")'),3000,'地图选点失败');
    await waitFor(()=>evaluate(`Boolean(document.querySelector('.farm-edit-form input[name="soilTexture"]')?.value)`),15000,'地图选点未补全土壤质地');
    await evaluate('[...document.querySelectorAll(".plot-map-tools button")].find(b=>b.textContent==="绘制边界").click()');
    await click(-45,-35);await click(45,-35);await click(45,35);await click(-45,35);
    await evaluate('[...document.querySelectorAll(".plot-map-tools button")].find(b=>b.textContent.includes("完成边界")).click()');
    await waitFor(()=>evaluate('Boolean(document.querySelector(".plot-area-comparison"))'),3000,'边界面积未计算');
    await evaluate('[...document.querySelectorAll(".plot-map-tools button")].find(b=>b.textContent==="切换卫星图").click()');
    await new Promise(r=>setTimeout(r,1200));
    await capture('desktop-plot-map.png');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('document.querySelector(".plot-location-editor").scrollIntoView({block:"start"})');
    if(await evaluate('document.documentElement.scrollWidth>innerWidth'))throw new Error('地图编辑窄屏溢出');
    await capture('mobile-plot-map.png');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await evaluate('[...document.querySelectorAll(".plot-area-comparison button")].find(b=>b.textContent.includes("采用")).click()');
  }
  await fillManagedForm({name:'编辑后的验收田',areaMu:10});
  await waitFor(() => evaluate('document.querySelector(".farm-manager").textContent.includes("编辑后的验收田")'),5000,'地块编辑未保存');
  if(process.env.CHECK_MAP_LIVE==='true') {
    await evaluate(`document.querySelector('[aria-label="编辑地块 编辑后的验收田"]').click()`);
    await waitFor(()=>evaluate('Boolean(document.querySelector(".plot-area-comparison"))'),4000,'保存后边界未恢复');
    const stored=await evaluate(`fetch('/api/workspace').then(r=>r.json()).then(w=>w.farms.flatMap(f=>f.plots).find(p=>p.name==='编辑后的验收田'))`);
    if(!stored.location?.boundary?.length||stored.areaMu!==10)throw new Error('边界或独立登记面积未保存');
    await evaluate('document.querySelector(".farm-editor-heading button").click()');
  }
  await capture('desktop-farm-management.png');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(r=>setTimeout(r,260));
  if(await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error('基地管理窄屏溢出');
  await capture('mobile-farm-management.png');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('document.querySelector(".business-drawer-header button").click()');
  await evaluate(`document.querySelector('[aria-label="地块操作 编辑后的验收田"]').closest('.sidebar-plot-row').querySelector('.sidebar-plot-link').click()`);
  await waitFor(()=>evaluate(`document.querySelector('.sidebar-plot-link[aria-current="page"]')?.textContent.includes('编辑后的验收田')`),5000,'当前地块未切换');
  await evaluate(`document.querySelector('[aria-label="地块操作 编辑后的验收田"]').click()`);
  await evaluate(`[...document.querySelectorAll('.sidebar-item-menu button')].find(b=>b.textContent.includes('删除地块')).click()`);
  await capture('sidebar-delete-confirm.png');
  await evaluate('document.querySelector(".sidebar-delete-confirm button:first-child").click()');
  if(!await evaluate(`Boolean(document.querySelector('[aria-label="地块操作 编辑后的验收田"]'))`))throw new Error('取消删除却移除了地块');
  await evaluate(`document.querySelector('[aria-label="地块操作 编辑后的验收田"]').click()`);
  await evaluate(`[...document.querySelectorAll('.sidebar-item-menu button')].find(b=>b.textContent.includes('删除地块')).click()`);
  await evaluate('document.querySelector(".sidebar-delete-confirm button:last-child").click()');
  await waitFor(()=>evaluate(`!document.querySelector('[aria-label="地块操作 编辑后的验收田"]')`),5000,'侧栏地块删除失败');
  await evaluate('document.querySelector(".account-compact").click()');
  await waitFor(()=>evaluate('Boolean(document.querySelector(".farm-deleted"))'),5000,'删除档案未显示');
  await evaluate('document.querySelector(".farm-deleted > button").click()');
  await evaluate(`[...document.querySelectorAll('.farm-restore-row')].find(r=>r.textContent.includes('编辑后的验收田')).querySelector('button').click()`);
  await waitFor(()=>evaluate(`Boolean(document.querySelector('[aria-label="地块操作 编辑后的验收田"]'))`),5000,'地块恢复后侧栏未同步');
  await evaluate('document.querySelector(".business-drawer-header button").click()');
  await evaluate(`document.querySelector('[aria-label="基地操作 界面验收基地"]').click()`);
  await evaluate(`[...document.querySelectorAll('.sidebar-item-menu button')].find(b=>b.textContent.includes('删除基地')).click()`);
  await evaluate('document.querySelector(".sidebar-delete-confirm button:last-child").click()');
  await waitFor(()=>evaluate(`!document.querySelector('[aria-label="基地操作 界面验收基地"]')`),5000,'侧栏基地删除失败');
  await evaluate('document.querySelector(".account-compact").click()');
  await waitFor(()=>evaluate('Boolean(document.querySelector(".farm-deleted"))'),5000,'基地删除后不能恢复');
  await evaluate('document.querySelector(".farm-deleted > button").click()');
  await evaluate('[...document.querySelectorAll(".farm-restore-row")].find(r=>r.textContent.includes("界面验收基地")).querySelector("button").click()');
  await waitFor(() => evaluate('[...document.querySelectorAll(".farm-management-heading h4")].some(e=>e.textContent==="界面验收基地")'),5000,'基地恢复失败');
  await evaluate('document.querySelector(".business-drawer-header button").click()');

  if (process.env.CHECK_VISION_LIVE === 'true') {
    function crc(buffer) { let value = 0xffffffff; for (const byte of buffer) { value ^= byte; for (let i=0;i<8;i++) value=(value>>>1)^((value&1)?0xedb88320:0); } return (value^0xffffffff)>>>0; }
    function chunk(type, bytes) { const tag=Buffer.from(type), size=Buffer.alloc(4), sum=Buffer.alloc(4); size.writeUInt32BE(bytes.length);sum.writeUInt32BE(crc(Buffer.concat([tag,bytes])));return Buffer.concat([size,tag,bytes,sum]); }
    const header=Buffer.alloc(13);header.writeUInt32BE(100,0);header.writeUInt32BE(100,4);header[8]=8;header[9]=2;
    const pixels=Buffer.alloc(30100,255);for(let y=0;y<100;y++)pixels[y*301]=0;
    const blank=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
    const fixture=join(profile,'blank.png'); await writeFile(fixture,blank);
    await evaluate('[...document.querySelectorAll(".composer-toolbar button")].find(b=>b.textContent.includes("虫害图片"))?.click()');
    await waitFor(()=>evaluate('Boolean(document.querySelector(".pest-inspector"))'),3000,'图片识别入口未打开');
    const root=await send('DOM.getDocument',{});
    const fileInput=await send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'.pest-inspector input[type=file]'});
    await send('DOM.setFileInputFiles',{nodeId:fileInput.nodeId,files:[fixture]});
    await waitFor(()=>evaluate('Boolean(document.querySelector(".pest-preview"))'),3000,'图片预览失败');
    await evaluate('document.querySelector(".pest-inspector .primary-button").click()');
    await waitFor(()=>evaluate('Boolean(document.querySelector(".assistant-turn[data-status=done]"))'),100000,'真实视觉识别未返回结果');
    if (!await evaluate('(async () => { const context = await (await fetch("/api/bootstrap")).json(); const records = await (await fetch("/api/pest-assessments?plotId="+context.activePlotId)).json(); return ["uncertain","no_pest_visible"].includes(records[0]?.assessment.status); })()')) throw new Error('空白图片应拒绝害虫判断');
    await capture('desktop-pest-recognition.png');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('document.querySelector(".sidebar-mobile-close")?.click()');
    await new Promise(resolve => setTimeout(resolve, 300));
    if(await evaluate('document.documentElement.scrollWidth > window.innerWidth')) throw new Error('虫害界面移动端溢出');
    await capture('mobile-pest-recognition.png');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await evaluate('document.querySelector(".pest-inspector header button")?.click()');
    await evaluate('[...document.querySelectorAll(".composer-toolbar button")].find(b=>b.textContent.includes("虫害图片"))?.click()');
    await waitFor(()=>evaluate('Boolean(document.querySelector(".pest-result"))'),3000,'地块识别历史未保存');
    await evaluate('document.querySelector(".pest-inspector header button")?.click()');
  }

  await evaluate('document.querySelector(".new-chat-button")?.click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".assistant-welcome"))'), 3000, '无法开始新的测试对话');
  await evaluate('document.querySelector(".theme-toggle")?.click()');
  await new Promise(resolve => setTimeout(resolve, 250));
  await capture("desktop-dark.png");
  if (await evaluate('document.documentElement.dataset.theme') !== "dark") throw new Error("深色主题未切换");
  await evaluate('document.querySelector(".theme-toggle")?.click()');
  await evaluate('document.querySelector(".sidebar-resizer")?.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowRight",bubbles:true}))');
  if (await evaluate('parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"))') !== 316) throw new Error("侧栏键盘调整失败");
  await evaluate('document.querySelector(".sidebar-resizer")?.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowLeft",bubbles:true}))');
  await send("Emulation.setDeviceMetricsOverride", {width:1024,height:900,deviceScaleFactor:1,mobile:false});
  await new Promise(resolve => setTimeout(resolve, 300));
  await capture("desktop-1024.png");
  if (await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error("1024px 横向溢出");
  await send("Emulation.setDeviceMetricsOverride", {width:1440,height:1000,deviceScaleFactor:1,mobile:false});

  await evaluate(`(() => {
    window.__traceCounts = [];
    const observer = new MutationObserver(() => {
      const count = document.querySelectorAll('.trace-event').length;
      if (window.__traceCounts.at(-1) !== count) window.__traceCounts.push(count);
    });
    observer.observe(document.querySelector('.expert-trace'), {childList:true,subtree:true});
  })()`);
  const desktopOverflow = await evaluate(
    "document.documentElement.scrollWidth > window.innerWidth"
  );
  if (desktopOverflow) throw new Error("桌面农业助手出现横向溢出");

  await evaluate(
    `(() => {
      const button = document.querySelector(".welcome-prompts button");
      button?.click();
      return Boolean(button);
    })()`
  );
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".running-skeleton"))'),
    5_000,
    "Agent 运行状态没有启动"
  );
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".running-skeleton .streaming-text") && document.querySelector(".stream-draft"))'),
    20_000,
    "未捕获到运行中的实时草稿"
  );
  const runningTextLayout = await evaluate(`(() => {
    const detail = document.querySelector(".running-skeleton .streaming-text");
    const draft = document.querySelector(".stream-draft");
    const detailRect = detail.getBoundingClientRect();
    const draftRect = draft.getBoundingClientRect();
    return {
      detailBottom: detailRect.bottom,
      detailHeight: detailRect.height,
      detailDisplay: getComputedStyle(detail).display,
      draftTop: draftRect.top,
      lineHeight: parseFloat(getComputedStyle(detail).lineHeight)
    };
  })()`);
  if (runningTextLayout.detailBottom > runningTextLayout.draftTop + 1) {
    throw new Error(`运行中文案发生重合：${JSON.stringify(runningTextLayout)}`);
  }
  await capture("desktop-running.png");
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".assistant-candidate-row"))'),
    30_000,
    "Agent 运行未在预期时间内结束"
  );

  if (!await evaluate('(window.__traceCounts ?? []).filter(n => n > 0).length >= 3')) throw new Error('执行轨迹没有逐条加入');
  if (!await evaluate('document.querySelector(".assistant-composer-region").getBoundingClientRect().bottom <= innerHeight + 2')) throw new Error("长轨迹把输入框挤出窗口");
  const eventCount = await evaluate('document.querySelectorAll(".trace-event").length');
  if (eventCount < 10) throw new Error(`轨迹事件不足：${eventCount}`);
  const completedTinyText = await readTinyText();
  if (completedTinyText.length) {
    throw new Error(`结果页存在小于 8px 的可见文字：${JSON.stringify(completedTinyText)}`);
  }
  const inlineDetailsWork = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.assistant-candidate-row')];
    const check = (row) => row.getAttribute('aria-expanded') === 'true'
      && Boolean(row.nextElementSibling?.querySelector('.candidate-detail-panel'))
      && document.querySelectorAll('.candidate-detail-panel').length === 1;
    if (rows.length < 2 || !check(rows[0])) return false;
    rows[1].click();
    return true;
  })()`);
  if (!inlineDetailsWork) throw new Error('首项详情未在选项下方展开');
  await waitFor(() => evaluate('document.querySelectorAll(".assistant-candidate-row")[1]?.getAttribute("aria-expanded") === "true"'), 3000, '切换方案未展开');
  if (!await evaluate('Boolean(document.querySelectorAll(".assistant-candidate-row")[1]?.nextElementSibling?.querySelector(".candidate-detail-panel")) && document.querySelectorAll(".candidate-detail-panel").length === 1')) throw new Error('详情未跟随选项');
  await evaluate('document.querySelectorAll(".assistant-candidate-row")[1].click()');
  await waitFor(() => evaluate('!document.querySelector(".candidate-expansion.is-open")'), 3000, '再次点击未收起详情');
  await evaluate('document.querySelector(".assistant-candidate-row").click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".candidate-detail-panel"))'), 3000, '重新展开失败');
  await capture("desktop-run-complete.png");
  await evaluate('document.querySelectorAll(".review-tabs button")[1]?.click()');
  if (!await evaluate('Boolean(document.querySelector(".review-artifacts details"))')) throw new Error("缺少运行产物");
  const artifactCheck = await evaluate(`(() => {
    const root = document.querySelector(".review-artifacts");
    return {
      cards: root?.querySelectorAll(".review-artifact-card").length ?? 0,
      primary: root?.querySelectorAll('.review-artifact-card[open]').length ?? 0,
      prose: root?.querySelector(".artifact-prose")?.textContent?.trim().length ?? 0,
      rawJson: Boolean(root?.querySelector("pre"))
    };
  })()`);
  if (artifactCheck.cards < 3 || artifactCheck.primary < 1 || artifactCheck.prose < 20 || artifactCheck.rawJson) {
    throw new Error(`可阅读产物档案不完整：${JSON.stringify(artifactCheck)}`);
  }
  await capture("desktop-run-artifacts.png");
  await evaluate('document.querySelectorAll(".review-tabs button")[2]?.click()');
  if (!await evaluate('Boolean(document.querySelector(".review-terminal"))')) throw new Error("缺少只读日志");
  const logCheck = await evaluate(`(() => {
    const text = document.querySelector(".review-terminal")?.textContent ?? "";
    return { payload: text.includes("payload"), artifact: text.includes('"artifact"') };
  })()`);
  if (!logCheck.payload || !logCheck.artifact) {
    throw new Error(`日志未承接结构化产物：${JSON.stringify(logCheck)}`);
  }
  await capture("desktop-run-logs.png");
  if (await evaluate('/qwen|deepseek/i.test(document.body.innerText)')) {
    throw new Error("运行界面仍暴露模型供应商标识");
  }
  await evaluate('document.querySelectorAll(".review-tabs button")[0]?.click()');

  // Keep the displayed history, but make another run the database's latest result.
  const earlier=await evaluate(`fetch('/api/bootstrap').then(r=>r.json()).then(d=>({plotId:d.activePlotId,ids:d.recommendations.map(r=>r.id)}))`);
  const newerRun=await evaluate(`fetch('/api/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plotId:'${earlier.plotId}',mode:'recommend',goal:'profit'})}).then(r=>r.json())`);
  await waitFor(()=>evaluate(`fetch('/api/runs/${newerRun.runId}').then(r=>r.json()).then(r=>r.status==='completed')`),45000,'历史采用回归的后续推荐未完成');
  await send('Page.reload',{ignoreCache:true});
  await waitFor(()=>evaluate('Boolean(document.querySelector(".candidate-actions .primary-button"))'),15000,'历史候选未恢复');
  await evaluate('document.querySelector(".expert-trace").scrollTop=100000');
  await evaluate(`document.querySelector('[aria-label="收起执行轨迹"]')?.click()`);

  await evaluate(
    `(() => {
      const button = document.querySelector(".candidate-actions .primary-button");
      button?.click();
      return Boolean(button && !button.disabled);
    })()`
  );
  await waitFor(() => evaluate('Boolean(document.querySelector(".approval-card"))'), 3000, "采用方案缺少确认");
  if(!await evaluate('Boolean(document.querySelector(".assistant-main .approval-card")) && !document.querySelector(".expert-panel .approval-card")'))throw new Error('采用确认必须在主对话内');
  if(await evaluate('document.querySelector(".expert-panel").classList.contains("is-open")'))throw new Error('点击采用不应强制打开副面板');
  await waitFor(()=>evaluate('(()=>{const r=document.querySelector(".approval-card").getBoundingClientRect(),s=document.querySelector(".assistant-thread-scroll").getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom})()'),3000,'主界面确认卡片不可见');
  if (await evaluate('Boolean(document.querySelector(".approval-card details[open]"))')) throw new Error("确认详情应默认折叠");
  await capture("desktop-approval.png");
  await evaluate('document.querySelector(".approval-actions button:first-child")?.click()');
  if (await evaluate('Boolean(document.querySelector(".approval-card"))')) throw new Error("暂不采用未关闭确认");
  await evaluate('document.querySelector(".candidate-actions .primary-button")?.click()');
  await evaluate('document.querySelector(".approval-actions button:last-child")?.click()');
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".plan-document-card"))'),
    10_000,
    "采用方案后未返回对话内方案文档"
  );
  const planDrawerStayedClosed = await evaluate(
    '!document.querySelector(".business-drawer")'
  );
  if (!planDrawerStayedClosed) {
    throw new Error("采用方案后不应自动打开业务抽屉");
  }
  const planStreamingObserved = await waitFor(
    () =>
      evaluate(
        'document.querySelector(".plan-response .streaming-text")?.dataset.streaming === "true"'
      ),
    3_000,
    "采用方案后未观察到逐字流式输出"
  );
  await new Promise((resolve) => setTimeout(resolve, 360));
  await capture("desktop-plan-streaming.png");
  await waitFor(
    () =>
      evaluate(
        'document.querySelector(".plan-response .streaming-text")?.dataset.streaming === "false"'
      ),
    12_000,
    "方案回复未完成流式输出"
  );
  const planDocumentTitle = await evaluate(
    'document.querySelector(".plan-document-heading strong")?.textContent?.trim() ?? ""'
  );
  if (!planDocumentTitle.includes("种植方案")) {
    throw new Error("对话内方案文档缺少标题");
  }
  await capture("desktop-plan-complete.png");
  if(!await evaluate('Boolean(document.querySelector(".plan-document-details[open]"))'))throw new Error('详细规划应默认直接展开');
  if(!await evaluate('document.querySelectorAll(".inline-plan-guidance section").length===5 && Boolean(document.querySelector(".plan-task-copy .inline-plan-method"))'))throw new Error('对话内详细做法或水肥规划缺失');
  await evaluate('document.querySelector(".plan-document-details summary")?.click()');
  await waitFor(()=>evaluate('!document.querySelector(".plan-document-details[open]")'),2000,'详细规划无法收起');
  await evaluate('document.querySelector(".plan-document-details summary")?.click()');
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".plan-document-details[open]"))'),
    2_000,
    "方案执行日程未在对话内展开"
  );
  await capture("desktop-plan-expanded.png");

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await new Promise((resolve) => setTimeout(resolve, 260));
  await evaluate('document.querySelector(".assistant-expert-panel .expert-close")?.click()');
  await waitFor(
    () => evaluate('!document.querySelector(".assistant-expert-panel.is-open")'),
    2_000,
    "窄窗口方案文档查看前未关闭执行轨迹"
  );
  await evaluate(
    'document.querySelector(".plan-document-card")?.scrollIntoView({ block: "center" })'
  );
  await new Promise((resolve) => setTimeout(resolve, 220));
  const planMobileOverflow = await evaluate(
    "document.documentElement.scrollWidth > window.innerWidth"
  );
  if (planMobileOverflow) throw new Error("窄窗口下对话内方案文档出现横向溢出");
  await capture("mobile-plan-complete.png");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  });
  await new Promise((resolve) => setTimeout(resolve, 260));

  await evaluate(
    `(() => {
      const button = [...document.querySelectorAll(".sidebar-primary button")]
        .find((element) => element.textContent.includes("种植方案"));
      button?.click();
      return Boolean(button);
    })()`
  );
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".plan-view"))'),
    5_000,
    "主动点击后未打开完整方案"
  );
  await evaluate(
    `(() => {
      const button = [...document.querySelectorAll(".plan-view button")]
        .find((element) => element.textContent.includes("记录农事"));
      button?.click();
      return Boolean(button);
    })()`
  );
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".records-view"))'),
    5_000,
    "农事记录视图未打开"
  );
  await evaluate(
    `(() => {
      document.querySelector(".business-drawer-header button")?.click();
      return true;
    })()`
  );

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await send("Page.reload", { ignoreCache: true });
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".user-turn"))'),
    20_000,
    "刷新后保存的对话未恢复"
  );
  if (!await evaluate('Boolean(document.querySelector(".plan-document-card"))')) throw new Error('历史方案快照未恢复');
  await capture('mobile-saved-conversation.png');
  await evaluate('document.querySelector(".new-chat-button")?.click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".assistant-welcome"))'), 3000, '新对话未打开');
  if (!await evaluate('document.querySelectorAll(".conversation-link").length > 0')) throw new Error('新建对话后历史丢失');
  await evaluate('document.querySelector(".conversation-link")?.click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".user-turn"))'), 5000, '最近对话无法打开');
  await evaluate('document.querySelector(".new-chat-button")?.click()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".assistant-welcome"))'), 3000, '无法返回新对话');
  const mobileOverflow = await evaluate(
    "document.documentElement.scrollWidth > window.innerWidth"
  );
  if (mobileOverflow) throw new Error("移动端农业助手出现横向溢出");
  await capture("mobile-runtime.png");
  await evaluate('document.querySelector(".assistant-menu-button")?.click()');
  if (!await evaluate('Boolean(document.querySelector(".assistant-sidebar.is-open"))')) throw new Error("窄屏导航未打开");
  await capture("mobile-sidebar.png");
  await evaluate('document.querySelector(".sidebar-mobile-close")?.click()');
  await evaluate(
    `(() => {
      document.querySelector(".trace-toolbar-button")?.click();
      return true;
    })()`
  );
  await waitFor(
    () => evaluate('Boolean(document.querySelector(".expert-panel.is-open"))'),
    3_000,
    "移动端 Agent 面板未打开"
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  const mobileTraceState = await evaluate(
    `(() => {
      const panel = document.querySelector(".assistant-expert-panel");
      const rect = panel?.getBoundingClientRect();
      const style = panel ? getComputedStyle(panel) : null;
      return {
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        display: style?.display ?? null,
        transform: style?.transform ?? null,
        zIndex: style?.zIndex ?? null
      };
    })()`
  );
  await capture("mobile-trace.png");

  await evaluate(`(async () => {
    const workspace=await (await fetch('/api/workspace')).json();
    for(const farm of workspace.farms) {
      const response=await fetch('/api/farms/'+farm.id,{method:'DELETE'});
      if(!response.ok) throw new Error('删除测试基地失败');
    }
  })()`);
  await send('Page.reload', {ignoreCache:true});
  await waitFor(() => evaluate('Boolean(document.querySelector(".workspace-onboarding"))'), 10000, '删空后新建页面未显示');
  await evaluate('document.querySelector(".farm-manager-toolbar button").click()');
  await fillManagedForm({name:'全新基地',province:'湖北省',city:'武汉市',latitude:30.5,longitude:114.4});
  await waitFor(() => evaluate('Boolean(document.querySelector(".farm-management-row"))'),5000,'空工作区新建基地失败');
  await evaluate('document.querySelector(".farm-management-row .farm-row-actions button:last-child").click()');
  await fillManagedForm({name:'第一块田',areaMu:5});
  await waitFor(() => evaluate('Boolean(document.querySelector(".assistant-main"))'), 8000, '新建首个地块后未进入工作台');
  await capture('workspace-first-plot.png');
  // Complete the business journey on the brand-new plot, without demo plans.
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const fresh=await evaluate(`fetch('/api/bootstrap').then(r=>r.json())`);
  if(fresh.activePlan||fresh.recommendations.length||fresh.farms.flatMap(f=>f.plots).find(p=>p.id===fresh.activePlotId).name!=='第一块田')throw new Error('新地块混入示范数据');
  await evaluate('document.querySelector(".welcome-prompts button").click()');
  await waitFor(()=>evaluate('Boolean(document.querySelector(".assistant-candidate-row")) && !document.querySelector(".running-skeleton")'),45000,'新地块建议生成失败');
  await evaluate(`[...document.querySelectorAll('.assistant-candidate-row')].find(b=>b.textContent.includes('冬油菜')).click()`);
  await waitFor(()=>evaluate(`Boolean(document.querySelector('.candidate-expansion.is-open .primary-button'))`),3000,'新地块油菜详情无法展开');
  await evaluate(`document.querySelector('.candidate-expansion.is-open .primary-button').click()`);
  await waitFor(()=>evaluate('Boolean(document.querySelector(".approval-card"))'),3000,'新地块采用确认未出现');
  await evaluate('document.querySelector(".approval-actions button:last-child").click()');
  await waitFor(()=>evaluate('Boolean(document.querySelector(".plan-document-card"))'),10000,'新地块采用后未出现文档');
  const adopted=await evaluate(`fetch('/api/bootstrap').then(r=>r.json())`);
  if(adopted.activePlan?.cropCode!=='rapeseed'||adopted.activePlan.plotId!==fresh.activePlotId)throw new Error('方案串地块或串作物');
  if(adopted.activePlanRecommendation?.id!==adopted.activePlan.recommendationId)throw new Error('方案详情未绑定已采用候选');
  const repeated=await evaluate(`fetch('/api/plans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({recommendationId:'${adopted.activePlan.recommendationId}'})}).then(r=>r.json())`);
  if(repeated.id!==adopted.activePlan.id)throw new Error('重复采用创建了重复方案');
  if(!await evaluate(`Boolean(document.querySelector('.plan-document-details[open]')) && document.querySelector('.plan-document-card').textContent.includes('冬油菜') && !document.querySelector('.business-drawer')`))throw new Error('新方案没有直接展示在对话里');
  await evaluate(`[...document.querySelectorAll('.plan-document-actions button')].find(b=>b.textContent.includes('继续问下一步')).click()`);
  await waitFor(()=>evaluate(`fetch('/api/bootstrap').then(r=>r.json()).then(d=>d.latestRun?.id!=='${adopted.latestRun.id}'&&d.latestRun?.status==='completed')`),45000,'下一步问答未完成');
  await waitFor(()=>evaluate('!document.querySelector(".running-skeleton")'),10000,'下一步界面未结束运行');
  const next=await evaluate(`fetch('/api/bootstrap').then(r=>r.json())`);
  if(next.recommendations[0].runId!==adopted.recommendations[0].runId)throw new Error('继续下一步错误地重新生成候选');
  if(!next.latestRun.events.some(e=>e.kind==='answer'&&e.payload?.planId===adopted.activePlan.id))throw new Error('下一步未读取已采用方案');
  if(!next.latestRun.summary.includes('冬油菜')||!next.latestRun.summary.includes('第一块田'))throw new Error('下一步答复串数据');
  await capture('new-farm-full-journey.png');
  console.log(
    JSON.stringify(
      {
        desktopOverflow,
        mobileOverflow,
        eventCount,
        planDrawerStayedClosed,
        planStreamingObserved,
        planDocumentTitle,
        planMobileOverflow,
        tinyText: [...initialTinyText, ...completedTinyText],
        mobileTraceState,
        consoleErrors,
        screenshots: [
          join(screenshotDir, "desktop-runtime.png"),
          join(screenshotDir, "desktop-run-complete.png"),
          join(screenshotDir, "desktop-run-artifacts.png"),
          join(screenshotDir, "desktop-run-logs.png"),
          join(screenshotDir, "desktop-plan-streaming.png"),
          join(screenshotDir, "desktop-plan-complete.png"),
          join(screenshotDir, "desktop-plan-expanded.png"),
          join(screenshotDir, "desktop-mcp-approval.png"),
          join(screenshotDir, "mobile-mcp-approval.png"),
          join(screenshotDir, "desktop-mcp-approved.png"),
          join(screenshotDir, "mobile-plan-complete.png"),
          join(screenshotDir, "mobile-runtime.png"),
          join(screenshotDir, "mobile-trace.png")
        ]
      },
      null,
      2
    )
  );
} finally {
  socket?.close();
  edge.kill();
  appService?.kill();
  appModelServer?.close();
}

async function waitForPage(port) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find((entry) => entry.type === "page" && !entry.url.startsWith("edge://"));
        if (page) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`无法连接浏览器调试端口${lastError ? `：${lastError}` : ""}`);
}

async function waitForServer(url) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`无法启动 UI 验收服务${lastError ? `：${lastError}` : ""}`);
}

async function waitFor(check, timeoutMs, message) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error(message);
}
