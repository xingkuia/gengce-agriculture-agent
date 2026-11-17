import type {
  CropCode,
  CropDefinition,
  EconomicsEstimate,
  GoalKey,
  PlanDraft,
  PlanTask,
  Plot,
  PriceOverride,
  SoilSnapshot,
  WeatherSnapshot
} from "./types.js";

export const GOALS: Array<{ key: GoalKey; label: string; description: string }> = [
  { key: "profit", label: "稳健收益", description: "优先考虑可实现的亩均净收益" },
  { key: "low_risk", label: "低风险", description: "降低天气、价格和田间管理波动" },
  { key: "labor_saving", label: "省工易管", description: "适合劳动力有限的家庭农场" },
  { key: "soil_health", label: "养地轮作", description: "兼顾当季产出与下一茬地力" }
];

export const CROPS: Record<CropCode, CropDefinition> = {
  wheat: {
    code: "wheat",
    name: "冬小麦",
    shortName: "小麦",
    scientificName: "Triticum aestivum",
    defaultPricePerKg: 2.46,
    priceRange: [2.28, 2.62],
    defaultYieldPerMu: 405,
    yieldRange: [350, 455],
    defaultCostPerMu: 795,
    costRange: [710, 920],
    suitableMonths: [10, 11],
    season: "鄂北冬小麦",
    deepGuidance: true,
    goals: { profit: 88, low_risk: 86, labor_saving: 92, soil_health: 61 },
    riskLevel: "低",
    laborLevel: "低",
    rotationValue: "可与水稻、玉米轮作，秸秆还田改善有机质",
    fitNote: "当前光温与土壤条件适合播种，管理节奏成熟，适合作为现金流稳定方案。",
    evidence: [
      "《2026年湖北省小麦、马铃薯秋冬播技术指导意见》",
      "《湖北省2026年秋冬季主要农作物科学施肥技术指导方案》",
      "《秋冬种小麦、油菜主导品种（2025）》"
    ]
  },
  rapeseed: {
    code: "rapeseed",
    name: "冬油菜",
    shortName: "油菜",
    scientificName: "Brassica napus",
    defaultPricePerKg: 5.72,
    priceRange: [5.2, 6.15],
    defaultYieldPerMu: 176,
    yieldRange: [145, 205],
    defaultCostPerMu: 735,
    costRange: [650, 860],
    suitableMonths: [9, 10, 11],
    season: "鄂中稻油轮作",
    deepGuidance: true,
    goals: { profit: 77, low_risk: 81, labor_saving: 67, soil_health: 95 },
    riskLevel: "低",
    laborLevel: "中",
    rotationValue: "改善稻田土壤结构，减少连作障碍，菜籽收购渠道相对稳定",
    fitNote: "适合当前播期和稻油轮作，但田间管理频次高于小麦。",
    evidence: [
      "《2023年湖北省油菜秋播技术指导意见》",
      "《湖北省2026年秋冬季主要农作物科学施肥技术指导方案》",
      "《秋冬种小麦、油菜主导品种（2025）》"
    ]
  },
  rice: {
    code: "rice",
    name: "水稻",
    shortName: "水稻",
    scientificName: "Oryza sativa",
    defaultPricePerKg: 2.78,
    priceRange: [2.58, 3.02],
    defaultYieldPerMu: 592,
    yieldRange: [520, 665],
    defaultCostPerMu: 965,
    costRange: [860, 1120],
    suitableMonths: [4, 5, 6],
    season: "鄂中一季中稻",
    deepGuidance: true,
    goals: { profit: 82, low_risk: 70, labor_saving: 58, soil_health: 74 },
    riskLevel: "中",
    laborLevel: "中高",
    rotationValue: "与油菜轮作可降低连作病虫压力",
    fitNote: "当前不在适播窗口，可作为下一季轮作方案提前测算。",
    evidence: ["《强对流天气下水稻防灾减灾技术指导意见》"]
  },
  corn: {
    code: "corn",
    name: "玉米",
    shortName: "玉米",
    scientificName: "Zea mays",
    defaultPricePerKg: 2.31,
    priceRange: [2.12, 2.48],
    defaultYieldPerMu: 565,
    yieldRange: [485, 645],
    defaultCostPerMu: 825,
    costRange: [740, 960],
    suitableMonths: [3, 4, 6, 7],
    season: "春播或夏播玉米",
    deepGuidance: false,
    goals: { profit: 73, low_risk: 66, labor_saving: 76, soil_health: 69 },
    riskLevel: "中",
    laborLevel: "低",
    rotationValue: "秸秆还田可补充有机质，需关注连作病虫",
    fitNote: "当前非主播期，首版仅提供适宜性和经济测算。",
    evidence: ["《湖北省2026年春播玉米生产技术指导意见》"]
  },
  soybean: {
    code: "soybean",
    name: "大豆",
    shortName: "大豆",
    scientificName: "Glycine max",
    defaultPricePerKg: 4.76,
    priceRange: [4.35, 5.2],
    defaultYieldPerMu: 172,
    yieldRange: [140, 205],
    defaultCostPerMu: 680,
    costRange: [610, 780],
    suitableMonths: [5, 6],
    season: "夏播大豆",
    deepGuidance: false,
    goals: { profit: 64, low_risk: 72, labor_saving: 79, soil_health: 91 },
    riskLevel: "中",
    laborLevel: "低",
    rotationValue: "豆科固氮，有利于改善轮作结构",
    fitNote: "当前非主播期，首版仅提供轮作和收益比较。",
    evidence: ["《湖北省2026年春播大豆生产技术指导意见》", "公开粮油价格区间（非实时报价）"]
  }
};

