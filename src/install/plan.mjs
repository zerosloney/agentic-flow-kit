import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS, hostTargetRel, isAgentTemplate, modelRoleForAgent } from '../hosts/registry.mjs';
import { makeT } from '../i18n.mjs';
import { mergeMcpFile, mergeMcpInto, readMcpServers } from './mcp.mjs';
import { readToolPolicy } from './tool-policy.mjs';
import {
  DEVCONTAINER_DOCKERFILE_REL,
  DEVCONTAINER_JSON_REL,
  renderDevcontainerDockerfile,
  renderDevcontainerJson,
} from './devcontainer.mjs';
import { HOOKS_SPEC_REL, mergeHooksIntoRoot, parseHookSpec } from './hooks.mjs';
import { compilePermissions, mergePermissionsIntoRoot, parsePermissionSpec } from './permissions.mjs';
import { readPlanEntry } from './apply.mjs';
import { parseFrontmatter, yamlScalar } from './frontmatter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(HERE, '..', '..');
export const TEMPLATES = path.join(KIT_ROOT, 'templates');
export const LOCALES = path.join(KIT_ROOT, 'locales');
// host-meta 存放生成技能指针/索引用的模板，不参与 templates/hosts/<host> 的静态枚举
export const HOST_META = path.join(TEMPLATES, 'host-meta');

// 模板目录可能被本机运行过脚本（评测凭证、缓存、本地模型角色）。这些是运行态，
// 既不该进包，也不该被安装到目标项目——尤其 evals/results.jsonl 是行为评测凭证，
// 若随模板出厂，会让每个新装项目“凭空”获得一张当前内容的合格凭证。
export const RUNTIME_DIRS = new Set(['.agents/cache', '.agents/tmp', '.agents/tools']);
// R5-1b：运行时实现随包分发，不再写入目标项目；只保留声明式配置（gates.json 等）。
export const RUNTIME_ENGINE_PREFIXES = ['.agents/scripts/', '.agents/tests/'];

export function isRuntimeEnginePath(rel) {
  const p = String(rel).replace(/\\/g, '/');
  if (RUNTIME_ENGINE_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
  if (p.startsWith('.agents/hooks/') && /\.(cjs|mjs)$/i.test(p)) return true;
  return false;
}

export const RUNTIME_FILES = new Set([
  '.agents/verifications.jsonl',
  '.agents/judgments.jsonl',
  '.agents/evals/results.jsonl',
  '.agents/config/model-roles.local.json',
  '.agents/notes/runtime-env.local.md',
]);

export function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, ent.name);
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (RUNTIME_DIRS.has(childRel)) continue;
        walk(childAbs, childRel);
      } else if (ent.isFile() && !RUNTIME_FILES.has(childRel)) {
        out.push(childRel);
      }
    }
  };
  walk(dir, '');
  return out;
}

function localeOverride(lang, targetRel) {
  const p = path.join(LOCALES, lang, 'overrides', targetRel);
  return fs.existsSync(p) ? p : null;
}

function applyLocaleOverrides(lang, entries) {
  for (const entry of entries) {
    const override = localeOverride(lang, entry.targetRel);
    if (!override) continue;
    // 保留模板来源：explain 需要同时报告静态模板与语言覆盖。
    if (entry.srcAbs && !entry.templateAbs) entry.templateAbs = entry.srcAbs;
    entry.localeOverride = override;
    entry.srcAbs = override;
    delete entry.getText;
  }
  return entries;
}

export function dedupeEntries(entries) {
  const byTarget = new Map();
  for (const entry of entries.sort((a, b) => a.priority - b.priority)) byTarget.set(entry.targetRel, entry);
  return [...byTarget.values()];
}

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// 单次替换：overrides 优先，其次全局 vars；不递归扫描已插入的内容。
function fillTemplate(template, vars, overrides = {}) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (has(overrides, key)) return String(overrides[key]);
    if (has(vars, key)) return String(vars[key]);
    return m;
  });
}

function readTemplate(abs, fallback) {
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : fallback;
}

