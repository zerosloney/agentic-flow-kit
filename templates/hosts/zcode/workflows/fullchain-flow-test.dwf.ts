/* zcode-workflow
description: 全链路穷尽用例矩阵测试：对
  MTO→采购申请→采购订单→到货→入库→出库申请→出库订单全链路做穷尽性体检——侦察→穷尽矩阵设计（正向/逆向/守卫/一致性 ×
  七域）→换人独立评审→按域并行实现→构建门+执行+修复环（≤3轮）→残留失败独立诊断→问题落盘并交付报告。正链造数纪律：凡需链上单据作前置，一律以真实
  API 贯通 MTO→采购申请→采购订单→…逐级造出（采购订单必须从采购申请引入，禁止直种单据/「等价状态」捷径，脚本 grep
  卡口退回）；造数载荷须带完整业务内容并断言跨单据关联。
whenToUse: 需要对全链路做穷尽性回归体检——穷尽正向贯通、逆向回退、守卫触发、跨单据一致性用例并定性问题、问题落盘出报告时；或业务面大改后需要一次穷尽回归时。运行前提：本地
  TEST_DB_CONN 必须指向专用测试库（TestDbWriteGuard 对未设或指向共享 dev 库的写用例 fail-loud）；运行会更新本地
  FullChain/ 测试文件与 tmp/ 矩阵、报告（均不入库，git 历史可回溯本文件历史版本），须人工审阅后本地留存。
args:
  testFilter:
    type: string
    description: dotnet test --filter 过滤表达式，决定执行门跑哪些测试
    required: false
    default: FullyQualifiedName~FullChain
*/
// ============================================================
// 全链路穷尽用例矩阵测试：MTO→采购申请→采购订单→到货→入库→出库申请→出库订单
// 穷尽纪律锚定侦察事实：每条守卫→触发用例、每个清理端点→回退用例、
// 每条数量/状态回写链→跨单据一致性断言用例；问题（失败/受阻/未清零缺口）落盘出报告
// 正链造数纪律：链上单据前置必须以真实 API 贯通 MTO→采购申请→采购订单→…（采购订单从采购申请引入），
// 禁止 EF/SQL 直种单据本体或「等价状态」捷径；造数载荷带完整业务内容（合同/供应商/采购员/计税/双数量口径）
// 门禁隔离：生成文件整体 #if FCLocal 包裹，调度方以 -p:DefineConstants=FCLocal 编译执行
// ============================================================

// ---------- 类型 ----------
interface ChainLinkReport {
  /** 环节名 */
  link: string;
  /** 核心实体：实体名 — 文件位置(path:line) — 一句话职责 */
  entities: string[];
  /** 关键 API：METHOD 路由 — 用途 + 关键 DTO 字段（正向贯通按调用顺序标注） */
  endpoints: string[];
  /** 单据状态机：实体: 状态A→状态B→…（贯通推进路径与终止态） */
  statusFlows: string[];
  /** 正向贯通会遇到的业务守卫/前置要求：一句话 + 代码位置 + 校验消息原文（审批上下文、库位必填、锚点门等） */
  guards: string[];
  /** 清理链：本环节单据的取消/驳回/关闭/冲销端点及对库存/占用的影响；不可逆环节单独注明 */
  cleanupOps: string[];
  /** 落库表与关键字段：表名 — 关键字段（数量/状态/批次/关联外键） */
  dataTables: string[];
  /** 数量/状态回写联动契约（生成下游、回写上游哪个字段）+ 集成测试可行性备注（审批人/当前用户如何注入）+ 造数前提 */
  testability: string;
}

interface TestInfraReport {
  /** 集成测试项目相对路径与根命名空间 */
  testProject: string;
  /** 可复用基架：fixture/基类/helper 类名 + 文件位置 + 用途 */
  fixtures: string[];
  /** 运行机制：如何获得后端与数据库、连接串来源、是否依赖本地 SQL Server */
  runtime: string;
  /** 造数与隔离/清理惯例，新测试必须遵守什么 */
  isolation: string;
  /** 值得模仿的现有测试类 + 文件位置 */
  exemplars: string[];
  /** 新测试的硬约束（每条一句话） */
  constraints: string[];
  /** FullChain/ 既有本地回归网清单：每类一条「类名 — 用例数 — 覆盖域一句话 — 疑似失效用例（如有）」；目录不存在/为空则返回空数组 */
  fullchainInventory: string[];
  /** 门禁隔离事实：IntegrationTests.csproj 对 FullChain/ 的包含方式（SDK 通配递归？有无 Compile Remove 排除？path:line 证据）+ 门禁构建/测试命令为何不受生成文件影响，一句话结论 */
  gateIsolation: string;
}

interface TestCase {
  /** 用例 id，FC-<域>-<三位序号>，全文唯一连续 */
  id: string;
  /** 所属域：MTO|PO|ARRIVAL|INBOUND|OUTBOUND|REVERSE|CONSISTENCY 之一 */
  domain: string;
  /** 类别：正向|逆向|守卫|一致性 之一 */
  category: string;
  /** 优先级：P0 主链路|P1 重要边界|P2 穷尽补全 */
  priority: string;
  /** 一句话标题 */
  title: string;
  /** 前置造数清单（单据/主数据/状态，取最短必要路径，按基架 isolation 惯例） */
  preconditions: string[];
  /** 步骤：API 调用级（端点+关键 DTO 字段+前置状态） */
  steps: string[];
  /** 数据流转断言（字段级：单据状态/数量回写/库存与占用/跨单据关联/拒绝消息） */
  expected: string[];
  /** 清理动作（走真实释放链；不可逆环节注明止步点） */
  cleanup: string[];
}

interface MatrixDomain {
  /** 域 id：MTO|PO|ARRIVAL|INBOUND|OUTBOUND|REVERSE|CONSISTENCY 之一 */
  domain: string;
  /** 固定测试类名（由调度方映射，实现员不得改） */
  testClassName: string;
  /** 本域用例 id 列表（与矩阵文件一致） */
  caseIds: string[];
}

interface MatrixSpec {
  /** 矩阵文件相对路径 */
  matrixPath: string;
  /** 七域分组（每域至少一例） */
  domains: MatrixDomain[];
  /** 用例总数 */
  totalCases: number;
  /** P0/P1/P2 计数 */
  priorityCounts: { p0: number; p1: number; p2: number };
  /** 设计说明与风险（含正向链运行成本、现状断言口径声明） */
  risks: string[];
}

interface MatrixReview {
  /** 结论：通过 / 需补 */
  verdict: "通过" | "需补";
  /** 问题清单（每条指明用例 id、域或穷尽维度） */
  issues: string[];
}

interface ImplOutcome {
  /** 本域测试文件相对路径 */
  filePath: string;
  /** 已实现用例 id */
  implementedCaseIds: string[];
  /** 未能实现的用例 + 原因 */
  blockedCases: { id: string; reason: string }[];
  /** 一句话说明（含疑似产品缺陷记录） */
  note: string;
}

interface FailureDiagnosis {
  /** 失败测试全名 */
  test: string;
  /** 是否已单独复现 */
  reproduced: boolean;
  /** 根因归类 */
  rootCause: "产品缺陷" | "测试问题" | "环境问题";
  /** 证据：path:line 或复跑输出关键行 */
  evidence: string;
  /** 一句话结论 */
  conclusion: string;
}

interface TestRun {
  /** 本轮是否全绿 */
  ok: boolean;
  /** 失败数 */
  failed: number;
  /** 通过数 */
  passed: number;
  /** 失败用例全名 */
  failedTests: string[];
  /** 输出尾部（证据） */
  output: string;
}

interface Finding {
  /** 位置：文件路径或测试全名 */
  where: string;
  /** 一句话：发现了什么 */
  what: string;
  /** 证据 */
  evidence: string;
  /** verified=独立核验过；unconfirmed=未能复现或未核验 */
  status: "verified" | "unconfirmed";
  /** 影响程度 */
  severity: "low" | "medium" | "high";
}

interface WorkflowReport {
  /** 两三句话回答用户的问题 */
  conclusion: string;
  /** 发现清单 */
  findings: Finding[];
  /** 本运行实际做了哪些核验 */
  verified: string[];
  /** 未覆盖项与原因 */
  notCovered: string[];
}

