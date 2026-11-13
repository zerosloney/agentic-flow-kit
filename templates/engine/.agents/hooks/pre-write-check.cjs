#!/usr/bin/env node
/**
 * PreToolUse(Edit|Write|MultiEdit) 门 — 写文件瞬间**前**拦截（owner 2026-10-29 指示：拦截时点前移宿主）。
 *
 * 三层判据（顺序短路）：
 *  1) 执法面自保护（deny）：宿主 hook 接线与权限基线（.zcode/config.json / .trae/hooks.json /
 *     .codebuddy/settings.json / .qoder/settings.json / .qwen/settings.json / .commandcode/settings.json /
 *     .agents/hooks/gates.json / .agents/settings.json）——AI 不得自行
 *     解掉自己的拴绳。临时放行走 `--unlock <分钟>`（TTL 标记 .agents/tmp/write-gate-until，
 *     仅应对话内用户明示而设，用毕即删）。
 *  2) 确认台账 append-only（deny）：.agents/confirmations.jsonl 与 confirmations.d/* 的写入必须是
 *     HEAD 版本的逐字节前缀扩展——口径镜像 check-ledger-invariant --staged（提交时刻仍兜底）。
 *  3) 红线内容判据（deny）：**快照-换入-恢复**执行真实门脚本（判据单源在 .agents/hooks/check-*.mjs，
 *     本门不复制任何判据）——把提议内容临时落盘 → 跑工作树扫描器 → finally 恢复原文件。
 *     2026-11-08 减重档 1-A：多门由串行 spawnSync 改异步 spawn + Promise.all 并行聚合
 *     （总耗时 ≈ 最慢单门，不再随门数线性叠加）；任一门非零退出仍整体 deny，输出/退出码格式不变。
 *     - backend/**.cs → check-architecture.mjs（+ check-delete-guard.mjs，其自扫 Application/API）
 *     - frontend/src/**.ts|.vue → check-notify-guard.mjs
 *     check-audit-fields 为暂存区增量判据，不在此复用（pre-commit 兜底）。
 *
 * 引擎面提示（不拦）：改 .githooks/ 或 .agents/hooks/ 属合法引擎工作，但回喂 additionalContext
 * 提醒确认系用户指示——防线是流程纪律（引擎面豁免条款），不是本门。
 *
 * 已知边界（registry 2026-10-29 行）：Bash 重定向/sed 写文件不经本门（走 shell 门与 git 钩子兜底）；
 * 提议内容不可合成（字段缺失/old_string 不在）时内容判据 fail-open，git 钩子兜底。
 *
 * 红线：门自身解析/读取异常一律 fail-open（放行）——门出错不得阻断正常工作流；
 * 但路径类判据（1/2 的匹配）是纯字符串匹配，不经 fail-open 通道。
 *
 * stdin: { tool_name, llm_tool_name, tool_input: { file_path, content|old_string/new_string|edits }, cwd, workspace_roots }
 * stdout: hookSpecificOutput.permissionDecision = deny（trae/codebuddy 同形约定）；无输出 = 放行。
 * 测试：node .agents/scripts/pre-write-check.test.mjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const UNLOCK_MARKER = path.join('.agents', 'tmp', 'write-gate-until');
const OUT_MAX = 900; // 单门输出截断，deny reason 总量控制

// ── CLI: --unlock <分钟> ───────────────────────────────
if (process.argv[2] === '--unlock') {
  const mins = Math.max(1, Number(process.argv[3]) || 10);
  fs.mkdirSync(path.dirname(path.join(process.cwd(), UNLOCK_MARKER)), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), UNLOCK_MARKER), new Date(Date.now() + mins * 60_000).toISOString());
  console.log(`pre-write-check: 写前门解锁 ${mins} 分钟（${UNLOCK_MARKER}）——仅应对话内用户明示而设，用毕删除该文件即恢复拦截`);
  process.exit(0);
}

// ── 读 stdin（fail-open）───────────────────────────────
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
let data;
try { data = JSON.parse(raw); } catch { process.exit(0); }

// Grok 工具名是 search_replace / write（Edit|Write 只是 matcher 别名）。漏掉 search_replace 时
// matcher 命中了，脚本仍在这里 exit 0，写前门等于没挂（2026-11-03）。
const toolName = `${data.tool_name || ''} ${data.toolName || ''} ${data.llm_tool_name || ''}`;
if (!/edit|write|multiedit|search_replace/i.test(toolName)) process.exit(0);
if (!data.tool_input && data.toolInput) data.tool_input = data.toolInput;

// ── 定位仓库与目标文件 ─────────────────────────────────
const root = data.cwd || (Array.isArray(data.workspace_roots) && data.workspace_roots[0]) || process.cwd();
function extractFilePath(input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['file_path', 'filePath', 'path', 'target_file', 'file']) {
    if (typeof input[k] === 'string' && input[k]) return input[k];
  }
  return '';
}
const rawPath = extractFilePath(data.tool_input);
if (!rawPath) process.exit(0);
const abs = path.resolve(root, rawPath);
const rel = path.relative(root, abs).replace(/\\/g, '/');
if (rel.startsWith('..')) process.exit(0); // 仓外文件不管

const deny = (reason) => {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
};
const notify = (text) => {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
  }));
  process.exit(0);
};

// ── 解锁标记（TTL）────────────────────────────────────
let unlocked = false;
try {
  const marker = path.join(root, UNLOCK_MARKER);
  if (fs.existsSync(marker)) {
    const until = Date.parse(fs.readFileSync(marker, 'utf8').trim());
    if (Number.isFinite(until) && Date.now() < until) {
      unlocked = true;
      console.error(`pre-write-check: ⚠️ 写前门解锁中（至 ${new Date(until).toISOString()}）——来源应为对话内用户明示`);
    } else {
      fs.rmSync(marker, { force: true }); // 过期即清
    }
  }
} catch { /* 标记读取失败按未解锁处理 */ }

