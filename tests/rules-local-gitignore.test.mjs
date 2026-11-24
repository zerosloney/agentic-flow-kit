// rules-local-gitignore.test.mjs — .agents/rules/local.json 是机器本地规则覆盖层，安装时必须进 .gitignore。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

test('install ignores .agents/rules/local.json', () => {
  const dir = makeTmp('flow-kit-gitignore-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const r = spawnSync(process.execPath, [BIN, 'install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  const lines = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('.agents/rules/local.json'), 'installed .gitignore must ignore .agents/rules/local.json');
});
