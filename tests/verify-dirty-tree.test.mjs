// BACKLOG 34：verify 落账行绑定脏树摘要（dirtyTree）+ gen-verify-evidence 渲染「非干净树」标注。
// 口径（verify.mjs 头注「凭证落账」段）：dirtyTree = sha256(`git status --porcelain` 输出 +
// `git diff HEAD` 内容) 前 16 位；干净树 = ''（porcelain 空）；脏树 = 16 位 hex；
// git 不可用 / 非 git 根 / 存量行 = 缺键（未知）。spawn 级端到端：临时 git 仓 + --stub-gate
// 夹具走生产尾段（须配 CHECK_LOOP_ROOT，与生产守卫一致；绿行不打 testCmd 标记）。
// 审计 D39：stub 行虽走生产尾段落账，但不得渲染进入库摘要（与 testCmd/engineOnly 同口径）。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'verify.mjs');
const DIGEST = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'git-tree-digest.mjs');
const GEN = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'gen-verify-evidence.mjs');

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  return r.stdout.trim();
};

const initRepo = (prefix) => {
  const dir = makeTmp(prefix);
  git(dir, 'init', '-q', '-b', 'main');
  // 镜像真实装机：运行态产物（失败门日志 tmp/、本地台账 .agents/）不入库、不算树脏
  //（kit 约定 tmp = 一次性/生成件 gitignored，见 check-scripts-syntax.mjs SKIP_DIRS 注）——
  // 夹具不忽略的话，verify 自写日志会把「干净树失败行」的摘要污染成非空。
  fs.writeFileSync(path.join(dir, '.gitignore'), 'tmp/\n.agents/\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c0');
  return dir;
};

const runVerifyStub = (root, cmd) => spawnSync(process.execPath, [VERIFY, '--stub-gate', cmd], {
  cwd: root, encoding: 'utf8',
  env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root, CHECK_LOOP_ROOT: root },
});

// digestIn(dir)：起子进程直调 git-tree-digest.mjs 的导出——verify.mjs 顶层 import 即跑主流程
// （无 main guard），三态降级只能对无副作用单源模块单元级直达。
const digestIn = (dir) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { dirtyTreeDigest } from ${JSON.stringify(pathToFileURL(DIGEST).href)}; process.stdout.write(JSON.stringify(dirtyTreeDigest(${JSON.stringify(dir)})));`],
    { encoding: 'utf8', env: { ...process.env, FLOW_KIT_PROJECT_ROOT: dir, CHECK_LOOP_ROOT: dir } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

const readLedger = (root) => fs.readFileSync(path.join(root, '.agents', 'verifications.jsonl'), 'utf8')
  .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const lastGreen = (root) => readLedger(root).filter((e) => e.exitCode === 0 && e.suite === 'all-gates').at(-1);

test('verify 全绿行：干净树落 dirtyTree 空串（可判定零值），凭证照常带 headShort', () => {
  const dir = initRepo('fk-dirty-clean-');
  const r = runVerifyStub(dir, 'node -e "process.exit(0)"');
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, `stub 夹具应全绿，实际 exit ${r.status}:\n${out}`);
  const green = lastGreen(dir);
  assert.ok(green, '应有 all-gates 绿行');
  assert.equal(green.headShort, git(dir, 'rev-parse', '--short', 'HEAD'));
  assert.equal(green.dirtyTree, '', '干净树 → 空串');
  // 审计 D39：stub 行不渲染进摘要——入库文件不得出现无标记的桩门全绿行（verify-scope 会当全量锚）
  const md = fs.readFileSync(path.join(dir, 'workflow', 'verify-evidence.md'), 'utf8');
  assert.ok(!md.includes(`\`${green.headShort}\``), 'stub 凭证不应渲染进摘要');
});

test('verify 全绿行：脏树落 16 位 hex 摘要，且随未提交内容变化', () => {
  const dir = initRepo('fk-dirty-dirty-');
  fs.writeFileSync(path.join(dir, 'README.md'), 'v1\n');
  const r1 = runVerifyStub(dir, 'node -e "process.exit(0)"');
  assert.equal(r1.status, 0, `脏树首跑应全绿:\n${r1.stdout}${r1.stderr}`);
  const d1 = lastGreen(dir).dirtyTree;
  assert.match(d1, /^[0-9a-f]{16}$/, '脏树摘要应为 16 位 hex');
  fs.writeFileSync(path.join(dir, 'README.md'), 'v2\n');
  const r2 = runVerifyStub(dir, 'node -e "process.exit(0)"');
  assert.equal(r2.status, 0, `脏树重跑应全绿:\n${r2.stdout}${r2.stderr}`);
  const d2 = lastGreen(dir).dirtyTree;
  assert.match(d2, /^[0-9a-f]{16}$/);
  assert.notEqual(d1, d2, '未提交内容变化 → 摘要随之变化');
});

