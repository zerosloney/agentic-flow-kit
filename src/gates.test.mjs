#!/usr/bin/env node
// 三个可选门禁：临时 git 仓库里暂存违规 / 干净文件，断言退出码。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = process.platform === 'win32' ? 'git.exe' : 'git';
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); }
};

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-gate-'));
  spawnSync(git, ['init', '-q'], { cwd: dir });
  spawnSync(git, ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync(git, ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}
function stage(dir, rel, text) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  spawnSync(git, ['add', '--', rel], { cwd: dir });
}
function run(script, dir, env = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, script)], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, ...env },
  });
}

{
  const dir = repo();
  stage(dir, 'src/app.mjs', "import { x } from '../tests/helper.mjs';\n");
  const bad = run('modules/gates/node-layer/check-node-layer.mjs', dir);
  check('node-layer 引用 tests → exit 1', bad.status === 1 && bad.stderr.includes('src/app.mjs'), bad.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = repo();
  stage(dir, 'src/app.mjs', "import { x } from './util.mjs';\n");
  const ok = run('modules/gates/node-layer/check-node-layer.mjs', dir);
  check('node-layer 只引 src 内文件 → exit 0', ok.status === 0, ok.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = repo();
  stage(dir, 'src/app.mjs', "import { x } from '../tests/helper.mjs';\n");
  fs.writeFileSync(path.join(dir, 'src/app.mjs'), "import { x } from './util.mjs';\n");
  const bad = run('modules/gates/node-layer/check-node-layer.mjs', dir);
  check('node-layer 暂存违规、工作区已改回 → exit 1', bad.status === 1 && bad.stderr.includes('src/app.mjs'), bad.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = repo();
  stage(dir, 'src/app.mjs', "import { x } from './util.mjs';\n");
  fs.writeFileSync(path.join(dir, 'src/app.mjs'), "import { x } from '../tests/helper.mjs';\n");
  const ok = run('modules/gates/node-layer/check-node-layer.mjs', dir);
  check('node-layer 暂存干净、工作区违规 → exit 0', ok.status === 0, ok.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = repo();
  stage(dir, 'pkg/mod.py', 'from tests.unit import helper\n');
  const bad = run('modules/gates/py-import/check-py-import.mjs', dir);
  check('py-import 业务文件 import tests → exit 1', bad.status === 1 && bad.stderr.includes('pkg/mod.py'), bad.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = repo();
  stage(dir, 'tests/test_mod.py', 'from tests.unit import helper\n');
  const ok = run('modules/gates/py-import/check-py-import.mjs', dir);
  check('py-import 测试目录自身 → exit 0', ok.status === 0, ok.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = repo();
  stage(dir, 'pkg/mod.py', 'from tests.unit import helper\n');
  fs.writeFileSync(path.join(dir, 'pkg/mod.py'), 'import pkg.local\n');
  const bad = run('modules/gates/py-import/check-py-import.mjs', dir);
  check('py-import 暂存违规、工作区已改回 → exit 1', bad.status === 1 && bad.stderr.includes('pkg/mod.py'), bad.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = repo();
  stage(dir, 'pkg/mod.py', 'import pkg.local\n');
  fs.writeFileSync(path.join(dir, 'pkg/mod.py'), 'from tests.unit import helper\n');
  const ok = run('modules/gates/py-import/check-py-import.mjs', dir);
  check('py-import 暂存干净、工作区违规 → exit 0', ok.status === 0, ok.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = repo();
  const body = 'before\n<!-- GENERATED:BEGIN -->\nsecret\n<!-- GENERATED:END -->\nafter\n';
  stage(dir, 'doc.md', body);
  spawnSync(git, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: dir });
  const next = body.replace('secret', 'edited');
  stage(dir, 'doc.md', next);
  const bad = run('modules/gates/generated-readonly/check-generated.mjs', dir);
  check('generated 区被改 → exit 1', bad.status === 1 && bad.stderr.includes('GENERATED'), bad.stderr);
  const allowed = run('modules/gates/generated-readonly/check-generated.mjs', dir, { FLOW_KIT_ALLOW_GENERATED: '1' });
  check('FLOW_KIT_ALLOW_GENERATED=1 → exit 0', allowed.status === 0, allowed.stderr);
  fs.writeFileSync(path.join(dir, 'doc.md'), 'before\nafter\n');
  const still = run('modules/gates/generated-readonly/check-generated.mjs', dir);
  check('generated 暂存改区、工作区删掉标记 → exit 1', still.status === 1 && still.stderr.includes('GENERATED'), still.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = repo();
  const body = 'before\n<!-- GENERATED:BEGIN -->\nsecret\n<!-- GENERATED:END -->\nafter\n';
  stage(dir, 'doc.md', body);
  spawnSync(git, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: dir });
  stage(dir, 'doc.md', body.replace('before', 'before2'));
  fs.writeFileSync(path.join(dir, 'doc.md'), body.replace('secret', 'edited'));
  const ok = run('modules/gates/generated-readonly/check-generated.mjs', dir);
  check('generated 暂存改区外、工作区改区内 → exit 0', ok.status === 0, ok.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
