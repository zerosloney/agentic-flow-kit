import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerHost } from './registry.mjs';

// 外部宿主定义：JSON 描述能力面，可选同目录模板树提供 command / agent 等静态文件。
// 校验手写（零依赖）；错误信息带字段名，便于直接修 JSON。
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const HOST_DIR_RE = /^\.[A-Za-z0-9._-]+$/;
const REL_PATH_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const EXT_RE = /^\.[A-Za-z0-9]+$/;
const SKILL_MODES = new Set(['native', 'shared', 'index']);
const HOOK_FORMATS = new Set(['json']);
export const HOST_DEFINITION_KEYS = [
  'name', 'dir', 'label', 'tracked', 'rootMemory', 'detect', 'templates', 'skillMeta',
  'commands', 'agents', 'skills', 'hooks', 'permissions', 'hardening', 'mcp', 'modelProbe',
];
const ALLOWED_KEYS = new Set(HOST_DEFINITION_KEYS);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isRelPath(value) {
  return isString(value) && REL_PATH_RE.test(value) && !value.split('/').includes('..');
}

function stringList(value, field, bad) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => !isString(item))) {
    bad(`\`${field}\` must be an array of strings`);
  }
  return value.slice();
}

function normalizeCommands(raw, field, bad) {
  if (raw == null) return null;
  if (!isObject(raw)) bad(`\`${field}\` must be an object or null`);
  if (!isRelPath(raw.dir)) bad(`\`${field}.dir\` must be a relative directory`);
  const ext = raw.ext == null ? '.md' : raw.ext;
  if (!isString(ext) || !EXT_RE.test(ext)) bad(`\`${field}.ext\` must look like ".md"`);
  return { dir: raw.dir, ext };
}

function normalizeAgents(raw, field, bad) {
  if (raw == null) return null;
  if (!isObject(raw)) bad(`\`${field}\` must be an object or null`);
  if (!isRelPath(raw.dir)) bad(`\`${field}.dir\` must be a relative directory`);
  const ext = raw.ext == null ? '.md' : raw.ext;
  if (!isString(ext) || !EXT_RE.test(ext)) bad(`\`${field}.ext\` must look like ".md"`);
  const modelField = raw.modelField == null ? null : raw.modelField;
  if (modelField != null && !isString(modelField)) bad(`\`${field}.modelField\` must be a string or null`);
  let inheritValue = raw.inheritValue == null ? null : raw.inheritValue;
  if (inheritValue != null && !isString(inheritValue)) bad(`\`${field}.inheritValue\` must be a string or null`);
  if (modelField && !inheritValue) bad(`\`${field}.inheritValue\` is required when \`${field}.modelField\` is set`);
  if (!modelField) inheritValue = null;
  return { dir: raw.dir, ext, modelField, inheritValue };
}

function normalizeSkills(raw, field, bad) {
  if (raw == null) return null;
  if (!isObject(raw)) bad(`\`${field}\` must be an object or null`);
  if (!SKILL_MODES.has(raw.mode)) bad(`\`${field}.mode\` must be one of: native, shared, index`);
  if (raw.mode !== 'native') return { mode: raw.mode };
  if (!isRelPath(raw.dir)) bad(`\`${field}.dir\` is required for native skills`);
  if (!isString(raw.file) || raw.file.includes('/')) bad(`\`${field}.file\` is required for native skills`);
  return { mode: raw.mode, dir: raw.dir, file: raw.file };
}

const HOOK_TOOLS = new Set(['write', 'shell']);
export const HOOK_FORMS = ['env', 'relative', 'args', 'cli', 'cli-args'];
const HOOK_FORM_SET = new Set(HOOK_FORMS);
// cli / cli-args 指向包内入口，模板占位符是 {hook}；旧式 env/relative/args 直接指向脚本，用 {script}。
const CLI_FORMS = new Set(['cli', 'cli-args']);

