import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../src/cli/exit.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-diff-');
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

function install(dir, extra = []) {
  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function readManifest(dir) {
  return JSON.parse(read(dir, '.agents/install-manifest.json'));
}

function writeManifest(dir, value) {
  fs.writeFileSync(
    path.join(dir, '.agents/install-manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function diffJson(dir, extra = []) {
  const r = run(['diff', '--target', '.', '--json', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function itemOf(result, rel) {
  const item = result.items.find((entry) => entry.targetRel === rel);
  assert.ok(item, `missing diff item for ${rel}`);
  return item;
}

test('fresh install has no drift', () => {
  const dir = tmpRepo();
  install(dir);
  const result = diffJson(dir);
  assert.equal(result.summary.userModified, 0);
  assert.equal(result.summary.kitUpdated, 0);
  assert.equal(result.summary.orphan, 0);
  assert.equal(result.summary.missing, 0);
  assert.ok(result.summary.unchanged > 100, 'expected the full managed surface to be unchanged');
  for (const item of result.items) {
    assert.equal(item.kind, 'unchanged', item.targetRel);
    assert.equal(item.managed, true, item.targetRel);
    assert.equal(item.actualHash, item.managedHash, item.targetRel);
  }
});

// 回归：buildState 曾漏传 scaffold / devcontainer（没装的文件被误报「缺失」）与 product / ports
// （渲染差异被误报「模板更新」）——非默认安装一跑 diff / doctor 就出现假漂移。
test('fresh install with non-default options has no drift (manifest options are replayed)', () => {
  const cases = [
    ['--product', 'api'],
    ['--api-port', '9000', '--web-port', '5100'],
    ['--scaffold', 'minimal'],
    ['--scaffold', 'none'],
    ['--no-devcontainer'],
  ];
  for (const extra of cases) {
    const label = extra.join(' ');
    const dir = tmpRepo();
    install(dir, extra);
    const result = diffJson(dir);
    assert.equal(result.summary.missing, 0, `${label}: ${JSON.stringify(result.summary)}`);
    assert.equal(result.summary.kitUpdated, 0, `${label}: ${JSON.stringify(result.summary)}`);
    assert.equal(result.summary.userModified, 0, label);
    const doc = run(['doctor', '--target', '.'], dir);
    assert.equal(doc.status, 0, doc.stderr);
    assert.doesNotMatch(`${doc.stdout}${doc.stderr}`, /manifest drift/, `${label}: doctor must not report drift`);
  }
});

// 回归：remove-host 收敛剩余宿主时曾用不完整的重放变量（漏 product / ports / stacks /
// scaffold / devcontainer），非默认安装被静默退回默认渲染。
test('remove-host replays manifest options when converging the remaining hosts', () => {
  const cases = [
    ['--product', 'api', '--api-port', '9000', '--web-port', '5100'],
    ['--scaffold', 'minimal'],
    ['--stack', 'dotnet', '--stack', 'node'],
    ['--no-devcontainer'],
  ];
  for (const extra of cases) {
    const label = extra.join(' ');
    const dir = tmpRepo();
    if (extra.filter((arg) => arg === '--stack').length > 1) {
      // 多栈：install 助手固定传 --stack node，这里直接调用以保留两个 --stack。
      const r = run(['install', '--agent', 'trae', '--agent', 'claude', '--lang', 'zh-CN', '--target', '.', ...extra], dir);
      assert.equal(r.status, 0, r.stderr);
    } else {
      install(dir, ['--agent', 'claude', ...extra]);
    }
    const agentsBefore = read(dir, 'AGENTS.md');
    // engine.json 的 hosts 会随宿主移除变化，这里只比对受重放影响的选项。
    const optionsOf = () => {
      const { product, ports, stacks } = JSON.parse(read(dir, '.agents/config/engine.json')).options;
      return { product, ports, stacks };
    };
    const optionsBefore = optionsOf();
    const removed = run(['remove-host', 'claude', '--target', '.'], dir);
    assert.equal(removed.status, 0, `${label}: ${removed.stderr}`);
    assert.deepEqual(optionsOf(), optionsBefore, label);
    assert.equal(read(dir, 'AGENTS.md'), agentsBefore, label);
    if (optionsBefore.product === 'api') {
      assert.match(
        read(dir, 'AGENTS.md'),
        /仅 API 服务（端口 9000）：无前端 dev 服务，UI 实测阶段不适用。/,
        label,
      );
    }
    const result = diffJson(dir);
    assert.equal(result.summary.missing, 0, `${label}: ${JSON.stringify(result.summary)}`);
    assert.equal(result.summary.kitUpdated, 0, `${label}: ${JSON.stringify(result.summary)}`);
    assert.equal(result.summary.userModified, 0, `${label}: ${JSON.stringify(result.summary)}`);
    assert.equal(result.summary.orphan, 0, `${label}: ${JSON.stringify(result.summary)}`);
  }
});

test('diff reports user-modified, missing and orphan entries', () => {
  const dir = tmpRepo();
  install(dir);
  const modified = '.agents/commands/new-task.md';
  fs.appendFileSync(path.join(dir, modified), '\n<!-- user edit -->\n', 'utf8');
  const missing = '.agents/commands/review.md';
  fs.rmSync(path.join(dir, missing));
  const manifest = readManifest(dir);
  manifest.files['legacy/old.md'] = '0'.repeat(64);
  writeManifest(dir, manifest);
  fs.mkdirSync(path.join(dir, 'legacy'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'legacy/old.md'), 'orphan\n', 'utf8');

  const result = diffJson(dir);
  const user = itemOf(result, modified);
  assert.equal(user.kind, 'user-modified');
  assert.notEqual(user.actualHash, user.managedHash);
  assert.equal(user.kitChanged, false);
  const gone = itemOf(result, missing);
  assert.equal(gone.kind, 'missing');
  assert.equal(gone.actualHash, null);
  assert.equal(typeof gone.managedHash, 'string');
  const orphan = itemOf(result, 'legacy/old.md');
  assert.equal(orphan.kind, 'orphan');
  assert.equal(orphan.managed, true);
  assert.equal(typeof orphan.actualHash, 'string');
  assert.equal(result.summary.userModified, 1);
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.orphan, 1);
});

test('diff reports kit-updated when the current template differs from the installed hash', () => {
  const dir = tmpRepo();
  install(dir);
  const manifest = readManifest(dir);
  manifest.language = 'en';
  writeManifest(dir, manifest);

  const result = diffJson(dir);
  assert.ok(result.summary.kitUpdated > 0, 'language switch should surface template updates');
  const engine = itemOf(result, '.agents/config/engine.json');
  assert.equal(engine.kind, 'kit-updated');
  assert.equal(engine.kitChanged, true);
  assert.equal(engine.actualHash, engine.managedHash);
  assert.notEqual(engine.expectedHash, engine.managedHash);
});

test('diff JSON exposes stable fields', () => {
  const dir = tmpRepo();
  install(dir);
  const result = diffJson(dir);
  assert.equal(result.target, dir);
  assert.equal(typeof result.kitVersion, 'string');
  assert.deepEqual(result.manifest.hosts, ['trae']);
  assert.equal(result.manifest.stack, 'node');
  assert.equal(result.manifest.language, 'zh-CN');
  assert.equal(result.summary.total, result.items.length);
  const item = itemOf(result, '.agents/commands/new-task.md');
  assert.equal(typeof item.targetRel, 'string');
  assert.equal(typeof item.kind, 'string');
  assert.ok('managedHash' in item);
  assert.ok('actualHash' in item);
  assert.ok('expectedHash' in item);
  assert.equal(typeof item.category, 'string');
});

test('diff is read-only and supports --all', () => {
  const dir = tmpRepo();
  install(dir);
  const before = read(dir, '.agents/commands/new-task.md');
  const plain = run(['diff', '--target', '.'], dir);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /没有差异/);
  assert.equal(read(dir, '.agents/commands/new-task.md'), before);

  const all = run(['diff', '--target', '.', '--all'], dir);
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /未变 \.agents\/commands\/new-task\.md/);
  assert.equal(read(dir, '.agents/commands/new-task.md'), before);
});

test('status summarizes the installed surface', () => {
  const dir = tmpRepo();
  install(dir);
  const json = run(['status', '--target', '.', '--json'], dir);
  assert.equal(json.status, 0, json.stderr);
  const status = JSON.parse(json.stdout);
  assert.equal(status.manifest.stack, 'node');
  assert.equal(status.manifest.language, 'zh-CN');
  assert.deepEqual(status.manifest.hosts, ['trae']);
  assert.equal(status.summary.total, status.summary.unchanged);

  const human = run(['status', '--target', '.'], dir);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /安装状态/);
  assert.match(human.stdout, /语言=zh-CN/);
  assert.match(human.stdout, /宿主：trae/);
});

test('diff without a manifest exits 3', () => {
  const dir = tmpRepo();
  const r = run(['diff', '--target', '.'], dir);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /install/);
});

test('doctor surfaces manifest drift as advisory', () => {
  const dir = tmpRepo();
  install(dir);

  const clean = JSON.parse(run(['doctor', '--target', '.', '--json'], dir).stdout);
  assert.equal(clean.checks.some((c) => c.name === 'manifest drift'), false);

  fs.appendFileSync(path.join(dir, '.agents/commands/new-task.md'), '\nuser edit\n', 'utf8');
  const drifted = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(drifted.status, 0, drifted.stderr);
  const out = JSON.parse(drifted.stdout);
  const check = out.checks.find((c) => c.name === 'manifest drift');
  assert.ok(check, 'drift check should be present');
  assert.equal(check.ok, true);
  assert.equal(check.warn, true);
  assert.match(check.detail, /用户修改 1/);
  assert.equal(out.ok, true, 'drift is advisory, not a failure');

  const human = run(['doctor', '--target', '.'], dir);
  assert.match(human.stdout, /! manifest drift/);
});

test('diff output is localized in English', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--lang', 'en', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const diff = run(['diff', '--target', '.'], dir);
  assert.equal(diff.status, 0, diff.stderr);
  assert.match(diff.stdout, /Managed file diff:/);
  assert.match(diff.stdout, /No differences\./);
  assert.match(diff.stdout, /Total \d+: unchanged/);
});

