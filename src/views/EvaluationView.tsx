import {
  Activity,
  BadgeCheck,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  DatabaseZap,
  GitBranch,
  Network,
  RefreshCw,
  ShieldCheck,
  Workflow
} from "lucide-react";
import { formatDateTime } from "../lib/format";
import type { AgentSkillDefinition, EvaluationSummary, ModelStatus } from "../types";

interface EvaluationViewProps {
  evaluations: EvaluationSummary[];
  skills: AgentSkillDefinition[];
  model: ModelStatus;
}

export function EvaluationView({ evaluations, skills, model }: EvaluationViewProps) {
  return (
    <div className="view evaluation-view">
      <header className="view-heading-row">
        <div>
          <div className="view-kicker"><span>Mastra Runtime</span><span>专业 Agent 与 Workflow 编排</span></div>
          <h2>Agent 质量与版本评估</h2>
          <p>生成、执行和校验分开；数值由代码复核，修复循环有预算，版本发布依赖固定回归集。</p>
        </div>
        <div className="runtime-status">
          <span className="status-light" />
          <div><strong>Runtime healthy</strong><small>{model.note}</small></div>
        </div>
      </header>

      <section className="loop-architecture">
        <div className="architecture-heading">
          <div>
            <h2>自循环执行链</h2>
            <p>每次运行都持久化事件与结构化产物，可以回放、比对和失败重试。</p>
          </div>
          <span className="plain-tag">Max repair 2 rounds</span>
        </div>
        <div className="architecture-steps">
          {[
            ["PLAN", "任务编排", "解析目标，生成 DAG", Workflow],
            ["EXECUTE", "专家执行", "工具与 A2A 产物", Network],
            ["VERIFY", "独立校验", "数值、季节、证据", ShieldCheck],
            ["DIAGNOSE", "问题诊断", "定位可修复缺口", Activity],
            ["REPAIR", "局部修复", "不重做全部结论", RefreshCw]
          ].map(([code, title, detail, Icon], index) => {
            const StepIcon = Icon as typeof Workflow;
            return (
              <div className="architecture-step" key={String(code)}>
                <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
                <StepIcon size={18} />
                <strong>{String(title)}</strong>
                <small>{String(detail)}</small>
                {index < 4 && <i />}
              </div>
            );
          })}
        </div>
      </section>

      <div className="evaluation-grid">
        <section className="evaluation-suite">
          <div className="section-heading compact-heading">
            <div>
              <h2>回归评估集</h2>
              <p>每次 Skill 或规则版本变化，先在固定案例上回放。</p>
            </div>
            <span className="verified-badge"><ClipboardCheck size={15} />Gate 已通过</span>
          </div>
          {evaluations.map((evaluation) => (
            <article className="evaluation-run" key={evaluation.id}>
              <div className="evaluation-run-head">
                <div>
                  <span className="eval-status"><BadgeCheck size={15} />{evaluation.status.toUpperCase()}</span>
                  <h3>{evaluation.suiteName}</h3>
                  <p>{evaluation.agentVersion} · {evaluation.cases} 个案例 · {formatDateTime(evaluation.ranAt)}</p>
                </div>
                <div className="pass-rate">
                  <strong>{Math.round(evaluation.passRate * 100)}%</strong>
                  <span>综合通过率</span>
                </div>
              </div>
              <div className="metric-table">
                {evaluation.metrics.map((metric) => (
                  <div key={metric.name}>
                    <span>{metric.passed ? <CheckCircle2 size={14} /> : <RefreshCw size={14} />}</span>
                    <strong>{metric.name}</strong>
                    <span>{metric.value}</span>
                    <small>目标 {metric.target}</small>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>

        <aside className="evaluation-principles">
          <div className="side-title"><GitBranch size={16} /><h3>发布门禁</h3></div>
          <ol className="gate-list">
            <li><span>01</span><div><strong>收集反馈</strong><p>结果、评分与异常进入候选改进集。</p></div></li>
            <li><span>02</span><div><strong>固定集回放</strong><p>不适播、单位、轮作与数值案例全部重跑。</p></div></li>
            <li><span>03</span><div><strong>质量门禁</strong><p>通过率低于阈值则不发布或自动回滚。</p></div></li>
            <li><span>04</span><div><strong>版本记录</strong><p>每次发布可追溯到 Skill、规则与模型。</p></div></li>
          </ol>
          <div className="principles-note"><DatabaseZap size={16} /><p>评估只用于版本门禁；用户田间数据不会直接用于训练。</p></div>
        </aside>
      </div>

      <section className="skill-registry">
        <div className="section-heading compact-heading">
          <div>
            <h2>Skill Registry</h2>
            <p>每个 Agent 的输入、输出、工具和模型角色都显式声明。</p>
          </div>
          <span className="task-count">{skills.length} 个 Skill</span>
        </div>
        <div className="skill-grid">
          {skills.map((skill) => (
            <article className="skill-card" key={skill.id}>
              <div className="skill-card-head">
                <span className={`skill-role role-${skill.modelRole}`}><Bot size={14} /></span>
                <span>{skill.id}</span>
                <small>v{skill.version}</small>
              </div>
              <h3>{skill.name}</h3>
              <p>{skill.description}</p>
              <div className="skill-contract">
                <span>{skill.inputContract}</span>
                <i>→</i>
                <span>{skill.outputContract}</span>
              </div>
              <div className="tool-tags">
                {skill.tools.map((tool) => <span key={tool}>{tool}</span>)}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
