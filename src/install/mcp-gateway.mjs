import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MCP_GATEWAY_CONFIG_REL = '.agents/config/mcp-gateway.json';
export const MCP_AUDIT_LOG_REL = '.agents/mcp-audit.jsonl';

// 默认 MCP RBAC 角色与等级策略
export const DEFAULT_GATEWAY_POLICY = {
  mode: 'rbac',
  roles: {
    planner: {
      allow: ['wiki_search', 'read_file', 'list_dir', 'read_resource'],
      deny: ['write_file', 'edit_file', 'execute_command', 'shell', 'bash'],
    },
    reviewer: {
      allow: ['wiki_search', 'read_file', 'list_dir', 'git_diff', 'read_resource'],
      deny: ['write_file', 'edit_file', 'execute_command', 'shell', 'bash'],
    },
    coder: {
      allow: ['*'],
      deny: ['dangerous_system_exec'],
    },
    admin: {
      allow: ['*'],
      deny: [],
    },
  },
  levels: {
    L0: ['wiki_search', 'read_file', 'list_dir', 'git_diff', 'read_resource'],
    L1: ['write_file', 'edit_file', 'create_dir', 'delete_file'],
    L2: ['execute_command', 'shell', 'bash', 'run_script'],
    L3: ['format_disk', 'drop_database', 'curl_pipe_sh'],
  },
  parameterRules: [
    {
      tool: '*',
      denyPatterns: [
        'rm\\s+-rf\\s+[/~]',
        'curl\\s+.*\\|\\s*(ba)?sh',
        'wget\\s+.*\\|\\s*(ba)?sh',
        'chmod\\s+777',
        '>\\s*/etc/',
        'DROP\\s+DATABASE',
        'DROP\\s+TABLE',
      ],
    },
    {
      tool: 'write_file',
      denyPaths: [
        '**/.git/**',
        '**/.env*',
        '**/.agents/keys/**',
      ],
    },
    {
      tool: 'edit_file',
      denyPaths: [
        '**/.git/**',
        '**/.env*',
        '**/.agents/keys/**',
      ],
    },
  ],
  rateLimits: {
    maxCallsPerHour: 1000,
    maxCallsPerMinute: 60,
    maxTokensPerCall: 64000,
    maxTokensPerHour: 500000,
  },
};

function mergeRoleConfig(base, override) {
  const merged = { ...base, ...override };
  for (const key of ['allow', 'deny']) {
    if (Array.isArray(base?.[key]) || Array.isArray(override?.[key])) {
      merged[key] = [
        ...new Set([
          ...(Array.isArray(base?.[key]) ? base[key] : []),
          ...(Array.isArray(override?.[key]) ? override[key] : []),
        ]),
      ];
    }
  }
  return merged;
}

export function readGatewayPolicy(target) {
  const file = path.join(target, MCP_GATEWAY_CONFIG_REL);
  if (!fs.existsSync(file)) {
    return DEFAULT_GATEWAY_POLICY;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const roles = { ...DEFAULT_GATEWAY_POLICY.roles };
    for (const [name, config] of Object.entries(parsed.roles || {})) {
      roles[name] = mergeRoleConfig(DEFAULT_GATEWAY_POLICY.roles[name], config);
    }
    return {
      mode: parsed.mode || DEFAULT_GATEWAY_POLICY.mode,
      roles,
      levels: { ...DEFAULT_GATEWAY_POLICY.levels, ...(parsed.levels || {}) },
      parameterRules: Array.isArray(parsed.parameterRules) ? parsed.parameterRules : DEFAULT_GATEWAY_POLICY.parameterRules,
      rateLimits: { ...DEFAULT_GATEWAY_POLICY.rateLimits, ...(parsed.rateLimits || {}) },
    };
  } catch {
    return DEFAULT_GATEWAY_POLICY;
  }
}

