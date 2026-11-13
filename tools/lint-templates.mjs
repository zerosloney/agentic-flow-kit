#!/usr/bin/env node
// 模板一致性 lint：frontmatter、i18n 覆盖、运行态污染、渲染矩阵与引用可解析性。
// 只读；零依赖。`npm run lint:templates` 在 CI 与本地执行，失败退出 1。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../src/install/frontmatter.mjs';
import { buildPlan, isRuntimeEnginePath } from '../src/install/plan.mjs';
import { readPlanEntry } from '../src/install/apply.mjs';
import { buildVars } from '../src/render/tokens.mjs';
import { HOSTS, HOST_NAMES } from '../src/hosts/registry.mjs';
import { HOST_DEFINITION_KEYS, HOOK_FORMS, validateHostDefinition } from '../src/hosts/external.mjs';
import { RUNTIME_SCRIPTS, RUNTIME_HOOKS, resolveRuntimeScript, resolveRuntimeHook } from '../src/commands/runtime.mjs';
import { readKitVersion } from '../src/commands/install.mjs';
import { LANGUAGES } from '../src/i18n.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
const TIERS = ['lean', 'standard', 'enterprise'];
const SKILL_MODES = ['native', 'shared', 'index'];
// 安装期保留给宿主的运行态占位符（不参与渲染）。
const RUNTIME_PLACEHOLDERS = new Set(['args']);
// 项目自建门禁扩展点：由目标项目提供，不属于包内运行时。
const PROJECT_HOOKS = new Set(['local-pre-commit']);

function walk(dir, rel = '', out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(dir, next, out);
    else out.push(next);
  }
  return out;
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function flattenKeys(value, prefix = '', out = new Set()) {
  for (const [key, child] of Object.entries(value || {})) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flattenKeys(child, next, out);
    else out.add(next);
  }
  return out;
}

function section(name) {
  return { name, errors: [], warnings: [] };
}

function checkFrontmatter(root, result) {
  const sec = section('frontmatter');
  result.sections.push(sec);
  const skillDirs = [
    path.join(root, 'templates/engine/.agents/skills'),
    path.join(root, 'locales/en/overrides/.agents/skills'),
  ];
  for (const dir of skillDirs) {
    for (const entry of safeDirs(dir)) {
      const rel = path.relative(root, path.join(dir, entry, 'SKILL.md')).replace(/\\/g, '/');
      const abs = path.join(dir, entry, 'SKILL.md');
      if (!fs.existsSync(abs)) { sec.errors.push(`${rel}: missing SKILL.md`); continue; }
      const fm = parseFrontmatter(fs.readFileSync(abs, 'utf8'));
      if (fm.name !== entry) sec.errors.push(`${rel}: frontmatter name must equal "${entry}" (got "${fm.name || ''}")`);
      if (!fm.description) sec.errors.push(`${rel}: frontmatter description is required`);
      else if (fm.description.length > 1024) sec.errors.push(`${rel}: description exceeds 1024 chars`);
    }
  }

  for (const host of HOST_NAMES) {
    const h = HOSTS[host];
    const dir = path.join(root, 'templates/hosts', host);
    if (!fs.existsSync(dir)) continue;
    if (h.commands) {
      const commandDir = path.join(dir, h.commands.dir);
      for (const file of safeFiles(commandDir, h.commands.ext)) {
        const rel = path.relative(root, path.join(commandDir, file)).replace(/\\/g, '/');
        const text = fs.readFileSync(path.join(commandDir, file), 'utf8');
        const fm = parseFrontmatter(text);
        if (!fm.description) sec.errors.push(`${rel}: frontmatter description is required`);
        const base = file.slice(0, -h.commands.ext.length);
        const command = base.startsWith('wf-') ? base.slice(3) : base;
        if (base.startsWith('wf-') && !fs.existsSync(path.join(root, 'templates/engine/.agents/commands', `${command}.md`))) {
          sec.errors.push(`${rel}: engine command .agents/commands/${command}.md not found`);
        }
        if (!text.includes(`.agents/commands/${command}.md`)) {
          sec.errors.push(`${rel}: pointer shell must reference .agents/commands/${command}.md`);
        }
      }
    }
    if (h.agents) {
      const agentDir = path.join(dir, h.agents.dir);
      for (const file of safeFiles(agentDir, h.agents.ext)) {
        const rel = path.relative(root, path.join(agentDir, file)).replace(/\\/g, '/');
        const text = fs.readFileSync(path.join(agentDir, file), 'utf8');
        const fm = parseFrontmatter(text);
        const role = file.slice(0, -h.agents.ext.length);
        // 部分宿主（opencode）以文件名为角色名，frontmatter 不写 name；写了就必须一致。
        if (fm.name && fm.name !== role) sec.errors.push(`${rel}: frontmatter name must equal "${role}" (got "${fm.name}")`);
        if (!fm.description) sec.errors.push(`${rel}: frontmatter description is required`);
        if (!text.includes(`.agents/roles/${role}.md`)) {
          sec.errors.push(`${rel}: agent shell must reference .agents/roles/${role}.md`);
        }
        if (fm.model && !h.agents.modelField) {
          // pi 等宿主在模板里固定模型是刻意行为；只记录，不判红。
          sec.warnings.push(`${rel}: frontmatter sets model but the registry declares no modelField`);
        }
      }
    }
  }
  return sec;
}

function safeDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function safeFiles(dir, ext) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(ext))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function checkI18n(root, result, { external = true } = {}) {
  const sec = section('i18n');
  result.sections.push(sec);
  const localesDir = path.join(root, 'locales');
  const zh = flattenKeys(readJson(path.join(localesDir, 'zh-CN/installer.json')));
  const en = flattenKeys(readJson(path.join(localesDir, 'en/installer.json')));
  for (const key of zh) if (!en.has(key)) sec.errors.push(`locales/en/installer.json: missing key "${key}"`);
  for (const key of en) if (!zh.has(key)) sec.errors.push(`locales/zh-CN/installer.json: missing key "${key}"`);
  if (!external) return sec;
  const tool = path.join(root, 'tools/make-en-host-overrides.mjs');
  if (!fs.existsSync(tool)) return sec;
  const run = spawnSync(process.execPath, [tool, '--check'], { cwd: root, encoding: 'utf8' });
  if (run.status !== 0) {
    const detail = `${run.stdout || ''}${run.stderr || ''}`.trim();
    for (const line of detail.split(/\r?\n/).filter(Boolean)) sec.errors.push(`en overrides: ${line}`);
    if (!detail) sec.errors.push('en host overrides check failed');
  }
  return sec;
}

function checkDefinitions(root, result) {
  const sec = section('definitions');
  result.sections.push(sec);
  let schema;
  try {
    schema = readJson(path.join(root, 'schemas/host.schema.json'));
  } catch (err) {
    sec.errors.push(`schemas/host.schema.json: ${err.message}`);
    return sec;
  }
  const schemaKeys = new Set(Object.keys(schema.properties || {}));
  for (const key of HOST_DEFINITION_KEYS) {
    if (!schemaKeys.has(key)) sec.errors.push(`schemas/host.schema.json: missing property "${key}"`);
  }
  for (const key of schemaKeys) {
    if (!HOST_DEFINITION_KEYS.includes(key)) sec.errors.push(`src/hosts/external.mjs: unknown definition key "${key}"`);
  }
  const formEnum = new Set(schema.properties?.hooks?.properties?.events?.properties?.command?.properties?.form?.enum || []);
  for (const form of HOOK_FORMS) if (!formEnum.has(form)) sec.errors.push(`schemas/host.schema.json: hooks form "${form}" missing`);
  for (const form of formEnum) if (!HOOK_FORMS.includes(form)) sec.errors.push(`src/hosts/external.mjs: hooks form "${form}" missing`);
  const modeEnum = schema.properties?.skills?.properties?.mode?.enum || [];
  for (const mode of SKILL_MODES) if (!modeEnum.includes(mode)) sec.errors.push(`schemas/host.schema.json: skills mode "${mode}" missing`);

  const dirs = new Map();
  for (const host of HOST_NAMES) {
    const h = HOSTS[host];
    if (dirs.has(h.dir)) sec.errors.push(`host ${host}: duplicate dir ${h.dir} (also ${dirs.get(h.dir)})`);
    dirs.set(h.dir, host);
    if (h.templates && !fs.existsSync(h.templates)) sec.errors.push(`host ${host}: templates dir not found: ${h.templates}`);
  }

  const pluginDir = path.join(root, 'hosts');
  if (!fs.existsSync(pluginDir)) return sec;
  const t = makeT('zh-CN');
  for (const file of safeFiles(pluginDir, '.json')) {
    const abs = path.join(pluginDir, file);
    try {
      validateHostDefinition(readJson(abs), abs, t);
    } catch (err) {
      sec.errors.push(`${path.relative(root, abs).replace(/\\/g, '/')}: ${err.message}`);
    }
  }
  return sec;
}

function collectRefs(text, pattern) {
  const out = new Set();
  for (const match of String(text).matchAll(pattern)) out.add(match[1]);
  return out;
}

