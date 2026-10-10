#!/usr/bin/env node
// check-engine-integrity.mjs — 门禁本体完整性门（2026-10-09 P0-A：破「裁判给自己判无罪」）
//
// 要解决的缺陷（审查结论 P0 第一条，本仓一手证据）：
//   ① `.agents/` 脚本属 new-task.md §5「docs 级豁免 → 直接 commit」，而 check-lane-surface 检查 A 在
//      「无活跃入口」时只 advisory —— 两条组合 = 改弱 check-loop.mjs 里某道门可无入口直接提交；
//   ② CI 的机器门跑的是**被测分支自己的** `.agents/scripts/check-loop.mjs`（ci.yml:42）——被改坏的
//      裁判验证自己的篡改，无外部参照，CI 全绿。
//
// 本门的做法：把「门禁本体当前的硬拦面」**冻结进一个入库基线** `.agents/engine-lock.json`，
//   判定 = HEAD 盘面向量 ↔ 基线逐项比对（哈希 + 硬拦单位数）。它不是签名、也不宣称不可伪造——
//   它把「静默改弱」变成「必须显式声明的改弱」：
//     · 硬拦单位数**下降**（删 blocker / 删 exit 1 / 从面清单删行 / 从 CI 删一次门调用）→ 无条件 BLOCK；
//     · 内容变了但硬拦面没缩 → 须有一份**活跃 L2/L3 入口文档正文点名该文件**，否则 BLOCK；
//     · 基线本身在受检面内（engine-lock.json 已入 control-surfaces，装户径与包源径两面），
//       改基线同样要过入口门。
//   于是绕过路径从「编辑一个文件」抬到「编辑两个文件 + 立一份 L2 文档 + 落一条确认台账 + 提交」——
//   每一环都在 git 历史与台账里留痕，可事后对质。诚实边界：`--no-verify` / 不挂 hooksPath /
//   删掉本脚本仍可绕过本地门，兜底 = CI 复跑（本脚本被 ci.yml 调用）+ 分支保护；本地信任边界内
//   不可机器防这一点不掩盖（沿 policy.mjs#ledgerChainHash 与 README 确认门口径）。
//
// 可选外部锚两条（都是「不受被测对象控制的参照物」，缺省不启用=无外部副本/无历史时不误报）：
//   --against <目录>      逐字比对包源件与外部副本（装户/发布仓：node_modules/agentic-flow-kit）
//   --against-ref <ref>   跨提交锚（破 CI 自指的关键一环）：从**历史 ref** 读基线（git show <ref>:<lock>），
//     与盘面硬拦单位数做单调比较。本地门只比「盘面 ↔ 同分支基线」——恶意分支可同时改弱门禁并 --update
//     重写基线，两者自洽、CI 全绿（「裁判给自己判无罪」的第二形态）。跨提交锚的参照物在**祖先提交**里，
//     改它要 rewrite history + 强推（分支保护拦住），CI 由此获得一个不受被测分支控制的参照。
//     合法收缩（退役一道门）不是一步死路：本地层宽松档（正文提及即认），锚层**严格档**——须活跃
//     L2/L3 入口在 §改动面 段落点名该文件（正文顺手提及不豁免；否则存量无关 L2 文档可替任意改弱背书）。
//     ref 不可解析 / 该 ref 无基线（首个入账提交）→ 跳过并报 ℹ️（锚缺失不误报）。
//
// 判据原则（沿 check-lane-surface）：只用一手事实——盘面字节哈希、可数单位、文档正文点名；
//   不从时间戳反推过程。
// 用法：node check-engine-integrity.mjs [--root <dir>] [--update] [--against <dir>] [--against-ref <ref>] [--quiet]
//   --update  按当前盘面重生成基线（合法演进的最后一步；本身是控制面改动，须与入口文档同批提交）
// 退出码：0 通过（含基线缺失=未启用）；1 阻断（stderr 出 [标签] 与修法）；2 用法错误（如 --against 目录不存在）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { laneOfEntry, laneOfDoc } from './stage-gates.mjs';
import { loadKitPolicy } from './policy.mjs';

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
// 引擎基线路径双布局（装户端内容清理后）：盘面已有基线按其径读；两处皆无时按**仓库布局**定
// 落点——.agents/ 在 = 装户径；否则 templates/_agents/ 在 = 包源径（--update 才不会重建已清理的装户目录）。
// ⚠️ 包源径在 sync 下发面内（render.mjs 只排除 .agents/cache）：包源基线的键是 templates/_agents/scripts/…
// 路径，装户盘面是 .agents/scripts/…——一旦把包源基线入库，sync 会把它下发进每个装户的 .agents/，
// 命名空间错配 → 全员误报「门禁件消失 / 未入基线」。纯包源仓**不得入库包源基线**；要引擎仓自证
// 完整性，须把基线放到 sync 扫描面之外（如仓库根）再接线 CI，且其豁免出口（L2 入口）在纯包源仓
// 无 workflow/ 的情况下无处可立——这是设计约束，不是待修缺陷。
const LOCK_CANDIDATES = ['.agents/engine-lock.json', 'templates/_agents/engine-lock.json'];
const resolveLock = () => {
  for (const rel of LOCK_CANDIDATES) {
    if (fs.existsSync(path.join(ROOT, rel))) return { rel, abs: path.join(ROOT, rel) };
  }
  const fallback = fs.existsSync(path.join(ROOT, '.agents'))
    ? LOCK_CANDIDATES[0]
    : LOCK_CANDIDATES[1];
  return { rel: fallback, abs: path.join(ROOT, fallback) };
};
const { rel: LOCK_REL, abs: LOCK_ABS } = resolveLock();

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
  addDir('.agents/scripts', (r) => /\.mjs$/.test(r) && !r.endsWith('.test.mjs'));
  addDir('templates/_githooks');
  addDir('.githooks');
  addDir('.agents/hooks');
  addDir('.github/workflows', (r) => r.endsWith('.yml'));
  addDir('templates/_github/workflows', (r) => r.endsWith('.yml'));
  for (const f of ['lane-surfaces.txt', 'control-surfaces.txt', 'workflow-enums.txt', 'workflow-modules.txt',
    'scripts-test-exempt.txt', 'rule-budgets.txt', 'metric-claims.txt']) {
    add(`.agents/${f}`);
    add(`templates/_agents/${f}`);
  }
  add('AGENTS.md');
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

