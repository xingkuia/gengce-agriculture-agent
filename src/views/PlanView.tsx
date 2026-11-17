import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Droplets,
  FileDown,
  FlaskConical,
  Info,
  MapPin,
  ShieldCheck,
  Wheat
} from "lucide-react";
import type { Farm, PlantingPlan, Plot, Recommendation } from "../types";

interface PlanViewProps {
  plan: PlantingPlan;
  recommendation: Recommendation | null;
  plot: Plot;
  farm: Farm;
  onGoDecision: () => void;
  onGoRecords: () => void;
}

export function PlanView({
  plan,
  recommendation,
  plot,
  farm,
  onGoDecision,
  onGoRecords
}: PlanViewProps) {
  const criticalTasks = plan.plan.tasks.filter((task) => task.priority === "critical");
  const today = new Date();
  const totalDays = 210;

  return (
    <div className="view plan-view">
      <header className="view-heading-row">
        <div>
          <div className="view-kicker">
            <span className={`plan-status status-${plan.status}`}>{planStatusLabel(plan.status)}</span>
            <span>{plan.season}</span>
          </div>
          <h2>{plot.name} · {plan.cropName}种植方案</h2>
          <p>{plan.plan.summary}</p>
        </div>
        <div className="view-actions">
          <button className="secondary-button" type="button" onClick={() => window.print()}>
            <FileDown size={15} />
            打印方案
          </button>
          <button className="primary-button compact" type="button" onClick={onGoRecords}>
            记录农事
            <ArrowRight size={15} />
          </button>
        </div>
      </header>

      <section className="plan-overview-strip">
        <div>
          <MapPin size={16} />
          <span>执行地块</span>
          <strong>{farm.district} · {plot.areaMu} 亩</strong>
        </div>
        <div>
          <CalendarDays size={16} />
          <span>方案开始</span>
          <strong>{plan.startDate}</strong>
        </div>
        <div>
          <CheckCircle2 size={16} />
          <span>关键作业</span>
          <strong>{criticalTasks.length} 项不可延误</strong>
        </div>
        <div>
          <ShieldCheck size={16} />
          <span>校验状态</span>
          <strong>证据与数值已复核</strong>
        </div>
      </section>

      <div className="plan-content-grid">
        <main className="plan-main">
          <section className="plan-timeline-section">
            <div className="section-heading compact-heading">
              <div>
                <h2>执行日程</h2>
                <p>每一行都可以在“农事记录”中对应到实际完成情况。</p>
              </div>
              <span className="task-count">{plan.plan.tasks.length} 项作业</span>
            </div>
            <div className="stage-ruler" aria-hidden="true">
              <span>播前</span>
              <span>播种</span>
              <span>苗期</span>
              <span>中后期</span>
              <span>收获</span>
            </div>
            <div className="plan-task-list">
              {plan.plan.tasks.map((task, index) => {
                const progress = Math.min(
                  100,
                  Math.max(
                    4,
                    ((today.getTime() - new Date(plan.startDate).getTime()) / (totalDays * 86_400_000)) *
                      100 +
                      index * 2
                  )
                );
                return (
                  <article className="plan-task-row" key={task.id}>
                    <div className="task-marker">
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      {index < plan.plan.tasks.length - 1 && <i />}
                    </div>
                    <div className="task-phase">
                      <span>{task.phase}</span>
                      <small>{task.dateWindow}</small>
                    </div>
                    <div className="task-content">
                      <div>
                        <h3>{task.title}</h3>
                        {task.priority === "critical" && <span className="priority-tag">关键窗口</span>}
                      </div>
                      <p>{task.method}</p>
                      <div className="task-meta">
                        <span>用量 / 标准</span>
                        <strong>{task.quantity}</strong>
                      </div>
                    </div>
                    <div className="task-progress" title={`时间进度示意 ${Math.round(progress)}%`}>
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </main>

        <aside className="plan-side">
          <section className="plan-side-section">
            <div className="side-title">
              <Wheat size={16} />
              <h3>方案依据</h3>
            </div>
            <ul className="reason-list">
              {plan.plan.decisionReasons.map((reason) => (
                <li key={reason}><CheckCircle2 size={14} />{reason}</li>
              ))}
            </ul>
          </section>

          <section className="plan-side-section">
            <div className="side-title">
              <FlaskConical size={16} />
              <h3>施肥框架</h3>
            </div>
            <ul className="plain-list">
              {plan.plan.inputPlan.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="inline-notice"><Info size={13} />具体用量必须在播前按测土配方复核。</p>
          </section>

          <section className="plan-side-section">
            <div className="side-title">
              <Droplets size={16} />
              <h3>水分与监测</h3>
            </div>
            <ul className="plain-list">
              {plan.plan.waterPlan.slice(0, 2).map((item) => <li key={item}>{item}</li>)}
              {plan.plan.monitoring.slice(0, 2).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="plan-evidence-block">
            <span>证据来源</span>
            {plan.plan.evidence.map((source) => (
              <p key={source}><ShieldCheck size={13} />{source}</p>
            ))}
            {recommendation && (
              <button className="text-button" type="button" onClick={onGoDecision}>
                返回候选比较
                <ArrowRight size={14} />
              </button>
            )}
          </section>
        </aside>
      </div>

      <button className="mobile-sticky-action" type="button" onClick={onGoRecords}>
        <ClipboardList size={17} />
        去记录一条农事
      </button>
    </div>
  );
}

function planStatusLabel(status: PlantingPlan["status"]): string {
  return {
    draft: "草案",
    active: "执行中",
    completed: "已完成",
    archived: "已归档"
  }[status];
}
