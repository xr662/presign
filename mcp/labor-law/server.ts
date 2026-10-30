// 劳动法规 MCP 服务（项目方案第 5 节）。独立 Node 进程，网站通过 MCP 客户端调用。
// 两种接法：
//   Streamable HTTP（默认）：只监听 127.0.0.1，网站进程用；node --liftoff-only mcp/labor-law/server.ts
//   stdio：给任何支持 MCP 的客户端用（比如官方 MCP Inspector）；加 --stdio
// --liftoff-only 让向量模型的内存峰值从 545MB 降到 250MB（T03 在服务器上实测）。
// 工具都是只读的：查法条、查最低工资、按规则计算，不写任何数据。

import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { minWageFor } from "./min-wage.ts";
import { checkNonCompete } from "./rules/non-compete.ts";
import { checkPenalties, checkServicePeriod, checkSpecialBenefitPenalty } from "./rules/penalty.ts";
import { checkProbationLimit, checkProbationOnly } from "./rules/probation.ts";
import {
  checkDeposit,
  checkRequiredClauses,
  checkResignation,
  checkSocialInsurance,
  checkTerminationConditions,
  checkTripartite,
  checkUnilateralChange,
} from "./rules/terms.ts";
import type { Finding } from "./rules/types.ts";
import { checkProbationWage } from "./rules/wage.ts";
import { hybridSearch } from "./search.ts";
import { LawStore } from "./store.ts";

const DB = process.env.LAW_DB_PATH || "data/build/law.db";
let store: LawStore | null = null;
const getStore = () => (store ??= new LawStore(process.env.LAW_DB_PATH || DB));

/** 关闭数据库（测试结束时用；Windows 上文件开着删不掉） */
export function closeStore() {
  store?.close();
  store = null;
}

// 向量检索第一次用到时才加载模型；加载失败（比如服务器上没放模型文件）就只用全文检索
let embedder: Promise<{ embedQuery(q: string): Promise<Float32Array> } | null> | null = null;
function getEmbedder() {
  embedder ??= import("./embed.ts")
    .then((m) => m.Embedder.load(process.env.EMBED_MODEL_DIR || undefined))
    .catch((e) => {
      console.error(`向量模型加载失败，只用全文检索：${(e as Error).message}`);
      return null;
    });
  return embedder;
}

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });
const findings = (xs: (Finding | null)[]) => json({ findings: xs.filter((x) => x !== null) });
const readOnly = { readOnlyHint: true, openWorldHint: false };

// ── 输入结构 ──────────────────────────────────────────
const term = z.union([
  z.object({
    kind: z.literal("fixed"),
    start: z.string().describe("YYYY-MM-DD"),
    end: z.string().describe("YYYY-MM-DD"),
  }),
  z.object({ kind: z.literal("fixed"), months: z.number().positive() }),
  z.object({ kind: z.literal("open").describe("无固定期限") }),
  z.object({ kind: z.literal("task").describe("以完成一定工作任务为期限") }),
]);
const probation = z.union([
  z.object({ months: z.number().positive() }),
  z.object({ days: z.number().int().positive() }),
]);
const place = {
  city: z.string().optional(),
  province: z.string().optional(),
  tier: z.number().int().min(1).max(4).optional(),
};

