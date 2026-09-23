// wiki 三方一致性验证：磁盘 ↔ INDEX.md ↔ 知识沉淀总览.html(DATA) ＋ 数据维护台账登记 ＋ 看板链接可达性
// 用法: node .agents/scripts/verify-wiki-consistency.mjs   （不一致 exit 1）
// 约定见 .agents/skills/wiki/SKILL.md；归档 drafts-archive 仅计数，不参与文件比对。
// 口径（2026-09-17 起，与 gen-wiki-board.mjs 保持一致）：主题目录顶层全量文件登记 +
//      直属子目录中的 md/html 知识文档（排除 *.visual-check.* 工具产物；数据维护主题例外——
//      其子目录 schema变更/<批次>/ 等走 README 台账，不参与三方文件比对与 summary 统计）；
//      递归扫描仅用于「断链守卫 + 数据维护批次台账登记」两项断言，避免改变既有统计口径误报。
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const WIKI = 'wiki';
const problems = [];
const notes = [];

// 递归列目录（相对 dir 的路径，仅正斜杠）；drafts-archive 由调用方排除
const walkTree = (dir, rel = '') => {
  const acc = { files: [], dirs: [] };
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const r = rel ? `${rel}/${e}` : e;
    if (fs.statSync(p).isDirectory()) {
      acc.dirs.push(r);
      const sub = walkTree(p, r);
      acc.files.push(...sub.files);
      acc.dirs.push(...sub.dirs);
    } else acc.files.push(r);
  }
  return acc;
};

// ---- 磁盘枚举（登记口径与 gen-wiki-board.mjs 一致）----
const isKnowledgeDoc = (f) => /\.(md|html)$/i.test(f) && !/\.visual-check\./i.test(f);
const diskFiles = new Set(); // "主题/文件名"（子目录文件名带 子目录/ 前缀）
const diskTopics = new Set();
const activeTree = { files: [], dirs: [] }; // 递归视图（断链守卫 / 台账登记断言用）
for (const d of fs.readdirSync(WIKI)) {
  const p = path.join(WIKI, d);
  if (!fs.statSync(p).isDirectory()) continue;
  if (d === 'drafts-archive') continue;
  diskTopics.add(d);
  for (const f of fs.readdirSync(p)) {
    if (fs.statSync(path.join(p, f)).isFile()) diskFiles.add(`${d}/${f}`);
  }
  if (d !== '数据维护') {
    for (const sub of fs.readdirSync(p)) {
      const sp = path.join(p, sub);
      if (!fs.statSync(sp).isDirectory()) continue;
      for (const f of fs.readdirSync(sp)) {
        if (fs.statSync(path.join(sp, f)).isFile() && isKnowledgeDoc(f)) diskFiles.add(`${d}/${sub}/${f}`);
      }
    }
  }
  const sub = walkTree(p, d);
  activeTree.files.push(...sub.files);
  activeTree.dirs.push(...sub.dirs);
}

// gitignore 豁免（F4，incident 2026-09-23-code-review-f3-f4-closeout）：drafts-archive 含
// .gitignore 忽略的本机文件（如 *.xlsx），计入会使生成物计数在 fresh clone 必然漂移；
// 口径 = 排除忽略文件（git 不可用/非仓库时退化为全量计数，fixture 环境不受影响）
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
const archiveCount = walkTree(path.join(WIKI, 'drafts-archive')).files.filter((r) => !gitIgnoredArchive.has(r)).length;

// ---- 看板 DATA 解析 ----
const html = fs.readFileSync(path.join(WIKI, '知识沉淀总览.html'), 'utf8');
const m = html.match(/const DATA = (\{[\s\S]*?\n\});/);
if (!m) {
  console.error('❌ 看板 DATA 解析失败：知识沉淀总览.html 中找不到 `const DATA = {...}`');
  process.exit(1);
}
const DATA = eval('(' + m[1] + ')');
const boardFiles = new Set();
for (const t of DATA.topics) for (const f of t.files) boardFiles.add(`${t.name}/${f.file}`);
const boardTopics = new Set(DATA.topics.map((t) => t.name));

// ---- INDEX 映射表解析 ----
const indexFiles = new Set();
const indexTopicCounts = new Map(); // 速览表 topic → 文件数
for (const line of fs.readFileSync(path.join(WIKI, 'INDEX.md'), 'utf8').split(/\r?\n/)) {
  const mm = line.match(/^\| ([^|]+) \| ([^|]+) \| wiki\/([^/]+)\/[^|]*\|$/);
  if (mm) indexFiles.add(`${mm[3].trim()}/${mm[1].trim()}`);
  const ov = line.match(/^\| ([^|]+) \| (\d+) \|[^|]*\|$/);
  if (ov && ov[1].trim() !== '主题') indexTopicCounts.set(ov[1].trim(), Number(ov[2]));
}

const diff = (a, b) => [...a].filter((x) => !b.has(x));
const eq = (a, b) => a.size === b.size && diff(a, b).length === 0;

