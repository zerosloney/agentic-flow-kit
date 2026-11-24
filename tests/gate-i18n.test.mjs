// gate-i18n.test.mjs — 门禁脚本运行时双语：读 .agents/config/engine.json options.language，
// en 装户的 SKIP / 门表显示名走英文；language 缺省（或读取失败）保持中文原文（zh 输出逐字节不变）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = path.join(KIT, 'templates', 'engine', '.agents', 'hooks');
const SCRIPTS = path.join(KIT, 'templates', 'engine', '.agents', 'scripts');

// 临时 git 仓 + engine.json（language 缺省时只写 stack，覆盖回退分支）
function tmpRepo(language) {
  const dir = makeTmp('flow-kit-gate-i18n-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const configDir = path.join(dir, '.agents', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const options = { stack: 'node', ...(language ? { language } : {}) };
  fs.writeFileSync(path.join(configDir, 'engine.json'), JSON.stringify({ options }));
  return dir;
}

function run(script, dir, args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, FLOW_KIT_TEST: '1', ...env },
  });
}

test('check-architecture 未配置：en 出英文 SKIP，language 缺省保持中文', () => {
  const en = tmpRepo('en');
  const rEn = run(path.join(HOOKS, 'check-architecture.mjs'), en);
  assert.equal(rEn.status, 0, rEn.stderr);
  assert.match(rEn.stderr, /SKIP no architecture redlines configured/);
  assert.ok(!rEn.stderr.includes('未配置'), rEn.stderr);

  const zh = tmpRepo(undefined);
  const rZh = run(path.join(HOOKS, 'check-architecture.mjs'), zh);
  assert.equal(rZh.status, 0, rZh.stderr);
  assert.match(rZh.stderr, /SKIP 未配置架构红线/);
});

test('check-audit-fields 未配置：en 出英文 SKIP，language 缺省保持中文', () => {
  const en = tmpRepo('en');
  const rEn = run(path.join(HOOKS, 'check-audit-fields.mjs'), en);
  assert.equal(rEn.status, 0, rEn.stderr);
  assert.match(rEn.stderr, /SKIP no audit field guard configured/);
  assert.ok(!rEn.stderr.includes('未配置'), rEn.stderr);

  const zh = tmpRepo(undefined);
  const rZh = run(path.join(HOOKS, 'check-audit-fields.mjs'), zh);
  assert.equal(rZh.status, 0, rZh.stderr);
  assert.match(rZh.stderr, /SKIP 未配置审计字段守卫/);
});

test('verify --list --verbose：en 下内建门显示名用英文', () => {
  const dir = tmpRepo('en');
  const r = run(path.join(SCRIPTS, 'verify.mjs'), dir, ['--list', '--verbose'], { FLOW_KIT_PROJECT_ROOT: dir });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  // 裸 --list 的 stdout 恒为纯 id（对外契约）；--verbose 行 = id<TAB>显示名<TAB>命令
  assert.ok(r.stdout.split(/\r?\n/).filter(Boolean).every((l) => l.split('\t').length === 3), r.stdout);
  assert.ok(r.stdout.split(/\r?\n/).some((l) => l.startsWith('scripts-syntax\tEngine script syntax self-check\t')), r.stdout);
  assert.ok(!r.stdout.includes('引擎脚本语法自检'), r.stdout);
});
