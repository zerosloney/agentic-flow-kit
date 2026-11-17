import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// session-context.cjs CLI 契约（BACKLOG #18）：SessionStart 载荷 → 只注入指针式路由令。
// 零写操作、任何路径 exit 0、非 flow-kit 仓零输出；用户开关只认显式 false；语言随 manifest.language。
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'session-context.cjs');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo(language = 'zh-CN') {
  const dir = makeTmp('flow-kit-session-context-');
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  // root 探测锚：适配器向上找 .agents/install-manifest.json（同 usage-collect.cjs）
  fs.writeFileSync(path.join(dir, '.agents', 'install-manifest.json'), JSON.stringify({ language }));
  return dir;
}

function run(payload, cwd, env = {}) {
  return spawnSync(process.execPath, [ADAPTER], {
    cwd,
    encoding: 'utf8',
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, ...env },
  });
}

// 相对路径 + 全文指纹：证明本腿零写操作（不新建文件、不改既有文件）
function tree(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = path.join(abs, entry.name);
      const relNext = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next, relNext);
      else out.push(`${relNext}\u0000${fs.readFileSync(next, 'utf8')}`);
    }
  };
  walk(dir, '');
  return out.sort().join('\n');
}

test('injects a pointer-only routing directive and writes nothing', () => {
  const dir = tmpRepo();
  const before = tree(dir);
  const r = run({
    session_id: 's1',
    cwd: dir,
    hook_event_name: 'SessionStart',
    source: 'startup',
    transcript_path: path.join(dir, 'transcript.jsonl'),
  }, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /\.agents\/commands\/new-task\.md/);
  assert.match(r.stdout, /\.agents\/skills\/session-resume\/SKILL\.md/);
  assert.match(r.stdout, /session-context\.local\.json/);
  // 只指路不复制规则：分级表/红线正文不得搬进注入面，且远低于宿主 10000 字符上限
  assert.ok(!/L1|L2|L3/.test(r.stdout), r.stdout);
  assert.ok(r.stdout.length < 1000, `injection too long: ${r.stdout.length}`);
  assert.equal(tree(dir), before, 'adapter must not write anything');
});

test('injects for every documented session source', () => {
  const dir = tmpRepo();
  let first = null;
  for (const source of ['startup', 'resume', 'clear', 'compact', 'fork']) {
    const r = run({ cwd: dir, hook_event_name: 'SessionStart', source }, dir);
    assert.equal(r.status, 0, `${source}: ${r.stderr}`);
    assert.match(r.stdout, /new-task\.md/, source);
    first = first ?? r.stdout;
    assert.equal(r.stdout, first, `${source}: injection must not vary by source`);
  }
});

test('the user off switch only honors an explicit false', () => {
  const dir = tmpRepo();
  const local = path.join(dir, '.agents', 'config', 'session-context.local.json');
  const payload = { cwd: dir, source: 'resume' };
  fs.writeFileSync(local, '{"enabled":false}');
  let r = run(payload, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  // 缺文件 / 坏 JSON / 非 false 值一律视为开：坏配置不静默改变注入行为
  for (const text of ['{"enabled":true}', '{}', '{"enabled":"false"}', '{not json']) {
    fs.writeFileSync(local, text);
    r = run(payload, dir);
    assert.equal(r.status, 0, text);
    assert.match(r.stdout, /new-task\.md/, text);
  }
  fs.rmSync(local);
  assert.match(run(payload, dir).stdout, /new-task\.md/);
});

test('non-flow-kit roots stay silent; malformed stdin falls back to cwd', () => {
  const dir = tmpRepo();
  const plain = makeTmp('flow-kit-session-context-plain-');
  const r = run({ cwd: plain, source: 'startup' }, plain);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  // 坏载荷 / 空载荷：本腿不依赖载荷字段，按 cwd 向上找锚
  for (const input of ['{not json', '']) {
    const fallback = run(input, dir);
    assert.equal(fallback.status, 0, input);
    assert.match(fallback.stdout, /new-task\.md/, input);
  }
  const nested = path.join(dir, 'src', 'deep');
  fs.mkdirSync(nested, { recursive: true });
  assert.match(run({}, nested).stdout, /new-task\.md/);
});

test('injection language follows manifest.language with zh-CN fallback', () => {
  const en = tmpRepo('en');
  const r = run({ cwd: en, source: 'clear' }, en);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /session entry routing directive/);
  assert.ok(!/[\u4e00-\u9fff]/.test(r.stdout), r.stdout);
  const unknown = tmpRepo('fr');
  assert.match(run({ cwd: unknown }, unknown).stdout, /会话入口路由令/);
});

test('flow-kit hook session-context resolves the packaged adapter and anchors the root', () => {
  const dir = tmpRepo('en');
  const elsewhere = makeTmp('flow-kit-session-context-cwd-');
  const r = spawnSync(process.execPath, [BIN, 'hook', 'session-context'], {
    cwd: elsewhere,
    encoding: 'utf8',
    input: JSON.stringify({ cwd: elsewhere, source: 'fork' }),
    env: { ...process.env, FLOW_KIT_TEST: '1', FLOW_KIT_PROJECT_ROOT: dir },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /session entry routing directive/);
  // 入口 --list 须列出该腿（.cjs 与 .mjs 同表），否则宿主接线指向不可发现的命令
  const list = spawnSync(process.execPath, [BIN, 'hook', '--list'], { cwd: dir, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.ok(list.stdout.split(/\r?\n/).includes('session-context'), list.stdout);
});