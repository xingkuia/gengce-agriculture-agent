import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  CircleAlert,
  CloudRain,
  Droplets,
  Gauge,
  Info,
  MapPin,
  SlidersHorizontal,
  Sparkles,
  Sprout,
  ThermometerSun,
  Waves,
  Wheat,
  Wind
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { formatCurrency, formatNumber } from "../lib/format";
import type {
  CropCode,
  Farm,
  GoalKey,
  Plot,
  PlotContext,
  Recommendation,
  RunOverrides
} from "../types";

interface DecisionViewProps {
  plot: Plot;
  farm: Farm;
  context: PlotContext;
  recommendations: Recommendation[];
  goal: GoalKey;
  selectedRecommendationId: string | null;
  running: boolean;
  onGoalChange: (goal: GoalKey) => void;
  onSelectRecommendation: (recommendationId: string) => void;
  onGenerate: (message: string, goal: GoalKey, overrides: RunOverrides) => void;
  onChoosePlan: (recommendationId: string) => void;
}

const goals: Array<{ key: GoalKey; label: string; helper: string }> = [
  { key: "profit", label: "稳健收益", helper: "先看现金回报" },
  { key: "low_risk", label: "低风险", helper: "减少波动与失收风险" },
  { key: "labor_saving", label: "省工易管", helper: "适配家庭劳动力" },
  { key: "soil_health", label: "养地轮作", helper: "兼顾下一茬地力" }
];

const cropIcons: Record<CropCode, typeof Wheat> = {
  wheat: Wheat,
  rapeseed: Sprout,
  rice: Waves,
  corn: ThermometerSun,
  soybean: Gauge
};

