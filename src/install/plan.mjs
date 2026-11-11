import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS } from '../hosts/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(HERE, '..', '..');
export const TEMPLATES = path.join(KIT_ROOT, 'templates');
export const LOCALES = path.join(KIT_ROOT, 'locales');

export function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, ent.name);
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(childAbs, childRel);
      else if (ent.isFile()) out.push(childRel);
    }
  };
  walk(dir, '');
  return out;
}

function localeOverride(lang, targetRel) {
  const p = path.join(LOCALES, lang, 'overrides', targetRel);
  return fs.existsSync(p) ? p : null;
}

// 构建安装计划。targetRel 使用 / 分隔；profile 覆盖 engine，宿主只写自己的点目录。
export function buildPlan({ target, hosts, lang, stack, projectName, categories }) {
  const plan = [];
  const push = (srcAbs, targetRel, category, priority = 10, kind = 'file') => {
    plan.push({ srcAbs, targetRel: targetRel.replace(/\\/g, '/'), category, priority, kind });
  };

  // 1) 引擎核心
  for (const rel of listFiles(path.join(TEMPLATES, 'engine'))) {
    push(path.join(TEMPLATES, 'engine', rel), rel, 'engine', 10);
  }

  // 2) 项目 profile（栈相关配置与 AGENTS.md）
  for (const rel of listFiles(path.join(TEMPLATES, 'profiles', stack))) {
    push(path.join(TEMPLATES, 'profiles', stack, rel), rel, 'profile', 20);
  }

  // 3) 宿主适配层
  for (const host of hosts) {
    const h = HOSTS[host];
    if (!h) continue;
    for (const rel of listFiles(path.join(TEMPLATES, 'hosts', host))) {
      const targetRel = host === 'claude' && rel === 'CLAUDE.md' ? 'CLAUDE.md' : `${h.dir}/${rel}`;
      push(path.join(TEMPLATES, 'hosts', host, rel), targetRel, 'host', 30);
    }
  }

  // 4) 数据资产脚手架（空目录由 scaffold 中的 .gitkeep 保证）
  for (const rel of listFiles(path.join(TEMPLATES, 'scaffold'))) {
    push(path.join(TEMPLATES, 'scaffold', rel), rel, 'scaffold', 10);
  }

  // 5) git 门禁与合并策略
  for (const rel of listFiles(path.join(TEMPLATES, 'git'))) {
    if (rel === '.gitattributes') push(path.join(TEMPLATES, 'git', rel), '.gitattributes', 'git', 40, 'merge-gitattributes');
    else if (rel === '.gitignore.engine') push(path.join(TEMPLATES, 'git', rel), '.gitignore', 'git', 40, 'merge-gitignore');
    else push(path.join(TEMPLATES, 'git', rel), rel, 'git', 40);
  }

  // 6) 语言包覆盖（按目标路径镜像）
  for (const entry of plan) {
    const override = localeOverride(lang, entry.targetRel);
    if (override) entry.srcAbs = override;
  }

  // 同目标去重：高优先级覆盖低优先级
  const byTarget = new Map();
  for (const entry of plan.sort((a, b) => a.priority - b.priority)) byTarget.set(entry.targetRel, entry);
  let deduped = [...byTarget.values()];
  if (categories && categories.length) deduped = deduped.filter((e) => categories.includes(e.category));

  return { target, hosts, lang, stack, projectName, entries: deduped };
}
