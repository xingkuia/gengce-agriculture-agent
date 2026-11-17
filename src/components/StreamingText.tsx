import { createContext, useContext, useEffect, useRef, useState } from "react";
export const StreamHistory = createContext(false);

// The target may grow while the network streams. Never restart existing text.
export function StreamingText({ text, className = "", instant = false, onComplete }: {
  text: string; className?: string; instant?: boolean; onComplete?: () => void;
}) {
  const history = useContext(StreamHistory);
  instant = instant || history;
  const [visible, setVisible] = useState(() => instant ? text : "");
  const target = useRef(text);
  const shown = useRef(instant ? text : "");
  const doneRef = useRef(onComplete); doneRef.current = onComplete;
  target.current = text;
  useEffect(() => {
    if (instant || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      shown.current = text; setVisible(text); doneRef.current?.(); return;
    }
    if (!text.startsWith(shown.current)) { shown.current = ""; setVisible(""); }
    const tick = () => {
      if (shown.current === target.current) { clearInterval(timer); doneRef.current?.(); return; }
      const codepoint = target.current.codePointAt(shown.current.length);
      if (codepoint !== undefined) shown.current += String.fromCodePoint(codepoint);
      setVisible(shown.current);
      const element = elementRef.current;
      const scroller = element?.closest<HTMLElement>(".pest-inspector, .assistant-thread-scroll, .expert-trace");
      if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 100) scroller.scrollTop = scroller.scrollHeight;
    };
    const timer = setInterval(tick, 14);
    return () => clearInterval(timer);
  }, [text, instant]);
  const elementRef = useRef<HTMLSpanElement>(null);
  return <span ref={elementRef} className={`streaming-text ${className}`} data-streaming={visible !== text} aria-busy={visible !== text}>{visible}</span>;
}
