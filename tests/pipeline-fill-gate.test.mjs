import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

// D1（2026-11-27）：pipeline 产物落 workflow/tasks/<task>/，起草门却按 intents|incidents/<输出名>.md
// 找入口（输出名恒为 spec / plan）→ L2/L3 在 spec-fill 永久 gate-fail。本文件锁定 tasks 路径的
// 起草门：入口取任务目录自身的 intent.md / incident.md，缺入口或未确认仍 fail-closed；
// 手动四目录（intents / specs / plans）路径行为不变。

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(KIT, 'templates', 'engine', '.agents');
const TASK = 'workflow/tasks/2026-11-20-demo';

function project() {
  const root = makeTmp('fk-fill-gate-');
  fs.cpSync(ENGINE, path.join(root, '.agents'), { recursive: true });
  return root;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  return abs;
}

function runScript(root, script, args) {
  return spawnSync(process.execPath, [path.join(root, '.agents', 'scripts', script), ...args], { cwd: root, encoding: 'utf8' });
}

function taskIntent(root, { level = 'L2', confirm = true } = {}) {
  const rel = `${TASK}/intent.md`;
  write(root, rel, ['---', '状态: draft', `级别: ${level}`, '日期: 2026-11-20', '模块: pipeline', '---', '', '# INTENT — demo', '', '## 背景与问题', '导出缺失', ''].join('\n'));
  if (confirm) {
    const r = runScript(root, 'confirm-doc.mjs', [rel, '--delegated', '用户确认：按这个意图推进', '--root', root]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  }
  return rel;
}

function readRun(root) {
  const dir = path.join(root, '.agents', 'cache', 'pipeline-runs');
  const id = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
  return JSON.parse(fs.readFileSync(path.join(dir, id), 'utf8'));
}

test('D1: task-dir spec-fill passes the gate on the task\'s confirmed intent', () => {
  const root = project();
  taskIntent(root);
  const r = runScript(root, 'fill-spec.mjs', ['--topic', 'demo', '--level', 'L2', '--output', `${TASK}/spec.md`]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(fs.readFileSync(path.join(root, TASK, 'spec.md'), 'utf8'), /状态: draft/);
});

test('D1: task-dir spec-fill fails closed while the task intent is still draft', () => {
  const root = project();
  taskIntent(root, { confirm: false });
  const r = runScript(root, 'fill-spec.mjs', ['--topic', 'demo', '--level', 'L2', '--output', `${TASK}/spec.md`]);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.equal(fs.existsSync(path.join(root, TASK, 'spec.md')), false);
});

test('D1: task-dir spec-fill fails closed when the task has no entry document', () => {
  const root = project();
  const r = runScript(root, 'fill-spec.mjs', ['--topic', 'demo', '--level', 'L2', '--output', `${TASK}/spec.md`]);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.equal(fs.existsSync(path.join(root, TASK, 'spec.md')), false);
});

test('D1: task-dir plan-fill passes on confirmed intent + confirmed task spec', () => {
  const root = project();
  taskIntent(root);
  const specRel = `${TASK}/spec.md`;
  const fill = runScript(root, 'fill-spec.mjs', ['--topic', 'demo', '--level', 'L2', '--output', specRel]);
  assert.equal(fill.status, 0, `${fill.stdout}\n${fill.stderr}`);
  const conf = runScript(root, 'confirm-doc.mjs', [specRel, '--delegated', '用户确认：spec 通过', '--root', root]);
  assert.equal(conf.status, 0, `${conf.stdout}\n${conf.stderr}`);
  const r = runScript(root, 'fill-plan.mjs', ['--topic', 'demo', '--level', 'L2', '--output', `${TASK}/plan.md`]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(fs.readFileSync(path.join(root, TASK, 'plan.md'), 'utf8'), /状态: draft/);
});

test('D1: task-dir plan-fill fails closed when the task spec is not confirmed', () => {
  const root = project();
  taskIntent(root);
  const fill = runScript(root, 'fill-spec.mjs', ['--topic', 'demo', '--level', 'L2', '--output', `${TASK}/spec.md`]);
  assert.equal(fill.status, 0, `${fill.stdout}\n${fill.stderr}`);
  const r = runScript(root, 'fill-plan.mjs', ['--topic', 'demo', '--level', 'L2', '--output', `${TASK}/plan.md`]);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.equal(fs.existsSync(path.join(root, TASK, 'plan.md')), false);
});

test('D1: legacy workflow/intents entry still satisfies spec-fill', () => {
  const root = project();
  write(root, 'workflow/intents/demo.md', ['---', '状态: approved', '日期: 2026-11-20', '---', '流程: legacy', '', '# INTENT — demo', ''].join('\n'));
  const r = runScript(root, 'fill-spec.mjs', ['--topic', 'demo', '--level', 'L2', '--output', 'workflow/specs/demo.md']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.equal(fs.existsSync(path.join(root, 'workflow', 'specs', 'demo.md')), true);
});

test('D1: task-dir incident lane passes on the incident\'s timeline confirmation', () => {
  const root = project();
  write(root, `${TASK}/incident.md`, ['---', '状态: open', '级别: L2', '日期: 2026-11-20', '---', '', '# INCIDENT — demo', '', '## 时间线', '', '- 2026-11-20 用户确认：按此修复', ''].join('\n'));
  const r = runScript(root, 'fill-spec.mjs', ['--topic', 'demo', '--level', 'L2', '--output', `${TASK}/spec.md`]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});

test('D1: task-dir incident lane fails closed without a user-confirmation line', () => {
  const root = project();
  write(root, `${TASK}/incident.md`, ['---', '状态: open', '级别: L2', '日期: 2026-11-20', '---', '', '# INCIDENT — demo', '', '## 时间线', '', '- 2026-11-20 发现问题', ''].join('\n'));
  const r = runScript(root, 'fill-spec.mjs', ['--topic', 'demo', '--level', 'L2', '--output', `${TASK}/spec.md`]);
  assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
  assert.equal(fs.existsSync(path.join(root, TASK, 'spec.md')), false);
});

test('D1: L2 pipeline advances past spec-fill with the real fill-spec script', () => {
  const root = project();
  write(root, 'README.md', 'base\n');
  fs.writeFileSync(path.join(root, '.agents', 'config', 'workflow-modules.txt'), 'wiki\nbackend\n');
  const g = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'tester'], ['add', '.'], ['commit', '-m', 'init']]) {
    assert.equal(g(args).status, 0, `git ${args.join(' ')}`);
  }
  const env = {
    ...process.env,
    PIPELINE_RUN_ROOT: root,
    PIPELINE_RUN_BIN: path.join(root, '.agents', 'scripts'),
    PIPELINE_RUN_TODAY: '2026-11-20',
  };
  const pipeline = (args) => spawnSync(process.execPath, [path.join(root, '.agents', 'scripts', 'pipeline-run.mjs'), ...args], {
    cwd: root, encoding: 'utf8', env, timeout: 120000,
  });

  let r = pipeline(['start', '给 wiki 模块新增导出功能', '--hint', 'kind=require level=L2 module=wiki']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  let run = readRun(root);
  r = pipeline(['next', '--run', run.runId, '--triage', 'kind=require level=L2 module=wiki topic=wedge']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  run = readRun(root);
  const intentAbs = path.join(root, run.docs.entry);
  fs.writeFileSync(intentAbs, [
    '---', '状态: draft', '级别: L2', '日期: 2026-11-20', '模块: wiki', '---', '',
    '# wedge', '', '## 背景与问题', 'wiki 导出缺失', '',
    '## 历史教训/防复发', '无', '', '## 目标', '新增导出', '',
    '## 非目标', '不改导入', '', '## 约束', '零依赖', '',
    '## 验收标准', '- [ ] 导出可用',
  ].join('\n'), 'utf8');
  r = pipeline(['next', '--run', run.runId]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  r = pipeline(['next', '--run', run.runId, '--delegated', '同意该意图']);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  run = readRun(root);
  assert.equal(run.stage, 'spec-draft', `pipeline wedged: ${r.stdout}\n${r.stderr}`);
  assert.equal(fs.existsSync(path.join(root, 'workflow', 'tasks', '2026-11-20-wedge', 'spec.md')), true);
});
