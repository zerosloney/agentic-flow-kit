#!/usr/bin/env node
// 跨语料检索入口（2026-09-21，intent 2026-09-21-workflow-doc-retrieval）
// 用法：node .agents/scripts/kb-search.mjs [选项] <词1> [词2 ...]（多词 AND，全部命中才算）
//
// 语料与口径
//   workflow（流程留痕）：只搜 frontmatter + H1 + 指定节（背景 / 目标 / 根因 / 复盘三件套 / 验收标准 / 影响面），
//     默认全状态可命中、活跃（draft/approved/open）排序 ×1.3 优先；输出带「节名 + 行号」便于节级读取。
//   wiki（领域知识）：沿用 2026-09-21 降噪口径——默认跳过 .json/.csv、*.visual-check.* 与 >180KB bulk 文件。
//   两侧排序均为 命中数/√文件KB（防大文件靠体量霸榜）；`-n` 为每语料展示上限。
// 结构缓存（2026-09-23 intent kb-search-structure-cache）：可检索子集预提取进 .agents/cache/kb-index.json，
//   按 [mtimeMs,size] 逐文件失效，口径指纹变化整份作废；匹配/排序/输出路径不变（三路输出与冷扫逐字节一致）；
//   缓存任何读写异常静默回退全扫。`--include-generated` 走纯扫（bulk 文件不入缓存）。
// 测试：node .agents/scripts/kb-search.test.mjs（fixture 回归，须全绿）
// 模块词表：.agents/workflow-modules.txt（--module 取值校验，单源）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MODULES_FILE = path.join(SCRIPT_DIR, '..', 'workflow-modules.txt');

const USAGE = `用法: node .agents/scripts/kb-search.mjs [选项] <词1> [词2 ...]（多词 AND）

  --scope <workflow|wiki|all>   检索语料，默认 all（指定 -t 时默认转 wiki）
  --type <intents,specs,plans,incidents>   workflow：限定文档类型（逗号分隔）
  --module <词表token>           workflow：按 frontmatter 模块过滤（词表见 .agents/workflow-modules.txt）
  --status <all|active|terminal> workflow：状态过滤，默认 all（active = draft/approved/open）
  -t <主题>                      wiki：限定主题目录（如 数据维护）
  -n <N>                         每语料展示文件数上限，默认 10；0 = 不限
  --include-generated            wiki：纳入默认跳过的 json/csv、*.visual-check.* 与 >180KB bulk 文件（走纯扫，不吃缓存）
  --no-cache                     禁用结构缓存，全量扫（与缓存热路径输出逐字节一致）
  --rebuild                      忽略现有缓存重建后回写
  --help                         打印本说明

退出码：0 正常（含无命中）；1 参数错误（无词 / 未知选项 / 非法枚举值）`;

