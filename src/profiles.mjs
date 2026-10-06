// 宿主注册表 + 技术栈 profile + init 生成的 owned 基线配置
// fs/path 仅供 srcTemplatePath（模板下发感知）——显式 import，不依赖 Node 22+ 的全局 fs（engines >=18）
import fs from 'node:fs';
import path from 'node:path';
// stack 决定门禁配置三处：commit-check 的条件构建（builds）与质量检测（checks，秒级确定性
// 检查——lint/类型/vet；测试不放提交门，关单在 test.md 阶段门）、settings.json 的自检验
// 命令权限（allow）、AGENTS.md「项目适配区」命令预填；不改工作流流程本身。
// checks.when / builds.when = 条件才启用。文件路径或尾部 * 通配表示配置文件存在；
// pkg:scripts.build 表示 package.json 里该脚本为非空字符串。没有对应配置的项目自动跳过，
// 不 fail-closed 误拦。none = 不配置（项目日后自填）。
export const HOSTS = {
  // 2026-10-05 宿主本地化撤销：zcode / omp 原 localOnly:true（init 与 add-host 会把 .zcode/、.omp/
  // 整目录写进装户 .gitignore）。改为 false 后七个宿主一律入库，换宿主不丢文件、CI 克隆面与本仓一致。
  // 代价是 zcode 的会话级液态草稿（.zcode/drafts/、.zcode/plans/）改由装户自己加 .gitignore 规则；
  // 本仓 .gitignore 净效果保留这两行草稿规则（实例见根 .gitignore），.zcode/agents/*.md 保持 tracked（2026-09-27 gate-coverage 独立复核确立）。
  zcode: { dir: '.zcode', localOnly: false },
  opencode: { dir: '.opencode', localOnly: false, commandPrefix: 'wf-' },
  trae: { dir: '.trae', localOnly: false, commandPrefix: 'wf-' },
  omp: { dir: '.omp', localOnly: false },
  // 2026-09-29 店面：序号仍把 zcode 放第一（交互菜单 1–4 不变）。claude / cursor 的 commands 由宿主自动加载；
  // codex 自动读仓库根 AGENTS.md 与 .codex/skills/，commands 与 agents 是同形薄转发，供显式引用。
  claude: { dir: '.claude', localOnly: false, commandPrefix: 'wf-' },
  cursor: { dir: '.cursor', localOnly: false, commandPrefix: 'wf-' },
  codex: { dir: '.codex', localOnly: false, commandPrefix: 'wf-' },
};
// commandPrefix = 该宿主的命令层薄适配文件名（= 宿主命令名）统一前缀，2026-09-28 opencode-cmd-wf-prefix
// 与 trae 对齐后单源：命令名不再裸占宿主顶层命名空间（撞宿主内置/第三方命令无从规避）；缺该字段的宿主
// 表示只有角色层适配、不参与 commands 权威源映射（zcode/omp）。sync-hosts（包源侧）与 doctor §7.x
// （装户侧）两份实现均从本表派生，新增命令层宿主只改这一处。

const ESLINT_CONFIGS = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc',
];

