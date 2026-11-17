#!/usr/bin/env node
// session-context.cjs — 会话入口路由令注入腿（SessionStart）。随包分发于 templates/engine/.agents/hooks/，
// 经 `flow-kit hook session-context` 调起；安装器按 registry 的 hooks.events 声明把 SessionStart 条目
// 编译进宿主 settings（当前仅 claude 声明该事件，其余宿主由 doctor 给 guarantee advisory 降级）。
// 证据来源：Claude Code 官方 hooks reference（2026-11-17 核实，https://code.claude.com/docs/en/hooks）——
//   SessionStart 的 matcher = 会话启动方式（startup|resume|clear|compact|fork），stdin 含 source/cwd/session_id；
//   属「Context only」事件，无决策面（不能 block）；plain stdout 与 hookSpecificOutput.additionalContext
//   同样注入为 system reminder；启动时 MCP 尚不可用，故只用 type:"command"。其余宿主无公开证据，一律不接。
// 契约：
//   1) 只指路不复制规则：正文单源在 .agents/commands/new-task.md §1c 与 .agents/skills/session-resume/SKILL.md，
//      本腿只注入指针 + 一句装载纪律，禁把红线/分级表抄进注入面（单源纪律 + 每会话 token 成本）。
//   2) 零写操作、零 spawn、不读 transcript；任何异常都 exit 0，不阻塞宿主会话。
//   3) 用户可关：.agents/config/session-context.local.json 写 {"enabled":false}（用户所有，不进 manifest、
//      升级不覆盖，口径同 model-roles.local.json）；缺文件 = 开。
//   4) root 解析：FLOW_KIT_PROJECT_ROOT 优先（`flow-kit hook` 入口注入），否则 payload.cwd / process.cwd()
//      向上找 .agents/install-manifest.json（hook 进程 cwd 不可依赖，同 usage-collect.cjs）；非 flow-kit 仓 → exit 0 零输出。
//   5) 语言随 manifest.language：en 仓注入英文，与安装语言一致；读不到 manifest 即非 flow-kit 仓。
const fs = require('node:fs');
const path = require('node:path');

const LOCAL_REL = path.join('.agents', 'config', 'session-context.local.json');
const MANIFEST_REL = path.join('.agents', 'install-manifest.json');

const TEXT = {
  'zh-CN': [
    '[flow-kit 会话入口路由令]',
    '- 接手/续作：先读 .agents/skills/session-resume/SKILL.md，用机器事实（plan 勾选态 + git status）重建当前态，禁凭记忆补勾。',
    '- 新任务：走 .agents/commands/new-task.md——§1 先定级，§1c 阶段装载表标「进入即装载」的技能/角色须真的装载再动手。',
    '- 规则正文单源在 .agents/（commands/、skills/、config/policy.json）；本注入只指路，不复制红线。',
    '- 关闭本注入：.agents/config/session-context.local.json 写 {"enabled":false}（用户所有，升级不覆盖）。',
  ],
  en: [
    '[flow-kit session entry routing directive]',
    '- Resuming: read .agents/skills/session-resume/SKILL.md first; rebuild current state from machine facts (plan checkboxes + git status), never check items off from memory.',
    '- New task: follow .agents/commands/new-task.md — grade first in §1, then actually load the skills/roles its §1c stage table marks "load on entry" before doing work.',
    '- Rule text is single-sourced under .agents/ (commands/, skills/, config/policy.json); this injection only points, it does not copy red lines.',
    '- Turn this injection off: write {"enabled":false} to .agents/config/session-context.local.json (user-owned, never overwritten on upgrade).',
  ],
};

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, MANIFEST_REL))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

// 关闭开关：只认显式 false（缺文件 / 坏 JSON / 其它值 = 开），坏配置不静默改变注入行为。
function disabled(root) {
  const local = readJson(path.join(root, LOCAL_REL));
  return Boolean(local) && local.enabled === false;
}

function emit() {
  let data = {};
  try {
    const input = fs.readFileSync(0);
    if (input.length) data = JSON.parse(input.toString('utf8')) || {};
  } catch { /* 无 stdin / 坏载荷：本腿不依赖载荷字段，按 cwd 解析 root */ }
  const root = process.env.FLOW_KIT_PROJECT_ROOT || findRoot(data.cwd || process.cwd());
  if (!root) process.exit(0); // 非 flow-kit 仓：零输出
  if (disabled(root)) process.exit(0);
  const manifest = readJson(path.join(root, MANIFEST_REL));
  if (!manifest) process.exit(0);
  const lines = TEXT[manifest.language] || TEXT['zh-CN'];
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(0);
}

// CLI 守卫：只在被直接执行时消费 stdin（宿主 settings.json 与 `flow-kit hook session-context` 均为直执行）；
// 被 require 时无副作用。
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) emit();