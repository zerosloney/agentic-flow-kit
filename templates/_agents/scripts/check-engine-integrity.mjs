#!/usr/bin/env node
// check-engine-integrity.mjs — 门禁本体完整性门（2026-10-09 P0-A：破「裁判给自己判无罪」）
//
// 要解决的缺陷（审查结论 P0 第一条，本仓一手证据）：
//   ① `.agents/` 脚本属 new-task.md §5「docs 级豁免 → 直接 commit」，而 check-lane-surface 检查 A 在
//      「无活跃入口」时只 advisory —— 两条组合 = 改弱 check-loop.mjs 里某道门可无入口直接提交；
//   ② CI 的机器门跑的是**被测分支自己的** `.agents/scripts/check-loop.mjs`（ci.yml:42）——被改坏的
//      裁判验证自己的篡改，无外部参照，CI 全绿。
//
// 本门的做法：把「门禁本体当前的硬拦面」**冻结进一个入库基线** `templates/_agents/engine-lock.json`，
//   判定 = 包源盘面向量 ↔ 基线逐项比对（哈希 + 硬拦单位数）。它不是签名、也不宣称不可伪造——
//   它把「静默改弱」变成「必须显式 --update 的改弱」：
//     · 硬拦单位数**下降**（删 blocker / 删 exit 1 / 从面清单删行 / 从 CI 删一次门调用）→ 无条件 BLOCK；
//     · 内容变了但硬拦面没缩 → 同样 BLOCK，直到跑 --update 把新盘面显式入账；
//     · 基线本身在受检面内（control-surfaces 列了 templates/_agents/engine-lock.json），
//       改基线同样要过本门（对基线的改动 = 受检面内容变更 → 未入新基线即拦）。
//   诚实边界：`--no-verify` / 不挂 hooksPath / 删掉本脚本仍可绕过本地门，兜底 = CI 复跑
//   （本脚本被 .github/workflows 的 engine-integrity job 调用）+ 分支保护；本地信任边界内
//   不可机器防这一点不掩盖（沿 policy.mjs#ledgerChainHash 与 README 确认门口径）。
//
// **无声明式豁免（2026-10-13 移除入口退路）**：此前本门有两档豁免——本地层「正文提及即认」、
//   锚层「活跃 L2/L3 入口在 §改动面 点名」，参照物是 `<root>/workflow/{intents,incidents}`。
//   但 1.7.15「卸掉同仓双身份」后**包源仓已无该目录**（装户端内容清理），退路在本仓结构性不可达：
//   门消息让包源维护者去「立 L2 入口」，而立不了——不可达的能力等于误导。故整体移除（连带
//   T4b/T4c/T4d 与锚层严格档测试）：本仓只认 --update 这一条显式演进路径，语义更少、更可核对。
//   **代价（诚实记录）**：跨提交锚只比对**硬拦单位数**、不比 sha，故「改写某检查的语义但保住
//   exit 1 计数 + --update」这一形态两层都绿。补法是让锚层也比对 sha，代价是每次合法演进都需一份
//   显式凭据（改判据面，未决）。
//
// 可选外部锚两条（都是「不受被测对象控制的参照物」，缺省不启用=无外部副本/无历史时不误报）：
//   --against <目录>      逐字比对包源件与外部副本（装户/发布仓：node_modules/agentic-flow-kit）
//   --against-ref <ref>   跨提交锚（破 CI 自指的关键一环）：从**历史 ref** 读基线（git show <ref>:<lock>），
//     与盘面硬拦单位数做单调比较。本地门只比「盘面 ↔ 同分支基线」——恶意分支可同时改弱门禁并 --update
//     重写基线，两者自洽、CI 全绿（「裁判给自己判无罪」的第二形态）。跨提交锚的参照物在**祖先提交**里，
//     改它要 rewrite history + 强推（分支保护拦住），CI 由此获得一个不受被测分支控制的参照。
//     硬拦面收缩在本层**无豁免出口**：锚的参照物分支改不动，只能改判据基线并走评审。
//     ref 不可解析 / 该 ref 无基线（首个入账提交）→ 跳过并报 ℹ️（锚缺失不误报）。
//
// 判据原则（沿 check-lane-surface）：只用一手事实——盘面字节哈希与可数单位；
//   不从时间戳反推过程、不靠文档正文为改动背书。
// 用法：node check-engine-integrity.mjs [--root <dir>] [--update] [--against <dir>] [--against-ref <ref>] [--quiet]
//   --update  按当前盘面重生成基线（合法演进的唯一路径：演进=显式改基线，不存在自动放行）
// 退出码：0 通过（含基线缺失=未启用）；1 阻断（stderr 出 [标签] 与修法，或目标根不是包源仓）；2 用法错误（如 --against 目录不存在）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
};
const QUIET = argv.includes('--quiet');
const UPDATE = argv.includes('--update');

