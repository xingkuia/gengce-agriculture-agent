import {
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  ClipboardList,
  Clock3,
  Coins,
  Plus,
  RotateCcw,
  X
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { addOperation, updateOperation } from "../lib/api";
import { formatCurrency, formatDate } from "../lib/format";
import type { OperationRecord, PlantingPlan } from "../types";

interface RecordsViewProps {
  plan: PlantingPlan | null;
  operations: OperationRecord[];
  onChanged: () => Promise<void>;
  onGoPlan: () => void;
}

export function RecordsView({ plan, operations, onChanged, onGoPlan }: RecordsViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    type: "田间巡査",
    title: "",
    date: new Date().toISOString().slice(0, 10),
    notes: "",
    cost: "",
    status: "done" as "planned" | "done" | "skipped"
  });

  if (!plan) {
    return (
      <div className="view">
        <div className="empty-state standalone">
          <ClipboardList size={26} />
          <h2>先选择一套种植方案</h2>
          <p>农事记录必须挂在具体方案上，才能核算投入并回收到下一轮决策。</p>
          <button className="primary-button compact" type="button" onClick={onGoPlan}>
            查看种植方案
          </button>
        </div>
      </div>
    );
  }

  const completed = operations.filter((record) => record.status === "done");
  const planned = operations.filter((record) => record.status === "planned");
  const costTotal = operations.reduce((sum, record) => sum + record.cost, 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setError("请填写作业名称。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await addOperation(plan.id, {
        type: form.type,
        title: form.title.trim(),
        plannedDate: form.date,
        actualDate: form.date,
        status: form.status,
        notes: form.notes.trim(),
        cost: Number(form.cost || 0)
      });
      setForm((current) => ({ ...current, title: "", notes: "", cost: "" }));
      setShowForm(false);
      await onChanged();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "记录保存失败");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (record: OperationRecord, status: "done" | "skipped" | "planned") => {
    setError("");
    try {
      await updateOperation(record.id, {
        status,
        actualDate: status === "planned" ? undefined : new Date().toISOString().slice(0, 10),
        notes: record.notes
      });
      await onChanged();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "状态更新失败");
    }
  };

  return (
    <div className="view records-view">
      <header className="view-heading-row">
        <div>
          <div className="view-kicker">
            <span className="plan-status status-active">执行中</span>
            <span>{plan.cropName} · {plan.season}</span>
          </div>
          <h2>农事执行记录</h2>
          <p>计划与实际的差异会进入结果复盘，而不是只停留在一次性的建议里。</p>
        </div>
        <button className="primary-button compact" type="button" onClick={() => setShowForm((value) => !value)}>
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? "收起表单" : "新增农事记录"}
        </button>
      </header>

      <section className="record-stats">
        <div>
          <CheckCircle2 size={17} />
          <span>已完成</span>
          <strong>{completed.length} 项</strong>
        </div>
        <div>
          <Clock3 size={17} />
          <span>待执行</span>
          <strong>{planned.length} 项</strong>
        </div>
        <div>
          <Coins size={17} />
          <span>记录成本</span>
          <strong>{formatCurrency(costTotal)}</strong>
        </div>
        <div>
          <CalendarDays size={17} />
          <span>当前方案</span>
          <strong>{plan.startDate} 起</strong>
        </div>
      </section>

      {showForm && (
        <form className="inline-record-form" onSubmit={submit}>
          <div className="form-intro">
            <h3>新增农事记录</h3>
            <p>记录实际发生了什么。计划窗口可在“种植方案”中查看。</p>
          </div>
          <label>
            <span>作业类型</span>
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              <option>田间巡查</option>
              <option>整地</option>
              <option>播种</option>
              <option>施肥</option>
              <option>灌溉</option>
              <option>病虫防治</option>
              <option>收获</option>
              <option>其他</option>
            </select>
          </label>
          <label className="wide-field">
            <span>作业名称</span>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="例如：雨前清理东侧排水沟"
            />
          </label>
          <label>
            <span>日期</span>
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </label>
          <label>
            <span>状态</span>
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value as typeof form.status })}
            >
              <option value="done">已完成</option>
              <option value="planned">待执行</option>
              <option value="skipped">已跳过</option>
            </select>
          </label>
          <label>
            <span>成本（元）</span>
            <input
              type="number"
              min="0"
              value={form.cost}
              onChange={(event) => setForm({ ...form, cost: event.target.value })}
              placeholder="0"
            />
          </label>
          <label className="full-field">
            <span>现场说明</span>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="记录用量、天气、作业质量或异常情况"
            />
          </label>
          {error && <p className="inline-error form-full">{error}</p>}
          <div className="form-actions form-full">
            <button className="secondary-button" type="button" onClick={() => setShowForm(false)}>取消</button>
            <button className="primary-button compact" type="submit" disabled={saving}>
              {saving ? <span className="button-spinner" /> : <Check size={15} />}
              保存记录
            </button>
          </div>
        </form>
      )}

      <section className="record-ledger">
        <div className="section-heading compact-heading">
          <div>
            <h2>作业台账</h2>
            <p>按日期排列的实际记录和待办事项。</p>
          </div>
          <span className="task-count">{operations.length} 条记录</span>
        </div>
        <div className="record-table" role="table" aria-label="农事作业台账">
          <div className="record-table-head" role="row">
            <span>状态</span>
            <span>日期</span>
            <span>作业内容</span>
            <span>类型</span>
            <span>成本</span>
            <span>操作</span>
          </div>
          {operations.map((record) => (
            <div className={`record-table-row row-${record.status}`} role="row" key={record.id}>
              <span className="record-status" role="cell">
                {record.status === "done" ? <CheckCircle2 size={17} /> : record.status === "skipped" ? <X size={17} /> : <Circle size={17} />}
                {record.status === "done" ? "完成" : record.status === "skipped" ? "跳过" : "待办"}
              </span>
              <span role="cell">
                <strong>{formatDate(record.actualDate ?? record.plannedDate)}</strong>
                <small>{record.actualDate ? "实际" : "计划"}</small>
              </span>
              <span className="record-main-cell" role="cell">
                <strong>{record.title}</strong>
                <small>{record.notes || "暂无现场说明"}</small>
              </span>
              <span role="cell"><span className="plain-tag">{record.type}</span></span>
              <span className="tabular" role="cell">{formatCurrency(record.cost)}</span>
              <span className="record-actions" role="cell">
                {record.status !== "done" && (
                  <button className="mini-action" type="button" onClick={() => changeStatus(record, "done")}>
                    <Check size={13} />完成
                  </button>
                )}
                {record.status !== "planned" && (
                  <button className="mini-action" type="button" onClick={() => changeStatus(record, "planned")}>
                    <RotateCcw size={13} />撤回
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
        {error && !showForm && <p className="inline-error">{error}</p>}
      </section>
    </div>
  );
}
