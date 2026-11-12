#!/usr/bin/env node
// memory-wiki.mjs — 把“记忆”编译成可导航的表示（wiki）
//
// 背景（Anthropic《The components of agent memory》）：wiki 不是文档归档，
// 而是 dreaming 增量构建的“记忆地图”——页面 + 链接，让智能体能遍历自己知道什么；
// 检索与 wiki 组合通常优于单独检索。
//
// 输入（存在即用）：
//   workflow/claims.d/*.jsonl          主张账（未来会话可能当真的话 + 原文出处）
//   workflow/incidents/*.md            事故复盘
//   workflow/papercuts.d/*.md          错题/纸割登记
//   .agents/cache/session-logs/*.jsonl 会话经验（failure/correction/refusal）
//
// 输出：wiki/_memory/INDEX.md + 每个主题一页（主张/事故/经验），带来源链接。
// 语义：
//   - 只写 wiki/_memory/**，不碰人工 wiki；
//   - 幂等：内容未变不写；--check 发现漂移即非零；
//   - 不自动 commit；不把 claims 的“原文还在”当成“主张为真”。
//
// 用法：
//   node .agents/scripts/memory-wiki.mjs            # 生成/更新
//   node .agents/scripts/memory-wiki.mjs --check    # 只检查是否最新
//   node .agents/scripts/memory-wiki.mjs --dry-run  # 只打印将写文件
import fs from 'node:fs';
import path from 'node:path';
import { recheckClaims } from './claims.mjs';

const OUT_DIR = path.join('wiki', '_memory');

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function listFiles(dir, re) {
  try {
    return fs.readdirSync(dir).filter((n) => re.test(n)).sort();
  } catch {
    return [];
  }
}

