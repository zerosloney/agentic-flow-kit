#!/usr/bin/env node
// check-loop: AI-Native 闭环骨架断档扫描（agentic-flow-kit 通用版；2026-09-26 check-loop-node 自 POSIX sh 全量迁移 node）
// 扫描 workflow/ 目录,输出 intent/spec/plan 配对、模板字段占位符、incidents 复盘三件套、新 intent 回路等断档。
// 迁移背景:sh 版为规避 MSYS fork 开销引入 awk 预扫临时文件 + fd 3/4 与 glob 序逐行对齐的隐式契约
//   （重排循环/加 continue 即静默错位）、四处临时文件无 trap 清理——node 为 kit 硬依赖,双语言实现面纯负担。
// 判定语义/消息文案/exit 语义与 sh 版逐条对齐（check-loop.test.mjs 37+ 场景为对齐安全网）；
//   输出 banner 保留「check-loop.sh」字样为稳定输出契约（doctor 按 WARN 行计数、pre-push 按 exit 码判定）。
// 旧入口 check-loop.sh 为 4 行兼容 shim（exec node 本文件）——.githooks/pre-push 与文档引用零改动继续有效。
//
// 严重性分级（沿用）:
//   - hard-block(阻断 push / CI):配对断裂 + 回路断档（影响三件套可追溯性与闭环电路）
//   - warning(打印提示,exit 0):其余卫生项（状态未确认 / 模板占位残留 / 引用漂移 / Adapter 一致性等）
// 违例输出到 stderr 并 exit 1；只剩警告时 exit 0。
//
// 检查项清单（编号/标题/severity 逐条沿 sh 版头部——gate-checklist 配对登记表按 id 消费，不得增删改号）:
//   1. 入口文档/spec/plan 同名配对(L1 必须有 plan;L2/L3 必须有 spec+plan)        [hard-block]
//   2. 模板字段占位符残留(YYYY-MM-DD / <主题> 等未替换;<主题> 与 .md 同行 = 命名约定描述,豁免)  [warning]
//   3. incidents 复盘三件套完整性 + 状态严格枚举 + 新 intent 回路(回路断档=hard,其他=warning)
//   4. 引用有效性(文档/指令中引用的 .agents/ 路径必须存在;支持 fill-{a,b,c}.mjs 花括号展开与 fill-*.mjs 通配;
//      workflow 文档仅扫活跃态——终态件的引用是历史叙述,不扫,2026-09-27 audit-gate-hardening)  [warning]
//   5. intent/spec/plan 状态字段 + L3 独立复核                                       [warning]
//   6. 子智能体角色契约 + OpenCode/Trae/ZCode Adapter 一致性(含旧委派残留/钉死模型)  [warning]
//   7. 阶段索引同步(AGENTS.md 与 new-task.md 须双向索引全部阶段指令)                [warning]
//   8. intent 验收标准对账(新建:done 未勾验/缺节=hard,勾选缺证据=warning;存量聚合 warning,含「存量对账豁免」声明者出账)
//      **生效日锚=git 首次加入日期(2026-09-28 改;此前取文件名前 10 字符——命名规范强制的字段、
//      写早零成本,一条 hard 门可被平凡绕过;incident 2026-09-28-check8-git-anchor 实证)**:
//      非 git / 查不到加入记录 → 不可判定 → 走存量口径(不误报 hard)
//      证据可写在 [x] 行的续行（仓库通写法「（证据：…）」另起一行；全/半角冒号皆认）
//   9. 文件名英文 kebab-case(非 ASCII 文件名=warning,2026-09-11 规则)
//  10. 级别 vs 迁移文件一致性(L1/L2 入口文档加入提交触及迁移 SQL/Migrations=疑似判低,warning)
//  11. workflow/INDEX.md 漂移(活跃层索引与磁盘不一致=warning,2026-09-21 检索层;调生成器 --check,口径单一)
//  12. frontmatter「模块:」合法性(枚举非法 / 2026-09-22 起新建缺字段=warning;词表单源 .agents/workflow-modules.txt)
//  13. 常驻面体积预算(超限=warning;判定单源 rule-budget.sh——经 sh 调用,
//      无 sh 环境静默跳过:advisory 级且 pre-commit 侧在 git 钩子 sh 环境照常硬拦)
//  14. 新 done 的 spec/plan 须在 git 历史里出现过 `状态: approved`(确认环节留痕,2026-09-22;恒 advisory 永不升级 hard)
//  15. 确认指纹对账(2026-09-27 起:approved/done 须 confirm-doc.mjs 确认指纹+台账配对,缺=hard-block;
//      两形态——TTY 亲手 / --delegated 对话委托代录,台账 source 如实区分,配对判据与 source 无关)
//      **受管准入 = 两条件取或(2026-09-28 改锚;此前仅「自报日期 ≥ 生效日」单条件——
//      新档只要把日期写早即整段跳过判定,incident 2026-09-28-confirm-gate-effective-date-anchor 实证)**:
//      ① 该 doc 在台账中有合法跳转行(stage∈approved/done/fixed/closed/superseded/cancelled,append-only
//         取末次)——「确认确实发生过」的机器事实,作者**不可顺手填**(经 confirm-doc 走确认门才产生);
//         **诚实边界**:台账是本地可写文件、本检查不验签,刻意手改台账仍可伪造——与「伪造 git 时间戳」
//         同属本地信任边界内不可机器防,事后对质靠 git 历史与台账(2026-09-28-claim-exceeds-fix 口径统一);
//      ② 自报日期(日期/发现/文件名兜底)≥ 生效日——覆盖「新档完全没跑 confirm-doc」的漏网面
//         (此类文档无台账行,仅靠 ① 会误判为存量豁免)。
//      两条件皆不满足 = 存量豁免(生效日前既有、从未走过确认门,不追溯)。
//      改锚收益:把「确认过却把日期写早以逃掉对账」这条攻破路径堵死(条件 ① 独立于自报日期成立)。
//      **注意条件②的日期阈值仍分档、且不等价**:docs 2026-09-27 / incidents 2026-09-28——本仓现役
//      incident 的「发现」均 ≤2026-09-27,故该档差异当前不显;新 incident 若把「发现」写成 09-27 且
//      无台账行,会因 incidents 阈值(09-28)被豁免,而同日期文档在 docs 档则受管。
//      (复核 P2-1 更正:此前本注释误称「incidents 常量退役 / 两档等价」,与代码 :eff 实际保留分档不符;
//       台账锚两档共用为真,条件②阈值分档亦为真,二者不是一回事——README 遣词为准确口径)
//      + incidents 覆盖(2026-09-27 gate-coverage:fixed/closed 须配对;open=起草态不加门;
//      不支持 open→closed 单跳——confirm-doc 状态机强制经 fixed)
//      + 放弃态覆盖(2026-09-27 closing-coverage:superseded/cancelled 入配对集,confirm-doc --to 唯一通道)
//      + 四终态内容绑定(2026-09-27 audit-gate-hardening;生效锚=台账行 ts≥2026-09-28——同日 p2-batch
//      自文档自报日期改锚:旧日期文档晚关单也绑定,3 份失配存量 ts 均 09-27 天然豁免):
//      按 prev 复原跳转前文本重算 sha256 与台账全量比对,不符=hard「确认内容漂移」;状态行保分隔符换值
//      (非规范格式不误伤);台账行缺 prev 降级 warning;关单编辑顺序新约定:勾验/回填先于关单确认,
//      confirm-doc 是最后一次写入)
//      + 并录批次审计子检查(2026-09-28 batch-ledger-audit 改判据;**读调用事实,不猜时间戳模式**):
//      判据 = 台账行按 batch 分组、组内 of>1(delegated 行) → warning「确认并录」;batch/seq/of 由
//      confirm-doc 写入时记录(那才是"本次调用落几份"确定已知的时刻)。旧判据「同 quote + 相邻 ts<2s」
//      整段退役——已实证四类失效:假阳性(合规逐件复用同句必然误报)/假阴性(换 quote 即零告警,
//      等于引导伪装)/噪声不可消退(不按日期门豁免,退役前本仓 22 条 advisory 中 14 条为该告警)/
//      quote 字段职责冲突(对质凭据 vs 并录指纹,现归还单一职责)。无 batch 的历史行静默跳过
//      (无判定依据的行不产出不可消除噪声——沿 audit-gate-hardening P3 教训)
//  17. 发版提交树上仍未收口的 intent/spec/plan [hard-block]
//  18. 委派台账对账 [warning]
//  19. 逐阶段审计（起草先于入口确认 / 台账审批顺序倒置） [warning]
//      判据 A=在途扫描(同名 spec/plan 为 draft 且日期≥stageGateSince 时判入口确认;plan 另判 L2/L3 的 spec);
//      判据 B=台账 approved 行按主题校验 intents≤specs≤plans 顺序(组内最早 ts 日期≥stageGateSince 才判);
//      stageGateSince 缺键(v1) → 本检查整体跳过;口径与 stage-gates.mjs / fill-* / confirm-doc 前置门互引
// 16. 量化断言指标签名对账 [warning](2026-09-28 起;登记表单源 .agents/metric-claims.txt):
// 判据 = 活跃态文档(draft/approved/open)中的 `{{指标名}}` 签名须替换为实时值,留签名=未回填=warning。
// **只查显式签名、不全文扫数字**(据实说明):本仓活跃文档「N 行/N 条/N 份」类表述数十处,绝大多数是
// 历史叙述(描述某次提交当时的规模,天然不随当前事实变化)——全文扫描对这些正确表述产生大量假阳性,
// 而本脚本已立红线「无判定依据的行不产出不可消除噪声」(P3:噪声淹没真漏点)。故本检查**假阳性恒 0**,
// 代价是覆盖面依赖作者登记。签名收窄为小写点分形态——装户模板占位符走全大写 SCREAMING_CASE
// (由 init 渲染替换,如构建/端口/项目名三类,不属本检查面)。未登记签名 / 取数器缺失 → fail-loud 出账
// (静默会让「登记了却没查」不可见);登记表不存在 → 静默跳过(未启用该检查的装户不应被噪声打扰)。
//
// 注：清单条目 5（状态字段+L3 复核）与 1（配对）在同一遍 intents/specs/plans 循环里实现（沿 sh 版代码结构）；
//    条目 6 的旧委派残留/钉死模型子项在「角色契约与 Adapter」代码段实现。
//
// 运行模式:CHECK_LOOP_ROOT 注入 fixture 根(全扫不过滤,非 git 时检查 10/14 跳过);
//   缺省 = git 仓库根(不在 git 仓库内 stderr 提示后 exit 0 跳过);仓库模式只扫已提交(HEAD)内容
//   (并行会话未跟踪半成品不拦别人的 push;ls-tree 失败退化为全扫,门禁不失效)。
//   --rev <sha>：把该提交剥到 commit 后挂到临时 detached worktree，ROOT 改到那里再扫。
//   原工作区的未提交改动不进入这次扫描。与 CHECK_LOOP_ROOT 同时出现则 exit 1。全 0 sha exit 1。
// 文档协议:机器字段一律由文件头 YAML frontmatter(受限子集:每行 `键: 值`)承载,本脚本只扫 frontmatter 取字段;
//   叙述性字段(独立复核/复盘三件套/验收勾验)按正文行锚定。枚举单源 .agents/workflow-enums.txt
//   (缺文件/缺键 fail-loud exit 1;经 workflow-enums.mjs 读取,CRLF 天然容忍)。
// 已确认状态: approved/done=已批或闭环; superseded/cancelled=放弃留档(仍算确认,不挡 push); incident: fixed/closed
// 用法:node .agents/scripts/check-loop.mjs [--rev <sha>]   （或经 check-loop.sh shim）
// 测试:node templates/_agents/scripts/check-loop.test.mjs（fixture 注入 CHECK_LOOP_ROOT）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadEnums } from './workflow-enums.mjs';
import { runCheck16 } from './check-metric-claims.mjs';
import { auditEnabled, loadKitPolicy } from './policy.mjs';
// MARK_RE：incident 留痕形态的单源（第七轮复核 N3——此前 check-loop 内联复制一份同口径字面量，
// 两处靠注释与人工同步；改为复用 stage-gates.mjs 的导出，从结构上消除漂移可能）
import { MARK_RE, approvedTraceHit } from './stage-gates.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GIT = process.platform === 'win32' ? 'git.exe' : 'git';

