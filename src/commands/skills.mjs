// R3-4 技能包分发与准入：add-skill / remove-skill / skills lint。
// 技能正文落在 .agents/skills/<name>/，来源与校验和落 .agents/skills.lock.json，
// 安装记录进 manifest.skills（category: skill）与 manifest.files。
import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { HOSTS } from '../hosts/registry.mjs';
import { readManifest, writeManifest } from '../install/manifest.mjs';
import { resolveTarget, runInstall } from './install.mjs';
import {
  LOCK_REL, SKILLS_REL, emptyLock, hashSkillDir, readLock, sha256Buffer, writeLock,
} from '../skills/lock.mjs';
import { lintSkillDir, lintSkills, readEvalTaskIds } from '../skills/lint.mjs';
import { copySkillDir, resolveSkillSource } from '../skills/source.mjs';

function usageError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function requireManifest(target, t) {
  const manifest = readManifest(target);
  if (!manifest) throw usageError(t('error.noManifest'), 'NO_MANIFEST');
  manifest.files = manifest.files || {};
  return manifest;
}

function withoutFlag(args, name) {
  const flags = new Set([...(args.flags || [])].filter((f) => f !== name));
  return { ...args, flags };
}

function refreshHostSurfaces({ args, t, manifest, commandLabel }) {
  if (!manifest.hosts?.length) return;
  runInstall({
    args: withoutFlag({ ...args, target: args.target }, 'json'),
    t,
    lang: manifest.language || 'zh-CN',
    hosts: manifest.hosts,
    planHosts: manifest.hosts,
    categories: ['host'],
    commandLabel,
    stackOverride: manifest.stack,
    quiet: true,
  });
}

function hostPointerPrefixes(manifest, name) {
  const out = [];
  for (const host of manifest.hosts || []) {
    const h = HOSTS[host];
    if (!h?.skills?.dir) continue;
    const dir = h.dir === '.' ? '' : `${h.dir}/`;
    out.push(`${dir}${h.skills.dir}/${name}/`);
  }
  return out;
}

function removeEmptyDirs(dir, stopAt) {
  let cur = dir;
  while (cur.startsWith(stopAt) && cur !== stopAt) {
    try {
      if (fs.readdirSync(cur).length) break;
      fs.rmdirSync(cur);
    } catch {
      break;
    }
    cur = path.dirname(cur);
  }
}

function emitResult(args, payload, human) {
  if (flag(args, 'json')) console.log(JSON.stringify(payload, null, 2));
  else console.log(human);
}

export function addSkillCommand({ args, t, lang }) {
  const target = resolveTarget(args);
  const manifest = requireManifest(target, t);
  const spec = args._.slice(1)[0];
  const source = resolveSkillSource(spec, {
    allowNetwork: flag(args, 'allow-network'),
    subdir: args.subdir || null,
    ref: args.ref || null,
    name: args.name || null,
  });
  try {
    const name = source.name;
    const dest = path.join(target, SKILLS_REL, name);
    const lock = readLock(target);
    const exists = fs.existsSync(dest);
    const update = flag(args, 'update');
    const force = flag(args, 'force');
    if (exists && !update && !force) {
      throw usageError(`技能已存在：${name}（升级用 --update，覆盖用户改动用 --force）`, 'SKILL_EXISTS');
    }
    if (update && !lock.skills?.[name]) {
      throw usageError(`--update 只受理 lockfile 中已登记的技能：${name}`, 'SKILL_NOT_FOUND');
    }
    if (exists) fs.rmSync(dest, { recursive: true, force: true });
    copySkillDir(source.dir, dest);

    const lint = lintSkillDir(dest, { expectName: name, evalTaskIds: readEvalTaskIds(target) });
    if (!lint.ok) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw usageError(`技能未过准入检查：\n- ${lint.errors.join('\n- ')}`, 'SKILL_LINT');
    }

    const { files, checksum } = hashSkillDir(dest);
    const installedAt = new Date().toISOString();
    const entry = {
      source: { type: source.type, spec: source.spec, resolved: source.resolved },
      version: source.version,
      checksum,
      installedAt,
      files,
    };

    if (flag(args, 'dry-run')) {
      emitResult(args, {
        command: 'add-skill', dryRun: true, name, source: entry.source, version: source.version, checksum, files: Object.keys(files).length,
      }, `[dry-run] 将安装技能 ${name}（${source.type} ${source.resolved}，${Object.keys(files).length} 个文件）`);
      return 0;
    }

    const lockNext = lock.skills ? lock : emptyLock();
    lockNext.skills[name] = entry;

    for (const [rel, hash] of Object.entries(files)) {
      manifest.files[`${SKILLS_REL}/${name}/${rel}`] = hash;
    }
    manifest.skills = { ...(manifest.skills || {}), [name]: entry };
    writeManifest(target, manifest);

    refreshHostSurfaces({ args: { ...args, target }, t, manifest: readManifest(target) || manifest, commandLabel: 'add-skill' });
    writeLock(target, lockNext);

    emitResult(args, {
      command: 'add-skill',
      target,
      name,
      source: entry.source,
      version: entry.version,
      checksum,
      files: Object.keys(files).length,
      lockfile: path.join(target, LOCK_REL),
      updated: exists,
    }, `✅ 已${exists ? '更新' : '安装'}技能 ${name}（${source.type} ${source.resolved}，${Object.keys(files).length} 个文件，校验和 ${checksum.slice(0, 12)}…）`);
    return 0;
  } finally {
    source.cleanup();
  }
}

