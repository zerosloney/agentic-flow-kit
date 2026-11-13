#!/usr/bin/env node
'use strict';
/**
 * PI 宿主 → 仓库既有 .cjs 门禁的协议适配层（本机私有，.pi/ 已 gitignore）。
 * 单源纪律：判据仍只养在 .agents/hooks/*.cjs；本文件只做字段映射、进程调用与结果解析。
 * 可运行自检：node .pi/extensions/lib/gates-core.cjs
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TIMEOUT_MS = 30000;

// 代码执行类工具的门禁视图：pre-shell-check.cjs:49 只认 bash/shell 家族工具名，
// 故在适配层把新工具规范化为 bash 并交出其命令文本；判据仍单源在 .agents/hooks/。
const GATE_TOOL_ALIAS = { ctx_execute: 'bash', ctx_batch: 'bash' };

function toShellCommand(toolName, input) {
  const i = input && typeof input === 'object' ? input : {};
  if (toolName === 'bash') return typeof i.command === 'string' ? i.command : '';
  if (toolName === 'ctx_execute') return typeof i.code === 'string' ? i.code : '';
  if (toolName === 'ctx_batch') {
    return Array.isArray(i.commands) ? i.commands.filter((c) => typeof c === 'string').join('\n') : '';
  }
  return '';
}

// PI 工具入参 → 门禁脚本所需的 PreToolUse/PostToolUse stdin payload
function toHookPayload(toolName, input, cwd, hookEventName) {
  const i = input && typeof input === 'object' ? input : {};
  const gateTool = GATE_TOOL_ALIAS[toolName] || toolName;
  const payload = {
    session_id: 'pi-host',
    transcript_path: '',
    cwd,
    permission_mode: 'default',
    hook_event_name: hookEventName || 'PreToolUse',
    tool_name: gateTool,
    llm_tool_name: gateTool,
    workspace_roots: [cwd],
    tool_input: {},
  };
  if (toolName === 'bash' || GATE_TOOL_ALIAS[toolName]) {
    payload.tool_input = { command: toShellCommand(toolName, i) };
  } else if (toolName === 'write') {
    payload.tool_input = { file_path: i.path, content: i.content };
  } else if (toolName === 'edit') {
    payload.tool_input = {
      file_path: i.path,
      edits: Array.isArray(i.edits)
        ? i.edits.map((e) => ({ old_string: e && e.oldText, new_string: e && e.newText }))
        : [],
    };
  }
  return payload;
}

// 门脚本 stdout 是单行 JSON；无输出 = 放行。跳过日志行，取最后一个判定对象。
function parseGateOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  for (const line of text.split(/\r?\n/).reverse()) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try {
      const h = JSON.parse(s).hookSpecificOutput;
      if (!h || typeof h !== 'object') continue;
      return {
        decision: String(h.permissionDecision || ''),
        reason: String(h.permissionDecisionReason || ''),
        context: String(h.additionalContext || ''),
      };
    } catch { /* 非判定行 */ }
  }
  return null;
}

function runGate(scriptName, payload, cwd) {
  const hook = scriptName.replace(/\.(cjs|mjs)$/, '');
  const r = spawnSync('flow-kit', ['hook', hook], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  return {
    failed: Boolean(r.error) || r.status !== 0,
    failure: r.error ? String(r.error.message || r.error) : String((r.stderr || '').trim()),
    status: r.status,
    output: parseGateOutput(r.stdout),
  };
}

// ── L1 自保护：.pi/ 接线区（本机私有、git 不可见）────────
// 接线完整性基线：两个接线文件 + 包内 CLI；缺一即告警。
// （门实现随包分发，不再要求项目内存在 .agents/hooks 脚本。）
const REQUIRED_FILES = [
  '.pi/extensions/shipyard-gates.ts',
  '.pi/extensions/lib/gates-core.cjs',
];

function normalizeRel(target, cwd) {
  if (typeof target !== 'string' || !target) return '';
  const abs = path.isAbsolute(target) ? path.resolve(target) : path.resolve(cwd, target);
  return path.relative(cwd, abs).replace(/\\/g, '/');
}

function isProtectedPiPath(target, cwd) {
  const rel = normalizeRel(target, cwd);
  return rel === '.pi' || rel.startsWith('.pi/');
}

// bash 通道：须同时命中 .pi 路径引用 + 写入语义，避免拦掉只读执行。
// 重定向单独判：不能用裸 `>`（JS 箭头函数 `=>` 会造成大面积误伤）。
const PI_REF_RE = /(?:^|[^A-Za-z0-9_])\.pi[\\/]/i;
const WRITE_VERB_RE = /\b(?:rm|del|erase|rmdir|rd|mv|move|rename|ren|unlink|cp|copy|tee|touch|mkdir|md|sed\s+-i|set-content|add-content|out-file|new-item|writeFileSync|writeFile|createWriteStream|appendFileSync|unlinkSync|rmSync|renameSync)\b/i;
const REDIRECT_RE = /(?:^|[^=])>{1,2}\s*(?:[^\s]*[\\/])?\.pi[\\/]/i;

function isPiWriteCommand(command) {
  if (typeof command !== 'string' || !command) return false;
  if (!PI_REF_RE.test(command)) return false;
  return WRITE_VERB_RE.test(command) || REDIRECT_RE.test(command);
}

function checkWiring(cwd) {
  const missing = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(cwd, f)));
  const cli = spawnSync('flow-kit', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (cli.error || cli.status !== 0) missing.push('flow-kit CLI');
  return { ok: missing.length === 0, missing };
}