export const STACKS = {
  dotnet: {
    build: 'dotnet build',
    test: 'dotnet test',
    typecheck: 'dotnet build（编译即类型检查）',
    builds: [{ name: 'backend', command: 'dotnet build', ext: ['.cs', '.sln', '.csproj'] }],
    checks: [{ name: 'format', command: 'dotnet format --verify-no-changes', ext: ['.cs'], when: ['*.sln'] }],
    allow: ['dotnet build', 'dotnet run', 'dotnet test', 'dotnet format'],
  },
  node: {
    build: 'npm run build',
    test: 'npm test',
    typecheck: 'npx tsc --noEmit（或 npm run typecheck）',
    builds: [{ name: 'build', command: 'npm run build', ext: ['.ts', '.tsx', '.vue', '.js', '.jsx', '.mjs', '.cjs'], when: ['pkg:scripts.build'] }],
    checks: [
      { name: 'typecheck', command: 'npx tsc --noEmit', ext: ['.ts', '.tsx'], when: ['tsconfig.json'] },
      { name: 'lint', command: 'npx eslint .', ext: ['.ts', '.tsx', '.js', '.jsx', '.vue'], when: ESLINT_CONFIGS },
    ],
    allow: ['npm test'],
  },
  python: {
    build: '（Python 无统一构建命令，按项目填）',
    test: 'python -m pytest',
    typecheck: '（可选：mypy）',
    builds: [],
    checks: [{ name: 'lint', command: 'ruff check .', ext: ['.py'], when: ['ruff.toml', '.ruff.toml'] }],
    allow: ['python -m pytest', 'pytest', 'ruff check'],
  },
  go: {
    build: 'go build ./...',
    test: 'go test ./...',
    typecheck: 'go vet',
    builds: [{ name: 'build', command: 'go build ./...', ext: ['.go'] }],
    checks: [{ name: 'vet', command: 'go vet ./...', ext: ['.go'], when: ['go.mod'] }],
    allow: ['go build', 'go test', 'go vet'],
  },
  none: {
    build: '<填写>',
    test: '<填写>',
    typecheck: '<填写>',
    builds: [],
    checks: [],
    allow: [],
  },
};

// 技术栈别名归一：ts/js 用户口径 → node 栈（init 交互与 --stack 共用；别名不进 kit.json，落盘始终是规范名）
export const STACK_ALIASES = {
  ts: 'node',
  js: 'node',
  typescript: 'node',
  javascript: 'node',
};

// AGENTS.md「项目适配区」的命令预填变量（技术栈未知时留 <填写> 占位）
export function pickStackVars(stackKey) {
  const s = STACKS[stackKey] || STACKS.none;
  return { BUILD_CMD: s.build, TEST_CMD: s.test, TYPECHECK_CMD: s.typecheck };
}

// 两态文件模型的归属判定：managed（随包升级）之外皆 owned（项目内容，sync 永不覆盖）
// local-pre-commit 是项目门禁挂载点——一旦接线即含项目内容，按 owned 起步（旧台账里若在 managed，改动后 sync 也会保守跳过）
// metric-claims.txt 是**项目自持的指标登记表**（2026-09-28 metric-claim-gate 复核 P2 更正）：装户按
// 设计要在其中新增自有指标，若按 managed 记账则 sync 每次都报「本地已改、升级时需合并」，且将来包侧
// 新增内置指标**永远下不来**（台账停在包侧基线）。故归 owned——随包附带一份起步内容，此后归项目。
// metric-derivers.cjs 是**项目自持的取数器模块**（2026-09-28 adopter-derivers）：它正是上面那份登记表的
// 扩展点——装户在此实现自有指标的取数逻辑。**必须与 metric-claims.txt 同归 owned**：若落 managed，
// 装户一用该功能就会让 sync 永久报「本地已改」、doctor WARN，并因供应链防线使 check-loop 跳过执行
// （门禁静默停摆）——那正是本单要修的缺陷本身（同名 incident 有实测链路）。
// **后缀为 .cjs 而非 .mjs**（2026-09-28 跨版本实测修正）：首版用 .mjs + require(esm)，实测在
// Node 18.20 / 20.18 / 22.11 全部 ERR_REQUIRE_ESM（只有 ≥20.19/≥22.12 可用），而本仓 engines
// 写 >=18.0.0、CI 跑 18/22 → 装户在 CI 目标版本上根本用不了。改 .cjs 后 createRequire 同步载入
// 全线可用。旧 .mjs 路径同样登记为 owned（免装户残留旧文件时落 managed 重演缺陷）。
export function isOwned(rel) {
  return rel === 'AGENTS.md' || rel === '.gitattributes' || rel.startsWith('workflow/') || rel.startsWith('wiki/')
    || rel.startsWith('.agents/notes/')
    || rel === '.agents/workflow-modules.txt' || rel === '.agents/rule-budgets.txt'
    || rel === '.agents/metric-claims.txt' || rel === '.agents/metric-derivers.cjs'
    || rel === '.agents/metric-derivers.mjs'
    || rel === '.agents/hooks/local-pre-commit';
}