// 活跃 L2/L3（泳道 high）入口集合：一次扫描，宽松/严格两档判据共用同一份盘面事实
const HIGH_ENTRIES = (() => {
  const ACTIVE = { intent: new Set(['draft', 'approved']), incident: new Set(['open', 'fixed']) };
  const fmGet = (lines, key) => {
    for (let i = 1; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i])) break;
      const m = lines[i].match(new RegExp(`^${key}:\\s*(.*)$`));
      if (m) return m[1].trim();
    }
    return '';
  };
  const pol = loadKitPolicy(ROOT);
  const cache = [];
  for (const [dir, kind] of [['intents', 'intent'], ['incidents', 'incident']]) {
    const dp = path.join(ROOT, 'workflow', dir);
    if (!fs.existsSync(dp)) continue;
    for (const f of fs.readdirSync(dp)) {
      if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
      const abs = path.join(dp, f);
      let lines;
      try { lines = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').split('\n'); } catch { continue; }
      if (!/^---\s*$/.test(lines[0] || '')) continue;
      const st = fmGet(lines, '状态');
      if (!ACTIVE[kind].has(st)) continue;
      const level = fmGet(lines, '级别');
      const lane = kind === 'intent'
        ? laneOfEntry(level, fmGet(lines, 'risk_level'), pol.riskLevelSince, fmGet(lines, '日期'))
        : laneOfDoc(level);
      if (lane !== 'high') continue;
      cache.push({ rel: `workflow/${dir}/${f}`, text: lines.join('\n') });
    }
  }
  return cache;
})();

// 宽松档（本地层）：整条 rel 或 basename 出现在正文即认——口径同检查 8 的「声明改动面 ↔ 提交文件」
//   模糊匹配，宁松不假阳性；精确性由 confirm-doc 指纹与台账承担。
const entryNamesFile = (fileRel) => {
  const base = path.basename(fileRel);
  return HIGH_ENTRIES.find((e) => e.text.includes(fileRel) || e.text.includes(base)) || null;
};

// 严格档（仅跨提交锚用）：入口须在**声明改动面**段落点名该文件，而非正文任意一处提及。
//   为什么分层：本地层的模糊放行代价低（内容漂移本就允许「声明过的演进」）；锚层拦的是
//   「硬拦单位数下降」——若一句顺手提及就能豁免，本仓实测三份**与本批无关的存量 L2 incident**
//   （2026-09-28-metric-claim-gate / 2026-10-03-plan-confirm-boiler 正文含 check-loop.mjs，
//   2026-09-26-managed-ledger-adopt 含 pre-commit）即可替任意改弱行为背书，锚等于没有。
//   严格档的误拦修法就是协议本意：把该文件写进入口的 §改动面。
const entryDeclaresFile = (() => {
  const SECTION = /^[^\n]{0,40}改动面/;
  const declared = (text) => {
    const lines = text.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i]) || !SECTION.test(lines[i])) continue;
      // 含标题行本身（「§改动面 点名 x.mjs」是常见的一行式声明）与标题后到下一个 heading 前的全部正文
      for (let j = i; j < lines.length && (j === i || !/^\s*#{1,6}\s/.test(lines[j])); j++) out.push(lines[j]);
    }
    return out.join('\n');
  };
  return (fileRel) => {
    const base = path.basename(fileRel);
    return HIGH_ENTRIES.find((e) => { const s = declared(e.text); return s.includes(fileRel) || s.includes(base); }) || null;
  };
})();

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
  console.log('  ⚠️ 基线更新本身是控制面改动：须与点名这些文件的 L2 入口文档同批提交（否则检查 C / 本门默认模式会拦）');
  process.exit(0);
}

