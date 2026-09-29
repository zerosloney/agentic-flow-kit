#!/usr/bin/env node
// 栈提交门契约：node 的构建只在 package.json scripts.build 为非空字符串时跑；
// python 的提交门不再带 pytest；flow-kit --help 的门禁列表等于 modules/gates 目录。
// 集成段用临时 git 仓跑真实 init，再对装出的 commit-check.cjs 暂存一个源文件。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP } from './cli.mjs';
import { commitCheckConfig, settingsJson } from './profiles.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = process.platform === 'win32' ? 'git.exe' : 'git';
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); }
};

const gates = fs.readdirSync(path.join(ROOT, 'modules', 'gates'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const gateList = gates.join(' | ');
check('help 当前列表等于 modules/gates 目录', HELP.includes(`当前：${gateList}`), gateList);
check('help 含四套已发布门禁',
  ['dotnet-ca', 'generated-readonly', 'node-layer', 'py-import'].every((n) => HELP.includes(n)));
check('help 不再把当前门禁写成只有 dotnet-ca',
  !HELP.includes('当前：dotnet-ca；') && !HELP.includes('当前：dotnet-ca）'));

const nodeCfg = JSON.parse(commitCheckConfig('node'));
check('node 构建命令带 pkg:scripts.build',
  nodeCfg.builds.some((b) => b.command === 'npm run build' && Array.isArray(b.when) && b.when.includes('pkg:scripts.build')));
const pyText = commitCheckConfig('python');
const pyCfg = JSON.parse(pyText);
check('python builds 为空', Array.isArray(pyCfg.builds) && pyCfg.builds.length === 0, pyText);
check('python 提交门配置不含 pytest', !pyText.includes('pytest'), pyText);
check('python 质量检查仍是 ruff',
  pyCfg.checks.some((c) => String(c.command).includes('ruff') && (c.when || []).includes('ruff.toml')));
check('python 的 test 阶段权限仍允许 pytest', settingsJson('python').includes('pytest'));

const dirs = [];
function initStack(stack, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `fk-stack-${stack}-`));
  dirs.push(dir);
  spawnSync(git, ['init', '-q'], { cwd: dir });
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'bin', 'flow-kit.mjs'), 'init',
    '--stack', stack, '--hosts', 'claude', '--board-port', String(port), '--dir', dir,
  ], { encoding: 'utf8', timeout: 180000 });
  return { dir, status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function runCommitCheck(dir, rel, content) {
  fs.writeFileSync(path.join(dir, rel), content);
  spawnSync(git, ['add', '--', rel], { cwd: dir });
  const r = spawnSync(process.execPath, [path.join(dir, '.agents', 'hooks', 'commit-check.cjs')], {
    cwd: dir, encoding: 'utf8', timeout: 60000,
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const nodeInit = initStack('node', 8942);
check('init --stack node 退出 0', nodeInit.status === 0, `exit=${nodeInit.status}\n${nodeInit.out.split('\n').slice(-25).join('\n')}`);
if (nodeInit.status === 0) {
  const installed = fs.readFileSync(path.join(nodeInit.dir, '.agents', 'hooks', 'commit-check.config.json'), 'utf8');
  check('装出的 node 配置含 pkg:scripts.build', installed.includes('pkg:scripts.build'), installed);
  const hook = runCommitCheck(nodeInit.dir, 'a.js', 'console.log(1)\n');
  check('无 scripts.build 时暂存 js：SKIP 且退出 0',
    hook.status === 0 && hook.out.includes('SKIP') && hook.out.includes('pkg:scripts.build') && !hook.out.includes('BLOCK:'),
    hook.out);
}

const pyInit = initStack('python', 8943);
check('init --stack python 退出 0', pyInit.status === 0, `exit=${pyInit.status}\n${pyInit.out.split('\n').slice(-25).join('\n')}`);
if (pyInit.status === 0) {
  const installed = fs.readFileSync(path.join(pyInit.dir, '.agents', 'hooks', 'commit-check.config.json'), 'utf8');
  check('装出的 python 配置不含 pytest', !installed.includes('pytest'), installed);
  const hook = runCommitCheck(pyInit.dir, 'a.py', 'x = 1\n');
  check('暂存 py：不跑 pytest 且退出 0',
    hook.status === 0 && !hook.out.includes('pytest') && hook.out.includes('COMMIT_CHECK_OK'),
    hook.out);
}

for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
