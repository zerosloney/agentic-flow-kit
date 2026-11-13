import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const ENGINE = path.join(KIT, 'templates/engine/.agents/scripts');
const CHECK_SPEC = path.join(ENGINE, 'check-spec-packages.mjs');
const AGENT_EVAL = path.join(ENGINE, 'agent-eval.mjs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-artifacts-'));
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function pkg(root, name, { spec = true, tasks = true, verify = true, conclusion = 'partial' } = {}) {
  const dir = path.join(root, 'workflow/specs', name);
  if (spec) write(path.join(dir, 'spec.md'), '# Demo\n\n## 验收标准\n\n- [ ] works\n');
  if (tasks) write(path.join(dir, 'tasks.md'), '# Tasks\n\n- [ ] T1\n');
  if (verify) write(path.join(dir, 'verify-report.md'), `# Verify\n\n## 结果\n\n结论: ${conclusion}\n\n## 证据\n\n- npm test\n`);
  return dir;
}

test('check-spec-packages validates complete and incomplete spec packages', async () => {
  const root = tmp();
  pkg(root, 'good');
  pkg(root, 'missing-verify', { verify: false });
  pkg(root, 'no-acceptance', { spec: false });

  const mod = await import(pathToFileURL(CHECK_SPEC).href);
  const good = mod.checkPackage(root, 'good');
  assert.equal(good.ok, true);
  assert.deepEqual(good.problems, []);
  const bad = mod.checkPackage(root, 'missing-verify');
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(';'), /verify-report\.md/);
  const noSpec = mod.checkPackage(root, 'no-acceptance');
  assert.match(noSpec.problems.join(';'), /spec\.md/);

  const r = spawnSync(process.execPath, [CHECK_SPEC, '--root', root, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.packages.find((item) => item.package === 'good').ok, true);
});

test('check-spec-packages passes with no packages and enforces conclusion values', () => {
  const empty = tmp();
  const ok = spawnSync(process.execPath, [CHECK_SPEC, '--root', empty, '--json'], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.deepEqual(JSON.parse(ok.stdout).packages, []);

  const root = tmp();
  pkg(root, 'bad-conclusion', { conclusion: 'maybe' });
  const bad = spawnSync(process.execPath, [CHECK_SPEC, '--root', root, '--json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(JSON.parse(bad.stdout).packages[0].problems.join(';'), /结论/);
});

test('agent-eval writes a versioned eval-log and supports opt-out / custom path', async () => {
  const mod = await import(pathToFileURL(AGENT_EVAL).href);
  const root = tmp();
  const now = new Date('2026-01-02T03:04:05.000Z');
  mod.recordEval(root, { passRate: 0.9, tasks: 6, model: 'sonnet', note: 'ok', now });
  const file = path.join(root, '.agents/evals/eval-log.json');
  assert.equal(fs.existsSync(file), true);
  let log = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(log.version, 1);
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].outcome, 'pass');
  assert.equal(log.entries[0].threshold, 0.8);
  assert.equal(log.entries[0].ts, now.toISOString());

  mod.recordEval(root, { passRate: 0.2, tasks: 6, model: 'sonnet', now });
  log = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(log.entries.length, 2);
  assert.equal(log.entries[1].outcome, 'fail');

  mod.recordEval(root, { passRate: 0.9, tasks: 6, model: 'sonnet', now, evalLog: false });
  log = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(log.entries.length, 2);

  mod.recordEval(root, { passRate: 0.9, tasks: 6, model: 'sonnet', now, evalLog: 'custom/eval-log.json' });
  assert.equal(fs.existsSync(path.join(root, 'custom/eval-log.json')), true);
});

test('scaffold installs the spec package templates and validator', () => {
  const dir = tmp();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const r = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  for (const rel of [
    'workflow/specs/_TEMPLATE/spec.md',
    'workflow/specs/_TEMPLATE/tasks.md',
    'workflow/specs/_TEMPLATE/verify-report.md',
  ]) {
    assert.equal(fs.existsSync(path.join(dir, rel)), true, rel);
  }
  // R5-1b：校验脚本随包分发，不再安装到项目。
  assert.equal(fs.existsSync(path.join(dir, '.agents/scripts')), false);
  assert.equal(fs.existsSync(CHECK_SPEC), true);
  const check = spawnSync(process.execPath, [CHECK_SPEC, '--root', '.', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});
