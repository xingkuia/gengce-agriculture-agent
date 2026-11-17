import { db } from "./db.js";

interface GuidanceSection {
  heading: string;
  facts: string[];
}

interface PublicGuidanceSource {
  id: string;
  title: string;
  publisher: string;
  publishedAt: string;
  sourceUrl: string;
  crops: string[];
  summary: string;
  sections: GuidanceSection[];
}

export interface PublicGuidanceSeedResult {
  accounts: number;
  seededAccounts: number;
  documents: number;
  chunks: number;
}

const RETRIEVED_AT = "2026-11-15";
const SEED_VERSION = "v2";
const PREVIOUS_SEED_VERSION = "v1";
const RETIRED_SOURCE_IDS = ["wheat-2024-autumn"];
const KNOWLEDGE_BASE_NAME = "湖北官方农技公开资料";
const KNOWLEDGE_BASE_DESCRIPTION =
  "湖北省农业农村厅及厅属单位公开发布的小麦、油菜、水稻、玉米、大豆和科学施肥资料摘要。仅保留决策所需短事实，原文以来源链接为准。";

const SOURCES: PublicGuidanceSource[] = [
  {
    id: "wheat-2026-autumn",
    title: "2026年湖北省小麦、马铃薯秋冬播技术指导意见",
    publisher: "湖北省农业农村厅",
    publishedAt: "2026-09-28",
    sourceUrl:
      "https://nyt.hubei.gov.cn/zfxxgk/fdzdgknr_GK2020/qtzdgknr_GK2020/hygq_GK2020/202609/t20260928_6024100.shtml",
    crops: ["冬小麦"],
    summary: "湖北冬小麦品种分区、五适播种、沟系配套、分期施肥和冬前分类管理的官方技术要点。",
    sections: [
      {
        heading: "品种布局与种子处理",
        facts: [
          "江汉平原及鄂东麦区优先选用抗赤霉病、耐穗发芽的优良品种；鄂北岗地重点推广半冬性稳产抗逆品种。",
          "播前应晒种、清选并检测发芽率，不应使用发芽率偏低的种子。",
          "优先使用包衣种子或药剂拌种；条锈病冬繁区、地下害虫和根茎部病害重发区不应让白籽下田。"
        ]
      },
      {
        heading: "五适播种与沟系配套",
        facts: [
          "适墒：耕层土壤相对含水量以70%-75%为宜，偏旱可提前造墒，偏湿应先排水降渍。",
          "适深：常规墒情播深2-3厘米，土壤偏旱时3-4厘米。",
          "适期：鄂北适宜期约10月20日至30日，鄂南约10月25日至11月5日；春性品种最迟不宜晚于11月15日。",
          "适量：旱田10-12.5公斤/亩，稻茬田12.5-15公斤/亩；11月5日后每迟播2天可增播0.5公斤/亩，最大增量不超过5公斤。",
          "适机：采用机械条播或种肥同播，保证落籽均匀、深浅一致。",
          "旱茬麦厢宽3.5-4米、稻茬麦厢宽2.5-3米；厢沟约25×30厘米、腰沟约30×35厘米、围沟约35×40厘米。"
        ]
      },
      {
        heading: "施肥、除草与冬前管理",
        facts: [
          "施肥应优先采用测土配方、缓释肥和商品有机肥；氮肥基施约50%、拔节肥25%-30%、穗肥约10%，磷肥一次性基施。",
          "秸秆还田地块可酌情减少20%-30%钾肥用量；墒情和整地质量较好时可采用种肥同播一次性施肥。",
          "除草坚持冬前为主、春季为辅，苗后施药避开寒潮降温。",
          "3-4叶期分类管理：弱苗可追尿素3-5公斤/亩，旺长田采用镇压和合规化控，防止越冬前拔节。"
        ]
      }
    ]
  },
  {
    id: "rapeseed-2023-autumn",
    title: "2023年湖北省油菜秋播技术指导意见",
    publisher: "湖北省农业农村厅办公室",
    publishedAt: "2023-07-27",
    sourceUrl:
      "https://nyt.hubei.gov.cn/zfxxgk/zc_GK2020/qtzdgkwj_GK2020/tz/202307/t20230731_4775798.shtml",
    crops: ["冬油菜"],
    summary: "湖北冬油菜品种选择、适期播种、密植、三沟排水、硼肥和花期防控的官方技术要点。",
    sections: [
      {
        heading: "品种与适期播种",
        facts: [
          "选择通过省级或国家审定登记、适宜湖北种植的双低、高产高油、多抗、耐迟播耐密耐渍品种；根肿病风险区选择抗根肿病品种。",
          "最佳播期为10月上中旬，可提前至9月20日前后，最晚不宜迟于11月5日。",
          "晚播、干旱或墒情不足时应适当增加用种量，但飞播或撒播用种量一般不超过500克/亩。"
        ]
      },
      {
        heading: "密度、水分与排水",
        facts: [
          "10月上中旬联合机播用种量200-300克/亩，人工撒播或无人机飞播300-400克/亩。",
          "常规适期田块以约3万株/亩有效苗为目标，晚播飞播田可提高到约5万株/亩。",
          "播种施肥后及时开好厢沟、腰沟、围沟，做到三沟相通；厢面应湿润但不积水。",
          "稻油轮作应提前处理机耕沟积水，避免田间过湿时机械下田破坏耕层。"
        ]
      },
      {
        heading: "施肥与绿色防控",
        facts: [
          "油菜对硼敏感，缺硼或保肥性差田块可基施硼砂0.5-0.75公斤/亩，或采用含硼种肥同播。",
          "直播油菜可采用种肥同播、一底一补；蕾薹初期看苗追施尿素和氯化钾，避免旺长倒伏。",
          "初花后期实施一促四防，菌核病重发田在盛花期按预警补防；药剂应轮换并按登记标签使用。",
          "根肿病田除选用抗病品种外，可结合整地使用石灰改良，并严格按技术方案进行种子处理。"
        ]
      }
    ]
  },
  {
    id: "rice-storm-2026",
    title: "强对流天气下水稻防灾减灾技术指导意见",
    publisher: "湖北省农业农村厅",
    publishedAt: "2026-05-17",
    sourceUrl:
      "https://nyt.hubei.gov.cn/bmdt/yw/ywtz/snyjstgzz_9001/202605/t20260517_5937757.shtml",
    crops: ["水稻"],
    summary: "强降雨前后的稻田排水、受淹恢复、错峰播栽和雨后病虫监测要点。",
    sections: [
      {
        heading: "降雨前排水与设施检查",
        facts: [
          "暴雨前应清理稻田和秧田围沟、腰沟、厢沟，低洼易涝区提前打开排水口并降低田间水位。",
          "秧田期应加固育秧棚架、疏通棚周排水沟，防止棚内积水。",
          "尚未播种的中稻应避开强降雨过程，待降雨间歇或天气转好后再播种。"
        ]
      },
      {
        heading: "受淹恢复与雨后病虫防控",
        facts: [
          "早稻、再生稻雨后及时排干积水，保持3-5厘米浅水层促进根系恢复；受淹较久田块排水后轻露田。",
          "缺苗断垄应及时补栽或移密补稀，待栽秧苗抢晴炼苗后移栽。",
          "暴雨后重点监测二化螟、稻飞虱、纹枯病和稻瘟病，低洼积水田和感病品种田优先调查。"
        ]
      }
    ]
  },
  {
    id: "corn-spring-2026",
    title: "湖北省2026年春播玉米生产技术指导意见",
    publisher: "湖北省农业农村厅",
    publishedAt: "2026-03-25",
    sourceUrl:
      "https://nyt.hubei.gov.cn/bmdt/yw/ywtz/snyjstgzz_9001/202603/t20260325_5899109.shtml",
    crops: ["玉米"],
    summary: "湖北春玉米品种、播种温度、密度、施肥、化控和适期收获的官方技术要点。",
    sections: [
      {
        heading: "品种、地温与密度",
        facts: [
          "选用湖北审定且适宜当地生态区的合法春玉米品种，坚持使用包衣种子。",
          "以5厘米地温稳定通过10℃作为适播标准，湖北春播区通常在3月下旬至4月中旬达到条件。",
          "山地间套种密度约3000-4000株/亩，平原一般4500-5500株/亩。",
          "籽粒玉米可采用宽行增密，行距约76厘米、株距15-20厘米。"
        ]
      },
      {
        heading: "施肥、防控与收获",
        facts: [
          "总纯氮控制在14-16公斤/亩，遵循施足底肥、巧施苗肥、重施穗肥。",
          "底肥可参考40-50公斤/亩复合肥（15-15-15）；大喇叭口期可追尿素20公斤和钾肥15公斤/亩。",
          "6叶前适时化学除草，7-9叶期看长势化控，重点监测纹枯病、大小斑病、锈病、玉米螟和草地贪夜蛾。",
          "籽粒含水量降至25%以下时适时机收，并及时烘干。"
        ]
      }
    ]
  },
  {
    id: "soybean-spring-2026",
    title: "湖北省2026年春播大豆生产技术指导意见",
    publisher: "湖北省农业农村厅",
    publishedAt: "2026-03-18",
    sourceUrl:
      "https://nyt.hubei.gov.cn/bmdt/yw/ywtz/snyjstgzz_9001/202603/t20260318_5894727.shtml",
    crops: ["大豆"],
    summary: "湖北春大豆播种温度、精量密植、施肥、控旺和低损机收的官方技术要点。",
    sections: [
      {
        heading: "种子处理与精量播种",
        facts: [
          "选用丰产稳产、抗逆性强、宜机收的高蛋白或兼用型品种，全面推行药剂包衣或拌种。",
          "缺硼缺钼区域配合微肥拌种，并积极使用大豆根瘤菌剂。",
          "春大豆一般3月中下旬至4月上旬播种，以5厘米地温稳定通过12℃为适播标准。",
          "推荐气吸式播种机，亩用种7-8公斤，行距25-30厘米，播深3-5厘米，保苗1.8-2.2万株/亩。"
        ]
      },
      {
        heading: "施肥、化控、防控与收获",
        facts: [
          "坚持控氮、增磷、补钾、配施微肥、重施基肥；基肥可参考复合肥（15-15-15）20-30公斤/亩。",
          "初花期可看苗追尿素3-5公斤/亩，并喷施钼酸铵10-15克和磷酸二氢钾75-100克/亩。",
          "旺长田可在初花期按标签化控，重点监测根腐病、点蜂缘蝽和蛴螬。",
          "完熟且籽粒含水量降至18%以下后机械抢收，调整机具参数减少落荚落粒和破损。"
        ]
      }
    ]
  },
  {
    id: "wheat-rapeseed-varieties-2025",
    title: "秋冬种小麦、油菜主导品种（2025）",
    publisher: "湖北省农业农村厅",
    publishedAt: "2025-09-16",
    sourceUrl:
      "https://nyt.hubei.gov.cn/zfxxgk/zc_GK2020/qtzdgkwj_GK2020/tz/202509/t20250917_5773981.shtml",
    crops: ["冬小麦", "冬油菜"],
    summary: "湖北省2025年秋冬种小麦、油菜各10个主导品种，依据公开推广面积排序。",
    sections: [
      {
        heading: "主导品种名单",
        facts: [
          "小麦主导品种：鄂麦590、扶麦368、金乐1号、鄂麦007、鄂麦596、襄麦25、襄麦55、楚襄1号、垦麦58、珍麦168。",
          "油菜主导品种：大地199、华油杂62、华油杂50、中油杂19、华919、中油杂28、中油杂39、金油杂9号、华油杂62R、中油杂30。",
          "该名单依据推广面积排序，不代表所有品种在每一地块都优于其他合法品种；仍需结合当地试验、抗性、茬口和订单需求选择。"
        ]
      }
    ]
  },
  {
    id: "autumn-fertilizer-2026",
    title: "湖北省2026年秋冬季主要农作物科学施肥技术指导方案",
    publisher: "湖北省农业农村厅土壤肥料工作总站",
    publishedAt: "2026-09-29",
    sourceUrl:
      "https://nyt.hubei.gov.cn/bmdt/yw/gfxx/202610/t20261012_6031025.shtml",
    crops: ["冬小麦", "冬油菜", "马铃薯", "柑橘", "梨", "蔬菜", "茶树"],
    summary: "基于测土配方成果的2026年秋冬季小麦、油菜等作物氮磷钾推荐量、施肥时期和区域配方。",
    sections: [
      {
        heading: "冬小麦推荐施肥",
        facts: [
          "目标产量450-550公斤/亩时，推荐氮12-14、磷5-6、钾5-6公斤/亩（折纯）。",
          "目标产量350-450公斤/亩时，推荐氮10-12、磷4-5、钾4-5公斤/亩（折纯）。",
          "江汉平原弱筋小麦可将约70%氮肥基施、30%于拔节期追施；鄂中北中强筋小麦可基施约60%、返青至拔节追施40%。",
          "缺锌或缺锰土壤可基施硫酸锌或硫酸锰1-2公斤/亩；稻茬麦应优先开沟排渍。"
        ]
      },
      {
        heading: "冬油菜推荐施肥",
        facts: [
          "目标产量200公斤/亩以上时，推荐氮14-16、磷4-5、钾5-6公斤/亩（折纯）。",
          "目标产量150-200公斤/亩时，推荐氮12-14、磷3-4、钾4-5公斤/亩（折纯）。",
          "基肥氮可占总氮60%-70%；越冬苗肥可追尿素5-8公斤/亩，薹肥看苗追尿素3-5公斤和氯化钾3-5公斤/亩。",
          "应足量施用硼肥，缺硼或基肥补硼不足时可在初花期叶面补硼。",
          "以上为区域推荐范围，实际用量仍需用本地测土值、目标产量、有机肥和前茬情况校准。"
        ]
      }
    ]
  }
];

