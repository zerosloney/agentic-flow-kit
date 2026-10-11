// rule-budget.test.mjs — 纯包源预算自检门（2026-10-11 budget-self-check）——关闭「纯包源仓不跑装户预算门」盲区。
// 背景：常驻面预算单源 templates/_agents/rule-budgets.txt（装户命名空间），此前只在装户侧强制
// （pre-commit --staged 硬拦 / check-loop 13 --all warning）；v1.7.1 起本仓纯包源（5ca9e8c 删装副本）、
// 两处都不跑——bb69e19/418960a 重构净增 78B 把 .agents/commands/ 推到 65581B > 65536B，包源侧零暴露，
// 装户首提被硬拦才发现（2026-10-11 S1 冒烟）。本套件把同一张预算表映射到包源路径核对，npm test / CI
// 直接拦超限——模板增长不再静默入包。run-tests 盘面 glob 自动挂载本套件。
// 口径（对照 templates/_agents/scripts/rule-budget.sh 单源，勿两处漂移）：
//   字节 = LF 归一（工作树读入去 \r\n——等价 fsize 的 git cat-file 口径，core.autocrlf 检出形态无关）；
//   目录合计 = 扁平 glob（直接子文件，不入子目录）；pat=首空格前 / lim=末空格后；lim 非纯数字行跳过；
//   # 注释与空行跳过。
// 与装户门的口径差异（诚实声明）：
//   - AGENTS.md 是渲染模板：装户拿到的是占位符展开后的文件，渲染形态权威仍在装户门；本套件按全部
//     STACKS 渲染取 max（BOARD_PORT 按最坏 5 位端口）做包源侧近似——单源复用 profiles/render，不复制命令表。
//   - fail-loud 项（装户侧是 skip，包源侧是打包回归——表不随包或常驻面失踪 = 装户门整体变暗）：
//     预算表缺失 / 解析 0 行 / 映射目标不存在 / 文件 glob 零命中。装户侧专属面（无包源对应）SKIP 并注记。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderContent } from './render.mjs';
import { STACKS, pickStackVars } from './profiles.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGETS = path.join(ROOT, 'templates', '_agents', 'rule-budgets.txt');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
}
const lfBytes = (abs) => Buffer.byteLength(fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'), 'utf8');

// ---- 预算表（缺失即 fail-loud：装户门会整体变暗）----
if (!fs.existsSync(BUDGETS)) {
  console.log('FAIL R0 预算表缺失 templates/_agents/rule-budgets.txt——装户侧 pre-commit/检查13 将整体 skip');
  process.exit(1);
}
const rows = [];
for (const line of fs.readFileSync(BUDGETS, 'utf8').split('\n')) {
  const t = line.replace(/\r/g, '');   // 表文件检出即 CRLF——显式去 \r（rule-budget.sh 同款）
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf(' ');
  if (i < 0) continue;
  const pat = t.slice(0, i);
  const lim = t.slice(t.lastIndexOf(' ') + 1);
  if (!/^\d+$/.test(lim)) continue;    // 非纯数字 lim 跳过（sh case 同款）
  rows.push({ pat, lim: Number(lim) });
}
check('R1 预算表解析非空', rows.length > 0, `仅 ${rows.length} 行——表被清空即盲区复活`);

// ---- 映射：装户命名空间 → 包源路径（新预算行若只属装户侧，在此登记映射或留 SKIP）----
function mapToPkg(pat) {
  if (pat === 'AGENTS.md') return 'templates/AGENTS.md';
  if (pat.startsWith('.agents/')) return 'templates/_agents/' + pat.slice('.agents/'.length);
  return null;
}

const REMEDY = '处置沿先例：压缩版本括号/措辞（71e0b0e、v1.7.10 三处），或在 rule-budgets.txt 注明理由调预算（512B 步进）';

for (const { pat, lim } of rows) {
  const rel = mapToPkg(pat);
  if (!rel) { console.log(`SKIP ${pat}——装户侧专属面，无包源对应`); continue; }
  const abs = path.join(ROOT, rel);
  if (pat.endsWith('/')) {
    // 目录合计：扁平直接子文件，不入子目录（sh `for f in "$pat"*` + [ -f ] 同款）
    if (!fs.existsSync(abs)) { check(`R-dir ${pat} 目标存在`, false, `${rel} 缺失`); continue; }
    const files = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
    const total = files.reduce((s, n) => s + lfBytes(path.join(abs, n)), 0);
    check(`R-dir ${rel} 合计 ${total}B ≤ ${lim}B（${files.length} 文件）`, total <= lim, `超 ${total - lim}B。${REMEDY}`);
  } else if (pat.includes('*')) {
    // 文件 glob：仅支持 dir 内后缀形（*.md）——与 sh glob 展开同效
    const dir = path.dirname(abs);
    const base = path.basename(pat);
    const suffix = base.slice(base.indexOf('*') + 1);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(suffix)) : [];
    if (files.length === 0) { check(`R-glob ${pat} 有命中`, false, `${dir} 下无 *${suffix}——常驻面失踪或映射失效`); continue; }
    const sizes = files.map((n) => ({ n, b: lfBytes(path.join(dir, n)) }));
    const over = sizes.filter((s) => s.b > lim);
    const maxS = sizes.slice().sort((a, b) => b.b - a.b)[0];
    check(`R-glob ${path.dirname(rel)}/${base} ${sizes.length} 份，最大 ${maxS.n} ${maxS.b}B ≤ ${lim}B`, over.length === 0,
      `${over.map((s) => `${s.n}=${s.b}B 超 ${s.b - lim}B`).join('；')}。${REMEDY}`);
  } else {
    if (!fs.existsSync(abs)) { check(`R-file ${pat} 目标存在`, false, `${rel} 缺失`); continue; }
    const b = lfBytes(abs);
    check(`R-file ${rel} = ${b}B ≤ ${lim}B`, b <= lim, `超 ${b - lim}B。${REMEDY}`);
  }
}

// ---- AGENTS.md 渲染近似（装户渲染形态 = 占位符展开；包源侧按全部栈取 max）----
const agentsRow = rows.find((r) => r.pat === 'AGENTS.md');
if (agentsRow) {
  const tpl = fs.readFileSync(path.join(ROOT, 'templates', 'AGENTS.md'), 'utf8');
  let worst = { stack: '-', b: 0 };
  for (const stack of Object.keys(STACKS)) {
    const text = renderContent(tpl, { BOARD_PORT: '99999', ...pickStackVars(stack) });
    const b = Buffer.byteLength(text.replace(/\r\n/g, '\n'), 'utf8');
    if (b > worst.b) worst = { stack, b };
  }
  check(`R-render templates/AGENTS.md 渲染 max(${worst.stack}) ${worst.b}B ≤ ${agentsRow.lim}B`, worst.b <= agentsRow.lim,
    `超 ${worst.b - agentsRow.lim}B——渲染形态超限装户门同样会拦，先压模板正文。${REMEDY}`);
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