function slugify(s) {
  return String(s || 'general')
    .trim()
    .toLowerCase()
    .replace(/[^\w一-龥-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'general';
}

function firstHeading(text) {
  const m = String(text).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function relLink(fromRel, toRel) {
  const rel = path.relative(path.dirname(fromRel), toRel).replace(/\\/g, '/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function readClaims(root) {
  const dir = path.join(root, 'workflow', 'claims.d');
  const rows = [];
  for (const name of listFiles(dir, /^\d{4}-\d{2}\.jsonl$/)) {
    const raw = readText(path.join(dir, name));
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* ignore */
      }
    }
  }
  return rows;
}

function readSessionLessons(root) {
  const dir = path.join(root, '.agents', 'cache', 'session-logs');
  const rows = [];
  for (const name of listFiles(dir, /^\d{4}-\d{2}-\d{2}\.jsonl$/)) {
    const raw = readText(path.join(dir, name));
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (['failure', 'correction', 'refusal'].includes(row.type)) rows.push(row);
      } catch {
        /* ignore */
      }
    }
  }
  return rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

function readIncidents(root) {
  const dir = path.join(root, 'workflow', 'incidents');
  return listFiles(dir, /\.md$/).map((name) => {
    const rel = `workflow/incidents/${name}`;
    const text = readText(path.join(root, rel));
    return { name, rel, title: firstHeading(text) || name.replace(/\.md$/, ''), text };
  });
}

function readPapercuts(root) {
  const dir = path.join(root, 'workflow', 'papercuts.d');
  const out = [];
  for (const name of listFiles(dir, /\.md$/)) {
    const rel = `workflow/papercuts.d/${name}`;
    const text = readText(path.join(root, rel));
    out.push({ name, rel, title: firstHeading(text) || name, text });
  }
  const legacy = path.join(root, 'workflow', 'papercuts.md');
  if (fs.existsSync(legacy)) out.push({ name: 'papercuts.md', rel: 'workflow/papercuts.md', title: 'papercuts', text: readText(legacy) });
  return out;
}

export function buildMemoryWiki(root) {
  const files = new Map();
  const claims = readClaims(root);
  const lessons = readSessionLessons(root);
  const incidents = readIncidents(root);
  const papercuts = readPapercuts(root);

  // 主张按“出处路径的首段”聚主题；这比按时间堆叠更接近可遍历的记忆。
  const claimTopics = new Map();
  for (const c of claims) {
    const topic = slugify(String(c.path || 'general').split(/[\\/]/)[0] || 'general');
    if (!claimTopics.has(topic)) claimTopics.set(topic, []);
    claimTopics.get(topic).push(c);
  }

  const indexRel = `${OUT_DIR.replace(/\\/g, '/')}/INDEX.md`;
  const pages = [];

  if (claimTopics.size) {
    let recheck = { results: [] };
    try {
      recheck = recheckClaims(root);
    } catch {
      /* claims 账损坏时仍生成页面，只标 unknown */
    }
    const statusById = new Map((recheck.results || []).map((r) => [r.id, r.status]));
    for (const topic of [...claimTopics.keys()].sort()) {
      const rel = `${OUT_DIR.replace(/\\/g, '/')}/claims-${topic}.md`;
      const rows = claimTopics.get(topic).slice().sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      const body = [
        '---',
        `title: 主张 · ${topic}`,
        'generated: true',
        'source: workflow/claims.d',
        '---',
        '',
        `# 主张 · ${topic}`,
        '',
        '> 主张是“未来会话可能当真的一句话”。`held` 只表示原文仍在，不表示主张为真。',
        '',
        ...rows.map((r) => {
          const status = statusById.get(r.id) || 'unknown';
          const mark = status === 'broken' ? '⚠ broken' : status;
          return `- [${mark}] ${r.claim}\n  - 出处：\`${r.path}\` · \`${r.quote}\``;
        }),
        '',
      ].join('\n');
      files.set(rel, body);
      pages.push({ rel, title: `主张 · ${topic}`, count: rows.length, kind: 'claims' });
    }
  }

  if (incidents.length) {
    const rel = `${OUT_DIR.replace(/\\/g, '/')}/incidents.md`;
    const body = [
      '---',
      'title: 事故记忆',
      'generated: true',
      'source: workflow/incidents',
      '---',
      '',
      '# 事故记忆',
      '',
      ...incidents.map((i) => `- [${i.title}](${relLink(rel, i.rel)}) — \`${i.rel}\``),
      '',
    ].join('\n');
    files.set(rel, body);
    pages.push({ rel, title: '事故记忆', count: incidents.length, kind: 'incidents' });
  }

  if (lessons.length) {
    const rel = `${OUT_DIR.replace(/\\/g, '/')}/lessons.md`;
    const body = [
      '---',
      'title: 会话经验',
      'generated: true',
      'source: .agents/cache/session-logs',
      '---',
      '',
      '# 会话经验（失败 / 纠正 / 拒绝）',
      '',
      ...lessons.slice(-40).map((e) => {
        const ref = e.ref ? ` · \`${e.ref}\`` : '';
        return `- ${String(e.ts).slice(0, 10)} [${e.type}] ${e.text}${ref}`;
      }),
      '',
    ].join('\n');
    files.set(rel, body);
    pages.push({ rel, title: '会话经验', count: lessons.length, kind: 'lessons' });
  }

  if (papercuts.length) {
    const rel = `${OUT_DIR.replace(/\\/g, '/')}/papercuts.md`;
    const body = [
      '---',
      'title: 错题与纸割',
      'generated: true',
      'source: workflow/papercuts.d',
      '---',
      '',
      '# 错题与纸割',
      '',
      ...papercuts.map((p) => `- [${p.title}](${relLink(rel, p.rel)}) — \`${p.rel}\``),
      '',
    ].join('\n');
    files.set(rel, body);
    pages.push({ rel, title: '错题与纸割', count: papercuts.length, kind: 'papercuts' });
  }

  const index = [
    '---',
    'title: 记忆地图',
    'generated: true',
    'source: memory-wiki.mjs',
    '---',
    '',
    '# 记忆地图（INDEX）',
    '',
    '> 这是 dreaming 生成的**记忆表示**，不是文档归档。页面只汇总可被后续会话依赖的事实与教训；',
    '> 原文仍在各自的权威文件里。人工 wiki 不受影响。',
    '',
    pages.length ? '| 页面 | 条目 | 类型 |' : '_暂无记忆来源。先积累 claims / incidents / papercuts / session-logs。_',
    ...(pages.length ? ['|---|---|---|', ...pages.map((p) => `| [${p.title}](${relLink(indexRel, p.rel)}) | ${p.count} | ${p.kind} |`)] : []),
    '',
  ].join('\n');
  files.set(indexRel, index);

  return { files, pages, counts: { claims: claims.length, incidents: incidents.length, lessons: lessons.length, papercuts: papercuts.length } };
}

export function syncMemoryWiki(root, { check = false, dryRun = false } = {}) {
  const { files, counts } = buildMemoryWiki(root);
  const changed = [];
  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (current === content) continue;
    changed.push(rel);
    if (!check && !dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
    }
  }
  return { changed, counts, checked: check, dryRun };
}

// ---- CLI ----
function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const root = path.resolve(rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd());
  const check = argv.includes('--check');
  const dryRun = argv.includes('--dry-run');
  const res = syncMemoryWiki(root, { check, dryRun });
  const summary = `claims=${res.counts.claims} incidents=${res.counts.incidents} lessons=${res.counts.lessons} papercuts=${res.counts.papercuts}`;
  if (check) {
    if (res.changed.length) {
      console.error(`✗ memory-wiki 漂移：${res.changed.join(', ')}（${summary}）`);
      return 1;
    }
    console.log(`✅ memory-wiki 最新（${summary}）`);
    return 0;
  }
  if (dryRun) {
    console.log(`dry-run: 将写 ${res.changed.length} 个文件（${summary}）`);
    for (const rel of res.changed) console.log(`  ${rel}`);
    return 0;
  }
  console.log(`memory-wiki: 更新 ${res.changed.length} 个文件（${summary}）`);
  for (const rel of res.changed) console.log(`  ${rel}`);
  return 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('memory-wiki.mjs');
if (isMain) process.exit(main());
