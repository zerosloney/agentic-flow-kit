#!/usr/bin/env node
// agg-delegations.cjs 的 fixture 驱动测试（2026-09-24 随「台账结构漂移静默吞数据」修复引入）
// 被测脚本以 __dirname 定位台账，故复制脚本进临时根（<tmp>/.agents/scripts/）后以 cwd=<tmp> 运行。
// 断言：①节标题缺失但表头合规 → 数据照常入账（本次事故形态回归）；②日期数据行在但表头不可识别 → exit 1 fail-loud；
//       ③空台账（表头合规、无数据行）→ exit 0 且提示为空。
// 用法：node .agents/scripts/agg-delegations.test.mjs（在仓库任意目录执行均可）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(SCRIPT_DIR, 'agg-delegations.cjs');
const USAGE = '用法：node .agents/scripts/agg-delegations.test.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const mkfix = (ledgerText) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agg-delegations-test-'));
  fs.mkdirSync(path.join(root, '.agents', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflow', 'incidents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'delegations.md'), ledgerText, 'utf8');
  fs.copyFileSync(SRC, path.join(root, '.agents', 'scripts', 'agg-delegations.cjs'));
  return root;
};
const runAgg = (root) => spawnSync(process.execPath, [path.join(root, '.agents', 'scripts', 'agg-delegations.cjs')], { cwd: root, encoding: 'utf8' });