test('diff readback recovers injected model: inherit (commandcode shells stay unchanged)', () => {
  const dir = tmpRepo();
  // --model-mode inherit：跳过探测，全角色落 inheritValue；commandcode 的壳会注入 model: inherit。
  const r = run(['install', '--agent', 'commandcode', '--lang', 'zh-CN', '--stack', 'node',
    '--model-mode', 'inherit', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(dir, '.commandcode/agents/independent-reviewer.md'), /^model: inherit$/m,
    'install should inject the inherit line into commandcode review shells');

  const result = diffJson(dir);
  const item = itemOf(result, '.commandcode/agents/independent-reviewer.md');
  assert.equal(item.kind, 'unchanged', 'injected inherit must not be reported as kit-updated');
  assert.equal(result.summary.kitUpdated, 0);
});

// manifest 可被篡改：指向 target 之外的 key 不得被读取，按损坏 manifest 处理。
test('diff rejects a manifest entry that resolves outside the target', () => {
  const dir = tmpRepo();
  install(dir);
  const rel = `../${path.basename(dir)}-victim.txt`;
  const victim = path.resolve(dir, rel);
  try {
    fs.writeFileSync(victim, 'outside\n', 'utf8');
    writeManifest(dir, { ...readManifest(dir), files: { ...readManifest(dir).files, [rel]: '0'.repeat(64) } });

    const r = run(['diff', '--target', '.', '--json'], dir);
    assert.equal(r.status, EXIT.TARGET, r.stderr);
    assert.ok(r.stderr.includes(rel), `error must name the rejected entry: ${r.stderr}`);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'outside\n');
  } finally {
    fs.rmSync(victim, { force: true });
  }
});

