import fs from 'node:fs';
import path from 'node:path';
import { MCP_PROJECT_REL, MCP_TEMPLATE, isObject, mcpPolicyFail } from './mcp.mjs';

export const POLICY_MODES = ['allow'];

function fail(detail) {
  mcpPolicyFail(detail);
}

// 读取并校验 MCP 工具权限策略声明。
// 返回 { mode, servers: { <server>: Set<tool> } }；声明缺失时返回 null（= 不设限）。
// 只读声明文件，不联网、不写盘；宿主只透传该策略给运行时 server。
export function readToolPolicy(target) {
  const project = path.join(target, MCP_PROJECT_REL);
  const file = fs.existsSync(project) ? project : MCP_TEMPLATE;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (file === MCP_TEMPLATE) return null;
    fail(`${file}: ${err.message}`);
  }
  if (!isObject(parsed)) fail(`${file}: root must be an object`);
  const raw = parsed.toolPolicy;
  if (raw == null) return null;
  if (!isObject(raw)) fail(`${file}: \`toolPolicy\` must be an object`);
  if (raw.mode !== 'allow') fail(`${file}: \`toolPolicy.mode\` must be "allow"`);
  if (!isObject(raw.servers)) fail(`${file}: \`toolPolicy.servers\` must be an object`);
  const servers = {};
  for (const [name, tools] of Object.entries(raw.servers)) {
    if (!Array.isArray(tools)) fail(`${file}: \`toolPolicy.servers.${name}\` must be an array of tool names`);
    const set = new Set();
    for (const tool of tools) {
      if (typeof tool !== 'string' || !tool.trim()) fail(`${file}: \`toolPolicy.servers.${name}\` must contain non-empty tool names`);
      set.add(tool);
    }
    servers[name] = set;
  }
  return { mode: 'allow', servers };
}

// 运行时守卫：判断 server 的某次 tools/call 是否被策略允许。
// server 无策略声明 → 允许（声明缺失 = 不设限）；有策略但工具不在白名单 → 拒绝。
export function toolAllowed(policy, server, tool) {
  if (!policy || !policy.servers || !(server in policy.servers)) return true;
  return policy.servers[server].has(tool);
}