// hooks.events 让外部宿主也能接入 Hook 编译器；字段与内置注册表一致。
function normalizeHookEvents(raw, field, bad) {
  if (raw == null) return null;
  if (!isObject(raw)) bad(`\`${field}\` must be an object or null`);
  if (!isString(raw.event)) bad(`\`${field}.event\` is required`);
  for (const key of ['container', 'matcherKey', 'hooksKey']) {
    if (raw[key] != null && !isString(raw[key])) bad(`\`${field}.${key}\` must be a string`);
  }
  if (!isObject(raw.matchers) || !Object.keys(raw.matchers).length) {
    bad(`\`${field}.matchers\` must map write/shell to host matchers`);
  }
  for (const [tool, matcher] of Object.entries(raw.matchers)) {
    if (!HOOK_TOOLS.has(tool)) bad(`\`${field}.matchers.${tool}\` must be write or shell`);
    if (!isString(matcher)) bad(`\`${field}.matchers.${tool}\` must be a string`);
  }
  const tools = raw.tools == null ? null : stringList(raw.tools, `${field}.tools`, bad);
  for (const tool of tools || []) {
    if (!HOOK_TOOLS.has(tool)) bad(`\`${field}.tools\` must contain only write/shell`);
  }
  const timeouts = raw.timeouts == null ? null : raw.timeouts;
  if (timeouts != null) {
    if (!isObject(timeouts)) bad(`\`${field}.timeouts\` must be an object`);
    for (const [tool, value] of Object.entries(timeouts)) {
      if (!HOOK_TOOLS.has(tool) || !Number.isFinite(value)) bad(`\`${field}.timeouts.${tool}\` must be a number`);
    }
  }
  if (!isObject(raw.command)) bad(`\`${field}.command\` must be an object`);
  if (!HOOK_FORM_SET.has(raw.command.form)) {
    bad(`\`${field}.command.form\` must be one of: ${HOOK_FORMS.join(', ')}`);
  }
  const token = CLI_FORMS.has(raw.command.form) ? '{hook}' : '{script}';
  if (!isString(raw.command.template) || !raw.command.template.includes(token)) {
    bad(`\`${field}.command.template\` must be a string containing ${token}`);
  }
  if (raw.includeMeta != null && typeof raw.includeMeta !== 'boolean') {
    bad(`\`${field}.includeMeta\` must be a boolean`);
  }
  for (const key of ['rootDefaults', 'groupExtras', 'hookExtras']) {
    if (raw[key] != null && !isObject(raw[key])) bad(`\`${field}.${key}\` must be an object`);
  }
  return {
    event: raw.event,
    ...(raw.container ? { container: raw.container } : {}),
    ...(raw.matcherKey ? { matcherKey: raw.matcherKey } : {}),
    ...(raw.hooksKey ? { hooksKey: raw.hooksKey } : {}),
    matchers: { ...raw.matchers },
    ...(tools ? { tools } : {}),
    ...(timeouts ? { timeouts: { ...timeouts } } : {}),
    command: { form: raw.command.form, template: raw.command.template },
    ...(raw.includeMeta ? { includeMeta: true } : {}),
    ...(raw.rootDefaults ? { rootDefaults: { ...raw.rootDefaults } } : {}),
    ...(raw.groupExtras ? { groupExtras: { ...raw.groupExtras } } : {}),
    ...(raw.hookExtras ? { hookExtras: { ...raw.hookExtras } } : {}),
  };
}

function normalizeHooks(raw, field, bad) {
  if (raw == null) return null;
  if (!isObject(raw)) bad(`\`${field}\` must be an object or null`);
  if (!isRelPath(raw.file) || raw.file.includes('/')) bad(`\`${field}.file\` must be a file name`);
  if (raw.format != null && !HOOK_FORMATS.has(raw.format)) bad(`\`${field}.format\` must be one of: json`);
  const events = normalizeHookEvents(raw.events, `${field}.events`, bad);
  return { file: raw.file, format: raw.format || 'json', ...(events ? { events } : {}) };
}

const PERMISSION_TOOLS = new Set(['shell', 'read', 'web']);
const PERMISSION_SYNTAX = new Set(['colon', 'space']);

