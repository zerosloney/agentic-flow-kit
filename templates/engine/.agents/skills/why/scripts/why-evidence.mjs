#!/usr/bin/env node
// why-evidence.mjs — /why 的本地证据收集器（2026-10-22 pstack 借鉴）
// 用法：node .agents/skills/why/scripts/why-evidence.mjs <term> [--path <file>] [--json]
// 收集：git pickaxe（-S）、路径历史（--follow）、workflow 文档命中、wiki 命中、kb-search 摘要。
// 不做结论——结论由 why 技能合成；本脚本只保证证据面一致、可复跑、可对质。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let term = '';
let pathArg = '';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--path') { pathArg = argv[++i] || ''; continue; }
  if (argv[i] === '--json') continue;
  if (!term) term = argv[i];
}
const asJson = argv.includes('--json');
if (!term) {
  console.error('用法：node .agents/skills/why/scripts/why-evidence.mjs <term> [--path <file>] [--json]');
  process.exit(2);
}

const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
const ROOT = root.status === 0 && root.stdout.trim() ? root.stdout.trim() : process.cwd();
process.chdir(ROOT);

const git = (args) => spawnSync('git', args, { encoding: 'utf8' });
const lines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const pickaxe = lines(git(['log', '-S', term, '--oneline', '--all', '-n', '20']).stdout);
const pathHistory = pathArg ? lines(git(['log', '--oneline', '--follow', '-n', '10', '--', pathArg]).stdout) : [];

// 文档命中：只取每个文件的第一处，限 20 条；跳过生成物（verify-evidence / INDEX / metrics）。
const scan = (dir, limit = 20) => {
  const out = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^(node_modules|\.git)$/.test(e.name)) walk(p); continue; }
      if (!/\.md$/i.test(e.name)) continue;
      if (/^(verify-evidence|INDEX|metrics)\.md$/.test(e.name)) continue;
      let text = '';
      try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
      const rows = text.split(/\r?\n/);
      const hit = rows.findIndex((l) => l.toLowerCase().includes(term.toLowerCase()));
      if (hit >= 0) out.push(`${path.relative(ROOT, p).replace(/\\/g, '/')}:${hit + 1}: ${rows[hit].trim().slice(0, 160)}`);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
};
const workflow = scan('workflow');
const wiki = scan('wiki');

const kb = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'kb-search.mjs'), term, '-n', '5'], { cwd: ROOT, encoding: 'utf8' });
const kbOut = String(kb.stdout || '').trim();

if (asJson) {
  console.log(JSON.stringify({ term, path: pathArg || null, pickaxe, pathHistory, workflow, wiki, kb: kbOut }, null, 2));
  process.exit(0);
}
const section = (title, rows) => `## ${title}\n${rows.length ? rows.map((r) => `- ${r}`).join('\n') : '（无命中）'}`;
console.log(`# why evidence: ${term}${pathArg ? `（path: ${pathArg}）` : ''}\n`);
console.log(section('git pickaxe（-S：增删过该词的提交）', pickaxe));
if (pathArg) console.log(`\n${section('路径历史（--follow）', pathHistory)}`);
console.log(`\n${section('workflow 文档命中', workflow)}`);
console.log(`\n${section('wiki 命中', wiki)}`);
console.log(`\n## kb-search\n${kbOut || '（无输出）'}`);
