/* zcode-workflow
description: 对工作区未提交改动或指定基线以来的改动做整体评审：机器门禁（check-architecture /
  check-delete-guard / check-notify-guard / lane-surface 触达面判低——--staged-file 注入评审文件清单，判据作用于评审对象）+
  逐文件独立评审（P0/P1/P2 分级）+ 跨文件汇总定级去重 + 逐条独立复证，产出分级评审报告与发现看板。对应
  .agents/commands/review.md 横切评审，纯只读不改代码、不提交。
whenToUse: 用户说「评审一下」「过 review 标准」「按评审标准过一遍」，或一批改动完成后、合入前需要 P0/P1/P2
  分级问题清单时。纯只读：不改代码、不提交。参数 base 传基线 git ref 可评审已提交的一批（如
  base=131a61f），留空评审工作区未提交改动。
args:
  base:
    type: string
    description: diff 基线（git ref，如 origin/main、131a61f）；留空 = 工作区未提交改动（含未跟踪新文件）
    required: false
    default: ""
  focus:
    type: string
    description: 额外关注点，一句话（可选），会注入每个文件评审员的指令
    required: false
    default: ""
*/
interface ReviewFinding {
  /** 工作区相对路径，尽量带行号，如 "backend/src/A.cs:42"。 */
  where: string;
  /** 一句话：问题本身（不说怎么修）。 */
  what: string;
  /** 证据：读到的代码行，以及违反 .agents/commands/review.md 的哪一级哪一条。 */
  evidence: string;
  /** 初步分级：P0 必拦 / P1 应拦 / P2 建议（不拦合入）。 */
  severity: "P0" | "P1" | "P2";
}

interface FileReview {
  /** 评审的文件路径（工作区相对）。 */
  path: string;
  /** 发现的问题清单；无问题返回空数组。 */
  findings: ReviewFinding[];
  /** 一句话总评；无问题写「未见问题」。 */
  summary: string;
}

interface TriagedFinding extends ReviewFinding {
  /** 汇总者分配的稳定编号，如 "F1"。 */
  id: string;
  /** 同一根因合并进来的其他位置。 */
  mergedFrom: string[];
}

interface TriageResult {
  /** 去重合并、定级校准后的问题清单。 */
  findings: TriagedFinding[];
  /** 一句话：对整体改动面的总体印象。 */
  overall: string;
}

interface Confirmation {
  /** 独立复证是否成立。 */
  reproduced: boolean;
  /** 如何核实的（读了什么 / 跑了什么只读命令），或为什么不成立。 */
  note: string;
}

interface ReportFinding extends ReviewFinding {
  /** verified = 机器门禁或独立复证确认；unconfirmed = 复证未成立，仍列出待人工判断。 */
  status: "verified" | "unconfirmed";
}

// 可执行文件跨机解析（机理单源 runtime-env.md §6.3）：world.run 命令名须编译期字面量（运行确认时展示命令集），
// 故候选写成字面量包装逐个 --version 试跑（不存在的路径 spawn_error 可捕获，换下一个），首个跑通者复用于全部
// 调用点，全失败时调用点按名回退（PATH；实测按名 git 可能解析到失效副本，仅作末位兜底）。
type RunRes = { exitCode: number; stdout: string; stderr: string };
type Runner = (args: string[], opts?: { timeoutMs?: number }) => Promise<RunRes>;
interface Candidate { run: Runner }

async function firstRunning(candidates: Candidate[]): Promise<Candidate | null> {
  for (const c of candidates) {
    try {
      const r = await c.run(["--version"], { timeoutMs: 60000 });
      if (r.exitCode === 0) return c;
    } catch { /* 候选不存在或起不来，试下一个 */ }
  }
  return null;
}

