export async function readEventStream(response: Response, onEvent: (event: string, data: unknown) => void) {
  if (!response.ok) { const body = await response.json(); throw new Error(body.message || "请求失败"); }
  if (!response.body) throw new Error("服务未返回数据流");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const lines = frame.split(/\r?\n/);
        const event = lines.find(l => l.startsWith("event:"))?.slice(6).trim() ?? "message";
        const data = lines.filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
        if (data) onEvent(event, JSON.parse(data));
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
}
