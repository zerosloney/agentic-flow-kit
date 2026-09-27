#!/usr/bin/env node
// trae-hooks.test.mjs — trae 宿主 hook 判定回归（2026-09-27 host-gates-p1，incident 三件套「防复发验证」落点）
// 方法：stdin JSON 注入 spawn pre-shell-check.cjs（RunCommand 形态），断言 permissionDecision。
// 场景对位：P1-B2 强推 token 化（换序 / +refspec / --force-with-lease 放行 / -f）+ 既有 deny/ask 回归 +
//       非 push 命令带 --force 不误拦（如 dotnet build --force）。
// 注：127 未装分支（P2-B4）需 .githooks 脚本缺失形态，经 isCommit 路径覆盖——单独场景构造 cwd 指向
//     无 .githooks 的临时目录跑 git commit，断言「门禁未执行」而非「未通过」。
// 用法：node src/trae-hooks.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(PKG_ROOT, 'modules', 'hosts', 'trae', 'hooks', 'pre-shell-check.cjs');

const runHook = (command, cwd) => {
  const payload = JSON.stringify({
    tool_name: 'RunCommand',
    tool_input: { command },
    cwd: cwd || process.cwd(),
  });
  const r = spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8', timeout: 30000 });
  let decision = 'none';
  let reason = '';
  try {
    const j = JSON.parse((r.stdout || '').trim().split('\n').pop() || '{}');
    decision = j?.hookSpecificOutput?.permissionDecision || 'none';
    reason = j?.hookSpecificOutput?.permissionDecisionReason || '';
  } catch { /* 无输出 = 放行 */ }
  return { decision, reason, raw: r.stdout || '', status: r.status };
};

// ---- ① 强推 token 化（P1-B2）----
{
  const cases = [
    ['git push --force', 'deny', '标准序'],
    ['git push origin main --force', 'deny', '换序（旧代码漏拦形态）'],
    ['git push origin +main', 'deny', '+refspec 变体'],
    ['git push -f', 'deny', '短旗标'],
    ['git -c x=y push origin main --force', 'deny', '全局参前缀'],
    ['git push -vf origin main', 'deny', '组合短旗标 -vf（复核 P2-1）'],
    ['git push origin main && dotnet build --force', 'none', '跨 && 的 --force 属他命令不误并（复核 P2-3）'],
    ['git push origin main --force-with-lease', 'none', '--force-with-lease 精确 token 不误拦'],
    ['git push origin main', 'none', '普通 push 放行'],
    ['dotnet build --force', 'none', '非 push 命令带 --force 不误拦'],
  ];
  for (const [cmd, expect, label] of cases) {
    const r = runHook(cmd);
    check(`①${label}（${cmd}）→ ${expect === 'none' ? '放行' : expect}`,
      r.decision === expect,
      `decision=${r.decision} reason=${r.reason}`);
  }
}
// ①附：换序强推的 deny 理由点名红线
{
  const r = runHook('git push origin main --force');
  check('①换序强推 deny 理由点名禁强制推送', r.decision === 'deny' && /强制推送/.test(r.reason), r.reason);
}

// ---- ② 既有 deny/ask 回归（token 边界口径不动）----
{
  const cases = [
    ['git reset --hard HEAD~1', 'deny'],
    ['drop database MyDb', 'deny'],
    ['dotnet ef database update', 'deny'],
    ['git checkout main', 'ask'],
    ['rm -rf tmp/', 'ask'],
    ['git status', 'none'],
    ['git commit -m "fix: 修复"', 'none'], // commit 走 .githooks 链（本仓有钩子且全绿）；deny 门本身不应拦 commit
  ];
  for (const [cmd, expect] of cases) {
    const r = runHook(cmd, PKG_ROOT); // cwd=本仓：git commit 场景能找到 .githooks
    check(`②${cmd} → ${expect === 'none' ? '不因 deny/ask 门拦' : expect}`,
      r.decision === expect,
      `decision=${r.decision} reason=${r.reason}`);
  }
}

// ---- ③ 127 未装区分（P2-B4）：无 .githooks 的 cwd 跑 git commit → 「门禁未执行」----
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'trae-hook-test-'));
  const r = runHook('git commit -m "x"', empty);
  check('③.githooks 缺失 → deny 且理由为「门禁未执行/不可达」（非违例误报）',
    r.decision === 'deny' && /门禁未执行|不可达/.test(r.reason),
    `decision=${r.decision} reason=${r.reason}`);
  fs.rmSync(empty, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
