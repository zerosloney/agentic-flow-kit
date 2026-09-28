#!/usr/bin/env node
// workflow-board-server 的纯函数测试（2026-09-27 board-kb-p1）
// 核心 = 「双跑断言」的机器化：test.md 要求「涉及看板告警规则时，用同批 workflow fixture 双跑 check-loop
// 与看板 /api/board，断言 hard-block 集合被看板告警覆盖（防口径分叉）」——此前是纯手工步骤且必失败
// （四类 hard-block 看板无对应项）。告警单源化后看板直接消费 check-loop 输出，本测试把双跑断言固化为：
// check-loop fixture 输出 → parseLoopHardBlocks → 断言四类 hard-block 全覆盖。
// 断言：①parseLoopHardBlocks 合成样本四类齐；②真 fixture spawn check-loop → 解析覆盖四类（双跑断言）；
//       ③空/无 hard-block → 空数组；④parseAcceptance 节匹配与 check-loop 检查 8 同口径。
// 用法：node .agents/scripts/workflow-board-server.test.mjs（import 不 listen——server 有 isMain 守卫）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseLoopHardBlocks, parseAcceptance } from './workflow-board-server.mjs';
import { computeFingerprint } from './confirm-doc.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHECK_LOOP = path.join(SCRIPT_DIR, 'check-loop.mjs');

// ---- ①合成样本：四类 hard-block 各一 → 全解析 ----
{
  const sample = [
    '闭环骨架断档（check-loop.sh）— HARD-BLOCK:',
    '',
    '- [配对断裂] intent 缺 plan:x.md',
    '- [回路断档] inc 选「是」但未指明 intent 文件路径',
    '- [验收未对账] done intent 缺「## 验收标准」节(勾验无从核对):x.md',
    '- [确认未对账] x.md 状态 done 无用户确认记录',
    '- [确认内容漂移] x.md done 后内容与确认台账不符',
    '',
    'WARN（advisory,不阻断）:',
    '',
    '- [WARN 状态未确认] plan 必须...',
  ].join('\n');
  const parsed = parseLoopHardBlocks(sample);
  check('①合成样本解析 5 行 hard-block（WARN 段不混入）', parsed.length === 5, JSON.stringify(parsed));
  check('①四类目标 hard-block 全覆盖（回路断档/验收未对账/确认未对账/确认内容漂移）',
    ['回路断档', '验收未对账', '确认未对账', '确认内容漂移'].every((k) => parsed.some((l) => l.includes(k))),
    JSON.stringify(parsed));
}