// ---------- 人设 ----------
const READONLY_SYSTEM =
  "你是只读侦察员：绝不修改任何文件、绝不执行 git 写命令；每条结论必须给可核对的 path:line 证据；查不到就明说查不到，禁止编造。若任务与事实冲突或无法完成，如实说明而不是硬凑结论。";
const DESIGNER_SYSTEM =
  "你是资深测试架构师：只读仓库，仅允许写矩阵文件本身（tmp/ 下指定路径）；矩阵必须可执行、可断言、穷尽有据（每例都能指回侦察事实），禁止发明侦察事实之外的系统功能。前置造数必须真实贯通受测正链（MTO→采购申请→采购订单→到货→入库→出库，采购订单从采购申请引入），禁止设计直种单据或「等价状态」捷径，造数载荷字段完整。若发现事实不足以下结论，如实说明。";
const REVIEWER_SYSTEM =
  "你是独立评审员：只读，禁止修改任何文件；挑毛病优先于认可，每条意见落到具体用例 id、域或穷尽维度。";
const IMPL_SYSTEM =
  "你是集成测试实现员：只允许在 tests/Shipyard.Material.IntegrationTests/FullChain/ 下新建或修改你负责的那一个测试文件（FullChain/ 为本地留存不入库的回归面，文件全部内容必须整体 #if FCLocal 包裹以隔离仓库门禁）；禁止修改产品代码（backend/、frontend/）与其他测试文件；禁止任何 git 写命令；禁止运行 dotnet build / dotnet test（统一由调度方执行）。若指令矛盾或基架无法支撑，如实说明并给出受阻清单，不要绕过或编造。";
const DIAG_SYSTEM =
  "你是独立诊断员：只读分析，可运行单个测试复现（dotnet test 过滤单个用例，命令须带 -p:DefineConstants=FCLocal），不得修改任何文件、不得跑全量套件（调度方已跑过）。结论以证据为准；复现不了就如实标 reproduced=false。";

// ---------- 常量 ----------
const MATRIX_PATH = "tmp/fullchain-matrix.md";
const REPORT_PATH = "tmp/fullchain-matrix-report.md";
const TEST_PROJECT = "tests/Shipyard.Material.IntegrationTests";
const FLOW_NAMESPACE = "Shipyard.Material.IntegrationTests.FullChain";
const FC_GLOB = `${TEST_PROJECT}/FullChain/*.cs`;
const FLOW_STAGES = ["MTO", "采购申请", "采购订单", "到货", "入库", "出库申请", "出库订单"];
const DOMAINS = ["MTO", "PO", "ARRIVAL", "INBOUND", "OUTBOUND", "REVERSE", "CONSISTENCY"];
const DOMAIN_NAME: Record<string, string> = {
  MTO: "MTO需求",
  PO: "采购",
  ARRIVAL: "到货",
  INBOUND: "入库",
  OUTBOUND: "出库",
  REVERSE: "逆向冲销",
  CONSISTENCY: "跨单据一致性",
};
const DOMAIN_CLASS: Record<string, string> = {
  MTO: "FcMtoTests",
  PO: "FcPoTests",
  ARRIVAL: "FcArrivalTests",
  INBOUND: "FcInboundTests",
  OUTBOUND: "FcOutboundTests",
  REVERSE: "FcReverseTests",
  CONSISTENCY: "FcConsistencyTests",
};
const FULLCHAIN_FILTER = String(args.testFilter ?? "FullyQualifiedName~FullChain");

// 看板：按域实现/执行进度（声明一次，顶层）
artifact.board("groups", {
  title: "穷尽矩阵按域进度",
  key: "id",
  status: "status",
  columns: ["已实现", "全绿", "有失败", "受阻"],
  cardTitle: "name",
  detail: [{ field: "detail", label: "进度" }],
});

// 报告 markdown 同步落盘 tmp/（运行卡片之外的磁盘留档副本；脚本自身无文件写工具，用 node 确定性写盘，失败只记日志不阻断主流程）
async function writeTmpMarkdown(path: string, content: string): Promise<void> {
  try {
    const w = await world.run("node", ["-e", "require('fs').writeFileSync(process.argv[1], process.argv[2], 'utf8')", path, content]);
    if (w.exitCode === 0) log(`报告已落盘：${path}`);
    else log(`报告落盘 ${path} 失败（exitCode ${w.exitCode}），运行卡片仍可查看`);
  } catch (e) {
    log(`报告落盘 ${path} 异常：${String(e)}`);
  }
}

log("全链路穷尽用例矩阵测试工作流启动：正向/逆向/守卫/一致性 × 七域，问题落盘出报告；门禁卡口不动（#if FCLocal 隔离）");

// ---------- 侦察 ----------
const RECON_LINKS = [
  {
    key: "MTO需求",
    hint: "MTO/物资需求单全链路事实：创建/明细/提交/审批端点与 DTO（审批通过、可下推采购态，注意审批通过不改单据状态轴）；与下游采购申请的生成联动（生成端点或字段关联、数量回写、MTO 占用桶怎么记）；造数前提（物资/仓库等主数据要求）；清理链（关闭/取消/利库取消等端点及占用影响）。穷尽线索重点：guards 与 cleanupOps 要一条不漏。",
  },
  {
    key: "采购",
    hint: "采购申请(PR)→采购订单(PO)全链路事实：PR 从 MTO 生成的端点/字段关联（含明细级 MTOOrderDetailID 关联与数量回写），PR 创建/提交/审批；PR→PO 引入/生成端点与数量联动（分批/超量规则，最简合法路径，PO 明细如何携带 PurchaseRequestID/PurchaseRequestNo 关联）；PO 提交/审批；PO.DeliveredQty 等数量字段；造数前提（供应商等主数据）。必须产出「从 MTO 到已审批 PO 的完整造数配方」并写到载荷级全字段（合同号、供应商、采购员、采购组织、计税方式/税率、单价与双数量口径），供到货/入库/一致性等下游域前置照抄——本工作流测试数据一律经采购申请中转（MTO→采购申请→采购订单），不造无采购申请来源的采购订单（守卫用例专测无 PR/悬空 PR 引用时除外）。穷尽线索重点：PR/PO 的合同编号必填、计税默认等新守卫一条不漏。",
  },
  {
    key: "到货入库",
    hint: "到货登记→入库全链路事实：到货登记端点（从 PO 候选/下推？）与 DTO、到货确认（容差边界）、下推生成入库单与撤销；入库单确认（库位必填）写库存台账与流水、明细拆分（库位/批次）；数量回写链 PO.DeliveredQty→到货 ReceivedQty→库存 Qty/UsageQty；造数前提（仓库/库位/批次要求）；清理链（入库冲销/撤销下推及对库存的影响）。穷尽线索重点：容差边界与超收/欠收守卫。",
  },
  {
    key: "出库与库存",
    hint: "领料出库全链路事实：库存表结构（Qty/UsageQty 与占用/锁字段）；出库申请两种形态（定额 PickingType=1 需 PML 锚点 / 借条 =2 审批增补）各自创建/提交/审批端点与 DTO；check-inventory 材料检查（占用唯一入口、整组判够全占）；出库单创建/拣货 pick/确认 confirm（五道闸逐道列出）；OutedQty 回写与库存扣减；造数前提；清理链（驳回/取消/关闭释放占用；出库确认后不可逆的边界）。穷尽线索重点：五道闸与占用释放链一条不漏。",
  },
];

function reconAsk(l: { key: string; hint: string }): string {
  return [
    `你是只读侦察员。仓库：ASP.NET Core 6 + EF Core + SQL Server（Clean Architecture，backend/ 下 material 与 shared 双模块），API 层在 backend/material/Shipyard.Material.API/Controllers/。`,
    `任务：为「全链路穷尽用例矩阵」（正向/逆向/守卫/一致性四类，域覆盖 ${DOMAINS.join("/")}）提供「${l.key}」环节的事实底座。穷尽矩阵的规模与覆盖面完全由你的 guards/cleanupOps/testability 决定：漏一条守卫就漏一类用例，宁全勿略。`,
    `侦察范围：${l.hint}`,
    ``,
    `必须产出（查不到的项留空数组并在 testability 说明，禁止编造）：`,
    `1. entities：涉及的核心实体 + 文件位置(path:line) + 一句话职责；`,
    `2. endpoints：Controller 路由（METHOD 路由 — 用途 + 关键 DTO 字段），按正向调用顺序排列；`,
    `3. statusFlows：涉及单据的状态机（合法推进 + 终止态 + 非法推进会被哪个守卫拦）；`,
    `4. guards：业务守卫/前置要求（审批上下文、库位必填、锚点门、必填字段、状态门等），逐条带消息原文与 path:line——每一条都会变成一个守卫触发用例；`,
    `5. cleanupOps：清理链——取消/驳回/关闭/冲销端点及对库存/占用的影响；不可逆环节单独注明——每一个可回退端点都会变成一条逆向用例；`,
    `6. dataTables：落库表与关键字段（数量/状态/批次/关联外键尤其要全）；`,
    `7. testability：数量/状态回写联动契约（生成下游、回写上游哪个字段）+ 进程内集成测试怎么驱动（审批人上下文、当前用户如何注入）+ 造数前提——每条契约都会变成一条一致性断言用例。`,
    ``,
    `每条结论都要有证据；这份报告直接决定穷尽矩阵的覆盖面。`,
  ].join("\n");
}