function readSkillMeta(entry) {
  let name = path.basename(path.dirname(entry.targetRel));
  let description = name;
  try {
    const fm = parseFrontmatter(fs.readFileSync(entry.srcAbs, 'utf8'));
    if (fm.name) name = fm.name;
    if (fm.description) description = fm.description;
  } catch {
    /* 源缺失时保留目录名 */
  }
  return { name, description, targetRel: entry.targetRel };
}

function buildSkillsList(skills, t) {
  if (!skills.length) return `- ${t('host.skillsIndexEmpty')}`;
  return skills
    .map((s) => t('host.skillsIndexLine', { name: s.name, description: s.description, path: s.targetRel }))
    .join('\n');
}

function addGeneratedSkillSurfaces({ plan, hosts, skillEntries, t }) {
  const skills = skillEntries.map(readSkillMeta).sort((a, b) => a.name.localeCompare(b.name));

  for (const host of hosts) {
    const h = HOSTS[host];
    if (!h?.skills) continue;
    // 外部宿主可自带技能入口模板（skillMeta）；内置宿主用包内 host-meta。
    const metaDir = h.skillMeta || path.join(HOST_META, host);

    if (h.skills.mode === 'native') {
      const template = readTemplate(path.join(metaDir, 'skill-pointer.md'), [
        '---',
        'name: {{skillName}}',
        'description: {{skillDescription}}',
        '---',
        '{{pointer}}',
        '',
      ].join('\n'));
      for (const skill of skills) {
        const overrides = {
          skillName: skill.name,
          skillDescription: yamlScalar(skill.description),
          skillPath: skill.targetRel,
          pointer: t('host.skillPointer', { path: skill.targetRel }),
        };
        plan.push({
          srcAbs: path.join(metaDir, 'skill-pointer.md'),
          targetRel: `${h.dir}/${h.skills.dir}/${skill.name}/${h.skills.file}`,
          category: 'host',
          // 生成器读取语言覆盖后的技能 frontmatter，优先于静态宿主技能回退件。
          priority: 35,
          kind: 'generated',
          getText: (vars) => fillTemplate(template, vars, overrides),
        });
      }
      continue;
    }

    // shared / index：生成一个可发现入口，不复制技能正文
    const hasCommands = Boolean(h.commands);
    const targetRel = hasCommands
      ? `${h.dir}/${h.commands.dir}/wf-skills.md`
      : `${h.dir}/SKILLS.md`;
    const templateAbs = hasCommands
      ? path.join(metaDir, 'skill-index.md')
      : path.join(HOST_META, 'SKILLS.md');
    const template = readTemplate(templateAbs, [
      '---',
      'description: {{indexDescription}}',
      '---',
      '{{skillsList}}',
      '',
    ].join('\n'));
    const overrides = {
      indexDescription: t('host.skillsIndexDescription'),
      title: t('host.skillsIndexTitle'),
      skillsList: buildSkillsList(skills, t),
    };
    plan.push({
      srcAbs: templateAbs,
      targetRel,
      category: 'host',
      priority: 25,
      kind: 'generated',
      getText: (vars) => fillTemplate(template, vars, overrides),
    });
  }
}