export const CROP_ORDER: CropCode[] = ["wheat", "rapeseed", "rice", "corn", "soybean"];

export function isInSuitableWindow(crop: CropDefinition, month: number): boolean {
  return crop.suitableMonths.includes(month);
}

export function seasonStatus(crop: CropDefinition, month: number): "适播" | "临近播期" | "非当前播期" {
  if (crop.suitableMonths.includes(month)) {
    return "适播";
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  return crop.suitableMonths.includes(nextMonth) ? "临近播期" : "非当前播期";
}

export function computeEconomics(
  crop: CropDefinition,
  areaMu: number,
  overrides: PriceOverride = {}
): EconomicsEstimate {
  const pricePerKg = overrides.pricePerKg ?? crop.defaultPricePerKg;
  const yieldPerMu = overrides.yieldPerMu ?? crop.defaultYieldPerMu;
  const costPerMu = overrides.costPerMu ?? crop.defaultCostPerMu;
  const revenuePerMu = round(pricePerKg * yieldPerMu, 0);
  const marginPerMu = round(revenuePerMu - costPerMu, 0);
  const userOverridden =
    overrides.pricePerKg !== undefined ||
    overrides.yieldPerMu !== undefined ||
    overrides.costPerMu !== undefined;

  return {
    pricePerKg,
    priceRange: crop.priceRange,
    yieldPerMu,
    yieldRange: crop.yieldRange,
    costPerMu,
    revenuePerMu,
    marginPerMu,
    revenueTotal: round(revenuePerMu * areaMu, 0),
    costTotal: round(costPerMu * areaMu, 0),
    marginTotal: round(marginPerMu * areaMu, 0),
    source: userOverridden ? "user-overridden" : "public-estimate",
    assumptions: [
      userOverridden ? "包含用户覆盖值，覆盖项优先于公开估算" : "采用公开数据形成的区间中位值",
      `按 ${areaMu} 亩净种植面积测算，不含地租与融资成本`,
      "价格为参考区间，非实时收购报价"
    ]
  };
}

export function buildPlan(
  crop: CropDefinition,
  plot: Plot,
  weather: WeatherSnapshot,
  soil: SoilSnapshot,
  startDate = new Date()
): PlanDraft {
  const tasks = cropPlanTasks(crop.code, startDate);
  const weatherCaveat =
    weather.daily.reduce((sum, day) => sum + day.precipitation, 0) > 25
      ? "未来 7 日累计降水偏多，整地和播后沟渠检查需提前。"
      : "未来 7 日降水总体可控，仍需在播后复查土壤墒情。";
  const soilCaveat = soil.isFallback
    ? "当前土壤为区域先验，正式施肥前需用测土值或当地农技建议校准。"
    : `土壤 ${soil.texture}，pH ${soil.ph.toFixed(1)}，施肥建议已按属性调整。`;

  return {
    cropCode: crop.code,
    cropName: crop.name,
    startDate: toDateString(startDate),
    season: crop.season,
    summary: `${plot.name}当前建议按“${crop.season}”组织，先完成整地与适墒播种，再依据天气窗口推进追肥和病虫监测。`,
    decisionReasons: [
      crop.fitNote,
      weatherCaveat,
      soilCaveat,
      `${plot.rotation}；本方案兼顾当季生产与下一茬衔接。`
    ],
    tasks,
    monitoring: [
      "播后 5 至 7 日检查出苗均匀度与缺苗断垄",
      "连续降雨后检查田间积水与根系病害",
      "低温过程前 48 小时复核防冻措施",
      "病虫防治以当地植保预警和田间调查为准"
    ],
    inputPlan: buildInputPlan(crop.code),
    waterPlan: [
      "优先利用自然降水，避免大水漫灌",
      "播种后保持适宜墒情，积水地块及时清沟排渍",
      "追肥与降水窗口错开，避免养分流失"
    ],
    evidence: crop.evidence
  };
}

function cropPlanTasks(code: CropCode, base: Date): PlanTask[] {
  const templates: Record<CropCode, Array<Omit<PlanTask, "id" | "dateWindow"> & { start: number; end: number }>> = {
    wheat: [
      {
        phase: "整地",
        title: "秸秆处理与整畦",
        start: 1,
        end: 3,
        method: "秸秆粉碎还田，旋耕埋草深度 15 厘米以上，开好厢沟、腰沟、围沟",
        quantity: "厢沟约 25×30 厘米，腰沟约 30×35 厘米，围沟约 35×40 厘米",
        rationale: "稻茬和低洼田需优先排渍，沟沟相通才能降低连阴雨影响",
        priority: "important"
      },
      {
        phase: "播种",
        title: "适墒精量播种",
        start: 4,
        end: 8,
        method: "药剂拌种或包衣，适墒机械匀播；一般播深 2 至 3 厘米，偏旱时 3 至 4 厘米",
        quantity: "旱田 10 至 12.5 公斤/亩，稻茬田 12.5 至 15 公斤/亩，晚播按发芽率校准",
        rationale: "鄂北适宜期约 10 月 20 日至 30 日，鄂南约 10 月 25 日至 11 月 5 日",
        priority: "critical"
      },
      {
        phase: "苗期",
        title: "查苗补种与化学除草",
        start: 18,
        end: 25,
        method: "检查缺苗断垄；日均温适宜时按标签进行封闭或茎叶除草",
        quantity: "除草剂严格按登记作物和标签剂量",
        rationale: "降低苗期群体不匀与草害竞争",
        priority: "important"
      },
      {
        phase: "越冬",
        title: "分蘖肥与清沟防渍",
        start: 35,
        end: 50,
        method: "看苗追肥，雨后巡查沟渠，弱苗区少量补肥",
        quantity: "目标产量 350 至 450 公斤/亩时，氮磷钾推荐量约 10 至 12、4 至 5、4 至 5 公斤/亩（折纯）",
        rationale: "按测土配方分期施氮，促进冬前壮苗并减少渍害和冻害风险",
        priority: "important"
      },
      {
        phase: "春季管理",
        title: "拔节期看苗管理",
        start: 105,
        end: 125,
        method: "调查群体和纹枯病、麦蜘蛛等，按预警防治",
        quantity: "不盲目增加氮肥，病虫用药按登记标签",
        rationale: "防止倒伏和后期病虫叠加",
        priority: "important"
      },
      {
        phase: "收获",
        title: "成熟期机械收获与测产",
        start: 195,
        end: 215,
        method: "蜡熟末期抢晴收获，单独记录实际产量和水分",
        quantity: "机收损失率建议控制在 3% 以内",
        rationale: "形成可追溯结果并作为下一轮决策反馈",
        priority: "normal"
      }
    ],
    rapeseed: [
      {
        phase: "整地",
        title: "稻田开沟与精细整地",
        start: 1,
        end: 4,
        method: "水稻收后及时开沟排水，采用联合机播、飞播或育苗移栽",
        quantity: "厢沟、腰沟、围沟配套并保持相通，厢面湿润但不积水",
        rationale: "油菜怕渍，稻油轮作首先要解决排水",
        priority: "critical"
      },
      {
        phase: "播种",
        title: "适期播种与基肥",
        start: 3,
        end: 9,
        method: "选用适宜湖北的双低品种，种子拌种或包衣；最佳期为 10 月上中旬，最晚不宜迟于 11 月 5 日",
        quantity: "联合机播 200 至 300 克/亩，撒播或飞播 300 至 400 克/亩",
        rationale: "适期匀播并配套三沟，有利于形成约 3 万株/亩的有效苗群体",
        priority: "critical"
      },
      {
        phase: "苗期",
        title: "间苗定苗与病虫草害防治",
        start: 20,
        end: 30,
        method: "三至五叶期间苗，重点检查菜青虫、蚜虫和草害",
        quantity: "按田间调查达到防治指标后用药",
        rationale: "培育壮苗，避免高密度造成倒伏和菌核病风险",
        priority: "important"
      },
      {
        phase: "越冬",
        title: "追肥与防冻",
        start: 48,
        end: 65,
        method: "看苗追施腊肥，低温前清沟培土",
        quantity: "氮钾肥用量依据土壤测试和当地配方",
        rationale: "增强越冬抗寒能力",
        priority: "important"
      },
      {
        phase: "花期",
        title: "菌核病监测与花期管理",
        start: 135,
        end: 160,
        method: "初花期重点监测菌核病，按预警选择登记药剂",
        quantity: "避免花期过量施药，保护授粉昆虫",
        rationale: "菌核病是湖北油菜主要风险之一",
        priority: "important"
      },
      {
        phase: "收获",
        title: "分段或联合收获",
        start: 210,
        end: 230,
        method: "角果成熟后抢晴收获，及时烘干或摊晾",
        quantity: "单收单储并记录含油率和杂质",
        rationale: "减少落粒和霉变，形成品质反馈",
        priority: "normal"
      }
    ],
    rice: [
      {
        phase: "备耕",
        title: "本田与秧田排水检查",
        start: 1,
        end: 4,
        method: "清理围沟、腰沟、厢沟，低洼区提前打开排水口并加固育秧棚架",
        quantity: "做到雨止田露，避免暴雨后长时间深水淹苗",
        rationale: "强降雨和局地洪涝易造成稻田淹水、秧苗受损和肥料流失",
        priority: "critical"
      },
      {
        phase: "播栽",
        title: "避开强降雨窗口播栽",
        start: 5,
        end: 15,
        method: "尚未播种的中稻避开强降雨；待栽秧苗抢晴炼苗后移栽，移栽前 3 天施送嫁肥和送嫁药",
        quantity: "栽后保持适宜浅水，缺苗断垄及时补栽或移密补稀",
        rationale: "缩短秧苗受淹和缓苗时间，降低弱苗与缺苗风险",
        priority: "critical"
      },
      {
        phase: "分蘖期",
        title: "涝后排水与浅水分蘖",
        start: 25,
        end: 45,
        method: "雨后及时排干积水，保持 3 至 5 厘米浅水层；受淹较久田块排水后轻露田",
        quantity: "看苗追肥，避免雨季一次施氮过量",
        rationale: "增加土壤透气性，促进根系恢复并减少肥料流失",
        priority: "important"
      },
      {
        phase: "病虫监测",
        title: "雨后病虫调查",
        start: 45,
        end: 75,
        method: "重点调查二化螟、稻飞虱、纹枯病和稻瘟病，低洼积水田优先巡查",
        quantity: "按当地植保预警和登记标签用药",
        rationale: "暴雨后田间湿度大，纹枯病和稻瘟病风险升高",
        priority: "important"
      },
      {
        phase: "收获",
        title: "成熟收获与测产",
        start: 120,
        end: 140,
        method: "成熟后抢晴收获，单收单储并记录水分、产量和品质",
        quantity: "机械损失按当地作业标准控制",
        rationale: "形成可追溯结果并反馈下一季方案",
        priority: "normal"
      }
    ],
    corn: [
      {
        phase: "备耕",
        title: "良种与包衣检查",
        start: 1,
        end: 3,
        method: "选用湖北审定且适合当地生态区的春玉米品种，坚持使用包衣种子",
        quantity: "山区宜中晚熟、中大穗型；平原宜中早熟、耐密抗倒品种",
        rationale: "合法适配品种和种子处理是稳定出苗的基础",
        priority: "important"
      },
      {
        phase: "播种",
        title: "地温达标后适墒播种",
        start: 4,
        end: 9,
        method: "以 5 厘米地温稳定通过 10℃ 为标准，抢冷尾暖头播种",
        quantity: "山地间套种 3000 至 4000 株/亩，平原一般 4500 至 5500 株/亩",
        rationale: "湖北春播区通常在 3 月下旬至 4 月中旬达到适宜地温",
        priority: "critical"
      },
      {
        phase: "穗期",
        title: "配方施肥与化学调控",
        start: 35,
        end: 55,
        method: "重施穗肥，大喇叭口期追肥并结合灌溉或有效降雨；7 至 9 叶期按长势化控",
        quantity: "总纯氮 14 至 16 公斤/亩，穗肥可追尿素 20 公斤和钾肥 15 公斤/亩",
        rationale: "优化群体结构，降低倒伏和后期脱肥风险",
        priority: "important"
      },
      {
        phase: "病虫草害",
        title: "绿色防控与田间调查",
        start: 25,
        end: 70,
        method: "6 叶前适时化学除草，重点监测纹枯病、大小斑病、锈病、玉米螟和草地贪夜蛾",
        quantity: "按病虫调查和登记标签精准用药",
        rationale: "湖北春玉米穗期病虫害叠加风险较高",
        priority: "important"
      },
      {
        phase: "收获",
        title: "适时机收与烘干",
        start: 95,
        end: 115,
        method: "根据乳线和脱水进程收获，籽粒含水量降至 25% 以下后及时烘干",
        quantity: "记录籽粒水分、产量和机收损失",
        rationale: "降低霉变和破损风险，提升商品品质",
        priority: "normal"
      }
    ],
    soybean: [
      {
        phase: "备耕",
        title: "良种、包衣与根瘤菌处理",
        start: 1,
        end: 3,
        method: "选用丰产稳产、抗逆、宜机收品种，推行药剂包衣或拌种，并按区域使用根瘤菌剂",
        quantity: "缺硼缺钼区域同步补施微肥，播种前做发芽试验",
        rationale: "降低根腐病、地下害虫和缺苗风险",
        priority: "important"
      },
      {
        phase: "播种",
        title: "地温达标后精量密植",
        start: 4,
        end: 8,
        method: "以 5 厘米地温稳定通过 12℃ 为适播标准，采用气吸式播种机抢晴适墒播种",
        quantity: "用种 7 至 8 公斤/亩，行距 25 至 30 厘米，播深 3 至 5 厘米，保苗 1.8 至 2.2 万株/亩",
        rationale: "过早易低温烂种，过迟会缩短营养生长期",
        priority: "critical"
      },
      {
        phase: "花期",
        title: "花荚期水肥与化控",
        start: 40,
        end: 60,
        method: "基肥为主，初花期看苗追肥；旺长田按说明化控防倒",
        quantity: "初花期可追尿素 3 至 5 公斤/亩，并喷施钼酸铵和磷酸二氢钾",
        rationale: "控氮增磷补微，减少倒伏和花荚脱落",
        priority: "important"
      },
      {
        phase: "病虫草害",
        title: "封闭除草与绿色防控",
        start: 12,
        end: 65,
        method: "播后及时封闭除草，2 至 3 片复叶期按草情苗后除草；监测根腐病和点蜂缘蝽",
        quantity: "按登记标签和统防统治要求执行",
        rationale: "降低苗期草害和花荚期病虫损失",
        priority: "important"
      },
      {
        phase: "收获",
        title: "完熟低损机收",
        start: 90,
        end: 110,
        method: "完熟且籽粒含水量降至 18% 以下后机械抢收，调整拨禾轮和脱粒参数",
        quantity: "单独记录产量、水分、破损率和销售价格",
        rationale: "减少落荚落粒和机收破损，形成成本收益反馈",
        priority: "normal"
      }
    ]
  };

  return templates[code].map((task, index) => ({
    ...task,
    id: `${code}-${index + 1}`,
    dateWindow: `${offsetDate(base, task.start)} 至 ${offsetDate(base, task.end)}`
  }));
}

function buildInputPlan(code: CropCode): string[] {
  const notes: Record<CropCode, string[]> = {
    wheat: [
      "按目标产量 350 至 450 公斤/亩，氮磷钾推荐量约 10 至 12、4 至 5、4 至 5 公斤/亩（折纯），以测土配方校准",
      "江汉平原弱筋小麦可将约 70% 氮肥作基肥、30% 于拔节期追施；鄂中北中强筋小麦基追比例可接近 6:4",
      "稻茬麦先开好三沟；秸秆还田和有机肥田块可按方案酌情减少化肥用量"
    ],
    rapeseed: [
      "目标产量 150 至 200 公斤/亩时，氮磷钾推荐量约 12 至 14、3 至 4、4 至 5 公斤/亩（折纯）",
      "基肥氮可占总氮 60% 至 70%，越冬苗肥可追尿素 5 至 8 公斤/亩，薹肥看苗追尿素 3 至 5 公斤和氯化钾 3 至 5 公斤/亩",
      "足量补硼并保持三沟畅通；菌核病防治按花期预警和登记药剂执行"
    ],
    rice: [
      "基肥与分蘖肥分期，雨后先排水再补肥，避免养分流失",
      "晒田复水后看苗追穗肥",
      "关注当地测土配方与硅锌等中微量元素"
    ],
    corn: [
      "总纯氮控制在 14 至 16 公斤/亩，遵循施足底肥、巧施苗肥、重施穗肥",
      "底肥可参考 40 至 50 公斤/亩复合肥（15-15-15），大喇叭口期看苗追肥",
      "关注锌肥、秸秆还田后的氮素调节和深施覆土"
    ],
    soybean: [
      "基肥可参考复合肥（15-15-15）20 至 30 公斤/亩，或过磷酸钙 30 至 40 公斤加钾肥 5 至 8 公斤/亩",
      "初花期看苗追尿素 3 至 5 公斤/亩，并配合钼酸铵和磷酸二氢钾叶面喷施",
      "硼钼缺乏区需补微肥，优先通过轮作、根瘤菌和排涝稳定产量"
    ]
  };
  return notes[code];
}

function offsetDate(base: Date, days: number): string {
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return `${result.getMonth() + 1}月${result.getDate()}日`;
}

export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0
  }).format(value);
}
