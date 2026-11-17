import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, X } from "lucide-react";
import { StreamingText } from "./StreamingText";
import { readEventStream } from "../lib/sse";

interface Assessment {
  id: string;
  model: string;
  createdAt: string;
  assessment: {
    status: string; observation: string;
    candidates: Array<{ name: string; evidence: string; distinguishing: string }>;
    nextPhotos: string[]; actions: string[];
  };
}

export function PestInspector({ plotId, onClose, onResult, onOutput, onBusyChange, disabled = false }: { plotId: string; onClose: () => void; onResult?: (text: string) => void; onOutput?: (kind: "start" | "text" | "done" | "error", text: string) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean }) {
  const [image, setImage] = useState("");
  const [notes, setNotes] = useState("");
  const [results, setResults] = useState<Assessment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<{ text: string; result?: Assessment } | null>(null);
  const [progress, setProgress] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/pest-assessments?plotId=${encodeURIComponent(plotId)}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error("识别记录加载失败"); return r.json(); })
      .then(setResults).catch(e => { if (!controller.signal.aborted) setError(String(e.message)); });
    return () => { controller.abort(); if (requestRef.current) { requestRef.current.abort(); onBusyChange?.(false); } };
  }, [plotId]);

  async function recognize() {
    if (disabled || busy) return;
    setBusy(true); onBusyChange?.(true); setError("");
    onOutput?.("start", notes);
    setLive({ text: "" }); setProgress("正在上传图片");
    const controller = new AbortController(); requestRef.current = controller;
    try {
      const response = await fetch("/api/pest-assessments?stream=1", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ plotId, image, notes }), signal: controller.signal });
      let completed = false;
      await readEventStream(response, (event, data) => {
        if (event === "error") throw new Error((data as { message: string }).message);
        if (event === "progress") setProgress((data as { text: string }).text);
        if (event === "text") { setProgress("正在逐步描述图片，结论待复核"); setLive({ text: (data as { text: string }).text }); onOutput?.("text", (data as { text: string }).text); }
        if (event === "done") {
          completed = true;
          const result = data as Assessment;
          const text = assessmentText(result);
          setLive({ text, result }); setProgress("识别完成，记录已保存");
          setResults(current => [result, ...current].slice(0, 10));
          onResult?.(text); onOutput?.("done", text);
        }
      });
      if (!completed) throw new Error("识别连接中断，已收到的内容保留，可重试");
      setImage("");
    } catch (e) { if (!controller.signal.aborted) { const message = e instanceof Error ? e.message : "识别失败"; setError(message); onOutput?.("error", message); } }
    finally { requestRef.current = null; setBusy(false); onBusyChange?.(false); }
  }
  return <section className={`pest-inspector ${busy ? "is-busy" : ""}`} data-complete={Boolean(live?.result)} data-assessment-status={live?.result?.assessment.status} aria-label="虫害图片识别">
    <header><h3>虫害图片识别</h3><button type="button" onClick={() => { if (busy) onOutput?.("error", "已取消查看，收到的内容已保留"); onClose(); }} aria-label="关闭虫害识别"><X size={16} /></button></header>
    <p>上传虫体或受害部位近照，结合田间情况进行初步判断。图片会发送到已配置的模型服务，识别记录保留在当前地块。</p>
    <label className="pest-upload"><ImagePlus size={16} />选择图片（JPEG / PNG / WebP，最多 4MB）
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        setError(""); setImage("");
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) { setError("请选择 4MB 以内的 JPEG、PNG 或 WebP 图片"); return; }
        const reader = new FileReader();
        reader.onload = () => setImage(String(reader.result));
        reader.onerror = () => setError("图片读取失败，请重新选择");
        reader.readAsDataURL(file);
      }} />
    </label>
    {image && <img className="pest-preview" src={image} alt="待识别的虫害图片" />}
    <label>田间情况（选填）<textarea value={notes} maxLength={1000} disabled={busy} onChange={e => setNotes(e.target.value)} placeholder="如：作物、生育期、发生部位、发现时间、受害范围" /></label>
    <button type="button" className="primary-button" disabled={!image || busy || disabled} onClick={() => void recognize()}>{busy && <LoaderCircle size={15} className="is-spinning" />}{busy ? "正在观察图片…" : "开始识别"}</button>
    <div role="status" aria-live="polite">{error}</div>
    {live && !onOutput && <article className="pest-result pest-live" data-complete={Boolean(live.result)}><h4>{live.result ? live.result.assessment.status === "suspected" ? "发现疑似虫害" : live.result.assessment.status === "no_pest_visible" ? "未见明确害虫" : "证据不足，需补充观察" : progress}</h4><p className="pest-stream-copy"><StreamingText text={live.text} /></p>{!busy && <small>{progress}</small>}</article>}
    {results.filter(result => result.id !== live?.result?.id).map(result => <article className="pest-result" key={result.id}>
      <h4>{result.assessment.status === "suspected" ? "发现疑似虫害" : result.assessment.status === "no_pest_visible" ? "未见明确害虫" : "证据不足，需补充观察"}</h4>
      <small>{new Date(result.createdAt).toLocaleString()} · {result.model} · 图片初筛，需田间核实</small>
      <p>{result.assessment.observation}</p>
      {result.assessment.candidates.map(candidate => <div key={candidate.name}><strong>疑似：{candidate.name}</strong><p>{candidate.evidence}</p><p>{candidate.distinguishing}</p></div>)}
      {!!result.assessment.actions.length && <><h4>下一步检查与处理</h4><ul>{result.assessment.actions.map(a => <li key={a}>{a}</li>)}</ul></>}
      {!!result.assessment.nextPhotos.length && <><h4>建议补拍</h4><ul>{result.assessment.nextPhotos.map(a => <li key={a}>{a}</li>)}</ul></>}
      <p>不要仅凭图片结果施药；先核实对象及发生程度，再按当地植保指导和登记标签处理。</p>
    </article>)}
  </section>;
}

function assessmentText(result: Assessment) {
  const a = result.assessment;
  return [a.observation,
    ...a.candidates.map(c => `疑似：${c.name}\n可见依据：${c.evidence}\n鉴别要点：${c.distinguishing}`),
    a.actions.length ? `下一步检查与处理\n${a.actions.map(x => `• ${x}`).join("\n")}` : "",
    a.nextPhotos.length ? `建议补拍\n${a.nextPhotos.map(x => `• ${x}`).join("\n")}` : "",
    "图片初筛需田间核实，不要仅凭图片施药。",
    `${result.model} · ${new Date(result.createdAt).toLocaleString()}`].filter(Boolean).join("\n\n");
}