// ── 1) 执法面自保护 ───────────────────────────────────
const WIRING_RE = /^(\.zcode\/config\.json|\.trae\/hooks\.json|\.codebuddy\/settings\.json|\.qoder\/settings\.json|\.qwen\/settings\.json|\.commandcode\/settings\.json|\.claude\/settings(\.local)?\.json|\.grok\/hooks\/.+\.json|\.agents\/hooks\/gates\.json|\.agents\/settings\.json)$/;
if (!unlocked && WIRING_RE.test(rel)) {
  deny(`执法面自保护：${rel} 是门禁接线/权限基线，AI 不得自行改写。如系用户明示的引擎变更：请用户执行 node .agents/hooks/pre-write-check.cjs --unlock <分钟> 临时放行（或用户手动改本文件），完成后删除解锁标记。`);
}

// ── 合成提议内容（供 2/3 层；合成不了则对应层跳过）────
// 字段名跨宿主/跨版本归一（2026-11-11）：Command Code 规范为 old_string/new_string，其修复层别名
// 为 old_value/new_value；漏认任一侧 = 内容判据静默 fail-open。
const pickStr = (o, keys) => keys.reduce((acc, k) => (acc === undefined && typeof o[k] === 'string' ? o[k] : acc), undefined);
const EDIT_OLD = ['old_string', 'oldString', 'old_value', 'oldValue'];
const EDIT_NEW = ['new_string', 'newString', 'new_value', 'newValue'];
function synthesize(input, absPath) {
  if (!input || typeof input !== 'object') return null;
  const content = pickStr(input, ['content', 'new_content', 'file_text']);
  if (content !== undefined) return content;
  const applyOne = (text, oldS, newS, all) => {
    if (typeof oldS !== 'string' || typeof newS !== 'string' || oldS === '') return null;
    if (!text.includes(oldS)) return null;
    return all ? text.split(oldS).join(newS) : text.replace(oldS, newS);
  };
  const one = (src) => applyOne(src.file,
    pickStr(src, EDIT_OLD), pickStr(src, EDIT_NEW) ?? '', src.replace_all === true || src.replaceAll === true);
  let cur;
  try { cur = fs.readFileSync(absPath, 'utf8'); } catch { return null; } // 新文件走 Write 形态，Edit 合成不了
  const edits = Array.isArray(input.edits) ? input.edits : null;
  if (edits) {
    let text = cur;
    for (const e of edits) {
      const next = one({ ...(e || {}), file: text, replace_all: e && e.replace_all });
      if (next === null) return null;
      text = next;
    }
    return text;
  }
  if (pickStr(input, EDIT_OLD) !== undefined) {
    return one({ ...input, file: cur, replace_all: input.replace_all });
  }
  return null;
}
const proposed = synthesize(data.tool_input, abs);

// ── 2) 确认台账 append-only ───────────────────────────
const LEDGER_RE = /^\.agents\/(confirmations\.jsonl|confirmations\.d\/.+)$/;
if (proposed !== null && LEDGER_RE.test(rel)) {
  const head = spawnSync('git', ['-c', 'core.quotepath=off', 'show', `HEAD:${rel}`], { encoding: 'utf8', cwd: root });
  if (head.status === 0 && !proposed.startsWith(String(head.stdout))) {
    deny(`确认台账只允许追加（append-only）：${rel} 的本次写入非 HEAD 版本的前缀扩展。重写/改写台账请走 confirm-doc / ledger-shards 工具，不直接编辑。`);
  }
}

