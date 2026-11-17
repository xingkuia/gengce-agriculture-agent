import { useEffect, useState } from "react";
import { manageFarm } from "../lib/api";
import { MoreHorizontal, PencilLine, PinOff, Trash2 } from "lucide-react";
import { Search, Plus, ChevronDown, ChevronRight, Folder, Pin, MessageSquare, ClipboardList, ChartNoAxesCombined, FlaskConical, PanelLeftClose, LoaderCircle, CircleCheck, CircleAlert, Blocks } from "lucide-react";
import type { Account, Farm, ModelStatus, PlantingPlan, Plot } from "../types";
export type BusinessView = "plan" | "records" | "results" | "farms" | "evaluation" | "capabilities";
interface Props {
 disabled:boolean; onWorkspaceChanged:()=>Promise<void>;
 account: Account; farms: Array<Farm & { plots: Plot[] }>; activePlotId: string; model: ModelStatus; plan: PlantingPlan | null;
 conversations: Array<{id:string;title:string;status?:string;preview?:string}>; activeConversationId:string|null; mobileOpen:boolean;
   onNewChat:()=>void;onSelectConversation:(id:string)=>void;onSelectPlot:(id:string)=>void;onEditFarm:(id:string)=>void;onOpenBusiness:(v:BusinessView)=>void;onClose:()=>void;
}
export function AssistantSidebar(p:Props){
 const [query,setQuery]=useState("");const [search,setSearch]=useState(false);const [collapsed,setCollapsed]=useState<string[]>([]);
 const toggle=(id:string)=>setCollapsed(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
 const projects=p.farms.map(f=>({...f,plots:f.plots.filter(x=>`${f.name}${x.name}`.includes(query))})).filter(f=>!query || f.name.includes(query) || f.plots.length);
 const [menu,setMenu]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[deleteError,setDeleteError]=useState('');
 const [removing,setRemoving]=useState<{kind:'farms'|'plots';id:string;name:string;count:number}|null>(null);
 useEffect(()=>{
   const close=(e:PointerEvent)=>{if(!(e.target instanceof Element)||!e.target.closest('[data-sidebar-actions]'))setMenu(null)};
   const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(null);setRemoving(null)}};
   document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
   return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape)};
 },[]);
 const pin=async(farm:Props['farms'][number])=>{
   if(busy||p.disabled)return;setBusy(true);setError('');
   try{const response=await fetch('/api/farms/'+encodeURIComponent(farm.id)+'/pin',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({isPinned:!farm.isPinned})});if(!response.ok)throw new Error((await response.json()).message||'置顶失败');await p.onWorkspaceChanged();setMenu(null);}
   catch(e){setError(e instanceof Error?e.message:'置顶失败，请重试')}finally{setBusy(false)}
 };
 const remove=async()=>{
   if(!removing||busy)return;
   setBusy(true);setError('');setDeleteError('');
   try{
     await manageFarm(removing.kind,removing.id,'DELETE');
   }catch(e){
     const message=e instanceof Error?e.message:'删除失败，请重试';
     setDeleteError(message);setError(message);
     setBusy(false);
     return;
   }
   setRemoving(null);
   try{await p.onWorkspaceChanged();}
   catch(e){setError(`删除已完成，但工作区同步失败${e instanceof Error?`：${e.message}`:'，请重新打开页面。'}`)}
   finally{setBusy(false)}
 };
 const confirmation=(id:string)=>removing?.id===id&&<div className="sidebar-delete-confirm" role="alert" aria-busy={busy}><strong>删除“{removing.name}”？</strong><p>{removing.kind==='farms'?'基地及其 '+removing.count+' 个地块将从工作区移除。':''}历史对话、方案和记录保留，可在基地管理中恢复。</p>{deleteError&&<p className="sidebar-delete-error" role="alert">{deleteError}</p>}<div><button type="button" disabled={busy} onClick={()=>{setRemoving(null);setDeleteError('')}}>取消</button><button type="button" disabled={busy} onClick={()=>void remove()}>{busy?'删除中…':'确认删除'}</button></div></div>;
 const actions=(kind:'farms'|'plots',id:string,name:string,farm?:Props['farms'][number])=><div className="sidebar-item-actions" data-sidebar-actions><button type="button" className="sidebar-more-button" aria-label={(kind==='farms'?'基地操作 ':'地块操作 ')+name} aria-expanded={menu===id} disabled={busy} onClick={()=>{setMenu(menu===id?null:id);setError('');setDeleteError('');setRemoving(null)}}><MoreHorizontal size={16}/></button>{menu===id&&<div className="sidebar-item-menu">{farm&&<><button type="button" disabled={busy||p.disabled} onClick={()=>{setMenu(null);p.onEditFarm(id)}}><PencilLine size={14}/>编辑基地</button><button type="button" disabled={busy||p.disabled} onClick={()=>void pin(farm)}>{farm.isPinned?<PinOff size={14}/>:<Pin size={14}/>} {farm.isPinned?'取消置顶':'置顶基地'}</button></>}<button type="button" disabled={busy} onClick={()=>{setMenu(null);setDeleteError('');setRemoving({kind,id,name,count:farm?.plots.length??0})}}><Trash2 size={14}/>删除{kind==='farms'?'基地':'地块'}</button></div>}</div>;
 const project=(farm:Props['farms'][number])=><div className="sidebar-farm" key={farm.id} data-farm-id={farm.id}><div className="sidebar-farm-heading"><button className="project-heading" onClick={()=>toggle(farm.id)} aria-expanded={!collapsed.includes(farm.id)}><ChevronRight size={14} className={!collapsed.includes(farm.id)?"is-expanded":""}/><Folder size={16}/><span>{farm.name}</span><small>{farm.plots.reduce((n,x)=>n+x.areaMu,0)} 亩</small></button>{actions('farms',farm.id,farm.name,p.farms.find(f=>f.id===farm.id))}</div>{confirmation(farm.id)}{!collapsed.includes(farm.id)&&farm.plots.map(plot=><div className="sidebar-plot-item" key={plot.id}><div className="sidebar-plot-row"><button className={`sidebar-plot-link ${p.activePlotId===plot.id?'is-active':''}`} aria-current={p.activePlotId===plot.id?'page':undefined} onClick={()=>{p.onSelectPlot(plot.id);p.onClose()}}><span className="plot-status-mark"/><span><strong>{plot.name}</strong><small>{plot.areaMu} 亩 · {plot.rotation}</small></span></button>{actions('plots',plot.id,plot.name)}</div>{confirmation(plot.id)}</div>)}</div>;
 return <><button className={`assistant-sidebar-scrim ${p.mobileOpen?'is-visible':''}`} aria-label="关闭侧栏" onClick={p.onClose}/><aside className={`assistant-sidebar ${p.mobileOpen?'is-open':''}`} aria-label="耕策导航">
 <div className="sidebar-product"><strong>耕策<span>农业工作台</span></strong><button className="assistant-icon-button" aria-label="搜索地块与任务" onClick={()=>setSearch(!search)}><Search size={16}/></button><button className="sidebar-mobile-close" aria-label="关闭侧栏" onClick={p.onClose}><PanelLeftClose size={16}/></button></div>
 {search&&<label className="sidebar-search"><Search size={14}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索地块或任务" aria-label="搜索地块或任务"/></label>}
 <nav className="sidebar-primary"><button className="new-chat-button" onClick={p.onNewChat}><Plus size={16}/><span>新任务</span><kbd>Ctrl N</kbd></button><button onClick={()=>p.onOpenBusiness('plan')}><ClipboardList size={16}/>种植方案</button><button onClick={()=>p.onOpenBusiness('records')}><MessageSquare size={16}/>农事记录</button><button onClick={()=>p.onOpenBusiness('results')}><ChartNoAxesCombined size={16}/>结果复盘</button></nav>
 <div className="assistant-sidebar-scroll">{error&&<p className="sidebar-action-error" role="alert">{error}</p>}<section data-farm-group="pinned"><div className="sidebar-caption"><span>置顶基地</span><Pin size={12}/></div>{projects.filter(f=>f.isPinned).map(project)}{!projects.some(f=>f.isPinned)&&<p className="sidebar-empty">在基地右侧菜单中置顶</p>}</section><section data-farm-group="regular"><div className="sidebar-caption"><span>基地</span><button onClick={()=>p.onOpenBusiness('farms')} aria-label="管理基地"><Plus size={14}/></button></div>{projects.filter(f=>!f.isPinned).map(project)}{!projects.length&&<p className="sidebar-empty">没有匹配的地块</p>}</section>
 <section className="sidebar-conversation-section"><button className="sidebar-caption task-section-toggle" onClick={()=>toggle('tasks')} aria-expanded={!collapsed.includes('tasks')}><span>最近对话</span><ChevronDown size={14}/></button>{!collapsed.includes('tasks')&&<div className="conversation-list">{p.conversations.filter(x=>x.title.includes(query)).map(c=><button className={`conversation-link ${p.activeConversationId===c.id?'is-active':''}`} key={c.id} onClick={()=>{p.onSelectConversation(c.id);p.onClose()}}>{c.status==='running'?<LoaderCircle size={16} className="is-spinning"/>:c.status==='error'?<CircleAlert size={16}/>:<CircleCheck size={16}/>}<span><strong>{c.title}</strong><small>{c.status==='running'?'正在执行':c.status==='error'?'执行失败，可重新发起':(c.preview || '已保存 · 点击继续查看')}</small></span></button>)}{!p.conversations.length&&<p className="sidebar-empty">对话会自动保存在这里</p>}</div>}</section></div>
 <div className="assistant-sidebar-footer"><button className="evaluation-link" onClick={()=>p.onOpenBusiness('capabilities')}><Blocks size={16}/>能力中心<ChevronRight size={14}/></button><button className="evaluation-link" onClick={()=>p.onOpenBusiness('evaluation')}><FlaskConical size={16}/>运行与评估<ChevronRight size={14}/></button><button className="account-compact" onClick={()=>p.onOpenBusiness('farms')}><span className="account-compact-avatar">{p.account.ownerName.slice(0,1)}</span><span><strong>{p.account.name}</strong><small>{p.model.configured?'农业智能决策':'本地演示 · 规则模式'}</small></span><ChevronDown size={14}/></button></div><div className="sidebar-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" tabIndex={0} onKeyDown={e=>{if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;e.preventDefault();const w=parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"))||300;document.documentElement.style.setProperty("--sidebar-width",`${Math.max(240,Math.min(520,w+(e.key==="ArrowRight"?16:-16)))}px`)}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))document.documentElement.style.setProperty("--sidebar-width",`${Math.max(240,Math.min(520,e.clientX))}px`)}} onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)}/></aside></>;
}