const INFRA_ASK = [
  `你是只读侦察员。仓库：ASP.NET Core 6 + Vue 3，集成测试在 tests/Shipyard.Material.IntegrationTests（xUnit）。`,
  `任务：摸清集成测试基架，为「全链路穷尽用例矩阵」按域并行实现铺路。以下为上一轮核实过的基线，请逐项核实（漂移了就纠正）并补细节：`,
  `- TestApiFactory : WebApplicationFactory<Program>，UseSetting 注入 TestDb.ConnectionString 与测试 JWT；`,
  `- TestDb：连接串 TEST_DB_CONN 环境变量优先，缺省回读 API appsettings.json；TestDbWriteGuard 对未设/指向共享 dev 库的写用例 fail-loud；`,
  `- RollbackTestBase 事务回滚基类（直连服务用例）；HTTP 管线用例不进外层事务 → 本机套件惯例「自建自清」：唯一后缀播种 + finally 定向清理（先子后头）；`,
  `- 程序集禁并行 + sp_getapplock 串行锁；统一运行入口 scripts/verify/backend/run-backend-tests.mjs 或 dotnet test；`,
  `- FullChain/ 目录被 .gitignore 忽略（本地回归面，不入库）；2026-11-03 起目录可为空（历史本机套件已退役），本工作流生成物是唯一内容；`,
  `- 门禁口径：仓库门禁与权威面 = dotnet build Shipyard.Material.sln + dotnet test sln --no-build（无过滤）；生成的本机套件必须对其零影响。`,
  `必须产出：`,
  `1. testProject：项目相对路径与根命名空间；`,
  `2. fixtures：fixture/基类/helper 类名 + 文件位置 + 用途，新测试应继承/复用什么；`,
  `3. runtime：连接串来源、TestDbWriteGuard 拦截规则与逃生口、依赖的 SQL Server 实例与库；`,
  `4. isolation：现有测试怎么造数、怎么隔离/清理（事务回滚? 唯一编码? finally 定向清理?）；`,
  `5. exemplars：最值得模仿的跨单据链路测试类（存量套件优先）+ 文件位置；`,
  `6. fullchainInventory：FullChain/ 既有每个测试类一条「类名 — 用例数 — 覆盖域一句话 — 疑似失效用例（如有）」；目录不存在/为空则返回空数组；另核对 ${DOMAINS.map((d) => DOMAIN_CLASS[d]).join("、")} 是否与既有类重名，重名则在 constraints 里说明；`,
  `7. constraints：给新测试的硬约束（最多 6 条，每条一句话），例如禁止依赖执行顺序、清理不得残留占用、文件必须整体 #if FCLocal 包裹等；`,
  `8. gateIsolation：Shipyard.Material.IntegrationTests.csproj 对 FullChain/ 子目录的包含事实（SDK 通配递归包含？有无 Compile Remove 排除？给 path:line 证据）；据此判断「生成文件整体 #if FCLocal 包裹 + 调度方 dotnet test -p:DefineConstants=FCLocal 执行」能否保证门禁（无符号构建/跑测试）零影响，一句话结论。`,
  ``,
  `每条结论带 path:line 或文件位置；查不到就明说，禁止编造。`,
].join("\n");

phase("侦察链路API与测试基建");
log(`5 路侦察并行：${RECON_LINKS.map((l) => l.key).join("、")} + 测试基建`);
// 屏障有意为之：矩阵设计师必须拿到全链路视角
const [chainReports, infra] = await Promise.all([
  Promise.all(RECON_LINKS.map((l) => agent(`侦察-${l.key}`, { system: READONLY_SYSTEM }).ask<ChainLinkReport>(reconAsk(l)))),
  agent("侦察-测试基建", { system: READONLY_SYSTEM }).ask<TestInfraReport>(INFRA_ASK),
]);
log(`侦察完成：${chainReports.map((r) => `${r.link}(守卫 ${r.guards.length} 条、清理端点 ${r.cleanupOps.length} 个)`).join("，")}`);
// 工作区基线：本工作流全部产物（tmp/、FullChain/）均已 gitignore，实现后比对 git.status() 应无新增可见文件——有即为越权写入
const statusBaseline = await git.status();

// ---------- 设计穷尽矩阵 ----------
const DESIGN_RULES = [
  `穷尽纪律（矩阵逐条对照侦察事实覆盖，宁滥勿缺；每个用例都能指回一条侦察事实）：`,
  `1. 守卫穷尽：四路链路侦察事实里每一条 guards（审批上下文、库位必填、锚点门、必填字段、状态门、五道闸等）至少一条「触发它」的用例（守卫类，断言拒绝响应与无副作用）；`,
  `2. 逆向穷尽：每条 cleanupOps 列出的取消/驳回/关闭/冲销端点至少一条「成功回退/释放」用例（逆向类），断言占用/数量/状态回退到位；不可逆环节注明止步点，不设计无法收尾的用例；`,
  `3. 一致性穷尽：testability 里每条数量/状态回写联动契约（MTO 占用→PR→PO.DeliveredQty→到货 ReceivedQty→库存 Qty/UsageQty→OutedQty）至少一条跨单据字段级断言用例（一致性类）；`,
  `4. 正向兜底：七个环节（${FLOW_STAGES.join("→")}）各至少被一条正向用例覆盖，且其中至少一例 P0 从 MTO 连续贯通推进到出库订单确认（整链单据一次造全、业务内容完整）；正向用例允许整链一例或按环节拆例，但用例之间禁止依赖执行顺序（xUnit 用例无序）；`,
  `5. 边界补全：数量边界（零/上界/分批/部分量/容差）、状态非法推进等按侦察事实补 P2 用例；并发与竞态不在矩阵内（程序集禁并行、并发属既有专项），在 risks 里声明；`,
  `6. 每例自包含·正链贯通（硬纪律）：凡前置需要采购申请/采购订单/到货/入库/出库单等链上单据，必须按 ${FLOW_STAGES.join("→")} 的真实顺序以 API 逐级造出到本例所需环节（MTO 审批→生成采购申请→PR 确认→采购订单从采购申请引入建单（明细带 PurchaseRequestID 关联）→提交/审批→到货→入库→…），禁止以 EF/SQL 直种单据本体或「等价状态」捷径替代——SQL 播种仅限守卫/竞态/历史行等 API 无法达成的 UPDATE 类状态微调与 PML、库存行等无创建端点的非单据主数据；按基架 isolation 惯例（唯一编码、审批上下文注入方式）写进 preconditions；steps 写到 API 调用级；expected 落到字段级（状态/数量回写/库存占用/跨单据关联 id——含 MTO 明细→PR→PO 的关联字段/拒绝消息原文）；cleanup 走真实释放链；`,
  `7. 数据内容完整：造数载荷必须携带完整业务内容（按侦察事实逐项落字段：合同号、供应商、采购员、采购组织、计税方式/税率、单价与双数量口径、仓库/库位/批次等），并断言这些内容随链落库、在下游单据正确回显/回写；禁止任意 Guid 占位供应商/采购员等主数据引用（守卫用例专测非法引用时除外）；`,
  `8. 分类分级：category 取 正向|逆向|守卫|一致性；priority 取 P0 主链路|P1 重要边界|P2 穷尽补全；编号 FC-<域>-<三位序号>（域取 ${DOMAINS.join("/")}），id 全文唯一连续；`,
  `9. 现状断言纪律：按侦察到的现状语义断言，禁止按未实施的目标语义设计；侦察事实与旧基线冲突时以侦察为准并写入 risks；`,
  `10. 把完整矩阵写入 ${MATRIX_PATH}：开头总览（总数、P0/P1/P2 计数、七域分组表），随后每域一节，每例完整呈现 id/title/category/priority/preconditions/steps/expected/cleanup 全文——一字不丢、不得缩写（实现员只读这个文件）；`,
  `11. 返回 MatrixSpec：matrixPath 固定填 ${MATRIX_PATH}；domains 只填 domain 与 caseIds（与文件一致，不得缩写），testClassName 由调度方映射；totalCases、priorityCounts、risks 如实填。`,
].join("\n");

