// check-hygiene.test.mjs — 卫生类检查模块测试（2026-10-08 selfmeasure-and-modularize，L2）
// 被测：templates/_agents/scripts/check-hygiene.mjs 的 runCheckHygiene（检查 2 / 9 / 11 / 12 / 13）。
// 端到端行为回归网仍是 check-loop.test.mjs（219 断言，spawn 真 check-loop）——本套件补的是**模块层直测**：
//   ctx 缺项降级、装户跳过分支、生成物双告警、以及「模块内顺序 = 原 2→9→11→12→13」这条输出契约。
// fixture：mkdtemp 临时根（workflow/{intents,specs,plans,incidents} + .agents/），**不触真实仓库 workflow/**。
// 用法：node templates/_agents/scripts/check-hygiene.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const { runCheckHygiene } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'check-hygiene.mjs')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
};

// ctx 组装：复刻 check-loop.mjs 的 helper 口径（tracked 恒真 = fixture 模式、frontmatter 受限子集），
// 以免测试用自己的一套语义掩盖模块与主文件的漂移。
function makeCtx(root, overrides = {}) {
  const WF = 'workflow';
  const DOC_DIRS = ['intents', 'specs', 'plans', 'incidents'];
  const fileLinesCache = new Map();
  const linesOf = (file) => {
    if (!fileLinesCache.has(file)) {
      let lines = null;
      try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { lines = null; }
      fileLinesCache.set(file, lines);
    }
    return fileLinesCache.get(file);
  };
  const fmGet = (file, key) => {
    const lines = linesOf(file);
    if (!lines) return '';
    const isDelim = (l) => /^---\s*$/.test(l);
    if (!isDelim(lines[0] || '')) return '';
    for (let i = 1; i < lines.length; i++) {
      if (isDelim(lines[i])) return '';
      if (lines[i].startsWith(key + ':')) return lines[i].slice(key.length + 1).trim();
    }
    return '';
  };
  const isTracked = () => true; // fixture 模式：check-loop 中 CHECK_LOOP_ROOT 注入时恒真
  const docFiles = (sub) => {
    const dir = path.join(root, WF, sub);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && /^\d/.test(f))
      .map((f) => path.join(dir, f)).filter(isTracked).sort();
  };
  const readdirOrNull = (dir) => { try { return fs.readdirSync(dir); } catch { return null; } };
  const kitPolicy = { moduleSince: '2026-09-22', ...(overrides.kitPolicy || {}) };
  return { root, WF, DOC_DIRS, docFiles, linesOf, fmGet, isTracked, readdirOrNull, kitPolicy, ...overrides };
}

const W = (root, rel, content) => {
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content, 'utf8');
};
const DOC = (fm, body = '# T\n') => `---\n${fm}\n---\n${body}`;

