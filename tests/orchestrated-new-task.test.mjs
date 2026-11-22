// issue #74：引擎工单模板内置探索协议与外部编排方安全策略冲突。
// 落地两档拆分：kit 自安装项目继续用 templates/engine 完整协议（原样不动）；
// 被外部编排档收敛为 templates/orchestrated/new-task.md 最小协议（任务目标 + 交付要求 +
// 范围边界），不含任何探索/检索指令——状态信息一律由编排方注入。最小档不进安装面。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const MINIMAL = path.join(KIT, 'templates', 'orchestrated', 'new-task.md');
const FULL = path.join(KIT, 'templates', 'engine', '.agents', 'commands', 'new-task.md');

function tmpRepo() {
  const dir = makeTmp('flow-kit-orch-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function walk(root, rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (next === '.git') continue;
      walk(root, next, out);
    } else {
      out.push(next);
    }
  }
  return out;
}

test('最小档模板存在且结构完整', () => {
  const text = fs.readFileSync(MINIMAL, 'utf8');
  for (const heading of ['## 任务目标', '## 交付要求', '## 范围边界']) {
    assert.ok(text.includes(heading), `缺少标题: ${heading}`);
  }
  assert.ok(text.includes('编排方'), '需写明外部编排方消费口径');
});

test('最小档不含任何指令性探索协议', () => {
  const text = fs.readFileSync(MINIMAL, 'utf8');
  assert.doesNotMatch(
    text,
    /flow-kit run|kb-search|ctx_search|^## .*闭环兜底|\.githooks|session-resume|技能装载/m,
  );
});

test('安装面不受影响：完整协议原样安装，最小档不进目标仓', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);

  // 完整协议原样安装，未被新档影响（逐字节一致）
  const installed = fs.readFileSync(path.join(dir, '.agents', 'commands', 'new-task.md'));
  assert.ok(installed.equals(fs.readFileSync(FULL)), '安装的 new-task.md 必须与完整协议模板逐字节一致');

  // 最小档没有被安装：无 orchestrated/ 目录，.agents/**/new-task*.md 之外无 new-task 副本
  assert.equal(fs.existsSync(path.join(dir, 'orchestrated')), false);
  const offenders = walk(dir).filter(
    (rel) => /^new-task.*\.md$/.test(path.basename(rel)) && !rel.startsWith('.agents/'),
  );
  assert.deepEqual(offenders, []);

  // 直接证明：目标仓没有任何文件内容等于最小档
  const minimalBuf = fs.readFileSync(MINIMAL);
  for (const rel of walk(dir)) {
    const abs = path.join(dir, rel);
    assert.ok(!fs.readFileSync(abs).equals(minimalBuf), `目标仓出现最小档副本: ${rel}`);
  }
});

test('templates/orchestrated 目录单一性：只允许这一个文件', () => {
  assert.deepEqual(fs.readdirSync(path.join(KIT, 'templates', 'orchestrated')), ['new-task.md']);
});