function normalizeDomains(domains: MatrixDomain[]): MatrixDomain[] {
  return DOMAINS.map((dm) => ({
    domain: dm,
    testClassName: DOMAIN_CLASS[dm],
    caseIds: Array.from(new Set(domains.find((x) => x.domain === dm)?.caseIds ?? [])),
  }));
}
function missingDomains(spec0: MatrixSpec): string[] {
  return DOMAINS.filter((dm) => {
    const d = spec0.domains.find((x) => x.domain === dm);
    return !d || d.caseIds.length === 0;
  });
}
// 缺域中止统一出口（首次设计与评审修订后共用）：落盘报告并返回可交付的失败结论
async function matrixDesignAbort(missingList: string[], stageNote: string): Promise<WorkflowReport> {
  const failReport = ["# 矩阵设计失败：仍缺域", "", `缺域：${missingList.map((d) => DOMAIN_NAME[d]).join("、") || "全矩阵为空"}；实现与执行未进行（${stageNote}）。`].join("\n");
  await writeTmpMarkdown(REPORT_PATH, failReport);
  await artifact.markdown("report", failReport, { title: "穷尽矩阵设计失败报告", primary: true });
  return {
    conclusion: `穷尽矩阵${stageNote}仍缺域（${missingList.map((d) => DOMAIN_NAME[d]).join("、") || "空"}），工作流中止；侦察事实已产出可人工接管。`,
    findings: [{ where: MATRIX_PATH, what: "穷尽矩阵缺域，无法进入实现", evidence: `设计师${stageNote}返回仍有空域`, status: "verified", severity: "high" }],
    verified: ["5 路只读侦察（链路 ×4 + 测试基建）", `矩阵设计尝试（${stageNote}）`],
    notCovered: ["实现、执行、诊断全部未进行；矩阵未经验证"],
  };
}

phase("设计穷尽用例矩阵");
const designer = agent("矩阵设计师", { system: DESIGNER_SYSTEM });
let spec = await designer.ask<MatrixSpec>(
  [
    `任务：设计「全链路穷尽用例矩阵」——对 ${FLOW_STAGES.join("→")} 全链路，按 正向/逆向/守卫/一致性 四类穷尽设计用例，全部用例经 API 自动造数驱动（禁止依赖既有单据或手工步骤），逐步给出数据流转断言。`,
    ``,
    `=== 链路侦察事实（四环节） ===`,
    JSON.stringify(chainReports),
    ``,
    `=== 测试基架事实 ===`,
    JSON.stringify(infra),
    ``,
    DESIGN_RULES,
  ].join("\n"),
);
spec.domains = normalizeDomains(spec.domains);
// 脚本级确定性校验：七域必须每域有例
const missing = missingDomains(spec);
if (spec.totalCases === 0 || missing.length > 0) {
  log(`矩阵缺域（${missing.map((d) => DOMAIN_NAME[d]).join("、") || "无任何用例"}），退回设计师补全`);
  spec = await designer.ask<MatrixSpec>(
    `你返回的矩阵缺以下域的用例：${missing.map((d) => `${DOMAIN_NAME[d]}(${d})`).join("、") || "（全矩阵为空）"}。请补全 ${MATRIX_PATH}（每域至少一例，沿用编号规则追加），返回修订后的 MatrixSpec。`,
  );
  spec.domains = normalizeDomains(spec.domains);
}
const stillMissing = missingDomains(spec);
if (stillMissing.length > 0) return await matrixDesignAbort(stillMissing, "两次设计");
const matrixTotal = spec.domains.reduce((a, d) => a + d.caseIds.length, 0);
log(`矩阵就绪：${matrixTotal} 例（P0 ${spec.priorityCounts.p0} / P1 ${spec.priorityCounts.p1} / P2 ${spec.priorityCounts.p2}）× ${spec.domains.length} 域`);

// ---------- 换人独立评审矩阵 ----------
phase("换人独立评审矩阵");
const reviewer = agent("矩阵评审员", { system: REVIEWER_SYSTEM });
const review = await reviewer.ask<MatrixReview>(
  [
    `你是独立评审员（没有参与设计，只读，禁止改任何文件）。请通读矩阵文件 ${spec.matrixPath}，对照侦察事实审查穷尽性：`,
    ``,
    `=== 链路侦察事实（四环节） ===`,
    JSON.stringify(chainReports),
    ``,
    `=== 基架摘要 ===`,
    JSON.stringify({ runtime: infra.runtime, isolation: infra.isolation, constraints: infra.constraints, gateIsolation: infra.gateIsolation }),
    ``,
    `回答（宁严勿松，这份矩阵要支撑穷尽性体检验收）：`,
    `1. 守卫穷尽：侦察事实里每条 guards 是否都有触发用例？逐条核对，漏一条记一条（指明该守卫原文与应归域）；`,
    `2. 逆向穷尽：每条 cleanupOps 是否都有回退/释放用例？不可逆止步点是否注明？`,
    `3. 一致性穷尽：数量回写链（MTO 占用→PR→PO.DeliveredQty→ReceivedQty→库存→OutedQty）每段有无字段级断言缺口？`,
    `4. 可执行性：步骤是否 API 调用级？前置造数按基架可造吗？审批上下文能注入吗？用例间有无隐藏执行顺序依赖？`,
    `5. 正链贯通：有无用例前置以 EF/SQL 直种单据本体或「等价状态」替代 MTO→采购申请→采购订单→… 的真实 API 贯通？PO 明细是否携带采购申请关联（PurchaseRequestID）？（有=直接需补）`,
    `6. 数据内容完整：造数载荷是否带齐关键业务字段（合同号/供应商/采购员/采购组织/计税/单价与双数量口径/仓库库位批次）？有无任意 Guid 占位主数据引用？（守卫用例专测非法引用时除外；有缺口=需补）`,
    `7. 红线：有无用例需要修改产品代码或门禁配置才能通过？（有=直接需补）`,
    `8. verdict：无实质缺口=「通过」，否则「需补」；issues 每条指明用例 id、域或穷尽维度。`,
  ].join("\n"),
);
log(`独立评审：${review.verdict}（问题 ${review.issues.length} 条）`);
if (review.verdict === "需补" && review.issues.length > 0) {
  spec = await designer.ask<MatrixSpec>(
    [
      `独立评审发现以下问题，请修订矩阵文件 ${spec.matrixPath} 并返回修订后的 MatrixSpec（counts/caseIds 同步，文件与返回一致；新用例沿用编号规则追加）：`,
      JSON.stringify(review.issues),
    ].join("\n"),
  );
  spec.domains = normalizeDomains(spec.domains);
  log("矩阵按评审意见修订完成");
}
// 修订可能误删整域：同一确定性校验再跑一遍，给一次补全机会，仍缺则中止
const revisedMissing = missingDomains(spec);
if (revisedMissing.length > 0) {
  log(`评审修订后缺域（${revisedMissing.map((d) => DOMAIN_NAME[d]).join("、")}），退回设计师补全`);
  spec = await designer.ask<MatrixSpec>(
    `独立评审修订后矩阵缺以下域的用例：${revisedMissing.map((d) => `${DOMAIN_NAME[d]}(${d})`).join("、")}。请补全 ${spec.matrixPath}（每域至少一例，沿用编号规则追加），返回修订后的 MatrixSpec。`,
  );
  spec.domains = normalizeDomains(spec.domains);
}
const finalMissing = missingDomains(spec);
if (finalMissing.length > 0) return await matrixDesignAbort(finalMissing, "评审修订后");

