#!/usr/bin/env node
// gen-workflow-metrics.mjs 的 fixture 驱动测试
// 现场构造临时语料（换 cwd 运行被测脚本，脚本按相对路径读 workflow/ 与 .agents/rule-budgets.txt）。
// 断言：①主路径——类型聚合/活跃终态/模块已填/常驻面峰值/INDEX 活跃行；②同月重跑 upsert 不重复、跨月按月升序；
//       ③失败路径——非法 --month / 未知参数 exit 1。
// 用法：node .agents/scripts/gen-workflow-metrics.test.mjs（在仓库任意目录执行均可）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.join(SCRIPT_DIR, 'gen-workflow-metrics.mjs');
const USAGE = '用法：node .agents/scripts/gen-workflow-metrics.test.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const doc = (fm, title) => `---\n${fm}\n---\n# ${title}\n`;

const mkfix = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-workflow-metrics-test-'));
  for (const d of ['intents', 'specs', 'plans', 'incidents']) fs.mkdirSync(path.join(root, 'workflow', d), { recursive: true });
  fs.mkdirSync(path.join(root, '.agents', 'commands'), { recursive: true });
  const w = path.join(root, 'workflow');
  fs.writeFileSync(path.join(w, 'intents', '2026-09-21-a.md'), doc('状态: approved\n级别: L1\n日期: 2026-09-21\n模块: pipeline', 'INTENT — 甲'), 'utf8');
  fs.writeFileSync(path.join(w, 'plans', '2026-09-21-a.md'), doc('状态: approved\n级别: L1\n模块: pipeline', 'PLAN — 甲'), 'utf8');
  fs.writeFileSync(path.join(w, 'plans', '2026-09-19-b.md'), doc('状态: done\n级别: L1\n模块: material', 'PLAN — 乙'), 'utf8');
  fs.writeFileSync(path.join(w, 'incidents', '2026-09-18-c.md'), doc('状态: closed\n级别: L2\n发现: 2026-09-18', 'INCIDENT — 丙'), 'utf8');
  fs.writeFileSync(path.join(w, 'intents', '_TEMPLATE.md'), doc('状态: draft\n级别: L1', 'INTENT — 模板'), 'utf8');
  fs.writeFileSync(path.join(w, 'INDEX.md'), '# index fixture\n\n## 活跃（2）\n\n| 类型 |\n|---|\n', 'utf8');
  // 预算表：AGENTS.md 120B / 上限 100 → 峰值 120%；commands 单篇与合计都远低于上限
  fs.writeFileSync(path.join(root, '.agents', 'rule-budgets.txt'), [
    '# fixture 预算表',
    'AGENTS.md 100',
    '.agents/commands/*.md 50',
    '.agents/commands/ 100',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'x'.repeat(120), 'utf8');
  fs.writeFileSync(path.join(root, '.agents', 'commands', 'plan.md'), 'y'.repeat(10), 'utf8');
  return root;
};

const run = (root, args) => spawnSync(process.execPath, [GEN, ...args], { cwd: root, encoding: 'utf8' });
const readMetrics = (root) => fs.readFileSync(path.join(root, 'workflow', 'metrics.md'), 'utf8');

