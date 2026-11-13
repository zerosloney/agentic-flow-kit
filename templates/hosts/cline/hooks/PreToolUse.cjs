#!/usr/bin/env node
'use strict';
/**
 * Cline 宿主 → 仓库既有 .cjs 门禁的协议适配层（本机私有，.cline/ 已 gitignore）。
 *
 * 单源纪律：判据仍只养在 .agents/hooks/*.cjs（gates.json / pre-shell-check.cjs /
 * pre-write-check.cjs）；本文件只做字段映射、进程调用与结果翻译，不复制任何判据。
 * 参照先例：.pi/extensions/lib/gates-core.cjs（PI 宿主同型适配层）。
 *
 * 协议差异（实证来源：解包本机 cline CLI @cline/core）：
 *   - Cline stdin：{ hookName:"tool_call", tool_call:{id,name,input}, preToolUse:{toolName,parameters},
 *     workspaceRoots:[...], taskId, iteration, ... }（parameters 为字符串化 JSON，input 为原始对象）
 *   - 仓库 hook stdin：{ tool_name, llm_tool_name, tool_input, cwd, workspace_roots,
 *     hook_event_name:"PreToolUse" }（见 pre-shell-check.cjs:22-24 / pre-write-check.cjs:30）
 *   - 仓库 hook stdout：{ hookSpecificOutput:{ permissionDecision:"deny"/"ask"/"allow",
 *     permissionDecisionReason } }；无输出 = 放行
 *   - Cline 控制输出：stdout JSON { cancel:true, cancelReason } 或 { review:true, context }，
 *     推荐加 "HOOK_CONTROL\t" 前缀行（E3() 只取该前缀行并 JSON.parse，K3() 消费）
 *
 * 工具名归一（Cline → 仓库正则）：
 *   - run_commands → bash（pre-shell-check.cjs:48-49 认 runcommand|bash|powershell|shell|terminal|executecommand）
 *   - editor / apply_patch → write（pre-write-check.cjs:61 认 edit|write|multiedit|search_replace）
 *
 * 可运行自检：node .cline/hooks/PreToolUse.cjs --selftest
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TIMEOUT_MS = 30000;
const ROOT = path.resolve(__dirname, '..', '..'); // .cline/hooks → 仓库根

// Cline 工具名 → 仓库 hook 工具名（喂给 .agents/hooks/*.cjs 的 tool_name）
const GATE_TOOL_ALIAS = {
  run_commands: 'bash',
  editor: 'write',
  apply_patch: 'write',
};

// 该工具名是否属于「命令门」范畴（shell 家族）
const SHELL_TOOLS = new Set(['run_commands', 'bash', 'execute_command', 'shell', 'terminal']);
// 该工具名是否属于「写前门」范畴
const WRITE_TOOLS = new Set(['editor', 'apply_patch', 'write', 'edit', 'multiedit', 'replace_in_file', 'write_to_file']);

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// 从 Cline payload 提取 tool_call 名称与原始 input 对象
function extractToolCall(payload) {
  if (!payload || typeof payload !== 'object') return { name: '', input: {} };
  const tc = payload.tool_call && typeof payload.tool_call === 'object' ? payload.tool_call : {};
  const ptu = payload.preToolUse && typeof payload.preToolUse === 'object' ? payload.preToolUse : {};
  const name = typeof tc.name === 'string' && tc.name ? tc.name
    : typeof ptu.toolName === 'string' && ptu.toolName ? ptu.toolName : '';
  // input 优先用原始对象；若只有字符串化 parameters（部分宿主变体）则尝试 JSON 解析
  let input = tc.input && typeof tc.input === 'object' ? tc.input : {};
  if (!input || typeof input !== 'object') {
    const raw = ptu.parameters;
    if (typeof raw === 'string' && raw.trim()) {
      try { input = JSON.parse(raw); } catch { input = {}; }
    }
  }
  return { name, input: input && typeof input === 'object' ? input : {} };
}

// 从 Cline tool_call.input 提取命令文本（run_commands 的 input 是 {command} 或 {commands:[]} 或 {cmd}）
function extractCommand(input) {
  if (!input || typeof input !== 'object') return '';
  if (typeof input.command === 'string') return input.command;
  if (typeof input.cmd === 'string') return input.cmd;
  if (Array.isArray(input.commands)) {
    return input.commands.filter((c) => typeof c === 'string').join('\n');
  }
  // 兜底：扫全部字符串值，拼接（与 pre-shell-check.cjs 的 extractCommand 行为一致）
  return Object.values(input)
    .filter((v) => typeof v === 'string')
    .join(' ');
}

// 构造仓库 hook 需要的 stdin payload
function toRepoPayload(gateTool, input, cwd) {
  const i = input && typeof input === 'object' ? input : {};
  return {
    session_id: 'cline-host',
    transcript_path: '',
    cwd,
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: gateTool,
    llm_tool_name: gateTool,
    workspace_roots: [cwd],
    tool_input: i,
  };
}
// 调用包内 hook，返回 { decision, reason, context }（无输出 = allow）
function callRepoHook(hook, payload) {
  const r = spawnSync('flow-kit', ['hook', hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    cwd: ROOT,
    shell: process.platform === 'win32',
  });
  if (r.error) {
    return { decision: 'allow', reason: `仓库 hook 调用失败（${r.error.message}），放行` };
  }
  const out = (r.stdout || '').trim();
  if (!out) return { decision: 'allow', reason: '' };
  try {
    const parsed = JSON.parse(out);
    const hso = parsed && typeof parsed === 'object' && parsed.hookSpecificOutput
      ? parsed.hookSpecificOutput
      : parsed;
    const decision = hso.permissionDecision || 'allow';
    return {
      decision,
      reason: hso.permissionDecisionReason || hso.reason || '',
      context: hso.additionalContext || '',
    };
  } catch {
    return { decision: 'allow', reason: '' };
  }
}

// 把仓库结果翻译成 Cline 控制输出（HOOK_CONTROL\t{json}）
function emitControl(control) {
  process.stdout.write(`HOOK_CONTROL\t${JSON.stringify(control)}\n`);
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) return; // 无 payload，放行
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // 解析失败，放行
  }

  const { name, input } = extractToolCall(payload);
  const cwd = Array.isArray(payload.workspaceRoots) && payload.workspaceRoots[0]
    ? payload.workspaceRoots[0]
    : ROOT;

  // 命令门：只认 shell 家族工具名（Cline run_commands → bash）
  if (SHELL_TOOLS.has(name)) {
    const command = extractCommand(input);
    if (!command) return; // 无命令文本，放行
    const shellPayload = toRepoPayload('bash', { command }, cwd);
    const { decision, reason } = callRepoHook('pre-shell-check', shellPayload);
    if (decision === 'deny') {
      emitControl({ cancel: true, cancelReason: reason || '命令被仓库门禁拒绝' });
    } else if (decision === 'ask') {
      emitControl({ review: true, context: reason || '命令需要用户确认' });
    }
    return;
  }

  // 写前门：只认编辑器家族工具名（Cline editor/apply_patch → write）
  if (WRITE_TOOLS.has(name)) {
    const filePath = typeof input.path === 'string' ? input.path : '';
    if (!filePath) return; // 无文件路径，放行
    const writeInput = {
      file_path: filePath,
      content: input.new_text || '',
      old_string: input.old_text || undefined,
      new_string: input.new_text || undefined,
    };
    if (typeof input.insert_line === 'number' && Number.isInteger(input.insert_line)) {
      writeInput.edits = [{ insert_line: input.insert_line, new_string: input.new_text || '' }];
    }
    const writePayload = toRepoPayload('write', writeInput, cwd);
    const { decision, reason, context } = callRepoHook('pre-write-check', writePayload);
    if (decision === 'deny') {
      emitControl({ cancel: true, cancelReason: reason || '写入被仓库门禁拒绝' });
    } else if (decision === 'ask') {
      emitControl({ review: true, context: reason || '写入需要用户确认' });
    } else if (context) {
      emitControl({ context });
    }
    return;
  }

  // 非门禁工具（read_files / search_codebase / skills 等），放行
}
// ── 自检 ────────────────────────────────────────────
// 用子进程喂模拟 payload，验证字段映射与翻译（不触碰仓库文件）。
function runWithPayload(payload) {
  const r = spawnSync(process.execPath, [__filename], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    cwd: ROOT,
    env: { ...process.env, CLINE_HOOK_SELFTEST: '1' },
  });
  return (r.stdout || '') + (r.stderr || '');
}

function selfTest() {
  const cases = [
    {
      name: 'run_commands deny → cancel',
      payload: { hookName: 'tool_call', tool_call: { name: 'run_commands', input: { command: 'git reset --hard' } }, workspaceRoots: [ROOT] },
      expect: 'cancel',
    },
    {
      name: 'run_commands ask → review',
      payload: { hookName: 'tool_call', tool_call: { name: 'run_commands', input: { command: 'git checkout main' } }, workspaceRoots: [ROOT] },
      expect: 'review',
    },
    {
      name: 'run_commands allow → silent',
      payload: { hookName: 'tool_call', tool_call: { name: 'run_commands', input: { command: 'git status' } }, workspaceRoots: [ROOT] },
      expect: 'silent',
    },
    {
      name: 'editor 写 .agents 保护面 → cancel',
      payload: { hookName: 'tool_call', tool_call: { name: 'editor', input: { path: path.join(ROOT, '.agents', 'hooks', 'gates.json'), new_text: '{}' } }, workspaceRoots: [ROOT] },
      expect: 'cancel',
    },
    {
      name: 'read_files 放行 → silent',
      payload: { hookName: 'tool_call', tool_call: { name: 'read_files', input: { files: [path.join(ROOT, 'AGENTS.md')] } }, workspaceRoots: [ROOT] },
      expect: 'silent',
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const out = runWithPayload(c.payload);
    const isCancel = out.includes('"cancel":true');
    const isReview = out.includes('"review":true');
    const silent = out.trim() === '';
    let ok = false;
    if (c.expect === 'cancel') ok = isCancel;
    else if (c.expect === 'review') ok = isReview;
    else if (c.expect === 'silent') ok = silent;
    console.log(`${ok ? '✅' : '❌'} ${c.name}（期望 ${c.expect}）`);
    if (!ok) {
      console.log('   输出: ' + JSON.stringify(out));
      failed++;
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv.includes('--selftest')) {
  selfTest();
} else {
  main();
}