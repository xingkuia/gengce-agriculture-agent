import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Info,
  MessageSquareText,
  Sprout,
  Star,
  TrendingUp
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { submitFeedback, submitOutcome } from "../lib/api";
import { formatCurrency, formatDate, formatNumber } from "../lib/format";
import type {
  FeedbackRecord,
  OutcomeRecord,
  PlantingPlan,
  Plot,
  Recommendation
} from "../types";

interface ResultsViewProps {
  plan: PlantingPlan | null;
  recommendation: Recommendation | null;
  plot: Plot;
  outcomes: OutcomeRecord[];
  feedback: FeedbackRecord[];
  onChanged: () => Promise<void>;
  onGoRecords: () => void;
}

export function ResultsView({
  plan,
  recommendation,
  plot,
  outcomes,
  feedback,
  onChanged,
  onGoRecords
}: ResultsViewProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [rating, setRating] = useState(4);
  const currentOutcome = plan ? outcomes.find((outcome) => outcome.planId === plan.id) ?? null : null;
  const currentFeedback = currentOutcome
    ? feedback.find((item) => item.outcomeId === currentOutcome.id) ?? null
    : null;
  const [form, setForm] = useState({
    yieldKg: "",
    quality: "",
    revenue: "",
    cost: "",
    notes: "",
    comment: ""
  });

  useEffect(() => {
    if (!recommendation || !plan) return;
    setForm((current) => ({
      ...current,
      yieldKg: current.yieldKg || String(Math.round(recommendation.economics.yieldPerMu * plot.areaMu)),
      revenue: current.revenue || String(recommendation.economics.revenueTotal),
      cost: current.cost || String(recommendation.economics.costTotal)
    }));
  }, [plan, plot.areaMu, recommendation]);

  if (!plan) {
    return (
      <div className="view">
        <div className="empty-state standalone">
          <BarChart3 size={26} />
          <h2>暂无可复盘方案</h2>
          <p>先建立一套种植方案并记录农事，收获后就能把实际产量、成本与反馈写回系统。</p>
        </div>
      </div>
    );
  }

  const expectedYield = recommendation ? recommendation.economics.yieldPerMu * plot.areaMu : null;
  const expectedMargin = recommendation?.economics.marginTotal ?? null;
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const yieldKg = Number(form.yieldKg);
    const revenue = Number(form.revenue);
    const cost = Number(form.cost);
    if (!Number.isFinite(yieldKg) || yieldKg <= 0 || !Number.isFinite(revenue) || revenue < 0 || !Number.isFinite(cost) || cost < 0) {
      setError("请填写有效的实际产量、收入和成本。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const outcome = await submitOutcome(plan.id, {
        yieldKg,
        quality: form.quality,
        revenue,
        cost,
        notes: form.notes
      });
      await submitFeedback(plan.id, {
        outcomeId: outcome.id,
        rating,
        comment: form.comment
      });
      setSaved(true);
      await onChanged();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "结果保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="view results-view">
      <header className="view-heading-row">
        <div>
          <div className="view-kicker">
            <span className={`plan-status status-${plan.status}`}>{plan.status === "completed" ? "已归档" : "执行中"}</span>
            <span>{plan.cropName} · {plan.season}</span>
          </div>
          <h2>结果复盘与反馈闭环</h2>
          <p>实际产量、成本和质量反馈会作为下一轮方案的证据，不只用估算结果做复盘。</p>
        </div>
        <button className="secondary-button" type="button" onClick={onGoRecords}>
          <ClipboardCheck size={15} />
          查看农事台账
        </button>
      </header>

      <section className="loop-strip" aria-label="业务闭环状态">
        <div className="loop-step is-done"><CheckCircle2 size={16} /><span>方案已建立</span></div>
        <i />
        <div className="loop-step is-done"><CheckCircle2 size={16} /><span>农事有台账</span></div>
        <i />
        <div className={`loop-step ${currentOutcome ? "is-done" : "is-current"}`}><BarChart3 size={16} /><span>实收有对比</span></div>
        <i />
        <div className={`loop-step ${currentFeedback ? "is-done" : ""}`}><MessageSquareText size={16} /><span>反馈回写</span></div>
      </section>

      <div className="results-grid">
        <main>
          {currentOutcome ? (
            <section className="outcome-summary">
              <div className="section-heading compact-heading">
                <div>
                  <h2>本季实收结果</h2>
                  <p>结果已写入地块历史，可用于下一次方案比较。</p>
                </div>
                <span className="verified-badge"><BadgeCheck size={15} />已归档</span>
              </div>
              <div className="outcome-metrics">
                <div>
                  <span>实际总产量</span>
                  <strong>{formatNumber(currentOutcome.yieldKg)} kg</strong>
                  <small>{formatNumber(currentOutcome.yieldPerMu, 1)} kg/亩</small>
                </div>
                <div>
                  <span>实际净收益</span>
                  <strong>{formatCurrency(currentOutcome.margin)}</strong>
                  <small>收入减现金成本</small>
                </div>
                <div>
                  <span>品质记录</span>
                  <strong>{currentOutcome.quality}</strong>
                  <small>来自用户实测</small>
                </div>
              </div>
              <div className="outcome-comparison">
                <h3>估算与实际</h3>
                <ComparisonBar
                  label="总产量"
                  expected={expectedYield ? `${formatNumber(expectedYield)} kg` : "无估算"}
                  actual={`${formatNumber(currentOutcome.yieldKg)} kg`}
                  ratio={expectedYield ? Math.min(1.15, currentOutcome.yieldKg / expectedYield) : 0.8}
                />
                <ComparisonBar
                  label="净收益"
                  expected={expectedMargin !== null ? formatCurrency(expectedMargin) : "无估算"}
                  actual={formatCurrency(currentOutcome.margin)}
                  ratio={expectedMargin ? Math.max(0.05, Math.min(1.15, currentOutcome.margin / expectedMargin)) : 0.8}
                />
              </div>
              <p className="result-note"><Info size={14} />{currentOutcome.notes || "暂无现场复盘说明。"}</p>
              {currentFeedback && (
                <div className="saved-feedback">
                  <div>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <Star key={value} size={16} className={value <= currentFeedback.rating ? "is-filled" : ""} />
                    ))}
                  </div>
                  <p>{currentFeedback.comment || "已记录评分。"}</p>
                </div>
              )}
            </section>
          ) : (
            <form className="outcome-form" onSubmit={handleSubmit}>
              <div className="section-heading compact-heading">
                <div>
                  <h2>登记收获结果</h2>
                  <p>成本请填本季新增的现金投入；地租和融资成本可在说明中补充。</p>
                </div>
                <TrendingUp size={20} />
              </div>
              <div className="form-grid">
                <label>
                  <span>实际总产量（kg）</span>
                  <input
                    type="number"
                    min="0"
                    value={form.yieldKg}
                    onChange={(event) => setForm({ ...form, yieldKg: event.target.value })}
                    placeholder={expectedYield ? `估算 ${Math.round(expectedYield)}` : "请输入"}
                  />
                </label>
                <label>
                  <span>实际总收入（元）</span>
                  <input
                    type="number"
                    min="0"
                    value={form.revenue}
                    onChange={(event) => setForm({ ...form, revenue: event.target.value })}
                    placeholder={recommendation ? `估算 ${recommendation.economics.revenueTotal}` : "请输入"}
                  />
                </label>
                <label>
                  <span>实际现金成本（元）</span>
                  <input
                    type="number"
                    min="0"
                    value={form.cost}
                    onChange={(event) => setForm({ ...form, cost: event.target.value })}
                    placeholder={recommendation ? `估算 ${recommendation.economics.costTotal}` : "请输入"}
                  />
                </label>
                <label>
                  <span>品质 / 水分 / 等级</span>
                  <input
                    value={form.quality}
                    onChange={(event) => setForm({ ...form, quality: event.target.value })}
                    placeholder="例如：二等，水分 13.5%"
                  />
                </label>
                <label className="form-full">
                  <span>异常与复盘说明</span>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                    placeholder="记录天气、病虫害、作业差异或实际产量偏差"
                  />
                </label>
              </div>
              <div className="feedback-field">
                <div>
                  <span>这轮指导是否有帮助？</span>
                  <div className="star-picker" aria-label="方案评分">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        type="button"
                        key={value}
                        className={value <= rating ? "is-filled" : ""}
                        onClick={() => setRating(value)}
                        aria-label={`${value} 星`}
                      >
                        <Star size={19} />
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  <span>补充反馈</span>
                  <input
                    value={form.comment}
                    onChange={(event) => setForm({ ...form, comment: event.target.value })}
                    placeholder="哪条建议最有用，或哪里需要改进"
                  />
                </label>
              </div>
              {error && <p className="inline-error">{error}</p>}
              {saved && <p className="inline-success"><CheckCircle2 size={14} />结果已保存，反馈已进入下一轮评估队列。</p>}
              <div className="form-actions">
                <span className="estimate-note"><Info size={13} />保存后本季方案将变为“已完成”。</span>
                <button className="primary-button compact" type="submit" disabled={saving}>
                  {saving ? <span className="button-spinner" /> : <CheckCircle2 size={15} />}
                  保存结果并反馈
                </button>
              </div>
            </form>
          )}
        </main>

        <aside className="history-column">
          <div className="side-title">
            <CircleDollarSign size={16} />
            <h3>地块历史结果</h3>
          </div>
          {outcomes.length ? (
            outcomes.map((outcome) => (
              <article className="history-outcome" key={outcome.id}>
                <div>
                  <Sprout size={16} />
                  <strong>{outcome.cropName}</strong>
                  <span>{formatDate(outcome.createdAt, true)}</span>
                </div>
                <dl>
                  <div><dt>亩产</dt><dd>{formatNumber(outcome.yieldPerMu, 1)} kg</dd></div>
                  <div><dt>净收益</dt><dd>{formatCurrency(outcome.margin)}</dd></div>
                  <div><dt>品质</dt><dd>{outcome.quality}</dd></div>
                </dl>
              </article>
            ))
          ) : (
            <p className="history-empty">完成第一季收获后，历史对比会出现在这里。</p>
          )}
          <button className="text-button history-link" type="button" onClick={onGoRecords}>
            查看完整农事台账
            <ArrowRight size={14} />
          </button>
        </aside>
      </div>
    </div>
  );
}

function ComparisonBar({
  label,
  expected,
  actual,
  ratio
}: {
  label: string;
  expected: string;
  actual: string;
  ratio: number;
}) {
  return (
    <div className="comparison-row">
      <span>{label}</span>
      <div>
        <i className="expected-bar" />
        <i className="actual-bar" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <strong>{actual}</strong>
      <small>估算 {expected}</small>
    </div>
  );
}