export function seedPublicGuidance(): PublicGuidanceSeedResult {
  const accounts = db.prepare("SELECT id FROM account ORDER BY created_at").all() as Array<{ id: string }>;
  const result: PublicGuidanceSeedResult = {
    accounts: accounts.length,
    seededAccounts: 0,
    documents: 0,
    chunks: 0
  };

  for (const account of accounts) {
    const markerId = `public-guidance-${SEED_VERSION}:${account.id}`;
    const previousMarkerId = `public-guidance-${PREVIOUS_SEED_VERSION}:${account.id}`;
    const marker = db.prepare("SELECT id FROM data_seed_migration WHERE id = ?").get(markerId);
    if (marker) continue;

    const knowledgeBaseId = `kb-public-hubei-guidance-${account.id}`;
    const now = new Date().toISOString();
    const previousMarker = db.prepare("SELECT id FROM data_seed_migration WHERE id = ?").get(previousMarkerId);
    const existingKnowledgeBase = db.prepare("SELECT id FROM knowledge_base WHERE id = ?").get(knowledgeBaseId);
    if (previousMarker && !existingKnowledgeBase) {
      db.prepare(`
        INSERT INTO data_seed_migration (id, applied_at, detail)
        VALUES (?, ?, ?)
      `).run(markerId, now, "User deleted the seeded knowledge base; deletion preserved");
      continue;
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        INSERT INTO knowledge_base (
          id, account_id, name, description, scope_type, scope_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'account', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          scope_type = excluded.scope_type,
          scope_id = excluded.scope_id,
          updated_at = excluded.updated_at
      `).run(
        knowledgeBaseId,
        account.id,
        KNOWLEDGE_BASE_NAME,
        KNOWLEDGE_BASE_DESCRIPTION,
        account.id,
        now,
        now
      );
      db.prepare(`
        INSERT INTO capability_binding (
          id, capability_type, capability_id, scope_type, scope_id, enabled, priority, created_at, updated_at
        ) VALUES (?, 'knowledge', ?, 'account', ?, 1, 100, ?, ?)
        ON CONFLICT(capability_type, capability_id, scope_type, scope_id) DO UPDATE SET
          enabled = 1,
          updated_at = excluded.updated_at
      `).run(
        `binding-public-guidance-${account.id}`,
        knowledgeBaseId,
        account.id,
        now,
        now
      );

      for (const source of SOURCES) {
        const documentId = `doc-public-${source.id}-${account.id}`;
        const content = buildDocumentContent(source);
        db.prepare(`
          INSERT INTO knowledge_document (
            id, knowledge_base_id, title, source_name, publisher, published_at,
            source_url, retrieved_at, mime_type, content, status, error_message,
            chunk_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'text/markdown', ?, 'ready', NULL, 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            source_name = excluded.source_name,
            publisher = excluded.publisher,
            published_at = excluded.published_at,
            source_url = excluded.source_url,
            retrieved_at = excluded.retrieved_at,
            mime_type = excluded.mime_type,
            content = excluded.content,
            status = 'ready',
            error_message = NULL,
            updated_at = excluded.updated_at
        `).run(
          documentId,
          knowledgeBaseId,
          source.title,
          "湖北省农业农村厅公开资料",
          source.publisher,
          source.publishedAt,
          source.sourceUrl,
          RETRIEVED_AT,
          content,
          now,
          now
        );

        clearDocumentIndex(documentId);
        source.sections.forEach((section, index) => {
          const chunkId = `chunk-public-${source.id}-${index + 1}-${account.id}`;
          const chunkContent = buildChunkContent(source, section);
          db.prepare(`
            INSERT INTO knowledge_chunk (
              id, document_id, knowledge_base_id, chunk_index, content, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            chunkId,
            documentId,
            knowledgeBaseId,
            index,
            chunkContent,
            JSON.stringify({
              sourceUrl: source.sourceUrl,
              publisher: source.publisher,
              publishedAt: source.publishedAt,
              retrievedAt: RETRIEVED_AT,
              crops: source.crops,
              publicSource: true
            }),
            now
          );
          insertFts(chunkId, `${source.title}\n${chunkContent}`);
          result.chunks += 1;
        });
        db.prepare(`
          UPDATE knowledge_document
          SET chunk_count = ?, updated_at = ?
          WHERE id = ?
        `).run(source.sections.length, now, documentId);
        result.documents += 1;
      }

      for (const sourceId of RETIRED_SOURCE_IDS) {
        const documentId = `doc-public-${sourceId}-${account.id}`;
        const retiredDocument = db.prepare("SELECT id FROM knowledge_document WHERE id = ?").get(documentId);
        if (!retiredDocument) continue;
        clearDocumentIndex(documentId);
        db.prepare("DELETE FROM knowledge_document WHERE id = ?").run(documentId);
      }

      db.prepare(`
        INSERT INTO data_seed_migration (id, applied_at, detail)
        VALUES (?, ?, ?)
      `).run(
        markerId,
        now,
        `${SOURCES.length} official guidance documents, ${SOURCES.reduce((sum, source) => sum + source.sections.length, 0)} chunks`
      );
      db.exec("COMMIT");
      result.seededAccounts += 1;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return result;
}

function buildDocumentContent(source: PublicGuidanceSource): string {
  return [
    `# ${source.title}`,
    `发布机构：${source.publisher}`,
    `发布日期：${source.publishedAt}`,
    `原文链接：${source.sourceUrl}`,
    `采集日期：${RETRIEVED_AT}`,
    `适用作物：${source.crops.join("、")}`,
    "",
    source.summary,
    "",
    ...source.sections.flatMap(section => [
      `## ${section.heading}`,
      ...section.facts.map(fact => `- ${fact}`),
      ""
    ]),
    "说明：以上为耕策根据政府公开资料整理的短摘要，不替代原文、当地测土结果和农技人员现场指导。"
  ].join("\n");
}

function buildChunkContent(source: PublicGuidanceSource, section: GuidanceSection): string {
  return [
    `《${source.title}》`,
    `发布机构：${source.publisher}；发布日期：${source.publishedAt}`,
    `适用作物：${source.crops.join("、")}`,
    `原文：${source.sourceUrl}`,
    section.heading,
    ...section.facts.map(fact => `- ${fact}`)
  ].join("\n");
}

function clearDocumentIndex(documentId: string): void {
  const chunks = db.prepare("SELECT id FROM knowledge_chunk WHERE document_id = ?").all(documentId) as Array<{ id: string }>;
  if (hasFtsTable()) {
    const removeFts = db.prepare("DELETE FROM knowledge_chunk_fts WHERE chunk_id = ?");
    for (const chunk of chunks) removeFts.run(chunk.id);
  }
  db.prepare("DELETE FROM knowledge_chunk WHERE document_id = ?").run(documentId);
}

function insertFts(chunkId: string, content: string): void {
  if (!hasFtsTable()) return;
  db.prepare("INSERT INTO knowledge_chunk_fts (chunk_id, content) VALUES (?, ?)").run(chunkId, content);
}

function hasFtsTable(): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_chunk_fts'").get()
  );
}
