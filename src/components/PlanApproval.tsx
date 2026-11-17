import {createContext,useContext,useEffect,useRef} from 'react';
import type {Recommendation} from '../types';
export const PlanApprovalContext=createContext<{
  pendingId:string|null;busy:boolean;error:string;
  approve:()=>Promise<boolean>;cancel:()=>void;
}|null>(null);

export function PlanApproval({recommendation}:{recommendation:Recommendation}){
  const approval=useContext(PlanApprovalContext);
  const ref=useRef<HTMLElement>(null);
  const visible=approval?.pendingId===recommendation.id;
  useEffect(()=>{
    if(!visible)return;
    const frame=requestAnimationFrame(()=>{
      const card=ref.current,thread=card?.closest<HTMLElement>('.assistant-thread-scroll');
      if(card&&thread)thread.scrollTo({top:thread.scrollTop+card.getBoundingClientRect().top-thread.getBoundingClientRect().top-16,behavior:'instant'});
      card?.focus({preventScroll:true});
    });
    return()=>cancelAnimationFrame(frame);
  },[visible]);
  if(!visible||!approval)return null;
  return <section className="approval-card inline-plan-approval" aria-label="采用方案确认" tabIndex={-1} ref={ref}>
    <h3>采用{recommendation.cropName}方案？</h3>
    <p>确认后将设为当前地块的执行方案，详细规划会直接显示在对话中。已有执行方案将转为历史档案。</p>
    <details><summary>查看任务与估算</summary><p>预计亩均净收益 {recommendation.economics.marginPerMu} 元，为估算值。</p><ul>{recommendation.plan.tasks.map(task=><li key={task.id}>{task.title} · {task.dateWindow}</li>)}</ul></details>
    {approval.error&&<p role="alert">{approval.error}</p>}
    <div className="approval-actions"><button type="button" disabled={approval.busy} onClick={approval.cancel}>暂不采用</button><button type="button" disabled={approval.busy} onClick={()=>void approval.approve()}>{approval.busy?'正在保存…':'确认采用'}</button></div>
  </section>;
}
