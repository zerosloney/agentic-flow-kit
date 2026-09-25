// gate-checklist.test.mjs — 显式配对登记表测试（2026-09-25 gate-checklist-registry）
// 方法：fixture mini doctor.mjs / check-loop.sh 源码 + 注入 pairs，调 gateChecklist() 拿结构化结果；
//       真实仓库两场景做 baseline；--json CLI spawn 冒烟回归原「字段丢失」bug。
// 判据：① 两侧解析正确 ② 三种登记形态不误报 ③ 断档/未登记检测命中 ④ 真实仓库 0 断档 0 未登记
// 用法：node templates/_agents/scripts/gate-checklist.test.mjs（npm test 随跑）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gateChecklist } from './gate-checklist.mjs';

let pass = 0;
let failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { failCount++; console.log('FAIL ' + name + (detail ? '——' + detail : '')); }
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

// fixture：5 节 doctor（1 / 5 / 6.5 / 7 / 9）+ 2 项 check-loop（#2 / #3）
const FIXTURE_DOCTOR = `// doctor fixture
function f() {
  // 1. Node 版本（装户体检独有）
  const a = 1;
  // 5. 占位符残留（与 check-loop #2 直接配对）
  const b = 2;
  // 6.5 delegations 台账结构（小节号解析）
  const c = 3;
  // 7. check-loop（fixture 里也有 §7，供经 §7 覆盖登记）
  const e = 5;
  // 9. 未登记的新检查项（应报未登记）
  const d = 4;
  return [a, b, c, d, e];
}
`;
const FIXTURE_CL = `#!/bin/sh
# 2. 模板字段占位符残留 [warning]
# 3. incidents 复盘三件套完整性
# 7. 未登记的新检查项
exit 0
`;
// fixture 登记表：5↔2 直接配对、1 声明独有、6.5 声明独有、7→#3 经 §7 覆盖；
// §99 / #99 是登记了但两侧都不存在的 id（应报断档×2）
const FIXTURE_PAIRS = [
  { doctor: '5', cl: '2', note: '占位符' },
  { doctor: '1', cl: null, note: '独有' },
  { doctor: '6.5', cl: null, note: '独有' },
  { doctor: '7', cl: '3', note: '经 §7' },
  { doctor: '99', cl: null, note: '断档——doctor 侧不存在' },
  { doctor: '1', cl: '99', note: '断档——check-loop 侧不存在' },
];

const run = (pairs = FIXTURE_PAIRS, doctorSrc = FIXTURE_DOCTOR, clSrc = FIXTURE_CL) =>
  gateChecklist({ doctorSrc, checkLoopSrc: clSrc, pairs });

// ---- S1 解析：doctor 5 节（含 6.5 小节号、§7 与未登记的 9）----
{
  const r = run();
  check('S1 fixture doctor 解析 5 节且含 6.5 小节号',
    r.doctorCount === 5 && r.doctor.some((d) => d.id === '6.5' && d.title.includes('delegations')),
    JSON.stringify(r.doctor));
}

// ---- S2 解析：check-loop 3 项（#2 带 severity，#3 无）----
{
  const r = run();
  const c2 = r.checkLoop.find((c) => c.id === '2');
  const c3 = r.checkLoop.find((c) => c.id === '3');
  check('S2 fixture check-loop 解析 3 项且 severity 提取正确',
    r.checkLoopCount === 3 && c2.severity === 'warning' && c3.severity === null,
    JSON.stringify(r.checkLoop));
}

// ---- S3 直接配对：5↔2 双侧存在 → matched 命中 ----
{
  const r = run();
  check('S3 直接配对 §5↔#2 进入 matched',
    r.matched.some((p) => p.doctor === '5' && p.cl === '2'),
    JSON.stringify(r.matched.map((p) => [p.doctor, p.cl])));
}

// ---- S4 声明独有：§1 / §6.5 不产生任何 findings ----
{
  const r = run();
  const hit = [...r.broken, ...r.unregistered].filter((f) => f.id === '1' || f.id === '6.5');
  check('S4 声明独有（§1 / §6.5）不误报',
    hit.length === 0,
    JSON.stringify(hit));
}

// ---- S5 经 §7 覆盖：7→#3 不产生 findings 且进 matched ----
{
  const r = run();
  check('S5 经 §7 覆盖登记不误报且进 matched',
    r.matched.some((p) => p.doctor === '7' && p.cl === '3') && !r.unregistered.some((u) => u.id === '3'),
    JSON.stringify(r.unregistered));
}

// ---- S6 断档：登记 §99 / #99 两侧不存在 → broken ×2 ----
{
  const r = run();
  const bDoc = r.broken.find((b) => b.side === 'doctor' && b.id === '99');
  const bCl = r.broken.find((b) => b.side === 'check-loop' && b.id === '99');
  check('S6 登记断档两侧各报一条（doctor §99 / check-loop #99）',
    r.broken.length === 2 && !!bDoc && !!bCl,
    JSON.stringify(r.broken));
}

// ---- S7 未登记：doctor §9 与 check-loop #7 → unregistered ×2 ----
{
  const r = run();
  const uDoc = r.unregistered.find((u) => u.side === 'doctor' && u.id === '9');
  const uCl = r.unregistered.find((u) => u.side === 'check-loop' && u.id === '7');
  check('S7 未登记两侧各报一条（doctor §9 / check-loop #7）',
    r.unregistered.length === 2 && !!uDoc && !!uCl,
    JSON.stringify(r.unregistered));
}

