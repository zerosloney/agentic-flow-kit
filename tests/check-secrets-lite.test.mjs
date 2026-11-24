// check-secrets-lite.test.mjs — appsettings*.json 豁免的栈条件化：
// dotnet 栈沿用 owner 2026-10-27 判定（appsettings 文件级豁免）；非 dotnet 栈不再豁免（安全收紧）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scan } from '../templates/engine/.agents/scripts/check-secrets-lite.mjs';
import { makeTmp } from './helpers/tmp.mjs';

// 最小 git 仓 + 空基线（豁免-only 场景：命中与否只由 engine.json 的栈决定）
const setup = (options) => {
  const root = makeTmp('fk-secrets-lite-');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0, 'git init 失败');
  fs.writeFileSync(path.join(root, '.gitleaks-baseline.json'), '[]');
  fs.writeFileSync(path.join(root, 'appsettings.json'), JSON.stringify({
    ConnectionStrings: { Default: 'Server=.;Password=Abcd1234efgh!;Trusted_Connection=yes;' },
  }, null, 2));
  fs.mkdirSync(path.join(root, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'config', 'engine.json'), JSON.stringify({ options }));
  return root;
};

test('dotnet stack keeps appsettings exemption', () => {
  const res = scan({ root: setup({ stacks: ['dotnet'] }) });
  assert.equal(res.hits.length, 0);
});

test('non-dotnet stack enforces appsettings scan', () => {
  const res = scan({ root: setup({ stacks: ['node'] }) });
  assert.equal(res.hits.length, 1);
  assert.equal(res.hits[0].file, 'appsettings.json');
  assert.equal(res.hits[0].rule, 'connection-string-password');
});
