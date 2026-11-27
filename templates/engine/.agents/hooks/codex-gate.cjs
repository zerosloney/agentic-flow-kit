#!/usr/bin/env node
// codex-gate.cjs — Codex PreToolUse 适配层（随包分发于 templates/engine/.agents/hooks/，经
// `flow-kit hook codex-gate` 调起；不在用户目录复制副本，hooks.json 条目 command 直接指向包内入口）。
// 实测事实来源（issue #45 协议实测，2026-11-15，Codex 0.169.0）：
//   - shell 工具名 = exec_command（不是 Bash）；写工具 = apply_patch；MCP = mcp__server__tool
//   - tool_input 形状 = { cmd, workdir, ... }（不是 { command }）
//   - 决策协议 = hookSpecificOutput.permissionDecision: deny|ask 阻断 / allow 放行（Claude 兼容，
//     kit 现有 hook 输出无需改造）
//   - hooks 配置在用户级 ~/.codex/hooks.json（Claude 风格 schema）；条目按 config.toml
//     hooks.state.trusted_hash 信任，编辑即失效——接线变更后须在交互式 Codex 会话重新信任一次，
//     非交互模式会静默跳过未信任条目
// 契约：
//   1) root 解析只用宿主 payload.cwd / hook 进程 cwd（hook 进程 cwd 不可依赖），向上找
//      .agents/install-manifest.json；tool_input.workdir 由模型逐次指定，不得作为门禁锚点；
//      找不到 = 非 flow-kit 仓 → exit 0 no-op
//   2) exec_command → 归一 {tool_name:'Bash', tool_input:{command: cmd}} 后转 pre-shell-check
//      apply_patch → 转 pre-write-check；已知边界：补丁形态无法合成提议内容（内容判据 fail-open），
//      tool_input 无可识别路径字段时整体放行，git 钩子兜底
//   3) mcp__* 与其他工具 → no-op（MCP 工具当前不设门）
//   4) flow-kit 不可用 → 警告后放行（fail-open，避免把会话锁死）
//   5) spawnSync 用 input: Buffer 传 stdin（encoding:'buffer' + 字符串 input 组合会抛 ERR_UNKNOWN_ENCODING）
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
  if (tool === 'exec_command') {
    hook = 'pre-shell-check';
    normalized.tool_name = 'Bash';
    normalized.tool_input = { command: data.tool_input?.cmd ?? '' };
  } else if (tool === 'apply_patch') {
    hook = 'pre-write-check';
  } else if (/^mcp__/.test(tool)) {
    process.exit(0); // MCP 工具不经命令门（如需可后续扩展）
  } else {
    process.exit(0);
  }
  const r = spawnSync('flow-kit', ['hook', hook], {
    input: Buffer.from(JSON.stringify(normalized), 'utf8'),
    encoding: 'buffer',
    shell: process.platform === 'win32',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
  });
  if (r.error) {
    console.error(`[codex-gate] flow-kit 不可用，放行：${r.error.message}`);
    process.exit(0);
  }
  if (r.stdout && r.stdout.length) process.stdout.write(r.stdout);
  if (r.stderr && r.stderr.length) process.stderr.write(r.stderr);
  process.exit(typeof r.status === 'number' ? r.status : 0);
}

// CLI 守卫：只在被直接执行时消费 stdin（Codex hooks.json 与 `flow-kit hook codex-gate` 均为直执行，
// node <file> 的 argv[1] 即本文件）；被 require 时无副作用。
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) gate();