const NODE_CANDIDATES: Candidate[] = [
  { run: (a, o) => world.run("C:/Program Files/nodejs/node.exe", a, o ?? {}) },
  { run: (a, o) => world.run("C:/Program Files (x86)/nodejs/node.exe", a, o ?? {}) },
  { run: (a, o) => world.run("node", a, o ?? {}) },
];
const GIT_CANDIDATES: Candidate[] = [
  { run: (a, o) => world.run("C:/Program Files/Git/cmd/git.exe", a, o ?? {}) },
  { run: (a, o) => world.run("C:/Program Files (x86)/Git/cmd/git.exe", a, o ?? {}) },
  { run: (a, o) => world.run("git", a, o ?? {}) },
];
// R5-1b：门禁实现随包分发，经 `flow-kit hook` / `flow-kit run` 调用。
const FLOW_KIT_CANDIDATES: Candidate[] = [
  { run: (a, o) => world.run("flow-kit", a, o ?? {}) },
];
const nodeHit = await firstRunning(NODE_CANDIDATES);
const gitHit = await firstRunning(GIT_CANDIDATES);
const kitHit = await firstRunning(FLOW_KIT_CANDIDATES);
const runNode: Runner = (nodeHit ?? NODE_CANDIDATES[NODE_CANDIDATES.length - 1]).run;
const runGit: Runner = (gitHit ?? GIT_CANDIDATES[GIT_CANDIDATES.length - 1]).run;
const runKit: Runner = (kitHit ?? FLOW_KIT_CANDIDATES[0]).run;
if (nodeHit === null || gitHit === null) {
  log(`⚠ 可执行文件未解析到：${[...(nodeHit === null ? ["node"] : []), ...(gitHit === null ? ["git"] : [])].join("、")}——标准安装位置与 PATH 均未命中，受影响门禁将记「未能运行」；安装后重跑，或核对 .agents/notes/runtime-env.local.md（模板 runtime-env.local.example.md）`);
}
if (kitHit === null) {
  log("⚠ flow-kit 未在 PATH：写前门/命令门/lane-surface 判定将记「未能运行」；请 npm install -g agentic-flow-kit");
}
function parseChanged(out: string): string[] {
  const paths: string[] = [];
  for (const rawLine of out.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim() === "") continue;
    if (line.startsWith("?? ")) {
      paths.push(line.slice(3).trim());
    } else if (line.length > 3 && !line.startsWith("!! ")) {
      paths.push(line.slice(3).trim());
    }
  }
  const cleaned: string[] = [];
  for (let p of paths) {
    if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = p.slice(1, -1);
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) p = p.slice(arrow + 4);
    if (p !== "") cleaned.push(p);
  }
  return cleaned;
}

function parseUntracked(out: string): string[] {
  const paths: string[] = [];
  for (const rawLine of out.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("?? ")) paths.push(line.slice(3).trim());
  }
  return paths.filter((p) => p !== "");
}

function reviewable(p: string): boolean {
  if (p.endsWith(".lock") || p.endsWith("package-lock.json")) return false;
  if (p.startsWith(".zcode/") || p.startsWith(".omp/")) return false;
  return true;
}

const baseArg = typeof args.base === "string" ? args.base.trim() : "";
const baseLabel = baseArg === "" ? "HEAD（工作区未提交改动）" : baseArg;
const focus = typeof args.focus === "string" ? args.focus.trim() : "";

artifact.board("findings", {
  title: "评审发现看板",
  key: "id",
  status: "status",
  columns: ["待复证", "已确认", "未复现"],
  cardTitle: "title",
  detail: [
    { field: "severity", label: "分级" },
    { field: "where", label: "位置" },
  ],
});

phase("收集改动文件并跑机器门禁");
const statusRun = await runGit(["status", "--porcelain"]);
let candidates: string[] = [];
if (baseArg === "") {
  candidates = parseChanged(statusRun.stdout);
} else {
  const diffRun = await runGit(["diff", "--name-only", baseArg]);
  const merged = new Set<string>([
    ...diffRun.stdout
      .split("\n")
      .map((l) => l.replace(/\r$/, "").trim())
      .filter((l) => l !== ""),
    ...parseUntracked(statusRun.stdout),
  ]);
  candidates = [...merged];
}
const skipped = candidates.filter((p) => !reviewable(p));
const paths = candidates.filter(reviewable);
log(`基线 ${baseLabel}：共 ${candidates.length} 个改动，跳过 ${skipped.length} 个（锁文件 / 本机目录），评审 ${paths.length} 个`);

