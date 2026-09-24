// wiki 索引生成器：磁盘 + INDEX 速览表「用途」列 → 自动重生成 INDEX 速览计数/映射表 + 看板 DATA
// 2026-09-13 引入：消除三层手工双写（短板①）。人工只维护两样：磁盘文件本身 + 速览表用途列。
// 用法：node .agents/scripts/gen-wiki-board.mjs [--dry-run] [--help]
//   （收录/删除/移动 wiki 文件后必跑，随后跑 verify-wiki-consistency.mjs）
// 测试：node .agents/scripts/gen-wiki-board.test.mjs（fixture 回归，须全绿）
// 生成范围（锚点内整段重写，锚点外字节原样保留）：
//   INDEX.md 速览表数据行 / 「合计」行数字 / 「## 文件 → 主题 → 归属目录 映射表」到「## 命名规则」之间
//   看板 知识沉淀总览.html 的 `const DATA = {...};` 整块
// 注意：映射表节内的手工注记会被清除——背景说明请写进速览表「用途」列（人工列，生成器不覆盖）。
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const USAGE = `用法：node .agents/scripts/gen-wiki-board.mjs [--dry-run] [--help]

事实源：磁盘 wiki/<主题>/ 一层文件 + INDEX.md 速览表「用途」列（人工列）。重生成：
  - wiki/INDEX.md：速览表数据行与文件计数、「合计」行数字、映射表节
    （「## 文件 → 主题 → 归属目录 映射表」到「## 命名规则」之间整段）
  - wiki/知识沉淀总览.html：const DATA = {...} 整块（summary 统计 + topics 文件清单 + dir 链接）
两处生成区手改会被覆盖；锚点外内容原样保留。人工只维护磁盘文件 + 速览表「用途」列。

选项：
  --dry-run   只打印将生成内容的摘要与逐行差异，不写盘
  --help      打印本说明`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}
const unknown = args.filter((a) => a !== '--dry-run');
if (unknown.length) {
  console.error(`❌ 未知参数：${unknown.join(' ')}\n\n${USAGE}`);
  process.exit(1);
}
const DRY = args.includes('--dry-run');

const WIKI = 'wiki';
const INDEX_P = path.join(WIKI, 'INDEX.md');
const BOARD_P = path.join(WIKI, '知识沉淀总览.html');

// ---- 磁盘枚举（事实源：文件在哪个主题目录就属于哪个主题）----
// 登记口径（2026-09-17 起，与 verify-wiki-consistency.mjs 保持一致）：
//   主题目录顶层：全量文件登记（现状不变）；
//   直属子目录：仅登记 md/html 知识文档（排除 *.visual-check.* 工具产物；.json/.png 不计入）；
//   数据维护主题例外——其子目录（schema变更/<批次>/ 等）走 README.md 台账，不参与登记。
const isKnowledgeDoc = (f) => /\.(md|html)$/i.test(f) && !/\.visual-check\./i.test(f);
const diskTopics = new Map(); // name -> [{ name: '文件名或 子目录/文件名', dir: 'wiki/主题[/子目录]/' }]
for (const d of fs.readdirSync(WIKI)) {
  const p = path.join(WIKI, d);
  if (!fs.statSync(p).isDirectory() || d === 'drafts-archive') continue;
  const entries = fs.readdirSync(p)
    .filter((f) => fs.statSync(path.join(p, f)).isFile())
    .map((f) => ({ name: f, dir: `wiki/${d}/` }));
  if (d !== '数据维护') {
    for (const sub of fs.readdirSync(p)) {
      const sp = path.join(p, sub);
      if (!fs.statSync(sp).isDirectory()) continue;
      for (const f of fs.readdirSync(sp)) {
        if (fs.statSync(path.join(sp, f)).isFile() && isKnowledgeDoc(f)) {
          entries.push({ name: `${sub}/${f}`, dir: `wiki/${d}/${sub}/` });
        }
      }
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  diskTopics.set(d, entries);
}
// gitignore 豁免（F4，incident 2026-09-23-code-review-f3-f4-closeout）：与 verify-wiki-consistency.mjs 同口径——
// 排除 .gitignore 忽略的本机文件（如 *.xlsx），防止生成物计数在 fresh clone 漂移；git 不可用时退化为全量计数
const gitIgnoredArchive = (() => {
  try {
    const out = execSync('git -c core.quotepath=false status --ignored=matching --porcelain -uall -- wiki/drafts-archive',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const prefix = 'wiki/drafts-archive/';
    return new Set(out.split(/\r?\n/)
      .filter((l) => l.startsWith('!! '))
      .map((l) => l.slice(3).trim().replace(/\/$/, ''))
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(prefix.length)));
  } catch {
    return new Set();
  }
})();
const archiveCount = (() => {
  let n = 0;
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      const r = rel ? `${rel}/${e}` : e;
      if (fs.statSync(p).isDirectory()) walk(p, r);
      else if (!gitIgnoredArchive.has(r)) n++;
    }
  };
  if (fs.existsSync(path.join(WIKI, 'drafts-archive'))) walk(path.join(WIKI, 'drafts-archive'));
  else console.error('⚠️ wiki/drafts-archive/ 不存在，归档计数按 0 处理（wiki 协议目录，建议恢复）');
  return n;
})();

