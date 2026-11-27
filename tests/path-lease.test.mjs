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

// 受控交错（已实证 ABA）：B 读到过期租约后、rename 前，A 完成一次完整接管。旧实现的 B 会把 A
// 刚发布的新租约 rename 走，A 的 ok:true 落空；认领-核对必须发现搬走的不是自己读到的快照并归还。
test('ABA：持旧读的 B 不得搬走 A 刚发布的新租约', () => {
  const root = makeTmp('path-lease-');
  const file = seedExpired(root);
  let a = null;
  let armed = true;
  const origRename = fs.renameSync;
  fs.renameSync = function patched(from, to) {
    if (armed && path.resolve(String(from)) === path.resolve(file)) {
      armed = false;
      // B 的 rename 即将执行：先让 A 完整接管（临时还原 rename 避免递归拦截 A 的认领）
      fs.renameSync = origRename;
      try { a = acquire(root, { rel: REL, owner: 'A' }); } finally { fs.renameSync = patched; }
    }
    return origRename.call(fs, from, to);
  };
  let b;
  try {
    b = acquire(root, { rel: REL, owner: 'B' });
  } finally {
    fs.renameSync = origRename;
  }
  assert.equal(a && a.ok, true, `A 的接管必须成功：${JSON.stringify(a)}`);
  assert.equal(b.ok, false, `B 不得搬走 A 的新租约：${JSON.stringify(b)}`);
  assert.equal(b.holder.owner, 'A');
  const held = check(root, { rel: REL, owner: 'A' });
  assert.equal(held.ok, true, `A 的 ok:true 必须仍然成立：${JSON.stringify(held)}`);
  assert.equal(held.holder.owner, 'A');
});

// 同一交错窗口里 C 已认领：B 核对发现搬走的是 A 的新租约，但正式名已被 C 占用——非覆盖归还
// 不得回滚 C，B 认输并报告真实现任 owner。
test('ABA 变体：窗口内 C 已认领时 B 认输并报告真实现任 owner', () => {
  const root = makeTmp('path-lease-');
  const file = seedExpired(root);
  let a = null;
  let c = null;
  let armed = true;
  const origRename = fs.renameSync;
  fs.renameSync = function patched(from, to) {
    if (!armed || path.resolve(String(from)) !== path.resolve(file)) return origRename.call(fs, from, to);
    armed = false;
    fs.renameSync = origRename;
    try { a = acquire(root, { rel: REL, owner: 'A' }); } finally { fs.renameSync = patched; }
    const result = origRename.call(fs, from, to); // B 的 rename 搬走 A 的新租约
    fs.renameSync = origRename;
    try { c = acquire(root, { rel: REL, owner: 'C' }); } finally { fs.renameSync = patched; }
    return result;
  };
  let b;
  try {
    b = acquire(root, { rel: REL, owner: 'B' });
  } finally {
    fs.renameSync = origRename;
  }
  assert.equal(a && a.ok, true, `A 的接管必须成功：${JSON.stringify(a)}`);
  assert.equal(c && c.ok, true, `C 应在缺失窗口认领成功：${JSON.stringify(c)}`);
  assert.equal(b.ok, false, `B 必须认输：${JSON.stringify(b)}`);
  assert.equal(b.holder.owner, 'C', `必须报告真实现任 owner：${JSON.stringify(b)}`);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).owner, 'C');
  assert.ok(!fs.readdirSync(path.dirname(file)).some((n) => n.includes('.claiming-')), 'B 不得留下认领残留');
});

// 读到半写/损坏文件的接管者（readLease 返回 null）同样持有旧读：rename 前若 A 已完整接管，
// 旧实现因「held 为空」跳过归还、直接销毁 A 的新租约；认领-核对按原文比对必须识别并归还。
test('旧读解析失败的接管者不得销毁 A 刚发布的新租约', () => {
  const root = makeTmp('path-lease-');
  const file = path.join(leaseDir(root), leaseKey(root, REL) + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ''); // 半写窗口：文件在、内容还不成 JSON
  let a = null;
  let armed = true;
  const origRename = fs.renameSync;
  fs.renameSync = function patched(from, to) {
    if (armed && path.resolve(String(from)) === path.resolve(file)) {
      armed = false;
      fs.renameSync = origRename;
      try { a = acquire(root, { rel: REL, owner: 'A' }); } finally { fs.renameSync = patched; }
    }
    return origRename.call(fs, from, to);
  };
  let b;
  try {
    b = acquire(root, { rel: REL, owner: 'B' });
  } finally {
    fs.renameSync = origRename;
  }
  assert.equal(a && a.ok, true, `A 的接管必须成功：${JSON.stringify(a)}`);
  assert.equal(b.ok, false, `B 不得销毁 A 的新租约：${JSON.stringify(b)}`);
  assert.equal(b.holder.owner, 'A');
  const held = check(root, { rel: REL, owner: 'A' });
  assert.equal(held.ok, true, `A 的 ok:true 必须仍然成立：${JSON.stringify(held)}`);
  assert.equal(held.holder.owner, 'A');
});