// ---- ②双跑（真 fixture）：spawn check-loop → parseLoopHardBlocks 覆盖四类 ----
// **检查 8 换锚后的前置条件（2026-09-28 check8-git-anchor）**：检查 8 的生效日锚已从文件名前缀
// 改为「文件首次加入 git 的日期」，故「验收未对账」这条 hard 的产出**需要 git 首次加入日期可判定**；
// 非 git 仓会走存量口径、不再产出该 hard（有意语义，见 spec）。因此本场景需为**真 git 仓**——
// 这不是放宽断言，而是补上使原断言（四类 hard-block 全覆盖）成立的前置；**断言强度与文案均未变**。
{
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'board-loop-test-'));
  for (const s of ['intents', 'specs', 'plans', 'incidents']) fs.mkdirSync(path.join(T, 'workflow', s), { recursive: true });
  fs.mkdirSync(path.join(T, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(T, '.agents', 'workflow-enums.txt'), [
    'doc.status.all=draft approved done superseded cancelled',
    'doc.status.confirmed=approved done superseded cancelled',
    'doc.status.active=draft approved',
    'doc.status.terminal=done superseded cancelled',
    'doc.status.abandoned=superseded cancelled',
    'incident.status.all=open fixed closed',
    'incident.status.active=open',
    'level.all=L0 L1 L2 L3',
  ].join('\n') + '\n');
  const w = (rel, c) => fs.writeFileSync(path.join(T, rel), c);
  // 回路断档：incident 三件套选「是」但引用 intent 不存在
  w('workflow/incidents/2026-09-27-loop.md', '---\n状态: open\n级别: L1\n发现: 2026-09-27\n模块: pipeline\n---\n# INCIDENT — loop\n\n## 复盘三件套\n\n1. 结构性修复\n - 是否需要新 intent:\n - 是 → ../intents/2026-09-12-ghost.md\n2. 防复发验证\n3. 规范条目\n');
  // 验收未对账：done intent 无验收标准节（锚 = git 首次加入日期 → 见上）
  w('workflow/intents/2026-09-27-acc.md', '---\n状态: done\n级别: L1\n日期: 2026-09-27\n模块: pipeline\n---\n# INTENT — acc\n');
  // 确认未对账：done 无指纹无台账
  w('workflow/plans/2026-09-27-cg.md', '---\n状态: done\n级别: L1\n日期: 2026-09-27\n---\n# PLAN — cg\n');
  // 确认内容漂移：done + 台账 prev + 落盘后篡改
  {
    const body = '\n## 验收标准（可测试）\n- [x] 用例通过（证据:fixture）\n';
    const pre = `---\n状态: approved\n级别: L1\n日期: 2026-09-28\n确认指纹: ${'a'.repeat(16)}\n---\n# INTENT — drift\n${body}`;
    const fp = computeFingerprint(pre);
    w('workflow/intents/2026-09-28-drift.md', `---\n状态: done\n级别: L1\n日期: 2026-09-28\n确认指纹: ${fp.slice(0, 16)}\n---\n# INTENT — drift\n${body}确认后篡改行\n`);
    fs.writeFileSync(path.join(T, '.agents', 'confirmations.jsonl'),
      JSON.stringify({ ts: '2026-09-28T02:00:00.000Z', doc: 'workflow/intents/2026-09-28-drift.md', stage: 'done', fingerprint: fp, prev: 'approved', source: 'tty' }) + '\n');
  }
  // 配对齐 plan（避免无关阻断干扰可读性——配对断裂也会在 hard 段，不影响四类断言）
  w('workflow/plans/2026-09-27-loop.md', '---\n状态: draft\n级别: L1\n---\n# PLAN — loop\n');
  w('workflow/plans/2026-09-27-acc.md', '---\n状态: draft\n级别: L1\n---\n# PLAN — acc\n');

  // 真 git 仓（使检查 8 的 git 锚可判定）——本地提交，不入任何远端
  const G = process.platform === 'win32' ? 'git.exe' : 'git';
  spawnSync(G, ['init', '-q'], { cwd: T });
  spawnSync(G, ['add', '-A'], { cwd: T });
  spawnSync(G, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture'], { cwd: T });

  const r = spawnSync(process.execPath, [CHECK_LOOP], { cwd: T, encoding: 'utf8', env: { ...process.env, CHECK_LOOP_ROOT: T } });
  const parsed = parseLoopHardBlocks(r.stderr || '');
  check('②双跑：check-loop fixture exit 1（确有 hard-block）', r.status === 1, `exit=${r.status}\n${r.stderr}`);
  check('②双跑断言：四类 hard-block 均被看板告警解析覆盖',
    ['回路断档', '验收未对账', '确认未对账', '确认内容漂移'].every((k) => parsed.some((l) => l.includes(k))),
    JSON.stringify(parsed));
  fs.rmSync(T, { recursive: true, force: true });
}

// ---- ③空/无 hard-block → 空数组 ----
{
  check('③纯 WARN 输出 → 空数组', parseLoopHardBlocks('check-loop.sh WARN（advisory,不阻断）:\n\n- [WARN x]\n').length === 0);
  check('③空输入 → 空数组', parseLoopHardBlocks('').length === 0);
  check('③exit 0 场景（仅 WARN banner）→ 空数组', parseLoopHardBlocks('check-loop.sh WARN（advisory,不阻断）:\n\n- [WARN 引用断档] x\n').length === 0);
}

// ---- ④parseAcceptance 与 check-loop 检查 8 节匹配同口径 ----
{
  const std = '---\n状态: done\n---\n# I\n\n## 验收标准（可测试）\n- [x] 甲（证据:e）\n- [ ] 乙\n';
  const numbered = '---\n状态: done\n---\n# I\n\n## 三、验收标准\n- [x] 甲（证据:e）\n- [ ] 乙\n';
  check('④标准标题解析 1/2', parseAcceptance(std)?.done === 1 && parseAcceptance(std)?.total === 2, JSON.stringify(parseAcceptance(std)));
  check('④带序号标题（## 三、验收标准）此前识别不到、现在同口径', parseAcceptance(numbered)?.total === 2, JSON.stringify(parseAcceptance(numbered)));
  check('④无验收节 → null', parseAcceptance('---\n状态: done\n---\n# I\n') === null);
}

// ---- ⑤XSS 剥离口径（p2-batch2；复核 P2-3 备注）----
// 注意：strip 与 board/index.html loadDoc 的剥离正则是【同款拷贝、非同源】——改 loadDoc 正则时本场景
// 须同步（防回归能力受限为已知取舍：抽共享模块需前端打包链路，暂不做）。
// activeStatuses 载荷断言未入本套件（server 侧 scanBoard 非纯函数不可直调）——
// 以 /api/board 手工探活留证（复核已实测枚举贯通 + X-Frame-Options DENY）。
{
  const strip = (s) => s.replace(/<[^>]*>/g, '');
  const evil = '正常文字 <img src=x onerror=alert(1)> 更多 <script>alert(2)</script> 结束';
  check('⑤剥标签：img/script 标签清零，正文文字保留',
    !/<(img|script)/.test(strip(evil)) && strip(evil).includes('正常文字') && strip(evil).includes('结束'),
    strip(evil));
  const md = '## 标题\n\n- 列表 **粗体** `code`\n\n[链接](intents/x.md)';
  check('⑤markdown 语法不受剥标签影响', strip(md) === md);
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