// ---- 检查 2：占位符残留 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-hyg2-'));
  W(root, 'workflow/intents/2026-10-01-ph.md', DOC('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline', '# I\n日期: YYYY-MM-DD\n'));
  W(root, 'workflow/intents/2026-10-01-ok.md', DOC('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline', '# I\n没有占位符\n'));
  W(root, 'workflow/intents/2026-10-01-fence.md', DOC('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline', '# I\n```\nYYYY-MM-DD\n```\n'));
  const r = runCheckHygiene(makeCtx(root));
  const ph = r.filter((w) => w.includes('[WARN 模板未填]'));
  check('检查 2：裸占位符出账 + 围栏代码块内豁免（仅 1 件）',
    ph.length === 1 && ph[0].includes('2026-10-01-ph.md'), JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 检查 9：文件名 kebab（检查 9 走 readdirOrNull，不走 docFiles 的 /^\d/ 过滤）----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-hyg9-'));
  W(root, 'workflow/intents/2026-10-01-中文名.md', DOC('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline'));
  const r = runCheckHygiene(makeCtx(root));
  check('检查 9：非 ASCII 文件名出账', r.some((w) => w.includes('[WARN 文件名非英文]') && w.includes('中文名.md')), JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 检查 11：双生成物 + 装户跳过 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-hyg11-'));
  // 装户形态：无生成器脚本 → 检查 11 整体跳过（不报）
  let r = runCheckHygiene(makeCtx(root));
  check('检查 11：生成器脚本不存在（旧装副本）→ 跳过不报',
    !r.some((w) => w.includes('漂移]')), JSON.stringify(r));
  // 放一个恒红的假生成器（--check 必 exit 1），覆盖双告警
  W(root, '.agents/scripts/gen-workflow-index.mjs', 'process.exit(1);\n');
  W(root, '.agents/scripts/gen-workflow-dashboard.mjs', 'process.exit(1);\n');
  W(root, 'workflow/INDEX.md', '# stale\n');
  W(root, 'workflow/DASHBOARD.md', '# stale\n'); // 双告警场景须盘面在位——否则命中装户跳过分支
  r = runCheckHygiene(makeCtx(root));
  check('检查 11：INDEX + DASHBOARD 各自独立出账且指名修复命令',
    r.some((w) => w.includes('[WARN 索引漂移]') && w.includes('gen-workflow-index.mjs'))
    && r.some((w) => w.includes('[WARN 仪表盘漂移]') && w.includes('gen-workflow-dashboard.mjs')), JSON.stringify(r));
  // DASHBOARD.md 不存在 → 只剩 INDEX 一条（装户未生成过看板不得常红）
  fs.rmSync(path.join(root, 'workflow/DASHBOARD.md'), { force: true });
  r = runCheckHygiene(makeCtx(root));
  check('检查 11：DASHBOARD.md 缺失 → 跳过（装户未生成过看板不常红）',
    !r.some((w) => w.includes('仪表盘漂移]')) && r.some((w) => w.includes('索引漂移]')), JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 检查 12：模块枚举 + 词表缺失降级 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-hyg12-'));
  W(root, '.agents/workflow-modules.txt', '# 词表\npipeline\nwiki\n');
  W(root, 'workflow/intents/2026-10-01-bad.md', DOC('状态: done\n级别: L1\n日期: 2026-10-01\n模块: 不存在的模块'));
  W(root, 'workflow/intents/2026-10-01-missing.md', DOC('状态: done\n级别: L1\n日期: 2026-10-01'));
  W(root, 'workflow/intents/2026-09-01-old.md', DOC('状态: done\n级别: L1\n日期: 2026-09-01')); // 早于 moduleSince → 存量豁免
  let r = runCheckHygiene(makeCtx(root));
  check('检查 12：非法模块出账 + 新建缺字段出账 + 存量豁免',
    r.some((w) => w.includes('不在词表')) && r.some((w) => w.includes('missing.md 缺「模块:」字段'))
    && !r.some((w) => w.includes('old.md')), JSON.stringify(r));
  fs.rmSync(path.join(root, '.agents/workflow-modules.txt'));
  r = runCheckHygiene(makeCtx(root));
  check('检查 12：词表文件缺失 → 静默跳过（装户无感）', !r.some((w) => w.includes('模块元数据')), JSON.stringify(r));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 输出顺序契约：块内须保持 2 → 9 → 11 → 12 → 13 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-hyg-order-'));
  W(root, 'workflow/intents/2026-10-01-ph.md', DOC('状态: done\n级别: L1\n日期: 2026-10-01\n模块: 非法模块', '# I\nYYYY-MM-DD\n'));
  W(root, 'workflow/intents/2026-10-01-中文名.md', DOC('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline'));
  W(root, '.agents/scripts/gen-workflow-index.mjs', 'process.exit(1);\n');
  W(root, '.agents/scripts/gen-workflow-dashboard.mjs', 'process.exit(1);\n');
  W(root, '.agents/workflow-modules.txt', '# 词表\npipeline\n'); // 词表须在位，否则检查 12 整段跳过
  W(root, 'workflow/INDEX.md', '# stale\n');
  W(root, 'workflow/DASHBOARD.md', '# stale\n');
  const r = runCheckHygiene(makeCtx(root));
  const tags = r.map((w) => (w.includes('模板未填') ? '2' : w.includes('文件名非英文') ? '9'
    : w.includes('索引漂移') ? '11a' : w.includes('仪表盘漂移') ? '11b' : w.includes('模块元数据') ? '12' : '13'));
  check('输出顺序：块内 2 → 9 → 11 → 12 保持（行序属稳定输出契约）',
    tags.join(',') === '2,9,11a,11b,12', tags.join(','));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 检查 20 覆盖：本模块须被 npm test 的 glob 发现 ----
{
  const found = fs.existsSync(path.join(SCRIPT_DIR, 'check-hygiene.test.mjs'));
  check('检查 20：本套件与被测模块同名兄弟（否则检查 20 出账）', found);
  const r = spawnSync(process.execPath, ['--check', path.join(SCRIPT_DIR, 'check-hygiene.mjs')], { encoding: 'utf8' });
  check('被测模块语法有效', r.status === 0, r.stderr || '');
}

// ---- 门禁 ROI 段归属（2026-10-08 gate-roi-metrics，实仓抓到的错账根因）----
// 症状：本模块的 warnings 是**局部数组**（check-loop 事后才 spread 进全局），若段增量记在全收集器上，
//   本模块 5 段恒记 0 命中、且全部增量被误记到模块之后的第一个段（检查 3）。修复 = 局部收集器 + appendSegs。
// 本组断言在**模块层**钉死归属：检查 2 与检查 9 各产 1 条，必须各归各的段，不得漂到别的段上。
{
  const { makeCollector, finishSegs } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'gate-seg.mjs')).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-hygroi-'));
  W(root, 'workflow/intents/2026-10-01-ph.md', DOC('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline', '# I\n日期: YYYY-MM-DD\n'));
  W(root, 'workflow/intents/2026-10-01-中文名.md', DOC('状态: done\n级别: L1\n日期: 2026-10-01\n模块: pipeline'));
  // 全局收集器挂在**空数组**上：若模块错误地用全局数组做 Δ 源，两条警告一条都不会被算进去。
  const globalStats = makeCollector([], []);
  const r = runCheckHygiene(makeCtx(root, { gateStats: globalStats }));
  const segs = globalStats.segs;
  const byId = new Map(segs.map((s) => [s.id, s.warns]));
  const hits = r.length;
  check('段归属：本模块 5 段全部入账（2/9/11/12/13）',
    segs.map((s) => s.id).join(',') === '2,9,11,12,13', JSON.stringify(segs.map((s) => s.id)));
  check('段归属：各段增量之和 == 本模块实际产出条数（无漏记无重复记）',
    segs.reduce((a, s) => a + s.warns, 0) === hits && hits === 2, `segs=${JSON.stringify(segs)} hits=${hits}`);
  check('段归属：检查 2 / 检查 9 各归 1 条（**不都堆到末段**——本次实抓的错账形态）',
    byId.get('2') === 1 && byId.get('9') === 1 && byId.get('11') === 0 && byId.get('12') === 0 && byId.get('13') === 0,
    JSON.stringify(segs));
  check('段归属：并入后全局游标清空（check-loop 随后的 markGate 从零起算）', globalStats.current === null);
  check('段归属：finishSegs(全局) 幂等，不产生额外伪段', finishSegs(globalStats).length === segs.length);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);