// ---- S8 空源码 + 空登记表不崩（0 findings）----
{
  const r = run([], '', '');
  check('S8 空源码 + 空登记表不崩（0/0 且 0 findings）',
    r.doctorCount === 0 && r.checkLoopCount === 0 && r.broken.length === 0 && r.unregistered.length === 0,
    JSON.stringify(r));
}

// ---- S8b 整数无点注释不误判为节（doctor.mjs:257 // 4 宿主目录映射 形态）----
{
  const doctorSrc = `// 4. kit.json managed 台账（真节）
const x = 1;
  // 4 宿主目录映射（与 profiles 同源——正文注释，非节）
const y = 2;
`;
  const r = gateChecklist({ doctorSrc, checkLoopSrc: '', pairs: [{ doctor: '4', cl: null, note: '独有' }] });
  check('S8b 整数无点的正文注释不误判（仅解析 1 节 §4 且标题为真节）',
    r.doctorCount === 1 && r.doctor[0].title.includes('kit.json') && r.broken.length === 0 && r.unregistered.length === 0,
    JSON.stringify(r.doctor));
}

// ---- S9 重复 id 登记（同 cl 两个直接配对）不崩且均可命中 ----
{
  const pairs = [
    { doctor: '5', cl: '2', note: 'a' },
    { doctor: '1', cl: '2', note: 'b' },
  ];
  const r = run(pairs);
  check('S9 多条目登记同一 cl 不崩（matched 2）',
    r.matched.length === 2 && r.unregistered.some((u) => u.side === 'check-loop' && u.id === '3'),
    JSON.stringify({ m: r.matched.length, u: r.unregistered }));
}

const realDoctor = () => fs.readFileSync(path.join(SRC_ROOT, 'src', 'doctor.mjs'), 'utf8');
// check-loop 解析面与 CLI 同口径：.mjs 优先（2026-09-26 迁移后主位），fallback .sh（旧装户）
const realCl = () => {
  const mjs = path.join(SRC_ROOT, '.agents', 'scripts', 'check-loop.mjs');
  return fs.readFileSync(fs.existsSync(mjs) ? mjs : path.join(SRC_ROOT, '.agents', 'scripts', 'check-loop.sh'), 'utf8');
};
const hasReal = fs.existsSync(path.join(SRC_ROOT, 'src', 'doctor.mjs'));

// ---- S10 真实仓库 baseline：PAIRS 全量登记 → 0 断档 / 0 未登记 ----
if (hasReal) {
  const r = gateChecklist({ doctorSrc: realDoctor(), checkLoopSrc: realCl() });
  check('S10 真实仓库登记完整（0 断档 / 0 未登记）',
    r.broken.length === 0 && r.unregistered.length === 0,
    JSON.stringify({ broken: r.broken, unregistered: r.unregistered }));
}

// ---- S11 真实仓库计数：doctor ≥ 12 节 / check-loop ≥ 14 项 ----
if (hasReal) {
  const r = gateChecklist({ doctorSrc: realDoctor(), checkLoopSrc: realCl() });
  check('S11 真实仓库 doctor ≥ 12 节且 check-loop ≥ 14 项（baseline）',
    r.doctorCount >= 12 && r.checkLoopCount >= 14,
    `doctor ${r.doctorCount} / check-loop ${r.checkLoopCount}`);
}

// ---- S12 --json CLI 冒烟：键齐无 undefined（回归原 .title 字段丢失 bug）----
if (hasReal) {
  const p = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'gate-checklist.mjs'), '--json'], { cwd: SRC_ROOT, encoding: 'utf8' });
  let j = null;
  try { j = JSON.parse(p.stdout); } catch { /* fail below */ }
  const keysOk = j && ['doctorCount', 'checkLoopCount', 'matched', 'solo', 'broken', 'unregistered'].every((k) => k in j);
  const noHoles = j && JSON.stringify(j).includes('undefined') === false
    && j.matched.every((m) => typeof m.doctor === 'string' && typeof m.cl === 'string' && 'note' in m);
  check('S12 --json 可解析、键齐、条目无 undefined 丢字段、exit 0',
    p.status === 0 && !!keysOk && !!noHoles,
    String(p.stdout).slice(0, 200));
}

// ---- S13 doctor 多行节注释：首行即标题（6.6 形态）解析不漏 ----
{
  const doctorSrc = `// 6.6 owned 漂移校验（kit.owned 列表盘面 sha 不一致；
//     漂移信号靠本校验给装户可见性）
const x = 1;
`;
  const r = gateChecklist({ doctorSrc, checkLoopSrc: '', pairs: [{ doctor: '6.6', cl: null, note: '独有' }] });
  check('S13 多行节注释（§6.6 形态）首行命中且登记不报 findings',
    r.doctorCount === 1 && r.doctor[0].title.includes('owned') && r.broken.length === 0 && r.unregistered.length === 0,
    JSON.stringify(r.doctor));
}

console.log('\n合计: PASS ' + pass + ' / FAIL ' + failCount);
process.exit(failCount ? 1 : 0);