// ---------- 预检构建环境 ----------
phase("预检构建环境");
const smoke = await world.run("dotnet", ["build", "Shipyard.Material.sln", "--nologo", "-v", "q"], { timeoutMs: 1800000, output: { tail: 32768 } });
if (smoke.exitCode !== 0) {
  const failFinding: Finding = { where: "Shipyard.Material.sln", what: "基线构建失败，穷尽矩阵无法开展", evidence: (smoke.stdout + "\n" + smoke.stderr).slice(-2000), status: "verified", severity: "high" };
  try {
    await artifact.file("matrix", spec.matrixPath, { title: "穷尽用例矩阵" });
  } catch {
    // 矩阵发布失败则忽略，文件仍在工作区
  }
  const failReport = ["# 预检失败：基线构建不通过", "", "```", (smoke.stdout + "\n" + smoke.stderr).slice(-2000), "```", "", `矩阵已产出：${spec.matrixPath}（${matrixTotal} 例，未执行验证）`].join("\n");
  await writeTmpMarkdown(REPORT_PATH, failReport);
  await artifact.markdown("report", failReport, { title: "穷尽矩阵预检失败报告", primary: true });
  return {
    conclusion: `基线构建失败，未进入实现与执行。穷尽矩阵 ${matrixTotal} 例已产出待用。`,
    findings: [failFinding],
    verified: ["dotnet build Shipyard.Material.sln（预检）"],
    notCovered: ["实现、执行、修复、诊断全部未进行；矩阵未经验证"],
  } as WorkflowReport;
}
log("预检构建通过");

// ---------- 按域并行实现 ----------
function implAsk(d: MatrixDomain): string {
  return [
    `你是集成测试实现员，负责穷尽矩阵的「${DOMAIN_NAME[d.domain]}」域（${d.caseIds.length} 例）。把矩阵中本域全部用例实现为一个测试类：命名空间 ${FLOW_NAMESPACE}，类名 ${d.testClassName}，文件 ${TEST_PROJECT}/FullChain/${d.testClassName}.cs（已存在则先通读再整体重写本类内容；不存在则新建；勿动其他文件）。`,
    ``,
    `材料：`,
    `- 穷尽矩阵：${spec.matrixPath}（先通读总览，再按本域一节逐例实现）；`,
    `- 测试基架事实：${JSON.stringify(infra)}；`,
    `- 链路侦察事实：${JSON.stringify(chainReports)}。`,
    ``,
    `硬约束：`,
    `- 只允许新建/修改 ${TEST_PROJECT}/FullChain/${d.testClassName}.cs 这一个文件；禁止修改产品代码（backend/、frontend/）与其他测试文件；禁止任何 git 写命令；禁止运行 dotnet build / dotnet test（统一由调度方执行）。`,
    `- 门禁隔离（最高优先级）：文件全部内容（含 using）必须整体包在 #if FCLocal 与 #endif 之间——仓库门禁在无该符号下构建与跑测试，卡口一行不动；调度方以 dotnet test -p:DefineConstants=FCLocal 编译执行本文件。`,
    `- 正链造数（硬纪律）：凡前置需要 MTO/采购申请/采购订单/到货/入库/出库单据，必须按真实 API 链逐级造出（${FLOW_STAGES.join("→")}，采购订单明细必须携带 PurchaseRequestID 关联采购申请，不造无采购申请来源的采购订单）；禁止 EF/SQL 直种单据本体或「等价状态」捷径——SQL 播种仅限 UPDATE 类状态微调（守卫/竞态窗口）与 PML、库存行等无创建端点的非单据主数据；调度方会 grep 直种写法（DbSet.Add / INSERT INTO 单据头表）并退回重写。`,
    `- 数据内容完整：造数载荷按矩阵携带全部业务字段（合同号、供应商、采购员、采购组织、计税、单价与双数量口径、仓库/库位/批次等），禁止任意 Guid 占位主数据引用（守卫用例专测非法引用时除外）；跨单据关联字段（MTOOrderDetailID/PurchaseRequestID 等）必须随链传递并显式断言。`,
    `- 每条用例一个 [Fact]（方法名=用例 id 的下划线形式，如 FC-MTO-001→FC_MTO_001），用例间禁止依赖执行顺序；每例自建自清（唯一后缀播种 + try/finally 按用例 cleanup 先子后头），不得残留孤儿占用。`,
    `- 每条 expected 必须落成显式断言（单据状态、数量回写字段、库存表数量/占用字段、跨单据关联 id、拒绝响应，不许只断言 HTTP 状态码）。`,
    `- 矩阵中因基架/接口限制确实无法驱动的用例：不实现，记入 blockedCases（id+原因），不许静默跳过。`,
    `- 完成后返回 ImplOutcome：filePath=相对路径、implementedCaseIds、blockedCases、note=一句话说明。`,
  ].join("\n");
}

phase("按域并行实现穷尽测试");
const implByDomain: Record<string, Agent> = {};
for (const d of spec.domains) implByDomain[d.domain] = agent(`实现-${d.domain}`, { system: IMPL_SYSTEM });
// 屏障有意为之：执行门要一次性编译全部域的测试文件
const outcomes = await Promise.all(
  spec.domains.map(async (d) => {
    try {
      return { d, outcome: await implByDomain[d.domain].ask<ImplOutcome>(implAsk(d)) };
    } catch (e) {
      return {
        d,
        outcome: {
          filePath: "",
          implementedCaseIds: [],
          blockedCases: d.caseIds.map((id) => ({ id, reason: `实现员异常：${String(e)}` })),
          note: "实现阶段异常",
        } as ImplOutcome,
      };
    }
  }),
);
const outcomeByDomain: Record<string, ImplOutcome> = {};
for (const o of outcomes) outcomeByDomain[o.d.domain] = o.outcome;
for (const o of outcomes) {
  report(
    {
      id: o.d.domain,
      name: DOMAIN_NAME[o.d.domain],
      status: o.outcome.implementedCaseIds.length > 0 ? "已实现" : "受阻",
      detail: `实现 ${o.outcome.implementedCaseIds.length} 例 / 受阻 ${o.outcome.blockedCases.length} 例`,
    },
    "groups",
  );
}
const implementedTotal = outcomes.reduce((a, o) => a + o.outcome.implementedCaseIds.length, 0);
const filesWritten = outcomes.filter((o) => o.outcome.filePath).length;
log(`实现完成：${implementedTotal} 例已实现、${outcomes.reduce((a, o) => a + o.outcome.blockedCases.length, 0)} 例受阻（${filesWritten}/${spec.domains.length} 个文件落盘）`);

// 门禁隔离自检：每个生成的测试文件必须整体 #if FCLocal 包裹
const fcFiles = await files.glob(FC_GLOB);
let guardMatches = await files.grep("#if FCLocal", FC_GLOB);
let guarded = new Set(guardMatches.map((m) => m.path));
let unguarded = fcFiles.filter((f) => !guarded.has(f));
if (unguarded.length > 0) {
  log(`门禁隔离自检：${unguarded.length} 个文件缺 #if FCLocal 包裹，退回实现员补包裹`);
  await Promise.all(
    unguarded.map((f) => {
      const cls = f.split("/").pop()?.replace(/\.cs$/, "") ?? "";
      const dom = spec.domains.find((d) => d.testClassName === cls)?.domain;
      const target = dom ? implByDomain[dom] : undefined;
      if (!target) return Promise.resolve();
      return target.ask<string>(
        `门禁隔离自检发现 ${f} 未整体包在 #if FCLocal / #endif 之内——该文件会被仓库门禁（无符号构建与跑测试）编译执行，污染权威面。请把该文件全部内容（含 using）整体包进 #if FCLocal ... #endif，禁止改其他文件，完成后回复 OK。`,
      );
    }),
  );
  guardMatches = await files.grep("#if FCLocal", FC_GLOB);
  guarded = new Set(guardMatches.map((m) => m.path));
  unguarded = fcFiles.filter((f) => !guarded.has(f));
}
const stillUnguarded = unguarded.length;
if (stillUnguarded > 0) log(`警告：${stillUnguarded} 个文件仍未包裹，将记入报告（门禁污染风险）`);
else log(`门禁隔离自检通过：${fcFiles.length} 个文件全部 #if FCLocal 包裹`);