export function matchPathPattern(pattern, filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const p = pattern.replace(/\\/g, '/');
  if (p.startsWith('**/')) {
    const sub = p.slice(3);
    if (sub.endsWith('/**')) {
      const mid = sub.slice(0, -3);
      return normalized.includes(`/${mid}/`) || normalized.startsWith(`${mid}/`) || normalized === mid;
    }
    if (sub.endsWith('*')) {
      const prefix = sub.slice(0, -1);
      return normalized.includes(`/${prefix}`) || normalized.startsWith(prefix);
    }
    return normalized.endsWith(`/${sub}`) || normalized === sub;
  }
  const escaped = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/(?<!\.)\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(normalized);
}

export function matchArgsPattern(pattern, args) {
  if (!args) return false;
  const str = typeof args === 'string' ? args : JSON.stringify(args);
  try {
    const re = new RegExp(pattern, 'i');
    return re.test(str);
  } catch {
    return str.includes(pattern);
  }
}

export function evaluateMcpCall({
  target,
  policy = null,
  role = 'coder',
  server = 'unknown',
  tool,
  args = {},
  tokens = 0,
}) {
  const activePolicy = policy || (target ? readGatewayPolicy(target) : DEFAULT_GATEWAY_POLICY);

  // 1. Prohibited level check (L3)
  const l3Tools = new Set(activePolicy.levels?.L3 || []);
  if (l3Tools.has(tool)) {
    return {
      allowed: false,
      decision: 'DENIED_POLICY',
      reason: `Tool '${tool}' is categorized as prohibited L3 dangerous operation`,
      level: 'L3',
      role,
      server,
      tool,
    };
  }

  // Determine level
  let level = 'L0';
  for (const [lvl, tools] of Object.entries(activePolicy.levels || {})) {
    if (Array.isArray(tools) && tools.includes(tool)) {
      level = lvl;
      break;
    }
  }

  // 2. Role-Based Access Control (RBAC)
  const roleConfig = activePolicy.roles?.[role];
  if (!roleConfig) {
    return {
      allowed: false,
      decision: 'DENIED_RBAC',
      reason: `Unknown role '${role}' is not authorized to invoke tool '${tool}'`,
      level,
      role,
      server,
      tool,
    };
  }
  const allows = Array.isArray(roleConfig.allow) ? roleConfig.allow : [];
  const denies = Array.isArray(roleConfig.deny) ? roleConfig.deny : [];

  const isExplicitlyAllowed = allows.includes(tool);
  const isWildcardAllowed = allows.includes('*');
  const isExplicitlyDenied = denies.includes(tool);
  const isWildcardDenied = denies.includes('*');

  if (isExplicitlyDenied) {
    return {
      allowed: false,
      decision: 'DENIED_RBAC',
      reason: `Role '${role}' is explicitly denied from invoking tool '${tool}'`,
      level,
      role,
      server,
      tool,
    };
  }

  if (!isExplicitlyAllowed) {
    if (isWildcardDenied || (!isWildcardAllowed && Array.isArray(roleConfig.allow))) {
      return {
        allowed: false,
        decision: 'DENIED_RBAC',
        reason: `Role '${role}' is not authorized to invoke tool '${tool}'`,
        level,
        role,
        server,
        tool,
      };
    }
  }

  // 3. Parameter Guardrails
  if (Array.isArray(activePolicy.parameterRules)) {
    for (const rule of activePolicy.parameterRules) {
      if (rule.tool === '*' || rule.tool === tool) {
        if (Array.isArray(rule.denyPatterns)) {
          for (const pat of rule.denyPatterns) {
            if (matchArgsPattern(pat, args)) {
              return {
                allowed: false,
                decision: 'DENIED_PARAM',
                reason: `Arguments matched prohibited pattern: ${pat}`,
                level,
                role,
                server,
                tool,
              };
            }
          }
        }
        if (Array.isArray(rule.denyPaths)) {
          const candidatePath = args?.path || args?.file || args?.filepath || args?.target || args?.destination;
          if (candidatePath && typeof candidatePath === 'string') {
            for (const pathPat of rule.denyPaths) {
              if (matchPathPattern(pathPat, candidatePath)) {
                return {
                  allowed: false,
                  decision: 'DENIED_PARAM',
                  reason: `Target path '${candidatePath}' matches protected path rule: ${pathPat}`,
                  level,
                  role,
                  server,
                  tool,
                };
              }
            }
          }
        }
      }
    }
  }

  // 4. Rate Limit & Token Budget
  if (activePolicy.rateLimits) {
    const limits = activePolicy.rateLimits;
    if (limits.maxTokensPerCall && tokens > limits.maxTokensPerCall) {
      return {
        allowed: false,
        decision: 'DENIED_RATE_LIMIT',
        reason: `Token consumption ${tokens} exceeds per-call limit (${limits.maxTokensPerCall})`,
        level,
        role,
        server,
        tool,
      };
    }

    if (target) {
      const auditLogPath = path.join(target, MCP_AUDIT_LOG_REL);
      if (fs.existsSync(auditLogPath)) {
        const now = Date.now();
        const oneMinAgo = now - 60 * 1000;
        const oneHourAgo = now - 3600 * 1000;
        let callsInMin = 0;
        let callsInHour = 0;
        let tokensInHour = 0;

        try {
          const lines = fs.readFileSync(auditLogPath, 'utf8').trim().split('\n').filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i -= 1) {
            try {
              const item = JSON.parse(lines[i]);
              const tTime = new Date(item.timestamp).getTime();
              if (tTime >= oneHourAgo) {
                callsInHour += 1;
                tokensInHour += (item.tokens || 0);
                if (tTime >= oneMinAgo) {
                  callsInMin += 1;
                }
              } else {
                break;
              }
            } catch {
              // ignore malformed lines
            }
          }
        } catch {
          // ignore read error
        }

        if (limits.maxCallsPerMinute && callsInMin >= limits.maxCallsPerMinute) {
          return {
            allowed: false,
            decision: 'DENIED_RATE_LIMIT',
            reason: `Call frequency limit exceeded (${limits.maxCallsPerMinute} calls/min)`,
            level,
            role,
            server,
            tool,
          };
        }
        if (limits.maxCallsPerHour && callsInHour >= limits.maxCallsPerHour) {
          return {
            allowed: false,
            decision: 'DENIED_RATE_LIMIT',
            reason: `Hourly call limit exceeded (${limits.maxCallsPerHour} calls/hour)`,
            level,
            role,
            server,
            tool,
          };
        }
        if (limits.maxTokensPerHour && tokensInHour + (tokens || 0) > limits.maxTokensPerHour) {
          return {
            allowed: false,
            decision: 'DENIED_RATE_LIMIT',
            reason: `Hourly token quota exceeded (${limits.maxTokensPerHour} tokens/hour)`,
            level,
            role,
            server,
            tool,
          };
        }
      }
    }
  }

  return {
    allowed: true,
    decision: 'ALLOWED',
    reason: null,
    level,
    role,
    server,
    tool,
  };
}

