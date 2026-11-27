import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import { acquire, check, release, leaseDir, leaseKey } from '../templates/engine/.agents/scripts/path-lease.mjs';

const REL = 'shared/wiki.md';

function seedExpired(root) {
  const file = path.join(leaseDir(root), leaseKey(root, REL) + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    path: REL,
    owner: 'crashed',
    acquiredAt: '2020-01-01T00:00:00.000Z',
    expiresAt: '2020-01-01T01:00:00.000Z',
    ttlMinutes: 60,
  }));
  return file;
}

test('有效租约不被接管，同 owner 重入与 release 语义不变', () => {
  const root = makeTmp('path-lease-');
  assert.equal(acquire(root, { rel: REL, owner: 'A' }).ok, true);
  assert.equal(acquire(root, { rel: REL, owner: 'B' }).ok, false);
  const again = acquire(root, { rel: REL, owner: 'A' });
  assert.equal(again.ok, true);
  assert.equal(again.renewed, false);
  assert.equal(release(root, { rel: REL, owner: 'B' }).ok, false);
  assert.equal(release(root, { rel: REL, owner: 'A' }).ok, true);
  assert.equal(check(root, { rel: REL, owner: 'B' }).ok, true);
});

test('过期租约接管是 CAS：同一读-写窗口内只允许一个 owner 成功', () => {
  const root = makeTmp('path-lease-');
  const file = seedExpired(root);
  let b = null;
  let inside = false;
  const origWrite = fs.writeFileSync;
  fs.writeFileSync = function patched(target, ...rest) {
    const opts = rest[1];
    const plain = !opts || !opts.flag;
    if (!inside && !b && plain && path.resolve(String(target)) === path.resolve(file)) {
      inside = true;
      try { b = acquire(root, { rel: REL, owner: 'B' }); } finally { inside = false; }
    }
    return origWrite.call(fs, target, ...rest);
  };
  let a;
  try {
    a = acquire(root, { rel: REL, owner: 'A' });
  } finally {
    fs.writeFileSync = origWrite;
  }
  const winners = [a, b].filter((r) => r && r.ok);
  assert.equal(winners.length, 1, `接管必须恰好一方成功，实际：${JSON.stringify([a, b], null, 2)}`);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).owner, winners[0].lease.owner);
});

test('两个并发接管者：租约被原子认领后恰有一方成功', () => {
  const root = makeTmp('path-lease-');
  const file = seedExpired(root);
  let b = null;
  let armed = true;
  const origRename = fs.renameSync;
  fs.renameSync = function patched(from, to) {
    const result = origRename.call(fs, from, to);
    if (armed && !b && path.resolve(String(from)) === path.resolve(file)) {
      armed = false;
      b = acquire(root, { rel: REL, owner: 'B' });
    }
    return result;
  };
  let a;
  try {
    a = acquire(root, { rel: REL, owner: 'A' });
  } finally {
    fs.renameSync = origRename;
  }
  assert.equal(b && b.ok, true, '第二个 taker 应在租约被认领的窗口内成功');
  assert.equal(a.ok, false, `认领窗口内已有人先写，A 必须认输：${JSON.stringify(a)}`);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).owner, 'B');
});

// 租约键跟随文件实体：重复分隔符与 . / .. 段是同一文件的拼写，词法折叠后必须撞上同一把锁。
test('同一文件的词法变体拼写命中同一租约', () => {
  const root = makeTmp('path-lease-');
  assert.equal(acquire(root, { rel: 'wiki/Foo.md', owner: 'A' }).ok, true);
  for (const rel of ['wiki//Foo.md', 'wiki/sub/../Foo.md']) {
    const r = acquire(root, { rel, owner: 'B' });
    assert.equal(r.ok, false, `${rel} 必须撞上 A 的租约：${JSON.stringify(r)}`);
    assert.equal(r.holder.owner, 'A');
  }
});

// NTFS 大小写不敏感：wiki/foo.md 读写的就是 wiki/Foo.md，不能各持一把锁。
test('NTFS 大小写变体拼写命中同一租约', (t) => {
  if (process.platform !== 'win32') return t.skip('NTFS-only: 大小写不敏感查找');
  const root = makeTmp('path-lease-');
  assert.equal(acquire(root, { rel: 'wiki/Foo.md', owner: 'A' }).ok, true);
  const b = acquire(root, { rel: 'wiki/foo.md', owner: 'B' });
  assert.equal(b.ok, false, `大小写变体必须撞上 A 的租约：${JSON.stringify(b)}`);
  assert.equal(b.holder.owner, 'A');
  const c = check(root, { rel: 'wiki/FOO.md', owner: 'B' });
  assert.equal(c.ok, false);
  assert.equal(c.holder.owner, 'A');
});