const lock = readJson(LOCK_ABS);
const problems = [];
const current = {};
for (const rel of gateFiles()) current[rel] = { sha256: shaOf(path.join(ROOT, rel)), hard: hardUnits(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')) };

// ---- 跨提交锚（先于本地基线判定：恶意分支把盘面 engine-lock.json 删掉也逃不掉这一层——参照物读自 git 对象库）----
if (argOf('--against-ref')) {
  const ref = argOf('--against-ref');
  // 两候选径都试（装户径 / 包源径）——纯包源仓的基线在 templates/_agents/ 下，锚须读得到
  let anchor = null;
  for (const rel of LOCK_CANDIDATES) {
    const r = spawnSync('git', ['-C', ROOT, 'show', `${ref}:${rel}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    try { anchor = JSON.parse(String(r.stdout || '')); } catch { /* 该候选径在此 ref 无基线 → 试下一个 */ }
    if (anchor && anchor.files) break;
    anchor = null;
  }
  if (!anchor) {
    if (!QUIET) console.log(`ℹ️  跨提交锚缺失（${ref} 无 ${LOCK_REL}）——该层跳过（首个入账提交/浅克隆）`);
  } else {
    for (const [rel, was] of Object.entries(anchor.files)) {
      const got = current[rel];
      if (!got) { problems.push(`[门禁件消失（跨提交锚）] ${rel} 在 ${ref} 的基线内但盘面不存在——删除一道门等于禁用该检查`); continue; }
      if (typeof was.hard !== 'number' || got.hard >= was.hard) continue;
      const e = entryDeclaresFile(rel);
      if (!e) {
        problems.push(`[硬拦面收缩（跨提交锚）] ${rel} 硬拦单位数 ${was.hard}（见 ${ref}）→ 盘面 ${got.hard}，减少 ${was.hard - got.hard}——祖先提交是参照物，本分支改不动它；确需退役该判据须有活跃 L2/L3 入口在**声明改动面**段落点名该文件（正文顺手提及不算——存量无关文档会替任意改弱行为背书）`);
      }
    }
  }
}

if (!lock || !lock.files) {
  if (!QUIET) console.log(`ℹ️ 引擎基线未启用（无 ${LOCK_REL}）——跑 node .agents/scripts/check-engine-integrity.mjs --update 生成（跨提交锚与外部副本锚照常执行）`);
} else {
  for (const [rel, want] of Object.entries(lock.files)) {
    const got = current[rel];
    const name = path.basename(rel);
    if (!got) { problems.push(`[门禁件消失] ${rel} 在基线内但盘面不存在——删除一道门等于禁用该检查`); continue; }
    if (got.sha256 === want.sha256) continue;
    if (typeof want.hard === 'number' && got.hard < want.hard) {
      problems.push(`[硬拦面收缩] ${rel} 硬拦单位数 ${want.hard} → ${got.hard}（减少 ${want.hard - got.hard}）——删 blocker/exit/判据行的结构性形态，无论是否声明均拦`);
    } else {
      const e = entryNamesFile(rel);
      if (!e) problems.push(`[控制面改动无入口] ${rel} 内容与基线不符（${name} 硬拦单位数 ${want.hard} → ${got.hard}）——无活跃 L2/L3 入口正文点名该文件`);
    }
  }
  for (const rel of Object.keys(current)) {
    if (!lock.files[rel]) problems.push(`[门禁件未入基线] ${rel} 是新出现的受检文件——合法新增判据须跑 --update 并把基线更新与入口文档同批提交`);
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
  console.error(`  修法：确属门禁演进 → 立 L2 入口（正文 §改动面 点名上述文件）+ 判据更新后跑 node .agents/scripts/check-engine-integrity.mjs --update，三者同批提交`);
  console.error('  修法：非演进（误改/被他人改动）→ git diff 核对并回退，勿改基线绕过（基线本身在控制面清单内）');
  process.exit(1);
}
if (!QUIET) console.log(`✅ 引擎完整性：受检面 ${Object.keys(current).length} 个文件（硬拦面无收缩${lock && lock.files ? '、盘面与基线一致' : '、本地基线未启用'}）`);
process.exit(0);
