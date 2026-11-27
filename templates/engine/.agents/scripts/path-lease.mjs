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
//   flow-kit run path-lease.mjs acquire --path wiki/foo.md [--owner <id>] [--ttl 30]
//   flow-kit run path-lease.mjs release --path wiki/foo.md [--owner <id>] [--force]
//   flow-kit run path-lease.mjs check   --path wiki/foo.md [--owner <id>]
//   flow-kit run path-lease.mjs list [--json]
//   flow-kit run path-lease.mjs sweep
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

// 租约键必须跟随文件实体，而不是路径拼写：反斜杠、重复分隔符、. / .. 段、符号链接，以及 NTFS 上
// 的大小写差异，都是同一文件的合法写法；只做词法清洗会让同一文件挂上多把锁（已实证四个 owner 同时
// 持有）。实体解析优先 realpath；目标不存在（租约常作用于「将写」的新文件）时解析父目录再拼回
// basename；解析到仓外或父目录也不可解时退回词法归一——租约只覆盖仓内路径。
function canonical(root, rel) {
  const lexical = String(rel).replace(/\\/g, '/').trim();
  const flat = path.posix.normalize(lexical);
  let out = flat === '.' ? '' : flat.replace(/\/+$/, '');
  let real = null;
  const abs = path.resolve(root, out);
  try {
    real = fs.realpathSync.native(abs);
  } catch {
    try {
      real = path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs));
    } catch { /* 目标与父目录都不可解：按词法归一 */ }
  }
  if (real) {
    const within = path.relative(path.resolve(root), real);
    const inside = within === '' || (!path.isAbsolute(within) && within !== '..' && !within.startsWith(`..${path.sep}`));
    if (inside) out = within;
  }
  out = out.replace(/\\/g, '/');
  // NTFS 大小写不敏感，大小写变体指向同一实体；POSIX 大小写敏感是真实语义，保留原样。
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

// 键格式从 sha1(词法) 换成 sha1(实体) 使在途的旧键租约一次性失效——租约是 30-60 分钟 TTL 的
// 短命运行态，换代可接受；导出供生产与测试共用，保证测试撒租约与线上算键同一口径。
export function leaseKey(root, rel) {
  return crypto.createHash('sha1').update(canonical(root, rel)).digest('hex');
}

function leaseFile(root, rel) {
  return path.join(leaseDir(root), `${leaseKey(root, rel)}.json`);
}

function defaultOwner() {
  return `${os.hostname()}/${process.pid}`;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function parseLease(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readLease(file) {
  return parseLease(readText(file));
}

// 认领名 → 正式名必须非覆盖发布：rename 会覆盖期间新认领者已写好的租约（Windows 的
// MOVEFILE_REPLACE_EXISTING 同样覆盖）。link 在目标已存在时以 EEXIST 失败（CAS）；不支持硬链接的
// 卷退回复制 + EXCL 建标，同样不覆盖——内容完整先前已写在认领名上。
function publishClaim(claim, file) {
  try {
    fs.linkSync(claim, file);
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    try {
      fs.copyFileSync(claim, file, fs.constants.COPYFILE_EXCL);
    } catch (copyErr) {
      if (copyErr.code === 'EEXIST') return false;
      throw copyErr;
    }
  }
  fs.rmSync(claim, { force: true });
  return true;
}

// .claiming- 是上次接管未收尾的残留（进程中断 / 归还失败）：内容可能是唯一一份在途租约，
// 扫描时既不能当有效租约也不能删——跳过并告警，交人工核对后改回 .json（照 compact-ledgers 先例）。
function claimResidue(root, file = null) {
  const prefix = file ? `${path.basename(file)}.claiming-` : '';
  try {
    return fs.readdirSync(leaseDir(root)).filter((n) => n.includes('.claiming-') && n.startsWith(prefix));
  } catch {
    return [];
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
  const body = JSON.stringify(row, null, 2);
  // 新鲜租约一律 wx 独占创建。过期接管是「认领-核对」（与 compact-ledgers 同构）：rename 到本进程
  // 私有认领名后，把认领文件与 rename 前读到的原文逐字节比对。rename 与读之间可能已有别的 owner
  // 完整接管，只凭 rename 成功就写入会搬走人家的新租约（受控交错已实证：A 返回 ok:true 后被持旧读
  // 的 B 搬空，C 在缺失窗口认领）。一致才发布自己的租约；不一致说明搬走的是更新的一份，原样归还
  // 后按真实现任 owner 认输。
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.writeFileSync(file, body, { flag: 'wx' });
      return { ok: true, lease: row };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    const snapshot = readText(file);
    const held = parseLease(snapshot);
    if (held && !expired(held, now.getTime())) {
      if (held.owner === String(owner)) return { ok: true, lease: held, renewed: false };
      return { ok: false, holder: held, lease: row };
    }
    const claim = `${file}.claiming-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
      fs.renameSync(file, claim);
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EPERM' || err.code === 'EACCES') continue;
      throw err;
    }
    const claimed = readText(claim);
    if (claimed == null) continue; // 认领文件也消失：回到完整 acquire 重试
    if (claimed !== snapshot) {
      // 期间有新接管者写入：手里是更新的一份，非覆盖归还；正式名若已被占用，交给现任 owner
      if (!publishClaim(claim, file)) fs.rmSync(claim, { force: true });
      const current = readLease(file);
      if (current && !expired(current, now.getTime())) return { ok: false, holder: current, lease: row };
      continue; // 窗口内又被放空：重试完整 acquire
    }
    fs.writeFileSync(claim, body);
    if (!publishClaim(claim, file)) {
      // 核对后、发布前正式名被新认领者写入：认输并报告真实现任 owner
      fs.rmSync(claim, { force: true });
      const current = readLease(file);
      if (current && !expired(current, now.getTime())) return { ok: false, holder: current, lease: row };
      continue;
    }
    return { ok: true, lease: row, takeover: held };
  }
  return { ok: false, holder: readLease(file), lease: row };
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
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !n.includes('.claiming-')).sort();
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
    const residue = claimResidue(root, leaseFile(root, normalizeRel(rel)));
    if (residue.length) {
      console.warn(`[path-lease] ⚠ 跳过 ${residue.length} 个 .claiming- 残留（上次接管中断，内容可能是在途租约）：${residue.join('、')}；请人工核对后改回 .json 重跑。`);
    }
    const res = check(root, { rel, owner });
    if (!res.ok) {
      console.error(`✗ ${rel} 被 ${res.holder?.owner || '?'} 持有至 ${res.holder?.expiresAt || '?'}`);
      return 1;
    }
    console.log(res.free ? `✓ ${rel} 空闲` : `✓ ${rel} 由本 owner 持有`);
    return 0;
  }

  if (cmd === 'sweep') {
    const residue = claimResidue(root);
    if (residue.length) {
      console.warn(`[path-lease] ⚠ 跳过 ${residue.length} 个 .claiming- 残留（上次接管中断，内容可能是在途租约）：${residue.join('、')}；请人工核对后改回 .json 重跑。`);
    }
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