function checkRender(root, result) {
  const sec = section('render');
  result.sections.push(sec);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-lint-'));
  const kitVersion = readKitVersion();
  const installedAt = '2026-01-01T00:00:00.000Z';
  try {
    for (const lang of LANGUAGES) {
      for (const tier of TIERS) {
        let plan;
        try {
          plan = buildPlan({
            target,
            hosts: HOST_NAMES,
            lang,
            stack: 'node',
            projectName: 'lint',
            categories: null,
            tier,
            hardened: tier === 'enterprise',
          });
        } catch (err) {
          sec.errors.push(`[${lang}/${tier}] buildPlan failed: ${err.message}`);
          continue;
        }
        const vars = buildVars({
          target, projectName: 'lint', stack: 'node', language: lang,
          hosts: HOST_NAMES, kitVersion, installedAt,
        });
        const state = { commands: new Set(), skills: new Set(), roles: new Set() };
        for (const entry of plan.entries) {
          const label = `[${lang}/${tier}] ${entry.targetRel}`;
          if (isRuntimeEnginePath(entry.targetRel)) {
            sec.errors.push(`${label}: installation surface contains a runtime engine path`);
            continue;
          }
          let text;
          try {
            text = readPlanEntry(entry, vars);
          } catch (err) {
            sec.errors.push(`${label}: render failed: ${err.message}`);
            continue;
          }
          if (text == null) {
            if (entry.kind === 'file' || entry.kind === 'generated') sec.errors.push(`${label}: rendered null`);
            continue;
          }
          // `.gitkeep` 等占位文件本来就是空文件。
          if (!text.trim() && entry.kind === 'file' && !/\.gitkeep$/.test(entry.targetRel)) {
            sec.errors.push(`${label}: rendered empty text`);
            continue;
          }
          for (const [, key] of text.matchAll(/\{\{(\w+)\}\}/g)) {
            if (!RUNTIME_PLACEHOLDERS.has(key)) sec.errors.push(`${label}: unresolved placeholder {{${key}}}`);
          }
          if (entry.targetRel.endsWith('.json')) {
            try {
              JSON.parse(text);
            } catch (err) {
              sec.errors.push(`${label}: invalid JSON (${err.message.split('\n')[0]})`);
            }
          }
          // 安装面里的代码不得直接执行项目内运行时副本（R5-1b：运行时随包，项目只留声明面）。
          const isCode = /\.(?:cjs|mjs|js|ts)$/.test(entry.targetRel) || entry.targetRel.startsWith('.githooks/');
          if (isCode && /\bnode\b[^\n]{0,40}\.agents\/(?:scripts|hooks|tests)\//.test(text)) {
            sec.errors.push(`${label}: code invokes a project-local runtime path; use flow-kit run/hook`);
          }
          for (const name of collectRefs(text, /\bflow-kit\s+run\s+([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
            try {
              resolveRuntimeScript(name, RUNTIME_SCRIPTS);
            } catch {
              sec.errors.push(`${label}: flow-kit run ${name} does not resolve to a package script`);
            }
          }
          for (const name of collectRefs(text, /\bflow-kit\s+hook\s+([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
            if (PROJECT_HOOKS.has(name)) continue;
            try {
              resolveRuntimeHook(name, RUNTIME_HOOKS);
            } catch {
              sec.errors.push(`${label}: flow-kit hook ${name} does not resolve to a package hook`);
            }
          }
          for (const name of collectRefs(text, /\.agents\/skills\/([a-z0-9][a-z0-9-]*)/g)) state.skills.add(name);
          for (const name of collectRefs(text, /\.agents\/commands\/([a-z0-9][a-z0-9-]*)\.md/g)) state.commands.add(name);
          for (const name of collectRefs(text, /\.agents\/roles\/([a-z0-9][a-z0-9-]*)\.md/g)) state.roles.add(name);
        }
        for (const name of state.skills) {
          if (!fs.existsSync(path.join(root, 'templates/engine/.agents/skills', name, 'SKILL.md'))) {
            sec.errors.push(`[${lang}/${tier}] reference to missing skill .agents/skills/${name}`);
          }
        }
        for (const name of state.commands) {
          if (!fs.existsSync(path.join(root, 'templates/engine/.agents/commands', `${name}.md`))) {
            sec.errors.push(`[${lang}/${tier}] reference to missing command .agents/commands/${name}.md`);
          }
        }
        for (const name of state.roles) {
          if (!fs.existsSync(path.join(root, 'templates/engine/.agents/roles', `${name}.md`))) {
            sec.errors.push(`[${lang}/${tier}] reference to missing role .agents/roles/${name}.md`);
          }
        }
        if (!plan.entries.length) sec.errors.push(`[${lang}/${tier}] plan is empty`);
      }
    }
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
  return sec;
}

export function runLint({ root = DEFAULT_ROOT, external = true, checks = ['definitions', 'frontmatter', 'i18n', 'render'] } = {}) {
  const result = { root, ok: false, sections: [] };
  if (checks.includes('definitions')) checkDefinitions(root, result);
  if (checks.includes('frontmatter')) checkFrontmatter(root, result);
  if (checks.includes('i18n')) checkI18n(root, result, { external });
  if (checks.includes('render')) checkRender(root, result);
  result.ok = result.sections.every((sec) => sec.errors.length === 0);
  return result;
}

function printReport(result) {
  for (const sec of result.sections) {
    const mark = sec.errors.length ? 'FAIL' : 'ok';
    const warn = sec.warnings.length ? `, ${sec.warnings.length} warning(s)` : '';
    console.log(`[lint] ${mark} ${sec.name}${warn}`);
    for (const warning of sec.warnings) console.log(`  warn: ${warning}`);
    for (const error of sec.errors) console.error(`  error: ${error}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const result = runLint({ external: !argv.includes('--no-overrides') });
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
    const errors = result.sections.reduce((sum, sec) => sum + sec.errors.length, 0);
    console.log(result.ok ? `[lint] ok（${result.sections.length} 个检查面）` : `[lint] failed（${errors} 个错误）`);
  }
  process.exit(result.ok ? 0 : 1);
}
