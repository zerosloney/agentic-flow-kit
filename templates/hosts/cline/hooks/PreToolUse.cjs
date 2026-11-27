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
 *     permissionDecisionReason } }；正常退出且无输出 = 放行
 *   - 异常语义（对齐 PI 适配层）：hook 无法执行 / 超时 / 非零退出 / 输出不可解析 → 阻止（cancel），
 *     门禁失效不得退化成静默放行
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

// Windows 的 cmd.exe 对裸名命令先搜当前目录（项目根）再搜 PATH：项目根放一个假 flow-kit.cmd
// 就能静默熄灭全部门禁。因此不用裸名 spawn，改为显式沿 PATH 解析出绝对路径再调用；
// FLOW_KIT_CLI 可显式指定；解析不到按「门禁没跑成」处理（error → 阻止），fail-closed。
function resolveFlowKit() {
  if (process.env.FLOW_KIT_CLI) return process.env.FLOW_KIT_CLI;
  const exts = process.platform === 'win32' ? ['.cmd', '.bat', '.exe'] : [''];
  const dirs = String(process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, 'flow-kit' + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
const FLOW_KIT_BIN = resolveFlowKit();

// Windows 用整串命令（无 args 数组）：绝对路径绕开 cmd 的当前目录搜索，也不触发 DEP0190（shell+args）；
// 子命令均为本文件固定字面量，无注入面。
function spawnFlowKit(args, opts) {
  return process.platform === 'win32'
    ? spawnSync(`"${FLOW_KIT_BIN}" ${args.join(' ')}`, { shell: true, ...opts })
    : spawnSync(FLOW_KIT_BIN, args, opts);
}

// Cline 工具名 → 仓库 hook 工具名（喂给 .agents/hooks/*.cjs 的 tool_name）
const GATE_TOOL_ALIAS = {
  run_commands: 'bash',
  editor: 'write',
  apply_patch: 'write',
};

// 该工具名是否属于「命令门」范畴（shell 家族）；run_command 是 run_commands 的单数变体，漏认即静默放行
const SHELL_TOOLS = new Set(['run_commands', 'run_command', 'bash', 'execute_command', 'shell', 'terminal']);
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
  // input 优先用原始对象；缺失或非对象时置 null 而非 {}，否则对象恒真，
  // 只有字符串化 parameters 的宿主变体永远进不了下面的解析分支，会被空入参静默放行
  let input = tc.input && typeof tc.input === 'object' ? tc.input : null;
  if (!input) {
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

// 从写工具入参还原「拟写入内容」。Cline 现行 schema 是 write_to_file {path, content} 与
// replace_in_file {path, diff}；editor 家族才是 new_text / old_text / insert_line。
// 还原不了返回 null，由调用方 fail-closed——空内容会让内容判据静默失效。
const WRITE_CONTENT_KEYS = ['content', 'new_content', 'file_text'];
const WRITE_NEW_KEYS = ['new_text', 'new_string', 'newString'];
const WRITE_OLD_KEYS = ['old_text', 'old_string', 'oldString'];

function pickString(obj, keys) {
  for (const key of keys) {
    if (typeof obj[key] === 'string') return obj[key];
  }
  return undefined;
}

// Cline replace_in_file 的 diff 语法：------- SEARCH / ======= / +++++++ REPLACE，可含多块
function parseClineDiff(diff) {
  // 按 \n 切分、保留行尾 \r：CRLF 文件里的锚点文本必须原样保留，否则找不到匹配
  const lines = String(diff).split('\n');
  const hunks = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    if (lines[i].trim() !== '------- SEARCH') return null;
    i++;
    const search = [];
    while (i < lines.length && lines[i].trim() !== '=======') search.push(lines[i++]);
    if (i >= lines.length) return null;
    i++;
    const replace = [];
    while (i < lines.length && lines[i].trim() !== '+++++++ REPLACE') replace.push(lines[i++]);
    if (i >= lines.length) return null;
    i++;
    hunks.push({ search: search.join('\n'), replace: replace.join('\n') });
  }
  return hunks.length ? hunks : null;
}

// 逐块按首次出现替换，与 Cline 自身应用 diff 的顺序一致；任一块找不到锚点即视为还原失败
function applyClineDiff(text, hunks) {
  let out = text;
  for (const hunk of hunks) {
    const at = out.indexOf(hunk.search);
    if (at === -1) return null;
    out = out.slice(0, at) + hunk.replace + out.slice(at + hunk.search.length);
  }
  return out;
}

function buildWriteInput(input, cwd) {
  const i = input && typeof input === 'object' ? input : {};
  const filePath = typeof i.path === 'string' ? i.path
    : typeof i.file_path === 'string' ? i.file_path : '';
  if (!filePath) return null;

  const content = pickString(i, WRITE_CONTENT_KEYS);
  if (content !== undefined) return { file_path: filePath, content };

  if (typeof i.diff === 'string') {
    const hunks = parseClineDiff(i.diff);
    if (!hunks) return null;
    let before;
    try {
      before = fs.readFileSync(path.resolve(cwd, filePath), 'utf8');
    } catch {
      return null;
    }
    const after = applyClineDiff(before, hunks);
    return after === null ? null : { file_path: filePath, content: after };
  }

  const newText = pickString(i, WRITE_NEW_KEYS);
  if (newText !== undefined) {
    const writeInput = {
      file_path: filePath,
      content: newText,
      old_string: pickString(i, WRITE_OLD_KEYS) || undefined,
      new_string: newText,
    };
    if (typeof i.insert_line === 'number' && Number.isInteger(i.insert_line)) {
      writeInput.edits = [{ insert_line: i.insert_line, new_string: newText }];
    }
    return writeInput;
  }

  return null;
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
// 调用包内 hook，返回 { decision, reason, context }
// decision: allow / ask / deny / error；error = 门禁没跑成或答案不可用，调用方按阻止处理
function callRepoHook(hook, payload) {
  if (!FLOW_KIT_BIN) {
    return { decision: 'error', reason: 'flow-kit CLI 未沿 PATH 解析到（可用 FLOW_KIT_CLI 指定绝对路径）。为避免静默绕过，本次调用已阻止。' };
  }
  const r = spawnFlowKit(['hook', hook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    cwd: ROOT,
  });
  if (r.error) {
    return { decision: 'error', reason: `仓库 hook 调用失败（${hook}）：${r.error.message}。为避免静默绕过，本次调用已阻止。` };
  }
  if (r.status !== 0) {
    const detail = String(r.stderr || '').trim() || `exit ${r.status}`;
    return { decision: 'error', reason: `仓库 hook 未成功执行（${hook}）：${detail}。为避免静默绕过，本次调用已阻止。` };
  }
  const out = (r.stdout || '').trim();
  if (!out) return { decision: 'allow', reason: '' }; // 仓库 hook 契约：正常退出且无输出 = 放行
  try {
    const parsed = JSON.parse(out);
    const hso = parsed && typeof parsed === 'object' && parsed.hookSpecificOutput
      && typeof parsed.hookSpecificOutput === 'object'
      ? parsed.hookSpecificOutput
      : parsed;
    if (!hso || typeof hso !== 'object') throw new Error('unusable gate answer');
    const hasDecision = typeof hso.permissionDecision === 'string' && hso.permissionDecision;
    if (!hasDecision) {
      // 只带 additionalContext 的回复是合法放行 + 提示（如引擎面通知）
      const context = typeof hso.additionalContext === 'string' ? hso.additionalContext : '';
      if (!context) throw new Error('no decision and no context');
      return { decision: 'allow', reason: '', context };
    }
    return {
      decision: hso.permissionDecision,
      reason: hso.permissionDecisionReason || hso.reason || '',
      context: hso.additionalContext || '',
    };
  } catch {
    return { decision: 'error', reason: `仓库 hook 输出无法解析（${hook}）。为避免静默绕过，本次调用已阻止。` };
  }
}

// 把仓库结果翻译成 Cline 控制输出（HOOK_CONTROL\t{json}）
function emitControl(control) {
  process.stdout.write(`HOOK_CONTROL\t${JSON.stringify(control)}\n`);
}

function main() {
  // Windows 工具链/管道可能带 UTF-8 BOM，不剥会让合法 payload 在 parse 处失败
  const raw = readStdin().replace(/^\uFEFF/, '');
  if (!raw.trim()) return; // 无 payload，放行
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // 非空 payload 读不出来就无法判定工具与入参，放行等于绕过门禁；fail-closed
    emitControl({ cancel: true, cancelReason: 'Cline payload 无法解析（JSON 非法），按 fail-closed 阻止本次调用。' });
    return;
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
    if (decision === 'deny' || decision === 'error') {
      emitControl({ cancel: true, cancelReason: reason || '命令被仓库门禁拒绝' });
    } else if (decision === 'ask') {
      emitControl({ review: true, context: reason || '命令需要用户确认' });
    }
    return;
  }

  // 写前门：只认编辑器家族工具名（Cline editor/apply_patch → write）
  if (WRITE_TOOLS.has(name)) {
    const writeInput = buildWriteInput(input, cwd);
    if (!writeInput) {
      emitControl({ cancel: true, cancelReason: '无法从工具入参还原拟写入内容，写前门禁无法校验，本次写入已阻止。' });
      return;
    }
    const writePayload = toRepoPayload('write', writeInput, cwd);
    const { decision, reason, context } = callRepoHook('pre-write-check', writePayload);
    if (decision === 'deny' || decision === 'error') {
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