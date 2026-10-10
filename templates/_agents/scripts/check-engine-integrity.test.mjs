#!/usr/bin/env node
// check-engine-integrity.test.mjs — 门禁本体完整性门 fixture 套件（2026-10-09 P0-A guard-the-guards）
// 方法：构造临时根（templates/_agents/scripts + .githooks + workflow/intents），spawn 脚本断言
//       exit code 与 [标签]；跨提交锚用真 git 仓（init→commit→改弱→--update）端到端验证——
//       那一条是本门存在的理由：本地层自洽（盘面↔基线同刷）时，唯祖先提交参照物仍能出账。
// 用法：node templates/_agents/scripts/check-engine-integrity.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPT_DIR, 'check-engine-integrity.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const w = (root, rel, content) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};
const run = (root, args = []) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const git = (root, args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const haveGit = (() => { const r = spawnSync('git', ['--version'], { encoding: 'utf8' }); return r.status === 0; })();

// 通用 fixture：一份门禁脚本（2 个 blocker + 1 个 exit(1) = 3 硬拦单位）、一个钩子（1 个 exit 1）、AGENTS.md
const mkfix = ({ withEntry = false, entryNames = 'gate.mjs' } = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-integrity-test-'));
  w(d, 'templates/_agents/scripts/gate.mjs',
    '// 门禁样例\nblockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n');
  w(d, '.githooks/pre-commit', '#!/bin/sh\nif ! node check.mjs; then\n  echo blocked >&2\n  exit 1\nfi\nexit 0\n');
  w(d, 'AGENTS.md', '# 协议\n- 规则一\n- 规则二\n');
  if (withEntry) {
    w(d, 'workflow/intents/2026-10-09-ctrl.md',
      `---\n状态: approved\n级别: L2\n日期: 2026-10-09\n模块: gate\n---\n# INTENT\n改动面：templates/_agents/scripts/${entryNames}\n`);
  }
  return d;
};

// --- T1 基线缺失 = 未启用（旧装副本零改动，exit 0）---
{
  const r = run(mkfix());
  check('T1 无基线 → exit 0 且报「未启用」', r.code === 0 && r.out.includes('未启用'), r.out);
}

// --- T2 --update 生成基线后自身一致 ---
{
  const d = mkfix();
  const u = run(d, ['--update']);
  // fixture 无 .agents/ → 基线落包源径（resolveLock 布局回落，见 T9/T10）
  const lockPath = path.join(d, 'templates', '_agents', 'engine-lock.json');
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* 断言兜 */ }
  const r = run(d);
  check('T2a --update → exit 0 且基线入账受检面', u.code === 0 && !!lock && !!lock.files['templates/_agents/scripts/gate.mjs'], u.out);
  check('T2b 基线记 hard=3（2 blocker + 1 exit(1)）', !!lock && lock.files['templates/_agents/scripts/gate.mjs'].hard === 3, JSON.stringify(lock && lock.files['templates/_agents/scripts/gate.mjs']));
  check('T2c 钩子入面 hard=1（exit 1 计数）', !!lock && lock.files['.githooks/pre-commit'].hard === 1, JSON.stringify(lock && lock.files['.githooks/pre-commit']));
  check('T2d 盘面未变 → exit 0 且报「与基线一致」', r.code === 0 && r.out.includes('盘面与基线一致'), r.out);
}

// --- T3 硬拦单位数下降 → 无条件拦（有入口也不放行）---
{
  const d = mkfix({ withEntry: true });
  run(d, ['--update']);
  w(d, 'templates/_agents/scripts/gate.mjs', '// 门禁样例（退役一条 blocker）\nblockers.push(`A`);\nif (bad) process.exit(1);\n');
  const r = run(d);
  check('T3 删 blocker.push → [硬拦面收缩] 且点名文件与减量',
    r.code === 1 && r.out.includes('[硬拦面收缩]') && r.out.includes('gate.mjs') && r.out.includes('3 → 2'), r.out);
  check('T3b 有活跃 L2 入口仍拦（收缩无豁免出口）', r.code === 1 && r.out.includes('[硬拦面收缩]'), r.out);
}

