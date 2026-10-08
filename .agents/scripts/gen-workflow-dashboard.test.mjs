// gen-workflow-dashboard.test.mjs — workflow 仪表盘测试（2026-10-08 workflow-dashboard，L1）
// 两层：①纯函数直测（closeDurations 四例 / pickPct / durationVerdict 三态 / qualityRows 复用 agg 同值对账）；
//       ②端到端 spawn 一例（CHECK_LOOP_ROOT 注入 fixture，断言 DASHBOARD.md 红绿灯行与结构）。
// fixture：临时 root（intents + confirmations.jsonl + delegations.md 两表）。
// 用法：node templates/_agents/scripts/gen-workflow-dashboard.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const { closeDurations, pickPct, durationVerdict, qualityRows, DURATION_BAND, normalizeForCheck, gateRoiLines } =
  await import(pathToFileURL(path.join(SCRIPT_DIR, 'gen-workflow-dashboard.mjs')).href);
import { createRequire } from 'node:module';
const require2 = createRequire(import.meta.url);
const aggCjs = require2(path.join(SCRIPT_DIR, 'agg-delegations.cjs'));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
};
const W = (root, rel, content) => { fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
const INTENT = (fm) => `---\n${fm}\n---\n# INTENT — x\n`;

// ---- ① closeDurations 四例 ----
{
  const intents = [
    { rel: 'workflow/intents/2026-10-01-same.md', date: '2026-10-01' },   // 同日 → 0
    { rel: 'workflow/intents/2026-09-20-cross.md', date: '2026-09-20' },  // 跨 7 天
    { rel: 'workflow/intents/2026-09-01-multi.md', date: '2026-09-01' },  // 多次 done → 取最早（=14 天，非 3 天）
    { rel: 'workflow/intents/2026-09-05-noledger.md', date: '2026-09-05' }, // 无台账行 → 跳过
    { rel: 'workflow/intents/2026-09-10-baddate.md', date: 'not-a-date' },  // 坏日期 → 跳过
  ];
  const doneMap = new Map([
    ['workflow/intents/2026-10-01-same.md', '2026-10-01T15:00:00.000Z'],
    ['workflow/intents/2026-09-20-cross.md', '2026-09-27T12:00:00.000Z'],
    ['workflow/intents/2026-09-01-multi.md', '2026-09-04T00:00:00.000Z'], // 后发生的 done 行
  ]);
  // 最早 done 行由 collectDoneMap 保证——此处直测取值；「取最早」在 ② 端到端断言
  doneMap.set('workflow/intents/2026-09-01-multi.md', '2026-09-04T00:00:00.000Z');
  const { days, skipped } = closeDurations(intents, doneMap);
  const byRel = new Map(days.map((d) => [d.rel, d.days]));
  check('时长：同日关单 = 0 天', byRel.get('workflow/intents/2026-10-01-same.md') === 0, JSON.stringify(days));
  check('时长：跨 7 天 = 7', byRel.get('workflow/intents/2026-09-20-cross.md') === 7);
  check('时长：doneMap 值即最早行 → 3 天（最早判定在 collectDoneMap，端到端覆盖）', byRel.get('workflow/intents/2026-09-01-multi.md') === 3);
  check('时长：无台账行 + 坏日期 → skipped=2 不虚构', skipped === 2 && !byRel.has('workflow/intents/2026-09-05-noledger.md'), `skipped=${skipped}`);
}

// ---- ② pickPct / durationVerdict 三态 ----
{
  check('pickPct：43 样本 P50=0 / P90=7（真实分布回归基准）',
    pickPct([...Array(26).fill(0), ...Array(9).fill(1), 7, 8, 8, 8, 8], 0.5) === 0
    && pickPct([...Array(26).fill(0), ...Array(9).fill(1), 7, 8, 8, 8, 8], 0.9) === 8,
    `p50=${pickPct([0, 0, 1], 0.5)}`);
  check('pickPct：空 → null', pickPct([], 0.5) === null);
  check('时长带：P50=0/P90=7 → 带内；P50=2 → 超带；null → 无样本',
    durationVerdict(0, 7).ok === true && durationVerdict(2, 5).ok === false && durationVerdict(null, null).ok === null,
    JSON.stringify([durationVerdict(0, 7), durationVerdict(2, 5), durationVerdict(null, null)]));
  check('时长带常量：P50≤1 且 P90≤10（默认带声明）', DURATION_BAND.p50Max === 1 && DURATION_BAND.p90Max === 10);
}

// ---- ③ qualityRows 复用 agg 同值对账 + 端到端 spawn ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-dash-'));
  // delegations.md：2026-09 二十单全「一次通过」（委派 ≥ 样本护栏 minSample=20）→ 口径项全过
  const head = '## 委派结果\n\n| 日期 | 被委派方 | 任务一句话 | 结果 | 备注 |\n|------|----------|------------|------|------|\n';
  const rows9 = [...Array(20)].map((_, i) => `| 2026-09-${String(i + 1).padStart(2, '0')} | x | y${i} | 一次通过 | 2026-09-a${i} |\n`).join('');
  W(root, 'workflow/delegations.md', `${head}${rows9}`);
  // intents + 台账：same=0 / multi 两行 done 取最早（09-01 → 09-03=2 天，第二行 09-10 不采纳）
  W(root, 'workflow/intents/2026-09-01-multi.md', INTENT('状态: done\n级别: L1\n日期: 2026-09-01\n模块: pipeline'));
  W(root, 'workflow/intents/2026-10-01-same.md', INTENT('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline'));
  W(root, 'workflow/intents/2026-09-05-noledger.md', INTENT('状态: done\n级别: L1\n日期: 2026-09-05\n模块: pipeline'));
  W(root, 'workflow/intents/2026-09-06-open.md', INTENT('状态: approved\n级别: L1\n日期: 2026-09-06\n模块: pipeline')); // 非 done 不计
  W(root, '.agents/confirmations.jsonl', [
    JSON.stringify({ ts: '2026-09-02T00:00:00.000Z', doc: 'workflow/intents/2026-09-01-multi.md', stage: 'done' }),
    JSON.stringify({ ts: '2026-09-10T00:00:00.000Z', doc: 'workflow/intents/2026-09-01-multi.md', stage: 'done' }),
    JSON.stringify({ ts: '2026-10-01T20:00:00.000Z', doc: 'workflow/intents/2026-10-01-same.md', stage: 'done' }),
    JSON.stringify({ ts: '2026-09-02T00:00:00.000Z', doc: 'workflow/intents/2026-09-01-multi.md', stage: 'approved' }), // 非 done 行不混
    'not-json-bad-line',
  ].join('\n') + '\n');

  // 纯函数层：qualityRows 与 agg 直算同值
  const q = qualityRows(root);
  check('qualityRows：月份行数与台账月份一致（2026-09 一行）', q.rows.length === 1 && q.rows[0].startsWith('| 2026-09 |'), JSON.stringify(q.rows));
  const m = aggCjs.metrics(aggCjs.readLedger(root, { soft: true }));
  check('qualityRows：复用 agg 同值（total=20）', m.total === 20, `total=${m.total}`);
  check('qualityRows：单月门全过 → 判定「本月达标」（首月连续性 1/2 属 expansionVerdict 语义）',
    q.verdictMap.get('2026-09').includes('达标'), q.verdictMap.get('2026-09'));

  // 端到端：spawn 真脚本（CHECK_LOOP_ROOT 注入）→ DASHBOARD.md 结构断言
  const r = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'gen-workflow-dashboard.mjs')], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, CHECK_LOOP_ROOT: root },
  });
  const dash = fs.readFileSync(path.join(root, 'workflow', 'DASHBOARD.md'), 'utf8');
  check('端到端：exit 0 + 生成 DASHBOARD.md', r.status === 0 && fs.existsSync(path.join(root, 'workflow', 'DASHBOARD.md')), `status=${r.status} ${(r.stdout || '') + (r.stderr || '')}`);
  check('端到端：红绿灯行质量门「达标」+ 时长带 ✅', /达标[^]*质量门/.test(dash) && /✅[^]*关单时长带/.test(dash), dash.slice(0, 500));
  check('端到端：时长取最早 done 行且 floor 日历天（multi=1 天；第二行 9 天不采纳；同日 0 天）',
    dash.includes('| P50 | 1 天 |') && dash.includes('| max | 1 天 |') && /最慢 3 单：2026-09-01-multi\.md=1天、2026-10-01-same\.md=0天/.test(dash), dash);
  check('端到端：无台账行跳过计数（noledger=1）+ 生成于戳 + 勿手改头', dash.includes('无台账行跳过（存量单） | 1 |') && dash.includes('生成于') && dash.includes('勿手改'), dash);
  check('端到端：非 done intent 不入时长样本（open 不出现）', !dash.includes('2026-09-06-open'), dash);
  // 幂等：重跑字节不变
  const before = fs.readFileSync(path.join(root, 'workflow', 'DASHBOARD.md'), 'utf8');
  spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'gen-workflow-dashboard.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('端到端：重跑幂等（生成于戳同 ms 内可能变——除戳行外字节一致）',
    before.split('\n').filter((l) => !l.includes('生成于')).join('\n') === dash.split('\n').filter((l) => !l.includes('生成于')).join('\n'));

  // 空台账装户：无 delegations.md / 无 confirmations.jsonl → 优雅降级不炸
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-dash-empty-'));
  W(empty, 'workflow/intents/2026-10-01-x.md', INTENT('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline'));
  const r2 = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'gen-workflow-dashboard.mjs')], {
    cwd: empty, encoding: 'utf8', env: { ...process.env, CHECK_LOOP_ROOT: empty },
  });
  const dash2 = fs.readFileSync(path.join(empty, 'workflow', 'DASHBOARD.md'), 'utf8');
  check('端到端：空台账装户 → exit 0 + ⚪ 降级（质量门无数据 / 时长无样本 / 跳过 1）',
    r2.status === 0 && dash2.includes('⚪') && dash2.includes('暂无关单样本') && dash2.includes('跳过（存量单） | 1 |'), `status=${r2.status} ${dash2.slice(0, 300)}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
}

// ---- ④ --check 漂移门（2026-10-08 selfmeasure-and-modularize）----
// 归一（CRLF + 「生成于」戳）不过则门禁恒红 = 不可消退噪声（audit-gate-hardening P3），故纯函数层先钉死。
{
  const base = '# dash\n> 生成于 2026-10-07T13:56:00.376Z\n| P50 | 0 天 |\n';
  check('--check 归一：仅「生成于」戳不同 → 归一后相等（否则门禁恒红）',
    normalizeForCheck(base) === normalizeForCheck(base.replace('2026-10-07T13:56:00.376Z', '2026-10-08T00:00:00.000Z')));
  check('--check 归一：CRLF 盘面 vs LF 生成段 → 相等（gen-workflow-index 2026-09-30 同坑先例）',
    normalizeForCheck(base) === normalizeForCheck(base.replace(/\n/g, '\r\n')));
  check('--check 归一：内容真漂移仍不等（归一不得吞真差异）',
    normalizeForCheck(base) !== normalizeForCheck(base.replace('| P50 | 0 天 |', '| P50 | 7 天 |')));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-dash-check-'));
  W(root, 'workflow/intents/2026-10-01-x.md', INTENT('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline'));
  const gen = path.join(SCRIPT_DIR, 'gen-workflow-dashboard.mjs');
  const runCheck = () => spawnSync(process.execPath, [gen, '--check'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CHECK_LOOP_ROOT: root },
  });
  const rMiss = runCheck();
  check('--check 端到端：盘面缺失 → exit 1 + 提示生成', rMiss.status === 1 && /不存在或不可读/.test(rMiss.stderr || ''), `status=${rMiss.status}`);
  spawnSync(process.execPath, [gen], { cwd: root, env: { ...process.env, CHECK_LOOP_ROOT: root } });
  const rOk = runCheck();
  check('--check 端到端：刚生成 → exit 0', rOk.status === 0 && /一致/.test(rOk.stdout || ''), `status=${rOk.status} ${rOk.stdout || ''}${rOk.stderr || ''}`);
  fs.appendFileSync(path.join(root, 'workflow', 'DASHBOARD.md'), '\n<!-- drift -->\n');
  const rDrift = runCheck();
  check('--check 端到端：内容漂移 → exit 1 + 差异行号 + 修复命令',
    rDrift.status === 1 && /首个差异在第 \d+ 行/.test(rDrift.stderr || '') && /gen-workflow-dashboard\.mjs 重新生成/.test(rDrift.stderr || ''), `status=${rDrift.status} ${rDrift.stderr || ''}`);
  const noWrite = fs.readFileSync(path.join(root, 'workflow', 'DASHBOARD.md'), 'utf8');
  check('--check 端到端：不写盘（漂移态下盘面保持原样）', noWrite.includes('<!-- drift -->'));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- ⑤ 门禁 ROI 节（2026-10-08 gate-roi-metrics）----
// 本节存在的核心断言不是「有数值」，而是「**不因运行数据而漂移」**：DASHBOARD 被检查 11 --check 覆盖，
// 采集数值每跑一次门禁就变一次——铺进去等于每次采集必报一条漂移 WARN（不可消除噪声）。
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-dash-roi-'));
  W(root, 'workflow/intents/2026-10-01-x.md', INTENT('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline'));
  const gen = path.join(SCRIPT_DIR, 'gen-workflow-dashboard.mjs');
  const run = (...args) => spawnSync(process.execPath, [gen, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CHECK_LOOP_ROOT: root } });
  const dashOf = () => fs.readFileSync(path.join(root, 'workflow', 'DASHBOARD.md'), 'utf8');

  // 无采集态（先于造 cache 生成）：节恒为静态文案，故与有无数据无关
  const rl = gateRoiLines();
  check('门禁ROI：节内容给出采集命令 + 看数值命令 + 无数据时 CLI 自带「未采集」提示（优雅降级不落空节）',
    rl.join('\n').includes('check-loop.mjs --gate-stats') && rl.join('\n').includes('agg-gate-stats.mjs') && rl.join('\n').includes('未采集'), rl.join('\n'));
  check('门禁ROI：节内容不含任何耗时/次数运行数值（防检查 11 每次采集报漂移的设计核心）',
    !/\d+\s*(ms|s)\b/.test(rl.join('\n')) && !/运行\s*\d/.test(rl.join('\n')), rl.join('\n'));
  run();
  const dash0 = dashOf();
  check('门禁ROI：生成物含该节 + 耗时口径显式声明「含子进程」防误读',
    dash0.includes('## 门禁 ROI') && dash0.includes('含子进程时间'), dash0.slice(-800));

  // 采集数据从无到有 → DASHBOARD 必须仍一致：这是本节设计的核心钉子
  const cacheRel = path.join(root, '.agents', 'cache', 'gate-stats.jsonl');
  fs.mkdirSync(path.dirname(cacheRel), { recursive: true });
  fs.writeFileSync(cacheRel, JSON.stringify({ ts: '2026-10-08T00:00:00Z', segs: [{ id: '8', warns: 3, ms: 11809 }], totalMs: 11809 }) + '\n');
  check('门禁ROI：采集数据「从无到有」后 --check 仍 exit 0', run('--check').status === 0, `status=${run('--check').status}`);
  fs.appendFileSync(cacheRel, JSON.stringify({ ts: '2026-10-08T01:00:00Z', segs: [{ id: '8', warns: 9, ms: 99 }], totalMs: 99 }) + '\n');
  check('门禁ROI：采集数据「再变一次」后 --check 仍 exit 0 且盘面字节恒等（零新增漂移源）',
    run('--check').status === 0 && dashOf() === dash0, `status=${run('--check').status}`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