module.exports = { toHookPayload, toShellCommand, parseGateOutput, runGate, isProtectedPiPath, isPiWriteCommand, checkWiring };

// ── assert 驱动自检（require.main 时才会跑；被 PI 加载时不执行）──
if (require.main === module) {
  const cwd = path.resolve(__dirname, '..', '..', '..');
  const cases = [];
  const check = (name, ok) => cases.push([name, Boolean(ok)]);

  const bash = toHookPayload('bash', { command: 'node -v' }, cwd);
  check('bash → command / tool_name / cwd', bash.tool_input.command === 'node -v' && bash.tool_name === 'bash' && bash.cwd === cwd);
  const write = toHookPayload('write', { path: 'backend/A.cs', content: 'x' }, cwd);
  check('write → file_path / content', write.tool_input.file_path === 'backend/A.cs' && write.tool_input.content === 'x');
  const edit = toHookPayload('edit', { path: 'backend/A.cs', edits: [{ oldText: 'a', newText: 'b' }] }, cwd);
  check('edit → oldText/newText 转 old_string/new_string',
    edit.tool_input.file_path === 'backend/A.cs' && edit.tool_input.edits[0].old_string === 'a' && edit.tool_input.edits[0].new_string === 'b');

  const exec = toHookPayload('ctx_execute', { code: 'console.log(1)' }, cwd);
  check('ctx_execute → 规范化 tool_name + code 转 command',
    exec.tool_name === 'bash' && exec.llm_tool_name === 'bash' && exec.tool_input.command === 'console.log(1)');
  const batch = toHookPayload('ctx_batch', { commands: ['git status', 'node -v'] }, cwd);
  check('ctx_batch → commands 拼接为 command',
    batch.tool_name === 'bash' && batch.tool_input.command === 'git status\nnode -v');
  const execDenied = runGate('pre-shell-check.cjs', toHookPayload('ctx_execute', { code: 'git reset --hard' }, cwd), cwd);
  check('ctx_execute 代码含红线命令 → deny', !execDenied.failed && execDenied.output && execDenied.output.decision === 'deny');
  const batchNoVerify = runGate('pre-shell-check.cjs', toHookPayload('ctx_batch', { commands: ['git commit --no-verify -m x'] }, cwd), cwd);
  check('ctx_batch 命令含 --no-verify → deny', !batchNoVerify.failed && batchNoVerify.output && batchNoVerify.output.decision === 'deny');
  const execAllowed = runGate('pre-shell-check.cjs', exec, cwd);
  check('ctx_execute 普通代码放行', !execAllowed.failed && execAllowed.output === null);
  check('代码执行类工具的 .pi/ 写入可被自保护识别',
    isPiWriteCommand(toShellCommand('ctx_execute', { code: "fs.writeFileSync('.pi/x','y')" })) &&
    isPiWriteCommand(toShellCommand('ctx_batch', { commands: ['rm -rf .pi/extensions'] })));

  const parsed = parseGateOutput(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'R' },
  }));
  check('解析 deny 判定', parsed && parsed.decision === 'deny' && parsed.reason === 'R');
  check('无输出视为放行', parseGateOutput('') === null);

  const denied = runGate('pre-shell-check.cjs', toHookPayload('bash', { command: 'git reset --hard' }, cwd), cwd);
  check('pre-shell-check 对 git reset --hard 判 deny', !denied.failed && denied.output && denied.output.decision === 'deny');
  const asked = runGate('pre-shell-check.cjs', toHookPayload('bash', { command: 'git checkout main' }, cwd), cwd);
  check('pre-shell-check 对 git checkout 判 ask', !asked.failed && asked.output && asked.output.decision === 'ask');
  const allowed = runGate('pre-shell-check.cjs', toHookPayload('bash', { command: 'node -v' }, cwd), cwd);
  check('pre-shell-check 对普通命令放行', !allowed.failed && allowed.output === null);
  const writeAllowed = runGate('pre-write-check.cjs', toHookPayload('write', { path: '.pi/x.txt', content: 'x' }, cwd), cwd);
  check('pre-write-check 对非受保护文件放行', !writeAllowed.failed && writeAllowed.output === null);

  check('受保护路径：.pi/ 内文件', isProtectedPiPath('.pi/settings.json', cwd) && isProtectedPiPath('.pi/extensions/shipyard-gates.ts', cwd));
  check('受保护路径：绝对路径同样命中', isProtectedPiPath(path.join(cwd, '.pi', 'x'), cwd));
  check('非受保护路径：业务文件 / .pi-other', !isProtectedPiPath('backend/A.cs', cwd) && !isProtectedPiPath('.pi-other/x', cwd));
  check('bash：删除 .pi/ 判为写入', isPiWriteCommand('rm -rf .pi/extensions'));
  check('bash：node 写文件判为写入', isPiWriteCommand('node -e "fs.writeFileSync(\'.pi/x\',\'y\')"'));
  check('bash：只读执行 .pi/ 不拦', !isPiWriteCommand('node .pi/extensions/lib/gates-core.cjs'));
  check('bash：JS 箭头函数不误判为写入', !isPiWriteCommand('node -e "const f = () => 1" .pi/x'));
  check('bash：重定向写入 .pi/ 判为写入', isPiWriteCommand('echo x > .pi/y'));
  check('bash：无关命令不拦', !isPiWriteCommand('git status'));
  check('接线完整性：当前仓库齐备', checkWiring(cwd).ok);
  check('接线完整性：空目录报缺 4 项', checkWiring(path.join(cwd, '__no_such_repo__')).missing.length === 4);

  for (const [name, ok] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  const failed = cases.filter(([, ok]) => !ok).length;
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
}