if (paths.length === 0) {
  return {
    conclusion: `基线 ${baseLabel} 下没有可评审的改动文件，未执行评审。`,
    findings: [],
    verified: [],
    notCovered: ["无改动文件：机器门禁、逐文件评审、复证均未运行"],
  };
}

const gateScripts = [
  "check-architecture",
  "check-delete-guard",
  "check-notify-guard",
];
const gateRuns = await Promise.all(
  gateScripts.map(async (script) => {
    try {
      return { script, result: await runKit(["hook", script]) };
    } catch {
      return { script, result: null };
    }
  }),
);
const gateFindings: ReviewFinding[] = [];
const gateNotes: string[] = [];
for (const run of gateRuns) {
  if (run.result === null) {
    gateNotes.push(`${run.script} 未能运行`);
  } else if (run.result.exitCode === 0) {
    gateNotes.push(`${run.script} 通过`);
  } else {
    const out = `${run.result.stdout}\n${run.result.stderr}`.trim().slice(0, 2000);
    gateFindings.push({
      where: run.script,
      what: "机器门禁未通过",
      evidence: out === "" ? `退出码 ${run.result.exitCode}，无输出` : out,
      severity: "P0",
    });
    gateNotes.push(`${run.script} 未通过`);
  }
}
for (let i = 0; i < gateFindings.length; i++) {
  const f = gateFindings[i];
  report({ id: `M${i + 1}`, title: f.what, status: "已确认", severity: f.severity, where: f.where }, "findings");
}
// lane-surface 触达面判低门（zcode-wf-gate-sync 补齐）：check-lane-surface.mjs 判据默认读暂存 diff，
// 评审场景经 --staged-file 注入评审文件清单（每行一个仓库相对路径）使判据作用于评审对象；清单经 node -e
// 落 tmp/（gitignored）。命中 L2 触达面且无活跃 L2/L3 入口 → 判低 P0 发现；清单为空或脚本缺失则跳过不报。
const laneListPath = "tmp/lane-surface-input.txt";
const listWrite = await runNode([
  "-e",
  "require('fs').mkdirSync('tmp',{recursive:true}); require('fs').writeFileSync(process.argv[1], process.argv[2])",
  laneListPath,
  paths.join("\n"),
]);
if (listWrite.exitCode === 0 && paths.length > 0) {
  try {
    const lane = await runKit([
      "run",
      "check-lane-surface",
      "--staged-file",
      laneListPath,
    ]);
    if (lane.exitCode === 0) {
      gateNotes.push("flow-kit run check-lane-surface（触达面判低，注入评审清单）通过");
    } else {
      const out = `${lane.stdout}\n${lane.stderr}`.trim().slice(0, 2000);
      gateFindings.push({
        where: "flow-kit run check-lane-surface",
        what: "触达面判低：改动命中 L2 契约面（lane-surfaces.txt）——核对入口文档级别是否应就高",
        evidence: out === "" ? `退出码 ${lane.exitCode}，无输出` : out,
        severity: "P0",
      });
      gateNotes.push("flow-kit run check-lane-surface（触达面判低，注入评审清单）未通过");
    }
  } catch {
    gateNotes.push("flow-kit run check-lane-surface 未能运行");
  }
} else if (listWrite.exitCode !== 0) {
  gateNotes.push("flow-kit run check-lane-surface 未能运行（评审清单写入失败）");
}
log(`机器门禁：${gateNotes.join("；")}`);

