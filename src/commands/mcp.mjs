import { flag } from '../cli/args.mjs';
import { resolveTarget } from '../install/target.mjs';
import {
  evaluateMcpCall,
  recordMcpAudit,
  queryMcpAudit,
} from '../install/mcp-gateway.mjs';

function fail(detail, code = 'MCP_ERROR') {
  const err = new Error(detail);
  err.code = code;
  throw err;
}

export function mcpCommand({ args, t }) {
  const subcommand = args._[1] || 'audit';
  const target = resolveTarget(args);

  switch (subcommand) {
    case 'audit': {
      const days = args.days ? Number(args.days) : 7;
      const role = args.role || null;
      const server = args.server || null;
      const tool = args.tool || null;
      const decision = args.decision || null;
      const limit = args.limit ? Number(args.limit) : 50;
      const isJson = flag(args, 'json');
      const isSummary = flag(args, 'summary');

      const res = queryMcpAudit(target, { days, role, server, tool, decision, limit });

      if (isJson) {
        console.log(JSON.stringify(isSummary ? res.summary : res, null, 2));
        return 0;
      }

      if (res.summary.totalCalls === 0) {
        console.log(t('mcp.auditNone', { days }));
        return 0;
      }

      console.log(t('mcp.auditTitle', { days }));
      console.log(t('mcp.auditSummary', {
        total: res.summary.totalCalls,
        allowed: res.summary.allowedCalls,
        denied: res.summary.deniedCalls,
        tokens: res.summary.totalTokens,
      }));

      if (!isSummary && res.entries.length > 0) {
        console.log('');
        for (const entry of res.entries) {
          const time = entry.timestamp.slice(0, 19).replace('T', ' ');
          const status = entry.decision === 'ALLOWED' ? '✅ ALLOWED' : `❌ ${entry.decision}`;
          const dur = entry.durationMs ? ` (${entry.durationMs}ms)` : '';
          console.log(`[${time}] ${status} ${entry.role} -> ${entry.tool} [${entry.level}]${dur}`);
          if (entry.reason) {
            console.log(`  └─ Reason: ${entry.reason}`);
          }
        }
      }

      return 0;
    }

    case 'check-call': {
      const tool = args._[2];
      if (!tool) {
        fail(t('error.mcpCheckUsage'), 'BAD_ARGS');
      }

      const role = args.role || 'coder';
      const server = args.server || 'unknown';
      let parsedArgs = {};
      if (args.args) {
        try {
          parsedArgs = JSON.parse(args.args);
        } catch (e) {
          fail(t('error.mcpArgsInvalid', { detail: e.message }), 'BAD_ARGS');
        }
      }
      const tokens = args.tokens ? Number(args.tokens) : 0;

      const evalRes = evaluateMcpCall({
        target,
        role,
        server,
        tool,
        args: parsedArgs,
        tokens,
      });

      if (flag(args, 'record')) {
        recordMcpAudit(target, {
          role,
          server,
          tool,
          level: evalRes.level,
          args: parsedArgs,
          decision: evalRes.decision,
          reason: evalRes.reason,
          tokens,
        });
      }

      if (flag(args, 'json')) {
        console.log(JSON.stringify(evalRes, null, 2));
        return evalRes.allowed ? 0 : 1;
      }

      if (evalRes.allowed) {
        console.log(t('mcp.checkAllowed', { tool, role, level: evalRes.level }));
        return 0;
      }

      console.log(t('mcp.checkDenied', {
        tool,
        role,
        decision: evalRes.decision,
        reason: evalRes.reason,
      }));
      return 1;
    }

    case 'stats': {
      const days = args.days ? Number(args.days) : 30;
      const res = queryMcpAudit(target, { days });

      if (flag(args, 'json')) {
        console.log(JSON.stringify(res.summary, null, 2));
        return 0;
      }

      console.log(t('mcp.statsTitle', { days }));
      console.log(t('mcp.auditSummary', {
        total: res.summary.totalCalls,
        allowed: res.summary.allowedCalls,
        denied: res.summary.deniedCalls,
        tokens: res.summary.totalTokens,
      }));

      if (Object.keys(res.summary.byRole).length > 0) {
        console.log('\nBy Role:');
        for (const [r, s] of Object.entries(res.summary.byRole)) {
          console.log(`  - ${r}: total ${s.total}, allowed ${s.allowed}, denied ${s.denied}`);
        }
      }

      if (Object.keys(res.summary.byTool).length > 0) {
        console.log('\nBy Tool:');
        for (const [tl, s] of Object.entries(res.summary.byTool)) {
          console.log(`  - ${tl}: total ${s.total}, allowed ${s.allowed}, denied ${s.denied}`);
        }
      }

      return 0;
    }

    default:
      fail(t('error.mcpUsage'), 'BAD_ARGS');
  }
}