test('verify 失败行：同样带 dirtyTree（干净树 = 空串）', () => {
  const dir = initRepo('fk-dirty-fail-');
  const r = runVerifyStub(dir, 'node -e "process.exit(1)"');
  assert.equal(r.status, 1, `stub 失败应 exit 1，实际 ${r.status}`);
  const failRow = readLedger(dir).find((e) => e.exitCode !== 0);
  assert.ok(failRow, '应有失败行');
  assert.equal(failRow.suite, 'stub');
  assert.equal(failRow.dirtyTree, '', '干净树失败行 → 空串');
});

test('gen-verify-evidence：脏树凭证标「非干净树」；干净/存量无字段行不标（向前兼容）', () => {
  const dir = makeTmp('fk-dirty-gen-');
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  // 四类行：干净树（''）/ 脏树（16 位 hex）/ 存量无字段（未知口径）/ 夹具标记行（审计 D39）
  const rows = [
    { ts: '2026-11-18T01:00:00.000Z', exitCode: 0, suite: 'all-gates', headShort: 'aaaaaaa', gates: 22, dirtyTree: '' },
    { ts: '2026-11-18T02:00:00.000Z', exitCode: 0, suite: 'all-gates', headShort: 'bbbbbbb', gates: 22, dirtyTree: '0123456789abcdef' },
    { ts: '2026-11-18T03:00:00.000Z', exitCode: 0, suite: 'all-gates', headShort: 'ccccccc', gates: 22 },
    { ts: '2026-11-18T04:00:00.000Z', exitCode: 0, suite: 'all-gates', headShort: 'ddddddd', gates: 1, stub: true },
    { ts: '2026-11-18T05:00:00.000Z', exitCode: 0, suite: 'all-gates', headShort: 'eeeeeee', gates: 22, testCmd: true },
    { ts: '2026-11-18T06:00:00.000Z', exitCode: 0, suite: 'all-gates', headShort: 'fffffff', gates: 7, engineOnly: true },
  ];
  fs.writeFileSync(path.join(dir, '.agents', 'verifications.jsonl'), rows.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [GEN, '--root', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `gen 应成功:\n${r.stdout}${r.stderr}`);
  const md = fs.readFileSync(path.join(dir, 'workflow', 'verify-evidence.md'), 'utf8');
  const rowOf = (sha) => md.split(/\r?\n/).find((l) => l.trim().startsWith(`| \`${sha}\``));
  assert.ok(!rowOf('aaaaaaa').includes('非干净树'), '干净树凭证不标注');
  assert.match(rowOf('bbbbbbb'), /非干净树/, '脏树凭证标注「非干净树」');
  assert.ok(!rowOf('ccccccc').includes('非干净树'), '存量无字段行不标注（向前兼容）');
  // 夹具行（审计 D39）：stub / testCmd / engineOnly 即使 exitCode 0 也不渲染成无标记全绿行
  assert.equal(rowOf('ddddddd'), undefined, 'stub 行不渲染');
  assert.equal(rowOf('eeeeeee'), undefined, 'testCmd 行不渲染');
  assert.equal(rowOf('fffffff'), undefined, 'engineOnly 行不渲染');
  // 重生成幂等（追加保全：已入仓行不因重读而漂移）——--check 应绿
  const chk = spawnSync(process.execPath, [GEN, '--root', dir, '--check'], { encoding: 'utf8' });
  assert.equal(chk.status, 0, `--check 应一致:\n${chk.stdout}${chk.stderr}`);
});

test('dirtyTreeDigest 三态直达：干净 → 空串；脏 → 16hex；非 git 根 → null（缺键=未知，不伪造）', () => {
  const clean = initRepo('fk-digest-clean-');
  assert.equal(digestIn(clean), '', '已提交无改动 = 干净树');
  fs.writeFileSync(path.join(clean, 'README.md'), 'y\n');
  assert.match(digestIn(clean), /^[0-9a-f]{16}$/, '未提交改动 = 脏树摘要');
  const plain = makeTmp('fk-digest-nogit-');
  assert.equal(digestIn(plain), null, '非 git 根降级为 null（调用方省略键）');
});

test('零提交仓：diff HEAD 失败仍落非空摘要（porcelain 入摘要，不依赖 diff）', () => {
  const dir = makeTmp('fk-digest-nocommit-');
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n'); // 未提交未跟踪
  assert.match(digestIn(dir), /^[0-9a-f]{16}$/, '零提交仓 diff 失败时 porcelain 入摘要');
});
