// validate.test.mjs — flow-kit validate 断言（2026-10-10 validate-entry）。
// 两层：validateExit 纯函数直测（退出码判据单源）+ 端到端 spawn 真 CLI（bin/flow-kit.mjs validate，
// --json 断言 stdout 可解析、退出码契约、缺 .agents/ 指引、未知参数用法错）。
// fixture 沿 check-loop.test.mjs 同款：临时根（workflow 四目录 + .agents/ + 枚举单源内联 8 键），
// 自包含、不依赖真实 git 与 workflow 文档。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateExit } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'flow-kit.mjs');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
}

// ---- validateExit 纯函数（判据单源）----
check('V1 blocker → 1', validateExit({ exitCode: 1, blockers: ['x'], warnings: [] }, false) === 1);
check('V2 干净 → 0', validateExit({ exitCode: 0, blockers: [], warnings: [] }, false) === 0);
check('V3 warning 非 strict → 0', validateExit({ exitCode: 0, blockers: [], warnings: ['w'] }, false) === 0);
check('V4 warning + strict → 1', validateExit({ exitCode: 0, blockers: [], warnings: ['w'] }, true) === 1);
check('V5 引擎结果缺失 fail-closed → 1', validateExit(null, false) === 1 && validateExit(undefined, true) === 1);

// ---- fixture（枚举单源内联，同 check-loop.test.mjs#ENUMS_FIXTURE）----
const ENUMS_FIXTURE = [
  'doc.status.all=draft approved done superseded cancelled',
  'doc.status.confirmed=approved done superseded cancelled',
  'doc.status.active=draft approved',
  'doc.status.terminal=done superseded cancelled',
  'doc.status.abandoned=superseded cancelled',
  'incident.status.all=open fixed closed',
  'incident.status.active=open',
  'level.all=L0 L1 L2 L3',
].join('\n') + '\n';

const mkfix = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-validate-'));
  for (const s of ['intents', 'specs', 'plans', 'incidents']) {
    fs.mkdirSync(path.join(d, 'workflow', s), { recursive: true });
  }
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'workflow-enums.txt'), ENUMS_FIXTURE);
  return d;
};

const runValidate = (dir, args = []) => spawnSync(process.execPath, [CLI, 'validate', '--dir', dir, ...args], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});
const stdoutOf = (r) => r.stdout || '';
const stderrOf = (r) => r.stderr || '';

// ---- 端到端：绿盘面（空四目录 + 枚举单源）----
const green = mkfix();
const rg = runValidate(green, ['--json']);
let greenJson = null;
try { greenJson = JSON.parse(stdoutOf(rg)); } catch { /* 解析失败在断言里报 */ }
check('V6 绿盘面 exit 0', rg.status === 0, `exit=${rg.status}\n${stdoutOf(rg)}\n${stderrOf(rg).slice(0, 300)}`);
check('V7 --json stdout 可解析且 blockers 空', !!greenJson && Array.isArray(greenJson.blockers) && greenJson.blockers.length === 0, stdoutOf(rg).slice(0, 300));
check('V8 --json 契约字段在位', !!greenJson && greenJson.exitCode === 0 && greenJson.checkLoopExitCode === 0 && greenJson.strict === false && typeof greenJson.target === 'string', JSON.stringify(greenJson));
// --strict 契约端到端：同一盘面 fixture 恒产出 advisory warning（装副本骨架件缺失类，绿判不受其扰），
// 非 strict 绿（V6 已证）、strict 判红且 checkLoopExitCode 保持 0——判红来源是 strict 规则而非引擎
const rs = runValidate(green, ['--json', '--strict']);
let strictJson = null;
try { strictJson = JSON.parse(stdoutOf(rs)); } catch { /* 同上 */ }
check('V9 --strict 把 advisory warning 判红（checkLoopExitCode 仍 0）',
  rs.status === 1 && !!strictJson && strictJson.exitCode === 1 && strictJson.checkLoopExitCode === 0 && strictJson.strict === true && strictJson.warnings.length > 0,
  `exit=${rs.status}\n${stdoutOf(rs).slice(0, 300)}`);

// ---- 端到端：红盘面（同名配对断档：intent 无同名 spec/plan → 检查 1 hard-block）----
const red = mkfix();
fs.writeFileSync(path.join(red, 'workflow', 'intents', '2026-01-01-solo.md'),
  '---\nstatus: draft\nlevel: L1\n---\n# INTENT — solo\n');
const rr = runValidate(red, ['--json']);
let redJson = null;
try { redJson = JSON.parse(stdoutOf(rr)); } catch { /* 同上 */ }
check('V10 配对断档 exit 1', rr.status === 1, `exit=${rr.status}\n${stdoutOf(rr).slice(0, 300)}\n${stderrOf(rr).slice(0, 500)}`);
check('V11 --json blockers 非空且明细走 stdout JSON', !!redJson && redJson.blockers.length > 0, stdoutOf(rr).slice(0, 300));

// ---- 指引与用法错 ----
const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-validate-bare-'));
const rb = runValidate(bare);
check('V12 缺 .agents/ → exit 1 且给 init 指引', rb.status === 1 && /init/.test(stderrOf(rb)), `exit=${rb.status}\n${stderrOf(rb).slice(0, 300)}`);
const ru = runValidate(green, ['--bogus']);
check('V13 未知参数 → exit 1 用法行', ru.status === 1 && /用法/.test(stderrOf(ru)), `exit=${ru.status}\n${stderrOf(ru).slice(0, 300)}`);

// ---- 清理 ----
for (const d of [green, red, bare]) fs.rmSync(d, { recursive: true, force: true });

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
