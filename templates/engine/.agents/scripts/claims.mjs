#!/usr/bin/env node
// claims.mjs — 主张账（workflow/claims.d/<YYYY-MM>.jsonl）
// 一条主张 = 未来会话可能当真的一句话 + 仓库里已经存在的原文片段。
// 脚本只回答原文还在不在：held = quote 仍在文件中，broken = 文件消失或 quote 已不在。
// 原文还在不等于主张为真。核对只报告，退出码恒 0，不改正文、不改历史行。
//
// 用法：
//   flow-kit run claims.mjs add --claim "..." --path <相对路径> --quote "..."
//   flow-kit run claims.mjs recheck
// 库：addClaim({ root, claim, path, quote, now }) / recheckClaims(root)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const QUOTE_MIN = 8;
const QUOTE_MAX = 200;
const CLAIM_MAX = 400;

export function addClaim({ root, claim, path: rel, quote, now = new Date() }) {
  const text = requireClaim(claim);
  const snippet = requireQuote(quote);
  const target = resolveRel(root, rel);
  const body = readNorm(target.abs);
  if (!body.includes(norm(snippet))) {
    throw new Error('quote 不在文件中，拒绝写入');
  }
  const row = {
    ts: now.toISOString(),
    id: `c-${crypto.randomBytes(4).toString('hex')}`,
    claim: text,
    path: target.rel,
    quote: snippet,
  };
  const dir = path.join(path.resolve(root), 'workflow', 'claims.d');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${row.ts.slice(0, 7)}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  return row;
}

export function recheckClaims(root) {
  const dir = path.join(path.resolve(root), 'workflow', 'claims.d');
  const results = [];
  if (!fs.existsSync(dir)) return { held: 0, broken: 0, results };
  const files = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort();
  for (const name of files) {
    const raw = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      results.push(checkLine(root, line));
    }
  }
  const held = results.filter((r) => r.status === 'held').length;
  return { held, broken: results.length - held, results };
}

function checkLine(root, line) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return { id: '(malformed)', path: '', claim: '', status: 'broken', reason: 'malformed' };
  }
  const id = typeof row.id === 'string' ? row.id : '(malformed)';
  const claim = typeof row.claim === 'string' ? row.claim : '';
  const rel = typeof row.path === 'string' ? row.path : '';
  const quote = typeof row.quote === 'string' ? row.quote : '';
  if (!rel || !quote) {
    return { id, path: rel, claim, status: 'broken', reason: 'malformed' };
  }
  let abs;
  try {
    abs = resolveRel(root, rel).abs;
  } catch {
    return { id, path: rel, claim, status: 'broken', reason: 'file-missing' };
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { id, path: rel, claim, status: 'broken', reason: 'file-missing' };
  }
  if (!readNorm(abs).includes(norm(quote))) {
    return { id, path: rel, claim, status: 'broken', reason: 'quote-missing' };
  }
  return { id, path: rel, claim, status: 'held', reason: 'quote-present' };
}

function requireClaim(claim) {
  if (typeof claim !== 'string' || claim.trim() === '' || Array.from(claim).length > CLAIM_MAX) {
    throw new Error('claim 须为一句非空文本（不超过 400 字）');
  }
  return claim;
}

function requireQuote(quote) {
  if (typeof quote !== 'string') throw new Error(`quote 须为 ${QUOTE_MIN} 到 ${QUOTE_MAX} 字`);
  const n = Array.from(quote).length;
  if (n < QUOTE_MIN || n > QUOTE_MAX) {
    throw new Error(`quote 须为 ${QUOTE_MIN} 到 ${QUOTE_MAX} 字`);
  }
  return quote;
}

function resolveRel(root, rel) {
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel)) {
    throw new Error('path 须为相对路径');
  }
  const posix = rel.replace(/\\/g, '/');
  if (posix.split('/').includes('..')) throw new Error('path 禁止 ..');
  const lower = posix.toLowerCase();
  if (lower === 'tmp' || lower.startsWith('tmp/') || lower === '.agents/cache' || lower.startsWith('.agents/cache/')) {
    throw new Error('path 禁止落在 tmp/ 或 .agents/cache/');
  }
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, rel);
  const back = path.relative(rootAbs, abs);
  if (back.startsWith('..') || path.isAbsolute(back)) throw new Error('path 须留在仓库内');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('path 不是已存在的文件');
  return { abs, rel: posix };
}

function norm(s) {
  return s.replace(/\r\n/g, '\n');
}

function readNorm(abs) {
  return norm(fs.readFileSync(abs, 'utf8'));
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const root = arg('--root') || process.env.CHECK_LOOP_ROOT || process.cwd();
  const cmd = process.argv[2];
  try {
    if (cmd === 'add') {
      const row = addClaim({
        root,
        claim: arg('--claim'),
        path: arg('--path'),
        quote: arg('--quote'),
      });
      console.log(row.id);
      return;
    }
    if (cmd === 'recheck') {
      const report = recheckClaims(root);
      console.log(`held ${report.held}`);
      console.log(`broken ${report.broken}`);
      for (const row of report.results) {
        if (row.status === 'broken') console.log(`broken ${row.id} ${row.path}: ${row.reason}`);
      }
      return;
    }
    console.error('用法: claims.mjs add --claim --path --quote | claims.mjs recheck');
    process.exit(2);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();
