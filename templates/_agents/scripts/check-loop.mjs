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
// 文档协议:机器字段一律由文件头 YAML frontmatter(受限子集:每行 `键: 值`)承载,本脚本只扫 frontmatter 取字段;
//   叙述性字段(独立复核/复盘三件套/验收勾验)按正文行锚定。枚举单源 .agents/workflow-enums.txt
//   (缺文件/缺键 fail-loud exit 1;经 workflow-enums.mjs 读取,CRLF 天然容忍)。
// 已确认状态: approved/done=已批或闭环; superseded/cancelled=放弃留档(仍算确认,不挡 push); incident: fixed/closed
// 用法:node .agents/scripts/check-loop.mjs   （或经 check-loop.sh shim）
// 测试:node templates/_agents/scripts/check-loop.test.mjs（fixture 注入 CHECK_LOOP_ROOT）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadEnums } from './workflow-enums.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

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
    console.error('check-loop: 不在 git 仓库内,跳过扫描');
    process.exit(0);
  }
  ROOT = top.trim();
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
  const r = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', args,
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
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2026-09-22') {
          warnings.push(`- [WARN 模块元数据] ${base} 缺「模块:」字段(2026-09-22 起新建文档必填)`);
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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '2026-09-23') continue; // 生效 2026-09-23 起（规则发布次日）
      const lines = linesOf(doc) || [];
      if (lines.some((l) => l.includes('存量确认态豁免（'))) continue;
      const rel = path.relative(ROOT, doc).split(path.sep).join('/');
      const hit = gitOut(['log', '-1', '--format=%H', '-G', '^状态:[[:space:]]*approved', '--', rel]);
      if (hit !== null && hit.trim() === '') {
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
  const EFFECTIVE = '2026-09-27';
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
      const eff = sub === 'incidents' ? '2026-09-28' : EFFECTIVE;
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
        } else if (!(typeof entry.ts === 'string' && entry.ts >= '2026-09-28')) {
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
// 判据：活跃态文档（draft/approved/open）中出现的 `{{指标名}}` 签名，实时取数比对。
// **为什么只查显式签名、不全文扫数字**（据实说明）：本仓活跃文档「N 行/N 条/N 份」类表述数十处，
// 绝大多数是**历史叙述**（描述某次提交当时的规模，天然不随当前事实变化）——全文扫描会对这些
// 正确表述产生大量假阳性，而本脚本已把「无判定依据的行不产出不可消除噪声」立为红线
// （沿 audit-gate-hardening P3：噪声淹没真漏点）。故本检查假阳性恒为 0，代价是覆盖面靠登记。
// 未登记签名 / 取数器缺失 → fail-loud（不静默跳过：静默会让「登记了但其实没查」不可见）。
// 登记表缺失 → 静默跳过（未启用该检查的装户不应被噪声打扰）。
{
  const mcFile = path.join(ROOT, '.agents', 'metric-claims.txt');
  if (fs.existsSync(mcFile)) {
    // 取数器闭集：全部本地确定性、零网络。新增指标须同时改本表与 metric-claims.txt（缺一 fail-loud）
    // **取数须与扫描面同口径（复核 P2 更正）**：文档扫描走 `docFiles()`（仓库模式只取 HEAD **tracked**
    // 内容，见 isTracked），首版 `countDocs` 却直接 readdir 数盘面——实测本仓 `docs.count.plans` 会
    // 把并行会话的**未跟踪**新档算进去（盘面 60 / HEAD 59），于是「签名填对了」却是别的读者复现不出的
    // 数。故此处同样以 isTracked 过滤，保证「扫描看得到的文档集 == 取数统计的文档集」。
    const countDocs = (sub) => {
      const dir = path.join(ROOT, 'workflow', sub);
      return (readdirOrNull(dir) || []).filter((f) => {
        // 与 docFiles() 同口径：.md + 以数字开头（排除 _TEMPLATE.md 等非实例件）+ tracked
        if (!f.endsWith('.md') || !/^\d/.test(f)) return false;
        return isTracked(path.relative(ROOT, path.join(dir, f)).split(path.sep).join('/'));
      }).length;
    };
    const ledgerLines = () => {
      const p = path.join(ROOT, '.agents', 'confirmations.jsonl');
      const ls = (linesOf(p) || []).filter((l) => l.trim());
      return { total: ls.length, withBatch: ls.filter((l) => /"batch"/.test(l)).length };
    };
    // 内置取数器：全部本地确定性、零网络。**装户零配置即用**（不依赖任何装户文件）。
    const derivers = {
      'ledger.lines': () => ledgerLines().total,
      'ledger.linesWithBatch': () => ledgerLines().withBatch,
      'ledger.linesWithoutBatch': () => ledgerLines().total - ledgerLines().withBatch,
      'docs.count.intents': () => countDocs('intents'),
      'docs.count.specs': () => countDocs('specs'),
      'docs.count.plans': () => countDocs('plans'),
      'docs.count.incidents': () => countDocs('incidents'),
      'docs.count.all': () => countDocs('intents') + countDocs('specs') + countDocs('plans') + countDocs('incidents'),
    };
    // ---- 装户侧取数器（2026-09-28 adopter-derivers；修「owned 登记表配 managed 取数器」P1）----
    // 背景：登记表是 owned（装户自增指标），取数器却曾硬编码在本文件（managed）——装户一新增指标
    // 就报「无取数器」，唯一出路是改本文件，而那是 managed：sync 永久报「本地已改」+ doctor WARN
    // + 本脚本因供应链防线**跳过执行**（门禁静默停摆）。故改为分层：
    //   ① 内置优先（行为与今完全一致，装户零配置可用）；② 未命中则查装户模块 `.agents/metric-derivers.mjs`
    // **载入用 createRequire 同步**（实测：可同步载入 .mjs、返回非 Promise；语法错抛可捕获 SyntaxError），
    // 故本脚本**无须改成 async 主线**——装户用 fs.readFileSync 即可读任意本地文件。契约要求同步函数
    // 也与本检查「零网络、本地确定性」的前提一致（异步的唯一真实收益是网络/并发 IO，此处都不允许）。
    // **失败一律响亮、绝不静默降级**（沿 claim-exceeds-fix「假绿比红危险」与本检查自身语法错教训）：
    // 若载入失败就「只用内置指标」，装户会看到「引用了 my.metric → 未登记」，看起来像**自己忘了登记**，
    // 而真因是模块坏了——他会去 registry 反复核对，问题永远查不到。故载入/调用失败均出明确 WARN。
    const adopterModRel = '.agents/metric-derivers.mjs';
    let adopterState = null; // { ok:true, derivers } | { ok:false, errors:[...] } —— 懒载入 + 单次运行内缓存
    const loadAdopterDerivers = () => {
      if (adopterState) return adopterState;
      const abs = path.join(ROOT, adopterModRel);
      if (!fs.existsSync(abs)) { adopterState = { ok: true, derivers: {} }; return adopterState; } // 缺失=正常态，零告警
      try {
        const req = createRequire(import.meta.url);
        const mod = req(abs);
        const d = mod && mod.derivers;
        if (!d || typeof d !== 'object' || Array.isArray(d)) {
          adopterState = { ok: false, errors: [`${adopterModRel} 未导出 \`derivers\` 对象（实际导出形态：${d === undefined ? '无 derivers 键' : Array.isArray(d) ? 'array' : typeof d}）——载入失败不降级，请修正模块`] };
          return adopterState;
        }
        adopterState = { ok: true, derivers: d };
      } catch (e) {
        adopterState = { ok: false, errors: [`${adopterModRel} 载入失败：${String(e && e.message ? e.message : e).split('\n')[0]}——载入失败不降级（静默降级会让你误以为「忘了登记」而非「模块坏了」）`] };
      }
      return adopterState;
    };
    // ctx：注入给装户取数器的同步辅助（免其重复造轮子）
    // **glob 逐字符转义**（自查修正）：首版用「先整体转义特殊字符、再 replace 星号」的写法，
    // 实测 `src/**/*.ts` 匹配不到 `src/a/b/c.ts`、「**/*.md」匹配不到 `a/b/c.md`——因为 `**/`
    // 在被替换前已被字符类转义破坏。改为逐字符状态机，语义明确：
    //   `**/` → 任意层级（含零层）；`**` → 任意（可跨 /）；`*` → 段内任意（不跨 /）；`?` → 段内单字符
    //   其余一律字面转义（故 `a.b.sql` 的点是字面点、`[`/`{` 也按字面处理——本 helper 不承诺
    //   字符类 / 花括号展开，避免装户误以为支持完整 glob 语法；不支持即按字面匹配，行为可预测）
    const globToRegExp = (p) => {
      const s = String(p);
      let re = '';
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '*' && s[i + 1] === '*') {
          if (s[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } // `**/` 含零层
          else { re += '.*'; i += 1; }                        // `**` 跨段
        } else if (c === '*') re += '[^/]*';
        else if (c === '?') re += '[^/]';
        else re += c.replace(/[.+^${}()|[\]\\]/, '\\$&');
      }
      return new RegExp('^' + re + '$');
    };
    // 遍历时**跳过重目录 + 防环**（自查 + 复核 P2 修正）：
    // · 剪枝 node_modules / .git / cache——无剪枝时 `ctx.glob('**/*')` 会走进依赖树，既慢又会把
    //   依赖文件算进取数（对「我项目有多少个 X」是错的数）。
    // · **visited 集合防环**：复核实测软链接/junction 成环时递归到 depth 128、同一文件重复 64 份
    //   才被 statSync 的 ELOOP 拦下；POSIX 无 MAX_PATH 时该递归无界。故按**真实路径**去重。
    const WALK_SKIP = new Set(['node_modules', '.git', 'cache']);
    const walkFiles = (dir, out = [], rel = '', visited = new Set()) => {
      let real = dir;
      try { real = fs.realpathSync(dir); } catch { /* 不可解析则按原路径处理 */ }
      if (visited.has(real)) return out; // 环 → 剪枝
      visited.add(real);
      for (const e of readdirOrNull(dir) || []) {
        if (WALK_SKIP.has(e)) continue;
        const abs = path.join(dir, e);
        const r = rel ? `${rel}/${e}` : e;
        let st = null;
        try { st = fs.statSync(abs); } catch { continue; }
        if (st.isDirectory()) walkFiles(abs, out, r, visited);
        else out.push(r);
      }
      return out;
    };
    const ctx = {
      root: ROOT,
      read: (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } },
      glob: (pattern) => { const re = globToRegExp(pattern); return walkFiles(ROOT).filter((r) => re.test(r)); },
      countFiles: (dir, pred) => walkFiles(path.join(ROOT, dir)).filter((r) => (typeof pred === 'function' ? pred(r) : true)).length,
    };
    // resolveDeriver(name) → { fn } | { error }（**绝不抛出**：引擎不因装户代码崩溃）
    const resolveDeriver = (name) => {
      if (derivers[name]) return { fn: derivers[name], builtin: true };
      const st = loadAdopterDerivers();
      if (!st.ok) return { error: st.errors.join('；') };
      const fn = st.derivers[name];
      if (typeof fn !== 'function') {
        if (fn !== undefined) return { error: `${adopterModRel} 的「${name}」不是函数（实际类型：${typeof fn}）` };
        return { error: `无对应取数器——内置 8 个指标均不含该名，${adopterModRel} 亦未定义（登记了却没实现＝其实没查）` };
      }
      return { fn, builtin: false };
    };
    // 装户模块载入失败：**独立成条**（2026-09-28 adopter-derivers）。
    // 关键设计（真绿 vs 假绿的分界）：载入失败若只表现为「该指标无取数器」，装户会看到
    // 「引用了 my.metric → 未登记」，看起来像**自己忘了登记**，而真因是模块坏了——他会去 registry
    // 反复核对，永远查不到。故此处单独出一条，明示文件与错误，与「真的没登记」可区分。
    //
    // **仅在真的需要装户指标时才报**（复核 P2 更正）：首版在解析登记表前无条件出账——若登记表只有
    // 内置指标、而装户留了个半成品模块（或模块坏掉但没人用），会平白多一条不可消除的 advisory。
    // 沿本仓红线「无判定依据的行不产出噪声」：先看登记表是否真的有**非内置**指标，再决定报不报。
    const mcLines = (linesOf(mcFile) || []).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const hasAdopterMetric = mcLines.some((l) => {
      const mm = /^([A-Za-z][\w.]*)\s*=\s*([A-Za-z][\w.]*)$/.exec(l);
      return mm && !derivers[mm[1]];
    });
    const adopterLoad = loadAdopterDerivers();
    if (!adopterLoad.ok && hasAdopterMetric) {
      for (const e of adopterLoad.errors) warnings.push(`- [WARN 装户取数器载入失败] ${e}`);
    }
    // 解析登记表：`<指标名> = <取数表达式>`（表达式须与指标名同形，二者不一致即登记笔误）
    const declared = new Map();
    const precedenceWarned = new Set(); // 同名 advisory 按指标去重（复核 P2 更正：首版按行重复出账）
    for (const line of mcLines) {
      const m = /^([A-Za-z][\w.]*)\s*=\s*([A-Za-z][\w.]*)$/.exec(line);
      if (!m) { warnings.push(`- [WARN 指标登记] .agents/metric-claims.txt 行格式非法（应为 \`指标名 = 取数表达式\`）：${line}`); continue; }
      if (m[1] !== m[2]) { warnings.push(`- [WARN 指标登记] 登记名与取数表达式不一致：${m[1]} ≠ ${m[2]}`); continue; }
      const r = resolveDeriver(m[1]);
      if (r.error) {
        // 无取数器（内置无 + 装户模块无同名）或装户模块载入失败 → 明示可操作方向
        const hint = adopterLoad.ok
          ? `若为项目自有指标，请在 ${adopterModRel} 的 derivers 中实现（契约见 .agents/metric-claims.txt 头部）`
          : `且 ${adopterModRel} 载入失败（见上方「装户取数器载入失败」条目——**这不是「忘了登记」**）`;
        warnings.push(`- [WARN 指标登记] 指标「${m[1]}」无对应取数器（fail-loud：登记了却没实现＝其实没查）——内置 8 指标不含该名，${hint}`);
        // **不 continue**：该指标在 registry 里确实登记过，故仍计入 declared——
        // 否则引用它的文档会被误报为「未登记」（把「模块坏了」伪装成「忘了登记」，正是本单要防的假绿）。
        // 取数失败在扫描阶段以「指标取数失败」单独出账，两条信息不互相掩盖。
      } else if (r.builtin && adopterLoad.ok && typeof adopterLoad.derivers[m[1]] === 'function' && !precedenceWarned.has(m[1])) {
        // 内置与装户同名：内置优先（保持本仓/存量行为稳定），并明示装户定义被忽略（**按指标去重**）
        precedenceWarned.add(m[1]);
        warnings.push(`- [WARN 指标登记] 指标「${m[1]}」由引擎内置提供，${adopterModRel} 中的同名定义**被忽略**（内置优先）——如需改用自有实现，请换一个指标名`);
      }
      declared.set(m[1], true);
    }
    // 扫活跃态文档（沿检查 4 现有尺度：终态件的历史数字是历史叙述，不扫）
    const activeSet16 = (sub) => (sub === 'incidents' ? ENUMS['incident.status.active'] : ENUMS['doc.status.active']);
    const scanFiles16 = [];
    for (const sub of ['intents', 'specs', 'plans', 'incidents']) {
      const dir = path.join(ROOT, 'workflow', sub);
      for (const f of readdirOrNull(dir) || []) {
        if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
        if (!inSet(fmGet(path.join(dir, f), '状态'), activeSet16(sub))) continue;
        scanFiles16.push({ rel: `workflow/${sub}/${f}`, abs: path.join(dir, f) });
      }
    }
    for (const f of readdirOrNull(path.join(ROOT, 'workflow')) || []) {
      if (f.endsWith('.md')) scanFiles16.push({ rel: `workflow/${f}`, abs: path.join(ROOT, 'workflow', f) });
    }
    for (const { rel, abs } of scanFiles16) {
      const ls = linesOf(abs) || [];
      ls.forEach((line, i) => {
        // 签名形态收窄为**小写点分**（如 `{{ledger.lines}}`）：装户模板占位符是全大写 SCREAMING_CASE
        // （构建命令 / 看板端口 / 项目名三类，由 init 渲染替换，非本检查对象）
        // ——不收窄会对这些合法的模板占位符产生大量假阳性（实测：本仓 plans 内 11 处）。
        // **转义（2026-09-28，本检查在自己的文档上抓到该需求）**：讲语法 / 举例 / 引用告警原文的
        // 文档在签名前加反斜杠（`\{{ledger.lines}}`）表示「此处是示意、非断言」——否则本检查
        // 会把「文档在教怎么用签名」误判为「作者忘了回填」。选显式转义而非「同句含『如/例』等标记词
        // 即豁免」的启发式：后者会按措辞松紧漂移，且作者能无意中触发豁免而漏过真断言。
        // **转义按「逐个出现」生效、不按整行**（复核自查 P1 更正）：首版实现是「行内出现任一 `\{{`
        // 即整行跳过」，实测可被这样藏住真断言——`… \{{a.b}} 示意… {{ledger.lines}} 未回填` 整行静默
        // 放过。故改为用带后顾的否匹配排除转义位，同行的真签名照常出账。
        for (const m of line.matchAll(/(?<!\\)\{\{([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\}\}/g)) {
          const name = m[1];
          if (!declared.has(name)) {
            warnings.push(`- [WARN 指标未登记] ${rel}:${i + 1} 引用 {{${name}}} 但 .agents/metric-claims.txt 未登记该指标（未登记＝无从对账）`);
            continue;
          }
          const r = resolveDeriver(name);
          if (r.error) {
            // 取数器不可用（含装户模块载入失败 / 无该名 / 定义非法）——**响亮出账，绝不静默跳过**
            warnings.push(`- [WARN 指标取数失败] ${rel}:${i + 1} {{${name}}} 无法取数：${r.error}`);
            continue;
          }
          let real;
          try {
            real = r.fn(ctx);
          } catch (e) {
            warnings.push(`- [WARN 指标取数失败] ${rel}:${i + 1} {{${name}}} 取数器抛异常：${String(e && e.message ? e.message : e).split('\n')[0]}`);
            continue;
          }
          // 返回值必须是有限数字：Promise（误写 async）/ NaN / 字符串 / undefined 一律拦下并明示类型
          if (typeof real !== 'number' || !Number.isFinite(real)) {
            const kind = real && typeof real.then === 'function' ? 'Promise（本检查要求**同步**函数，请去掉 async/await）' : `${typeof real}${typeof real === 'number' ? `（${real}）` : ''}`;
            warnings.push(`- [WARN 指标取数失败] ${rel}:${i + 1} {{${name}}} 取数器返回值不是有限数字：${kind}`);
            continue;
          }
          // 判据：签名**必须**被替换为实时值——留有 `{{...}}` 即视为未回填（写作期占位，关单前须落实）
          warnings.push(`- [WARN 指标待回填] ${rel}:${i + 1} {{${name}}} 实时值 = ${real}——请把签名替换为该数字（留签名＝未回填）`);
        }
        // **形态不符的签名也不静默放过（复核 P2 更正）**：首版只认严格小写点分形态，于是
        // `{{Ledger.Lines}}` / `{{ ledger.lines }}`（含空格）这类**明显本意是签名**的写法
        // 既不匹配、也不出账——静默漏过，且绕开了「未登记」的 fail-loud。此处补一道：
        // 非转义的 `{{...}}` 中，凡**不是**严格形态、且**不是**装户模板占位符（全大写 SCREAMING_CASE）
        // 的，一律提示形态不符（作者才能立刻发现笔误）。
        for (const m of line.matchAll(/(?<!\\)\{\{([^{}]+)\}\}/g)) {
          const raw = m[1];
          if (/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/.test(raw)) continue; // 严格形态，上面已处理
          if (/^[A-Z][A-Z0-9_]*$/.test(raw)) continue; // 装户模板占位符（init 渲染对象，非本检查面）
          warnings.push(`- [WARN 指标形态] ${rel}:${i + 1} \`{{${raw}}}\` 不是合法签名形态（应为小写点分，如 {{ledger.lines}}）——若本意是量化断言，请改正形态；若只是举例，请加反斜杠转义`);
        }
      });
    }
  }
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