export function DecisionView({
  plot,
  farm,
  context,
  recommendations,
  goal,
  selectedRecommendationId,
  running,
  onGoalChange,
  onSelectRecommendation,
  onGenerate,
  onChoosePlan
}: DecisionViewProps) {
  const [message, setMessage] = useState("");
  const [showInputs, setShowInputs] = useState(false);
  const [overrides, setOverrides] = useState<RunOverrides>({});
  const [inputError, setInputError] = useState("");

  const sortedRecommendations = useMemo(
    () =>
      [...recommendations].sort(
        (left, right) => right.goalScores[goal] - left.goalScores[goal]
      ),
    [recommendations, goal]
  );
  const selected =
    sortedRecommendations.find((item) => item.id === selectedRecommendationId) ??
    sortedRecommendations[0] ??
    null;
  const weatherRain = context.weather.daily.reduce((sum, day) => sum + day.precipitation, 0);
  const warning = context.weather.warnings[0];

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (running) return;
    for (const value of Object.values(overrides)) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        setInputError("覆盖值必须是大于 0 的数字，或留空使用公开估算。");
        return;
      }
    }
    setInputError("");
    onGenerate(
      message.trim() || `按${goals.find((item) => item.key === goal)?.label}目标生成方案`,
      goal,
      overrides
    );
  };

  const setNumericOverride = (key: keyof RunOverrides, value: string) => {
    setOverrides((current) => ({
      ...current,
      [key]: value === "" ? undefined : Number(value)
    }));
  };

  return (
    <div className="view decision-view">
      <section className="decision-command" aria-labelledby="decision-command-title">
        <div className="command-copy">
          <div className="command-heading-line">
            <Sparkles size={16} aria-hidden="true" />
            <h2 id="decision-command-title">让专家团队比较一版本季方案</h2>
          </div>
          <p>结合 {plot.name} 的位置、天气、土壤、轮作和公开市场数据，分目标给出候选，不替你隐藏取舍。</p>
        </div>
        <form className="command-form" onSubmit={handleSubmit}>
          <div className="command-input-row">
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="例如：家里只有两个劳力，想稳一点"
              aria-label="补充经营目标"
              disabled={running}
            />
            <button className="primary-button" type="submit" disabled={running}>
              {running ? (
                <>
                  <span className="button-spinner" />
                  专家运行中
                </>
              ) : (
                <>
                  生成种植建议
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
          <div className="command-secondary-row">
            <button
              className={`text-button ${showInputs ? "is-active" : ""}`}
              type="button"
              onClick={() => setShowInputs((value) => !value)}
            >
              <SlidersHorizontal size={14} />
              用本地行情覆盖公开估算
            </button>
            <span>湖北规则 · {recommendations.length || 5} 个作物候选 · 独立校验</span>
          </div>
          {showInputs && (
            <div className="override-fields">
              <label>
                <span>当地收购价</span>
                <div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={overrides.pricePerKg ?? ""}
                    onChange={(event) => setNumericOverride("pricePerKg", event.target.value)}
                    placeholder="元/kg"
                  />
                  <small>元/kg</small>
                </div>
              </label>
              <label>
                <span>预期亩产</span>
                <div>
                  <input
                    type="number"
                    min="0"
                    value={overrides.yieldPerMu ?? ""}
                    onChange={(event) => setNumericOverride("yieldPerMu", event.target.value)}
                    placeholder="kg/亩"
                  />
                  <small>kg/亩</small>
                </div>
              </label>
              <label>
                <span>现金成本</span>
                <div>
                  <input
                    type="number"
                    min="0"
                    value={overrides.costPerMu ?? ""}
                    onChange={(event) => setNumericOverride("costPerMu", event.target.value)}
                    placeholder="元/亩"
                  />
                  <small>元/亩</small>
                </div>
              </label>
              <p>覆盖值只影响经济测算，天气与农艺结论不会被改写。</p>
            </div>
          )}
          {inputError && <p className="inline-error">{inputError}</p>}
        </form>
      </section>

      <section className="field-condition-band" aria-label="地块气象与土壤概况">
        <div className="condition-summary">
          <div className="condition-location">
            <MapPin size={15} />
            <span>{farm.province} · {farm.city} · {farm.district}</span>
          </div>
          <div className="condition-temperature">
            <strong>{context.weather.temperature}°</strong>
            <span>{context.weather.condition}</span>
          </div>
          <p>{plot.areaMu} 亩 · {plot.rotation} · {plot.currentCrop}</p>
        </div>
        <div className="condition-metrics">
          <div>
            <CloudRain size={15} />
            <span>未来 7 日降水</span>
            <strong>{formatNumber(weatherRain, 1)} mm</strong>
          </div>
          <div>
            <Droplets size={15} />
            <span>表层土壤湿度</span>
            <strong>{context.weather.soilMoisture}%</strong>
          </div>
          <div>
            <Gauge size={15} />
            <span>土壤 pH</span>
            <strong>{context.soil.ph.toFixed(1)}</strong>
          </div>
          <div>
            <Wind size={15} />
            <span>当前风速</span>
            <strong>{context.weather.windSpeed} m/s</strong>
          </div>
        </div>
        <WeatherSparkline context={context} />
      </section>

      <div className="decision-layout">
        <section className="candidate-section">
          <div className="section-heading">
            <div>
              <h2>本季种植候选</h2>
              <p>五个作物保留各自风险与收益特征，排序只反映当前选择目标。</p>
            </div>
            <div className="verified-badge">
              <BadgeCheck size={15} />
              已通过独立校验
            </div>
          </div>

          <div className="goal-tabs" role="tablist" aria-label="选择种植目标">
            {goals.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={goal === item.key}
                className={goal === item.key ? "is-active" : ""}
                onClick={() => onGoalChange(item.key)}
              >
                <strong>{item.label}</strong>
                <span>{item.helper}</span>
              </button>
            ))}
          </div>

          {sortedRecommendations.length ? (
            <>
              <div className="candidate-list">
                {sortedRecommendations.map((recommendation, index) => {
                  const Icon = cropIcons[recommendation.cropCode];
                  const active = selected?.id === recommendation.id;
                  const score = recommendation.goalScores[goal];
                  return (
                    <article className={`candidate-row ${active ? "is-selected" : ""}`} key={recommendation.id}>
                      <button
                        className="candidate-main"
                        type="button"
                        aria-pressed={active}
                        onClick={() => onSelectRecommendation(recommendation.id)}
                      >
                        <span className="candidate-rank">{index + 1}</span>
                        <span className="crop-icon">
                          <Icon size={20} strokeWidth={1.7} />
                        </span>
                        <span className="crop-identity">
                          <span>
                            <strong>{recommendation.cropName}</strong>
                            {(recommendation.cropCode === "corn" || recommendation.cropCode === "soybean") && (
                              <small className="subtle-tag">概览</small>
                            )}
                          </span>
                          <small>{recommendation.plan.season} · {recommendation.seasonStatus}</small>
                          <span className={`risk-label risk-${recommendation.riskLevel}`}>
                            {recommendation.riskLevel}风险
                          </span>
                        </span>
                        <span className="crop-score">
                          <span className="score-number">{score}</span>
                          <span className="score-track">
                            <span style={{ width: `${score}%` }} />
                          </span>
                          <small>目标匹配度</small>
                        </span>
                        <span className="crop-economics">
                          <strong>{formatCurrency(recommendation.economics.marginPerMu)}</strong>
                          <small>估算净收益 / 亩</small>
                        </span>
                        <ChevronRight size={17} className="candidate-chevron" />
                      </button>
                    </article>
                  );
                })}
              </div>

              {selected && (
                <section className="candidate-detail" aria-label={`${selected.cropName}方案摘要`}>
                  <div className="candidate-detail-header">
                    <div>
                      <span className="detail-state">
                        <Check size={13} />
                        当前选中
                      </span>
                      <h3>{selected.cropName} · {selected.plan.season}</h3>
                    </div>
                    <button
                      className="primary-button compact"
                      type="button"
                      onClick={() => onChoosePlan(selected.id)}
                      disabled={running}
                    >
                      选为执行方案
                      <ArrowRight size={15} />
                    </button>
                  </div>
                  <p className="candidate-detail-summary">{selected.summary}</p>
                  <div className="decision-evidence-grid">
                    <div>
                      <span>为什么现在比较合适</span>
                      <ul>
                        {selected.decisionReasons.slice(0, 3).map((reason) => (
                          <li key={reason}><Check size={13} />{reason}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span>当前需要留意</span>
                      <ul className="warning-list">
                        {(selected.warnings.length
                          ? selected.warnings
                          : ["未识别到当前阈值风险，仍需关注当地短临预警。"]
                        ).map((warningItem) => (
                          <li key={warningItem}><CircleAlert size={13} />{warningItem}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="economics-strip">
                    <div>
                      <span>估算收入</span>
                      <strong>{formatCurrency(selected.economics.revenueTotal)}</strong>
                    </div>
                    <div>
                      <span>现金成本</span>
                      <strong>{formatCurrency(selected.economics.costTotal)}</strong>
                    </div>
                    <div>
                      <span>估算净收益</span>
                      <strong>{formatCurrency(selected.economics.marginTotal)}</strong>
                    </div>
                    <div>
                      <span>价格假设</span>
                      <strong>{selected.economics.pricePerKg} 元/kg</strong>
                    </div>
                    <span className="estimate-note">
                      <Info size={13} />
                      {selected.economics.source === "user-overridden" ? "含本地覆盖值" : "公开数据中位估算"}
                    </span>
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="empty-state">
              <Sprout size={26} />
              <h3>这块地还没有本季决策</h3>
              <p>运行一次专家决策，系统会读取本地块位置、天气、土壤和轮作历史。</p>
              <button className="primary-button compact" type="button" onClick={() => onGenerate("生成本季种植建议", goal, {})}>
                开始生成
                <ArrowRight size={15} />
              </button>
            </div>
          )}
        </section>

        <aside className="plot-context-column">
          <section className="context-section">
            <div className="context-section-title">
              <h2>地块画像</h2>
              <span>{plot.areaMu} 亩</span>
            </div>
            <PlotMap plot={plot} />
            <dl className="plot-facts">
              <div><dt>土壤质地</dt><dd>{context.soil.texture}</dd></div>
              <div><dt>灌溉条件</dt><dd>{plot.irrigation}</dd></div>
              <div><dt>排水条件</dt><dd>{plot.drainage}</dd></div>
              <div><dt>上茬作物</dt><dd>{plot.currentCrop}</dd></div>
              <div><dt>轮作方式</dt><dd>{plot.rotation}</dd></div>
            </dl>
            <p className="source-note">
              <span className={`source-dot ${context.soil.isFallback ? "is-fallback" : ""}`} />
              {context.soil.source === "soilgrids"
                ? "SoilGrids 表层土壤"
                : context.soil.source === "manual"
                  ? "用户测土数据"
                  : "湖北区域土壤先验"}
            </p>
          </section>

          <section className="context-section warning-section">
            <div className="context-section-title">
              <h2>近期提醒</h2>
              <span className={`alert-level ${warning?.level ?? "info"}`}>{warning?.level === "severe" ? "高" : "关注"}</span>
            </div>
            {context.weather.warnings.map((item) => (
              <article className={`warning-item level-${item.level}`} key={item.id}>
                <div>
                  <CircleAlert size={15} />
                  <strong>{item.title}</strong>
                </div>
                <p>{item.detail}</p>
              </article>
            ))}
          </section>

          <section className="context-section data-section">
            <div className="context-section-title">
              <h2>证据与口径</h2>
            </div>
            <div className="evidence-row">
              <Wheat size={15} />
              <span>区域规则</span>
              <strong>湖北优先</strong>
            </div>
            <div className="evidence-row">
              <CloudRain size={15} />
              <span>天气数据</span>
              <strong>{context.weather.source === "open-meteo" ? "实时预报" : "缓存演示"}</strong>
            </div>
            <div className="evidence-row">
              <Gauge size={15} />
              <span>经济数据</span>
              <strong>公开估算</strong>
            </div>
            <p>价格和产量不是实时报价或保证产量；可被本地值覆盖。</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function WeatherSparkline({ context }: { context: PlotContext }) {
  const temperatures = context.weather.daily.map((day) => day.tempMax);
  const minimum = Math.min(...temperatures);
  const maximum = Math.max(...temperatures);
  const points = temperatures
    .map((value, index) => {
      const x = 4 + (index / Math.max(1, temperatures.length - 1)) * 112;
      const y = 31 - ((value - minimum) / Math.max(1, maximum - minimum)) * 22;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="weather-mini-chart" aria-label="未来七日最高气温趋势">
      <div>
        <span>7 日温度趋势</span>
        <strong>{formatNumber(minimum, 0)}–{formatNumber(maximum, 0)}°C</strong>
      </div>
      <svg viewBox="0 0 120 38" role="img" aria-hidden="true">
        <path d="M4 31 L116 31" className="chart-axis" />
        <polyline points={points} className="chart-line" />
        {temperatures.map((value, index) => {
          const x = 4 + (index / Math.max(1, temperatures.length - 1)) * 112;
          const y = 31 - ((value - minimum) / Math.max(1, maximum - minimum)) * 22;
          return <circle key={`${value}-${index}`} cx={x} cy={y} r="1.8" className="chart-dot" />;
        })}
      </svg>
    </div>
  );
}

function PlotMap({ plot }: { plot: Plot }) {
  const offset = plot.id.length % 3;
  return (
    <div className="plot-map" aria-label={`${plot.name}地块示意`}>
      <svg viewBox="0 0 240 128" role="img" aria-hidden="true">
        <rect x="0" y="0" width="240" height="128" className="map-ground" />
        <path d="M0 86 C48 68 88 96 132 77 C171 60 200 69 240 51" className="map-water" />
        <path
          d={`M28 ${23 + offset} L116 12 L188 31 L170 104 L62 114 Z`}
          className="map-field"
        />
        <path d="M51 25 L55 111 M80 20 L85 113 M109 16 L115 112 M138 22 L143 109 M165 29 L162 106" className="map-rows" />
        <circle cx="36" cy="20" r="8" className="map-north-ring" />
        <path d="M36 14 L39 23 L34 23 Z" className="map-north" />
        <text x="36" y="35">N</text>
        <text x="90" y="70" className="map-label">{plot.name}</text>
      </svg>
      <span>地块边界为演示示意</span>
    </div>
  );
}
