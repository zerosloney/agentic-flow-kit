// flow-kit gate-checklist：三处口径一致性检查（doctor §检查项 ↔ check-loop §检查项，显式配对登记表）
// 目的：任何一处加新检查项，另一处不会自动同步——本工具按登记表给出对照表 + 断档/未登记告警。
// 机制（2026-09-25 gate-checklist-registry 重写）：关键词猜测匹配退役（实测 18×14 项只匹配 2、报 28 条
//       噪声缺点，真漏点不可见），改为显式配对登记表 PAIRS（单源本文件）——沿 workflow-modules.txt
//       的单源思路与 check-loop「frontmatter 受限子集替代全文正则猜测」同一演进路径。
// 解析面（只读不改两处源码，均为既有稳定结构）：
//   doctor：src/doctor.mjs 节注释 `// N. 标题`（N 支持 6.5 小节号）
//   check-loop：.agents/scripts/check-loop.sh 头部检查项注释 `# N. 标题 [severity]`（多行标题截断仅影响展示，配对按 id）
// 登记三形态：
//   { doctor, cl }        直接配对——同一检查两处实现
//   { doctor, cl: null }  声明独有——doctor 装户体检面，无 check-loop 对应（原 intent「只报告不修复」拍板的已知漏点入账）
//   { doctor: '7', cl }   经 §7 覆盖——doctor §7 整体运行 check-loop，各 #N 自动流入 doctor
// 报告（只报告不修复，B-b；exit 恒 0）：
//   断档：登记表声明的 id 在对应侧已不存在（检查项被删/改号而登记未跟）
//   未登记：任一侧出现登记表之外的 § 检查项（新检查项没对账——本工具的核心信号）
// 用法：node .agents/scripts/gate-checklist.mjs --diff
//       node .agents/scripts/gate-checklist.mjs --json
// 零依赖；不修改 doctor / check-loop 既有检查项
// 测试：node templates/_agents/scripts/gate-checklist.test.mjs（fixture + 真实仓库 baseline）
import fs from 'node:fs';
import path from 'node:path';

function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