// ---- 读 INDEX 现速览表：主题顺序 + 用途列（人工，不覆盖）----
// 切行须容忍 CRLF：按 '\n' 切会在行尾留 '\r'，速览表行锚定正则（\|$）整表失配 →
// 「用途」列（唯一人工维护位）被静默重置为 <待补>（papercut 2026-09-17；fixture 见 gen-wiki-board.test.mjs 场景 1）
const indexText = fs.readFileSync(INDEX_P, 'utf8');
const overview = []; // {name, usage}
for (const line of indexText.split(/\r?\n/)) {
  const m = line.match(/^\| ([^|]+) \| (\d+) \|([^|]*)\|$/);
  if (m && m[1].trim() !== '主题') overview.push({ name: m[1].trim(), usage: m[3].trim() });
}
// 主题顺序 = 速览表现顺序在前，磁盘新主题按中文排序追加
const ordered = [...overview.filter((o) => diskTopics.has(o.name))];
for (const t of [...diskTopics.keys()].sort((a, b) => a.localeCompare(b, 'zh'))) {
  if (!ordered.some((o) => o.name === t)) ordered.push({ name: t, usage: '<待补：新主题用途描述>' });
}

const totalFiles = [...diskTopics.values()].reduce((n, f) => n + f.length, 0);

// ---- 生成 INDEX 三段 ----
const eol = indexText.includes('\r\n') ? '\r\n' : '\n';
const overviewRows = ordered.map((o) => `| ${o.name} | ${diskTopics.get(o.name).length} | ${o.usage} |`);
const mappingSection = ordered.map((o) => {
  const rows = diskTopics.get(o.name).map((e) => `| ${e.name} | ${o.name} | ${e.dir} |`);
  return [`### ${o.name}（${diskTopics.get(o.name).length}）`, '', '| 文件名 | 主题 | 归属目录 |', '|---|---|---|', ...rows].join(eol);
}).join(eol + eol);

let out = indexText;
// 速览表数据行（表头「| 主题 |」+ 分隔行之后的连续数据行整组替换）
{
  const lines = out.split(/\r?\n/);
  const headIdx = lines.findIndex((l) => /^\| 主题 \|/.test(l));
  if (headIdx < 0 || !/^[\|:\-\s]+$/.test(lines[headIdx + 1] || '')) {
    console.error('❌ INDEX 速览表表头未找到，未写盘');
    process.exit(1);
  }
  let lastData = headIdx + 1;
  while (lastData + 1 < lines.length && lines[lastData + 1].startsWith('|')) lastData++;
  const fixedRows = [...overviewRows, '| drafts-archive | — | 原文档备份（按 日期-主题 分目录） |'];
  out = [...lines.slice(0, headIdx), '| 主题 | 文件数 | 用途 |', '|---|---|---|', ...fixedRows, ...lines.slice(lastData + 1)].join(eol);
}
// 合计行数字（锚点缺失即 fail-loud——静默 no-op 会让合计行悄悄陈旧，2026-09-24 审查修复）
const totalRe = /合计：\*\*\d+ 份\*\*知识文档，\*\*\d+ 个主题\*\*/;
if (!totalRe.test(out)) {
  console.error('❌ INDEX「合计」行锚点未找到（须形如「合计：**N 份**知识文档，**M 个主题**」），未写盘');
  process.exit(1);
}
out = out.replace(totalRe, `合计：**${totalFiles} 份**知识文档，**${diskTopics.size} 个主题**`);
// 映射表区（节标题之间整段重写）
{
  const lines = out.split(/\r?\n/);
  const s = lines.findIndex((l) => l.startsWith('## 文件 → 主题 → 归属目录 映射表'));
  const e = lines.findIndex((l) => l.startsWith('## 命名规则'));
  if (s >= 0 && e > s) {
    out = [...lines.slice(0, s + 1), '', mappingSection, '', '---', '', ...lines.slice(e)].join(eol);
  } else {
    // 锚点缺失即 fail-loud（对齐速览表/合计行口径）——曾静默跳过致映射表悄悄陈旧仍报 ✅（2026-09-24 审查修复）
    console.error('❌ INDEX 映射表锚点未找到（须有「## 文件 → 主题 → 归属目录 映射表」与其后的「## 命名规则」），未写盘');
    process.exit(1);
  }
}

