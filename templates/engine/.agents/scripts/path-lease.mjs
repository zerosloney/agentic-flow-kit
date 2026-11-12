#!/usr/bin/env node
// path-lease.mjs — 共享工件的单写者租约
//
// 背景（Anthropic《The components of agent memory》的并发实证）：
//   多个 agent 同时写一张共享表，57 条合同事实只剩 41 条；一页一 agent、逐字引用则 57/57。
//
// 本脚本提供最小的本地租约：同一路径同一时间只允许一个 owner 写。
// 租约是 advisory（协作纪律），不是安全边界；文件放 `.agents/cache/leases/`（gitignore）。
//
// 用法：
//   node .agents/scripts/path-lease.mjs acquire --path wiki/foo.md [--owner <id>] [--ttl 30]
//   node .agents/scripts/path-lease.mjs release --path wiki/foo.md [--owner <id>] [--force]
//   node .agents/scripts/path-lease.mjs check   --path wiki/foo.md [--owner <id>]
//   node .agents/scripts/path-lease.mjs list [--json]
//   node .agents/scripts/path-lease.mjs sweep
//
// 退出码：acquire/check 成功 0；被他人持有 1；参数错误 2。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

export function leaseDir(root) {
  return path.join(root, '.agents', 'cache', 'leases');
}

export function normalizeRel(rel) {
  return String(rel).replace(/\\/g, '/').replace(/^\.?\//, '').trim();
}

function leaseFile(root, rel) {
  const key = crypto.createHash('sha1').update(normalizeRel(rel)).digest('hex');
  return path.join(leaseDir(root), `${key}.json`);
}

function defaultOwner() {
  return `${os.hostname()}/${process.pid}`;
}

function readLease(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function expired(lease, now = Date.now()) {
  return !lease || !Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= now;
}

export function acquire(root, { rel, owner = defaultOwner(), ttlMinutes = 30, now = new Date() } = {}) {
  const target = normalizeRel(rel);
  if (!target) throw new Error('--path 必填');
  const ttl = Math.max(1, Number(ttlMinutes) || 30);
  const file = leaseFile(root, target);
  const row = {
    path: target,
    owner: String(owner),
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 60000).toISOString(),
    ttlMinutes: ttl,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify(row, null, 2), { flag: 'wx' });
    return { ok: true, lease: row };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const held = readLease(file);
  if (expired(held, now.getTime())) {
    fs.writeFileSync(file, JSON.stringify(row, null, 2));
    return { ok: true, lease: row, takeover: held };
  }
  if (held && held.owner === String(owner)) return { ok: true, lease: held, renewed: false };
  return { ok: false, holder: held, lease: row };
}

export function release(root, { rel, owner = defaultOwner(), force = false } = {}) {
  const target = normalizeRel(rel);
  const file = leaseFile(root, target);
  const held = readLease(file);
  if (!held) return { ok: true, missing: true };
  if (!force && held.owner !== String(owner)) return { ok: false, holder: held };
  fs.rmSync(file, { force: true });
  return { ok: true, released: held };
}

export function check(root, { rel, owner = defaultOwner(), now = Date.now() } = {}) {
  const target = normalizeRel(rel);
  const held = readLease(leaseFile(root, target));
  if (!held || expired(held, now)) return { ok: true, free: true, holder: held || null };
  if (held.owner === String(owner)) return { ok: true, owned: true, holder: held };
  return { ok: false, holder: held };
}

export function listLeases(root) {
  const dir = leaseDir(root);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return names.map((n) => readLease(path.join(dir, n))).filter(Boolean);
}

export function sweep(root, { now = Date.now() } = {}) {
  const removed = [];
  for (const lease of listLeases(root)) {
    if (expired(lease, now)) {
      fs.rmSync(leaseFile(root, lease.path), { force: true });
      removed.push(lease.path);
    }
  }
  return removed;
}

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'list';
  const root = path.resolve(argOf(argv, 'root', process.cwd()));
  const rel = argOf(argv, 'path');
  const owner = argOf(argv, 'owner', defaultOwner());

  if (cmd === 'acquire') {
    const res = acquire(root, { rel, owner, ttlMinutes: argOf(argv, 'ttl', 30) });
    if (!res.ok) {
      console.error(`✗ ${rel} 被 ${res.holder?.owner || '?'} 持有至 ${res.holder?.expiresAt || '?'}`);
      return 1;
    }
    console.log(`✓ lease ${rel} owner=${res.lease.owner} until=${res.lease.expiresAt}${res.takeover ? ' (takeover)' : ''}`);
    return 0;
  }

  if (cmd === 'release') {
    const res = release(root, { rel, owner, force: argv.includes('--force') });
    if (!res.ok) {
      console.error(`✗ ${rel} 由 ${res.holder?.owner || '?'} 持有；--force 可强拆`);
      return 1;
    }
    console.log(res.missing ? `- ${rel} 无租约` : `✓ released ${rel}`);
    return 0;
  }

  if (cmd === 'check') {
    const res = check(root, { rel, owner });
    if (!res.ok) {
      console.error(`✗ ${rel} 被 ${res.holder?.owner || '?'} 持有至 ${res.holder?.expiresAt || '?'}`);
      return 1;
    }
    console.log(res.free ? `✓ ${rel} 空闲` : `✓ ${rel} 由本 owner 持有`);
    return 0;
  }

  if (cmd === 'sweep') {
    const removed = sweep(root);
    console.log(`swept ${removed.length}${removed.length ? `: ${removed.join(', ')}` : ''}`);
    return 0;
  }

  const leases = listLeases(root);
  if (argv.includes('--json')) console.log(JSON.stringify(leases, null, 2));
  else for (const l of leases) console.log(`${l.path}\t${l.owner}\t${l.expiresAt}`);
  return 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('path-lease.mjs');
if (isMain) process.exit(main());
