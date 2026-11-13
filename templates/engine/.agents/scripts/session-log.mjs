#!/usr/bin/env node
// session-log.mjs — 会话经验日志（给 dreaming 的输入）
//
// 背景（Anthropic《The components of agent memory》）：dreaming 之所以能纠错，
// 是因为它能把记忆笔记与**原始会话记录**对照。git 历史只是工件历史，不是经验。
//
// 本脚本只做最小、可丢弃、可重建的事：
//   - append：把显著事件（决策 / 失败 / 纠正 / 拒绝 / 备注）追加到
//     `.agents/cache/session-logs/<YYYY-MM-DD>.jsonl`（gitignore，运行态）；
//   - digest：按天聚合成一份紧凑摘要，交给 dream-run 的“经验回放”阶段；
//   - 不自动 commit / push，不读宿主私有 transcript。
//
// 用法：
//   flow-kit run session-log.mjs append --type failure --text "..." [--ref path] [--tag x]
//   flow-kit run session-log.mjs digest [--days 7] [--out tmp/session-digest-<date>.md]
//   flow-kit run session-log.mjs list [--days 7] [--json]
//
// 事件类型闭集：decision / failure / correction / refusal / note
import fs from 'node:fs';
import path from 'node:path';

export const TYPES = ['decision', 'failure', 'correction', 'refusal', 'note'];

export function logsDir(root) {
  return path.join(root, '.agents', 'cache', 'session-logs');
}

function dayOf(iso) {
  return String(iso).slice(0, 10);
}

export function appendEvent(root, { type, text, ref = '', tag = '', now = new Date() } = {}) {
  const kind = String(type || '').trim();
  if (!TYPES.includes(kind)) throw new Error(`未知事件类型：${kind}（允许 ${TYPES.join('/')}）`);
  const body = String(text || '').trim();
  if (!body) throw new Error('--text 不能为空');
  const row = {
    ts: now.toISOString(),
    type: kind,
    text: body,
    ref: String(ref || ''),
    tag: String(tag || ''),
  };
  const dir = logsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${dayOf(row.ts)}.jsonl`), `${JSON.stringify(row)}\n`);
  return row;
}

export function readEvents(root, { days = 7, now = new Date() } = {}) {
  const dir = logsDir(root);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort();
  } catch {
    return [];
  }
  const cutoff = now.getTime() - days * 86400000;
  const out = [];
  for (const name of names) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const t = Date.parse(row.ts);
      if (Number.isFinite(t) && t >= cutoff) out.push(row);
    }
  }
  return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

export function digestEvents(events, { days = 7, maxPerType = 8 } = {}) {
  const lines = [];
  lines.push(`# 会话经验摘要（近 ${days} 天）`);
  lines.push('');
  if (!events.length) {
    lines.push('_无会话日志输入。dreaming 只能审计工件，无法用经验纠错。_');
    lines.push('');
    lines.push('在关键节点执行：`flow-kit run session-log.mjs append --type failure --text "…"`');
    return `${lines.join('\n')}\n`;
  }
  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  lines.push(`共 ${events.length} 条：${TYPES.map((t) => `${t}=${counts[t] || 0}`).join(' / ')}`);
  lines.push('');
  for (const type of TYPES) {
    const rows = events.filter((e) => e.type === type);
    if (!rows.length) continue;
    lines.push(`## ${type}`);
    for (const e of rows.slice(-maxPerType)) {
      const ref = e.ref ? ` · \`${e.ref}\`` : '';
      const tag = e.tag ? ` · [${e.tag}]` : '';
      lines.push(`- ${dayOf(e.ts)} ${e.text}${ref}${tag}`);
    }
    if (rows.length > maxPerType) lines.push(`- …另有 ${rows.length - maxPerType} 条（见原始日志）`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

// ---- CLI ----
function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'digest';
  const root = path.resolve(argOf(argv, 'root', process.cwd()));

  if (cmd === 'append') {
    const row = appendEvent(root, {
      type: argOf(argv, 'type', 'note'),
      text: argOf(argv, 'text', ''),
      ref: argOf(argv, 'ref', ''),
      tag: argOf(argv, 'tag', ''),
    });
    console.log(`logged ${row.type} @ ${row.ts}`);
    return 0;
  }

  const days = Number(argOf(argv, 'days', 7)) || 7;
  const events = readEvents(root, { days });
  if (cmd === 'list') {
    if (argv.includes('--json')) console.log(JSON.stringify(events, null, 2));
    else for (const e of events) console.log(`${e.ts}\t${e.type}\t${e.text}${e.ref ? `\t${e.ref}` : ''}`);
    return 0;
  }

  const md = digestEvents(events, { days });
  const outArg = argOf(argv, 'out');
  if (outArg && outArg !== true) {
    const out = path.resolve(root, outArg);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md, 'utf8');
    console.log(out);
  } else {
    process.stdout.write(md);
  }
  return 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('session-log.mjs');
if (isMain) process.exit(main());