// ---- 生成看板 DATA ----
const boardText = fs.readFileSync(BOARD_P, 'utf8');
const topicsJs = ordered.map((o) => {
  // dir 相对看板自身（wiki/）——旧值带 wiki/ 前缀会被解析为 wiki/wiki/... 死链
  const files = diskTopics.get(o.name).map((e) => `      { "file": ${JSON.stringify(e.name)}, "topic": ${JSON.stringify(o.name)}, "dir": ${JSON.stringify(`./${e.dir.slice('wiki/'.length)}`)} }`);
  return `    { "name": ${JSON.stringify(o.name)}, "files": [\n${files.join(',\n')}\n    ]}`;
}).join(',\n');
const dataJs = `const DATA = {\n  "summary": { "total": ${totalFiles}, "topics": ${diskTopics.size}, "files": ${totalFiles}, "archive": ${archiveCount} },\n  "topics": [\n${topicsJs}\n  ]\n};`;
const boardOut = boardText.replace(/const DATA = \{[\s\S]*?\n\};/, dataJs);
if (boardOut === boardText && !/const DATA = \{[\s\S]*?\n\};/.test(boardText)) {
  console.error('❌ 看板中未找到 const DATA = {...} 块，未写盘');
  process.exit(1);
}

// ---- 写盘（dry-run 只预览差异）----
if (DRY) {
  console.log('🔎 --dry-run：未写盘，差异预览如下');
  previewDiff('wiki/INDEX.md', indexText, out);
  previewDiff('wiki/知识沉淀总览.html', boardText, boardOut);
} else {
  fs.writeFileSync(INDEX_P, out, 'utf8');
  fs.writeFileSync(BOARD_P, boardOut, 'utf8');
}

const tail = DRY ? '将重写' : '已重写';
console.log(`${DRY ? '🔎 [dry-run] 将生成' : '✅ 已生成'}：文件 ${totalFiles} 份 / 主题 ${diskTopics.size} 个 / 归档 ${archiveCount} 份；速览表 ${overviewRows.length} 行、映射表 ${ordered.length} 节、看板 DATA ${tail}`);
console.log('   人工仅维护：磁盘文件 + 速览表「用途」列（新主题为 <待补> 的请补描述后重跑本脚本）');

// dry-run 差异预览：首尾对齐后取中段变更块（逐行），各方向最多显示 10 行
function previewDiff(label, before, after) {
  if (before === after) {
    console.log(`• ${label}：无变化`);
    return;
  }
  const b = before.split(/\r?\n/);
  const a = after.split(/\r?\n/);
  let head = 0;
  while (head < b.length && head < a.length && b[head] === a[head]) head++;
  let tailN = 0;
  while (tailN < b.length - head && tailN < a.length - head && b[b.length - 1 - tailN] === a[a.length - 1 - tailN]) tailN++;
  const removed = b.slice(head, b.length - tailN);
  const added = a.slice(head, a.length - tailN);
  console.log(`• ${label}：第 ${head + 1} 行起变更，删 ${removed.length} 行 / 增 ${added.length} 行`);
  for (const l of removed.slice(0, 10)) console.log(`    - ${l.slice(0, 120)}`);
  if (removed.length > 10) console.log(`    - …（其余 ${removed.length - 10} 行略）`);
  for (const l of added.slice(0, 10)) console.log(`    + ${l.slice(0, 120)}`);
  if (added.length > 10) console.log(`    + …（其余 ${added.length - 10} 行略）`);
}