function normalizePermissions(raw, field, bad) {
  if (raw == null) return null;
  if (!isObject(raw)) bad(`\`${field}\` must be an object or null`);
  if (raw.file != null) {
    if (!isRelPath(raw.file) || raw.file.includes('/')) bad(`\`${field}.file\` must be a file name`);
  }
  if (raw.container != null && !isString(raw.container)) bad(`\`${field}.container\` must be a string`);
  if (raw.syntax != null && !PERMISSION_SYNTAX.has(raw.syntax)) bad(`\`${field}.syntax\` must be one of: colon, space`);
  if (raw.tool != null && !isString(raw.tool)) bad(`\`${field}.tool\` must be a string`);
  const tools = raw.tools == null ? ['shell'] : stringList(raw.tools, `${field}.tools`, bad);
  for (const tool of tools) {
    if (!PERMISSION_TOOLS.has(tool)) bad(`\`${field}.tools\` must contain only shell/read/web`);
  }
  const extraAllow = raw.extraAllow == null ? [] : raw.extraAllow;
  if (!Array.isArray(extraAllow)) bad(`\`${field}.extraAllow\` must be an array`);
  const normalizedExtra = extraAllow.map((item, i) => {
    if (!isObject(item) || !isString(item.pat)) bad(`\`${field}.extraAllow[${i}].pat\` is required`);
    const tool = item.tool == null ? 'shell' : String(item.tool);
    if (!PERMISSION_TOOLS.has(tool)) bad(`\`${field}.extraAllow[${i}].tool\` must be shell/read/web`);
    return { tool, pat: item.pat };
  });
  return {
    ...(raw.file ? { file: raw.file } : {}),
    ...(raw.container ? { container: raw.container } : {}),
    syntax: raw.syntax || 'colon',
    tool: raw.tool || 'Bash',
    tools,
    ...(normalizedExtra.length ? { extraAllow: normalizedExtra } : {}),
  };
}

const MCP_FORMATS = new Set(['claude', 'opencode']);

function normalizeMcp(raw, field, bad) {
  if (raw == null) return null;
  if (!isObject(raw)) bad(`\`${field}\` must be an object or null`);
  if (!isRelPath(raw.file)) bad(`\`${field}.file\` must be a relative path`);
  const format = raw.format == null ? 'claude' : raw.format;
  if (!MCP_FORMATS.has(format)) bad(`\`${field}.format\` must be one of: claude, opencode`);
  return { file: raw.file, format };
}

const HARDENING_LEVELS = new Set(['managed', 'permissions', 'hooks', 'none']);

function normalizeHardening(raw, field, bad) {
  if (raw == null) return null;
  if (!isObject(raw)) bad(`\`${field}\` must be an object or null`);
  if (!HARDENING_LEVELS.has(raw.level)) bad(`\`${field}.level\` must be one of: managed, permissions, hooks, none`);
  if (raw.settings != null && (!isRelPath(raw.settings) || raw.settings.includes('/'))) {
    bad(`\`${field}.settings\` must be a file name`);
  }
  return { level: raw.level, ...(raw.settings ? { settings: raw.settings } : {}) };
}

function normalizeProbe(raw, field, bad) {
  if (raw == null) return { configs: [], env: [], cli: [] };
  if (!isObject(raw)) bad(`\`${field}\` must be an object`);
  const cli = raw.cli == null ? [] : raw.cli;
  if (!Array.isArray(cli)) bad(`\`${field}.cli\` must be an array`);
  return {
    configs: stringList(raw.configs, `${field}.configs`, bad),
    env: stringList(raw.env, `${field}.env`, bad),
    cli: cli.map((item, i) => {
      if (!isObject(item) || !isString(item.command)) bad(`\`${field}.cli[${i}].command\` is required`);
      return {
        command: item.command,
        args: item.args == null ? [] : stringList(item.args, `${field}.cli[${i}].args`, bad),
      };
    }),
  };
}

function invalid(t, file, detail) {
  const err = new Error(t('error.hostManifestInvalid', { file, detail }));
  err.code = 'HOST_MANIFEST';
  return err;
}