// ---- 1. 文件级三方比对 ----
for (const [label, extra] of [
  ['看板→磁盘', diff(boardFiles, diskFiles)],
  ['磁盘→看板', diff(diskFiles, boardFiles)],
  ['INDEX→磁盘', diff(indexFiles, diskFiles)],
  ['磁盘→INDEX', diff(diskFiles, indexFiles)],
]) {
  if (extra.length) problems.push(`文件集合不一致（${label}）: ${extra.join('；')}`);
}
if (problems.length === 0) notes.push(`文件级三方一致：${diskFiles.size} 份`);

// ---- 2. 幽灵目录：磁盘有主题目录但看板没有 ----
const ghosts = diff(diskTopics, boardTopics);
if (ghosts.length) problems.push(`磁盘存在看板未登记的主题目录: ${ghosts.join('、')}`);

// ---- 3. 占位主题（看板有、磁盘 0 文件）——允许，仅提示 ----
for (const t of DATA.topics) {
  if (t.files.length === 0 && fs.existsSync(path.join(WIKI, t.name))) {
    const real = fs.readdirSync(path.join(WIKI, t.name)).filter((f) => fs.statSync(path.join(WIKI, t.name, f)).isFile()).length;
    if (real > 0) problems.push(`看板主题「${t.name}」files 为空但磁盘有 ${real} 个文件`);
    else notes.push(`占位主题「${t.name}」：0 文件（允许）`);
  } else if (t.files.length === 0) {
    problems.push(`看板主题「${t.name}」files 为空且磁盘无此目录`);
  }
}

// ---- 4. INDEX 速览表文件数 vs 磁盘 ----
for (const [topic, count] of indexTopicCounts) {
  const actual = [...diskFiles].filter((f) => f.startsWith(topic + '/')).length;
  if (!diskTopics.has(topic) && count > 0) problems.push(`INDEX 速览表主题「${topic}」(${count}) 磁盘无此目录`);
  else if (actual !== count) problems.push(`INDEX 速览表「${topic}」标 ${count}，磁盘实际 ${actual}`);
}

// ---- 5. summary 统计字段 ----
const s = DATA.summary;
const sumChecks = [
  ['summary.total', s.total, diskFiles.size],
  ['summary.files', s.files, diskFiles.size],
  ['summary.topics', s.topics, DATA.topics.length],
  ['summary.archive', s.archive, archiveCount],
];
for (const [label, declared, actual] of sumChecks) {
  if (declared !== actual) problems.push(`${label}=${declared}，实际 ${actual}`);
}

// ---- 6. 活跃文件禁 file:/// 绝对链（搬家断链防复发；递归覆盖子目录）----
const badLinks = [];
for (const f of activeTree.files) {
  if (!/\.(md|html)$/i.test(f)) continue;
  if (fs.readFileSync(path.join(WIKI, f), 'utf8').includes('file:///')) badLinks.push(f);
}
if (badLinks.length) problems.push(`以下活跃文件含 file:/// 绝对路径链接: ${badLinks.join('、')}`);

// ---- 7. 数据维护台账登记：子目录（含批次目录）须在 wiki/数据维护/README.md 有登记行 ----
// 「数据维护走 README 台账」是可选主题约定——目录不存在（新项目未建该主题）时整体跳过
const maintLedger = path.join(WIKI, '数据维护', 'README.md');
if (fs.existsSync(maintLedger)) {
const maintReadme = fs.readFileSync(maintLedger, 'utf8');
const maintReadmeFlat = maintReadme.replace(/\s+/g, ''); // README 标题写作「schema 变更」（带空格），故去空白再比对
const maintDirs = activeTree.dirs.filter((d) => d.startsWith('数据维护/'));
const unregistered = maintDirs
  .map((d) => d.split('/').pop())
  .filter((name) => !maintReadme.includes(name) && !maintReadmeFlat.includes(name.replace(/\s+/g, '')));
if (unregistered.length) problems.push(`数据维护台账未登记（wiki/数据维护/README.md 无此行）：${unregistered.join('、')}`);
else notes.push(`数据维护台账登记完整：${maintDirs.length} 个子目录（含批次目录）均有登记`);
}

// ---- 8. 看板链接可达性：DATA.dir（「打开目录」href）+ 静态相对 href 解析后须存在 ----
const deadLinks = [];
for (const t of DATA.topics) {
  for (const f of t.files) {
    const p = path.join(WIKI, f.dir); // 看板自身位于 wiki/，dir 为相对它解析
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) deadLinks.push(`${t.name}/${f.file} → ${f.dir}`);
  }
}
for (const m2 of html.matchAll(/href="([^"]+)"/g)) {
  const href = m2[1];
  if (/^(https?:|mailto:|#)/i.test(href) || href.includes('${')) continue; // 外链 / 锚点 / 模板占位
  if (!fs.existsSync(path.join(WIKI, href))) deadLinks.push(`静态 href → ${href}`);
}
if (deadLinks.length) problems.push(`看板链接指向不存在的路径（相对 wiki/ 解析）: ${deadLinks.join('；')}`);

// ---- 输出 ----
for (const n of notes) console.log('ℹ️  ' + n);
if (problems.length) {
  console.error('\n❌ wiki 一致性校验失败：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`✅ wiki 三方一致：文件 ${diskFiles.size} 份 / 主题 ${DATA.topics.length} 个（含占位）/ 归档 ${archiveCount} 份`);
