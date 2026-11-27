// check-secrets-lite.test.mjs — appsettings*.json 豁免的栈条件化：
// dotnet 栈沿用 owner 2026-10-27 判定（appsettings 文件级豁免）；非 dotnet 栈不再豁免（安全收紧）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scan, matchLine } from '../templates/engine/.agents/scripts/check-secrets-lite.mjs';
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

// 审计 D38：值类此前止于符号，带符号的口令（最常见真实形态）整类漏报；`my` 前缀又把真密钥当占位符。
test('symbol-bearing secrets are reported (generic + connection string)', () => {
  const cases = [
    ['password: "P@ssw0rd!2026x"', 'generic-api-key'], // secrets-lite:allow（回归样本，非真实密钥）
    ['DB_PASSWORD=Ab1!234567890123456', 'generic-api-key'], // secrets-lite:allow
    ['Server=x;Password=P@ssw0rd!;User=y', 'connection-string-password'], // secrets-lite:allow
    ['token: "MyS3cretAp1Key98x7Q2z1"', 'generic-api-key'], // secrets-lite:allow
  ];
  for (const [line, rule] of cases) {
    const hit = matchLine(line, { generic: true });
    assert.ok(hit, `漏报：${line}`);
    assert.equal(hit.rule, rule, line);
  }
});

test('ordinary-code false positives do not grow', () => {
  const clean = [
    'const tokenPath = path.join(root, "token.json");',
    'if (process.env.SMOKE_ADMIN_PASSWORD) { login(); }',
    'password=process.env.DB_PASSWORD',
    'const apiKey = tokenFrom(req.headers);',
    'password: "required"',
    'token: "my-secret-value"',
    'const token = crypto.randomBytes(32).toString("hex");',
  ];
  for (const line of clean) {
    assert.equal(matchLine(line, { generic: true }), null, `误报：${line}`);
  }
});

// 线性预算：200 KB 对抗行不得触发回溯爆炸（任何一条超预算即视为正则非线性）。
test('scan stays linear on 200 KB adversarial lines', () => {
  const lines = [
    ['long plain value', `token = ${'a'.repeat(200000)}!`],
    ['long quoted value', `token = "${'a'.repeat(200000)}"`],
    ['long symbol value', `password = ${'Ab1!'.repeat(50000)}`],
    ['long underscore key chain', `${'X'.repeat(100000)}PASSWORD=${'a'.repeat(50000)};`],
    ['long eq chain', `password${'='.repeat(100000)}${'a'.repeat(100000)}`],
    ['deep nested quotes', `password: ${'"'.repeat(20000)}`],
  ];
  for (const [label, line] of lines) {
    const t0 = performance.now();
    matchLine(line, { generic: true });
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 2000, `${label}: ${elapsed.toFixed(1)}ms（预算 2000ms）——正则疑似非线性`);
  }
});
