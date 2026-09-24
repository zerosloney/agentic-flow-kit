#!/usr/bin/env node
/**
 * PostToolUse(Edit|Write) hook — 编辑 .cs 文件后即时跑架构红线检查
 *
 * Trae 宿主事实：PostToolUse 不能撤销已完成的编辑，但可用 hookSpecificOutput.additionalContext
 * 把违例喂回模型，让它在提交前自行修掉；硬阻断在 PreToolUse 的 pre-shell-check.cjs（走 .githooks/pre-commit）。
 *
 * stdin: { tool_name, llm_tool_name, tool_input: { file_path, ... }, cwd, workspace_roots, ... }
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const { resolveShell } = require('./resolve-shell.cjs');

// --- 读取 stdin ---
let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0);
}

const toolName = `${data.tool_name || ''} ${data.llm_tool_name || ''}`;
if (!/edit|write/i.test(toolName)) {
  process.exit(0);
}

// 文件路径字段名跨宿主/版本可能不同，逐个候选取第一个命中的
function extractFilePath(input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['file_path', 'filePath', 'path', 'target_file', 'file']) {
    if (typeof input[k] === 'string' && input[k]) return input[k];
  }
  return '';
}

const filePath = extractFilePath(data.tool_input);
if (!/\.cs$/i.test(filePath)) {
  process.exit(0); // 非 .cs 文件，跳过
}

const projectRoot = data.cwd || (Array.isArray(data.workspace_roots) && data.workspace_roots[0]) || process.cwd();

const shellBin = resolveShell();
if (!shellBin) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: '⚠️ 架构红线检查未执行：未找到可用的 bash / sh。安装 Git for Windows 后重试，或提交前手动跑 .agents/hooks/check-architecture.sh。'
    }
  }));
  process.exit(0);
}

// timeout 单位是毫秒：架构检查实测约 0.6 秒，30 秒预算够用；
// （2026-09-19 修复：原值 30 是 30 毫秒，必然 ETIMEDOUT，导致每次 .cs 编辑都误报「发现违例」）
try {
  execFileSync(shellBin, ['.agents/hooks/check-architecture.sh'], {
    cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000
  });
  // 通过，无输出
} catch (e) {
  if (e.code === 'ETIMEDOUT') {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: '⚠️ 架构红线检查超时（30 秒）：本次编辑未验证，请在提交前手动跑 .agents/hooks/check-architecture.sh。'
      }
    }));
    process.exit(0);
  }
  // 门禁脚本未装（未跑 add-gate dotnet-ca）≠ 发现违例——区分口径，对齐 pre-shell-check 的 ENOENT 处理（2026-09-24）
  if (e.code === 'ENOENT') {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: '⚠️ 架构红线检查未执行：check-architecture.sh 未安装（flow-kit add-gate dotnet-ca 装入）——本次编辑未验证。'
      }
    }));
    process.exit(0);
  }
  const err = String((e.stderr || '') + (e.stdout || '')).slice(0, 800);
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `⚠️ 架构红线检查发现违例（check-architecture.sh）：\n${err}\n请在提交前修复；硬阻断在 git commit 时执行。`
    }
  }));
}

process.exit(0);