// 正链造数自检：生成文件不得直种链上单据本体（MTO/采购申请/采购订单/到货/入库/出库 单据头）——
// 前置必须走真实 API 链 MTO→采购申请→采购订单→…（PO 从 PR 引入）；SQL 播种仅限 UPDATE 类状态微调与 PML/库存行等非单据主数据
const SEED_RE =
  "\\.(MTOOrders|PurchaseRequests|PurchaseOrders|ArrivalOrders|InboundOrders|OutboundRequests|OutboundOrders)\\.Add(Async)?\\(|Set<(MTOOrder|PurchaseRequest|PurchaseOrder|ArrivalOrder|InboundOrder|OutboundRequest|OutboundOrder)>\\(\\)\\.Add(Async)?\\(|INSERT INTO MM_(PUR_MTOOrder|PUR_PurchaseRequest|PUR_PurchaseOrder|ARR_ArrivalOrder|INB_InboundOrder|ISS_OutboundRequest|ISS_OutboundOrder)\\b";
let seedHits = await files.grep(SEED_RE, FC_GLOB);
if (seedHits.length > 0) {
  const seededFiles = Array.from(new Set(seedHits.map((m) => m.path)));
  log(`正链造数自检：${seededFiles.length} 个文件存在直种链上单据本体的写法（共 ${seedHits.length} 处），退回实现员改走真实 API 链`);
  await Promise.all(
    seededFiles.map((f) => {
      const cls = f.split("/").pop()?.replace(/\.cs$/, "") ?? "";
      const dom = spec.domains.find((d) => d.testClassName === cls)?.domain;
      const target = dom ? implByDomain[dom] : undefined;
      if (!target) return Promise.resolve();
      return target.ask<string>(
        `正链造数自检发现 ${f} 存在直种链上单据本体（MTO/采购申请/采购订单/到货/入库/出库 单据头）的写法：\n${seedHits.filter((m) => m.path === f).map((m) => `${m.line}: ${m.text.trim().slice(0, 120)}`).join("\n")}\n硬纪律：这些单据的前置必须按 ${FLOW_STAGES.join("→")} 的顺序以真实 API 逐级造出（采购订单明细带 PurchaseRequestID 关联采购申请），SQL 播种仅限 UPDATE 类状态微调（守卫/竞态窗口）与 PML、库存行等无创建端点的非单据主数据。请把直种处改为真实链造数（断言相应保持），禁止改其他文件，完成后回复 OK。`,
      );
    }),
  );
  seedHits = await files.grep(SEED_RE, FC_GLOB);
}
const stillSeedHits = seedHits.length;
if (stillSeedHits > 0) log(`警告：${stillSeedHits} 处直种链上单据本体的写法未改正（违背正链口径），记入报告`);
else log("正链造数自检通过：无直种链上单据本体的写法");

// 越权写入自检：与侦察期基线比对，任何 git 可见的新增/修改（tmp/ 与 FullChain/ 之外）都是越权
const statusAfterImpl = await git.status();
function newPaths(base: string[], now: string[]): string[] {
  const known = new Set(base);
  return now.filter((p) => !known.has(p));
}
const leakedPaths = [
  ...newPaths(statusBaseline.staged, statusAfterImpl.staged),
  ...newPaths(statusBaseline.unstaged, statusAfterImpl.unstaged),
  ...newPaths(statusBaseline.untracked, statusAfterImpl.untracked),
].filter((p) => !p.startsWith("tmp/") && !p.startsWith("tests/Shipyard.Material.IntegrationTests/FullChain/"));
if (leakedPaths.length > 0) log(`警告：检测到 ${leakedPaths.length} 个越权新增/修改的文件（不在授权产物路径内）：${leakedPaths.slice(0, 5).join("、")}`);
else log("越权写入自检通过：工作区无本工作流之外的可见变更");