// ---- 场景 1：主路径——一行算对 ----
{
  const root = mkfix();
  const r = run(root, ['--month', '2026-09']);
  const md = fs.existsSync(path.join(root, 'workflow', 'metrics.md')) ? readMetrics(root) : '';
  check('场景 1：生成 exit 0 且落盘 workflow/metrics.md', r.status === 0 && md.length > 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 1：行含 4（活跃 2 / 终态 2）+ 模块 3/4', /\| 2026-09 \| 4（活跃 2 \/ 终态 2） \| .* \| 3\/4 \|/.test(md), md);
  check('场景 1：常驻面峰值取最紧项（120.0% AGENTS.md）', /峰值 120\.0% AGENTS\.md/.test(md), md);
  check('场景 1：常驻面合计 = AGENTS.md + commands 逐文件（130B → 0.1 KB）', /0\.1 KB（峰值/.test(md), md);
  check('场景 1：INDEX 活跃行解析（2 行）', /（2 行） \|/.test(md), md);
  check('场景 1：_TEMPLATE.md 不计入（4 篇而非 5 篇）', !/\| 5（/.test(md), md);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：同月重跑 upsert 不重复；跨月按月升序 ----
{
  const root = mkfix();
  run(root, ['--month', '2026-09']);
  run(root, ['--month', '2026-09']);
  let md = readMetrics(root);
  const funnelMark = '## 闭环漏斗';
  const bodyPart = md.slice(0, md.includes(funnelMark) ? md.indexOf(funnelMark) : undefined);
  const n09 = (bodyPart.match(/^\| 2026-09 \|/gm) || []).length;
  const n09f = ((md.includes(funnelMark) ? md.slice(md.indexOf(funnelMark)) : '').match(/^\| 2026-09 \|/gm) || []).length;
  check('场景 2：同月重跑只保留一行（体量表分段计数）', n09 === 1, `${n09} 行\n${md}`);
  check('场景 2：漏斗表同月 upsert 不重复', n09f === 1, `${n09f} 行\n${md}`);
  run(root, ['--month', '2026-08']);
  md = readMetrics(root);
  const i08 = md.indexOf('| 2026-08 |');
  const i09 = md.indexOf('| 2026-09 |');
  check('场景 2：跨月两行且按月升序', i08 > -1 && i09 > -1 && i08 < i09, md);
  check('场景 2：HEADER 手工说明保留（生成区外内容不丢）', md.includes('# workflow 规模与规则面月度快照'), md);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：失败路径 + --dry-run 不写盘 ----
{
  const root = mkfix();
  const bad = run(root, ['--month', '2026-9']);
  check('场景 3：非法 --month exit 1', bad.status === 1 && /须为 YYYY-MM/.test(bad.stderr), `exit=${bad.status}\n${bad.stderr}`);
  const unk = run(root, ['--bogus']);
  check('场景 3：未知参数 exit 1', unk.status === 1 && /未知参数/.test(unk.stderr), `exit=${unk.status}\n${unk.stderr}`);
  const dry = run(root, ['--dry-run']);
  check('场景 3：--dry-run 不写盘且打印将写入行', dry.status === 0 && /将写入行/.test(dry.stdout) && !fs.existsSync(path.join(root, 'workflow', 'metrics.md')), dry.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4：预算表 glob 词表收口——单 * 前缀+后缀匹配；多 * / 目录段 * 警告跳过（2026-09-24）----
{
  const root = mkfix();
  fs.writeFileSync(path.join(root, '.agents', 'commands', 'zeta.md'), 'z'.repeat(500), 'utf8'); // 非 pl 前缀：不得被 pl*.md 吃进
  fs.writeFileSync(path.join(root, '.agents', 'rule-budgets.txt'), [
    '# fixture 预算表（glob 词表收口）',
    'AGENTS.md 100',
    '.agents/commands/pl*.md 9999',
    '.agents/commands/**.md 9999',
    '.agents/*/cmd.md 9999',
    '',
  ].join('\n'), 'utf8');
  const r = run(root, ['--month', '2026-09']);
  const md = fs.existsSync(path.join(root, 'workflow', 'metrics.md')) ? readMetrics(root) : '';
  check('场景 4：exit 0（词表外条目跳过不阻断）', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 4：单 * 按前缀+后缀匹配（pl*.md 只吃 plan.md 10B，zeta.md 500B 不计入）', /\.agents\/commands\/pl\*\.md（单篇最大）\s+10\s+\/\s+9999/.test(r.stdout), r.stdout);
  check('场景 4：常驻面合计随之正确（120+10=130B → 0.1 KB）', /0\.1 KB（峰值/.test(md) && /常驻面合计：0\.1 KB/.test(r.stdout), `${md}\n${r.stdout}`);
  check('场景 4：多 * 与目录段 * 各警告跳过', (r.stderr || '').includes('**.md') && (r.stderr || '').includes('.agents/*/cmd.md'), r.stderr);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 闭环漏斗（2026-10-02 ledger-funnel-metrics；口径定义式 = specs/2026-10-02-ledger-funnel-metrics.md）----
const LROW = (o = {}) => JSON.stringify({
  ts: '2026-10-02T00:00:00.000Z', doc: 'workflow/intents/demo.md', stage: 'approved',
  fingerprint: 'b'.repeat(64), prev: 'draft', source: 'chat-delegated', quote: '确认', ...o,
});
// mkfixLedger：在 mkfix 基础上写台账（LROW 已是 JSON 字符串，直接 join——勿再 stringify 双重编码）
const mkfixLedger = (lines) => {
  const root = mkfix();
  fs.writeFileSync(path.join(root, '.agents', 'confirmations.jsonl'), lines.join('\n') + '\n', 'utf8');
  return root;
};
{
  // L1：一次通过（approved→done 同月）→ 收口 1 / 完整链 1 / 一次通过 1 / 周期 1.0 天
  const root = mkfixLedger([
    LROW({ ts: '2026-10-01T00:00:00.000Z' }),
    LROW({ ts: '2026-10-02T00:00:00.000Z', stage: 'done', prev: 'approved' }),
  ]);
  const r = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('漏斗 L1 一次通过：| 2026-10 | 1 | 1 | 0 | 1 | 0 | 1.0 | 2 |',
    r.status === 0 && /\| 2026-10 \| 1 \| 1 \| 0 \| 1 \| 0 \| 1\.0 \| 2 \|/.test(md), `${r.stdout}${md}`);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // L2：revert 行（回退后重走）→ 返工件
  const root = mkfixLedger([
    LROW({ ts: '2026-10-01T00:00:00.000Z', stage: 'revert-draft', fingerprint: 'n/a', prev: 'approved' }),
    LROW({ ts: '2026-10-02T00:00:00.000Z' }),
    LROW({ ts: '2026-10-03T00:00:00.000Z', stage: 'done', prev: 'approved' }),
  ]);
  const r = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('漏斗 L2 revert 行 → 返工件 1（周期按首 approved 起算 1.0 天）',
    r.status === 0 && /\| 2026-10 \| 1 \| 1 \| 0 \| 0 \| 1 \| 1\.0 \| 3 \|/.test(md), `${r.stdout}${md}`);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // L3：重确认（两次 approved）→ 返工件
  const root = mkfixLedger([
    LROW({ ts: '2026-10-01T00:00:00.000Z' }),
    LROW({ ts: '2026-10-02T00:00:00.000Z', quote: '重确认' }),
    LROW({ ts: '2026-10-03T00:00:00.000Z', stage: 'done', prev: 'approved' }),
  ]);
  const r = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('漏斗 L3 两次 approved → 返工件 1',
    r.status === 0 && /\| 2026-10 \| 1 \| 1 \| 0 \| 0 \| 1 \| 2\.0 \| 3 \|/.test(md), `${r.stdout}${md}`);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // L4：协议前（首行即终态，无 approved）→ 协议前 1（不计一次通过分母）
  const root = mkfixLedger([
    LROW({ ts: '2026-10-02T00:00:00.000Z', stage: 'done', prev: 'approved' }),
  ]);
  const r = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('漏斗 L4 协议前 → | 1 | 0 | 1 | 0 | 0 |',
    r.status === 0 && /\| 2026-10 \| 1 \| 0 \| 1 \| 0 \| 0 \| 0\.0 \| 1 \|/.test(md), `${r.stdout}${md}`);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // L5：incident 两跳（fixed→closed = incident 确认链，复核 P2-3 收口）→ 完整链一次通过
  const root = mkfixLedger([
    LROW({ ts: '2026-10-01T00:00:00.000Z', doc: 'workflow/incidents/inc.md', stage: 'fixed' }),
    LROW({ ts: '2026-10-02T00:00:00.000Z', doc: 'workflow/incidents/inc.md', stage: 'closed', prev: 'fixed' }),
  ]);
  const r = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('漏斗 L5 incident 两跳确认链 → 完整链 1 / 一次通过 1 / 周期 1.0',
    r.status === 0 && /\| 2026-10 \| 1 \| 1 \| 0 \| 1 \| 0 \| 1\.0 \|/.test(md), `${r.stdout}${md}`);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // L7：incident 单行 closed（存量补关，无确认链）→ 协议前
  const root = mkfixLedger([
    LROW({ ts: '2026-10-02T00:00:00.000Z', doc: 'workflow/incidents/old.md', stage: 'closed', prev: 'fixed' }),
  ]);
  const r = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('漏斗 L7 incident 单行 closed → 协议前 1',
    r.status === 0 && /\| 2026-10 \| 1 \| 0 \| 1 \| 0 \| 0 \|/.test(md), `${r.stdout}${md}`);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // L6：跨月收口（9 月 approved、10 月 done）→ 归桶 10 月；9 月只计台账行
  const root = mkfixLedger([
    LROW({ ts: '2026-09-30T00:00:00.000Z' }),
    LROW({ ts: '2026-10-02T00:00:00.000Z', stage: 'done', prev: 'approved' }),
  ]);
  const rSep = run(root, ['--month', '2026-09']);
  const rOct = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('漏斗 L6 跨月收口归桶 10 月（9 月零收口 + 台账行 1）',
    rSep.status === 0 && rOct.status === 0 && /\| 2026-09 \| 0 \| 0 \| 0 \| 0 \| 0 \| — \| 1 \|/.test(md)
    && /\| 2026-10 \| 1 \| 1 \| 0 \| 1 \| 0 \| 2\.0 \| 1 \|/.test(md), `${rSep.stdout}${rOct.stdout}${md}`);
  fs.rmSync(root, { recursive: true, force: true });
}

{
  // L8：亚小时真实周期（同会话建件+确认）→ 渲染 <0.1，不印 0.0（「取不到」与「极快」不得同形）
  const root = mkfixLedger([
    LROW({ ts: '2026-10-01T00:30:00.000Z' }),
    LROW({ ts: '2026-10-01T01:00:00.000Z', stage: 'done', prev: 'approved' }),
  ]);
  const r = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('漏斗 L8 亚小时真实周期渲染 <0.1（表行与 stdout 同步，不印 0.0）',
    r.status === 0 && /\| 2026-10 \| 1 \| 1 \| 0 \| 1 \| 0 \| <0\.1 \| 2 \|/.test(md) && /中位周期 <0\.1 天/.test(r.stdout),
    `${r.stdout}${md}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 复核效果台账：workflow/reviews.d/ 意见级处置分片 → 第三表 ----
// mkfixReviews：在 mkfix 基础上写复核效果台账分片（shards: { 分片文件名: [数据行...] }，含表头）
const mkfixReviews = (shards) => {
  const root = mkfix();
  fs.mkdirSync(path.join(root, 'workflow', 'reviews.d'), { recursive: true });
  for (const [name, rows] of Object.entries(shards)) {
    fs.writeFileSync(path.join(root, 'workflow', 'reviews.d', name), [
      `# 独立复核效果台账 — ${name.replace(/\.md$/, '')}`,
      '',
      '| 日期 | 对象 | 复核员(宿主) | 意见数 | 采纳 | 拒绝 | 误报 | 备注 |',
      '|------|------|--------------|--------|------|------|------|------|',
      ...rows,
      '',
    ].join('\n'), 'utf8');
  }
  return root;
};
{
  // R1：同月两行聚合 + 跨月分片各一行、按月升序（率列 = 采纳/误报 ÷ 意见数，toFixed(0)%）
  const root = mkfixReviews({
    '2026-10.md': [
      '| 2026-10-14 | workflow/specs/2026-10-14-x.md | independent-reviewer(zcode) | 5 | 3 | 1 | 1 | P1 修 1；P2 采纳 3 拒 1 误 1 |',
      '| 2026-10-16 | diff 318922a9..7c8d9eb7 | independent-reviewer(新会话) | 4 | 2 | 2 | 0 | P2×4 全采纳 |',
    ],
    '2026-09.md': [
      '| 2026-09-30 | workflow/plans/2026-09-30-y.md | independent-reviewer(zcode) | 2 | 1 | 0 | 1 | 误报=指向已被覆盖的代码 |',
    ],
  });
  const r = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('复核 R1：同月两行聚合（事件 2 / 意见 9 / 采纳 5 / 拒绝 3 / 误报 1 / 采纳率 56% / 误报率 11%）',
    r.status === 0 && /\| 2026-10 \| 2 \| 9 \| 5 \| 3 \| 1 \| 56% \| 11% \|/.test(md), `exit=${r.status}\n${r.stdout}${r.stderr}\n${md}`);
  check('复核 R1：跨月分片各一行且按月升序（9 月 1/2/1/0/0 → 50%/50% 紧邻 10 月行）',
    /## 复核效果[\s\S]*?\| 2026-09 \| 1 \| 2 \| 1 \| 0 \| 1 \| 50% \| 50% \|\n\| 2026-10 \|/.test(md), md);
  check('复核 R1：复核行不被误吸进漏斗表（漏斗段零 2026-09 行——分段回吸切开了同形日期行）',
    (() => { const seg = md.slice(md.indexOf('## 闭环漏斗'), md.indexOf('## 复核效果')); return !/\| 2026-09 \|/.test(seg); })(), md);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // R2：自洽破坏（采纳+拒绝+误报 ≠ 意见数）→ fail-loud（exit 1，报文点名分片与不变式）
  const root = mkfixReviews({
    '2026-10.md': [
      '| 2026-10-14 | workflow/specs/2026-10-14-x.md | independent-reviewer(zcode) | 5 | 2 | 1 | 1 | 2+1+1=4 ≠ 5，应被拦 |',
    ],
  });
  const r = run(root, ['--month', '2026-10']);
  check('复核 R2：自洽破坏（5 ≠ 2+1+1）→ exit 1 且报文含「自洽破坏」并点名分片 2026-10.md',
    r.status === 1 && /自洽破坏/.test(r.stderr) && /2026-10\.md/.test(r.stderr), `exit=${r.status}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // R3：目录不存在 / 分片存在但空表 → 合法零数据，占位行不崩
  const rootNone = mkfix(); // 不建 reviews.d
  const rNone = run(rootNone, ['--month', '2026-10']);
  const mdNone = readMetrics(rootNone);
  check('复核 R3：目录不存在 → exit 0 且出「（无记录）」占位行',
    rNone.status === 0 && /\| （无记录） \| 0 \| 0 \| 0 \| 0 \| — \| — \|/.test(mdNone), `exit=${rNone.status}\n${rNone.stderr}\n${mdNone}`);
  fs.rmSync(rootNone, { recursive: true, force: true });
  const rootEmpty = mkfixReviews({ '2026-10.md': [] }); // 分片存在、表为空
  const rEmpty = run(rootEmpty, ['--month', '2026-10']);
  const mdEmpty = readMetrics(rootEmpty);
  check('复核 R3b：分片空表 → exit 0 且出「（无记录）」占位行',
    rEmpty.status === 0 && /\| （无记录） \| 0 \| 0 \| 0 \| 0 \| — \| — \|/.test(mdEmpty), `exit=${rEmpty.status}\n${rEmpty.stderr}\n${mdEmpty}`);
  fs.rmSync(rootEmpty, { recursive: true, force: true });
}

// ---- spec 体积观察（spec 生命周期口径）：活跃 specs + 归档 specs 分开统计 ----
// mkSpec：生成恰好 lines 行（尾换行对齐 wc -l）、其中 checks 行为 checkbox 的 spec 文本
const mkSpec = (lines, checks) => {
  const rows = [`# spec 夹具 ${lines}行${checks}验收`];
  for (let i = 0; i < checks; i++) rows.push(`- [${i % 2 ? 'x' : ' '}] 验收 ${i + 1}`);
  while (rows.length < lines) rows.push('填充');
  return rows.join('\n') + '\n';
};
{
  // S1：活跃 2 份（10 行/3 验收、12 行/5 验收 → 偶数中位取均值）+ 归档 3 份跨单月目录（6/8/10 行 → 奇数中位取中）
  const root = mkfix();
  fs.writeFileSync(path.join(root, 'workflow', 'specs', '2026-10-01-a1.md'), mkSpec(10, 3), 'utf8');
  fs.writeFileSync(path.join(root, 'workflow', 'specs', '2026-10-02-a2.md'), mkSpec(12, 5), 'utf8');
  fs.writeFileSync(path.join(root, 'workflow', 'specs', '_TEMPLATE.md'), mkSpec(999, 9), 'utf8'); // 模板不计入
  fs.mkdirSync(path.join(root, 'workflow', 'archive', '2026-09', 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'archive', '2026-09', 'specs', '2026-09-01-b1.md'), mkSpec(6, 2), 'utf8');
  fs.writeFileSync(path.join(root, 'workflow', 'archive', '2026-09', 'specs', '2026-09-02-b2.md'), mkSpec(8, 4), 'utf8');
  fs.writeFileSync(path.join(root, 'workflow', 'archive', '2026-09', 'specs', '2026-09-03-b3.md'), mkSpec(10, 1), 'utf8');
  const r = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('spec S1：活跃行（2 份 / 行数中位 11 = (10+12)/2 / 最大 12 / 验收中位 4 / 最大 5；_TEMPLATE 不计）',
    r.status === 0 && /\| 活跃 \| 2 \| 11 \| 12 \| 4 \| 5 \|/.test(md), `exit=${r.status}\n${r.stderr}\n${md}`);
  check('spec S1：归档行（3 份 / 行数中位 8 取中 / 最大 10 / 验收中位 2 / 最大 4）',
    /\| 归档 \| 3 \| 8 \| 10 \| 2 \| 4 \|/.test(md), md);
  check('spec S1：表序正确（复核效果表之后、GENERATED:END 之前）',
    /## 复核效果[\s\S]*## spec 体积观察[\s\S]*<!-- GENERATED:END -->/.test(md), md);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // S2：specs 目录空 + 无 archive 目录 → 两行全 0 不崩（合法零数据）
  const root = mkfix();
  const r = run(root, ['--month', '2026-10']);
  const md = readMetrics(root);
  check('spec S2：specs 空目录 + 无 archive → 活跃/归档两行全 0，exit 0',
    r.status === 0 && /\| 活跃 \| 0 \| 0 \| 0 \| 0 \| 0 \|/.test(md) && /\| 归档 \| 0 \| 0 \| 0 \| 0 \| 0 \|/.test(md),
    `exit=${r.status}\n${r.stderr}\n${md}`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(`\n${USAGE}`);
  process.exit(1);
}
process.exit(0);