function takeRev() {
  const args = process.argv.slice(2);
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === '--rev' && args[1]) return args[1];
  console.error('check-loop: 用法 node check-loop.mjs [--rev <sha>]');
  process.exit(1);
}
const REV_ARG = takeRev();
if (REV_ARG && process.env.CHECK_LOOP_ROOT) {
  console.error('check-loop: CHECK_LOOP_ROOT 与 --rev 不能同时使用');
  process.exit(1);
}
if (REV_ARG && /^0+$/.test(REV_ARG)) {
  console.error(`check-loop: --rev 不是提交 ${REV_ARG}`);
  process.exit(1);
}
let REV = null;

// ---- 根目录与枚举单源 ----
let ROOT;
if (process.env.CHECK_LOOP_ROOT) {
  ROOT = path.resolve(process.env.CHECK_LOOP_ROOT);
  if (!fs.existsSync(ROOT)) {
    console.error('check-loop: CHECK_LOOP_ROOT 不可访问:' + process.env.CHECK_LOOP_ROOT);
    process.exit(1);
  }
} else {
  const top = gitOut(['rev-parse', '--show-toplevel']);
  if (top === null) {
    if (REV_ARG) {
      console.error(`check-loop: --rev 剥不到提交 ${REV_ARG}`);
      process.exit(1);
    }
    console.error('check-loop: 不在 git 仓库内,跳过扫描');
    process.exit(0);
  }
  ROOT = top.trim();
  if (REV_ARG) {
    const peeled = gitOut(['rev-parse', '--verify', `${REV_ARG}^{commit}`]);
    if (!peeled) {
      console.error(`check-loop: --rev 剥不到提交 ${REV_ARG}`);
      process.exit(1);
    }
    REV = peeled.trim();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-rev-'));
    const wt = path.join(parent, 'wt');
    const main = ROOT;
    const add = spawnSync(GIT, ['worktree', 'add', '--detach', '--quiet', wt, REV], {
      cwd: main, encoding: 'utf8',
    });
    if (add.status !== 0) {
      fs.rmSync(parent, { recursive: true, force: true });
      console.error(`check-loop: 导出提交失败 ${REV_ARG}\n${add.stderr || add.stdout || ''}`);
      process.exit(1);
    }
    process.on('exit', () => {
      spawnSync(GIT, ['worktree', 'remove', '--force', wt], { cwd: main });
      fs.rmSync(parent, { recursive: true, force: true });
    });
    ROOT = wt;
  }
}
// 枚举单源（<root>/.agents/workflow-enums.txt——fixture 契约：缺文件/缺键 fail-loud）
let ENUMS;
try {
  ENUMS = loadEnums(path.join(ROOT, '.agents', 'workflow-enums.txt'));
} catch (e) {
  const msg = String(e.message || '');
  if (msg.includes('不可读')) {
    console.error(`check-loop: 缺 ${path.join('.agents', 'workflow-enums.txt')}(枚举单源)——跑 flow-kit sync 恢复后重试`);
  } else {
    console.error('check-loop: 枚举单源 ' + msg);
  }
  process.exit(1);
}
const inSet = (v, arr) => arr.includes(v);
const stOkDoc = (st) => inSet(st, ENUMS['doc.status.confirmed']);

// git 调用（参数数组形式不走 shell——Windows cmd 不认单引号；git.exe 显式解析沿 doctor 先例）
function gitOut(args, { ok = () => true } = {}) {
  const r = spawnSync(GIT, args,
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error || r.status !== 0 || !ok(r)) return null;
  return r.stdout || '';
}

// ---- frontmatter 受限子集读取（fm_get 语义：首行 --- 进入、下一 --- 闭合、键在行首、首个命中、值两侧去空白）----
const fileLinesCache = new Map();
function linesOf(file) {
  if (!fileLinesCache.has(file)) {
    try { fileLinesCache.set(file, fs.readFileSync(file, 'utf8').split(/\r?\n/)); }
    catch { fileLinesCache.set(file, null); }
  }
  return fileLinesCache.get(file);
}
function fmGet(file, key) {
  const lines = linesOf(file);
  if (!lines) return '';
  const isDelim = (l) => /^---\s*$/.test(l);
  if (!isDelim(lines[0] || '')) return '';
  for (let i = 1; i < lines.length; i++) {
    if (isDelim(lines[i])) return '';
    if (lines[i].startsWith(key + ':')) return lines[i].slice(key.length + 1).trim();
  }
  return '';
}

const WF = 'workflow';
const DOC_DIRS = ['intents', 'specs', 'plans', 'incidents'];
const blockers = [];
const warnings = [];
// audit:false（init 新装）只保留 blockers。缺省与 audit:true 保持全量警告。
// 硬规则：配对 / 验收勾验的阻断 / 确认留痕 / 发版草稿。卫生项走 warnings。
const kitPolicy = loadKitPolicy(ROOT);
if (!auditEnabled(kitPolicy)) {
  warnings.push = () => warnings.length;
}

// ---- 已提交(HEAD)过滤：仓库模式只扫 tracked（fixture 模式恒真；ls-tree 失败退化全扫）----
let trackedSet = null; // null = 不过滤
if (!process.env.CHECK_LOOP_ROOT) {
  const out = gitOut(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'workflow']);
  if (out !== null) trackedSet = new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
}
const isTracked = (abs) => trackedSet === null || trackedSet.has(path.relative(ROOT, abs).split(path.sep).join('/'));
const docFiles = (sub) => {
  const dir = path.join(ROOT, WF, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && /^\d/.test(f))
    .map((f) => path.join(dir, f))
    .filter((f) => isTracked(f))
    .sort();
};