// 宿主 Hook / 权限接线的中性规格来自引擎模板的 gates.json（语言覆盖优先）。
// 编译器按 registry 的 hooks.events / permissions 生成宿主 schema，并以静态宿主模板为底稿；
// 没有相应能力的宿主继续使用静态模板，行为不变。
function readGatesText(lang) {
  const override = localeOverride(lang, HOOKS_SPEC_REL);
  const abs = override || path.join(TEMPLATES, 'engine', HOOKS_SPEC_REL);
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

// doctor 与安装共用同一个规格源（kit 模板 + 语言覆盖），避免“安装成功、doctor 立刻报漂移”。
export function readGatesSpecs(lang) {
  const text = readGatesText(lang);
  if (!text) return { hooks: null, permissions: null };
  return { hooks: parseHookSpec(text), permissions: parsePermissionSpec(text) };
}

function addHostConfigEntries({ plan, target, hosts, lang, stack, hardened, managedPermissions = {} }) {
  const gatesText = readGatesText(lang);
  if (!gatesText) return;
  const hookSpec = parseHookSpec(gatesText);
  const permissionSpec = parsePermissionSpec(gatesText);
  for (const host of hosts) {
    const h = HOSTS[host];
    const hookConfig = h?.hooks?.events || null;
    const permissionConfig = h?.permissions || null;
    if (!hookConfig && !permissionConfig) continue;
    const fileName = permissionConfig?.file || h?.hooks?.file;
    if (!fileName) continue;
    const compiledPermissions = permissionSpec && permissionConfig
      ? compilePermissions(permissionSpec, permissionConfig, { stack, hardened })
      : null;
    if (!(hookConfig && hookSpec?.length) && !compiledPermissions) continue;
    const rel = hostTargetRel(host, fileName);
    const baseEntry = plan.find((entry) => entry.targetRel === rel && entry.kind === 'file');
    const entry = {
      srcAbs: null,
      targetRel: rel.replace(/\\/g, '/'),
      category: 'host',
      priority: 31,
      kind: 'merge-host',
      hookSpec: hookConfig ? hookSpec : null,
      hookConfig,
      permissionSpec: compiledPermissions,
      permissionConfig,
      previousPermissions: managedPermissions[rel] || null,
      getText: (vars) => {
        const abs = path.join(target, rel);
        const exists = fs.existsSync(abs);
        const baseText = !exists && baseEntry ? readPlanEntry(baseEntry, vars) : null;
        const sourceText = exists ? fs.readFileSync(abs, 'utf8') : (baseText || '');
        let root = {};
        if (sourceText.trim()) {
          try {
            root = JSON.parse(sourceText);
          } catch {
            return null;
          }
          if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
        }
        let changed = false;
        if (hookConfig && entry.hookSpec?.length) {
          changed = mergeHooksIntoRoot(root, entry.hookSpec, hookConfig) || changed;
        }
        if (entry.permissionSpec) {
          changed = mergePermissionsIntoRoot(
            root,
            entry.permissionSpec,
            permissionConfig,
            entry.previousPermissions,
            { reset: !exists },
          ) || changed;
        }
        // Qwen 的 settings.json 同时承载 MCP：多个合并器对同一个 root 组合执行，
        // 避免同一文件在去重时丢掉其中一个托管面。
        if (entry.mcpServers) {
          changed = mergeMcpInto(root, entry.mcpServers, entry.mcpFormat).changed || changed;
        }
        if (exists && !changed) return sourceText;
        if (!exists && !sourceText.trim() && !changed) return null;
        return `${JSON.stringify(root, null, 2)}\n`;
      },
    };
    plan.push(entry);
  }
}

// 宿主 MCP 配置：同一份中性 server 列表编译到各宿主容器；getText 在渲染时读取磁盘，
// 实现“只补缺失项、保留用户 server”的幂等合并。JSON 损坏时返回 null，由 apply 跳过。
function addMcpEntries({ plan, target, hosts }) {
  const servers = readMcpServers(target);
  // 工具权限策略（R3-8）：声明无效时在这里抛 MCP_CONFIG，安装零写盘。
  // 运行时通过 FLOW_KIT_MCP_TOOL_POLICY 读同一份声明，doctor 做双向对账。
  readToolPolicy(target);
  if (!Object.keys(servers).length) return;
  for (const host of hosts) {
    const h = HOSTS[host];
    if (!h?.mcp) continue;
    const rel = h.mcp.file;
    const targetRel = rel.replace(/\\/g, '/');
    // 同一文件已经有 hook 合并条目时（Qwen settings.json），把 MCP 挂到该条目上组合执行。
    const hookEntry = plan.find((entry) => entry.kind === 'merge-host' && entry.targetRel === targetRel);
    if (hookEntry) {
      hookEntry.mcpServers = servers;
      hookEntry.mcpFormat = h.mcp.format;
      hookEntry.mcpNames = Object.keys(servers);
      continue;
    }
    // Qwen 的 settings.json 同时是静态宿主模板：文件不存在时以渲染结果打底，避免丢掉 hooks/permissions。
    const baseEntry = plan.find((entry) => entry.targetRel === rel && entry.kind !== 'merge-mcp');
    plan.push({
      srcAbs: null,
      targetRel: rel.replace(/\\/g, '/'),
      category: 'host',
      priority: 32,
      kind: 'merge-mcp',
      mcpFormat: h.mcp.format,
      mcpNames: Object.keys(servers),
      getText: (vars) => {
        const baseText = baseEntry ? readPlanEntry(baseEntry, vars) : null;
        const merged = mergeMcpFile(path.join(target, rel), servers, h.mcp.format, baseText);
        return merged ? merged.text : null;
      },
    });
  }
}

// 构建安装计划。targetRel 使用 / 分隔；profile 覆盖 engine，宿主只写自己的点目录。
// models: { [host]: { code?, judgment?, review? } }，用于注入宿主子代理 model 字段。
// surfaces: 组合式切面闭集（frontend/api/data），按声明顺序叠加在 stack 之上。
export function buildPlan({
  target, hosts, lang, stack, projectName, categories, models = null, tier = 'standard', hardened = false, mcp = true,
  surfaces = [], managedPermissions = {}, devcontainer = true,
}) {
  const t = makeT(lang);
  const plan = [];
  const push = (srcAbs, targetRel, category, priority = 10, kind = 'file', extra = {}) => {
    const entry = { srcAbs, targetRel: targetRel.replace(/\\/g, '/'), category, priority, kind, ...extra };
    plan.push(entry);
    return entry;
  };

  // 1) 引擎核心（运行时脚本/hook 实现不进项目；项目只落声明式面）
  for (const rel of listFiles(path.join(TEMPLATES, 'engine'))) {
    if (isRuntimeEnginePath(rel)) continue;
    push(path.join(TEMPLATES, 'engine', rel), rel, 'engine', 10);
  }

  // 2) 项目 profile（栈相关配置与 AGENTS.md）
  for (const rel of listFiles(path.join(TEMPLATES, 'profiles', stack))) {
    push(path.join(TEMPLATES, 'profiles', stack, rel), rel, 'profile', 20);
  }

  // 2.5) surface 叠加：同一 targetRel 由后声明的 surface 覆盖（21 + index > 20）。
  // 单 stack 安装不产生任何额外文件，保持行为不变。
  surfaces.forEach((surface, index) => {
    const dir = path.join(TEMPLATES, 'surfaces', surface);
    for (const rel of listFiles(dir)) push(path.join(dir, rel), rel, 'profile', 21 + index);
  });
  if (surfaces.length) {
    push(null, '.agents/config/profile.json', 'profile', 25, 'generated', {
      getText: (vars) => `${JSON.stringify({
        kit: 'agentic-flow-kit',
        version: vars.kitVersion || null,
        stack,
        surfaces,
        profiles: [stack, ...surfaces],
      }, null, 2)}\n`,
    });
  }

  // 3) 宿主适配层（外部宿主用定义里的 templates 目录，内置宿主用 templates/hosts/<host>）
  for (const host of hosts) {
    const h = HOSTS[host];
    if (!h) continue;
    const templatesDir = h.templates || path.join(TEMPLATES, 'hosts', host);
    const hardeningSource = h.hardening?.settings || null;
    for (const rel of listFiles(templatesDir)) {
      // 加固配置是宿主主配置的替换源，不作为独立文件安装。
      if (hardeningSource && rel === hardeningSource) continue;
      const srcAbs = (hardened && hardeningSource && rel === h.hooks?.file)
        ? path.join(templatesDir, hardeningSource)
        : path.join(templatesDir, rel);
      const entry = push(srcAbs, hostTargetRel(host, rel), 'host', 30);
      if (h.agents?.modelField && isAgentTemplate(host, rel)) {
        entry.modelRole = modelRoleForAgent(rel);
        entry.modelField = h.agents.modelField;
        entry.modelInherit = h.agents.inheritValue;
        entry.modelValue = models?.[host]?.[entry.modelRole] ?? null;
      }
    }
  }

  // 3.4) Hook / 权限接线编译（中性 gates.json -> 宿主 schema）
  addHostConfigEntries({ plan, target, hosts, lang, stack, hardened, managedPermissions });

  // 3.5) MCP 配置合并（--no-mcp 时整段跳过）
  if (mcp) addMcpEntries({ plan, target, hosts });

  // 4) 数据资产脚手架（空目录由 scaffold 中的 .gitkeep 保证）
  for (const rel of listFiles(path.join(TEMPLATES, 'scaffold'))) {
    push(path.join(TEMPLATES, 'scaffold', rel), rel, 'scaffold', 10);
  }

  // 5) git 门禁与合并策略
  for (const rel of listFiles(path.join(TEMPLATES, 'git'))) {
    // lean 档不生成 CI：小项目先跑本地钩子；standard/enterprise 才落 CI。
    if (tier === 'lean' && (rel === 'azure-pipelines.yml' || rel.startsWith('.github/'))) continue;
    if (rel === '.gitattributes') push(path.join(TEMPLATES, 'git', rel), '.gitattributes', 'git', 40, 'merge-gitattributes');
    else if (rel === '.gitignore.engine') push(path.join(TEMPLATES, 'git', rel), '.gitignore', 'git', 40, 'merge-gitignore');
    else push(path.join(TEMPLATES, 'git', rel), rel, 'git', 40);
  }

  // 6) 开发容器（R3-8 沙箱面）：devcontainer.json + Dockerfile，按栈选官方基础镜像。
  // 与 CI 一样属于「环境交付面」：--no-devcontainer 关闭，upgrade 按 manifest 重放。
  if (devcontainer) {
    push(null, DEVCONTAINER_JSON_REL, 'devcontainer', 41, 'generated', {
      getText: (vars) => renderDevcontainerJson({
        projectName: vars.projectName,
        stack,
        apiPort: vars.apiPort,
        webPort: vars.webPort,
      }),
    });
    push(null, DEVCONTAINER_DOCKERFILE_REL, 'devcontainer', 41, 'generated', {
      getText: (vars) => renderDevcontainerDockerfile({ stack, kitVersion: vars.kitVersion }),
    });
  }

  // 7) 语言包覆盖（按目标路径镜像）
  applyLocaleOverrides(lang, plan);
  let deduped = dedupeEntries(plan);

  // 8) 从覆盖后的 .agents/skills/<name>/SKILL.md 生成宿主技能面
  const skillEntries = deduped.filter((e) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(e.targetRel));
  // R3-4：add-skill 装到目标磁盘的外部技能不在包模板 plan 内，但同样需要宿主指针/索引。
  // 只读磁盘取元数据，不把技能正文纳入安装计划（正文归 lockfile + manifest.skills 管）。
  try {
    const skillsDir = path.join(target, '.agents', 'skills');
    for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const rel = `.agents/skills/${ent.name}/SKILL.md`;
      const abs = path.join(target, rel);
      if (!fs.existsSync(abs)) continue;
      if (skillEntries.some((e) => e.targetRel === rel)) continue;
      skillEntries.push({ srcAbs: abs, targetRel: rel });
    }
  } catch {
    /* 目标尚无 .agents/skills：跳过外部技能面 */
  }
  addGeneratedSkillSurfaces({ plan, hosts, skillEntries, t });

  // 生成项同样允许按目标路径覆盖，然后二次去重（静态宿主文件优先级更高）
  applyLocaleOverrides(lang, plan);
  deduped = dedupeEntries(plan);

  if (categories && categories.length) deduped = deduped.filter((e) => categories.includes(e.category));

  return { target, hosts, lang, stack, projectName, entries: deduped };
}