const args = process.argv.slice(2);
let scope = '';
let scopeExplicit = false;
let typeFilter = null;
let moduleFilter = '';
let statusFilter = 'all';
let topicFilter = '';
let limit = 10;
let limitRaw = '10';
let includeGenerated = false;
let noCache = false;
let rebuild = false;
const words = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--scope') { scope = args[++i] || ''; scopeExplicit = true; }
  else if (a === '--type') typeFilter = (args[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--module') moduleFilter = args[++i] || '';
  else if (a === '--status') statusFilter = args[++i] || '';
  else if (a === '-t') topicFilter = args[++i] || '';
  else if (a === '-n') { limitRaw = args[++i] ?? ''; limit = Number(limitRaw); }
  else if (a === '--include-generated') includeGenerated = true;
  else if (a === '--no-cache') noCache = true;
  else if (a === '--rebuild') rebuild = true;
  else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
  else words.push(a);
}
if (!words.length) { console.error(USAGE); process.exit(1); }
if (!Number.isFinite(limit) || limit < 0) { console.error(`-n 须为非负整数（现 ${limitRaw}）\n\n${USAGE}`); process.exit(1); }
if (!scope) scope = topicFilter ? 'wiki' : 'all';
if (!['workflow', 'wiki', 'all'].includes(scope)) { console.error(`--scope 须为 workflow|wiki|all（现 ${scope}）\n\n${USAGE}`); process.exit(1); }
if (!['all', 'active', 'terminal'].includes(statusFilter)) { console.error(`--status 须为 all|active|terminal（现 ${statusFilter}）\n\n${USAGE}`); process.exit(1); }
const DOC_TYPES = ['intents', 'specs', 'plans', 'incidents'];
if (typeFilter && typeFilter.some((t) => !DOC_TYPES.includes(t))) {
  console.error(`--type 取值须为 ${DOC_TYPES.join('|')}（现 ${typeFilter.join(',')}）\n\n${USAGE}`);
  process.exit(1);
}
const MODULES = fs.readFileSync(MODULES_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
if (moduleFilter && !MODULES.includes(moduleFilter)) {
  console.error(`--module 未知模块：${moduleFilter}（词表见 .agents/workflow-modules.txt：${MODULES.join(' / ')}）\n\n${USAGE}`);
  process.exit(1);
}

const ACTIVE_STATUS = ['draft', 'approved', 'open']; // 与 workflow/INDEX.md 活跃口径一致（fixed 归档案，默认也可命中）
const WF_SECTIONS = ['背景', '目标', '根因', '复盘三件套', '验收标准', '影响面'];
const WIKI_EXCLUDE = new Set(['INDEX.md', '知识沉淀总览.html']);
const WIKI_MAX_KB = 180;

// ---- frontmatter（受限子集：每行 `键: 值`）+ H1 标题（去「INTENT — 」前缀）----
function parseDoc(text) {
  const meta = {};
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\S+):\s*(.*)$/);
      if (kv) meta[kv[1].trim()] = kv[2].trim();
    }
  }
  const h1 = text.match(/^# (.+)$/m);
  let title = h1 ? h1[1] : '';
  const dash = title.match(/\S+\s*[—–-]+\s*(.+)$/);
  if (dash) title = dash[1];
  return { meta, title };
}