export function removeSkillCommand({ args, t }) {
  const target = resolveTarget(args);
  const manifest = requireManifest(target, t);
  const name = args._.slice(1)[0];
  if (!name) throw usageError('remove-skill 缺少技能名', 'MISSING_ARG');
  const lock = readLock(target);
  const entry = lock.skills?.[name] || manifest.skills?.[name];
  if (!entry) throw usageError(`技能未登记：${name}`, 'SKILL_NOT_FOUND');

  const skillRels = Object.keys(entry.files || {}).map((rel) => `${SKILLS_REL}/${name}/${rel}`);
  const prefixes = hostPointerPrefixes(manifest, name);
  const pointerRels = Object.keys(manifest.files || {}).filter((rel) => prefixes.some((p) => rel.startsWith(p)));
  const rels = [...new Set([...skillRels, ...pointerRels])];

  const modified = [];
  for (const rel of rels) {
    const abs = path.join(target, rel);
    if (!fs.existsSync(abs)) continue;
    const expected = manifest.files?.[rel];
    if (expected && sha256Buffer(fs.readFileSync(abs)) !== expected) modified.push(rel);
  }
  if (modified.length && !flag(args, 'force')) {
    throw usageError(`以下文件已被用户改动，拒绝删除（--force 覆盖）：\n- ${modified.join('\n- ')}`, 'SKILL_TAMPERED');
  }

  if (flag(args, 'dry-run')) {
    emitResult(args, { command: 'remove-skill', dryRun: true, name, files: rels },
      `[dry-run] 将移除技能 ${name}（${rels.length} 个文件，其中用户改动 ${modified.length}）`);
    return 0;
  }

  for (const rel of rels) {
    const abs = path.join(target, rel);
    if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
    delete manifest.files?.[rel];
  }
  // 清空技能目录与宿主指针目录（只移除空目录，不动共享索引/父目录）。
  for (const dir of [path.join(target, SKILLS_REL, name), ...prefixes.map((p) => path.join(target, p))]) {
    removeEmptyDirs(dir, path.dirname(dir));
  }
  delete manifest.skills?.[name];
  if (!Object.keys(manifest.skills || {}).length) delete manifest.skills;
  writeManifest(target, manifest);

  if (lock.skills?.[name]) {
    delete lock.skills[name];
    writeLock(target, lock);
  }
  refreshHostSurfaces({ args: { ...args, target }, t, manifest: readManifest(target) || manifest, commandLabel: 'remove-skill' });

  emitResult(args, { command: 'remove-skill', target, name, removed: rels.length, forced: modified.length > 0 },
    `✅ 已移除技能 ${name}（${rels.length} 个文件${modified.length ? `，其中 ${modified.length} 个由 --force 覆盖` : ''}）`);
  return 0;
}

export function skillsCommand({ args, t, lang }) {
  const sub = args._[1];
  if (sub !== 'lint') {
    const err = usageError(`未知 skills 子命令：${sub || '(空)'}（可用：lint）`, 'BAD_COMMAND');
    throw err;
  }
  const target = resolveTarget(args);
  requireManifest(target, t);
  const result = lintSkills(target, { verifyLock: !flag(args, 'no-verify-lock') });
  if (flag(args, 'json')) {
    console.log(JSON.stringify({
      command: 'skills lint',
      target,
      ok: result.ok,
      skills: result.skills,
      errors: result.errors,
      warnings: result.warnings,
    }, null, 2));
  } else {
    for (const w of result.warnings) console.log(`⚠️  ${w}`);
    for (const e of result.errors) console.error(`❌ ${e}`);
    console.log(result.ok
      ? `✅ 技能检查通过（${result.skills.length} 个技能${result.warnings.length ? `，${result.warnings.length} 条告警` : ''}）`
      : `❌ 技能检查失败（${result.errors.length} 条错误 / ${result.warnings.length} 条告警）`);
  }
  return result.ok ? 0 : 1;
}
