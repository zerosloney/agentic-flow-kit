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
 *     - 产品面单源 `.agents/config/project-faces.json`：code → arch.* + delete.*；ui → notify.*；
 *       full（未配置）→ 三者全跑；规则统一经 `flow-kit rules check --files <rel>` 求值（快照复用）。
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
 * 测试：flow-kit run pre-write-check.test.mjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
const WIRING_RE = /^(\.zcode\/config\.json|\.trae\/hooks\.json|\.codebuddy\/settings\.json|\.qoder\/settings\.json|\.qwen\/settings\.json|\.commandcode\/settings\.json|\.claude\/settings(\.local)?\.json|\.grok\/hooks\/.+\.json|\.github\/hooks\/.+\.json|\.agents\/hooks\/gates\.json|\.agents\/settings\.json)$/;
if (!unlocked && WIRING_RE.test(rel)) {
  deny(`执法面自保护：${rel} 是门禁接线/权限基线，AI 不得自行改写。如系用户明示的引擎变更：请用户执行 flow-kit hook pre-write-check.cjs --unlock <分钟> 临时放行（或用户手动改本文件），完成后删除解锁标记。`);
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
// 协议：修复开始前 `flow-kit run fix-task.mjs start` 落 .agents/cache/fix-task.json；
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
          + '或先结束窗口 flow-kit run fix-task.mjs stop。');
      }
    }
  }
} catch { /* 标记读取失败 → 放行，git 钩子与独立复核兜底 */ }

// ── 3) 红线内容判据（快照-换入-跑 rules check-恢复）─────────
// 单一执行路径（Phase 3）：四个 code 门统一由 `flow-kit rules check` 求值（规则来自旧配置投影，
// 对拍见 tests/rules-parity）。本段只负责「快照-换入-恢复」与把违例翻译成宿主 deny。
// 面 → 规则前缀：code=架构+删除；ui=通知；full（未配置面）=三者全跑；tests/data=无内容门。
const FACE_PREFIXES = {
  code: ['arch.', 'delete.'],
  ui: ['notify.'],
  tests: [],
  data: [],
  full: ['arch.', 'delete.', 'notify.'],
  none: [],
};
let face = 'full';
try {
  const facesScript = path.join(__dirname, '..', 'scripts', 'faces.mjs');
  const r = spawnSync(process.execPath, [facesScript, '--face', rel], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
    timeout: 5000,
  });
  if (r.status === 0) face = String(r.stdout || '').trim() || 'none';
} catch { /* 判定异常 → 保持 full 保守 */ }
const prefixes = FACE_PREFIXES[face] || FACE_PREFIXES.full;
// CLI 解析：包内运行时（hooks 位于 <pkg>/templates/engine/.agents/hooks）→ 上溯四级到包根；允许 FLOW_KIT_CLI 覆盖。
const cli = [process.env.FLOW_KIT_CLI, path.resolve(__dirname, '..', '..', '..', '..', 'bin', 'flow-kit.mjs')]
  .filter(Boolean)
  .find((p) => fs.existsSync(p)) || null;

(async () => {
  // 恢复失败的兜底（D16）：文件可能停在提议内容——deny 文案改述，放行路径强制非零退出。
  let restoreFailed = false;
  const restoreNotice = `⚠️ 快照恢复失败（${rel}）：文件可能仍为提议内容、无法自动恢复——请立即 git diff ${rel} 人工核对，并按需 git checkout -- ${rel} 恢复。`;
  if (prefixes.length > 0 && proposed !== null && cli) {
    const existed = fs.existsSync(abs);
    const backup = existed ? fs.readFileSync(abs) : null;
    let verdict = null;
    try {
      fs.writeFileSync(abs, proposed);
      const args = [cli, 'rules', 'check', '--files', rel, '--json', '--prefix', prefixes.join(',')];
      verdict = spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, FLOW_KIT_PROJECT_ROOT: root },
      });
    } catch { /* 快照失败 → 内容判据放弃，git 钩子兜底 */ }
    finally {
      try {
        if (backup !== null) fs.writeFileSync(abs, backup);
        else if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
      } catch {
        restoreFailed = true; // 提示延迟到裁决/放行路径统一输出：deny 时替换「文件未被修改」，放行时 exit 2
      }
    }
    if (verdict && verdict.status !== 0) {
      if (verdict.status === 1) {
        let lines = [];
        try {
          const parsed = JSON.parse(verdict.stdout);
          lines = (parsed.violations || [])
            .filter((v) => v.severity === 'block')
            .map((v) => `- [${v.ruleId}] ${v.file || ''}${v.line ? `:${v.line}` : ''} ${(v.message && v.message.zh) || ''}${v.detail ? ` —— ${v.detail}` : ''}`);
        } catch {
          lines = [String((verdict.stderr || '') + (verdict.stdout || '')).trim().slice(-OUT_MAX)];
        }
        deny(`写前门拦下（rules check，快照复用）：\n${lines.join('\n')}\n——按提示修复后重试；${restoreFailed ? restoreNotice : '本拦截发生在写盘前，文件未被修改。'}`);
      } else {
        deny(`写前门：规则配置错误（rules check exit ${verdict.status}）——配置坏不得放行：\n${String(verdict.stderr || '').trim().slice(-OUT_MAX)}${restoreFailed ? `\n${restoreNotice}` : ''}`);
      }
    }
  }
  if (restoreFailed) {
    console.error(`pre-write-check: ${restoreNotice}`);
    process.exit(2);
  }

  // ── 引擎面提示（不拦）─────────────────────────────────
  if (/^(\.githooks|\.agents\/hooks)\//.test(rel)) {
    notify(`执法面变更提示：${rel} 属门禁面文件——确认这是用户指示的引擎面工作（引擎面豁免条款），并注意同步 .agents/config/mechanism-registry.md。`);
  }

  process.exit(0);
})();
