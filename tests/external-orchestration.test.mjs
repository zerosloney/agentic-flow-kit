// 外部编排宿主消费面（issue #73，2026-11-22）：宿主仓库未安装引擎资产（无 .agents/）时，经
// `flow-kit run` 消费引擎门禁脚本不得硬失败——缺枚举单源 / 无 wiki/ / 硬依赖安装资产的门与凭证
// 落盘一律 loud-skip（明确标注 + exit 0）；kit 自装项目（恒有 .agents/config/engine.json）行为零变化。
// 测试面：① check-loop 缺枚举单源 loud-skip；② verify-wiki-consistency 无 wiki/ loud-skip；
// ③ verify --face 裁 engine-artifacts / check-secrets 两门且凭证/生成物不落宿主仓；
// ④ kit 自装项目上述门真跑（不触发跳过分支）、裸 --list 门表不裁剪。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

// 裸宿主仓：仅 README + 一笔提交（无 .agents/、无 wiki/、无 workflow/）
function bareRepo() {
  const dir = makeTmp('flow-kit-host-');
  fs.writeFileSync(path.join(dir, 'README.md'), '# host repo (external orchestrator)\n');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '.'], { cwd: dir });
  const c = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init'], { cwd: dir });
  assert.equal(c.status, 0, c.stderr);
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

test('bare host repo: check-loop loud-skips missing enum single source', () => {
  const dir = bareRepo();
  const r = run(['run', 'check-loop.mjs', '--root', dir], dir);
  assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.ok(r.stderr.includes('未安装引擎资产'), r.stderr);
  assert.ok(r.stderr.includes('跳过闭环门禁'), r.stderr);
});

test('bare host repo: verify-wiki-consistency skips without wiki dir', () => {
  const dir = bareRepo();
  const r = run(['run', 'verify-wiki-consistency.mjs', '--root', dir], dir);
  assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.ok(`${r.stdout}${r.stderr}`.includes('跳过'), `${r.stdout}\n${r.stderr}`);
});

test('bare host repo: verify --face prunes asset gates and writes no credentials', () => {
  const dir = bareRepo();
  const r = run(['run', 'verify.mjs', '--face', 'backend', '--root', dir], dir);
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, `exit ${r.status}\n${out}`);
  assert.ok(out.includes('未安装引擎资产'), out);
  assert.ok(out.includes('engine-artifacts'), out);
  assert.ok(out.includes('check-secrets'), out);
  // 凭证不落宿主仓：台账、摘要、生成物三面均零污染
  assert.equal(fs.existsSync(path.join(dir, '.agents', 'verifications.jsonl')), false, 'verifications.jsonl must not land in host repo');
  assert.equal(fs.existsSync(path.join(dir, 'workflow', 'verify-evidence.md')), false, 'verify-evidence.md must not land in host repo');
  assert.equal(fs.existsSync(path.join(dir, '.agents', 'notes', 'engine-map.md')), false, 'engine-map.md must not land in host repo');
});

test('kit-installed project: gates really run and bare --list stays unpruned', () => {
  const dir = makeTmp('flow-kit-installed-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const inst = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(inst.status, 0, inst.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.agents', 'config', 'engine.json')), 'engine.json must exist after install');

  // 枚举单源在位 → 门真跑，不触发跳过分支（绿红不断言，门行为由既有套件守）
  const cl = run(['run', 'check-loop.mjs', '--root', dir], dir);
  assert.ok(!`${cl.stdout}${cl.stderr}`.includes('未安装引擎资产'), `${cl.stdout}\n${cl.stderr}`);

  // wiki/ 在位 → 不走「未启用知识库面」跳过分支
  const wiki = run(['run', 'verify-wiki-consistency.mjs', '--root', dir], dir);
  assert.ok(!`${wiki.stdout}${wiki.stderr}`.includes('未启用知识库面'), `${wiki.stdout}\n${wiki.stderr}`);

  // 裸 --list 门表不裁剪：engine-artifacts / secrets-scan（check-secrets.mjs 的挂载 id）仍在 stdout id 清单
  const list = run(['run', 'verify.mjs', '--list'], dir);
  assert.equal(list.status, 0, list.stderr);
  assert.ok(list.stdout.includes('engine-artifacts'), list.stdout);
  assert.ok(list.stdout.includes('secrets-scan'), list.stdout);
});