// --- 1. intent/spec/plan 同名配对 + 状态确认 + L3 确认三件 [hard-block] ---
for (const intent of docFiles('intents')) {
  const base = path.basename(intent);
  const st = fmGet(intent, '状态');
  const lvl = fmGet(intent, '级别');
  if (!stOkDoc(st)) {
    const msg = `${base}（frontmatter 状态键当前值:『${st || '缺失'}』）`;
    if (lvl === 'L3') blockers.push(`- [状态未确认] L3 intent 必须为 approved/done/superseded/cancelled:${msg}`);
    else warnings.push(`- [WARN 状态未确认] intent 必须为 approved/done/superseded/cancelled:${msg}`);
  }
  if (lvl === 'L2' || lvl === 'L3') {
    if (!fs.existsSync(path.join(ROOT, WF, 'specs', base))) {
      blockers.push(`- [配对断裂] intent 缺 spec:${base}（应在 ${WF}/specs/ 下同名）`);
    }
  }
  if (!fs.existsSync(path.join(ROOT, WF, 'plans', base))) {
    blockers.push(`- [配对断裂] intent 缺 plan:${base}（应在 ${WF}/plans/ 下同名）`);
  }
}

for (const spec of docFiles('specs')) {
  const base = path.basename(spec);
  const st = fmGet(spec, '状态');
  const lvl = fmGet(spec, '级别');
  const hasEntry = fs.existsSync(path.join(ROOT, WF, 'intents', base)) || fs.existsSync(path.join(ROOT, WF, 'incidents', base));
  if (!hasEntry) blockers.push(`- [配对断裂] spec 缺 intent/incident:${base}（应在 ${WF}/intents/ 或 ${WF}/incidents/ 下同名）`);
  if (!stOkDoc(st)) {
    const msg = `${base}（frontmatter 状态键当前值:『${st || '缺失'}』）`;
    if (lvl === 'L3') blockers.push(`- [状态未确认] L3 spec 必须为 approved/done/superseded/cancelled:${msg}`);
    else warnings.push(`- [WARN 状态未确认] spec 必须为 approved/done/superseded/cancelled:${msg}`);
  }
  // L3 确认三件：确认结果/确认时间读 frontmatter；独立复核按正文行锚定（放弃件豁免 = 枚举单源 abandoned 集）
  if (lvl === 'L3' && !inSet(st, ENUMS['doc.status.abandoned'])) {
    if (fmGet(spec, '确认结果') !== 'approved') blockers.push(`- [L3 确认缺失] ${base} 确认结果必须为 approved`);
    if (!fmGet(spec, '确认时间')) blockers.push(`- [L3 确认缺失] ${base} 必须记录确认时间`);
    if (!(linesOf(spec) || []).some((l) => /^- 独立复核：[ \t]*[^<\s]/.test(l))) {
      blockers.push(`- [L3 复核缺失] ${base} 必须记录新会话独立复核结论`);
    }
  }
}

for (const plan of docFiles('plans')) {
  const base = path.basename(plan);
  const st = fmGet(plan, '状态');
  const lvl = fmGet(plan, '级别');
  const hasEntry = fs.existsSync(path.join(ROOT, WF, 'intents', base)) || fs.existsSync(path.join(ROOT, WF, 'incidents', base));
  if (!hasEntry) blockers.push(`- [配对断裂] plan 缺 intent/incident:${base}（应在 ${WF}/intents/ 或 ${WF}/incidents/ 下同名）`);
  if (!stOkDoc(st)) {
    const msg = `${base}（frontmatter 状态键当前值:『${st || '缺失'}』）`;
    if (lvl === 'L3') blockers.push(`- [状态未确认] L3 plan 必须为 approved/done/superseded/cancelled:${msg}`);
    else warnings.push(`- [WARN 状态未确认] plan 必须为 approved/done/superseded/cancelled:${msg}`);
  }
}

// --- 2. 模板字段占位符残留 [warning]（排除运行时文件名格式与协议样板，口径沿 sh 版）---
{
  const phRe = /YYYY-MM-DD|<主题>|<日期 主题>|L0 \/ L1 \/ L2 \/ L3|draft \/ approved \/ done|open \/ fixed \/ closed/;
  const boilerRe = /\.\.\/specs\/[A-Za-z0-9-]*\.md|写明如何满足|防复发验证|_YYYY-MM-DD\.|format\('YYYY-MM-DD'\)|value-format="YYYY-MM-DD"/;
  // 命名约定豁免：`<主题>` 与 `.md` 同行 = 在描述文件命名规则（如 `.agents/workflows/<主题>.md`、
  //   「复制本模板为 YYYY-MM-DD-<主题>.md」），非未填占位符；真未填的占位（标题 `# INTENT — <主题>`、
  //   `日期: YYYY-MM-DD`）不含 .md，仍照拦（2026-09-25-wf-runtime incident 记录的误报口径）
  const isNamingConv = (line) => line.includes('<主题>') && /\.md/.test(line);
  const groups = new Map(); // file -> [ "行号:内容" ]（首现序）
  for (const sub of DOC_DIRS) {
    for (const f of docFiles(sub)) {
      const hits = [];
      (linesOf(f) || []).forEach((line, i) => {
        if (phRe.test(line) && !boilerRe.test(line) && !isNamingConv(line)) hits.push(`${i + 1}:${line}`);
      });
      if (hits.length) groups.set(f, hits);
    }
  }
  for (const [f, hits] of groups) {
    warnings.push(`- [WARN 模板未填] ${path.relative(ROOT, f).split(path.sep).join('/')} 含模板占位符:\n${hits.join('\n')}`);
  }
}

// --- 3. incidents 复盘三件套 + 状态严格枚举 + 新 intent 回路（回路断档 = hard）---
for (const inc of docFiles('incidents')) {
  const name = path.basename(inc);
  const lines = linesOf(inc) || [];
  const incLvl = fmGet(inc, '级别');
  const incSt = fmGet(inc, '状态');

  if (!inSet(incSt, ENUMS['incident.status.all'])) {
    warnings.push(`- [WARN 状态非法] incident 状态必须为 open/fixed/closed:${name}（frontmatter 状态键当前值:『${incSt || '缺失'}』）`);
  }

  if (fmGet(inc, '流程') !== 'legacy') {
    if (!inSet(incLvl, ENUMS['level.all'])) {
      warnings.push(`- [WARN 级别缺失] ${name} 必须填写 L0/L1/L2/L3（配对检查已跳过——补级别后重跑本脚本校验配对）`);
    } else {
      if (['L1', 'L2', 'L3'].includes(incLvl) && !fs.existsSync(path.join(ROOT, WF, 'plans', name))) {
        blockers.push(`- [配对断裂] incident 缺 plan:${name}（应在 ${WF}/plans/ 下同名）`);
      }
      if (['L2', 'L3'].includes(incLvl) && !fs.existsSync(path.join(ROOT, WF, 'specs', name))) {
        blockers.push(`- [配对断裂] incident 缺 spec:${name}（应在 ${WF}/specs/ 下同名）`);
      }
    }
  }

  // 三件套：正文行锚定 /^1\. /^2\. /^3\. （sh awk 同款）
  for (const n of [1, 2, 3]) {
    if (!lines.some((l) => l.startsWith(`${n}. `))) {
      warnings.push(`- [WARN 三件套不全] ${name} 缺复盘三件套之 ${n}`);
    }
  }
  const hasParent = lines.some((l) => l.includes('是否需要新 intent'));
  if (!hasParent) {
    warnings.push(`- [WARN 三件套不全] ${name} 缺「是否需要新 intent」子项`);
    continue;
  }
  const yesLine = lines.find((l) => l.includes('是 → '));
  if (yesLine) {
    const m = yesLine.match(/intents\/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[^ )]*\.md/);
    const ref = m ? m[0] : null;
    if (!ref) blockers.push(`- [回路断档] ${name} 选「是」但未指明 intent 文件路径`);
    else if (!fs.existsSync(path.join(ROOT, WF, ref))) blockers.push(`- [回路断档] ${name} 引用的 intent 不存在:${ref}`);
  }
}