// ---- workflow 侧可检索行：frontmatter + H1 + 指定节（节名随 `## ` 标题滚动）；词过滤在调用方，缓存存词无关子集 ----
function workflowLines(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  if (/^---\s*$/.test(lines[0] || '')) {
    out.push({ ln: 1, section: '(frontmatter)', line: lines[0] });
    for (i = 1; i < lines.length; i++) {
      out.push({ ln: i + 1, section: '(frontmatter)', line: lines[i] });
      if (/^---\s*$/.test(lines[i])) { i++; break; }
    }
  }
  let section = '';
  for (; i < lines.length; i++) {
    const line = lines[i];
    const h2 = line.match(/^## (.+?)\s*$/);
    if (h2) section = h2[1];
    if (/^# /.test(line) && !/^## /.test(line)) { out.push({ ln: i + 1, section: '(标题)', line }); section = ''; continue; }
    if (WF_SECTIONS.some((s) => section.startsWith(s))) out.push({ ln: i + 1, section, line });
  }
  return out;
}

function matchWords(lines, words) {
  const byWord = words.map((w) => lines.filter((x) => x.line.includes(w)));
  if (byWord.some((h) => h.length === 0)) return null; // AND：任一词未命中即跳过
  const total = byWord.reduce((n, h) => n + h.length, 0);
  const shown = [...new Map(lines.map((x) => [x.ln, x])).values()].sort((a, b) => a.ln - b.ln).slice(0, 3);
  return { total, shown };
}

// ---- 结构缓存：可检索子集预提取，[mtimeMs,size] 两元组逐文件失效，指纹变即整份作废 ----
// 键 = <检索根 cwd>::<相对路径>（多语料根共存一文件，fixture 临时目录天然隔离）；读写任何异常静默回退全扫。
const CACHE_DIR = path.join(SCRIPT_DIR, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'kb-index.json');
const ROOT_NS = `${path.resolve('.')}::`;
const CFG_FP = createHash('sha256').update(JSON.stringify({
  v: 1, WF_SECTIONS, ACTIVE_STATUS, WIKI_MAX_KB, excl: [...WIKI_EXCLUDE],
  exts: ['md', 'sql', 'html', 'txt', 'gen:csv|json'],
  fns: [parseDoc.toString(), workflowLines.toString(), matchWords.toString()],
})).digest('hex').slice(0, 16);
const cacheUsable = !noCache && !includeGenerated;
let cache = null;
const touched = new Set();
if (cacheUsable) {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    cache = j && j.fp === CFG_FP && j.files && typeof j.files === 'object' ? j.files : {};
  } catch { cache = {}; }
  if (rebuild) cache = {};
}

const serializeLines = (lines, kind) => lines.map((x) => (kind === 'wf' ? [x.ln, x.section, x.line] : [x.ln, x.line]));
const reviveLines = (lines, kind) => lines.map((a) => (kind === 'wf' ? { ln: a[0], section: a[1], line: a[2] } : { ln: a[0], line: a[1] }));

// 取一个源文件的缓存条目；miss 时 build()（读全文提取可检索子集）并登记回写。返回 {st, meta?, title?, lines}
function cachedEntry(relPath, kind, build) {
  const abs = path.resolve(relPath);
  if (!cache) {
    const e = build();
    e.st = [fs.statSync(abs).mtimeMs, fs.statSync(abs).size];
    return e;
  }
  const key = ROOT_NS + relPath.split(path.sep).join('/');
  const st = fs.statSync(abs);
  const sig = [st.mtimeMs, st.size];
  const e = cache[key];
  if (e && e.kind === kind && Array.isArray(e.st) && e.st[0] === sig[0] && e.st[1] === sig[1]) {
    touched.add(key);
    return { st: e.st, meta: e.meta, title: e.title, lines: reviveLines(e.lines, kind) };
  }
  const built = build();
  cache[key] = {
    st: sig, kind,
    ...(kind === 'wf' ? { meta: built.meta, title: built.title } : {}),
    lines: serializeLines(built.lines, kind),
  };
  touched.add(key);
  return { st: sig, meta: built.meta, title: built.title, lines: built.lines };
}

function saveCache() {
  if (!cache) return;
  try {
    for (const k of Object.keys(cache)) {
      if (!k.startsWith(ROOT_NS) || touched.has(k)) continue;
      const rel = k.slice(ROOT_NS.length).replace(/\//g, path.sep);
      try {
        const st = fs.statSync(rel);
        const e = cache[k];
        if (e.st[0] !== st.mtimeMs || e.st[1] !== st.size) delete cache[k];
      } catch { delete cache[k]; }
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ fp: CFG_FP, files: cache }));
  } catch { /* 只读目录 / 并发写等异常：放弃回写，下次重建 */ }
}

// ---- workflow 检索 ----
function searchWorkflow(words) {
  const results = [];
  for (const type of (typeFilter || DOC_TYPES)) {
    const dir = path.join('workflow', type);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
      const p = path.join(dir, f);
      const e = cachedEntry(p, 'wf', () => {
        const text = fs.readFileSync(p, 'utf8');
        const { meta, title } = parseDoc(text);
        return { meta, title, lines: workflowLines(text) };
      });
      const meta = e.meta || {};
      const status = meta['状态'] || '';
      const module = meta['模块'] || '—';
      if (moduleFilter && module !== moduleFilter) continue;
      if (statusFilter === 'active' && !ACTIVE_STATUS.includes(status)) continue;
      if (statusFilter === 'terminal' && ACTIVE_STATUS.includes(status)) continue;
      const hits = matchWords(e.lines.filter((x) => words.some((w) => x.line.includes(w))), words);
      if (!hits) continue;
      const kb = e.st[1] / 1024;
      const active = ACTIVE_STATUS.includes(status);
      results.push({
        file: `${type}/${f}`, title: e.title || '', status, level: meta['级别'] || '—', module,
        total: hits.total, shown: hits.shown, kb,
        score: (hits.total / Math.sqrt(Math.max(kb, 0.1))) * (active ? 1.3 : 1),
      });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}

// ---- wiki 检索（口径同 2026-09-21 降噪版 wiki-search）----
const WIKI_EXTS = includeGenerated ? /\.(md|sql|html|csv|json|txt)$/i : /\.(md|sql|html|txt)$/i;
const walkWiki = (dir, rel) => {
  const out = [];
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    if (fs.statSync(p).isDirectory()) { out.push(...walkWiki(p, `${rel}/${e}`)); continue; }
    if (!WIKI_EXTS.test(e) || WIKI_EXCLUDE.has(e)) continue;
    out.push({ fsPath: p, key: `${rel}/${e}` });
  }
  return out;
};