// parseDoctorSections：扫 doctor.mjs 节注释 → [{id, title}]。两种真实格式：
//   `// N. 标题`（整数节号带点，如 // 1. Node 版本）与 `// N.M 标题`（小节号不带点，如 // 6.5 delegations）。
//   整数无点（如正文注释 // 4 宿主目录映射）不匹配——避免函数体普通注释误判为节。
function parseDoctorSections(doctorSrc) {
  const out = [];
  const re = /^\s*\/\/\s+(\d+\.\d+|\d+\.)\s+([^\n]+)/gm;
  let m;
  while ((m = re.exec(doctorSrc)) !== null) {
    const title = m[2].split(/[（(]/)[0].trim() || m[2].trim();
    out.push({ id: m[1].replace(/\.$/, ''), title });
  }
  return out;
}

// parseCheckLoopChecks：扫 check-loop 检查项注释（`// N. 标题 [severity]` 于 .mjs 头部清单——2026-09-26
// check-loop-node 迁移后的主位；旧装户 sync 前只有 .sh 时按 `# N. 标题` fallback，登记表口径不变）
function parseCheckLoopChecks(clSrc) {
  const checks = [];
  const re = /^\s*(?:\/\/|#)\s*(\d+)\.\s+(.+?)(?:\s*\[(hard-block|warning|advisory)\])?\s*$/gm;
  let m;
  while ((m = re.exec(clSrc)) !== null) {
    checks.push({ id: m[1], title: m[2].trim(), severity: m[3] || null });
  }
  return checks;
}

// ---- 配对登记表（单源契约；2026-09-25 gate-checklist-registry 全量登记）----
// 纪律：doctor / check-loop 任一处加新 § 检查项，必须同步在本表登记（直接配对 / 声明独有 / 经 §7 覆盖），
//       否则工具报「未登记」。删/改检查项须同步改本表，否则报「断档」。
const PAIRS = [
  // 直接配对：同一检查两处实现
  { doctor: '5', cl: '2', note: '占位符残留' },
  { doctor: '6', cl: '11', note: 'workflow/INDEX.md 漂移' },
  // 声明独有：doctor 装户体检面（原 intent 拍板「只报告不修复」的已知漏点入账）
  { doctor: '1', cl: null, note: 'Node 版本——装户体检独有' },
  { doctor: '2', cl: null, note: '目录布局——装户体检独有' },
  { doctor: '3', cl: null, note: 'git 仓库与钩子——装户体检独有' },
  { doctor: '4', cl: null, note: 'kit.json managed 台账——装户体检独有' },
  { doctor: '6.5', cl: null, note: 'delegations 台账结构——装户体检独有' },
  { doctor: '6.6', cl: null, note: 'owned 漂移——装户体检独有' },
  { doctor: '6.7', cl: null, note: '跨宿主薄适配——装户体检独有' },
  { doctor: '6.8', cl: null, note: 'workflows 编排脚本 lint——装户体检独有' },
  { doctor: '8', cl: null, note: '看板端口——信息级独有' },
  // 经 §7 覆盖：doctor §7 整体运行 check-loop（#2/#11 已直接配对，不重复登记）
  { doctor: '7', cl: '1', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '3', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '4', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '5', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '6', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '7', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '8', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '9', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '10', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '12', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '13', note: '经 §7 整体运行覆盖' },
  { doctor: '7', cl: '14', note: '经 §7 整体运行覆盖' },
];

// gateChecklist：按登记表对照两侧检查项（pure function；pairs 可注入供测试）
// 返回 { doctorCount, checkLoopCount, pairs, matched, broken, unregistered, doctor, checkLoop }
//   matched       = 登记两侧都存在的条目（直接配对 + 经 §7 覆盖）
//   broken        = 登记声明的 id 在对应侧已不存在
//   unregistered  = 两侧出现登记表之外的 § 检查项（新检查项未对账——核心信号）
export function gateChecklist({ doctorSrc, checkLoopSrc, pairs = PAIRS }) {
  const doctor = parseDoctorSections(doctorSrc);
  const checkLoop = parseCheckLoopChecks(checkLoopSrc);
  const doctorIds = new Set(doctor.map((d) => d.id));
  const clIds = new Set(checkLoop.map((c) => c.id));
  const declaredDoctor = new Set(pairs.map((p) => p.doctor).filter(Boolean));
  const declaredCl = new Set(pairs.map((p) => p.cl).filter(Boolean));

  const broken = [];
  for (const p of pairs) {
    if (p.doctor && !doctorIds.has(p.doctor)) broken.push({ side: 'doctor', id: p.doctor, note: p.note || '' });
    if (p.cl && !clIds.has(p.cl)) broken.push({ side: 'check-loop', id: p.cl, note: p.note || '' });
  }
  const unregistered = [];
  for (const d of doctor) {
    if (!declaredDoctor.has(d.id)) unregistered.push({ side: 'doctor', id: d.id, title: d.title });
  }
  for (const c of checkLoop) {
    if (!declaredCl.has(c.id)) unregistered.push({ side: 'check-loop', id: c.id, title: c.title });
  }
  const matched = pairs.filter((p) => p.doctor && doctorIds.has(p.doctor) && p.cl && clIds.has(p.cl));
  return {
    doctorCount: doctor.length,
    checkLoopCount: checkLoop.length,
    pairs,
    matched,
    broken,
    unregistered,
    doctor,
    checkLoop,
  };
}

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

function printDiff(result) {
  console.log('▶ flow-kit gate-checklist --diff（显式配对登记表）');
  const direct = result.pairs.filter((p) => p.doctor !== '7' && p.cl).length;
  const via = result.pairs.filter((p) => p.doctor === '7').length;
  const solo = result.pairs.filter((p) => !p.cl).length;
  console.log(`  doctor §检查项: ${result.doctorCount}  |  check-loop §检查项: ${result.checkLoopCount}  |  直接配对 ${direct} + 经 §7 覆盖 ${via} + 声明独有 ${solo}`);
  const doctorById = new Map(result.doctor.map((d) => [d.id, d]));
  const clById = new Map(result.checkLoop.map((c) => [c.id, c]));
  console.log('  对照表（登记表展开）:');
  for (const p of result.pairs) {
    const d = doctorById.get(p.doctor);
    if (!p.cl) {
      console.log(`    ● §${p.doctor} ${clip(d?.title || '?', 22)}（声明独有：${p.note}）`);
    } else {
      const c = clById.get(p.cl);
      const mark = d && c ? '✓' : '✗';
      console.log(`    ${mark} §${p.doctor} ${clip(d?.title || '?', 22)} ↔ #${p.cl} ${clip(c?.title || '?', 26)}（${p.note}）`);
    }
  }
  if (result.broken.length) {
    console.log('  断档（登记的检查项已不存在——删/改检查项后登记表未跟）:');
    for (const b of result.broken) {
      console.log(`    ⚠️  ${b.side === 'doctor' ? 'doctor §' + b.id : 'check-loop #' + b.id} 已不存在（登记备注：${b.note || '无'}）`);
    }
  }
  if (result.unregistered.length) {
    console.log('  未登记（新检查项未对账——配对 / 声明独有 / 经 §7 三选一登记进 PAIRS）:');
    for (const u of result.unregistered) {
      console.log(`    ⚠️  ${u.side === 'doctor' ? 'doctor §' + u.id : 'check-loop #' + u.id} ${clip(u.title, 30)}`);
    }
  }
  if (!result.broken.length && !result.unregistered.length) {
    console.log('  ✅ 登记完整（0 断档 / 0 未登记）');
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('gate-checklist.mjs');
if (isMain) {
  let jsonMode = false;
  for (const a of process.argv.slice(2)) {
    if (a === '--json') jsonMode = true;
    else if (a === '--diff') { /* 默认模式，兼容显式传参 */ }
    else fail('未知选项：' + a + '（flow-kit gate-checklist --diff / --json）');
  }
  const pkgRoot = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  const base = pkgRoot || process.cwd();
  const doctorPath = path.join(base, 'src', 'doctor.mjs');
  const clPathMjs = path.join(base, '.agents', 'scripts', 'check-loop.mjs');
  const clPath = fs.existsSync(clPathMjs) ? clPathMjs : path.join(base, '.agents', 'scripts', 'check-loop.sh');
  if (!fs.existsSync(doctorPath)) fail('找不到 doctor.mjs：' + doctorPath);
  if (!fs.existsSync(clPath)) fail('找不到 check-loop（.mjs / .sh 均无）：' + clPath);
  const doctorSrc = fs.readFileSync(doctorPath, 'utf8');
  const checkLoopSrc = fs.readFileSync(clPath, 'utf8');
  const result = gateChecklist({ doctorSrc, checkLoopSrc });
  if (jsonMode) {
    process.stdout.write(JSON.stringify({
      doctorCount: result.doctorCount,
      checkLoopCount: result.checkLoopCount,
      matched: result.matched.map((p) => ({ doctor: p.doctor, cl: p.cl, note: p.note || '' })),
      solo: result.pairs.filter((p) => !p.cl).map((p) => ({ doctor: p.doctor, note: p.note || '' })),
      broken: result.broken,
      unregistered: result.unregistered,
    }, null, 2) + '\n');
  } else {
    printDiff(result);
  }
  // diff/json 模式总 exit 0；断档/未登记不视作错误（人类阅读用；B-b 决策「只报告不修复」）
  process.exit(0);
}
export default gateChecklist;