// --- T4 非收缩改动：无入口拦、有入口放行 ---
{
  const d = mkfix();
  run(d, ['--update']);
  w(d, 'templates/_agents/scripts/gate.mjs', '// 门禁样例（改写文案）\n// 说明行\ntoast(`hint`);\nblockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n');
  const noEntry = run(d);
  check('T4a 内容漂移 + 无入口 → [控制面改动无入口]',
    noEntry.code === 1 && noEntry.out.includes('[控制面改动无入口]') && noEntry.out.includes('gate.mjs'), noEntry.out);
  w(d, 'workflow/intents/2026-10-09-ctrl.md',
    '---\n状态: approved\n级别: L2\n日期: 2026-10-09\n模块: gate\n---\n# INTENT\n改动面：templates/_agents/scripts/gate.mjs\n');
  const withEntry = run(d);
  check('T4b 同一改动 + 活跃 L2 入口点名该件 → 放行', withEntry.code === 0, withEntry.out);
}
// --- T4c 入口存在但级别为 L1（协作道）→ 不算点名 ---
{
  const d = mkfix({ withEntry: false });
  run(d, ['--update']);
  w(d, 'templates/_agents/scripts/gate.mjs', 'blockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n// 追加注释不改硬拦面\n');
  w(d, 'workflow/intents/2026-10-09-low.md', '---\n状态: approved\n级别: L1\n日期: 2026-10-09\n模块: gate\n---\n改动面：gate.mjs\n');
  const r = run(d);
  check('T4c L1 入口点名不豁免（控制面须防御道）', r.code === 1 && r.out.includes('[控制面改动无入口]'), r.out);
}
// --- T4d 入口非活跃（done 已关单）→ 不算点名 ---
{
  const d = mkfix({ withEntry: false });
  run(d, ['--update']);
  w(d, 'templates/_agents/scripts/gate.mjs', 'blockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n// 追加注释\n');
  w(d, 'workflow/intents/2026-10-09-done.md', '---\n状态: done\n级别: L2\n日期: 2026-10-09\n模块: gate\n---\n改动面：gate.mjs\n');
  const r = run(d);
  check('T4d done 入口不点名（活跃口径：draft/approved）', r.code === 1 && r.out.includes('[控制面改动无入口]'), r.out);
}

// --- T5 门禁件消失 / 新增件未入基线 ---
{
  const d = mkfix();
  run(d, ['--update']);
  fs.rmSync(path.join(d, 'templates/_agents/scripts/gate.mjs'));
  let r = run(d);
  check('T5a 删除门禁件 → [门禁件消失]', r.code === 1 && r.out.includes('[门禁件消失]'), r.out);
}
{
  const d = mkfix();
  run(d, ['--update']);
  w(d, 'templates/_agents/scripts/newgate.mjs', 'blockers.push(`X`);\n');
  const r = run(d);
  check('T5b 新受检件未入账 → [门禁件未入基线]，--update 后放行',
    r.code === 1 && r.out.includes('[门禁件未入基线]') && r.out.includes('newgate.mjs'), r.out);
  run(d, ['--update']);
  check('T5c --update 把新件入账后 exit 0', run(d).code === 0);
}

// --- T6 外部副本锚 ---
{
  const d = mkfix();
  run(d, ['--update']);
  const bad = run(d, ['--against', path.join(d, 'nope')]);
  check('T6a --against 目录不存在 → 用法错误 exit 2', bad.code === 2 && bad.out.includes('目录不存在'), bad.out);
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-integrity-ext-'));
  w(ext, 'templates/_agents/scripts/gate.mjs', '// 外部已知良好副本（与盘面不同）\nblockers.push(`A`);\n');
  const r = run(d, ['--against', ext]);
  check('T6b 与外部副本逐字失配 → [外部锚失配]', r.code === 1 && r.out.includes('[外部锚失配]'), r.out);
}