const ROOT = argOf('--root') || (() => {
  const r = spawnSync('git', ['-C', process.cwd(), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').trim() : process.cwd();
})();
// 只认包源。基线固定 templates/_agents/engine-lock.json。受检面只扫包源模板
// （scripts / _githooks / templates/_github / .github/workflows / templates/AGENTS.md / templates/_agents/*.txt）。
// `.github/workflows/*.yml` 是包源自身的 CI 编排——本门的调用点在那儿，不纳入就等于门可被无声关闭。
// 不扫 .agents、不扫项目根 .githooks、不按「有没有 .agents」猜布局。
// 无 templates/_agents 时所有模式都拒绝：静默扫到 0 个文件会看起来像通过。
// render.mjs 排除 .agents/engine-lock.json，避免把包源基线下发进装户。
const pkgAgents = path.join(ROOT, 'templates', '_agents');
if (!fs.existsSync(pkgAgents)) {
  console.error(`check-engine-integrity 只在包源仓运行（需要 templates/_agents）。目标根 ${ROOT} 不是包源仓。`);
  process.exit(1);
}
const LOCK_REL = 'templates/_agents/engine-lock.json';
const LOCK_ABS = path.join(ROOT, LOCK_REL);

// ---- 受检面（单源：本函数；基线与比对同一份清单，防「基线少记一项」的静默空洞）----
const gateFiles = () => {
  const out = new Set();
  const add = (rel) => { if (fs.existsSync(path.join(ROOT, rel)) && fs.statSync(path.join(ROOT, rel)).isFile()) out.add(rel); };
  const addDir = (relDir, filter = () => true) => {
    const abs = path.join(ROOT, relDir);
    if (!fs.existsSync(abs)) return;
    for (const f of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const rel = `${relDir}/${f.name}`;
      if (filter(rel)) add(rel);
    }
  };
  addDir('templates/_agents/scripts', (r) => /\.mjs$/.test(r) && !r.endsWith('.test.mjs'));
  addDir('templates/_githooks');
  addDir('templates/_github/workflows', (r) => r.endsWith('.yml'));
  // 包源自身的机器门编排（.github/workflows/*.yml）。**刻意纳入**：本门是「唯一能防改弱门禁本体」的检查，
  //   而门要成为门就得有人调用它——调用点只存在于 CI 编排里。不纳入的话，删掉编排里的本门调用
  //   （或整个 job）没有任何检查会发现：被保护面之外的空白，正是它自身失效的那条路径。
  addDir('.github/workflows', (r) => r.endsWith('.yml'));
  for (const f of ['lane-surfaces.txt', 'control-surfaces.txt', 'workflow-enums.txt', 'workflow-modules.txt',
    'scripts-test-exempt.txt', 'rule-budgets.txt', 'metric-claims.txt',
    // level-hints.txt（2026-10-13 flow-kit-route 补录）：风险级别的**路径下限**清单，直接驱动
    //   flow-kit route 定级结果，且语法错会 fail-loud 抛 LEVEL_HINTS_INVALID 改判级结论。
    //   与 lane-surfaces.txt / workflow-modules.txt 同属「喂判据的输入面」，此前漏在受检面外。
    'level-hints.txt']) {
    add(`templates/_agents/${f}`);
  }
  add('templates/AGENTS.md');
  return [...out].sort();
};

// LF 归一 sha（口径同 src/sync.mjs#shaText：CRLF 检出与 LF 克隆同值，基线跨平台稳定）
const shaOf = (abs) => createHash('sha256')
  .update(Buffer.from(fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex');

// 硬拦单位数：文件里「这道门会拦下来」的可数形态。判据刻意保守（只数结构性标志，不数注释/文案）——
// 目的是抓「删掉一道拦人的分支」，不是抓「改写了一句提示」。
const hardUnits = (rel, text) => {
  const count = (re) => (text.match(re) || []).length;
  if (/\.m?c?js$/.test(rel) && !rel.endsWith('.test.mjs')) return count(/blockers\.push\(/g) + count(/process\.exit\(1\)/g);
  if (/^(\.githooks|templates\/_githooks)\//.test(rel) || /\.sh$/.test(rel) || rel.endsWith('local-pre-commit')) {
    return count(/\bexit\s+1\b/g);
  }
  if (rel.endsWith('.yml')) return count(/node [^\s]*scripts\/[^\s]*\.(mjs|cjs|sh)/g); // CI 里每道门的调用
  if (/\.(txt|json)$/.test(rel)) {
    return text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).length; // 面清单：行即判据
  }
  if (rel.endsWith('AGENTS.md')) return count(/^[-#]/gm); // 常驻规则面条目（协议面）
  return 0;
};

const buildLock = () => {
  const files = {};
  for (const rel of gateFiles()) {
    const abs = path.join(ROOT, rel);
    files[rel] = { sha256: shaOf(abs), hard: hardUnits(rel, fs.readFileSync(abs, 'utf8')) };
  }
  return { schema: 1, generatedAt: new Date().toISOString(), files };
};

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};


if (UPDATE) {
  fs.mkdirSync(path.dirname(LOCK_ABS), { recursive: true });
  const lock = buildLock();
  const prev = readJson(LOCK_ABS);
  const changed = prev ? Object.keys(lock.files).filter((k) => !prev.files[k] || prev.files[k].sha256 !== lock.files[k].sha256) : Object.keys(lock.files);
  const removed = prev ? Object.keys(prev.files).filter((k) => !lock.files[k]) : [];
  fs.writeFileSync(LOCK_ABS, JSON.stringify(lock, null, 2) + '\n');
  console.log(`引擎基线已更新：${LOCK_REL}（受检面 ${Object.keys(lock.files).length} 个文件）`);
  if (changed.length) console.log(`  本次入账为改动件：${changed.length} 个`);
  if (removed.length) console.log(`  本次移除（文件已不在盘）：${removed.join(' ')}`);
  console.log('  ⚠️ 基线更新本身是控制面改动：须与该次演进的 CHANGELOG 记录同批提交（改基线 = 受检面内容变更，不入新基线即被本门拦）');
  process.exit(0);
}

const lock = readJson(LOCK_ABS);
const problems = [];
const current = {};
for (const rel of gateFiles()) current[rel] = { sha256: shaOf(path.join(ROOT, rel)), hard: hardUnits(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')) };

// ---- 跨提交锚（先于本地基线判定：恶意分支把盘面 engine-lock.json 删掉也逃不掉这一层——参照物读自 git 对象库）----
if (argOf('--against-ref')) {
  const ref = argOf('--against-ref');
  let anchor = null;
  const r = spawnSync('git', ['-C', ROOT, 'show', `${ref}:${LOCK_REL}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { anchor = JSON.parse(String(r.stdout || '')); } catch { /* 该 ref 无基线 */ }
  if (!anchor || !anchor.files) anchor = null;
  if (!anchor) {
    if (!QUIET) console.log(`ℹ️  跨提交锚缺失（${ref} 无 ${LOCK_REL}）——该层跳过（首个入账提交/浅克隆）`);
  } else {
    for (const [rel, was] of Object.entries(anchor.files)) {
      const got = current[rel];
      if (!got) { problems.push(`[门禁件消失（跨提交锚）] ${rel} 在 ${ref} 的基线内但盘面不存在——删除一道门等于禁用该检查`); continue; }
      if (typeof was.hard !== 'number' || got.hard >= was.hard) continue;
      problems.push(`[硬拦面收缩（跨提交锚）] ${rel} 硬拦单位数 ${was.hard}（见 ${ref}）→ 盘面 ${got.hard}，减少 ${was.hard - got.hard}——祖先提交是参照物，本分支改不动它。本门无声明式豁免出口（2026-10-13 移除：入口退路在本仓结构性不可达，详见文件头），收缩一律拦`);
    }
  }
}

if (!lock || !lock.files) {
  if (!QUIET) console.log(`ℹ️ 引擎基线未启用（无 ${LOCK_REL}）——跑 node templates/_agents/scripts/check-engine-integrity.mjs --update 生成（跨提交锚与外部副本锚照常执行）`);
} else {
  for (const [rel, want] of Object.entries(lock.files)) {
    const got = current[rel];
    const name = path.basename(rel);
    if (!got) { problems.push(`[门禁件消失] ${rel} 在基线内但盘面不存在——删除一道门等于禁用该检查`); continue; }
    if (got.sha256 === want.sha256) continue;
    if (typeof want.hard === 'number' && got.hard < want.hard) {
      problems.push(`[硬拦面收缩] ${rel} 硬拦单位数 ${want.hard} → ${got.hard}（减少 ${want.hard - got.hard}）——删 blocker/exit/判据行的结构性形态，一律拦`);
    } else {
      problems.push(`[控制面改动未入基线] ${rel} 内容与基线不符（${name} 硬拦单位数 ${want.hard} → ${got.hard}）——门禁本体的每次演进都要显式更新基线，不存在「声明过的改动」自动放行`);
    }
  }
  for (const rel of Object.keys(current)) {
    if (!lock.files[rel]) problems.push(`[门禁件未入基线] ${rel} 是新出现的受检文件——合法新增判据须跑 --update 入账`);
  }
}

if (argOf('--against')) {
  const ext = path.resolve(argOf('--against'));
  if (!fs.existsSync(ext)) { console.error(`用法：--against 目录不存在（${ext}）`); process.exit(2); }
  const extProblems = [];
  for (const rel of Object.keys(current)) {
    const extAbs = path.join(ext, rel);
    if (!fs.existsSync(extAbs)) continue; // 外部副本不含该件（如装户无 templates/）——不判
    if (shaOf(extAbs) !== current[rel].sha256) extProblems.push(`  ${rel} 与外部已知良好副本失配`);
  }
  if (extProblems.length) problems.push(`[外部锚失配] 受检面与 ${argOf('--against')} 逐字比对不一致（外部裁判不认本次改动面）：\n${extProblems.join('\n')}`);
}

if (problems.length) {
  console.error(`引擎完整性 — HARD-BLOCK:\n\n${problems.map((p) => `- ${p}`).join('\n')}\n`);
  console.error(`  修法：确属门禁演进 → 跑 node templates/_agents/scripts/check-engine-integrity.mjs --update 入账，并与 CHANGELOG 记录同批提交（提交评审即对质场；本门无声明式豁免出口，见文件头）`);
  console.error('  修法：非演进（误改/被他人改动）→ git diff 核对并回退，勿改基线绕过（基线本身在控制面清单内，改它同样是受检面变更）');
  process.exit(1);
}
if (!QUIET) console.log(`✅ 引擎完整性：受检面 ${Object.keys(current).length} 个文件（硬拦面无收缩${lock && lock.files ? '、盘面与基线一致' : '、本地基线未启用'}）`);
process.exit(0);
