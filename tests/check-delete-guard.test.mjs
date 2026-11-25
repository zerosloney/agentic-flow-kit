// check-delete-guard.mjs 配置驱动改造的回归：扫描范围与命中口径由项目级
// .agents/hooks/delete-guard.json 声明（dir/ext/call/ignore）——未配置 → SKIP 不拦道
// （--update 也不得改写登记），配置坏 → exit 2 fail-loud；比对 / 登记 / --update 语义不变。
// 夹具一律中性名（backend/acme/Acme.*），不含任何真实项目名。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'check-delete-guard.mjs');
const CONFIG_REL = path.join('.agents', 'hooks', 'delete-guard.json');
const ALLOWLIST_REL = path.join('.agents', 'hooks', 'delete-guard-allowlist.txt');

function run(root, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
    encoding: 'utf8',
  });
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function writeConfig(root, cfg) {
  writeFile(root, CONFIG_REL, JSON.stringify(cfg, null, 2) + '\n');
}

function readAllowlist(root) {
  return fs.readFileSync(path.join(root, ALLOWLIST_REL), 'utf8');
}

test('未配置：SKIP exit 0；带 --update 也只打印 SKIP，不改写登记文件', () => {
  const root = makeTmp();
  writeFile(root, ALLOWLIST_REL, 'Acme.Application/Services/Foo.cs 1\n');
  const before = readAllowlist(root);

  const plain = run(root);
  assert.equal(plain.status, 0);
  assert.ok(plain.stdout.includes('SKIP: 删除拦截门禁未配置扫描目录（.agents/hooks/delete-guard.json）'));

  const update = run(root, ['--update']);
  assert.equal(update.status, 0);
  assert.ok(update.stdout.includes('SKIP'));
  assert.equal(readAllowlist(root), before);
});

test('已配置且与登记一致：exit 0，stdout 含「通过」', () => {
  const root = makeTmp();
  writeFile(root, 'backend/acme/Acme.Application/Services/Foo.cs', 'var x = _repo.Remove(item);\nvar ok = 1;\n');
  writeConfig(root, { scan: [{ dir: 'backend/acme/Acme.Application' }] });
  writeFile(root, ALLOWLIST_REL, 'Acme.Application/Services/Foo.cs 1\n');

  const r = run(root);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('删除拦截门禁通过'));
});

test('新增一处删除调用未登记：exit 1，stderr 含「< 」差异行与整改提示', () => {
  const root = makeTmp();
  writeFile(root, 'backend/acme/Acme.Application/Services/Foo.cs', '_repo.Remove(item);\n');
  writeFile(root, 'backend/acme/Acme.Application/Services/Bar.cs', '_repo.Remove(item);\n_cache.Remove(k);\n');
  writeConfig(root, { scan: [{ dir: 'backend/acme/Acme.Application' }] });
  writeFile(root, ALLOWLIST_REL, 'Acme.Application/Services/Foo.cs 1\n');

  const r = run(root);
  assert.equal(r.status, 1);
  const diffLine = r.stderr.split('\n').find((l) => l.startsWith('< '));
  assert.equal(diffLine, '< Acme.Application/Services/Bar.cs 1');
  assert.ok(r.stderr.includes('check-delete-guard.mjs --update'));
});

test('--update 用扫描结果覆写登记：目录基名/相对路径 计数，字典序，LF 结尾', () => {
  const root = makeTmp();
  writeFile(root, 'backend/acme/Acme.Application/Services/Zoo.cs', 'a.Remove(1);\nb.Remove(2);\n');
  writeFile(root, 'backend/acme/Acme.Application/Api/Alpha.cs', 'a.RemoveRange(1);\n');
  writeConfig(root, { scan: [{ dir: 'backend/acme/Acme.Application' }] });

  const r = run(root, ['--update']);
  assert.equal(r.status, 0);
  assert.equal(readAllowlist(root), 'Acme.Application/Api/Alpha.cs 1\nAcme.Application/Services/Zoo.cs 2\n');

  const verify = run(root);
  assert.equal(verify.status, 0);
  assert.ok(verify.stdout.includes('删除拦截门禁通过'));
});

test('自定义 ext/call/ignore 生效：扫 .java 的 .delete(，豁免 cache.delete(', () => {
  const root = makeTmp();
  writeFile(root, 'backend/acme/Acme.Domain/src/Foo.java', 'x.delete(a);\ncache.delete(k);\n');
  writeFile(root, 'backend/acme/Acme.Domain/src/Bar.cs', 'x.Remove(a);\n');
  writeConfig(root, {
    scan: [{ dir: 'backend/acme/Acme.Domain', ext: ['.java'], call: '\\.delete\\(', ignore: 'cache\\.delete\\(' }],
  });

  const r = run(root, ['--update']);
  assert.equal(r.status, 0);
  assert.equal(readAllowlist(root), 'Acme.Domain/src/Foo.java 1\n');
});

test('声明目录不存在：stderr 含「声明扫描目录不存在」，计零条，退出码由比对决定', () => {
  const root = makeTmp();
  writeConfig(root, { scan: [{ dir: 'backend/acme/Ghost' }] });
  writeFile(root, ALLOWLIST_REL, '\n');

  const r = run(root);
  assert.equal(r.status, 0);
  assert.ok(r.stderr.includes('声明扫描目录不存在：backend/acme/Ghost'));
});

test('配置坏 → exit 2：非法 JSON、scan 缺 dir、未知键、空 scan、正则非法', () => {
  const bad = (content) => {
    const root = makeTmp();
    writeFile(root, CONFIG_REL, content);
    const r = run(root);
    assert.equal(r.status, 2);
    assert.ok(r.stderr.includes('delete-guard.json'), `stderr 应指出配置文件，实际：${r.stderr}`);
    return r.stderr;
  };
  assert.ok(bad('{ not json').includes('不是合法 JSON'));
  assert.ok(bad(JSON.stringify({ scan: [{ ext: ['.cs'] }] })).includes('dir'));
  assert.ok(bad(JSON.stringify({ scan: [{ dir: 'x', foo: 1 }] })).includes('未知键'));
  assert.ok(bad(JSON.stringify({ scan: [] })).includes('空'));
  assert.ok(bad(JSON.stringify({ scan: [{ dir: 'x', call: '(' }] })).includes('正则非法'));
});