// ---- 场景 1：无 `## ` 节标题、表头合规（2026-09-24 事故形态）→ 数据照常入账 ----
{
  const root = mkfix([
    '# 量化证据台账（fixture）',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 |',
    '|------|----------------|------------|------|------|',
    '| 2026-09-23 | general-purpose(子代理) | 示例委派任务 | 一次通过 | fixture |',
    '| 2026-09-24 | executor(子代理) | 结果列拼错的示例行 | 成功 | fixture |',
    '',
  ].join('\n'));
  const r = runAgg(root);
  check('场景 1：节标题缺失 + 表头合规 → exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 1：数据行入账（有效任务 1，非「台账为空」）', /有效任务 1（/.test(r.stdout) && !r.stdout.includes('台账为空'), r.stdout);
  check('场景 1：未知结果单列计数（不混入待修，2026-09-24 口径分离）', r.stdout.includes('待修 0、未知结果 1'), r.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：日期数据行在但表头不可识别 → fail-loud（不再静默「台账为空」）----
{
  const root = mkfix([
    '# 量化证据台账（fixture）',
    '',
    '| when | who | what | result | note |',
    '|------|-----|------|--------|------|',
    '| 2026-09-23 | executor | 表头被改的行 | 一次通过 | fixture |',
    '',
  ].join('\n'));
  const r = runAgg(root);
  check('场景 2：表头不可识别 → exit 1', r.status === 1, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 2：报错点名结构漂移', (r.stderr || '').includes('结构漂移'), r.stderr);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：空台账（表头合规、无数据行）→ exit 0 且提示为空 ----
{
  const root = mkfix([
    '# 量化证据台账（fixture）',
    '',
    '## 委派结果',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 |',
    '|------|----------------|------------|------|------|',
    '',
    '## 自做任务结果',
    '',
    '| 日期 | 任务一句话 | 结果 | 备注 |',
    '|------|------------|------|------|',
    '',
  ].join('\n'));
  const r = runAgg(root);
  check('场景 3：空台账 → exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 3：提示台账为空', r.stdout.includes('台账为空'), r.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4-5：扩容门口径（2026-09-27 board-kb-p1 对齐 delegations.md：返工 0 / 无主兜底 / 连续两月）----
//     纯函数经 module.exports require（isMain 守卫后 import 不执行 main）
import { createRequire } from 'node:module';
const requireCjs = createRequire(import.meta.url);
const { metrics, gateMonth, expansionVerdict, parseResult } = requireCjs(path.join(SCRIPT_DIR, 'agg-delegations.cjs'));

// 场景 4：审查反例——30 任务、2 主兜底、平均返工 0.25（旧口径四门全过，声明口径下必须 ❌）
{
  const rows = [
    ...Array.from({ length: 22 }, (_, i) => ({ scope: '委派', result: '一次通过' })),
    ...Array.from({ length: 6 }, (_, i) => ({ scope: '委派', result: '返工×1' })),
    { scope: '委派', result: '主兜底' }, { scope: '委派', result: '主兜底' },
  ];
  const m = metrics(rows);
  const g = gateMonth(m);
  check('场景 4：反例（2 主兜底 + 平均返工 0.25）门3 返工=0 ❌', g.items.find((i) => i.no === 3).ok === false, JSON.stringify(g.items));
  check('场景 4：反例门4 主兜底=0 ❌ 且 monthOk=false（声明口径下不达标）',
    g.items.find((i) => i.no === 4).ok === false && g.monthOk === false, `monthOk=${g.monthOk}`);
  const good = metrics([{ scope: '自做', result: '一次通过' }, { scope: '委派', result: '一次通过' }]);
  const g2 = gateMonth(good);
  check('场景 4：返工 0 + 无主兜底月 → 口径项全 ✅（样本护栏项单独列出）',
    g2.items.filter((i) => i.kind === '口径').every((i) => i.ok === true) && g2.items.find((i) => i.no === 1).ok === false,
    JSON.stringify(g2.items));
}
// 场景 5：连续两月判定四态
{
  check('场景 5：本月+上月均达标 → ✅ 可扩容', expansionVerdict(true, true, false, []).includes('✅'));
  check('场景 5：本月达标、上月无数据 → ⚠️ 1/2', expansionVerdict(true, undefined, true, []).includes('⚠️'));
  check('场景 5：本月达标、上月未达标 → ⚠️ 1/2', expansionVerdict(true, false, false, []).includes('⚠️'));
  check('场景 5：本月未达标 → ❌ 且列出未达标项号', expansionVerdict(false, true, false, [{ no: 3, ok: false }, { no: 4, ok: false }]).match(/❌.*3\+4/));
}

// 场景 6：门禁噪声返工拆分（2026-10-08 selfmeasure-and-modularize）
// 动机：本仓质量门连续两月红（55% / 61% < 90%），根因是门禁噪声与设计返工同判第 3 项 → 指标不指示改进方向。
{
  check('场景 6：parseResult 识别门禁噪声档（kind=rework-noise；2026-10-08 rework-attribution-split 更正：rework 分量归 0——噪声不是设计返工；外部行为 metrics/第 3 项不变）',
    parseResult('返工×2（门禁噪声）').kind === 'rework-noise' && parseResult('返工×2（门禁噪声）').reworkNoise === 2
    && parseResult('返工×2（门禁噪声）').rework === 0, JSON.stringify(parseResult('返工×2（门禁噪声）')));
  check('场景 6：存量四档解析逐条不变（向后兼容钉子）',
    parseResult('一次通过').kind === 'pass' && parseResult('返工×2').kind === 'rework'
    && parseResult('返工×2').rework === 2 && parseResult('主兜底').kind === 'fallback'
    && parseResult('返工待修').kind === 'pending' && parseResult('乱填').kind === 'unknown');
  check('场景 6：新旧形态互不误吞（$ 锚定；半角括号不认）',
    parseResult('返工×1（门禁噪声）').kind !== 'rework' && parseResult('返工×1(门禁噪声)').kind === 'unknown');

  const rows = [
    { scope: '自做', result: '返工×2（门禁噪声）' },   // 噪声
    { scope: '自做', result: '返工×3（门禁噪声）' },   // 噪声
    { scope: '自做', result: '一次通过' },
  ];
  const m = metrics(rows);
  check('场景 6：双列累计分离（设计返工 0 / 噪声 5）',
    m.reworkSum === 0 && m.reworkNoiseSum === 5, JSON.stringify({ reworkSum: m.reworkSum, noise: m.reworkNoiseSum }));
  check('场景 6：平均返工仍含噪声（快照行口径不变，delegations.md 表结构零改动）',
    Math.abs(m.avgRework - 5 / 3) < 1e-9, String(m.avgRework));
  const g = gateMonth(m);
  const i3 = g.items.find((i) => i.no === 3);
  check('场景 6：扩容门第 3 项只对设计返工判 ok=true（噪声不计入）', i3.ok === true, JSON.stringify(i3));
  check('场景 6：噪声数字在描述里显式可见（不隐藏）', /门禁噪声返工 5 次已剥离单列/.test(i3.desc), i3.desc);

  // 反向：设计返工不得因存在噪声档而被放过
  const mixed = metrics([{ scope: '自做', result: '返工×1' }, { scope: '自做', result: '返工×1（门禁噪声）' }]);
  check('场景 6：反例——设计返工 1 + 噪声 1 → 门 3 ❌（噪声标签不能洗白设计返工）',
    gateMonth(mixed).items.find((i) => i.no === 3).ok === false, JSON.stringify(gateMonth(mixed).items[2]));
}

// 场景 7：行内双值归因（2026-10-08 rework-attribution-split）
// 动机：存量逐行审计（29 行含返工）证实单值格式无法表达混合归因——一行只记一个返工总数时，
// 「1 次设计 + 1 次噪声」只能整行倒向某一侧。行内双值是作者写入时确定已知的归因事实，不反推。
{
  const mixed = parseResult('返工×1 + 门禁噪声×1');
  check('场景 7：行内双值解析出两个分量（kind=rework-mixed）',
    mixed.kind === 'rework-mixed' && mixed.rework === 1 && mixed.reworkNoise === 1, JSON.stringify(mixed));
  check('场景 7：宽容空格（无空格变体亦可解析）',
    parseResult('返工×2+门禁噪声×3').rework === 2 && parseResult('返工×2+门禁噪声×3').reworkNoise === 3);
  check('场景 7：四个返工格式互不误吞',
    parseResult('返工×2').kind === 'rework' && parseResult('返工×2').reworkNoise === 0
    && parseResult('返工×2（门禁噪声）').kind === 'rework-noise'
    && parseResult('返工×2（门禁噪声）').rework === 0
    && parseResult('一次通过').kind === 'pass' && parseResult('乱填').kind === 'unknown');
  check('场景 7：非法数字落 unknown（记录本身有问题，不混进待修）',
    parseResult('返工×a + 门禁噪声×1').kind === 'unknown');

  // 不变量①：任务总数不虚增——一行仍是一个任务，两个数字不拆成两个任务
  const rows = [
    { scope: '自做', result: '返工×1 + 门禁噪声×2' },
    { scope: '自做', result: '返工×1 + 门禁噪声×2' },
    { scope: '自做', result: '一次通过' },
  ];
  const m = metrics(rows);
  check('场景 7：不变量①——total 按行计 1（行内双值不虚增任务数 / 不抬高 passRate 分母）',
    m.total === 3, `total=${m.total}`);
  check('场景 7：双列准确累计（设计返工 2 / 门禁噪声 4）',
    m.reworkSum === 2 && m.reworkNoiseSum === 4, JSON.stringify({ r: m.reworkSum, n: m.reworkNoiseSum }));
  check('场景 7：一次通过率分母不变（1/3，与若拆成两行的结果不同——这是选行内双值而非拆行的理由）',
    Math.abs(m.passRate - 1 / 3) < 1e-9, String(m.passRate));

  // 混合行的门 3 判定：设计返工 0 + 噪声 4 → ok；设计返工 2 → ❌
  const onlyNoise = metrics([{ scope: '自做', result: '返工×0 + 门禁噪声×3' }, { scope: '自做', result: '一次通过' }]);
  const i3ok = gateMonth(onlyNoise).items.find((i) => i.no === 3);
  check('场景 7：纯噪声混合行 → 门 3 ✅ 且描述带噪声数',
    i3ok.ok === true && /门禁噪声返工 3 次已剥离单列/.test(i3ok.desc), JSON.stringify(i3ok));
  const withDesign = gateMonth(m).items.find((i) => i.no === 3);
  check('场景 7：含设计返工的混合行 → 门 3 ❌（噪声分量不能洗白设计分量）',
    withDesign.ok === false, JSON.stringify(withDesign));
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(`\n${USAGE}`);
  process.exit(1);
}
process.exit(0);