export function buildServer(): McpServer {
  const server = new McpServer({ name: "labor-law", version: "0.1.0" });

  server.registerTool(
    "search_law",
    {
      description:
        "在劳动合同法、实施条例、劳动争议司法解释、民法典相关条文和最高法典型案例里检索。返回条文 ID、标题和原文。" +
        "口语和法条用词常常不同（社保／社会保险费，押金／收取财物），把同一个问题的法条说法放进 rewrites，结果一起合并排序。",
      inputSchema: {
        query: z.string().min(1).max(200),
        rewrites: z
          .array(z.string().min(1).max(200))
          .max(3)
          .default([])
          .describe("同一问题换成法条用语的说法，最多 3 个"),
        top_k: z.number().int().min(1).max(20).default(8),
      },
      annotations: readOnly,
    },
    async ({ query, rewrites, top_k }) => {
      const s = getStore();
      const e = s.hasVectors ? await getEmbedder() : null;
      const hits = (await hybridSearch(s, e, [query, ...rewrites], { k: top_k })).map((h) => ({
        id: h.id,
        kind: h.kind,
        title: h.title,
        text: h.text,
      }));
      return json({ hits });
    },
  );

  server.registerTool(
    "get_article",
    {
      description:
        "按条文 ID 取法条原文，可以是整条（ldhtf-19）或某一款（ldhtf-19-1）。返回法规名、条号、原文、版本和来源网址。",
      inputSchema: { id: z.string().regex(/^[a-z0-9-]+$/) },
      annotations: readOnly,
    },
    async ({ id }) => {
      const r = getStore().getArticle(id);
      if (!r) return { ...json({ error: `没有这个条文：${id}` }), isError: true };
      const p = r.paragraph;
      return json({
        id,
        law: r.article.law_title,
        label:
          r.article.law_short +
          r.article.label +
          (p
            ? `第${["", "一", "二", "三", "四", "五", "六", "七", "八", "九"][p.no] ?? p.no}款`
            : ""),
        text: p ? p.text : r.article.text,
        status: p?.status === "abolished" ? `已废止：${p.note}` : "有效",
        version: r.article.version,
        source: r.article.source_url,
      });
    },
  );

  server.registerTool(
    "lookup_min_wage",
    {
      description:
        "查当地月最低工资和小时最低工资（截至 2026-10-01）。城市不在表里或档位没核实时，返回该省各档，请让用户选档位。",
      inputSchema: place,
      annotations: readOnly,
    },
    async (q) => json(minWageFor(q)),
  );

  server.registerTool(
    "check_probation",
    {
      description:
        "R01~R03：试用期是否超过上限、是否不得约定、是否只约定了试用期（劳动合同法第十九条）。",
      inputSchema: {
        term: term.nullable(),
        probation: probation.nullable(),
        probationOnly: z.boolean().default(false),
      },
      annotations: readOnly,
    },
    async ({ term: t, probation: p, probationOnly }) =>
      findings([
        t ? checkProbationLimit(t, p) : null,
        checkProbationOnly({ probationOnly, term: t, probation: p }),
      ]),
  );

  server.registerTool(
    "check_probation_wage",
    {
      description: "R05：试用期工资是否低于约定工资的 80% 或当地最低工资。会按工作地点查最低工资。",
      inputSchema: {
        probationWage: z.number().positive(),
        agreedWage: z.number().positive().nullable().default(null),
        ...place,
      },
      annotations: readOnly,
    },
    async ({ probationWage, agreedWage, ...q }) => {
      const mw = q.city || q.province ? minWageFor(q) : null;
      const minWage =
        mw?.kind === "found"
          ? {
              monthly: mw.monthly,
              label: `${mw.city ?? mw.province}月最低工资 ${mw.monthly} 元（截至 ${mw.asOf}，${mw.doc}）`,
            }
          : null;
      const f = checkProbationWage({ probationWage, agreedWage, minWage });
      // 档位没定的城市，把各档一起返回，让模型提示用户选
      return json({ findings: f ? [f] : [], minWage: mw?.kind === "found" ? null : mw });
    },
  );

  server.registerTool(
    "check_penalty",
    {
      description:
        "R06~R08：劳动合同里的违约金。R06 服务期、竞业限制以外的违约金；R07 服务期违约金是否超过培训费分摊；R08 用户口、住房换服务期。三方协议的违约金请用 check_tripartite。",
      inputSchema: {
        penalties: z
          .array(
            z.object({
              trigger: z.enum([
                "service_period",
                "non_compete",
                "early_resign",
                "probation_resign",
                "notice",
                "confidentiality",
                "rules_violation",
                "other",
              ]),
              amount: z.number().nullable().default(null),
            }),
          )
          .default([]),
        servicePeriod: z
          .object({
            trainingKind: z.enum(["special", "onboarding", "unknown"]),
            trainingCost: z.number().nullable().default(null),
            serviceMonths: z.number().nullable().default(null),
            servedMonths: z.number().nullable().default(null),
            penalty: z.union([
              z.object({ kind: z.literal("full_cost") }),
              z.object({ kind: z.literal("prorated") }),
              z.object({ kind: z.literal("amount"), amount: z.number() }),
            ]),
          })
          .nullable()
          .default(null),
        specialBenefit: z
          .object({
            benefit: z.enum(["hukou", "housing", "other"]),
            serviceYears: z.number().nullable().default(null),
            amount: z.number().nullable().default(null),
          })
          .nullable()
          .default(null),
      },
      annotations: readOnly,
    },
    async ({ penalties, servicePeriod, specialBenefit }) =>
      findings([
        ...checkPenalties(penalties),
        servicePeriod ? checkServicePeriod(servicePeriod) : null,
        specialBenefit ? checkSpecialBenefitPenalty(specialBenefit) : null,
      ]),
  );

  server.registerTool(
    "check_non_compete",
    {
      description: "R09：竞业限制的期限、经济补偿和适用对象。",
      inputSchema: {
        present: z.boolean(),
        durationMonths: z.number().nullable().default(null),
        compensation: z.enum(["none", "agreed", "unknown"]),
        role: z.string().nullable().default(null),
        roleLevel: z
          .enum(["senior", "ordinary", "unknown"])
          .describe("senior：高管、高级技术人员、负有保密义务；ordinary：应届生、普通岗位"),
        duringEmploymentOnly: z.boolean().default(false),
      },
      annotations: readOnly,
    },
    async (input) => findings(checkNonCompete(input)),
  );

  server.registerTool(
    "check_deposit",
    {
      description: "R10：押金、保证金、担保、扣证件原件（劳动合同法第九条）。只核验原件不算违法。",
      inputSchema: {
        items: z.array(
          z.object({
            kind: z.enum([
              "deposit",
              "guarantee",
              "keep_original_certificate",
              "prepay_fee",
              "verify_original",
            ]),
            amount: z.number().nullable().default(null),
          }),
        ),
      },
      annotations: readOnly,
    },
    async ({ items }) => findings(checkDeposit(items)),
  );

  server.registerTool(
    "check_required_clauses",
    {
      description:
        "R11：劳动合同第十七条的必备条款是否齐全。只对劳动合同检查。被打码的劳动者信息算作有。",
      inputSchema: {
        docKind: z.string(),
        present: z
          .object({
            employer: z.boolean(),
            employee: z.boolean(),
            term: z.boolean(),
            job: z.boolean(),
            hours: z.boolean(),
            pay: z.boolean(),
            social_insurance: z.boolean(),
            protection: z.boolean(),
          })
          .partial(),
      },
      annotations: readOnly,
    },
    async (input) => findings([checkRequiredClauses(input)]),
  );

  server.registerTool(
    "check_tripartite",
    {
      description:
        "R12：三方协议、录用通知里的违约金和格式条款（民法典第四百九十六至四百九十八条、第五百八十五条）。",
      inputSchema: {
        penalties: z
          .array(z.object({ party: z.enum(["student", "employer"]), amount: z.number() }))
          .default([]),
        monthlyWage: z.number().nullable().default(null),
        standardTerms: z
          .array(z.string())
          .default([])
          .describe("单位预先拟定、加重学生责任的条款原文"),
      },
      annotations: readOnly,
    },
    async (input) => findings(checkTripartite(input)),
  );

  server.registerTool(
    "check_social_insurance",
    {
      description: "R13：约定不缴社保（解释（二）第十九条）。",
      inputSchema: { waived: z.boolean(), subsidy: z.number().nullable().default(null) },
      annotations: readOnly,
    },
    async (input) => findings([checkSocialInsurance(input)]),
  );

  server.registerTool(
    "check_unilateral_terms",
    {
      description: "R14~R16：单方调岗调薪、法定情形以外的解除条件、限制辞职。",
      inputSchema: {
        changes: z.array(z.enum(["position", "location", "wage"])).default([]),
        wageCut: z.boolean().default(false),
        refuseMeansResign: z.boolean().default(false),
        termination: z
          .array(
            z.object({
              kind: z.enum(["statutory", "probation_at_will", "other"]),
              text: z.string(),
            }),
          )
          .default([]),
        resignation: z
          .object({
            noticeDays: z.number().nullable().default(null),
            probationNoticeDays: z.number().nullable().default(null),
            needsApproval: z.boolean().default(false),
            penaltyOrDeduction: z.boolean().default(false),
          })
          .nullable()
          .default(null),
      },
      annotations: readOnly,
    },
    async ({ changes, wageCut, refuseMeansResign, termination, resignation }) =>
      findings([
        checkUnilateralChange({ changes, wageCut, refuseMeansResign }),
        ...checkTerminationConditions(termination),
        ...(resignation ? checkResignation(resignation) : []),
      ]),
  );

  return server;
}

/** 无状态 Streamable HTTP：每个请求新建一份 server 和 transport（SDK 推荐的无状态写法） */
export function startHttp(port: number, host = "127.0.0.1") {
  const http = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      console.error("MCP 请求处理失败", (e as Error).message);
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  return new Promise<typeof http>((ok) => http.listen(port, host, () => ok(http)));
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("mcp/labor-law/server.ts");
if (isMain) {
  if (process.argv.includes("--stdio")) {
    await buildServer().connect(new StdioServerTransport());
  } else {
    const port = Number(process.env.MCP_PORT) || 3101;
    await startHttp(port);
    console.error(`劳动法规 MCP 服务：http://127.0.0.1:${port}/mcp（库 ${DB}）`);
  }
}