function searchWiki(words) {
  const results = [];
  let skipped = 0;
  if (!fs.existsSync('wiki')) return { results, skipped };
  for (const d of fs.readdirSync('wiki')) {
    const dir = path.join('wiki', d);
    if (!fs.statSync(dir).isDirectory() || d === 'drafts-archive') continue;
    if (topicFilter && d !== topicFilter) continue;
    for (const { fsPath: p, key } of walkWiki(dir, d)) {
      const size = fs.statSync(p).size;
      if (!includeGenerated && (/\.visual-check\./i.test(path.basename(p)) || size > WIKI_MAX_KB * 1024)) { skipped++; continue; }
      const e = cachedEntry(p, 'wiki', () => {
        let text;
        try { text = fs.readFileSync(p, 'utf8'); } catch { return { lines: [] }; }
        return { lines: text.split('\n').map((line, i) => ({ ln: i + 1, line })) };
      });
      if (!e.lines.length) continue;
      const hits = matchWords(e.lines.filter((x) => words.some((w) => x.line.includes(w))), words);
      if (!hits) continue;
      const kb = size / 1024;
      results.push({ file: key, total: hits.total, shown: hits.shown, kb, score: hits.total / Math.sqrt(Math.max(kb, 0.1)) });
    }
  }
  return { results: results.sort((a, b) => b.score - a.score), skipped };
}

// ---- 输出 ----
const top = (arr) => (limit ? arr.slice(0, limit) : arr);
let anyHits = 0;

if (scope === 'workflow' || scope === 'all') {
  const res = searchWorkflow(words);
  anyHits += res.length;
  const shown = top(res);
  console.log(`── workflow（${res.length} 个文件命中${res.length > shown.length ? `，展示前 ${shown.length}` : ''}）──`);
  for (const r of shown) {
    console.log(`📄 workflow/${r.file} — ${r.status || '未填状态'} · ${r.level} · ${r.module} · ${r.total} 处命中 / ${r.kb < 10 ? r.kb.toFixed(1) : Math.round(r.kb)}KB`);
    for (const h of r.shown) console.log(`   [${h.section}] L${h.ln}: ${h.line.trim().slice(0, 130)}`);
  }
  if (!res.length) console.log('（无命中）');
}

if (scope === 'wiki' || scope === 'all') {
  const { results: res, skipped } = searchWiki(words);
  anyHits += res.length;
  const shown = top(res);
  console.log(`── wiki（${res.length} 个文件命中${res.length > shown.length ? `，展示前 ${shown.length}` : ''}）──`);
  for (const r of shown) {
    console.log(`📄 wiki/${r.file} — ${r.total} 处命中 / ${r.kb < 10 ? r.kb.toFixed(1) : Math.round(r.kb)}KB`);
    for (const h of r.shown) console.log(`   L${h.ln}: ${h.line.trim().slice(0, 130)}`);
  }
  if (!res.length) console.log('（无命中）');
  if (skipped) console.log(`（wiki 跳过 ${skipped} 个产物/大文件——--include-generated 纳入）`);
}

console.log(`\n${anyHits ? `合计 ${anyHits} 个文件命中（${words.join(' AND ')}）` : `无命中（${words.join(' AND ')}）`}` +
  `；排序：命中数/√文件KB${scope === 'workflow' ? '' : '（workflow 侧活跃 ×1.3）'}` +
  (scope === 'all' ? '；`--scope` 限定语料、`--status all` 显式全量' : ''));

saveCache();
