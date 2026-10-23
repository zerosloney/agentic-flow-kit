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
  w(d, 'templates/_githooks/pre-commit', '#!/bin/sh\nif ! node check.mjs; then\n  echo blocked >&2\n  exit 1\nfi\nexit 0\n');
  w(d, 'templates/AGENTS.md', '# 协议\n- 规则一\n- 规则二\n');
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
  const lockPath = path.join(d, 'templates', '_agents', 'engine-lock.json');
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* 断言兜 */ }
  const r = run(d);
  check('T2a --update → exit 0 且基线入账受检面', u.code === 0 && !!lock && !!lock.files['templates/_agents/scripts/gate.mjs'], u.out);
  check('T2b 基线记 hard=3（2 blocker + 1 exit(1)）', !!lock && lock.files['templates/_agents/scripts/gate.mjs'].hard === 3, JSON.stringify(lock && lock.files['templates/_agents/scripts/gate.mjs']));
  check('T2c 钩子入面 hard=1（exit 1 计数）', !!lock && lock.files['templates/_githooks/pre-commit'].hard === 1, JSON.stringify(lock && lock.files['templates/_githooks/pre-commit']));
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

// --- T4 非收缩改动：内容漂移即拦（2026-10-13 移除入口退路后无豁免出口）---
{
  const d = mkfix();
  run(d, ['--update']);
  w(d, 'templates/_agents/scripts/gate.mjs', '// 门禁样例（改写文案）\n// 说明行\ntoast(`hint`);\nblockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n');
  const drift = run(d);
  check('T4a 内容漂移（硬拦面未缩）→ [控制面改动未入基线]',
    drift.code === 1 && drift.out.includes('[控制面改动未入基线]') && drift.out.includes('gate.mjs'), drift.out);
  check('T4a 修法指向 --update（不再宣传不可达的「立 L2 入口」）',
    drift.out.includes('--update') && !drift.out.includes('立 L2 入口'), drift.out);
  check('T4a --update 无凭据 → 拒（须 --note）', run(d, ['--update']).code === 1 && run(d, ['--update']).out.includes('--note'), '');
  check('T4a --update --note 入账后放行', run(d, ['--update', '--note', '改写文案，判据不变']).code === 0 && run(d).code === 0);
}
// --- T4e 入口面即便存在也不豁免（锁死新口径）---
// 1.7.15 卸掉同仓双身份后，包源仓没有 workflow/intents —— 旧「立入口即放行」退路在本仓不可达。
// 删掉该能力后，即使有人在包源仓手工造出入口文档点名该件，**也不得**成为放行口：
// 否则一个 mkdir 就把门重新打开，等于用未验证的路径恢复未验证的能力。
{
  const d = mkfix();
  run(d, ['--update']);
  w(d, 'templates/_agents/scripts/gate.mjs', 'blockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n// 追加注释\n');
  w(d, 'workflow/intents/2026-10-09-ctrl.md',
    '---\n状态: approved\n级别: L2\n日期: 2026-10-09\n模块: gate\n---\n# INTENT\n改动面：gate.mjs\n');
  const r = run(d);
  check('T4e 活跃 L2 入口点名该件 → 仍拦（本门无声明式豁免出口）',
    r.code === 1 && r.out.includes('[控制面改动未入基线]'), r.out);
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
  run(d, ['--update', '--note', '新增 newgate 判据']);
  check('T5c --update --note 把新件入账后 exit 0', run(d).code === 0);
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
  // 改弱门禁 + 同批刷基线：本地层完全自洽（这正是 CI 自指的形态）——凭据不豁免硬拦收缩
  w(d, 'templates/_agents/scripts/gate.mjs', '// 退役一条判据\nblockers.push(`A`);\nif (bad) process.exit(1);\n');
  run(d, ['--update', '--note', '退役 B 判据']);
  const local = run(d);
  check('T7a 改弱 + 刷基线 → 本地层自洽放行（缺陷场景复现）', local.code === 0, local.out);
  const anchored = run(d, ['--against-ref', 'HEAD']);
  check('T7b 跨提交锚（祖先提交基线）出账 [硬拦面收缩（跨提交锚）]',
    anchored.code === 1 && anchored.out.includes('[硬拦面收缩（跨提交锚）]') && /3（见 HEAD）→ 盘面 2/.test(anchored.out), anchored.out);
  // T7c/T7e（2026-10-13 移除入口退路后删除）：原为「活跃 L2 入口点名 → 锚层放行」与「严格档：
  //   模糊提及不豁免」两条断言。二者均依赖 workflow/intents 入口面，而该面在本仓结构性不可达
  //   （1.7.15 卸掉同仓双身份），故能力与测试一并移除——锚层的收缩判定现在**无豁免出口**。
  // T7c 替代断言：造出入口文档点名该件，锚层仍须拦（锁死「无豁免」不随时间被悄悄恢复）
  w(d, 'workflow/intents/2026-10-09-retire.md',
    '---\n状态: approved\n级别: L2\n日期: 2026-10-09\n模块: gate\n---\n# INTENT\n改动面：templates/_agents/scripts/gate.mjs（退役 B 判据）\n');
  git(d, ['add', '-A']);
  git(d, ['commit', '-q', '-m', 'docs(gate): 造入口文档（应不构成放行口）']);
  const declared = run(d, ['--against-ref', 'HEAD~1']);
  check('T7c 入口文档点名该件 → 锚层仍拦（本门无声明式豁免出口）',
    declared.code === 1 && declared.out.includes('[硬拦面收缩（跨提交锚）]'), declared.out);
  // 锚缺失（首个入账提交之前）→ 跳过不误报
  const missing = run(d, ['--against-ref', 'HEAD~9']);
  check('T7d ref 不可解析 → 锚缺失跳过（exit 0 不假阳性）', missing.code === 0 && missing.out.includes('跨提交锚缺失'), missing.out);
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

// --- T9 非包源根：拒绝，不写基线、不建 templates/_agents ---
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-integrity-test-'));
  w(d, '.agents/scripts/gate.mjs', 'blockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n');
  w(d, 'AGENTS.md', '# 协议\n- 规则一\n');
  const u = run(d, ['--update']);
  const plain = run(d);
  check('T9a 非包源根 --update 拒绝', u.code !== 0 && /只在包源仓运行/.test(u.out), u.out);
  check('T9b 非包源根默认模式同样拒绝', plain.code !== 0 && /只在包源仓运行/.test(plain.out), plain.out);
  check('T9c 不写 .agents/engine-lock.json，不建 templates/_agents',
    !fs.existsSync(path.join(d, '.agents', 'engine-lock.json'))
    && !fs.existsSync(path.join(d, 'templates', '_agents')), '');
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

// --- T8 锚层 sha 比对 + note 凭据（2026-10-20 收口：原「保计数改语义 + --update」结构窗关闭）---
if (haveGit) {
  // T8a 合法演进全链：保计数改语义 → --update 无凭据拒 → --note 入账 → 锚层放行
  {
    const d = mkfix();
    git(d, ['init', '-q']);
    git(d, ['config', 'user.email', 't@example.com']);
    git(d, ['config', 'user.name', 'fixture']);
    run(d, ['--update']); // 首次入账：prev 为空、零变更件，不要求凭据
    git(d, ['add', '-A']);
    git(d, ['commit', '-q', '-m', 'chore: 基线入账']);
    // 保计数改语义：内容变、硬拦单位数不变（3→3）
    w(d, 'templates/_agents/scripts/gate.mjs', '// 语义改写：提示词与判定顺序调整\nblockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n');
    const refused = run(d, ['--update']);
    check('T8a-1 保计数改语义 + --update 无凭据 → 拒并指向 --note',
      refused.code === 1 && refused.out.includes('--note') && refused.out.includes('凭据'), refused.out);
    const u = run(d, ['--update', '--note', '语义改写：判定顺序调整，硬拦计数不变']);
    let lock1 = null;
    try { lock1 = JSON.parse(fs.readFileSync(path.join(d, 'templates', '_agents', 'engine-lock.json'), 'utf8')); } catch { /* 断言兜 */ }
    check('T8a-2 --note 入账 → 凭据写入变更件条目',
      u.code === 0 && lock1.files['templates/_agents/scripts/gate.mjs'].note === '语义改写：判定顺序调整，硬拦计数不变', JSON.stringify(lock1.files['templates/_agents/scripts/gate.mjs']));
    git(d, ['add', '-A']);
    git(d, ['commit', '-q', '-m', 'feat: 语义演进（带凭据）']);
    const anchored = run(d, ['--against-ref', 'HEAD~1']);
    check('T8a-3 锚层：sha 变更但带凭据 → 放行（合法演进的显式代价）',
      anchored.code === 0 && anchored.out.includes('盘面与基线一致'), anchored.out);
    // T8b 攻击形态：手剥凭据后，锚层拦（本地层仍自洽绿——只有祖先参照物能出账）
    const lockPath = path.join(d, 'templates/_agents/engine-lock.json');
    let strippedLock = null;
    try { strippedLock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* 断言兜 */ }
    delete strippedLock.files['templates/_agents/scripts/gate.mjs'].note;
    fs.writeFileSync(lockPath, JSON.stringify(strippedLock, null, 2) + '\n');
    const localAfter = run(d);
    check('T8b-1 剥凭据后本地层自洽绿（缺陷只有锚层能看见）', localAfter.code === 0, localAfter.out);
    const stripped = run(d, ['--against-ref', 'HEAD~1']);
    check('T8b-2 锚层：sha 变更且无凭据 → [锚层 sha 变更无凭据]',
      stripped.code === 1 && stripped.out.includes('[锚层 sha 变更无凭据]'), stripped.out);
    fs.rmSync(d, { recursive: true, force: true });
  }
  // T8c 逐文件粘性：新一轮只更新变更件凭据，未变更件的既有凭据沿用
  {
    const d = mkfix();
    git(d, ['init', '-q']);
    git(d, ['config', 'user.email', 't@example.com']);
    git(d, ['config', 'user.name', 'fixture']);
    run(d, ['--update']);
    git(d, ['add', '-A']);
    git(d, ['commit', '-q', '-m', 'chore: 基线入账']);
    w(d, 'templates/_agents/scripts/gate.mjs', '// r1\nblockers.push(`A`);\nblockers.push(`B`);\nif (bad) process.exit(1);\n');
    run(d, ['--update', '--note', 'r1 演进']);
    w(d, 'templates/_githooks/pre-commit', '#!/bin/sh\nif ! node check.mjs; then\n  echo blocked >&2\n  exit 1\nfi\nif ! node check2.mjs; then\n  exit 1\nfi\nexit 0\n');
    run(d, ['--update', '--note', 'r2 钩子加固']);
    let lock2 = null;
    try { lock2 = JSON.parse(fs.readFileSync(path.join(d, 'templates', '_agents', 'engine-lock.json'), 'utf8')); } catch { /* 断言兜 */ }
    check('T8c 粘性凭据：gate 保留 r1、pre-commit 写入 r2',
      lock2.files['templates/_agents/scripts/gate.mjs'].note === 'r1 演进'
      && lock2.files['templates/_githooks/pre-commit'].note === 'r2 钩子加固',
      JSON.stringify({ g: lock2.files['templates/_agents/scripts/gate.mjs'].note, h: lock2.files['templates/_githooks/pre-commit'].note }));
    fs.rmSync(d, { recursive: true, force: true });
  }
}

console.log(`\ncheck-engine-integrity: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
