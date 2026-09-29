#!/usr/bin/env node
// 空 git 仓库 fresh init --hosts claude：doctor 必须 exit 0，kit 写 audit:false，薄适配落盘。
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-fresh-'));
spawnSync(git, ['init', '-q'], { cwd: dir });
const r = spawnSync(process.execPath, [
  path.join(ROOT, 'bin', 'flow-kit.mjs'), 'init',
  '--stack', 'none', '--hosts', 'claude', '--board-port', '8941', '--dir', dir,
], { encoding: 'utf8', timeout: 120000 });
const out = `${r.stdout || ''}${r.stderr || ''}`;
check('fresh init exit 0', r.status === 0, `exit=${r.status}\n${out.split('\n').slice(-30).join('\n')}`);
const kit = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'kit.json'), 'utf8'));
check('新装 audit 为 false 且 policyVersion 为 1', kit.audit === false && kit.policyVersion === 1, JSON.stringify({ audit: kit.audit, policyVersion: kit.policyVersion }));
check('claude 命令与角色薄适配落盘',
  fs.existsSync(path.join(dir, '.claude', 'commands', 'wf-plan.md'))
  && fs.existsSync(path.join(dir, '.claude', 'agents', 'implementer.md')));
const hooks = spawnSync(git, ['config', 'core.hooksPath'], { cwd: dir, encoding: 'utf8' });
check('钩子已挂到 .githooks', hooks.stdout.trim() === '.githooks', hooks.stdout);
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