// ---- 模板下发感知（2026-10-06 template-downstream）----
// 装户 owned 模板无下发通道（init 一次性复制），源仓演进静默陈旧——S18/S20 装户事故根因。
// 感知层 = 三方 sha 比对（一律 LF 归一，与 ownedSha 自愈同口径）：
//   disk＝装户盘面 / srcRecord＝kit.json owned[].srcSha256（上次 sync/init 见过的包源 sha）/ srcCur＝本次包源。

// 生成器目标（init「按生成后盘面重记」的清单，原 init 内 GEN_TARGETS 挪此单源）：生成器拥有该文件，
// 装户不期望跟随包源模板——模板感知排除出比对面（防「拉取了也被生成器重写」的无谓出账）。新增生成器目标须同步本清单。
export const TEMPLATE_DRIFT_EXCLUDE = new Set(['workflow/INDEX.md', 'wiki/INDEX.md', 'wiki/知识沉淀总览.html']);

// 映射规则单源：renderTree 的「srcRoot/templates ↔ targetRoot/项目根」关系 + 点目录前缀翻译
// （render.mjs：`_agents` → `.agents`）——装户 rel 以 .agents/ 开头时探 templates/_agents/<余径>。
// 复核 P2-1（2026-10-06 template-downstream 独立复核）：漏翻译会让 rule-budgets.txt /
// metric-claims.txt / local-pre-commit 等 5 条有包源起步模板的 owned 件永不参与感知。
export function srcTemplatePath(pkgRoot, rel) {
  const tplRel = rel.startsWith('.agents/') ? `_agents/${rel.slice('.agents/'.length)}` : rel;
  const p = path.join(pkgRoot, 'templates', tplRel);
  return fs.existsSync(p) ? p : null;
}

// 三态判定纯函数（sync 出账与 doctor 回显共用——防两处字面量漂移，N3 教训）：
//   'stale-drift'   源已演进且盘面未跟随 → 唯一出账形态（advisory）
//   'custom-synced' 盘面 ≠ 源但源 == 上次锚 → 装户定制跟源，owned 语义正常态，永不告警
//   'synced'        盘面 == 当前源 → 静默（手工拉取后天然落此态）
//   'no-anchor'     台账缺 srcSha256（旧装户）→ 静默跳过，下次 sync 写锚后生效，不追溯
export function templateDriftOf({ disk, srcRecord, srcCur }) {
  if (typeof srcRecord !== 'string' || !srcRecord) return 'no-anchor';
  if (disk === srcCur) return 'synced';
  if (srcCur !== srcRecord) return 'stale-drift';
  return 'custom-synced';
}

export function settingsJson(stackKey) {
  const allow = [...new Set([
    'node', 'git status', 'git diff', 'git add', 'git commit', 'git log', 'git push',
    'npm run', 'npm install', 'npm ci',
    ...(STACKS[stackKey]?.allow || []),
  ])];
  return `${JSON.stringify({
    permissions: {
      allow,
      deny: ['git reset --hard', 'git push --force', 'git push -f', 'drop database'],
      ask: ['git checkout', 'git clean', 'git branch -D', 'rm -rf'],
    },
  }, null, 2)}\n`;
}

export function commitCheckConfig(stackKey) {
  return `${JSON.stringify({
    knownPatterns: [],
    builds: STACKS[stackKey]?.builds || [],
    checks: STACKS[stackKey]?.checks || [],
  }, null, 2)}\n`;
}