phase("并行评审每个改动文件");
const failedPaths: string[] = [];
const reviews: FileReview[] = await Promise.all(
  paths.map(async (path) => {
    const areaRule = path.startsWith("backend/")
      ? "- backend/AGENTS.md（后端目录规则，必读）"
      : path.startsWith("frontend/")
        ? "- frontend/AGENTS.md（前端目录规则，必读）"
        : "";
    const ask = [
      `独立评审文件 ${path} 相对基线 ${baseLabel} 的改动。`,
      "",
      "先读评审标准与规则：",
      "- .agents/commands/review.md —— P0/P1/P2 分级清单；机器兜底之外的 P0 未覆盖项 + 全部 P1 是你的重点，P2 视情况",
      ...(areaRule === "" ? [] : [areaRule]),
      "- 根目录 AGENTS.md 的「Working rules」与「Review guidelines」",
      "",
      "再看改动：",
      `- 运行 git diff ${baseArg === "" ? "HEAD" : baseArg} -- ${path} 查看该文件改动；若 diff 无输出且文件存在，视为新增文件，直接通读全文`,
      "- 只看 diff 不够：读改动周边上下文与相关调用方 / 被调用方，判断正确性与回归风险",
      ...(focus === "" ? [] : ["", `本次额外关注点：${focus}`]),
      "",
      "只报真问题：正确性、回归风险、安全性、兼容性、数据一致性；纯风格偏好不报。宁缺毋滥，但 P0 级问题绝不放过。",
      "每条问题给 where（路径:行号）、what（一句话问题本身）、evidence（代码证据 + 违反 review.md 哪一条）、severity。报告前自问：这条有 file:line 级证据吗？不确定就别报或降级。",
      "不要修改任何文件，只运行只读命令。",
      "没有问题就返回空 findings，summary 写「未见问题」。",
    ].join("\n");
    try {
      return await agent(`评审-${path}`, {
        system:
          "你是独立代码评审员，只报告有代码证据支持的真问题，不修改任何文件；拿不准的不硬报。若评审标准与实际改动矛盾或指令无法执行，直接说明并上报，不要硬凑结论。",
      }).ask<FileReview>(ask);
    } catch {
      failedPaths.push(path);
      return { path, findings: [], summary: "评审子任务异常，该文件未完成评审" };
    }
  }),
);

const allFindings = reviews.flatMap((r) => r.findings);
let triaged: TriagedFinding[] = [];
let overall = "所有文件均未见问题";
if (allFindings.length > 0) {
  phase("汇总定级与跨文件合并");
  const triageResult = await agent("汇总定级", {
    system:
      "你是评审汇总定级员，在同一把尺子下合并与校准所有评审发现；宁可砍掉存疑条目也不放大噪声。拿不准的取舍在 overall 里说明。",
  }).ask<TriageResult>(
    [
      `以下是 ${paths.length} 个文件并行评审的全部发现（JSON）。请先读 .agents/commands/review.md，然后合并去重、校准定级：`,
      "- 同一根因出现在多条发现 / 多个文件的，合并为一条，mergedFrom 列出其余位置",
      "- 对照 review.md 重新校准每条 severity（P0 必拦 / P1 应拦 / P2 建议）",
      "- 砍掉证据不足、纯风格、不构成实际风险的条目",
      "- 给每条分配稳定编号 F1、F2……",
      "",
      JSON.stringify(allFindings),
    ].join("\n"),
  );
  triaged = triageResult.findings;
  overall = triageResult.overall;
  for (const f of triaged) {
    report({ id: f.id, title: f.what, status: "待复证", severity: f.severity, where: f.where }, "findings");
  }
}

const reportFindings: ReportFinding[] = [];
for (const g of gateFindings) {
  reportFindings.push({ ...g, status: "verified" });
}
if (triaged.length > 0) {
  phase("逐条独立复证");
  const results = await Promise.all(
    triaged.map(async (f, i) => {
      try {
        const c = await agent(`复证-${i + 1}`, {
          system:
            "你是独立复证员，只依据自己读到的证据判断，不复用报告者的结论；不修改任何文件。无法核实就如实说明，不要硬判成立。",
        }).ask<Confirmation>(
          [
            "独立复证以下代码评审发现是否成立（只凭你自己的证据判断）：",
            "",
            JSON.stringify(f),
            "",
            "步骤：打开 where 指向的文件与行，读足够上下文；必要时读相关调用方 / 被调用方；可用只读命令（如 grep、git log）核实。",
            "成立 → reproduced 为 true，note 写你核实的过程与依据。",
            "不成立 → reproduced 为 false，note 写证据为什么不支持。",
            "无法核实（例如需要运行完整测试套件）→ reproduced 为 false，note 说明局限。",
            "不要修改任何文件。",
          ].join("\n"),
        );
        return { finding: f, confirmation: c };
      } catch {
        return { finding: f, confirmation: { reproduced: false, note: "复证子任务异常，未能完成复证" } };
      }
    }),
  );
  for (const r of results) {
    const ok = r.confirmation.reproduced;
    reportFindings.push({ ...r.finding, status: ok ? "verified" : "unconfirmed" });
    report(
      {
        id: r.finding.id,
        title: r.finding.what,
        status: ok ? "已确认" : "未复现",
        severity: r.finding.severity,
        where: r.finding.where,
      },
      "findings",
    );
  }
}

