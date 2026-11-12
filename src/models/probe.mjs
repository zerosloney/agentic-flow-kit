import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HOSTS } from '../hosts/registry.mjs';

// 只读探测：宿主配置 / 环境变量为默认来源；CLI 列表命令必须显式允许。
// 任何失败都静默降级，安装不能被探测拖死或卡在认证提示上。
export function probeModels({
  host,
  target = process.cwd(),
  home = os.homedir(),
  env = process.env,
  allowCli = false,
  exec = spawnSync,
} = {}) {
  const h = HOSTS[host];
  if (!h) return [];

  const found = [];
  const add = (id, source) => {
    const s = String(id ?? '').trim();
    if (!s || s.length > 200) return;
    // 模型 ID 常见字符：provider/model、:tag、#variant、@version、+build
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/#@+~=-]*$/.test(s)) return;
    found.push({ id: s, source });
  };

  for (const raw of h.modelProbe?.configs || []) {
    const json = readJsonLoose(resolveConfigPath(raw, target, home));
    if (json) collectModels(json, add);
  }
  for (const key of h.modelProbe?.env || []) {
    const value = env[key];
    if (value) add(value, 'env');
  }

  if (allowCli) {
    for (const cli of h.modelProbe?.cli || []) {
      if (!cli?.command) continue;
      // Windows 的 `cmd` 往往是系统 cmd.exe，误执行会变成 shell 探测
      if (process.platform === 'win32' && /^cmd(\.exe)?$/i.test(cli.command)) continue;
      const r = exec(cli.command, cli.args || [], {
        encoding: 'utf8',
        timeout: 1500,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (!r || r.error || r.status !== 0 || !r.stdout) continue;
      for (const id of parseCliModels(r.stdout)) add(id, 'cli');
    }
  }

  const seen = new Set();
  return found.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  }).slice(0, 20);
}

function resolveConfigPath(raw, target, home) {
  const s = String(raw);
  if (s === '~') return home;
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(home, s.slice(2));
  return path.isAbsolute(s) ? s : path.resolve(target, s);
}

// 容忍 JSONC（注释/尾逗号）；解析失败返回 null，不抛。
export function readJsonLoose(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(stripJsonComments(text));
  } catch {
    return null;
  }
}

export function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let quote = '';
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function collectModels(value, add, depth = 0) {
  if (depth > 7 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') add(item, 'config');
      else collectModels(item, add, depth + 1);
    }
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(model|modelId|defaultModel|fastModel|subagentModel|primaryModel)$/i.test(key)) {
      if (typeof child === 'string') add(child, 'config');
      else collectModels(child, add, depth + 1);
      continue;
    }
    if (/^(models|providers|provider)$/i.test(key)) {
      collectModels(child, add, depth + 1);
      continue;
    }
    // 只向下钻一层常见容器，避免把任意 settings 里的普通字符串当模型
    if (child && typeof child === 'object' && /^(opencode|qwen|claude|pi|commandcode|qoder|zcode)$/i.test(key)) {
      collectModels(child, add, depth + 1);
    }
  }
}

export function parseCliModels(stdout) {
  const clean = String(stdout).replace(/\x1b\[[0-9;]*m/g, '');
  const out = [];
  for (const line of clean.split(/\r?\n/)) {
    const trimmed = line.trim();
    // 只过滤整行表头；`provider/model-a` 这类以 provider 开头的合法 ID 必须保留。
    if (!trimmed
      || /^(?:available\s+models?|models?|usage|name|provider)\s*:?$/i.test(trimmed)
      || /^-+$/.test(trimmed)) continue;
    // 取行内第一个像模型 ID 的 token；表格分隔线/标题会被过滤
    const token = trimmed.split(/\s+/).find((t) => /^[A-Za-z0-9][A-Za-z0-9._:/#@+~=-]*$/.test(t)
      && (/[/:.]/.test(t) || t.length > 3));
    if (token) out.push(token.replace(/[,;]+$/, ''));
  }
  return out;
}
