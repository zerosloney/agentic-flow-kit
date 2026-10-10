// flow-kit draft-sediment：关单时把高价值内容自动抽成 wiki 草稿（B2，2026-10-10）
// 输入：一个 done intent 或 closed incident 文件 → 抽取高价值节（影响面/触达红线 或 复盘三件套）
//   → 渲染成带「来源」frontmatter 的 wiki 草稿 → 落 wiki/drafts-archive/<日期-主题>/<主题>.md
//   → 回写源文件 frontmatter「沉淀:」字段（与 B1 沉淀追踪闭环）→ 重跑 gen-wiki-board（归档计数随动，
//     否则 verify-wiki-consistency 的 summary.archive 比对会拦提交）
// 草稿是中间态：drafts-archive 只读不增量、不参与文件级登记（仅计总数），归类到活跃主题目录由人工完成
// （人工移动后跑 gen-wiki-board + verify-wiki-consistency，并在目标文件保留/改写「来源」字段）
// 用法：node .agents/scripts/draft-sediment.mjs workflow/intents/2026-10-10-主题.md [--dry-run] [--help]
//   （intent 须 done；incident 须 closed 且复盘三件套齐全——与 check-loop 沉淀追踪子判据同口径）
// 零依赖；抽节为纯函数（export 供测试）；CLI 解析最简字符串匹配
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `用法：node .agents/scripts/draft-sediment.mjs <workflow/intents|incidents/文件.md> [--dry-run] [--help]

关单时把高价值内容抽成 wiki 草稿（B2 沉淀自动化）：
  - intent（须 done）：抽「影响面」「触达红线」节
  - incident（须 closed 且复盘三件套齐全）：抽「影响面」「根因」「为什么之前没拦住」「复盘三件套」节
落 wiki/drafts-archive/<日期-主题>/<主题>.md，带「来源」frontmatter 指回源文件（B3 双向链接），
并回写源文件 frontmatter「沉淀:」字段（B1 闭环），随后重跑 gen-wiki-board.mjs 更新归档计数。

选项：
  --dry-run   只打印将生成的草稿与回写动作，不写盘
  --help      打印本说明

草稿是中间态：drafts-archive 只读不增量。人工归类到 wiki/<主题>/ 后跑
  node .agents/scripts/gen-wiki-board.mjs && node .agents/scripts/verify-wiki-consistency.mjs`;

// extractSections：从 markdown 抽指定节（## 标题到下一 ## 之间的非空正文）。纯函数，无 IO。
//   节标题前缀匹配（兼容「## 影响面与边界」）。占位行（<…> 单行包揽 / HTML 注释 / 引用块）剔除——
//   与 check-loop sectionHasBody 同口径：模板未填段抽出的是占位，没有沉淀价值。
//   返回 [{ title, body }]，body 为去占位后的非空行拼接（保留原行内容与缩进）。
export function extractSections(text, headings) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let cur = null;
  let buf = [];
  const flush = () => {
    if (cur) {
      const body = buf.filter((l) => {
        const s = l.trim();
        return s && !/^<.*>$/.test(s) && !s.startsWith('<!--') && !s.startsWith('>');
      });
      if (body.length) out.push({ title: cur, body: body.join('\n') });
    }
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^\s*##\s+(.+?)\s*$/);
    if (h) {
      flush();
      cur = headings.find((x) => h[1].startsWith(x)) ? h[1] : null;
      continue;
    }
    if (cur) buf.push(line);
  }
  flush();
  return out;
}

// topicOf：主题取法——标题行（# INTENT — <主题>）优先（文件名主题常是英文短代称，
//   标题才是可读中文名）；无标题行再退文件名尾段（YYYY-MM-DD-<主题>）；都无取文件基名。
export function topicOf(filePath, text) {
  const t = String(text).match(/^#\s+(?:INTENT|INCIDENT|PLAN|SPEC)\s*—\s*(.+?)\s*$/m);
  if (t) return t[1];
  const base = path.basename(filePath, '.md');
  const m = base.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return m ? m[1] : base;
}

// renderDraft：草稿渲染（纯函数）。date = 落盘日期（YYYY-MM-DD），source = 来源相对仓根路径。
export function renderDraft({ topic, date, source, sections, kind }) {
  const fm = `---\n来源: ${source}\n状态: 草稿（待人工归类）\n---\n`;
  const kindLabel = kind === 'incident' ? '事故复盘' : '需求沉淀';
  let body = `# ${topic}（${kindLabel}草稿）\n`;
  body += `> 自动抽取于 ${date}，源自 \`${source}\`（关单沉淀，B2）。`;
  body += `本文件是**中间态**——归类到 wiki/<主题>/ 后补主题、用途，并保留「来源」字段。\n\n`;
  for (const s of sections) {
    body += `## ${s.title}\n\n${s.body}\n\n`;
  }
  return fm + body;
}

// setSedimentField：回写源文件 frontmatter「沉淀:」字段。已有值（非空、非「无」）不覆盖（防误抹人工登记）。
export function setSedimentField(text, value) {
  const m = String(text).match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return { text, changed: false };
  const fmBody = m[2];
  const lines = fmBody.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^沉淀:\s*/.test(l));
  if (idx >= 0) {
    const cur = lines[idx].replace(/^沉淀:\s*/, '').trim();
    if (cur && cur !== '无') return { text, changed: false }; // 已有人工登记，不覆盖
    lines[idx] = `沉淀: ${value}`;
  } else {
    lines.push(`沉淀: ${value}`);
  }
  return { text: m[1] + lines.join('\n') + m[3] + String(text).slice(m[0].length), changed: true };
}