// --- 4. 引用有效性 [warning]（.agents/ 路径须存在；skills 特例允许用户级 ~/.agents/skills）---
{
  // 引用可带 {a,b,c} 花括号展开（仓库通写法 `fill-{intent,spec,plan}.mjs`）或 `*` 通配（`fill-*.mjs`）——
  // 花括号展开逐路查存在，任一路存在即有效；`*` 按目录枚举 glob 匹配，命中即有效；全不中才算断档
  // （2026-09-26 审查修复：正则字符类不含 {} *，曾把 `fill-{intent,spec,plan}.mjs` / `fill-*.mjs`
  //   截断成 `fill-` 误报引用断档）
  const refRe = /\.agents\/(commands|hooks|scripts|skills|roles)\/[A-Za-z0-9_][A-Za-z0-9_./{},，*-]*/g;
  const expandRef = (ref) => {
    const m = ref.match(/^([^{]*)\{([^}]*)\}(.*)$/);
    if (!m) return [ref];
    return m[2].split(/[,，]/).map((v) => m[1] + v.trim() + m[3]);
  };
  // globExists：`*` 通配引用按目录枚举匹配（仅文件名层，`*` 不跨 /；目录不存在 = false）
  const globExists = (ref) => {
    const re = new RegExp('^' + path.basename(ref).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/\\\\]*') + '$');
    try { return fs.readdirSync(path.dirname(path.join(ROOT, ref))).some((f) => re.test(f)); } catch { return false; }
  };
  const refExists = (r) => (r.includes('*') ? globExists(r) : fs.existsSync(path.join(ROOT, r)));
  const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
  const files = [];
  if (fs.existsSync(path.join(ROOT, 'AGENTS.md'))) files.push('AGENTS.md');
  for (const e of readdirOrNull(ROOT) || []) {
    const p = path.join(ROOT, e, 'AGENTS.md');
    if (isDirectoryOrNull(path.join(ROOT, e)) && fs.existsSync(p)) files.push(path.join(e, 'AGENTS.md'));
  }
  for (const f of readdirOrNull(path.join(ROOT, WF)) || []) {
    if (f.endsWith('.md')) files.push(`${WF}/${f}`); // workflow 根级 *.md（README 等）
  }
  for (const sub of DOC_DIRS) {
    const dir = path.join(ROOT, WF, sub);
    // 仅扫活跃态（draft/approved/open）——终态件的引用是历史叙述（提及已改名/已废文件属常态），
    // 扫了只会产生不可消除的 advisory 噪声，真漏点被淹没（2026-09-27 audit-gate-hardening）
    const activeSet = sub === 'incidents' ? ENUMS['incident.status.active'] : ENUMS['doc.status.active'];
    for (const f of readdirOrNull(dir) || []) {
      if (!f.endsWith('.md') || !(f === '_TEMPLATE.md' || /^\d/.test(f))) continue;
      if (f !== '_TEMPLATE.md' && !inSet(fmGet(path.join(dir, f), '状态'), activeSet)) continue;
      files.push(`${WF}/${sub}/${f}`);
    }
  }
  const cmdDir = path.join(ROOT, '.agents', 'commands');
  for (const f of readdirOrNull(cmdDir) || []) {
    if (f.endsWith('.md')) files.push(`.agents/commands/${f}`);
  }
  for (const rel of files) {
    const text = linesOf(path.join(ROOT, rel));
    if (!text) continue;
    const seen = new Set();
    for (const line of text) {
      for (const m of line.matchAll(refRe)) {
        const ref = m[0];
        if (seen.has(ref)) continue;
        seen.add(ref);
        const refs = expandRef(ref);
        if (refs.some(refExists)) continue;
        if (refs.some((r) => r.startsWith('.agents/skills/') && !r.includes('*') && fs.existsSync(path.join(HOME_DIR, r)))) continue;
        warnings.push(`- [WARN 引用断档] ${rel.split(path.sep).join('/')} 引用不存在的文件:${ref}`);
      }
    }
  }
}

// --- 5. 子智能体角色契约 + 宿主 Adapter 一致性 + 旧委派残留 + 钉死模型 [warning] ---
{
  const cmdFiles = () => (readdirOrNull(path.join(ROOT, '.agents', 'commands')) || [])
    .filter((f) => f.endsWith('.md')).map((f) => `.agents/commands/${f}`);
  const textOf = (rel) => linesOf(path.join(ROOT, rel)) || [];
  for (const role of ['implementer', 'independent-reviewer', 'ui-verifier']) {
    const rolePath = `.agents/roles/${role}.md`;
    if (!fs.existsSync(path.join(ROOT, rolePath))) {
      warnings.push(`- [WARN 角色缺失] 公共角色契约不存在:${rolePath}`);
      continue;
    }
    if (fs.existsSync(path.join(ROOT, '.opencode', 'agents'))) {
      const p = `.opencode/agents/${role}.md`;
      if (!fs.existsSync(path.join(ROOT, p))) warnings.push(`- [WARN Adapter 缺失] OpenCode 缺 ${role}:${p}`);
      else {
        if (!/^mode:\s*subagent\s*$/m.test(textOf(p).join('\n'))) warnings.push(`- [WARN Adapter 无效] OpenCode ${role} 未声明 mode:subagent:${p}`);
        if (!textOf(p).some((l) => l.includes(rolePath))) warnings.push(`- [WARN Adapter 断线] OpenCode ${role} 未引用公共角色:${rolePath}`);
      }
    }
    if (fs.existsSync(path.join(ROOT, '.trae', 'agents'))) {
      const p = `.trae/agents/${role}.md`;
      if (!fs.existsSync(path.join(ROOT, p))) warnings.push(`- [WARN Adapter 缺失] Trae 缺 ${role}:${p}`);
      else {
        if (!new RegExp(`^name:\\s*${role}\\s*$`, 'm').test(textOf(p).join('\n'))) warnings.push(`- [WARN Adapter 无效] Trae ${role} 的 name 与文件名不一致:${p}`);
        if (!textOf(p).some((l) => l.includes(rolePath))) warnings.push(`- [WARN Adapter 断线] Trae ${role} 未引用公共角色:${rolePath}`);
      }
    }
    const zc = `.zcode/agents/${role}.md`;
    if (fs.existsSync(path.join(ROOT, zc))) { // 本地配置不入 git：缺失不告警，存在时校验一致性
      if (!new RegExp(`^name:\\s*["']?${role}["']?\\s*$`, 'm').test(textOf(zc).join('\n'))) warnings.push(`- [WARN Adapter 无效] ZCode ${role} 的 name 与文件名不一致:${zc}`);
      if (!textOf(zc).some((l) => l.includes(rolePath))) warnings.push(`- [WARN Adapter 断线] ZCode ${role} 未引用公共角色:${rolePath}`);
    }
    const cited = ['AGENTS.md', ...cmdFiles()].some((f) => textOf(f).some((l) => l.includes(rolePath)));
    if (!cited) warnings.push(`- [WARN 命令断线] 工作流未引用公共角色:${rolePath}`);
  }
  // 旧委派残留 / 钉死模型（grep -nH 行格式 file:line:content）
  const legacyRe = /(^subagent:|subagent_type=|general_purpose_task|browser_use)/;
  const legacyHits = [];
  for (const f of ['AGENTS.md', ...cmdFiles()]) {
    textOf(f).forEach((l, i) => { if (legacyRe.test(l)) legacyHits.push(`${f}:${i + 1}:${l}`); });
  }
  if (legacyHits.length) warnings.push(`- [WARN 旧委派残留] 主规则或阶段命令仍含宿主特定/旧委派声明:\n${legacyHits.join('\n')}`);
  const modelHits = [];
  for (const h of ['.opencode', '.trae', '.zcode']) {
    for (const f of readdirOrNull(path.join(ROOT, h, 'agents')) || []) {
      if (!f.endsWith('.md')) continue;
      const rel = `${h}/agents/${f}`;
      textOf(rel).forEach((l, i) => { if (/^model:/.test(l) && !/^model:\s*inherit/.test(l)) modelHits.push(`${rel}:${i + 1}:${l}`); });
    }
  }
  if (modelHits.length) warnings.push(`- [WARN 宿主耦合] 薄 Adapter 不应固定模型:\n${modelHits.join('\n')}`);
}

// --- 6. 阶段索引同步 [warning] ---
for (const cmd of ['plan', 'design', 'build', 'test', 'deploy', 'maintain', 'review']) {
  for (const doc of ['AGENTS.md', '.agents/commands/new-task.md']) {
    const text = linesOf(path.join(ROOT, doc));
    if (text && !text.some((l) => l.includes(`.agents/commands/${cmd}.md`))) {
      warnings.push(`- [WARN 阶段索引漂移] ${doc} 缺 ${cmd} 指令索引(两处阶段表须同步维护)`);
    }
  }
}

// --- 共享：文件「首次加入 git」的日期索引（2026-09-28 check8-git-anchor）---
// 用途：检查 8 的生效日锚从**可手填的文件名前缀**（项目命名规范本身即 `YYYY-MM-DD-<主题>`，作者
// 日常手写该前缀，「写早」零成本、顺手即发生——一条 hard 门可被平凡绕过）改为**首次加入 git 的日期**。
// **诚实边界（复核 P1 更正）**：该锚取 `git log --diff-filter=A --format=@%aI`，即 **author date
// （作者自报时间戳）**，**不是** commit 时刻——`git commit --date=<过去>` 一条参数即可伪造，故
// 「锚不可手填」的说法**不成立**。本改动的确切收益是：关掉「改文件名（日常必写、零成本）」这条通道，
// 把伪造成本抬到「主动加参数伪造时间戳」——后者与「伪造台账」同属**本地信任边界内不可机器防**的范畴
// （事后对质靠 git 历史与台账）。此处如实声明，不宣称「通道已关闭」。
// 口径：git 按时间新→旧遍历，同一文件首遇即最早那次加入（与检查 10 的 addpath 同款判据）。
// 非 git / 命令失败 → null，调用方按既有「非 git 跳过」语义退化（不 fail-loud）。
// 注：检查 10 需要的是「文件→加入 commit」+「commit→文件清单」两份映射（判断同提交是否触及迁移 SQL），
// 与本索引「文件→日期」不同构，故**不合并**——避免把两处判据耦死。
const addedDates = (() => {
  if (gitOut(['rev-parse', '--git-dir']) === null) return null;
  const log = gitOut(['log', '--diff-filter=A', '--format=@%aI', '--name-only']);
  if (log === null) return null;
  const m = new Map();
  let cur = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('@')) { cur = line.slice(1); continue; }
    if (line.trim() && cur && !m.has(line.trim())) m.set(line.trim(), cur); // 新→旧序首遇 = 最早
  }
  return m;
})();
// 某文档「首次加入日期」（YYYY-MM-DD）；不可判定（非 git / 查不到）返回 ''
const addedDateOf = (absDoc) => {
  if (!addedDates) return '';
  const rel = path.relative(ROOT, absDoc).split(path.sep).join('/');
  const iso = addedDates.get(rel);
  return iso ? iso.slice(0, 10) : '';
};

