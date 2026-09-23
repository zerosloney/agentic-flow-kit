#!/usr/bin/env node
/**
 * PreToolUse(RunCommand) hook — 两道关卡：
 * 1) deny/ask 命令门禁（口径同 .agents/settings.json 的 deny/ask 策略）
 * 2) git commit / git push 前置检查：直接调 .githooks/pre-commit / pre-push
 *
 * 为什么调 .githooks/*：那是项目唯一的门禁权威（pre-commit 六项 + pre-push 闭环断档）。
 * 本钩子是**宿主侧冗余**——core.hooksPath 漏配时 git 侧门禁静默失效（2026-09-16 Trae 侧缺档事故），
 * 由这里在命令执行前拦下；门禁清单只维护 .githooks/ 一份，本文件不复制。
 *
 * Trae 宿主事实（docs.trae.ai/ide/hook-configuration-reference）：
 *   - 终端工具的 matcher 名是 RunCommand（不是 Shell/Bash）；timeout 单位是**秒**。
 *   - stdin: { session_id, cwd, hook_event_name, workspace_roots, tool_use_id, tool_name, llm_tool_name, tool_input }
 *   - stdout: hookSpecificOutput.permissionDecision = allow / deny / ask；无输出 = 放行。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const { resolveShell } = require('./resolve-shell.cjs');

// --- 读取 stdin ---
let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0); // 无 stdin，放行
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0); // JSON 解析失败，放行（不阻塞正常工作流）
}

// 工具名兼容：Trae 规范化名为 RunCommand，llm_tool_name 为原始名；保留 Claude 风格别名防宿主差异
const toolName = `${data.tool_name || ''} ${data.llm_tool_name || ''}`;
if (!/runcommand|bash|shell|terminal|executecommand/i.test(toolName)) {
  process.exit(0);
}

// 取命令文本：优先约定的 command 字段；字段名缺失时退回扫描 tool_input 的字符串值
// （信任边界上的宿主 payload，字段名跨版本可能不同——漏读会让门禁静默失效，故兜底扫描）
function extractCommand(input) {
  if (!input || typeof input !== 'object') return '';
  if (typeof input.command === 'string' && input.command) return input.command;
  return Object.values(input).filter(v => typeof v === 'string').join('\n');
}

const command = extractCommand(data.tool_input);
if (!command) {
  process.exit(0);
}

const projectRoot = data.cwd || (Array.isArray(data.workspace_roots) && data.workspace_roots[0]) || process.cwd();

function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

function ask(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

// ── 1) deny/ask 命令门禁 ──────────────────────────────
const denyList = [
  { pat: 'dotnet ef',         reason: '禁 EF Migrations，Schema 由人工 SQL 维护' },
  { pat: 'git reset --hard',  reason: '禁破坏性重置' },
  { pat: 'git push --force',  reason: '禁强制推送' },
  { pat: 'git push -f',       reason: '禁强制推送' },
  { pat: 'drop database',     reason: '禁删库' }
];
const askList = [
  { pat: 'git checkout',  reason: '可能切换/丢弃工作区改动' },
  { pat: 'git clean',     reason: '可能删除未跟踪文件' },
  { pat: 'git branch -D', reason: '可能删除未合并分支' },
  { pat: 'rm -rf',        reason: '可能递归删除文件' }
];

for (const d of denyList) {
  if (command.includes(d.pat)) {
    deny(`禁止执行: ${d.pat}（项目红线：${d.reason}）`);
  }
}
for (const a of askList) {
  if (command.includes(a.pat)) {
    ask(`需确认: ${a.pat}（项目 ask 策略：${a.reason}）`);
  }
}

// ── 2) git commit / git push 前置检查 ──────────────────
const isCommit = /git\s+commit/.test(command);
const isPush = /git\s+push/.test(command);

if (!isCommit && !isPush) {
  process.exit(0); // 非 commit/push，放行
}

const shellBin = resolveShell();
if (!shellBin) {
  deny('门禁未执行：未找到可用的 bash / sh——请安装 Git for Windows，或在 Git Bash 终端手动跑 .githooks/pre-commit');
}

// runGate：把 .githooks/ 门禁原始输出透传给 AI；未执行（脚本缺失）与判定失败分开报，避免把 ENOENT 误报成代码违例
function runGate(scriptRelPath, label, budgetMs) {
  try {
    execFileSync(shellBin, [scriptRelPath], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: budgetMs
    });
  } catch (e) {
    if (e.code === 'ETIMEDOUT') {
      deny(`${label}超时（${scriptRelPath}，${Math.round(budgetMs / 1000)} 秒未完成）——检查 dotnet build / npm run build 是否卡住`);
    }
    if (e.code === 'ENOENT') {
      deny(`门禁未执行（${label}）：${scriptRelPath} 不可达——确认仓库完整后重试`);
    }
    const err = String((e.stdout || '') + (e.stderr || '')).slice(0, 1200);
    deny(`${label}未通过（${scriptRelPath}）：\n${err}`);
  }
}

if (isCommit) {
  // pre-commit 六项：架构红线 + 审计字段 + 删除拦截 + 闭环配对（增量）+ 敏感信息 + 条件编译
  // 预算 5 分钟覆盖 dotnet build / npm run build（.githooks/pre-commit 内部无超时）
  runGate('.githooks/pre-commit', '提交前门禁', 300000);
}

if (isPush) {
  // pre-push：check-loop.sh 扫 workflow/ 闭环断档（hard-block = 配对断裂 / 回路断档 / 新建 done 未勾验）
  // 预算 7 分钟：2026-09-19 实测 check-loop.sh 全量扫描耗时 2 分 53 秒（231 任务卡），
  // 原定 2 分钟会误报超时——不要按「脚本应该很快」调小
  runGate('.githooks/pre-push', '推送前闭环扫描', 420000);
}

// 全部通过，放行
process.exit(0);
