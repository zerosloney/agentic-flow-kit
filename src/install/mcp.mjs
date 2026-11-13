import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(HERE, '..', '..');
export const MCP_TEMPLATE = path.join(KIT_ROOT, 'templates', 'mcp', 'servers.json');
export const MCP_PROJECT_REL = '.flow-kit/mcp/servers.json';

function fail(detail) {
  const err = new Error(`invalid MCP server declaration: ${detail}`);
  err.code = 'MCP_CONFIG';
  throw err;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// 项目级 .flow-kit/mcp/servers.json 优先于模板；两者都是 {"servers": {...}}。
export function readMcpServers(target) {
  const project = path.join(target, MCP_PROJECT_REL);
  const file = fs.existsSync(project) ? project : MCP_TEMPLATE;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (file === MCP_TEMPLATE) return {};
    fail(`${file}: ${err.message}`);
  }
  if (!isObject(parsed?.servers)) fail(`${file}: \`servers\` must be an object`);
  return parsed.servers;
}

function containerKey(format) {
  if (format === 'opencode') return 'mcp';
  if (format === 'claude') return 'mcpServers';
  fail(`unknown host MCP format: ${format}`);
}

export function compileServer(name, def, format) {
  if (!isObject(def)) fail(`server \`${name}\` must be an object`);
  const env = isObject(def.env) ? def.env : null;
  const headers = isObject(def.headers) ? def.headers : null;
  if (format === 'opencode') {
    if (def.url) {
      return { type: 'remote', url: String(def.url), enabled: true, ...(headers ? { headers } : {}) };
    }
    if (!def.command) fail(`server \`${name}\` needs \`command\` or \`url\``);
    const args = Array.isArray(def.args) ? def.args.map(String) : [];
    return {
      type: 'local',
      command: [String(def.command), ...args],
      enabled: true,
      ...(env ? { environment: env } : {}),
    };
  }
  // Claude Code 的远程 server 使用 http / sse；允许声明覆盖 type。
  if (def.url) return { type: def.type || 'http', url: String(def.url), ...(headers ? { headers } : {}) };
  if (!def.command) fail(`server \`${name}\` needs \`command\` or \`url\``);
  const args = Array.isArray(def.args) ? def.args.map(String) : [];
  return { command: String(def.command), ...(args.length ? { args } : {}), ...(env ? { env } : {}) };
}

// 向已解析的 JSON root 合并缺失的 server（供与 hooks 编译器组合写同一配置文件的场景）。
// 返回 {changed, names}；不覆盖用户已有的同名 server。
export function mergeMcpInto(root, servers, format) {
  const key = containerKey(format);
  const current = isObject(root[key]) ? root[key] : {};
  let changed = false;
  for (const [name, def] of Object.entries(servers || {})) {
    if (!(name in current)) {
      current[name] = compileServer(name, def, format);
      changed = true;
    }
  }
  if (changed) root[key] = current;
  return { changed, names: Object.keys(servers || {}) };
}

// 从已解析的 root 摘除托管 server（供与 hooks/permissions 组合清理同一配置文件）。
export function stripMcpFromRoot(root, names, format) {
  let key;
  try {
    key = containerKey(format);
  } catch {
    return { changed: false, removed: [] };
  }
  const current = isObject(root?.[key]) ? root[key] : null;
  if (!current) return { changed: false, removed: [] };
  const removed = (names || []).filter((name) => name in current);
  for (const name of removed) delete current[name];
  if (!Object.keys(current).length) delete root[key];
  return { changed: removed.length > 0, removed };
}

// 幂等合并：只补缺失的同名 server，保留文件里其它键与用户自建 server。
// 文件已是期望状态时原样返回（不重排格式）。JSON 损坏时返回 null，由调用方跳过。
// baseText：宿主静态模板渲染结果（如 Qwen 的 settings.json）；文件不存在时以它为底稿。
export function mergeMcpFile(abs, servers, format, baseText = null) {
  const key = containerKey(format);
  const desired = {};
  for (const [name, def] of Object.entries(servers)) desired[name] = compileServer(name, def, format);

  const exists = fs.existsSync(abs);
  const existing = exists ? fs.readFileSync(abs, 'utf8') : '';
  let root = {};
  if (existing.trim()) {
    try {
      root = JSON.parse(existing);
    } catch {
      return null;
    }
    if (!isObject(root)) return null;
  } else if (!exists && typeof baseText === 'string' && baseText.trim()) {
    try {
      root = JSON.parse(baseText);
    } catch {
      root = {};
    }
    if (!isObject(root)) root = {};
  }
  if (!Object.keys(desired).length && !exists) return { text: null, names: [] };

  const current = isObject(root[key]) ? root[key] : {};
  let changed = !exists;
  for (const [name, def] of Object.entries(desired)) {
    if (!(name in current)) {
      current[name] = def;
      changed = true;
    }
  }
  const names = Object.keys(desired);
  if (!changed) return { text: existing, names };
  root[key] = current;
  return { text: `${JSON.stringify(root, null, 2)}\n`, names };
}

// 卸载/移除宿主时只摘掉本工具声明过的 server 名，保留用户 server 与其它配置。
export function stripMcpFile(abs, names, format) {
  let key;
  try {
    key = containerKey(format);
  } catch {
    return { text: null, removed: [] };
  }
  const exists = fs.existsSync(abs);
  if (!exists) return { text: null, removed: [] };
  const existing = fs.readFileSync(abs, 'utf8');
  let root;
  try {
    root = JSON.parse(existing);
  } catch {
    return { text: existing, removed: [], invalid: true };
  }
  const container = isObject(root?.[key]) ? root[key] : {};
  const removed = [];
  for (const name of names || []) {
    if (name in container) {
      delete container[name];
      removed.push(name);
    }
  }
  if (!removed.length) return { text: existing, removed };
  if (Object.keys(container).length) {
    root[key] = container;
    return { text: `${JSON.stringify(root, null, 2)}\n`, removed };
  }
  delete root[key];
  // 文件只剩空壳（安装器创建、无用户内容）时删除；否则保留其它键。
  const text = Object.keys(root).length ? `${JSON.stringify(root, null, 2)}\n` : null;
  return { text, removed };
}