// ── 2.5) 测试不可弱化（fix 任务窗口）──────────────────
// Anthropic AI-native SDLC：修复时，写代码的 agent 不得削弱证明修复有效的检查。
// 协议：修复开始前 `node .agents/scripts/fix-task.mjs start` 落 .agents/cache/fix-task.json；
// 结束后 stop。窗口内改既有测试 → deny；新建测试（复现用例）放行。
// 逃生口：① --test 预登记允许路径；② 提议内容含 `TEST-GUARD-ALLOW: <理由>`（保留给合法重构，
// 复核时可见）；③ 用户明示的 write-gate 解锁。
const TEST_PATH_RE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$|Tests?\.(cs|java|kt)$|_test\.(go|py)$|^test_.*\.py$|\.feature$/;
try {
  const marker = path.join(root, '.agents', 'cache', 'fix-task.json');
  if (!unlocked && TEST_PATH_RE.test(rel) && fs.existsSync(marker)) {
    let task = null;
    try { task = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { task = null; }
    if (task && task.active !== false) {
      const existed = fs.existsSync(abs);
      const allowed = Array.isArray(task.allowedTests) && task.allowedTests.some((p) => String(p).replace(/\\/g, '/') === rel);
      const escape = typeof proposed === 'string' && /TEST-GUARD-ALLOW:\s*\S+/.test(proposed);
      // 新建测试 = 失败的复现用例，允许；修改/删除既有测试一律拦。
      if (existed && !allowed && !escape) {
        deny(`测试不可弱化：当前处于修复任务窗口（${task.id || 'fix'}），不得修改既有测试 ${rel}。\n`
          + '允许：新建复现测试；或让修复只改实现。\n'
          + '如属合法重构：在提议内容里加 `TEST-GUARD-ALLOW: <理由>`，并在复核中说明；'
          + '或先结束窗口 node .agents/scripts/fix-task.mjs stop。');
      }
    }
  }
} catch { /* 标记读取失败 → 放行，git 钩子与独立复核兜底 */ }

// ── 3) 红线内容判据（快照-换入-跑真实门-恢复）─────────
const gates = [];
// 包内运行时执行时用包内门脚本；直接执行安装副本时回退项目 hooks 目录。
const hookRoot = process.env.FLOW_KIT_RUNTIME_HOOKS || path.join(root, '.agents', 'hooks');
if (/^backend\/.+\.(cs|csproj|sln)$/i.test(rel)) {
  gates.push(['check-architecture', path.join(hookRoot, 'check-architecture.mjs')]);
  gates.push(['check-delete-guard', path.join(hookRoot, 'check-delete-guard.mjs')]);
} else if (/^frontend\/src\/.+\.(ts|vue)$/i.test(rel)) {
  gates.push(['check-notify-guard', path.join(hookRoot, 'check-notify-guard.mjs')]);
}
// runGateAsync：异步 spawn 单个门脚本（30 秒超时约束保持），聚合 stdout/stderr 后 resolve。
// 并行化（2026-11-08 减重档 1-A）：多门经 Promise.all 同时起跑，任一门非零退出即整体 deny
// （fail-fast 语义不变）；输出拼接顺序（stderr+stdout）与截断口径与旧串行版一致。
function runGateAsync(gatePath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [gatePath], { cwd: root, timeout: 30000 });
    let stdout = '', stderr = '';
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish({ status: 1, stdout: '', stderr: String(e) }));
    child.on('close', (code) => finish({ status: code, stdout, stderr }));
  });
}

(async () => {
  if (gates.length > 0 && proposed !== null) {
    const existed = fs.existsSync(abs);
    const backup = existed ? fs.readFileSync(abs) : null;
    const violations = [];
    try {
      fs.writeFileSync(abs, proposed);
      const results = await Promise.all(gates.map(([label, gatePath]) => runGateAsync(gatePath)));
      for (let i = 0; i < results.length; i++) {
        if (results[i].status !== 0) {
          const out = String((results[i].stderr || '') + (results[i].stdout || '')).trim();
          violations.push(`【${gates[i][0]}】${out.slice(-OUT_MAX)}`);
        }
      }
    } catch { /* 快照失败 → 内容判据放弃，git 钩子兜底 */ }
    finally {
      try {
        if (backup !== null) fs.writeFileSync(abs, backup);
        else if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
      } catch (e) {
        console.error(`pre-write-check: ⚠️ 快照恢复失败（${rel}）——工作区可能残留提议内容，请人工核对 git diff：${e}`);
      }
    }
    if (violations.length > 0) {
      deny(`写前门拦下（判据单源 .agents/hooks/check-*.mjs，快照复用）：\n${violations.join('\n')}\n——按各门输出修复后重试；本拦截发生在写盘前，文件未被修改。`);
    }
  }

  // ── 引擎面提示（不拦）─────────────────────────────────
  if (/^(\.githooks|\.agents\/hooks)\//.test(rel)) {
    notify(`执法面变更提示：${rel} 属门禁面文件——确认这是用户指示的引擎面工作（引擎面豁免条款），并注意同步 .agents/config/mechanism-registry.md。`);
  }

  process.exit(0);
})();
