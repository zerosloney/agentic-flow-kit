// 技能准入检查（R3-4）：frontmatter 必填、name 唯一且与目录一致、描述预算、
// 触发词冲突、evalTasks 引用存在、lockfile 漂移。
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, splitFrontmatter } from '../install/frontmatter.mjs';
import { SKILLS_REL, diffAgainstLock, readLock } from './lock.mjs';

export const DESCRIPTION_BUDGET = 300;
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function readEvalTaskIds(target) {
  const file = path.join(target, '.agents', 'evals', 'tasks.tsv');
  try {
    return new Set(
      fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.split('\t')[0].trim())
        .filter((id) => id && id !== 'task'),
    );
  } catch {
    return null; // 无 tasks.tsv：不校验 evalTasks 引用
  }
}

function splitList(value) {
  return String(value || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function lintSkillDir(dir, { expectName, evalTaskIds = null } = {}) {
  const errors = [];
  const warnings = [];
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) {
    return { ok: false, errors: ['缺少 SKILL.md'], warnings, meta: {} };
  }
  const text = fs.readFileSync(file, 'utf8');
  const { has, body } = splitFrontmatter(text);
  if (!has) {
    return { ok: false, errors: ['SKILL.md 缺少 frontmatter'], warnings, meta: {} };
  }
  const meta = parseFrontmatter(text);
  if (!meta.name) errors.push('frontmatter 缺少 name');
  else if (!SKILL_NAME_RE.test(meta.name)) errors.push(`name 须为 kebab-case：${meta.name}`);
  if (expectName && meta.name && meta.name !== expectName) {
    errors.push(`name「${meta.name}」与目录「${expectName}」不一致`);
  }
  if (!meta.description) errors.push('frontmatter 缺少 description');
  else if (meta.description.length > DESCRIPTION_BUDGET) {
    errors.push(`description 超出预算 ${DESCRIPTION_BUDGET} 字符（现 ${meta.description.length}）`);
  }
  if (!String(body || '').trim()) warnings.push('SKILL.md 正文为空');
  if (meta.evalTasks && evalTaskIds) {
    for (const id of splitList(meta.evalTasks)) {
      if (!evalTaskIds.has(id)) errors.push(`evalTasks 引用不存在的任务「${id}」`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, meta };
}

export function lintSkills(target, { skillsRoot = SKILLS_REL, verifyLock = true } = {}) {
  const errors = [];
  const warnings = [];
  const skills = [];
  const byName = new Map();
  const byTrigger = new Map();
  const root = path.join(target, skillsRoot);
  const lock = verifyLock ? readLock(target) : null;

  if (!fs.existsSync(root)) {
    return { ok: false, errors: [`技能目录不存在：${skillsRoot}`], warnings, skills };
  }

  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
  const evalTaskIds = readEvalTaskIds(target);

  for (const dirName of dirs) {
    const rel = `${skillsRoot}/${dirName}`;
    const res = lintSkillDir(path.join(root, dirName), { expectName: dirName, evalTaskIds });
    for (const e of res.errors) errors.push(`${rel}: ${e}`);
    for (const w of res.warnings) warnings.push(`${rel}: ${w}`);
    const name = res.meta.name || dirName;
    if (byName.has(name)) errors.push(`${rel}: name「${name}」与 ${byName.get(name)} 重复`);
    else byName.set(name, rel);

    for (const trigger of splitList(res.meta.triggers)) {
      if (byTrigger.has(trigger)) {
        errors.push(`${rel}: 触发词「${trigger}」与 ${byTrigger.get(trigger)} 冲突`);
      } else byTrigger.set(trigger, rel);
    }

    if (verifyLock) {
      const entry = lock.skills?.[dirName];
      if (!entry) warnings.push(`${rel}: 未登记 lockfile（内置或手工技能，不校验完整性）`);
      else {
        for (const p of diffAgainstLock(target, dirName, entry)) {
          errors.push(`${rel}/${p.rel}: 与 lockfile 不一致（${p.reason}）`);
        }
      }
    }

    skills.push({ name, dir: rel, description: res.meta.description || '' });
  }

  return { ok: errors.length === 0, errors, warnings, skills };
}
