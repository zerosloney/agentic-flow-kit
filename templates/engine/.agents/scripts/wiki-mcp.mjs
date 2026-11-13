#!/usr/bin/env node
// 零依赖 MCP stdio server：只读检索 wiki/ 与 .agents/（记忆、决策、技能、配置）。
// 供 install 生成的宿主 MCP 配置引用；不联网、不写盘。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const ROOT = process.cwd();
const SEARCH_ROOTS = ['wiki', '.agents'];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.agents/cache', '.agents/tmp', '.agents/tools', '.agents/.kit']);
const TEXT_EXT = new Set(['.md', '.txt', '.json', '.jsonl', '.mjs', '.cjs', '.js', '.ts', '.yml', '.yaml']);
const MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function shouldSkipDir(rel) {
  return SKIP_DIRS.has(rel.split('/').slice(0, 2).join('/')) || SKIP_DIRS.has(rel) || rel.endsWith('/node_modules');
}

function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!shouldSkipDir(childRel)) walk(childRel, out);
      continue;
    }
    if (!entry.isFile() || !TEXT_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      if (fs.statSync(path.join(ROOT, childRel)).size > MAX_FILE_BYTES) continue;
    } catch {
      continue;
    }
    out.push(childRel);
  }
}

function search(query, limit) {
  const needle = String(query || '').toLowerCase();
  if (!needle) return [];
  const files = [];
  for (const root of SEARCH_ROOTS) walk(root, files);
  const hits = [];
  for (const rel of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, index) => {
      if (hits.length >= limit) return;
      if (line.toLowerCase().includes(needle)) hits.push({ path: rel, line: index + 1, text: line.trim() });
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

const TOOLS = [
  {
    name: 'wiki_search',
    description: 'Search wiki/ and .agents/ (memory, decisions, skills, config) for a case-insensitive substring.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring to search for.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: 'Maximum hits (default 10).' },
      },
      required: ['query'],
    },
  },
];

function toolResult(hits) {
  const text = hits.length
    ? hits.map((hit) => `${hit.path}:${hit.line}: ${hit.text}`).join('\n')
    : 'No matches.';
  return { content: [{ type: 'text', text }] };
}

function handle(request) {
  const { id, method, params } = request;
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'flow-kit-wiki', version: '1.0.0' },
      },
    };
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    if (params?.name !== 'wiki_search') {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${params?.name}` } };
    }
    const limit = Math.min(hitLimit(params), MAX_LIMIT);
    return { jsonrpc: '2.0', id, result: toolResult(search(params?.arguments?.query, limit)) };
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

function hitLimit(params) {
  const raw = Number(params?.arguments?.limit);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_LIMIT;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  // 通知（notifications/*）无 id，不应回复。
  if (request.id == null && String(request.method || '').startsWith('notifications/')) return;
  send(handle(request));
});
