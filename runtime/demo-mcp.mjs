import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", line => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id === undefined) return;

  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gengce-demo-mcp", version: "1.0.0" }
      }
    });
    return;
  }

  if (request.method === "ping") {
    send({ jsonrpc: "2.0", id: request.id, result: {} });
    return;
  }

  if (request.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [{
          name: "read_field_weather",
          title: "读取地块天气",
          description: "读取指定地块未来三天的公开天气摘要。",
          inputSchema: {
            type: "object",
            properties: {
              plot: { type: "string", description: "地块名称" }
            },
            required: ["plot"]
          },
          annotations: {
            readOnlyHint: true
          }
        }, {
          name: "read_market_price",
          title: "读取市场价格",
          description: "读取指定天数的公开市场价格摘要。",
          inputSchema: {
            type: "object",
            properties: {
              days: { type: "integer", minimum: 1, maximum: 30 }
            },
            required: ["days"]
          },
          annotations: {
            readOnlyHint: true
          }
        }, {
          name: "write_irrigation_log",
          title: "写入灌溉记录",
          description: "向外部系统写入一条灌溉记录。",
          inputSchema: {
            type: "object",
            properties: {
              note: { type: "string" }
            },
            required: ["note"]
          },
          annotations: {
            readOnlyHint: false,
            destructiveHint: true
          }
        }]
      }
    });
    return;
  }

  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = request.params?.arguments ?? {};
    if (name === "read_field_weather") {
      const plot = String(args.plot ?? "当前地块");
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: `${plot}未来三天以多云为主，暂未发现强降雨风险。`
          }],
          isError: false
        }
      });
      return;
    }
    if (name === "read_market_price") {
      const days = Number(args.days ?? 7);
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: `近 ${days} 天当地粮油市场价格总体平稳，建议结合正式行情源复核。`
          }],
          isError: false
        }
      });
      return;
    }
    if (name === "write_irrigation_log") {
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{
            type: "text",
            text: "演示灌溉记录已接收，未写入真实外部系统。"
          }],
          isError: false
        }
      });
      return;
    }
  }

  send({
    jsonrpc: "2.0",
    id: request.id,
    error: {
      code: -32601,
      message: `Unsupported method: ${request.method}`
    }
  });
});