export function recordMcpAudit(target, entry) {
  const auditFile = path.join(target, MCP_AUDIT_LOG_REL);
  const dir = path.dirname(auditFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const record = {
    schema: 'flow-kit-mcp-audit/v1',
    id: `aud_${crypto.randomBytes(6).toString('hex')}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    role: entry.role || 'coder',
    server: entry.server || 'unknown',
    tool: entry.tool,
    level: entry.level || 'L0',
    argsSummary: typeof entry.args === 'string' ? entry.args : JSON.stringify(entry.args || {}).slice(0, 200),
    decision: entry.decision || 'ALLOWED',
    reason: entry.reason || null,
    durationMs: Number.isInteger(entry.durationMs) ? entry.durationMs : 0,
    tokens: Number.isInteger(entry.tokens) ? entry.tokens : 0,
  };

  fs.appendFileSync(auditFile, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export function queryMcpAudit(target, options = {}) {
  const auditFile = path.join(target, MCP_AUDIT_LOG_REL);
  if (!fs.existsSync(auditFile)) {
    return {
      entries: [],
      summary: {
        totalCalls: 0,
        allowedCalls: 0,
        deniedCalls: 0,
        rateLimitedCalls: 0,
        totalTokens: 0,
        byRole: {},
        byTool: {},
        anomalies: [],
      },
    };
  }

  const {
    days = 7,
    role,
    server,
    tool,
    decision,
    limit = 100,
  } = options;

  const since = Date.now() - (days * 24 * 3600 * 1000);
  const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);

  const entries = [];
  const summary = {
    totalCalls: 0,
    allowedCalls: 0,
    deniedCalls: 0,
    rateLimitedCalls: 0,
    totalTokens: 0,
    byRole: {},
    byTool: {},
    anomalies: [],
  };

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let item;
    try {
      item = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const itemTime = new Date(item.timestamp).getTime();
    if (days > 0 && itemTime < since) continue;

    summary.totalCalls += 1;
    if (item.decision === 'ALLOWED') {
      summary.allowedCalls += 1;
    } else {
      summary.deniedCalls += 1;
      if (item.decision === 'DENIED_RATE_LIMIT') summary.rateLimitedCalls += 1;
      summary.anomalies.push(item);
    }
    summary.totalTokens += (item.tokens || 0);

    const r = item.role || 'unknown';
    if (!summary.byRole[r]) summary.byRole[r] = { total: 0, allowed: 0, denied: 0 };
    summary.byRole[r].total += 1;
    if (item.decision === 'ALLOWED') summary.byRole[r].allowed += 1;
    else summary.byRole[r].denied += 1;

    const t = item.tool || 'unknown';
    if (!summary.byTool[t]) summary.byTool[t] = { total: 0, allowed: 0, denied: 0 };
    summary.byTool[t].total += 1;
    if (item.decision === 'ALLOWED') summary.byTool[t].allowed += 1;
    else summary.byTool[t].denied += 1;

    if (role && item.role !== role) continue;
    if (server && item.server !== server) continue;
    if (tool && item.tool !== tool) continue;
    if (decision && item.decision !== decision) continue;

    if (entries.length < limit) {
      entries.push(item);
    }
  }

  return { entries, summary };
}

export function checkMcpGatewayHealth(target, t) {
  const configFile = path.join(target, MCP_GATEWAY_CONFIG_REL);
  if (fs.existsSync(configFile)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (!cfg || typeof cfg !== 'object') {
        return {
          ok: false,
          name: 'mcp-gateway config',
          detail: t('doctor.mcpConfigInvalid', { path: MCP_GATEWAY_CONFIG_REL }),
        };
      }
    } catch {
      return {
        ok: false,
        name: 'mcp-gateway config',
        detail: t('doctor.mcpConfigInvalid', { path: MCP_GATEWAY_CONFIG_REL }),
      };
    }
  }

  const auditFile = path.join(target, MCP_AUDIT_LOG_REL);
  if (!fs.existsSync(auditFile)) {
    return null;
  }

  const { summary } = queryMcpAudit(target, { days: 1 });
  if (summary.deniedCalls > 5) {
    return {
      ok: false,
      warn: true,
      name: 'mcp-audit anomalies',
      detail: t('doctor.mcpAuditAnomalies', { denied: summary.deniedCalls, total: summary.totalCalls }),
      fix: t('doctor.mcpAuditHint'),
    };
  }

  return {
    ok: true,
    name: 'mcp-audit',
    detail: t('doctor.mcpAuditOk', { total: summary.totalCalls, denied: summary.deniedCalls }),
  };
}