// --- 8. intent 验收标准对账（done 须逐条勾验并补证据；新建 hard，存量聚合 warning）---
// 生效日锚 2026-09-28 改「git 首次加入日期」（此前取文件名前 10 字符——命名规范强制的字段、
// 写早零成本，见 incidents/2026-09-28-check8-git-anchor）。非 git → 不可判定 → 走存量口径（不误报 hard）。
{
  const accCutoff = '2026-09-12';
  let legacyUnaccounted = 0;
  for (const intent of docFiles('intents')) {
    if (fmGet(intent, '状态') !== 'done') continue;
    const base = path.basename(intent);
    const lines = linesOf(intent) || [];
    // 节扫描：hs=有验收节；insec 至下一个二级标题；uc=未勾项；ne=勾选缺证据；ex=存量豁免声明
    //   证据可写在 [x] 行的续行（仓库通写法「（证据：…）」另起一行）——pendX 记「待证据项」，
    //   遇证据行（全角「：」/半角「:」皆认）清零；遇下一条目 / 下一小节 / 节末仍无证据 → ne
    let hs = false, uc = false, ne = false;
    let insec = false, ex = false;
    let pendX = false; // 上一 [x] 项尚无证据，证据可能在紧随的续行
    const evRe = /证据[：:]/;
    const closeItem = () => { if (pendX) { ne = true; pendX = false; } };
    for (const line of lines) {
      if (/存量对账豁免（/.test(line)) ex = true;
      if (/^\s*##\s+[^#]*验收标准/.test(line)) { hs = true; insec = true; closeItem(); continue; }
      if (insec && /^\s*##\s/.test(line)) { insec = false; closeItem(); continue; }
      if (!insec) continue;
      if (/^\s*- \[ \]/.test(line)) { closeItem(); uc = true; continue; }
      if (/^\s*- \[x\]/.test(line)) { closeItem(); pendX = !evRe.test(line); continue; }
      if (pendX && evRe.test(line)) pendX = false; // 续行补上证据
    }
    closeItem(); // 节末（或全文末）仍无证据 → 计缺证据
    // 生效日锚 = git 首次加入日期（2026-09-28 改；此前取文件名前 10 字符）。**准确收益**：关掉
    // 「改文件名日期（日常必写、零成本）即整段跳过 hard 门」这条通道；锚取 author date(%aI)，
    // 刻意伪造（`git commit --date=`）仍可绕过——与伪造台账同属本地信任边界内，不宣称"通道已关闭"。
    // 非 git / 查不到 → '' → isNew=false → 走存量口径（与既有语义一致：不可判定时不误报 hard）。
    const adddate = addedDateOf(intent);
    const isNew = adddate !== '' && adddate >= accCutoff;
    if (!hs) {
      if (isNew) blockers.push(`- [验收未对账] done intent 缺「## 验收标准」节(勾验无从核对):${base}`);
      else if (!ex) legacyUnaccounted++;
      continue;
    }
    if (!uc && !ne) continue;
    if (isNew) {
      if (uc) blockers.push(`- [验收未对账] done intent 验收标准有未勾验项:${base}（逐条勾验并补证据：commit/用例/冒烟输出）`);
      if (ne) warnings.push(`- [WARN 验收缺证据] ${base} 验收标准勾选项缺「证据：」标注`);
    } else if (!ex) {
      legacyUnaccounted++;
    }
  }
  if (legacyUnaccounted > 0) {
    warnings.push(`- [WARN 验收对账存量] ${legacyUnaccounted} 个存量 done intent 验收标准未对账（生效日锚之前加入仓库，豁免 hard，不回填）`);
  }
}

// --- 9. 文件名英文 kebab-case [warning] ---
for (const sub of DOC_DIRS) {
  const dir = path.join(ROOT, WF, sub);
  for (const f of readdirOrNull(dir) || []) {
    if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
    const abs = path.join(dir, f);
    if (!isTracked(abs)) continue;
    if (!/^[\x20-\x7e]*$/.test(f)) {
      warnings.push(`- [WARN 文件名非英文] 文件名含非 ASCII 字符,应为英文 kebab-case:${WF}/${sub}/${f}`);
    }
  }
}

// --- 10. 级别 vs 迁移文件一致性 [warning]（启发式：入口文档加入提交触及迁移 SQL/Migrations → 疑似判低；非 git 跳过）---
if (gitOut(['rev-parse', '--git-dir']) !== null) {
  const log = gitOut(['log', '--diff-filter=A', '--format=@%H', '--name-only']);
  if (log !== null) {
    const addpath = new Map(); // 文件 → 首次加入 commit（新→旧序首遇）
    const cfiles = new Map();  // commit → 文件清单
    let cur = null;
    for (const line of log.split('\n')) {
      if (line.startsWith('@')) { cur = line.slice(1); cfiles.set(cur, []); continue; }
      if (line.trim() && cur && !addpath.has(line.trim())) {
        addpath.set(line.trim(), cur);
        cfiles.get(cur).push(line.trim());
      }
    }
    const docs = [...docFiles('intents'), ...docFiles('incidents')];
    for (const doc of docs) {
      const rel = path.relative(ROOT, doc).split(path.sep).join('/');
      const lvl = fmGet(doc, '级别');
      if (lvl !== 'L1' && lvl !== 'L2') continue;
      const c = addpath.get(rel);
      if (!c) continue;
      const hits = (cfiles.get(c) || []).filter((f) => /(^|\/)docs\/scripts\/.*\.sql$/.test(f) || /(^|\/)Migrations\//.test(f));
      if (hits.length) {
        warnings.push(`- [WARN 级别疑似判低] ${path.basename(doc)} 级别 ${lvl} 但其加入提交触及迁移文件(混合改动应就高不就低,请复核级别):\n${hits.join('\n')}`);
      }
    }
  }
}

// --- 11. workflow/INDEX.md 漂移 [warning]（调生成器 --check，口径单一不复刻渲染）---
{
  const gen = path.join(ROOT, '.agents', 'scripts', 'gen-workflow-index.mjs');
  if (fs.existsSync(gen)) {
    const r = spawnSync(process.execPath, [gen, '--check'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      const first = `${r.stdout || ''}${r.stderr || ''}`.split('\n')[0];
      warnings.push(`- [WARN 索引漂移] workflow/INDEX.md 与磁盘不一致——跑 node .agents/scripts/gen-workflow-index.mjs 重新生成（${first}）`);
    }
  }
}

// --- 12. frontmatter「模块:」合法性 [warning]（词表单源；缺字段只对 2026-09-22 起新建提示）---
{
  const modsFile = path.join(ROOT, '.agents', 'workflow-modules.txt');
  if (fs.existsSync(modsFile)) {
    const mods = linesOf(modsFile).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim());
    const vocab = new Set(mods);
    for (const sub of ['intents', 'specs', 'plans', 'incidents']) {
      for (const doc of docFiles(sub)) {
        const base = path.basename(doc);
        const mod = fmGet(doc, '模块');
        let d = fmGet(doc, '日期') || fmGet(doc, '发现');
        if (!d) d = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
        if (mod) {
          if (!vocab.has(mod)) warnings.push(`- [WARN 模块元数据] ${base}「模块: ${mod}」不在词表(见 .agents/workflow-modules.txt)`);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= kitPolicy.moduleSince) {
          warnings.push(`- [WARN 模块元数据] ${base} 缺「模块:」字段(${kitPolicy.moduleSince} 起新建文档必填)`);
        }
      }
    }
  }
}

// --- 13. 常驻面体积预算 [warning]（判定单源 rule-budget.sh；无 sh 环境静默跳过——advisory，pre-commit 硬拦兜底）---
{
  const rb = path.join(ROOT, '.agents', 'scripts', 'rule-budget.sh');
  const budgets = path.join(ROOT, '.agents', 'rule-budgets.txt');
  if (fs.existsSync(rb) && fs.existsSync(budgets)) {
    const r = spawnSync('sh', [rb, '--all'], { cwd: ROOT, encoding: 'utf8' });
    if (!r.error && r.status !== 0) {
      const head = `${r.stdout || ''}${r.stderr || ''}`.split('\n').slice(0, 5).map((l) => '    ' + l).join('\n');
      warnings.push(`- [WARN 常驻面超限] 常驻面体积超预算(先删除或下沉被取代条目再增——一进一出):\n${head}`);
    }
  }
}

// --- 14. 新 done 的 spec/plan 须在 git 历史里出现过 `状态: approved` [warning]（恒 advisory；非 git 跳过）---
if (gitOut(['rev-parse', '--git-dir']) !== null && gitOut(['rev-parse', '-q', '--verify', 'HEAD']) !== null) {
  for (const sub of ['specs', 'plans']) {
    for (const doc of docFiles(sub)) {
      if (fmGet(doc, '状态') !== 'done') continue;
      const base = path.basename(doc);
      let d = fmGet(doc, '日期') || fmGet(doc, '发现');
      if (!d) d = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < kitPolicy.check14Since) continue; // policy.mjs check14Since
      const lines = linesOf(doc) || [];
      if (lines.some((l) => l.includes('存量确认态豁免（'))) continue;
      const rel = path.relative(ROOT, doc).split(path.sep).join('/');
      // 命中判据单源（stage-gates.approvedTraceHit，2026-09-30 confirm-gate-approved-history）：
      // 返回 ''=从未出现 / <sha>=命中 / null=git 调用失败（不报，沿本段 fail-open 口径）
      const hit = approvedTraceHit(ROOT, rel);
      if (hit !== null && hit === '') {
        warnings.push(`- [WARN 确认态缺失] ${base} 状态已 done 但 git 历史中从未出现行首「状态: approved」——确认环节未留痕(draft 直跳 done)`);
      }
    }
  }
}

// --- 15. 确认指纹对账 [hard-block]（2026-09-26 confirm-gate-machine；2026-09-27 confirm-gate-delegated 两形态；
//     生效日锚 2026-09-28 改台账 ts——此前锚取自文档自报「日期/发现」，新档只要把日期写早即整段跳过判定，
//     incident 2026-09-28-confirm-gate-effective-date-anchor 实证）---
// 确认两形态（confirm-doc.mjs）：TTY 亲手键入「可以」/ --delegated 对话委托代录（用户对话内明确放行后
// AI 代录，台账行如实记 source=chat-delegated + quote 原话，永不伪装 TTY）。intents/specs/plans 凡
// approved/done 须有 confirm-doc 产生的 frontmatter 确认指纹 + 台账（.agents/confirmations.jsonl）
// 配对行——配对判据 doc/stage/fingerprint 三键，与 source 无关。
// **生效日锚 = 台账 ts（2026-09-28 起）**：受管准入 = 该 doc 在台账中有合法跳转行（stage ∈ approved/done/
// fixed/closed/superseded/cancelled，append-only 取末次）；无台账行 = 存量豁免（不追溯）。自报日期
// （日期/发现/文件名）不再参与门禁判定——它可被作者手填，把「门是否生效」的决定权交给被约束对象本身
// 是自举漏洞；台账行是「确认确实发生过」的唯一机器事实。docs 与 incidents 共用同一锚（原 incidents
// 独立生效日 2026-09-28 常量退役：台账起算日 = docs 生效日，两档等价）。
// 台账坏行容忍跳过（审计件，jsonl 追加式）；frontmatter 存 16 位、台账存 64 位，按前 16 位配对。
{
  const EFFECTIVE = kitPolicy.confirmDocsEffective;
  const ledgerPath = path.join(ROOT, '.agents', 'confirmations.jsonl');
  const ledger = [];
  if (fs.existsSync(ledgerPath)) {
    for (const line of linesOf(ledgerPath) || []) {
      if (!line.trim()) continue;
      try { ledger.push(JSON.parse(line)); } catch { /* 坏行跳过 */ }
    }
  }
  // incidents 侧覆盖（2026-09-27 gate-coverage）：fixed/closed 为已确认态（open = 起草态不加门——
  // maintain.md 创建即对话确认的既有口径）
  // 放弃态覆盖（2026-09-27 closing-coverage）：superseded/cancelled 入配对集——confirm-doc --to 是唯一
  // 合法产生通道（cancelled 自 draft/approved/open/fixed；superseded 自 approved/done/fixed/closed），
  // 此前手改 frontmatter 即出账的口子收死
  const CONFIRMED_BY_SUB = {
    intents: ['approved', 'done', 'superseded', 'cancelled'],
    specs: ['approved', 'done', 'superseded', 'cancelled'],
    plans: ['approved', 'done', 'superseded', 'cancelled'],
    incidents: ['fixed', 'closed', 'superseded', 'cancelled'],
  };
  // 合法跳转 stage 集（台账行「确认确实发生过」的判据；revert-draft / revert-open 类回退注记行不算）
  const VALID_STAGES = new Set(['approved', 'done', 'fixed', 'closed', 'superseded', 'cancelled']);
  for (const [sub, confirmedSet] of Object.entries(CONFIRMED_BY_SUB)) {
    for (const doc of docFiles(sub)) {
      const st = fmGet(doc, '状态');
      if (!confirmedSet.includes(st)) continue;
      const base = path.basename(doc);
      const rel = path.relative(ROOT, doc).split(path.sep).join('/');
      // 受管准入 = 两条件取或（2026-09-28 改锚）：
      //   ① 台账中有该 doc 的合法跳转行——「确认确实发生过」的机器事实；它独立于自报日期成立，
      //      故堵死「确认过却把日期写早以逃掉对账」这条攻破路径（本 incident 的核心缺陷）；
      //   ② 自报日期 ≥ 生效日——覆盖「新档完全没跑 confirm-doc」的漏网面（此类无台账行，
      //      仅靠 ① 会被误判为存量豁免而静默放行）。
      // 两条件皆不满足 = 存量豁免（生效日前既有、从未走确认门，不追溯）。
      const docEntries = ledger.filter((e) => e && e.doc === rel && VALID_STAGES.has(e.stage));
      const eff = sub === 'incidents' ? kitPolicy.confirmIncidentsEffective : EFFECTIVE;
      let d = fmGet(doc, '日期') || fmGet(doc, '发现');
      if (!d) d = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
      const dateManaged = /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= eff;
      if (!docEntries.length && !dateManaged) continue; // 存量豁免
      const fp = fmGet(doc, '确认指纹');
      const ok = !!fp && docEntries.some((e) => e.stage === st
        && typeof e.fingerprint === 'string' && e.fingerprint.startsWith(fp));
      if (!ok) {
        blockers.push(`- [确认未对账] ${base} 状态 ${st} 无用户确认记录——AI 不得代确认，用户在终端跑 node .agents/scripts/confirm-doc.mjs ${rel} 后重试`);
      }
      // 内容绑定（2026-09-27 audit-gate-hardening；生效锚 2026-09-27 gate-hardening-p2-batch 自文档自报日期
      // 改为台账 done 行 ts）：done 文档当前内容须与台账 done 行确认时的内容一致——按 prev 复原跳转前文本
      // 重算比对，防「确认后篡改」（改验收标准/正文均触发）。复原口径 = confirm-doc computeFingerprint 的
      // 逆推：CRLF 归一 → frontmatter 首个「状态:」行保分隔符换值为台账 prev（双空格等非规范分隔符不误伤，
      // 与前向按原行字面计算对称）→ 剔「确认指纹:」行。两条降级路径：台账行缺 prev（schema 演进前存量，
      // 无以复原）→ warning 不拦；entry.ts 早于 2026-09-28（UTC 字符串比较——该次确认在旧关单顺序时代完成）→
      // 豁免绑定（配对判定已过，3 份失配存量即此列）。关单编辑顺序新约定不变：confirm-doc 是最后一次写入，
      // 此后修订走 superseded 或新 intent。
      if (ok && ['done', 'closed', 'superseded', 'cancelled'].includes(st)) {
        const doneEntries = ledger.filter((e) => e && e.doc === rel && e.stage === st && typeof e.fingerprint === 'string');
        const entry = doneEntries[doneEntries.length - 1]; // append-only 台账，末次生效（重确认场景）
        if (!entry || !entry.prev) {
          warnings.push(`- [WARN 绑定降级] ${base} 台账 stage=${st} 行缺 prev 字段（schema 演进前行），内容绑定跳过——仅配对判定`);
        } else if (!(typeof entry.ts === 'string' && entry.ts >= kitPolicy.bindingTs)) {
          // 该 done 确认发生在生效锚前（旧关单顺序时代）——豁免内容绑定，配对判定照常
        } else if (bindingSha256(linesOf(doc) || [], entry.prev) !== entry.fingerprint) {
          blockers.push(`- [确认内容漂移] ${base} ${st} 后内容与确认台账不符——已关单文档不得直接改（关单编辑先于关单确认）；确需修订走 superseded 或新 intent 引用`);
        }
      }
    }
  }
  // 并录批次审计（2026-09-28 batch-ledger-audit 改判据；原 2026-09-27 confirm-gate-one-per-call 引入）：
  // **读调用事实，不猜时间戳模式**。判据 = 台账行按 `batch` 分组，组内 `of > 1` → warning「确认并录」。
  // batch/seq/of 由 confirm-doc 在**写入时**记录（那才是「本次调用落了几份」确定已知的时刻）；
  // 旧判据「同 quote + 相邻 ts 差 < 2s」是拿两个间接信号反推该事实，已实证四类失效并**整段退役**：
  //   ① 假阳性：合规逐件调用复用同句（用户两次都说「可以」）→ 必然误报；
  //   ② 假阴性：并录时给每份换不同 quote → 零告警（判据的实际效果是引导伪装者改 quote）；
  //   ③ 噪声不可消退：不按日期门豁免，退役前本仓 22 条 advisory 中 14 条为该告警，且文案自认「不可区分」；
  //   ④ 字段职责冲突：`quote` 同时当「对质凭据」与「并录指纹」——现归还单一职责，只记用户原话。
  // 无 `batch` 字段的历史行（schema 演进前，本仓全部 67 行均无该字段）→ **静默跳过**，不降级出账、不回溯：
  // 按 audit-gate-hardening P3 教训（「扫了只产生不可消除的 advisory 噪声，真漏点被淹没」），无判定依据
  // 的行不该产出告警。VALID_STAGES 复用外层声明（复核 P2-3 更正：此前本块内另有一份同名声明遮蔽外层）。
  {
    const byBatch = new Map(); // batch → 该批的台账行（仅计合法跳转 stage）
    for (const e of ledger) {
      if (!e || !VALID_STAGES.has(e.stage)) continue;
      if (typeof e.batch !== 'string' || !e.batch) continue; // 历史行无 batch → 无判定依据，跳过
      if (!byBatch.has(e.batch)) byBatch.set(e.batch, []);
      byBatch.get(e.batch).push(e);
    }
    for (const [b, rows] of byBatch) {
      // 判据取组内**任一行** of>1（复核 P2-3 更正：原取 rows[0].of 使结论依赖行序——同批首行 of=1、
      // 次行 of=2 会漏报。confirm-doc 对同批所有行写同一个 of=docs.length，故正常批次组内一致；
      // 改用 some 消除该顺序脆弱性，并对 craft 出来的不一致批次按「最大值」报，方向偏严不偏松）
      if (!rows.some((r) => typeof r.of === 'number' && r.of > 1)) continue;
      // of > 1 = 一次调用落多份态。delegated 形态下这正是「并录」（入口已拒多份，此处抓历史/绕行）；
      // TTY 形态天然逐份过目（用户亲手键入），of>1 不构成违规——故只对 delegated 行报。
      if (!rows.some((r) => r.source === 'chat-delegated')) continue;
      const of = Math.max(...rows.map((r) => (typeof r.of === 'number' ? r.of : 0)));
      const docs = rows.map((r) => String(r.doc).replace(/^workflow\//, '')).join('、');
      warnings.push(`- [WARN 确认并录] 单次调用落账 ${rows.length} 份（batch ${b}，of=${of}）：${docs}——同一次 --delegated 调用放行多份，塌掉「逐件确认」门（build.md）；口径见 workflow/papercuts.md 2026-09-28 与 incidents/2026-09-28-batch-ledger-audit.md`);
    }
  }
}

// --- 16. 量化断言指标签名对账 [warning]（2026-09-28 claim-exceeds-fix；登记表单源 .agents/metric-claims.txt）---
// 判据要点：活跃态文档（draft/approved/open）中的 `{{指标名}}`（小写点分）签名须替换为实时值，留签名=未回填=
//   warning；只查显式签名、不全文扫数字（历史叙述假阳性恒 0）；未登记签名 / 取数器缺失 → fail-loud 出账；
//   登记表缺失 → 静默跳过（未启用该检查的装户零噪声）；装户自有指标走 .agents/metric-derivers.cjs（CJS 契约，
//   内置优先）。实现自 2026-09-28 check16-inline-debt 起迁出至 check-metric-claims.mjs（原内联块，判据语义/
//   消息文案/exit 语义零变化，迁出经全量输出 diff 基线验证）。ctx 显式携带本检查引用的外层符号
//   （ROOT/ENUMS/docFiles/fmGet/inSet/isTracked/linesOf/readdirOrNull/warnings，以代码实际引用集为准）；
//   调用位置须保持在检查 15 之后、输出段之前——warnings 按插入序输出，位置变化会改变输出行序。
runCheck16({ ROOT, ENUMS, docFiles, fmGet, inSet, isTracked, linesOf, readdirOrNull, warnings });

// --- 17. 发版提交树上仍未收口的 intent/spec/plan [hard-block] ---
// 最近一次 package.json version 发生变化的提交里，当时状态已是 draft 或 approved 的
// intent/spec/plan，被扫描的树上仍是 draft 或 approved 则阻断。
// 当时已是 draft：不看版本锚。当时已是 approved：只在发版版本大于
// policy.check17UnclosedAfter 时阻断。版本 1 没有该键，因此不启用后两格。
// 版本按主、次、修订三段整数比较。沿 package.json 的全部历史查找，不设次数上限。
// 该提交之后新建的文件不在范围内。open 的 incident 不在此列。
{
  const log = gitOut(['log', '--format=%H', '--', 'package.json']);
  if (log) {
    let release = null;
    let releaseVer = '';
    for (const sha of log.split('\n').map((s) => s.trim()).filter(Boolean)) {
      const curTxt = gitOut(['show', `${sha}:package.json`]);
      if (!curTxt) continue;
      let cur = null;
      try { cur = JSON.parse(curTxt).version; } catch { continue; }
      const prevTxt = gitOut(['show', `${sha}^:package.json`]);
      let prev = null;
      if (prevTxt) { try { prev = JSON.parse(prevTxt).version; } catch { prev = null; } }
      if (cur && cur !== prev) { release = sha; releaseVer = cur; break; }
    }
    const tree = release && gitOut(['ls-tree', '-r', '--name-only', release, '--', `${WF}/intents`, `${WF}/specs`, `${WF}/plans`]);
    if (release && tree) {
      for (const rel of tree.split('\n').map((s) => s.trim()).filter(Boolean)) {
        if (!rel.endsWith('.md') || rel.endsWith('_TEMPLATE.md')) continue;
        const thenTxt = gitOut(['show', `${release}:${rel}`]);
        if (!thenTxt) continue;
        const thenSt = fmStatus(thenTxt);
        const nowSt = fmGet(path.join(ROOT, rel), '状态');
        if ((thenSt !== 'draft' && thenSt !== 'approved') || (nowSt !== 'draft' && nowSt !== 'approved')) continue;
        if (thenSt === 'approved' && !versionGreater(releaseVer, kitPolicy.check17UnclosedAfter)) continue;
        const here = REV ? `提交 ${REV.slice(0, 7)}` : '工作区';
        blockers.push(`- [发版草稿] ${rel} 在 version=${releaseVer} 的提交 ${release.slice(0, 7)} 上已是 ${thenSt}，${here}仍是 ${nowSt}。发版提交树上未收口的 intent/spec/plan 须先离开 draft 与 approved。覆盖面只含该提交当时已在树上的 intent/spec/plan；其后新建的文件不在此列`);
      }
    }
  }
}

// --- 18. 委派台账对账 [warning] ---
// L2/L3 的 intent、spec、plan 状态为 done，或同级别 incident 状态为 fixed 或 closed 时，
// 「委派结果」表与「自做任务结果」表均没有日期不早于文档日期、且含该文件名（带/不带 .md 均匹配）的一行，则警告。
// 缺级别、缺日期、以及其他状态不警告。audit:false 时 warnings.push 已被换成空函数。
// 两表解析口径与 agg-delegations.cjs splitTables 保持一致，一边改另一边须跟。
{
  const rows = delegationResultRows(path.join(ROOT, WF, 'delegations.md'));
  for (const sub of ['intents', 'specs', 'plans', 'incidents']) {
    for (const abs of docFiles(sub)) {
      const lvl = fmGet(abs, '级别');
      if (lvl !== 'L2' && lvl !== 'L3') continue;
      const st = fmGet(abs, '状态');
      const inScope = sub === 'incidents' ? (st === 'fixed' || st === 'closed') : st === 'done';
      if (!inScope) continue;
      const date = sub === 'incidents' ? (fmGet(abs, '发现') || fmGet(abs, '日期')) : fmGet(abs, '日期');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const base = path.basename(abs);
      const stripped = base.replace(/\.md$/, '');
      if (rows.some((r) => r.date >= date && (r.line.includes(base) || r.line.includes(stripped)))) continue;
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      warnings.push(`- [WARN 委派台账] ${rel} 在 ${date} 及之后的委派结果/自做任务结果表中没有该文件名`);
    }
  }
}

// --- 19. 逐阶段审计 [warning]（2026-09-30 stage-gate-machine；口径与 stage-gates.mjs / fill-* / confirm-doc 前置门互引） ---
// 判据 A（在途扫描）：同名 spec/plan 为 draft 且其日期 ≥ stageGateSince 时——入口未确认（intent：状态非
//   approved/done、或缺台账行且非存量；incident：「时间线」小节缺行首「用户确认」条目）→ warning；
//   入口缺合法「级别」→ warning（与起草门 fail-closed 同口径，2026-09-30 复核 P2-7）；
//   plan 另判（入口级别 L2/L3 且 spec 未确认或缺失）→ warning。
// 判据 B（台账顺序）：同主题 {intents,specs,plans} 的 approved 行（每 doc 取最早）时间须非降序；仅对
//   组内最早 ts 日期 ≥ stageGateSince 的主题判定；含更早 ts 的主题整组跳过（历史豁免）。
// stageGateSince 缺键（policy v1）→ 本检查整体跳过；全部 warning、不 hard-block。
{
  const since = kitPolicy.stageGateSince;
  if (typeof since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(since)) {
    const ledgerRows = [];
    {
      const lp = path.join(ROOT, '.agents', 'confirmations.jsonl');
      if (fs.existsSync(lp)) {
        for (const line of linesOf(lp) || []) {
          if (!line.trim()) continue;
          try { ledgerRows.push(JSON.parse(line)); } catch { /* 坏行跳过（同检查 15 口径） */ }
        }
      }
    }
    const hasRow = (rel) => ledgerRows.some((e) => e && e.doc === rel && (e.stage === 'approved' || e.stage === 'done'));
    const docConfirmed = (rel, abs) => {
      const st = fmGet(abs, '状态');
      if (st !== 'approved' && st !== 'done') return { ok: false, legacy: false, why: `状态「${st || '缺失'}」` };
      if (hasRow(rel)) return { ok: true, level: fmGet(abs, '级别'), legacy: false };
      const d = fmGet(abs, '日期') || fmGet(abs, '发现');
      const legacy = (linesOf(abs) || []).some((l) => /^流程: legacy/.test(l))
        || (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < kitPolicy.confirmDocsEffective);
      if (legacy) return { ok: true, level: fmGet(abs, '级别'), legacy: true };
      return { ok: false, legacy: false, why: '无确认台账行' };
    };
    // incident 留痕判定：**直接复用 stage-gates.mjs 的 MARK_RE**（第七轮复核 N3：此前此处内联复制
    // 一份同口径字面量，两处靠注释人工同步、无测试钉住——改为单源复用，从结构上消除漂移可能）。
    // 判据同源：「## 时间线」小节内、行首列表条目含「用户确认」（词边界见 MARK_RE）。
    const incidentMarked19 = (lines) => {
      let inTimeline = false;
      for (const l of lines || []) {
        if (/^##\s/.test(l)) { inTimeline = /^##\s*时间线/.test(l); continue; }
        if (inTimeline && MARK_RE.test(l)) return true;
      }
      return false;
    };
    const entryConfirmed19 = (base) => {
      const irel = `${WF}/intents/${base}.md`;
      const iabs = path.join(ROOT, irel);
      if (fs.existsSync(iabs)) {
        const r = docConfirmed(irel, iabs);
        const body = (linesOf(iabs) || []).join('\n');
        const d19 = fmGet(iabs, '日期') || fmGet(iabs, '发现');
        const storLegacy = /^流程: legacy/m.test(body) || (/^\d{4}-\d{2}-\d{2}$/.test(d19) && d19 < kitPolicy.confirmDocsEffective);
        return { ...r, storageLegacy: storLegacy };
      }
      const crel = `${WF}/incidents/${base}.md`;
      const cabs = path.join(ROOT, crel);
      if (fs.existsSync(cabs)) {
        const st = fmGet(cabs, '状态');
        if ((st === 'open' || st === 'fixed' || st === 'closed') && incidentMarked19(linesOf(cabs))) {
          return { ok: true, level: fmGet(cabs, '级别'), legacy: false, storageLegacy: false };
        }
        return { ok: false, legacy: false, storageLegacy: false, why: 'incident 未见过目留痕（时间线条目缺失）' };
      }
      return { ok: false, legacy: false, storageLegacy: false, why: '无同名入口' };
    };
    for (const sub of ['specs', 'plans']) {
      for (const abs of docFiles(sub)) {
        if (fmGet(abs, '状态') !== 'draft') continue;
        const base = path.basename(abs).replace(/\.md$/, '');
        // 日期：frontmatter 优先，缺则回落文件名前缀（plan 无「日期」字段；沿检查 15 口径）
        let d = fmGet(abs, '日期');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
        if (!(/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= since)) continue;
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        const ent = entryConfirmed19(base);
        if (!ent.ok) { warnings.push(`- [WARN 逐阶段] ${rel} 起草先于入口确认（${ent.why}）`); continue; }
        // 库存量形态（标记 / 日期早于生效日）短路 level 校验与 spec 档（与起草门同口径，N1）
        const storLegacy = ent.storageLegacy === true;
        if (!storLegacy && !/^L[0-3]$/.test(ent.level)) { warnings.push(`- [WARN 逐阶段] ${rel} 入口缺合法「级别」字段（无法判定前置深度；与起草门 fail-closed 同口径，库存量形态除外）`); continue; }
        if (sub === 'plans' && !storLegacy && (ent.level === 'L2' || ent.level === 'L3')) {
          const srel = `${WF}/specs/${base}.md`;
          const sabs = path.join(ROOT, srel);
          const sp = fs.existsSync(sabs) ? docConfirmed(srel, sabs) : { ok: false, why: '缺同名 spec' };
          if (!sp.ok) warnings.push(`- [WARN 逐阶段] ${rel} 起草先于 spec 确认（${sp.why}）`);
        }
      }
    }
    const firstApproved = new Map(); // base -> { intents?, specs?, plans? } 最早 approved ts
    for (const e of ledgerRows) {
      if (!e || e.stage !== 'approved' || typeof e.doc !== 'string') continue;
      const m = /^workflow\/(intents|specs|plans)\/(.+)\.md$/.exec(e.doc);
      if (!m) continue;
      const rec = firstApproved.get(m[2]) || {};
      if (!rec[m[1]] && typeof e.ts === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(e.ts)) rec[m[1]] = e.ts;
      firstApproved.set(m[2], rec);
    }
    for (const [base, rec] of firstApproved) {
      const seq = ['intents', 'specs', 'plans'].filter((k) => rec[k]);
      if (seq.length < 2) continue;
      const earliest = seq.map((k) => rec[k]).sort()[0];
      if (!(earliest.slice(0, 10) >= since)) continue;
      let ordered = true;
      for (let i = 1; i < seq.length; i++) if (rec[seq[i]] < rec[seq[i - 1]]) ordered = false;
      if (!ordered) warnings.push(`- [WARN 逐阶段] 台账审批顺序倒置：${base}（${seq.map((k) => `${k}=${rec[k].slice(0, 19)}`).join(' / ')}）`);
    }
  }
}

function delegationResultRows(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const lines = text.split(/\r?\n/);
  const targetSec = (line) => /^##\s+(委派结果|自做任务结果)\s*$/.test(line);
  let inSec = false;
  const rows = [];
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inSec = targetSec(line);
      continue;
    }
    if (!inSec || !/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (!cells.length || cells.every((c) => /^[-: ]*$/.test(c))) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) continue;
    rows.push({ date: cells[0], line });
  }
  return rows;
}

function versionGreater(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

function fmStatus(text) {
  const lines = String(text || '').split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] || '')) return '';
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) return '';
    if (lines[i].startsWith('状态:')) return lines[i].slice('状态:'.length).trim();
  }
  return '';
}

