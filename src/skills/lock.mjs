// 技能包 lockfile：来源 / 版本 / 校验和 / 逐文件哈希。
// 单源约定：`.agents/skills.lock.json`（schema: schemas/skills-lock.schema.json）。
// 校验和是对「排序后的 <相对路径>\\0<文件sha256>\\n」再取 sha256，与平台路径分隔符无关。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const LOCK_REL = '.agents/skills.lock.json';
export const LOCK_VERSION = 1;
export const SKILLS_REL = '.agents/skills';

const IGNORED_DIRS = new Set(['node_modules', '.git']);

export function emptyLock() {
  return { version: LOCK_VERSION, skills: {} };
}

export function readLock(target) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(target, LOCK_REL), 'utf8'));
    return lock && typeof lock === 'object' && lock.skills ? lock : emptyLock();
  } catch {
    return emptyLock();
  }
}

export function writeLock(target, lock) {
  const file = path.join(target, LOCK_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

export function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function listSkillFiles(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory() && IGNORED_DIRS.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      listSkillFiles(abs, base, out);
    } else if (ent.isFile()) {
      out.push(path.relative(base, abs).replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

export function hashSkillDir(dir) {
  const files = {};
  for (const rel of listSkillFiles(dir)) {
    files[rel] = sha256Buffer(fs.readFileSync(path.join(dir, rel)));
  }
  return { files, checksum: checksumOf(files) };
}

export function checksumOf(files) {
  const lines = Object.keys(files).sort().map((rel) => `${rel}\0${files[rel]}\n`).join('');
  return sha256Buffer(Buffer.from(lines, 'utf8'));
}

// 安装后的漂移检查：返回与 lock 不一致的条目（缺文件 / 哈希变了 / 多出文件）。
export function diffAgainstLock(target, name, entry) {
  const dir = path.join(target, SKILLS_REL, name);
  const problems = [];
  const locked = entry?.files || {};
  for (const [rel, hash] of Object.entries(locked)) {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) {
      problems.push({ rel, reason: 'missing' });
      continue;
    }
    if (sha256Buffer(fs.readFileSync(abs)) !== hash) problems.push({ rel, reason: 'modified' });
  }
  const extra = listSkillFiles(dir).filter((rel) => !(rel in locked));
  for (const rel of extra) problems.push({ rel, reason: 'extra' });
  return problems;
}
