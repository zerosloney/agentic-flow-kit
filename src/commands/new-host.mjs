// new-host：生成一个可直接安装的宿主插件（外部宿主定义 + 静态模板 + 技能入口模板）。
// 生成物落在 <out>/.flow-kit/hosts/，由 loadExternalHosts 自动发现；不修改内置注册表。
// 零依赖：只读引擎模板的 commands / roles 生成指针壳。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS } from '../hosts/registry.mjs';
import { validateHostDefinition } from '../hosts/external.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(HERE, '..', '..');
const ENGINE = path.join(KIT_ROOT, 'templates', 'engine', '.agents');
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const HOST_DIR_RE = /^\.[A-Za-z0-9._-]+$/;
const SKILL_MODES = new Set(['native', 'shared', 'index']);
const PERMISSION_SYNTAX = new Set(['colon', 'space']);
const MCP_FORMATS = new Set(['claude', 'opencode']);

function usageError(message, code = 'MISSING_ARG') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function listMarkdown(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function firstHeading(text) {
  const match = String(text).match(/^#{1,3}\s+(.+)$/m);
  return match ? match[1].replace(/[*`]/g, '').trim() : '';
}

function commandShell(name, description) {
  return [
    '---',
    `name: wf-${name}`,
    `description: ${description || name}`,
    '---',
    `权威命令：\`.agents/commands/${name}.md\``,
    '本文件是指针壳。执行时读取权威源，不在此复制正文。',
    '',
  ].join('\n');
}

function agentShell(name, description, modelLine) {
  return [
    '---',
    `name: ${name}`,
    `description: ${description || name}`,
    ...(modelLine ? [modelLine] : []),
    '---',
    `公共角色契约：\`.agents/roles/${name}.md\`。本文件只保留宿主 frontmatter。`,
    '',
  ].join('\n');
}

const SKILL_POINTER = [
  '---',
  'name: {{skillName}}',
  'description: {{skillDescription}}',
  '---',
  '{{pointer}}',
  '',
].join('\n');

const SKILL_INDEX = [
  '---',
  'description: {{indexDescription}}',
  '---',
  '{{skillsList}}',
  '',
].join('\n');

function writeFile(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function option(args, key, fallback) {
  const value = args[key];
  return value == null || value === '' ? fallback : String(value);
}

export function newHostCommand({ args, t }) {
  const name = String(args._[1] || '').trim().toLowerCase();
  if (!name) throw usageError(t('newhost.missingName'));
  if (!NAME_RE.test(name)) throw usageError(t('newhost.badName', { name }));
  const dir = option(args, 'dir', `.${name}`);
  if (!HOST_DIR_RE.test(dir) || dir === '.' || dir === '..') {
    throw usageError(t('newhost.badDir', { dir }));
  }
  const label = option(args, 'label', `${name[0].toUpperCase()}${name.slice(1)}`);
  const mode = option(args, 'skills', 'index');
  if (!SKILL_MODES.has(mode)) throw usageError(t('newhost.badSkills', { mode }));
  const force = args.flags.has('force');
  const out = path.resolve(option(args, 'out', process.cwd()));
  const pluginRoot = path.join(out, '.flow-kit', 'hosts');
  const jsonAbs = path.join(pluginRoot, `${name}.json`);
  const templatesDir = path.join(pluginRoot, name);
  const metaDir = path.join(pluginRoot, 'host-meta', name);

  if (HOSTS[name] && !force) throw usageError(t('newhost.existsName', { name }), 'HOST_EXISTS');
  if (fs.existsSync(jsonAbs) && !force) throw usageError(t('newhost.exists', { file: jsonAbs }), 'HOST_EXISTS');

  // 模型字段：声明 modelField 时必须同时给出 inherit 值，否则插件校验会拒绝。
  const modelField = args['model-field'] ? String(args['model-field']) : null;
  if (modelField && !isModelField(modelField)) throw usageError(t('newhost.badModelField', { field: modelField }));
  let inheritValue = args.inherit ? String(args.inherit) : null;
  if (modelField && !inheritValue) throw usageError(t('newhost.missingInherit'));
  if (!modelField) inheritValue = null;

  // hooks：默认关闭；--hooks 启用中性 PreToolUse 映射。
  const hooksEnabled = args.flags.has('hooks') || args['hook-event'] != null;
  const hookEvent = option(args, 'hook-event', 'PreToolUse');
  const writeMatcher = option(args, 'write-matcher', 'Write|Edit');
  const shellMatcher = option(args, 'shell-matcher', 'Bash|Shell');
  const settingsFile = option(args, 'settings', 'settings.json');
  if (settingsFile.includes('/') || settingsFile.includes('\\')) {
    throw usageError(t('newhost.badSettings', { file: settingsFile }));
  }

  const permissionsEnabled = args.flags.has('permissions');
  const permissionSyntax = option(args, 'permission-syntax', 'colon');
  if (!PERMISSION_SYNTAX.has(permissionSyntax)) {
    throw usageError(t('newhost.badSyntax', { syntax: permissionSyntax }));
  }
  const shellTool = option(args, 'shell-tool', 'Bash');

  let mcp = null;
  if (args.mcp) {
    const format = String(args.mcp);
    if (!MCP_FORMATS.has(format)) throw usageError(t('newhost.badMcp', { format }));
    mcp = { file: format === 'opencode' ? 'opencode.json' : '.mcp.json', format };
  }

  // --force 覆盖时清掉旧生成树，避免切换 skills 模式后残留两套入口模板。
  if (force && fs.existsSync(jsonAbs)) {
    fs.rmSync(templatesDir, { recursive: true, force: true });
    fs.rmSync(metaDir, { recursive: true, force: true });
  }

  const created = [];
  const add = (abs, text) => {
    writeFile(abs, text);
    created.push(path.relative(out, abs).replace(/\\/g, '/'));
  };

  // 1) 命令指针壳（引擎侧新增命令后重跑本命令并用 --force 覆盖）
  const commands = listMarkdown(path.join(ENGINE, 'commands'));
  for (const file of commands) {
    const cmd = file.slice(0, -3);
    const heading = firstHeading(fs.readFileSync(path.join(ENGINE, 'commands', file), 'utf8'));
    add(path.join(templatesDir, 'commands', `wf-${cmd}.md`), commandShell(cmd, heading));
  }

  // 2) 子代理 frontmatter 壳
  const roles = listMarkdown(path.join(ENGINE, 'roles'));
  const modelLine = modelField ? `${modelField}: ${inheritValue}` : '';
  for (const file of roles) {
    const role = file.slice(0, -3);
    const heading = firstHeading(fs.readFileSync(path.join(ENGINE, 'roles', file), 'utf8'));
    add(path.join(templatesDir, 'agents', `${role}.md`), agentShell(role, heading, modelLine));
  }

  // 3) 静态宿主配置底稿：Hook / 权限编译器以它为 base，只替换托管项。
  if (hooksEnabled || permissionsEnabled) {
    add(path.join(templatesDir, settingsFile), '{}\n');
  }

  // 4) 技能入口模板（外部宿主不在包内 host-meta 中）
  add(path.join(metaDir, mode === 'native' ? 'skill-pointer.md' : 'skill-index.md'),
    mode === 'native' ? SKILL_POINTER : SKILL_INDEX);

  const definition = {
    name,
    dir,
    label,
    tracked: args.flags.has('track-hosts'),
    ...(option(args, 'root-memory', '') ? { rootMemory: String(args['root-memory']) } : {}),
    commands: { dir: 'commands', ext: '.md' },
    agents: { dir: 'agents', ext: '.md', modelField, inheritValue },
    skills: mode === 'native'
      ? { mode, dir: 'skills', file: 'SKILL.md' }
      : { mode },
    hooks: hooksEnabled
      ? {
        file: settingsFile,
        format: 'json',
        events: {
          event: hookEvent,
          container: 'hooks',
          matchers: { write: writeMatcher, shell: shellMatcher },
          timeouts: { write: 120, shell: 600 },
          command: { form: 'cli', template: 'flow-kit hook {hook}' },
        },
      }
      : null,
    permissions: permissionsEnabled
      ? { container: 'permissions', syntax: permissionSyntax, tool: shellTool, tools: ['shell', 'read', 'web'] }
      : null,
    hardening: { level: 'none' },
    ...(mcp ? { mcp } : {}),
    skillMeta: path.relative(pluginRoot, metaDir).replace(/\\/g, '/'),
    modelProbe: { configs: [], env: [], cli: [] },
  };

  writeFile(jsonAbs, `${JSON.stringify(definition, null, 2)}\n`);
  created.push(path.relative(out, jsonAbs).replace(/\\/g, '/'));

  // 自校验：与运行期加载器同一套规则，生成即合法。
  validateHostDefinition(JSON.parse(fs.readFileSync(jsonAbs, 'utf8')), jsonAbs, t);

  const summary = t('newhost.created', {
    name, count: String(created.length), dir: path.relative(out, pluginRoot).replace(/\\/g, '/') || '.',
  });
  return {
    name,
    dir,
    out,
    pluginRoot,
    file: jsonAbs,
    definition,
    created,
    next: t('newhost.next', {
      name, out, file: path.relative(out, jsonAbs).replace(/\\/g, '/'),
    }),
    summary,
  };
}

function isModelField(value) {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value);
}
