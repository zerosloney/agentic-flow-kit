#!/usr/bin/env node
// add-gate.test.mjs — gate 防改锚（2026-10-11 P3-1）装户端到端测试。
// 手法：真实 bin/flow-kit.mjs init 建临时装户（fresh-init.test.mjs 同款）→ CLI add-gate test-protect，
// 断言 kit.json owned：逐字拷贝的 gate 脚本带 srcSha256＝安装时刻包源文件 LF 归一 sha；
// local-pre-commit（合并接线件，非逐字拷贝）不写 srcSha256。再覆盖三条锚路径——
//   ①幂等重跑（盘面＝包源）安静且锚不动；②盘面手改后重跑（未 --force）WARN 差异 + 原锚保留
//   （doctor checkGateAnchors 端到端抓到手改）；③--force 重装重锚。
// 用法：node src/add-gate.test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'flow-kit.mjs');
const GATE = 'test-protect';
const GATE_REL = `.agents/hooks/check-test-protect.mjs`;
const LP_REL = '.agents/hooks/local-pre-commit';
const PKG_GATE_SRC = path.join(ROOT, 'modules', 'gates', GATE, 'check-test-protect.mjs');

// checkGateAnchors 端到端联动：add-gate 写下的锚正是 doctor 锚校验读取的判据（耦合面单独断言）
const { checkGateAnchors } = await import(pathToFileURL(path.join(ROOT, 'src', 'doctor.mjs')).href);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); }
};
// LF 归一 sha（与 add-gate shaText / doctor checkGateAnchors 同口径，跨 checkout 字节稳定）
const shaOf = (p) => createHash('sha256').update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
const R = (p) => fs.readFileSync(p, 'utf8');

// ---- 建临时装户：git init + 真实 CLI init（fresh-init.test.mjs 同款）----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-addgate-'));
spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', ['init', '-q'], { cwd: dir });
const init = spawnSync(process.execPath, [CLI, 'init', '--stack', 'none', '--hosts', 'claude', '--board-port', '8941', '--dir', dir], { encoding: 'utf8', timeout: 120000 });
if (init.status !== 0) {
  console.error(`add-gate.test.mjs：前置 init 失败无法继续\n${(init.stdout || '') + (init.stderr || '')}`);
  process.exit(1);
}
const kitOf = () => JSON.parse(R(path.join(dir, '.agents', 'kit.json')));
const gateEntry = () => kitOf().owned.find((f) => f.rel === GATE_REL);

// ---- 场景 1：首装——逐字拷贝件写锚＝包源 sha；local-pre-commit 不写锚 ----
{
  const r = spawnSync(process.execPath, [CLI, 'add-gate', GATE, '--dir', dir], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  check('S1 add-gate exit 0', r.status === 0, `exit=${r.status}\n${out.slice(-400)}`);
  const gate = gateEntry();
  check('S1 gate 脚本带 srcSha256＝包源文件 LF 归一 sha（安装时刻包源）', !!gate && gate.srcSha256 === shaOf(PKG_GATE_SRC), JSON.stringify(gate || null));
  check('S1 gate 台账 sha256＝盘面（LF 归一记账）', !!gate && gate.sha256 === shaOf(path.join(dir, GATE_REL)), JSON.stringify(gate || null));
  check('S1 门禁脚本落盘且与包源一致（逐字拷贝）', R(path.join(dir, GATE_REL)) === R(PKG_GATE_SRC));
  const lp = kitOf().owned.find((f) => f.rel === LP_REL);
  check('S1 local-pre-commit（合并接线件）不写 srcSha256', !!lp && lp.srcSha256 === undefined, JSON.stringify(lp || null));
  check('S1 local-pre-commit 台账 sha256 刷为接线后盘面', !!lp && lp.sha256 === shaOf(path.join(dir, LP_REL)), JSON.stringify(lp || null));
  check('S1 首装输出无盘面/包源差异 WARN', !out.includes('盘面与包源不一致'), out);
}

// ---- 场景 2：幂等重跑（未 --force、盘面＝包源）——安静，条目原样 ----
{
  const before = JSON.stringify(gateEntry());
  const r = spawnSync(process.execPath, [CLI, 'add-gate', GATE, '--dir', dir], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  check('S2 幂等重跑 exit 0 且无差异 WARN', r.status === 0 && !out.includes('盘面与包源不一致'), out);
  check('S2 锚与台账条目原样', JSON.stringify(gateEntry()) === before, `${before} → ${JSON.stringify(gateEntry())}`);
}

// ---- 场景 3：盘面手改后重跑（未 --force）——WARN 差异可见，原锚保留（手改永久留痕）----
{
  fs.writeFileSync(path.join(dir, GATE_REL), `${R(PKG_GATE_SRC)}\n// 本地手改：放宽红线（测试标记）\n`);
  const before = gateEntry();
  const r = spawnSync(process.execPath, [CLI, 'add-gate', GATE, '--dir', dir], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  const after = gateEntry();
  check('S3 手改后重跑出 WARN（盘面与包源不一致，含文件名）', out.includes('盘面与包源不一致') && out.includes('check-test-protect.mjs'), out);
  check('S3 已有台账条目 → WARN 指明原锚保留', out.includes('原锚保留'), out);
  check('S3 原锚保留（未被盘面重锚——重锚会把手改吸收成无差异）', after.srcSha256 === before.srcSha256 && after.srcSha256 === shaOf(PKG_GATE_SRC), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check('S3 台账 sha256 亦不被改写（未 --force 不动既有条目）', after.sha256 === before.sha256, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check('S3 手改盘面幸存（未 --force 不覆盖）', R(path.join(dir, GATE_REL)).includes('本地手改'), R(path.join(dir, GATE_REL)).slice(-120));
  const d = checkGateAnchors(dir);
  check('S3 doctor 锚校验按 add-gate 写下的锚抓到手改（端到端）', d.skipped === false && d.mismatch.includes(GATE_REL), JSON.stringify(d));
}

// ---- 场景 4：--force 重装——盘面恢复包源 + 锚随新安装刷新（重锚路径）----
{
  const r = spawnSync(process.execPath, [CLI, 'add-gate', GATE, '--dir', dir, '--force'], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  const gate = gateEntry();
  check('S4 --force 重装恢复包源内容', R(path.join(dir, GATE_REL)) === R(PKG_GATE_SRC));
  check('S4 锚随新安装刷新（srcSha256＝包源 sha）', !!gate && gate.srcSha256 === shaOf(PKG_GATE_SRC), JSON.stringify(gate || null));
  check('S4 台账 sha256 回到包面值', !!gate && gate.sha256 === shaOf(PKG_GATE_SRC), JSON.stringify(gate || null));
  check('S4 输出含安装报告', out.includes('安装到'), out);
  const d = checkGateAnchors(dir);
  check('S4 重锚后 doctor 锚校验回到无失配', d.skipped === false && d.mismatch.length === 0 && d.gone.length === 0 && d.total >= 1, JSON.stringify(d));
}

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
