#!/usr/bin/env node
// codeartsdoer-gate.cjs — CodeArtsDoer PreToolUse 适配层（随包分发于 templates/engine/.agents/hooks/，经
// `flow-kit hook codeartsdoer-gate` 调起；项目接线面为 .github/hooks/flow-kit-gates.json，不在用户目录复制副本）。
// 实测事实来源（issue #48 协议实测，2026-11-15，CodeArts Agent 26.11.100）：
//   - 内置 Claude 兼容 Hook 系统；决策协议认 hookSpecificOutput.permissionDecision: deny|ask 阻断 /
//     allow 放行（kit 现有 hook 输出零改造）
//   - Hook 配置发现面：项目级 .github/hooks/*.json（VS Code 标准）；开关 = 设置 chat.useHooks，
//     新会话生效。条目 schema 为 Claude 形状 {hooks:{PreToolUse:[{matcher, hooks:[{type,command,timeout}]}]}}，
//     但宿主解析丢弃 matcher（全量工具触发）→ 本适配层按 stdin tool_name 自行分派
//   - 工具名（SpecedToolAliases）：execute(shell) / edit(写) / search / agent / read / web / todo
//   - kernel 载荷精确字段未静态取证（issue #48 评论）：command 按 command|cmd|cmdline 多形态兼容，
//     字符串或数组（数组 join ' '），会话内首验后收敛
// 契约：
//   1) root 解析同 codex-gate：payload.cwd 向上找 .agents/install-manifest.json；
//      找不到 = 非 flow-kit 仓 → exit 0 no-op
//   2) execute → 归一 {tool_name:'Bash', tool_input:{command}} 转 pre-shell-check
//      edit → 转 pre-write-check（tool_input 原样透传：写前门自带 file_path|path|target_file|filePath
//      与 content|old/new|edits 的别名归一；无可识别路径字段 → stderr 提示一句后放行，git 钩子兜底）
//      search / agent / read / web / todo / mcp__* / 未知工具 → no-op exit 0
//   3) flow-kit 不可用 → 警告后放行（fail-open，避免把会话锁死）
//   4) spawnSync 用 input: Buffer 传 stdin（encoding:'buffer' + 字符串 input 组合会抛 ERR_UNKNOWN_ENCODING）
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.agents', 'install-manifest.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// command 归一：kernel 载荷字段未静态取证，按 command|cmd|cmdline 多形态兼容（字符串或数组）。
function normalizeCommand(input) {
  if (!isObject(input)) return '';
  for (const key of ['command', 'cmd', 'cmdline']) {
    const value = input[key];
    if (typeof value === 'string' && value) return value;
    if (Array.isArray(value) && value.length) return value.map((item) => String(item)).join(' ');
  }
  return '';
}

// 路径判据：与 pre-write-check 的 extractFilePath 同面（file_path|filePath|path|target_file|file）。
function pickPath(input) {
  if (!isObject(input)) return '';
  for (const key of ['file_path', 'filePath', 'path', 'target_file', 'file']) {
    if (typeof input[key] === 'string' && input[key]) return input[key];
  }
  return '';
}

function gate() {
  let input = Buffer.alloc(0);
  try { input = fs.readFileSync(0); } catch { /* 无 stdin = 放行 */ }
  if (!input.length) process.exit(0);
  let data;
  try { data = JSON.parse(input.toString('utf8')); } catch { process.exit(0); }
  const tool = String(data.tool_name || '');
  const startDir = data.cwd || process.cwd();
  const root = findRoot(startDir);
  if (!root) process.exit(0);
  let hook = null;
  const normalized = { ...data, cwd: root };
  if (tool === 'execute') {
    hook = 'pre-shell-check';
    normalized.tool_name = 'Bash';
    normalized.tool_input = { command: normalizeCommand(data.tool_input) };
  } else if (tool === 'edit') {
    if (!pickPath(data.tool_input)) {
      console.error('[codeartsdoer-gate] edit 载荷无可识别路径字段（file_path|path|target_file|filePath），放行（写前门对未知字段 fail-open，git 钩子兜底）');
      process.exit(0);
    }
    hook = 'pre-write-check';
  } else {
    process.exit(0); // search / agent / read / web / todo / mcp__* / 未知工具不经门
  }
  const r = spawnSync('flow-kit', ['hook', hook], {
    input: Buffer.from(JSON.stringify(normalized), 'utf8'),
    encoding: 'buffer',
    shell: process.platform === 'win32',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
  });
  if (r.error) {
    console.error(`[codeartsdoer-gate] flow-kit 不可用，放行：${r.error.message}`);
    process.exit(0);
  }
  if (r.stdout && r.stdout.length) process.stdout.write(r.stdout);
  if (r.stderr && r.stderr.length) process.stderr.write(r.stderr);
  process.exit(typeof r.status === 'number' ? r.status : 0);
}

// CLI 守卫：只在被直接执行时消费 stdin（.github/hooks 条目与 `flow-kit hook codeartsdoer-gate` 均为直执行，
// node <file> 的 argv[1] 即本文件）；被 require 时无副作用。
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) gate();