// --- T7 跨提交锚（真 git 仓端到端：本门存在的理由）---
if (haveGit) {
  const d = mkfix();
  git(d, ['init', '-q']);
  git(d, ['config', 'user.email', 't@example.com']);
  git(d, ['config', 'user.name', 'fixture']);
  run(d, ['--update']);
  git(d, ['add', '-A']);
  git(d, ['commit', '-q', '-m', 'chore: 基线入账']);
  // 改弱门禁 + 同批刷基线：本地层完全自洽（这正是 CI 自指的形态）
  w(d, 'templates/_agents/scripts/gate.mjs', '// 退役一条判据\nblockers.push(`A`);\nif (bad) process.exit(1);\n');
  run(d, ['--update']);
  const local = run(d);
  check('T7a 改弱 + 刷基线 → 本地层自洽放行（缺陷场景复现）', local.code === 0, local.out);
  const anchored = run(d, ['--against-ref', 'HEAD']);
  check('T7b 跨提交锚（祖先提交基线）出账 [硬拦面收缩（跨提交锚）]',
    anchored.code === 1 && anchored.out.includes('[硬拦面收缩（跨提交锚）]') && /3（见 HEAD）→ 盘面 2/.test(anchored.out), anchored.out);
  // 合法退役出口：活跃 L2 入口点名该件
  w(d, 'workflow/intents/2026-10-09-retire.md',
    '---\n状态: approved\n级别: L2\n日期: 2026-10-09\n模块: gate\n---\n# INTENT\n改动面：templates/_agents/scripts/gate.mjs（退役 B 判据）\n');
  git(d, ['add', '-A']);
  git(d, ['commit', '-q', '-m', 'docs(gate): L2 入口留痕']);
  const declared = run(d, ['--against-ref', 'HEAD~1']);
  check('T7c 声明过的收缩（L2 入口点名）→ 跨提交锚放行', declared.code === 0, declared.out);
  // 锚缺失（首个入账提交之前）→ 跳过不误报
  const missing = run(d, ['--against-ref', 'HEAD~9']);
  check('T7d ref 不可解析 → 锚缺失跳过（exit 0 不假阳性）', missing.code === 0 && missing.out.includes('跨提交锚缺失'), missing.out);
  // 严格档反例（T7e）：正文顺手提及 ≠ 声明改动面——存量无关 L2 文档不得替改弱行为背书
  w(d, 'workflow/intents/2026-10-09-retire.md',
    '---\n状态: superseded\n级别: L2\n日期: 2026-10-09\n模块: gate\n---\n# INTENT\n改动面：templates/_agents/scripts/gate.mjs\n');
  w(d, 'workflow/intents/2026-10-09-prose.md',
    '---\n状态: approved\n级别: L2\n日期: 2026-10-09\n模块: gate\n---\n# INTENT\n本批沿用 gate.mjs 与 check-loop.mjs 的既有判据，未改动它们。\n');
  git(d, ['add', '-A']);
  git(d, ['commit', '-q', '-m', 'docs(gate):  prose 提及（非声明改动面）']);
  const prose = run(d, ['--against-ref', 'HEAD~2']);
  check('T7e 正文提及但无 §改动面 声明 → 跨提交锚仍拦（严格档：模糊提及不豁免收缩）',
    prose.code === 1 && prose.out.includes('[硬拦面收缩（跨提交锚）]'), prose.out);
} else {
  console.log('SKIP T7 跨提交锚（未找到 git）');
}

// --- T8 --quiet 静默面（钩子里调用不刷屏）---
{
  const d = mkfix();
  run(d, ['--update']);
  const r = run(d, ['--quiet']);
  check('T8 --quiet 通过时不打印 ✅ 行', r.code === 0 && !r.out.includes('✅'), r.out);
}

// --- T9 装户布局：.agents/ 在 → 基线落装户径，不新建 templates/_agents/engine-lock.json ---
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-integrity-test-'));
  w(d, '.agents/scripts/gate.mjs', 'blockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n');
  w(d, 'AGENTS.md', '# 协议\n- 规则一\n');
  const u = run(d, ['--update']);
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(path.join(d, '.agents', 'engine-lock.json'), 'utf8')); } catch { /* 断言兜 */ }
  check('T9a .agents/ 在 → --update 落 .agents/engine-lock.json（装户径行为不变）',
    u.code === 0 && !!lock && !!lock.files['.agents/scripts/gate.mjs'], u.out);
  check('T9b 装户布局不新建 templates/_agents/engine-lock.json',
    !fs.existsSync(path.join(d, 'templates', '_agents', 'engine-lock.json')), '');
  fs.rmSync(d, { recursive: true, force: true });
}

// --- T10 包源布局：无 .agents/ → 基线落包源径，不得重建装户目录（装户端内容清理后回归锁）---
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-integrity-test-'));
  w(d, 'templates/_agents/scripts/gate.mjs', 'blockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n');
  w(d, 'templates/AGENTS.md', '# 协议\n- 规则一\n');
  const u = run(d, ['--update']);
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(path.join(d, 'templates', '_agents', 'engine-lock.json'), 'utf8')); } catch { /* 断言兜 */ }
  check('T10a 无 .agents/ → --update 落 templates/_agents/engine-lock.json 且入账受检面',
    u.code === 0 && !!lock && !!lock.files['templates/_agents/scripts/gate.mjs'], u.out);
  check('T10b --update 不重建 .agents/ 目录（旧实现按装户径兜底会重建已清理的装户目录）',
    !fs.existsSync(path.join(d, '.agents')), '');
  const r = run(d);
  check('T10c 基线启用 → 「盘面与基线一致」且未启用提示点包源径',
    r.code === 0 && r.out.includes('盘面与基线一致'), r.out);
  fs.rmSync(d, { recursive: true, force: true });
}

console.log(`\ncheck-engine-integrity: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