// --- 输出（banner 沿 sh 版字样与格式 = 稳定输出契约：banner 后空行、条目 '- ' 前缀）---
if (blockers.length) {
  process.stderr.write(`闭环骨架断档（check-loop.sh）— HARD-BLOCK:\n\n${blockers.join('\n')}\n\n`);
  if (warnings.length) process.stderr.write(`WARN（advisory,不阻断）:\n\n${warnings.join('\n')}\n`);
  process.exit(1);
}
if (warnings.length) {
  process.stderr.write(`check-loop.sh WARN（advisory,不阻断）:\n\n${warnings.join('\n')}\n`);
}
process.exit(0);

// bindingSha256：done 内容绑定的复原重算（检查 15 专用）——confirm-doc.mjs computeFingerprint 的逆推：
// lines 已 CRLF 归一（split(/\r?\n/)），frontmatter 区内首个「状态:」行保分隔符换值为 prev（`状态:  done`
// 双空格 → `状态:  approved`——与前向按原行字面计算对称，非规范分隔符不误伤；行尾空白等更奇异格式仍会
// 失配，触发前提本身已违反「确认落态唯一入口」约定，接受），全文剔「确认指纹:」行后 join('\n') 再 sha256。
function bindingSha256(lines, prevStatus) {
  const isDelim = (l) => /^---\s*$/.test(l);
  const out = [];
  let i = 0;
  if (isDelim(lines[0] || '')) {
    out.push(lines[0]);
    let replaced = false;
    for (i = 1; i < lines.length; i++) {
      if (isDelim(lines[i])) { out.push(lines[i]); i++; break; }
      if (!replaced && /^状态:/.test(lines[i])) {
        out.push(lines[i].replace(/^(\s*状态:\s*)\S.*$/, `$1${prevStatus}`));
        replaced = true;
      } else out.push(lines[i]);
    }
  }
  for (; i < lines.length; i++) out.push(lines[i]);
  return createHash('sha256').update(out.filter((l) => !/^确认指纹:/.test(l)).join('\n'), 'utf8').digest('hex');
}

function readdirOrNull(dir) {
  try { return fs.readdirSync(dir); } catch { return null; }
}
function isDirectoryOrNull(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
