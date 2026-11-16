import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// usage-collect.cjs CLI 契约：PostToolUse(Agent) 载荷 → usage.jsonl 追加一行（schema 对齐 usage-log.mjs）；
// 关键 token 字段缺失 → 静默零写入、exit 0、stdout 干净；任何路径下都不 fail-open 写脏数据。
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'usage-collect.cjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-usage-collect-');
  // root 探测锚：适配器向上找 .agents/install-manifest.json（同 codex-gate.cjs）
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'install-manifest.json'), '{}');
  return dir;
}

function run(payload, cwd) {
  return spawnSync(process.execPath, [ADAPTER], {
    cwd,
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

function ledger(dir) {
  return fs.readFileSync(path.join(dir, '.agents', 'usage.jsonl'), 'utf8');
}

test('collects a usage row from a PostToolUse/Agent payload', () => {
  const dir = tmpRepo();
  const r = run({
    session_id: 's1',
    cwd: dir,
    tool_name: 'Agent',
    tool_input: { description: 'x', prompt: 'y' },
    tool_response: {
      usage: { input_tokens: 4, cache_creation_input_tokens: 6, cache_read_input_tokens: 100, output_tokens: 500 },
      totalTokens: 504,
      totalDurationMs: 1200.5,
      totalToolUseCount: 3,
      resolvedModel: 'claude-sonnet-4-5',
      agentId: 'a1b2c3',
    },
  }, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '', 'stdout must stay clean (hook protocol)');
  const lines = ledger(dir).trim().split('\n');
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(row.role, 'agent');
  assert.equal(row.model, 'claude-sonnet-4-5');
  assert.equal(row.run, 'a1b2c3');
  assert.equal(row.inputTokens, 4);
  assert.equal(row.outputTokens, 500);
  assert.equal(row.latencyMs, 1200.5);
  // cache token 与 totalTokens 不落账（行 schema 无此字段，不得混入 inputTokens）
  assert.equal(row.totalTokens, undefined);
  assert.equal(row.costUsd, undefined);
});

test('appends without rewriting history across runs', () => {
  const dir = tmpRepo();
  assert.equal(run({
    cwd: dir,
    tool_response: { usage: { input_tokens: 1, output_tokens: 2 }, resolvedModel: 'm1', agentId: 'run-a' },
  }, dir).status, 0);
  const before = ledger(dir);
  assert.equal(run({
    cwd: dir,
    tool_response: { usage: { input_tokens: 3, output_tokens: 4 }, resolvedModel: 'm2' },
  }, dir).status, 0);
  const lines = ledger(dir).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], before.trim());
});

test('payloads without token data write nothing and exit 0', () => {
  const dir = tmpRepo();
  const seeds = [
    { cwd: dir, tool_name: 'Agent', tool_response: { status: 'completed' } },
    { cwd: dir, tool_name: 'Agent', tool_response: { usage: {}, resolvedModel: 'm' } },
    { cwd: dir, tool_name: 'Agent' },
    { cwd: dir },
    {},
  ];
  for (const payload of seeds) {
    const r = run(payload, dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
  assert.throws(() => ledger(dir), { code: 'ENOENT' });
});

test('malformed stdin and non-flow-kit roots are silent no-ops', () => {
  const dir = tmpRepo();
  let r = run('{not json', dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  // 无 install-manifest 锚（且无 FLOW_KIT_PROJECT_ROOT）→ 不定位到任何仓，零写入
  const plain = makeTmp('flow-kit-usage-collect-plain-');
  r = run({ cwd: plain, tool_response: { usage: { input_tokens: 1, output_tokens: 1 } } }, plain);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.throws(() => fs.readFileSync(path.join(plain, '.agents', 'usage.jsonl'), 'utf8'), { code: 'ENOENT' });
});

test('FLOW_KIT_PROJECT_ROOT anchors the ledger when cwd differs', () => {
  const dir = tmpRepo();
  const elsewhere = makeTmp('flow-kit-usage-collect-cwd-');
  const r = spawnSync(process.execPath, [ADAPTER], {
    cwd: elsewhere,
    encoding: 'utf8',
    input: JSON.stringify({ tool_response: { usage: { input_tokens: 7, output_tokens: 8 }, resolvedModel: 'm', agentId: 'r9' } }),
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: dir },
  });
  assert.equal(r.status, 0, r.stderr);
  const row = JSON.parse(ledger(dir).trim());
  assert.equal(row.inputTokens, 7);
  assert.equal(row.run, 'r9');
});