const sevRank: Record<"P0" | "P1" | "P2", number> = { P0: 0, P1: 1, P2: 2 };
reportFindings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
const p0 = reportFindings.filter((f) => f.severity === "P0").length;
const p1 = reportFindings.filter((f) => f.severity === "P1").length;
const p2 = reportFindings.filter((f) => f.severity === "P2").length;
const verifiedCount = reportFindings.filter((f) => f.status === "verified").length;
// 精确匹配「…通过」：「…未通过」同样以「通过」结尾，endsWith 会把失败门计成通过
const passedNotes = gateNotes.filter((g) => g.endsWith("通过") && !g.endsWith("未通过"));

function section(title: string, list: ReportFinding[]): string[] {
  if (list.length === 0) return [`## ${title}`, "（无）", ""];
  return [
    `## ${title}`,
    ...list.map((f) =>
      [
        `### ${f.severity} ${f.what}`,
        `- 位置：${f.where}`,
        `- 证据：${f.evidence}`,
        `- 状态：${f.status === "verified" ? "已确认" : "复证未成立（仍列出，待人工判断）"}`,
      ].join("\n"),
    ),
    "",
  ];
}

const md = [
  `# 代码评审报告（基线：${baseLabel}）`,
  "",
  `- 评审文件：${paths.length} 个；跳过：${skipped.length === 0 ? "无" : skipped.join("、")}`,
  `- 机器门禁：${gateNotes.join("；")}`,
  `- 总体印象：${overall}`,
  ...(failedPaths.length > 0 ? [`- ⚠ 评审子任务异常未完成的文件：${failedPaths.join("、")}`] : []),
  "",
  ...section("P0 必拦（已确认）", reportFindings.filter((f) => f.severity === "P0" && f.status === "verified")),
  ...section("P1 应拦（已确认）", reportFindings.filter((f) => f.severity === "P1" && f.status === "verified")),
  ...section("P2 建议（已确认）", reportFindings.filter((f) => f.severity === "P2" && f.status === "verified")),
  ...section("复证未成立（待人工判断）", reportFindings.filter((f) => f.status === "unconfirmed")),
  "## 逐文件总评",
  ...reviews.map((r) => `- ${r.path}：${r.summary}`),
].join("\n");

await artifact.markdown("review-report", md, {
  title: "代码评审报告",
  description: `${paths.length} 个改动文件的 P0/P1/P2 分级评审结果与逐条复证状态`,
  primary: true,
});

return {
  conclusion: `评审 ${paths.length} 个改动文件；机器门禁 ${passedNotes.length}/${gateNotes.length} 通过；共 ${reportFindings.length} 条问题（P0 ${p0} / P1 ${p1} / P2 ${p2}），已确认 ${verifiedCount} 条、复证未成立 ${reportFindings.length - verifiedCount} 条。总体：${overall}`,
  findings: reportFindings,
  verified: [
    ...passedNotes,
    "每条非机器门禁发现均由独立复证员在全新上下文复核（机器门禁结论由命令退出码直接决定，无需复证）",
  ],
  notCovered: [
    "未运行 dotnet build / dotnet test / npm run build 完整静态门与集成测试（属 verify-gate 工作流职责）",
    "未做 UI 实测（headless Chrome）",
    "check-audit-fields.mjs（审计字段门禁）默认只扫暂存区新增行，对未暂存评审会假绿，未纳入机器门禁——该项由各文件评审员按 P0 清单自查",
    ...(failedPaths.length > 0 ? [`评审子任务异常的文件未完成评审：${failedPaths.join("、")}`] : []),
    ...(skipped.length > 0 ? [`锁文件 / 本机目录未评审：${skipped.join("、")}`] : []),
  ],
};