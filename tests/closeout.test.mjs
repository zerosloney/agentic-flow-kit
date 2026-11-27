import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLOSEOUT = path.join(HERE, '..', 'templates', 'engine', '.agents', 'scripts', 'closeout.mjs');

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

// 终态家族会触发 confirm-doc 的 archive-on-close：approve 态的 L1 入口经 closeout 落 done 后，
// 同族（同名）文档整体 git mv 到 workflow/archive/<月>/<类型>/。
function fixture() {
  const root = makeTmp('closeout-');
  for (const dir of ['intents', 'specs', 'plans', 'incidents']) {
    fs.mkdirSync(path.join(root, 'workflow', dir), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'workflow', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'archive', '.gitkeep'), '');
  fs.writeFileSync(path.join(root, 'workflow', 'intents', 'demo.md'), [
    '---', '状态: approved', '级别: L1', '日期: 2026-11-26', '模块: pipeline', '---', '',
    '# INTENT — demo', '', '## 目标', '', '- 演示归档行为', '', '## 验收标准', '', '- [x] 演示归档行为（证据：abc123）', '',
  ].join('\n'));
  assert.equal(git(root, ['init', '-q', '-b', 'main']).status, 0);
  assert.equal(git(root, ['add', '-A']).status, 0);
  assert.equal(git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']).status, 0);
  return root;
}

function runCloseout(root) {
  return spawnSync(process.execPath, [
    CLOSEOUT, 'workflow/intents/demo.md', '--delegated', '演示归档行为', '--root', root,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CONFIRM_DOC_ARCHIVE: '1', FLOW_KIT_TEST: '1' },
    timeout: 60000,
  });
}

test('confirm-doc 暂存的归档移动是 closeout 的合法候选，关单可完成', () => {
  const root = fixture();
  const r = runCloseout(root);
  assert.equal(r.status, 0, `closeout 应完成：\n${r.stdout}\n${r.stderr}`);
  const month = new Date().toISOString().slice(0, 7);
  const archived = path.join(root, 'workflow', 'archive', month, 'intents', 'demo.md');
  assert.ok(fs.existsSync(archived), `归档目标应存在：${archived}`);
  assert.equal(fs.existsSync(path.join(root, 'workflow', 'intents', 'demo.md')), false);
  assert.equal(git(root, ['log', '-1', '--format=%s']).stdout.trim(), 'docs(workflow): demo 关单');
  assert.equal(git(root, ['diff', '--cached', '--name-only']).stdout.trim(), '');
});

test('暂存区里的无关路径仍然拒绝提交', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'unrelated.txt'), 'x\n');
  assert.equal(git(root, ['add', 'src/unrelated.txt']).status, 0);
  const r = runCloseout(root);
  assert.equal(r.status, 1, `应在步骤 ④ 拒绝提交：\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /步骤 ④ 拒绝提交/);
  assert.match(r.stderr, /src\/unrelated\.txt/);
  assert.equal(git(root, ['log', '-1', '--format=%s']).stdout.trim(), 'init');
});
