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
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// 夹具闭包（2026-10-12 fixture-closure-rootfix）：入口 agg-delegations.cjs 的传递依赖自动带入（当前无，
// 但日后加 import 不必回来改这里——漏拷 = 假绿）。
const { copyScriptClosure } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'fixture-scripts.mjs')).href);
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
  copyScriptClosure(path.join(root, '.agents', 'scripts'), ['agg-delegations.cjs']);
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
const { metrics, gateMonth, expansionVerdict, parseResult, parseVerdict, fmtAccept, ACCEPT_MIN_SAMPLE } = requireCjs(path.join(SCRIPT_DIR, 'agg-delegations.cjs'));

// 场景 4：审查反例——30 任务、2 主兜底、平均返工 0.25（旧口径四门全过，声明口径下必须 ❌）
{
  const rows = [
    ...Array.from({ length: 22 }, () => ({ scope: '委派', result: '一次通过' })),
    ...Array.from({ length: 6 }, () => ({ scope: '委派', result: '返工×1' })),
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

// 场景 8：产出接受率（2026-10-12 merge-accept-rate）
// 动机（METR 2026-03）：agent 生成的 SWE-bench 通过 PR，维护者合并判定比自动评分低约 24 个百分点、
// 约一半不会被合入——「自动门全绿」与「人愿意合」是两个维度，混列必被前者盖过后者。
{
  check('场景 8：parseVerdict 三档 + 留空/乱填落 null（未记录 ≠ 未合入）',
    parseVerdict('合入') === 'accepted' && parseVerdict('返工后合入') === 'accepted-after-rework'
    && parseVerdict('未合入') === 'rejected'
    && parseVerdict('') === null && parseVerdict(undefined) === null && parseVerdict('已上线') === null,
    JSON.stringify([parseVerdict('合入'), parseVerdict('返工后合入'), parseVerdict('未合入'), parseVerdict(''), parseVerdict('已上线')]));

  // 反例钉子：一次通过率 100% 但接受率低 —— 这正是混列会掩盖的形态
  const rows = [
    ...Array.from({ length: 8 }, () => ({ scope: '自做', result: '一次通过', verdict: '合入' })),
    { scope: '自做', result: '一次通过', verdict: '未合入' },
    { scope: '自做', result: '一次通过', verdict: '返工后合入' },
    { scope: '自做', result: '一次通过' }, // 留空 = 未记录，不入分母
  ];
  const m = metrics(rows);
  check('场景 8：一次通过率 100% 但接受率 90%（8 合入 + 1 返工后合入 / 10 已记录）',
    Math.abs(m.passRate - 1) < 1e-9 && Math.abs(m.acceptRate - 0.9) < 1e-9,
    JSON.stringify({ passRate: m.passRate, acceptRate: m.acceptRate }));
  check('场景 8：留空行不入分母（verdictRecorded=10 而非 11）',
    m.verdictRecorded === 10 && m.accepted === 9 && m.rejected === 1, JSON.stringify(m));
  check('场景 8：接受率不影响任何扩容门项（观测项非门槛项——METR 缺口不靠加门堵）',
    gateMonth(m).items.length === 6, JSON.stringify(gateMonth(m).items.map((i) => i.no)));

  // 样本护栏：不足 ACCEPT_MIN_SAMPLE 条不出率（给小样本比率 = 给噪声开门）
  check('场景 8：护栏阈值 = 5 且与脚本常量同源（文档写死一处会漂）', ACCEPT_MIN_SAMPLE === 5, String(ACCEPT_MIN_SAMPLE));
  const tiny = metrics([{ scope: '自做', result: '一次通过', verdict: '未合入' }]);
  check('场景 8：样本 <5 → acceptRate=null 且 fmtAccept 注明样本数',
    tiny.acceptRate === null && fmtAccept(tiny).includes(`样本 1/${ACCEPT_MIN_SAMPLE}`), `${String(tiny.acceptRate)} | ${fmtAccept(tiny)}`);
  check('场景 8：零记录 → fmtAccept 显式说明而非打 0%',
    fmtAccept(metrics([{ scope: '自做', result: '一次通过' }])).includes('零记录'), fmtAccept(metrics([{ scope: '自做', result: '一次通过' }])));

  // 存量兼容：无 verdict 字段的行（旧行对象）零影响
  const legacy = metrics([{ scope: '自做', result: '一次通过' }, { scope: '委派', result: '返工×1' }]);
  check('场景 8：存量行（无 verdict 键）零影响——verdictRecorded=0 / 一次通过率与旧口径一致',
    legacy.verdictRecorded === 0 && legacy.total === 2 && Math.abs(legacy.passRate - 0.5) < 1e-9,
    JSON.stringify(legacy));
}

// 场景 9：表结构兼容 —— 末列缺省不误判（存量表不要求补列）
{
  const root = mkfix([
    '# 量化证据台账（fixture）',
    '',
    '## 委派结果',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 |',
    '|------|----------------|------------|------|------|',
    '| 2026-09-23 | executor(子代理) | 旧表结构行（无合入结论列） | 一次通过 | fixture |',
    '',
  ].join('\n'));
  const r = runAgg(root);
  check('场景 9：存量五列表 → exit 0 且正常入账', r.status === 0 && /有效任务 1（/.test(r.stdout), `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 9：合入结论零记录 → 接受率显示「零记录」', r.stdout.includes('零记录'), r.stdout);
  fs.rmSync(root, { recursive: true, force: true });

  const root2 = mkfix([
    '# 量化证据台账（fixture）',
    '',
    '## 委派结果',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 | 合入结论 |',
    '|------|----------------|------------|------|------|----------|',
    ...Array.from({ length: 8 }, (_, i) => `| 2026-10-0${i + 1} | executor(子代理) | 新表结构行 | 一次通过 | fixture | 合入 |`),
    '| 2026-10-09 | executor(子代理) | 新表结构行 | 一次通过 | fixture | 未合入 |',
    '| 2026-10-10 | executor(子代理) | 新表结构行 | 一次通过 | fixture | 返工后合入 |',
    '',
  ].join('\n'));
  const r2 = runAgg(root2);
  check('场景 9：六列表 → 末列正确解析（已记录 10 / 合入 9 / 未合入 1）',
    r2.status === 0 && /已记录合入结论 10 行｜合入 9｜未合入 1/.test(r2.stdout), `exit=${r2.status}\n${r2.stdout}${r2.stderr}`);
  check('场景 9：快照行含接受率列（90%（9/10）——样本过护栏才出率）',
    /\|\s*90%（9\/10）\s*\|/.test(r2.stdout), r2.stdout);
  fs.rmSync(root2, { recursive: true, force: true });
}

// ---- 场景 10：原因谱系（2026-10-20 谱系统一，自源仓 causeSummary 回灌）——纯函数直测 ----
{
  const { createRequire } = await import('node:module');
  const requireCjs = createRequire(import.meta.url);
  const agg = requireCjs('./agg-delegations.cjs');
  const P = (s) => agg.parseResult(s);
  check('场景 10：返工（原因）解析带 cause', P('返工×2（需求歧义）').cause === '需求歧义' && P('返工×2（需求歧义）').rework === 2, '');
  check('场景 10：主兜底（原因）解析带 cause', P('主兜底（环境）').cause === '环境' && P('主兜底（环境）').kind === 'fallback', '');
  check('场景 10：门禁噪声括号位不与原因混（互斥优先）', P('返工×1（门禁噪声）').kind === 'rework-noise' && P('返工×1（门禁噪声）').cause === undefined, '');
  check('场景 10：裸返工无 cause（存量口径）', P('返工×1').cause === undefined && P('返工×1').kind === 'rework', '');
  const cs = agg.causeSummary([
    { date: '2026-10-19', result: '返工×1' },
    { date: '2026-10-21', result: '返工×1' },
    { date: '2026-10-21', result: '返工×2（需求歧义）' },
    { date: '2026-10-21', result: '主兜底（环境）' },
    { date: '2026-10-21', result: '一次通过' },
  ]);
  check('场景 10：直方图 + 锚前/锚后分列（存量不回填≠欠账）',
    cs.hist['需求歧义'] === 1 && cs.hist['环境'] === 1 && cs.unrecorded === 2 && cs.unrecordedPre === 1 && cs.unrecordedSince === 1
    && cs.text.includes('需求歧义1') && cs.text.includes('环境1'), JSON.stringify(cs));
  const met = agg.metrics([
    { scope: '委派', date: '2026-10-21', result: '返工×1（复核采纳）', verdict: '合入' },
    { scope: '委派', date: '2026-10-21', result: '返工×1（需求歧义）', verdict: '返工后合入' },
    { scope: '委派', date: '2026-10-21', result: '主兜底（环境）', verdict: '' },
  ]);
  check('场景 10：复核采纳不计门 3 设计返工（主兜底写原因仍计门 4）',
    met.reworkSum === 1 && met.adoptedRework === 1 && met.fallback === 1
    && agg.gateMonth(met).items.find((i) => i.no === 3).ok === false
    && agg.gateMonth(met).items.find((i) => i.no === 4).ok === false, JSON.stringify({ rs: met.reworkSum, ad: met.adoptedRework }));
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(`\n${USAGE}`);
  process.exit(1);
}
process.exit(0);