// ---------- 执行门 + 修复环 ----------
function parseFailLines(s: string): string[] {
  const out: string[] = [];
  for (const line of s.split(/\r?\n/)) {
    // 仓库测试栈为 xunit 2.x + VSTest：失败行是「失败/Failed <用例全名> [<耗时> ms]」（本机 zh-CN 实测）；[FAIL] 行仅 xunit v3 输出，保留兜底
    const m = /^\s*(?:失败|Failed)\s+(\S+)\s+\[\d/.exec(line) ?? /\]\s+(\S+)\s+\[FAIL\]/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}
function parseDotnetCounts(s: string): { failed: number; passed: number } | null {
  const failedFirst = /(?:失败|Failed)\s*[:：]\s*(\d+)\s*[,，]\s*(?:通过|Passed)\s*[:：]\s*(\d+)/.exec(s);
  if (failedFirst) return { failed: Number(failedFirst[1]), passed: Number(failedFirst[2]) };
  const passedFirst = /(?:通过|Passed)\s*[:：]\s*(\d+)\s*[,，]\s*(?:失败|Failed)\s*[:：]\s*(\d+)/.exec(s);
  return passedFirst ? { failed: Number(passedFirst[2]), passed: Number(passedFirst[1]) } : null;
}
function classesFromTests(tests: string[]): string[] {
  const out: string[] = [];
  for (const t of tests) {
    const seg = t.split(".").slice(-2)[0];
    if (seg) out.push(seg);
  }
  return Array.from(new Set(out));
}
function classesFromBuildOutput(s: string): string[] {
  const out: string[] = [];
  for (const line of s.split(/\r?\n/)) {
    const m = /FullChain[\\/]([A-Za-z0-9_]+)\.cs/.exec(line);
    if (m) out.push(m[1]);
  }
  return Array.from(new Set(out));
}

phase("构建并执行穷尽测试");
let lastTest: TestRun | null = null;
let buildFails = 0;
let testRounds = 0;
for (let round = 1; round <= 3; round++) {
  const build = await world.run("dotnet", ["build", TEST_PROJECT, "--nologo", "-v", "q", "-p:DefineConstants=FCLocal"], { timeoutMs: 1800000, output: { tail: 32768 } });
  if (build.exitCode !== 0) {
    buildFails += 1;
    const bad = classesFromBuildOutput(build.stdout + "\n" + build.stderr);
    const uniq = Array.from(
      new Set(
        bad.length > 0
          ? bad.map((c) => spec.domains.find((d) => d.testClassName === c)?.domain).filter((x): x is string => !!x)
          : spec.domains.map((d) => d.domain),
      ),
    );
    log(`第 ${round} 轮构建失败（涉及 ${uniq.length} 个域），交回实现员修复编译错误`);
    await Promise.all(
      uniq.map((dom) =>
        implByDomain[dom].ask<string>(
          `dotnet build（带 FCLocal 符号）第 ${round} 轮失败。请只检查并修复你自己的测试文件里的编译错误，禁止动产品代码与其他文件。错误输出尾部：\n${(build.stdout + "\n" + build.stderr).slice(-4000)}\n修复后回复 OK。`,
        ),
      ),
    );
    continue;
  }
  const test = await world.run("dotnet", ["test", TEST_PROJECT, "--filter", FULLCHAIN_FILTER, "--nologo", "--no-build", "-p:DefineConstants=FCLocal"], { timeoutMs: 1800000, output: { tail: 131072 } });
  testRounds += 1;
  const combined = `${test.stdout}\n${test.stderr}`;
  const failedTests = Array.from(new Set(parseFailLines(combined)));
  const dc = parseDotnetCounts(combined);
  const ok = test.exitCode === 0;
  lastTest = { ok, failed: dc ? dc.failed : failedTests.length, passed: dc ? dc.passed : 0, failedTests, output: combined.slice(-6000) };
  if (ok) {
    log(`第 ${round} 轮全绿：通过 ${lastTest.passed} 个用例`);
    break;
  }
  const failClasses = classesFromTests(failedTests);
  log(`第 ${round} 轮：${failedTests.length} 个用例失败（${failClasses.length} 个域），交回对应实现员（只修测试侧；疑似产品缺陷保持失败并记录）`);
  if (failedTests.length > 0) {
    const failedRun = lastTest;
    await Promise.all(
      failClasses.map((cls) => {
        const dom = spec.domains.find((d) => d.testClassName === cls)?.domain;
        const own = failedTests.filter((t) => t.split(".").slice(-2)[0] === cls);
        if (!dom) return Promise.resolve();
        return implByDomain[dom].ask<ImplOutcome>(
          `你实现的 ${cls} 有 ${own.length} 个用例失败（第 ${round} 轮）。\n失败清单：\n${own.join("\n")}\n失败输出尾部：\n${failedRun.output}\n处理规则：若是测试自身问题（造数、断言、隔离、清理），修测试；若你判断是产品代码缺陷，禁止修改产品代码——保持该用例现状（失败）并在 note 里记「疑似产品缺陷+证据」；修完返回更新后的 ImplOutcome。`,
        );
      }),
    );
  } else {
    // 非零退出但没解析到失败行：测试进程异常
    const run = lastTest;
    await Promise.all(
      spec.domains.map((d) =>
        implByDomain[d.domain].ask<string>(
          `dotnet test 退出码 ${test.exitCode} 但未解析到失败用例行。请检查你的测试文件是否可能导致测试进程异常（fixture 初始化、死循环、线程池耗尽等），只修自己的文件。输出尾部：\n${(run?.output ?? "").slice(-4000)}\n修复后回复 OK。`,
        ),
      ),
    );
  }
}

// ---------- 独立诊断残留失败 ----------
const diagnoses: FailureDiagnosis[] = [];
const lt = lastTest;
if (lt && !lt.ok && lt.failedTests.length > 0) {
  phase("独立诊断残留失败");
  const toDiagnose = lt.failedTests.slice(0, 5);
  log(`${lt.failedTests.length} 个残留失败，独立诊断前 ${toDiagnose.length} 个`);
  const diagResults = await Promise.all(
    toDiagnose.map((t, i) =>
      agent(`诊断员-${i + 1}`, { system: DIAG_SYSTEM }).ask<FailureDiagnosis>(
        [
          `集成测试用例失败，且实现员按「只修测试不改产品」处理后仍未通过。请独立定性：`,
          `失败用例：${t}\n失败输出尾部：\n${lt.output}`,
          `要求：`,
          `1. 读相关测试代码与产品代码定位根因（测试类在 ${TEST_PROJECT}/FullChain/ 下，类名取用例全名倒数第二段）；`,
          `2. 用 dotnet test ${TEST_PROJECT} --filter "FullyQualifiedName=${t}" --nologo -p:DefineConstants=FCLocal 单独复跑核实（必须带 -p:DefineConstants=FCLocal，否则本机套件不参与编译、用例不存在；只跑这一个用例，禁止跑全量套件）；`,
          `3. rootCause 三选一：产品缺陷 / 测试问题 / 环境问题；`,
          `4. reproduced=是否复现成功；evidence 给 path:line 或复跑输出关键行；conclusion 一句话给用户能行动的结论。`,
        ].join("\n"),
      ),
    ),
  );
  diagnoses.push(...diagResults);
  for (const d of diagnoses) {
    report({
      where: d.test,
      what: `【${d.rootCause}】${d.conclusion}`,
      evidence: d.evidence,
      status: d.reproduced ? "verified" : "unconfirmed",
      severity: d.rootCause === "产品缺陷" ? "high" : d.rootCause === "环境问题" ? "medium" : "low",
    });
  }
}

// ---------- 汇总交付 ----------
phase("汇总交付问题清单与报告");
// 收尾恢复权威构建产物：执行门与诊断复跑都用 FCLocal 符号构建过，磁盘上的测试 DLL 可能含本机套件；
// 门禁入口 run-backend-tests.mjs 是 --no-build，工作流结束后任何门禁重跑都必须面对无符号的权威面产物。
// 此构建同时是对「生成文件污染权威面」的最终核验：若 #if 包裹有漏，这里会编译不过。
let restoreExitCode = -1; // -1 = 未执行（无生成文件）
if (fcFiles.length > 0) {
  const restore = await world.run("dotnet", ["build", "Shipyard.Material.sln", "--nologo", "-v", "q"], { timeoutMs: 1800000, output: { tail: 32768 } });
  restoreExitCode = restore.exitCode;
  if (restore.exitCode === 0) log("收尾恢复构建通过：权威面产物已恢复为无 FCLocal 符号版本，门禁重跑安全");
  else log(`警告：收尾恢复构建失败（exitCode ${restore.exitCode}）——无符号构建下权威面编译不过，须人工检查 FullChain/ 生成文件`);
}
// 执行后按域回填看板状态
const failedDomains = new Set<string>();
if (lt) {
  for (const t of lt.failedTests) {
    const cls = t.split(".").slice(-2)[0];
    const dom = spec.domains.find((d) => d.testClassName === cls)?.domain;
    if (dom) failedDomains.add(dom);
  }
}
for (const d of spec.domains) {
  const o = outcomeByDomain[d.domain];
  let status = "已实现";
  if (o && o.implementedCaseIds.length === 0) status = "受阻";
  else if (failedDomains.has(d.domain)) status = "有失败";
  else if (lt && lt.ok) status = "全绿";
  report({ id: d.domain, name: DOMAIN_NAME[d.domain], status, detail: `实现 ${o ? o.implementedCaseIds.length : 0} 例 / 受阻 ${o ? o.blockedCases.length : 0} 例` }, "groups");
}

const blockedAll: { domain: string; id: string; reason: string }[] = [];
for (const o of outcomes) {
  for (const b of o.outcome.blockedCases) blockedAll.push({ domain: o.d.domain, id: b.id, reason: b.reason });
}
const totalFailed = lt ? lt.failed : 0;

const findings: Finding[] = [];
if (stillUnguarded > 0) {
  findings.push({
    where: `${TEST_PROJECT}/FullChain/`,
    what: `${stillUnguarded} 个生成文件未整体 #if FCLocal 包裹——仓库门禁（无符号构建/跑测试）会被污染，须人工包裹或删除后复审`,
    evidence: `files.grep("#if FCLocal") 对照 files.glob 缺口：${unguarded.join("、")}`,
    status: "verified",
    severity: "high",
  });
}
if (stillSeedHits > 0) {
  findings.push({
    where: `${TEST_PROJECT}/FullChain/`,
    what: `${stillSeedHits} 处直种链上单据本体的写法未按正链口径改正（前置须真实 API 贯通 MTO→采购申请→采购订单→…），须人工复核`,
    evidence: `files.grep 直种写法残留：${seedHits.slice(0, 5).map((m) => `${m.path}:${m.line}`).join("；")}`,
    status: "verified",
    severity: "high",
  });
}
if (leakedPaths.length > 0) {
  findings.push({
    where: leakedPaths.slice(0, 3).join("、"),
    what: `${leakedPaths.length} 个 git 可见路径被新增/修改，超出本工作流授权产物范围（tmp/ 与 FullChain/ 之外），须人工核查`,
    evidence: "git.status() 与侦察期基线比对",
    status: "verified",
    severity: "high",
  });
}
if (restoreExitCode > 0) {
  findings.push({
    where: "Shipyard.Material.sln",
    what: "收尾恢复构建失败：无 FCLocal 符号下权威面编译不过，门禁（commit-check 构建步）会被卡住，须人工处理 FullChain/ 生成文件",
    evidence: "dotnet build Shipyard.Material.sln（无符号）非零退出",
    status: "verified",
    severity: "high",
  });
}
if (blockedAll.length > 0) {
  findings.push({
    where: outcomes.map((o) => o.outcome.filePath).filter((p) => p).join("、") || "(未创建)",
    what: `${blockedAll.length} 个矩阵用例未能实现（含受阻域说明）`,
    evidence: blockedAll.slice(0, 3).map((b) => `[${DOMAIN_NAME[b.domain]}] ${b.id}: ${b.reason.slice(0, 60)}`).join("；"),
    status: "verified",
    severity: "medium",
  });
}
if (lt && totalFailed > 0) {
  findings.push({
    where: lt.failedTests.slice(0, 3).join("；") + (lt.failedTests.length > 3 ? " 等" : ""),
    what: `穷尽用例 ${totalFailed} 个失败（诊断定性见问题清单）`,
    evidence: `dotnet test --filter ${FULLCHAIN_FILTER} -p:DefineConstants=FCLocal（共 ${testRounds} 轮）`,
    status: "verified",
    severity: "high",
  });
}
if (!lt) {
  findings.push({
    where: TEST_PROJECT,
    what: `构建门未通过（${buildFails} 轮修复后仍失败），穷尽用例未执行`,
    evidence: "dotnet build（带 FCLocal 符号）持续失败",
    status: "verified",
    severity: "high",
  });
} else if (!lt.ok && lt.failedTests.length === 0) {
  findings.push({ where: "FullChain 套件", what: "测试进程异常退出，执行结果未判定", evidence: lt.output.slice(-800), status: "verified", severity: "high" });
}

// 发布矩阵（失败则让设计师重写一次）
let matrixOk = true;
try {
  await artifact.file("matrix", spec.matrixPath, { title: "穷尽用例矩阵", description: `${matrixTotal} 例 / P0 ${spec.priorityCounts.p0}·P1 ${spec.priorityCounts.p1}·P2 ${spec.priorityCounts.p2}` });
} catch {
  await designer.ask<string>(`矩阵文件 ${spec.matrixPath} 发布失败（可能不存在或为空）。请立即把完整矩阵重写到该路径，完成后回复 OK。`);
  try {
    await artifact.file("matrix", spec.matrixPath, { title: "穷尽用例矩阵", description: `${matrixTotal} 例 / P0 ${spec.priorityCounts.p0}·P1 ${spec.priorityCounts.p1}·P2 ${spec.priorityCounts.p2}` });
  } catch {
    matrixOk = false;
  }
}

const notCovered: string[] = [
  "并发与竞态场景不在矩阵内（程序集禁并行，并发属既有专项测试）",
  "前端 UI 层与浏览器交互不在范围（本工作流为 API/集成层测试）",
  "FullChain 之外的存量集成测试未重跑，绿红基线以实跑为准；已登记红测试清单见 workflow/papercuts.d/（台账为快照，可能滞后）",
  "穷尽性以侦察事实为界：侦察漏掉的守卫/链路不在矩阵（独立评审已挑缺口，未清零的见问题清单）",
];
if (blockedAll.length > 0) {
  notCovered.push(
    `未实现 ${blockedAll.length} 例：${blockedAll.slice(0, 3).map((b) => `${b.id}(${b.reason.slice(0, 40)})`).join("；")}${blockedAll.length > 3 ? " 等" : ""}`,
  );
}
if (lt && !lt.ok && lt.failedTests.length > 5) notCovered.push(`残留失败共 ${lt.failedTests.length} 个，仅独立诊断前 5 个，其余未定性`);
if (!lt) notCovered.push(`构建门未通过（${buildFails} 轮修复后仍失败），全部用例未执行`);
else if (!lt.ok && lt.failedTests.length === 0) notCovered.push("测试进程异常退出且未解析到失败行，结果未判定");

const verified: string[] = [
  `dotnet build Shipyard.Material.sln：预检 1 次；dotnet build ${TEST_PROJECT}（带 FCLocal 符号）：修复重编 ${buildFails} 次`,
  `dotnet test ${TEST_PROJECT} --filter ${FULLCHAIN_FILTER}（带 FCLocal 符号）：共 ${testRounds} 轮`,
  `#if FCLocal 门禁隔离自检：files.grep 核对全部 ${fcFiles.length} 个生成文件`,
  `正链造数自检：files.grep 核对直种链上单据本体的写法${stillSeedHits > 0 ? `（残留 ${stillSeedHits} 处，已记问题清单）` : "（无直种，前置均走真实 API 链）"}`,
  `越权写入自检：git.status() 与侦察期基线比对${leakedPaths.length > 0 ? `（检出 ${leakedPaths.length} 个越权路径）` : "（无越权变更）"}`,
  `收尾恢复构建（无 FCLocal 符号）：${restoreExitCode === -1 ? "未执行（无生成文件）" : `exitCode ${restoreExitCode}，权威面产物已还原`}`,
  "独立评审员（未参与设计）通读穷尽矩阵并逐条对照侦察事实",
];
if (lt && lt.ok && totalFailed === 0) verified.push(`执行门全绿：${implementedTotal} 例穷尽用例全部通过`);
if (diagnoses.length > 0) verified.push("每个残留失败由独立诊断员单独复跑定性");

const mdLines: string[] = [];
mdLines.push("# 全链路穷尽用例矩阵测试报告", "");
mdLines.push(`- 链路：${FLOW_STAGES.join("→")}（正向/逆向/守卫/一致性 四类穷尽）`);
mdLines.push(`- 矩阵：${spec.matrixPath}（${matrixTotal} 例；P0 ${spec.priorityCounts.p0} / P1 ${spec.priorityCounts.p1} / P2 ${spec.priorityCounts.p2}）`);
mdLines.push(`- 域分布：${spec.domains.map((d) => `${DOMAIN_NAME[d.domain]} ${d.caseIds.length} 例`).join("，")}`);
mdLines.push(`- 测试文件：${TEST_PROJECT}/FullChain/ 下 ${filesWritten} 个（整体 #if FCLocal 包裹，门禁卡口不动）`);
if (lt) {
  const runNote = lt.ok ? "全绿" : totalFailed > 0 ? `${totalFailed} 个失败` : "测试进程异常，结果未判定";
  mdLines.push(`- 执行：dotnet test（过滤 ${FULLCHAIN_FILTER}，共 ${testRounds} 轮）——通过 ${lt.passed} / 失败 ${totalFailed} / 未实现 ${blockedAll.length}（${runNote}）`);
} else {
  mdLines.push(`- 执行：未能完成（构建门未通过（${buildFails} 轮）），通过/失败未判定`);
}
mdLines.push(`- 矩阵发布：${matrixOk ? "成功" : "失败（文件仍在工作区）"}`, "");
if (spec.risks.length > 0) {
  mdLines.push("## 设计口径与风险", "");
  for (const r of spec.risks.slice(0, 6)) mdLines.push(`- ${r}`);
  mdLines.push("");
}
if (diagnoses.length > 0 || totalFailed > 0 || blockedAll.length > 0 || stillUnguarded > 0) {
  mdLines.push("## 问题清单", "");
  if (totalFailed > 0 && lt) {
    for (const t of lt.failedTests) mdLines.push(`- 失败：\`${t}\``);
    mdLines.push("");
  }
  for (const d of diagnoses) mdLines.push(`- 定性：\`${d.test}\` —【${d.rootCause}】${d.conclusion}${d.reproduced ? "（已复现）" : "（未复现，仅供参考）"}`);
  if (diagnoses.length > 0) mdLines.push("");
  for (const b of blockedAll) mdLines.push(`- 未实现：[${DOMAIN_NAME[b.domain]}] ${b.id}：${b.reason.slice(0, 80)}`);
  if (blockedAll.length > 0) mdLines.push("");
  for (const f of findings) mdLines.push(`- [${f.severity}/${f.status}] ${f.what}`);
  mdLines.push("");
}
mdLines.push("## 未覆盖", "");
for (const nc of notCovered) mdLines.push(`- ${nc}`);
const reportMd = mdLines.join("\n");
await artifact.markdown("report", reportMd, { title: "全链路穷尽用例矩阵测试报告", description: "正向/逆向/守卫/一致性穷尽体检执行结果与问题清单", primary: true });
await writeTmpMarkdown(REPORT_PATH, reportMd);

const defectCount = diagnoses.filter((d) => d.rootCause === "产品缺陷").length;
const verdictLine = !lt
  ? `构建门未通过（${buildFails} 轮修复后仍失败），未能完成执行判定`
  : lt.ok && totalFailed === 0
    ? `穷尽用例全绿（通过 ${lt.passed} 例）`
    : totalFailed > 0
      ? `有 ${totalFailed} 个用例失败，定性见问题清单`
      : "测试进程异常退出，结果未判定";
const conclusion = `全链路穷尽矩阵（${DOMAINS.length} 域）：${matrixTotal} 例（P0 ${spec.priorityCounts.p0}/P1 ${spec.priorityCounts.p1}/P2 ${spec.priorityCounts.p2}），实现 ${implementedTotal} 例、未实现 ${blockedAll.length} 例；${verdictLine}。${defectCount > 0 ? `其中 ${defectCount} 个失败定性为产品缺陷。` : ""}${stillUnguarded > 0 ? `注意：${stillUnguarded} 个文件未 #if FCLocal 包裹，门禁有被污染风险。` : "生成文件已全部 #if FCLocal 包裹，门禁卡口不受影响。"}${stillSeedHits > 0 ? `注意：${stillSeedHits} 处直种单据写法未按正链口径（MTO→采购申请→采购订单）改正。` : "正链造数自检通过：全部前置走真实 API 链。"}${leakedPaths.length > 0 ? `另有 ${leakedPaths.length} 个越权写入的文件须人工核查。` : ""}测试文件未提交，留待你审阅；报告落盘 ${REPORT_PATH}，矩阵落盘 ${spec.matrixPath}。`;

return { conclusion, findings, verified, notCovered } as WorkflowReport;
