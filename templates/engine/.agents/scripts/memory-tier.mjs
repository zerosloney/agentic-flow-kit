#!/usr/bin/env node
// memory-tier.mjs — 注入层预算 + 记忆升降候选
//
// 背景（Anthropic《The components of agent memory》）：
//   - 顶层记忆会被注入每个会话，必须小；Claude Code 只加载 MEMORY.md 前 200 行 / 25KB。
//   - dreaming 的职责之一是“把细节下沉、把该上浮的规则上浮”，而不是持续变大。
//
// 本脚本：
//   audit   检查注入层是否超行/字节预算（超限非零）
//   suggest 从错题/会话经验/主张里找重复模式，输出“可考虑上浮”的候选（只读）
//   budget  打印当前用量
//
// 用法：
//   flow-kit run memory-tier.mjs audit
//   flow-kit run memory-tier.mjs suggest [--days 90] [--min 3]
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  version: 1,
  injected: { file: '.agents/notes/injected-memory.md', maxLines: 200, maxBytes: 25600 },
  promotion: { candidates: '.agents/cache/memory-promotions.jsonl', minOccurrences: 3, outputDir: 'tmp' },
};

export function loadConfig(root) {
  const file = path.join(root, '.agents', 'config', 'memory-tiers.json');
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function auditBudget(root, cfg = loadConfig(root)) {
  const rel = cfg.injected.file;
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return { ok: false, reason: 'missing', rel, lines: 0, bytes: 0, cfg };
  const text = fs.readFileSync(abs, 'utf8');
  const lines = text.split(/\r?\n/).length;
  // 字节口径与 rule-budget 一致：LF 归一，避免 CRLF 虚高。
  const bytes = Buffer.byteLength(text.replace(/\r\n/g, '\n'), 'utf8');
  const overLines = lines > cfg.injected.maxLines;
  const overBytes = bytes > cfg.injected.maxBytes;
  return {
    ok: !overLines && !overBytes,
    reason: overLines ? 'over-lines' : overBytes ? 'over-bytes' : 'ok',
    rel,
    lines,
    bytes,
    maxLines: cfg.injected.maxLines,
    maxBytes: cfg.injected.maxBytes,
    cfg,
  };
}

function readJsonl(dir, re) {
  const rows = [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => re.test(n)).sort();
  } catch {
    return rows;
  }
  for (const name of names) {
    let raw = '';
    try {
      raw = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      continue;
    }
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

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 候选来源：会话失败/纠正、错题 tag、主张中的重复主题。
export function suggestPromotions(root, { days = 90, min = null, now = new Date() } = {}) {
  const cfg = loadConfig(root);
  const floor = Number(min) || cfg.promotion.minOccurrences;
  const cutoff = now.getTime() - days * 86400000;
  const buckets = new Map();
  const add = (key, source, sample) => {
    const k = norm(key);
    if (!k || k.length < 4) return;
    if (!buckets.has(k)) buckets.set(k, { key: k, count: 0, sources: new Set(), samples: [] });
    const b = buckets.get(k);
    b.count += 1;
    b.sources.add(source);
    if (sample && b.samples.length < 3) b.samples.push(sample);
  };

  const sessions = readJsonl(path.join(root, '.agents', 'cache', 'session-logs'), /^\d{4}-\d{2}-\d{2}\.jsonl$/)
    .filter((e) => ['failure', 'correction', 'refusal'].includes(e.type))
    .filter((e) => !e.ts || Date.parse(e.ts) >= cutoff);
  for (const e of sessions) add(e.tag || e.text, 'session-log', e.text);

  const papercuts = readJsonl(path.join(root, 'workflow', 'papercuts.d'), /\.(jsonl|json)$/)
    .filter((e) => !e.ts || Date.parse(e.ts) >= cutoff);
  for (const e of papercuts) add(e.tag || e.kind || e.text, 'papercut', e.text);

  const claims = readJsonl(path.join(root, 'workflow', 'claims.d'), /^\d{4}-\d{2}\.jsonl$/)
    .filter((e) => !e.ts || Date.parse(e.ts) >= cutoff);
  for (const e of claims) {
    const topic = String(e.path || '').split(/[\\/]/)[0];
    add(topic || e.claim, 'claim', e.claim);
  }

  return [...buckets.values()]
    .filter((b) => b.count >= floor)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map((b) => ({ key: b.key, count: b.count, sources: [...b.sources].sort(), samples: b.samples }));
}

export function writeSuggestion(root, candidates, { days = 90, cfg = loadConfig(root), now = new Date() } = {}) {
  const dir = path.join(root, cfg.promotion.outputDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `memory-tier-suggest-${now.toISOString().slice(0, 10)}.md`);
  const lines = [
    `# 记忆上浮候选（近 ${days} 天）`,
    '',
    '> 只出候选，不自动改写注入层。裁决后手工改 `.agents/notes/injected-memory.md`，',
    '> 并保持 200 行 / 25KB 预算；下沉详情用链接。',
    '',
  ];
  if (!candidates.length) lines.push('_无达到阈值的重复模式。_');
  else {
    lines.push('| 候选 | 次数 | 来源 | 样本 |');
    lines.push('|---|---|---|---|');
    for (const c of candidates) {
      lines.push(`| ${c.key.replace(/\|/g, '\\|')} | ${c.count} | ${c.sources.join(', ')} | ${c.samples[0]?.replace(/\|/g, '\\|') || ''} |`);
    }
  }
  lines.push('');
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'audit';
  const root = path.resolve(argOf(argv, 'root', process.cwd()));
  const cfg = loadConfig(root);

  if (cmd === 'audit') {
    const res = auditBudget(root, cfg);
    if (!res.ok) {
      console.error(`✗ 注入层 ${res.reason}: ${res.rel} (${res.lines}/${cfg.injected.maxLines} 行, ${res.bytes}/${cfg.injected.maxBytes} 字节)`);
      return 1;
    }
    console.log(`✅ 注入层预算: ${res.lines}/${cfg.injected.maxLines} 行, ${res.bytes}/${cfg.injected.maxBytes} 字节`);
    return 0;
  }

  if (cmd === 'suggest') {
    const days = Number(argOf(argv, 'days', 90)) || 90;
    const min = Number(argOf(argv, 'min', 0)) || null;
    const candidates = suggestPromotions(root, { days, min });
    const file = writeSuggestion(root, candidates, { days, cfg });
    console.log(`${file}（${candidates.length} 个候选）`);
    return 0;
  }

  if (cmd === 'budget') {
    const res = auditBudget(root, cfg);
    console.log(`lines=${res.lines} bytes=${res.bytes} maxLines=${cfg.injected.maxLines} maxBytes=${cfg.injected.maxBytes} ok=${res.ok}`);
    return res.ok ? 0 : 1;
  }

  console.error('用法: memory-tier.mjs audit | suggest [--days N] [--min N] | budget');
  return 2;
}

const isMain = process.argv[1] && process.argv[1].endsWith('memory-tier.mjs');
if (isMain) process.exit(main());