function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

const isMain = process.argv[1] && process.argv[1].endsWith('draft-sediment.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
  const DRY = args.includes('--dry-run');
  const target = args.find((a) => !a.startsWith('-'));
  if (!target) fail('必填：源文件路径（workflow/intents/… 或 workflow/incidents/…）' + '\n\n' + USAGE);
  if (!fs.existsSync(target)) fail('源文件不存在：' + target);

  const text = fs.readFileSync(target, 'utf8');
  const rel = path.relative(process.cwd(), target).split(path.sep).join('/');
  const kind = rel.startsWith('workflow/incidents/') ? 'incident' : rel.startsWith('workflow/intents/') ? 'intent' : null;
  if (!kind) fail('源文件须在 workflow/intents/ 或 workflow/incidents/ 下：' + rel);

  // 状态校验（与 check-loop 沉淀追踪子判据同口径）
  const fmStatus = (() => {
    const m = text.match(/^---\r?\n[\s\S]*?^状态:\s*(.+?)\s*$/m);
    return m ? m[1].trim() : null;
  })();
  if (kind === 'intent' && fmStatus !== 'done') fail('intent 须为 done 才沉淀（当前：' + (fmStatus || '缺失') + '）');
  if (kind === 'incident' && fmStatus !== 'closed') fail('incident 须为 closed 才沉淀（当前：' + (fmStatus || '缺失') + '）');

  // 抽节：intent 影响面/触达红线；incident 影响面/根因/为什么之前没拦住/复盘三件套
  const HEADINGS = kind === 'incident'
    ? ['影响面', '根因', '为什么之前没拦住', '复盘三件套']
    : ['影响面', '触达红线'];
  const sections = extractSections(text, HEADINGS);
  if (!sections.length) fail('未抽取到高价值节（' + HEADINGS.join('/') + ' 均为空或仅占位）——内容无沉淀价值，停止');

  const topic = topicOf(target, text);
  const date = new Date().toISOString().slice(0, 10);
  const draftDir = path.join('wiki', 'drafts-archive', `${date}-${topic}`);
  const draftPath = path.join(draftDir, `${topic}.md`);
  const draft = renderDraft({ topic, date, source: rel, sections, kind });

  // 回写源文件沉淀字段（草稿路径相对仓根）
  const { text: newText, changed } = setSedimentField(text, draftPath.split(path.sep).join('/'));

  if (DRY) {
    console.log('🔎 --dry-run：未写盘');
    console.log(`• 将生成草稿：${draftPath}（${sections.length} 节 / ${draft.length} 字节）`);
    console.log(`• 将回写 ${rel} frontmatter「沉淀: ${draftPath.split(path.sep).join('/')}」${changed ? '' : '（已有登记，不覆盖）'}`);
    console.log('• 将重跑 gen-wiki-board.mjs（归档计数 +1）');
    console.log('\n--- 草稿预览（前 30 行）---');
    console.log(draft.split(/\r?\n/).slice(0, 30).join('\n'));
    process.exit(0);
  }

  // 写草稿
  fs.mkdirSync(draftDir, { recursive: true });
  fs.writeFileSync(draftPath, draft);
  console.log(`✅ 已生成 wiki 草稿：${draftPath}（${sections.length} 节：${sections.map((s) => s.title).join('、')}）`);

  // 回写源文件
  if (changed) {
    fs.writeFileSync(target, newText);
    console.log(`✅ 已回写源文件沉淀字段：${rel} → 沉淀: ${draftPath.split(path.sep).join('/')}`);
  } else {
    console.log(`ℹ️ 源文件已有沉淀登记，未覆盖：${rel}`);
  }

  // 重跑 gen-wiki-board（归档计数随动——不跑则 verify-wiki-consistency 的 summary.archive 比对拦提交）
  const gen = path.join(SCRIPT_DIR, 'gen-wiki-board.mjs');
  if (fs.existsSync(gen)) {
    const r = spawnSync(process.execPath, [gen], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) console.log('✅ 已重跑 gen-wiki-board.mjs（归档计数随动）');
    else console.error('⚠️ gen-wiki-board.mjs 重跑失败（exit ' + r.status + '）——手工跑：node .agents/scripts/gen-wiki-board.mjs');
  } else {
    console.log('ℹ️ gen-wiki-board.mjs 不存在（旧装户），跳过归档计数随动');
  }
  console.log('\n下一步（人工）：读草稿 → 归类到 wiki/<主题>/ → 补主题与用途 → 跑 gen-wiki-board + verify-wiki-consistency');
}