export function validateHostDefinition(raw, file, t) {
  const bad = (detail) => { throw invalid(t, file, detail); };
  if (!isObject(raw)) bad('root must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) bad(`unknown key \`${key}\``);
  }
  if (!isString(raw.name) || !NAME_RE.test(raw.name)) bad('`name` must match ^[a-z][a-z0-9-]*$');
  if (!isString(raw.dir) || !HOST_DIR_RE.test(raw.dir) || raw.dir === '.' || raw.dir === '..') {
    bad('`dir` must be a dot-directory such as ".myhost"');
  }
  if (raw.label != null && !isString(raw.label)) bad('`label` must be a string');
  if (raw.tracked != null && typeof raw.tracked !== 'boolean') bad('`tracked` must be a boolean');
  if (raw.rootMemory != null && (!isString(raw.rootMemory) || /[\\/]/.test(raw.rootMemory))) {
    bad('`rootMemory` must be a file name at the project root');
  }
  const detect = stringList(raw.detect, 'detect', bad);
  if (detect.some((rel) => !isRelPath(rel))) bad('`detect` entries must be relative paths');

  let templates = null;
  if (raw.templates != null) {
    if (!isString(raw.templates)) bad('`templates` must be a path to a template directory');
    templates = path.resolve(path.dirname(file), raw.templates);
    if (!fs.existsSync(templates) || !fs.statSync(templates).isDirectory()) {
      bad(`\`templates\` directory not found: ${templates}`);
    }
  } else {
    // 约定：与 JSON 同名的兄弟目录即模板树；不存在时只生成技能索引/指针。
    const sibling = path.join(path.dirname(file), raw.name);
    if (fs.existsSync(sibling) && fs.statSync(sibling).isDirectory()) templates = sibling;
  }

  // 技能入口模板目录：外部宿主无包内 templates/host-meta/<name>，可显式指定；
  // 缺省时安装器回退到内置的中性指针/索引模板。
  let skillMeta = null;
  if (raw.skillMeta != null) {
    if (!isString(raw.skillMeta)) bad('`skillMeta` must be a path to a directory');
    skillMeta = path.resolve(path.dirname(file), raw.skillMeta);
    if (!fs.existsSync(skillMeta) || !fs.statSync(skillMeta).isDirectory()) {
      bad(`\`skillMeta\` directory not found: ${skillMeta}`);
    }
  }

  return {
    dir: raw.dir,
    label: raw.label || raw.name,
    tracked: raw.tracked === true,
    ...(raw.rootMemory ? { rootMemory: raw.rootMemory } : {}),
    ...(detect.length ? { detect } : {}),
    commands: normalizeCommands(raw.commands, 'commands', bad),
    agents: normalizeAgents(raw.agents, 'agents', bad),
    skills: normalizeSkills(raw.skills, 'skills', bad),
    hooks: normalizeHooks(raw.hooks, 'hooks', bad),
    permissions: normalizePermissions(raw.permissions, 'permissions', bad),
    hardening: normalizeHardening(raw.hardening, 'hardening', bad),
    mcp: normalizeMcp(raw.mcp, 'mcp', bad),
    modelProbe: normalizeProbe(raw.modelProbe, 'modelProbe', bad),
    ...(templates ? { templates } : {}),
    ...(skillMeta ? { skillMeta } : {}),
  };
}

function loadFile(abs, source, t) {
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    const wrapped = new Error(t('error.hostManifestRead', { file: abs, detail: err.code || err.message }));
    wrapped.code = 'HOST_MANIFEST';
    throw wrapped;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw invalid(t, abs, `invalid JSON: ${err.message}`);
  }
  const def = validateHostDefinition(raw, abs, t);
  registerHost(raw.name, def, source);
  return raw.name;
}

function jsonFilesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

export function userHostsDir(home = os.homedir()) {
  return path.join(home, '.flow-kit', 'hosts');
}

export function projectHostsDir(target) {
  return path.join(target, '.flow-kit', 'hosts');
}

// 优先级（低 -> 高）：内置 < 用户 < 项目 < --host-manifest。
// 后注册的同名定义覆盖先前的，HOST_NAMES 位置保持不变。
export function loadExternalHosts({ target, files = [], t, home = os.homedir() } = {}) {
  const loaded = [];
  const layers = [
    ['user', jsonFilesIn(userHostsDir(home))],
    ['project', jsonFilesIn(projectHostsDir(target))],
    ['cli', files.map((file) => path.resolve(file))],
  ];
  for (const [source, list] of layers) {
    for (const file of list) loaded.push({ name: loadFile(file, source, t), source, file });
  }
  return loaded;
}
