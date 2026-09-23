#!/usr/bin/env node
// kb-search.mjs 的 fixture 驱动测试
// 现场构造临时 workflow 语料（换 cwd 运行被测脚本，脚本按相对路径 'workflow/' 读盘）。
// 断言：①AND 语义与「节限定」（指定节外的内容不参与命中）；②活跃优先排序（同命中近同体积时 active 在前）；
//       ③过滤与上限（--type / --module / --status / -n）；④失败路径（非法模块、无词 → exit 1）；
//       ⑤结构缓存三路逐字节等值（cold/warm/--no-cache）；⑥增量失效（改 1 文件仅该文件重解析）；
//       ⑦口径指纹变化整份作废；⑧缓存损坏静默回退全扫。
// 用法：node .agents/scripts/kb-search.test.mjs（在仓库任意目录执行均可）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const KB = path.join(SCRIPT_DIR, 'kb-search.mjs');
const CACHE_FILE = path.join(SCRIPT_DIR, '..', 'cache', 'kb-index.json');
const USAGE = '用法：node .agents/scripts/kb-search.test.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const doc = (fm, title, sections) =>
  `---\n${fm}\n---\n# ${title}\n\n${sections.map(([h, body]) => `## ${h}\n${body}\n`).join('\n')}\n`;

// mkfix：甲（closed，incidents）/ 乙（approved，intents）同命中近同体积（验活跃优先）；
//       丙（approved，plans）只含单词（验 AND）、其「非目标」节含标记词（验节限定）
const mkfix = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-search-test-'));
  for (const d of ['intents', 'plans', 'incidents']) fs.mkdirSync(path.join(root, 'workflow', d), { recursive: true });
  const w = path.join(root, 'workflow');
  const hit = (tag) => [
    ['目标', `- 统一口径：编码模板与分类层级，冲突处理见 A/B${tag}`],
    ['非目标', '- MARKER_ONLY_OUTSIDE_SECTIONS（本节不参与检索，词：编码模板）'],
  ];
  fs.writeFileSync(path.join(w, 'incidents', '2026-09-01-aaa.md'), doc('状态: closed\n级别: L2\n发现: 2026-09-01\n模块: material', 'INCIDENT — 甲事故', hit('甲')), 'utf8');
  fs.writeFileSync(path.join(w, 'intents', '2026-09-21-bbb.md'), doc('状态: approved\n级别: L1\n日期: 2026-09-21\n模块: pipeline', 'INTENT — 乙需求', hit('乙')), 'utf8');
  fs.writeFileSync(path.join(w, 'plans', '2026-09-20-ccc.md'), doc('状态: approved\n级别: L1\n模块: purchase', 'PLAN — 丙计划', [['目标', '- 只讲编码模板，不提另一个词'], ['非目标', '- MARKER_ONLY_OUTSIDE_SECTIONS（本节不参与检索）']]), 'utf8');
  // wiki 侧最小语料（验结构缓存对 wiki 行数组的存取路径）
  fs.mkdirSync(path.join(root, 'wiki', '测试主题'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wiki', '测试主题', '说明.md'), '# 说明\n\n编码模板的领域知识条目。\n', 'utf8');
  return root;
};

const run = (root, args) => spawnSync(process.execPath, [KB, ...args], { cwd: root, encoding: 'utf8' });
const files = (out) => (out.match(/^📄 (workflow\/\S+)/gm) || []).map((l) => l.replace('📄 ', ''));

// ---- 场景 1：主路径——AND 语义 / 节限定 / 输出字段 / 活跃优先 ----
{
  const root = mkfix();
  const r = run(root, ['--scope', 'workflow', '编码模板', '冲突']);
  check('场景 1：检索 exit 0', r.status === 0, `exit=${r.status}\n${r.stderr}`);
  check('场景 1：AND——两词齐全才命中（甲/乙，丙被排除）', files(r.stdout).length === 2 && !r.stdout.includes('2026-09-20-ccc.md'), r.stdout);
  check('场景 1：活跃优先——approved 的乙排在 closed 的甲之前', files(r.stdout)[0]?.includes('2026-09-21-bbb.md'), files(r.stdout).join('\n'));
  check('场景 1：输出行含 状态·级别·模块', /📄 workflow\/intents\/2026-09-21-bbb\.md — approved · L1 · pipeline ·/.test(r.stdout), r.stdout);
  check('场景 1：命中带节名与行号', /\[目标\] L\d+: /.test(r.stdout), r.stdout);
  const outside = run(root, ['--scope', 'workflow', 'MARKER_ONLY_OUTSIDE_SECTIONS']);
  check('场景 1：节外内容不参与检索（仅标记词 → 无命中）', files(outside.stdout).length === 0 && /（无命中）/.test(outside.stdout), outside.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：过滤与上限（--type / --module / --status / -n）----
{
  const root = mkfix();
  const t = run(root, ['--scope', 'workflow', '--type', 'plans', '编码模板']);
  check('场景 2：--type plans 仅出 plans', files(t.stdout).length === 1 && files(t.stdout)[0].includes('plans/'), t.stdout);
  const m = run(root, ['--scope', 'workflow', '--module', 'pipeline', '编码模板']);
  check('场景 2：--module pipeline 仅出该模块', files(m.stdout).length === 1 && files(m.stdout)[0].includes('2026-09-21-bbb.md'), m.stdout);
  const a = run(root, ['--scope', 'workflow', '--status', 'active', '编码模板']);
  check('场景 2：--status active 排除终态', !a.stdout.includes('2026-09-01-aaa.md') && a.stdout.includes('2026-09-21-bbb.md'), a.stdout);
  const term = run(root, ['--scope', 'workflow', '--status', 'terminal', '编码模板']);
  check('场景 2：--status terminal 仅终态', term.stdout.includes('2026-09-01-aaa.md') && !term.stdout.includes('2026-09-21-bbb.md'), term.stdout);
  const n1 = run(root, ['--scope', 'workflow', '-n', '1', '编码模板']);
  check('场景 2：-n 1 只展示 1 个文件', files(n1.stdout).length === 1, n1.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：失败路径（非法模块 / 无词 / 无命中）----
{
  const root = mkfix();
  const bad = run(root, ['--module', '不存在的模块', '编码模板']);
  check('场景 3：非法 --module exit 1 且提示词表', bad.status === 1 && /未知模块/.test(bad.stderr), `exit=${bad.status}\n${bad.stderr}`);
  const empty = run(root, []);
  check('场景 3：无词 exit 1', empty.status === 1, `exit=${empty.status}`);
  const none = run(root, ['--scope', 'workflow', 'zzz-绝不存在-zzz']);
  check('场景 3：无命中 exit 0 且提示', none.status === 0 && /（无命中）/.test(none.stdout), none.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4：结构缓存三路逐字节等值（cold 首建 / warm 命中 / --no-cache），workflow+wiki 双侧 ----
{
  const root = mkfix();
  const cold = run(root, ['编码模板']);                                   // 该临时根 ns 无条目 → cold
  const warm = run(root, ['编码模板']);                                   // 全命中缓存
  const nocache = run(root, ['--no-cache', '编码模板']);
  check('场景 4：cold/warm exit 0 且 warm 确有缓存回写', cold.status === 0 && warm.status === 0 && fs.existsSync(CACHE_FILE), `cold=${cold.status} warm=${warm.status}`);
  check('场景 4：cold ≡ warm（逐字节）', cold.stdout === warm.stdout, `cold:\n${cold.stdout}\nwarm:\n${warm.stdout}`);
  check('场景 4：cold ≡ --no-cache（逐字节）', cold.stdout === nocache.stdout, `cold:\n${cold.stdout}\nnocache:\n${nocache.stdout}`);
  check('场景 4：双侧均有命中（workflow 3 + wiki 1）', files(cold.stdout).length === 3 && /wiki\/测试主题/.test(cold.stdout), cold.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 5：增量失效——warm 后改 1 个源文件，仅该文件重解析且输出与纯扫一致 ----
{
  const root = mkfix();
  const base = run(root, ['编码模板']);
  const planP = path.join(root, 'workflow', 'plans', '2026-09-20-ccc.md');
  fs.appendFileSync(planP, '\n## 影响面\n- 新标记NEWWORD：编码模板修订\n', 'utf8');
  const after = run(root, ['编码模板', 'NEWWORD']);
  const scan = run(root, ['--no-cache', '编码模板', 'NEWWORD']);
  check('场景 5：改动文件被重解析（NEWWORD 命中该篇）', after.status === 0 && after.stdout.includes('2026-09-20-ccc.md'), after.stdout);
  check('场景 5：增量结果与纯扫逐字节一致', after.stdout === scan.stdout, `after:\n${after.stdout}\nscan:\n${scan.stdout}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 6：口径指纹变化 → 整份作废重建，无旧口径残留 ----
{
  const root = mkfix();
  run(root, ['编码模板']); // 建缓存
  const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const fpBefore = j.fp;
  j.fp = 'ffffffffffffffff';
  fs.writeFileSync(CACHE_FILE, JSON.stringify(j), 'utf8');
  const after = run(root, ['编码模板']);
  const scan = run(root, ['--no-cache', '编码模板']);
  check('场景 6：指纹不符 → 输出仍与纯扫逐字节一致', after.status === 0 && after.stdout === scan.stdout, `after:\n${after.stdout}\nscan:\n${scan.stdout}`);
  const j2 = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  check('场景 6：回写恢复正确指纹', j2.fp === fpBefore && j2.fp !== 'ffffffffffffffff', `fp=${j2.fp}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 7：缓存损坏 → 静默回退全扫（不报错、输出与 --no-cache 一致） ----
{
  const root = mkfix();
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, 'not-json{{{', 'utf8');
  const r = run(root, ['编码模板']);
  const scan = run(root, ['--no-cache', '编码模板']);
  check('场景 7：损坏缓存 exit 0（stderr 无泄漏）', r.status === 0 && !r.stderr, `exit=${r.status}\n${r.stderr}`);
  check('场景 7：损坏后输出与纯扫逐字节一致', r.stdout === scan.stdout, `r:\n${r.stdout}\nscan:\n${scan.stdout}`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(`\n${USAGE}`);
  process.exit(1);
}
process.exit(0);
