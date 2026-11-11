#!/usr/bin/env node
// parity-report — 对比 kit 模板与指定项目现行引擎/宿主/git 面，确认迁移覆盖面。
// 只读；输出摘要与差异首行，不打印全文。
// 用法：node tools/parity-report.mjs --project <项目根>（或 AGENTIC_FLOW_PROJECT）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const KIT = path.resolve(import.meta.dirname, '..');
// kit 独立于项目仓：项目根由 --project / AGENTIC_FLOW_PROJECT 指定，缺省当前工作目录。
const argProject = (() => {
  const i = process.argv.indexOf('--project');
  return i >= 0 ? process.argv[i + 1] : '';
})();
const ROOT = path.resolve(argProject || process.env.AGENTIC_FLOW_PROJECT || process.cwd());
const T = path.join(KIT, 'templates');

const HOST_DIRS = {
  trae: '.trae',
  codebuddy: '.codebuddy',
  claude: '.claude',
  opencode: '.opencode',
  qwen: '.qwen',
  pi: '.pi',
  cline: '.cline',
  commandcode: '.commandcode',
  qoder: '.qoder',
  zcode: '.zcode',
};

function walk(dir, rel = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const childAbs = path.join(dir, ent.name);
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walk(childAbs, childRel));
    else if (ent.isFile()) out.push(childRel);
  }
  return out;
}

const pairs = [];
for (const rel of walk(path.join(T, 'engine'))) {
  pairs.push({ label: rel, tpl: path.join(T, 'engine', rel), cur: path.join(ROOT, rel) });
}
for (const rel of walk(path.join(T, 'profiles', 'dotnet'))) {
  pairs.push({ label: `[profile] ${rel}`, tpl: path.join(T, 'profiles', 'dotnet', rel), cur: path.join(ROOT, rel) });
}
for (const host of Object.keys(HOST_DIRS)) {
  for (const rel of walk(path.join(T, 'hosts', host))) {
    const targetRel = host === 'claude' && rel === 'CLAUDE.md' ? 'CLAUDE.md' : `${HOST_DIRS[host]}/${rel}`;
    pairs.push({ label: `${host}: ${targetRel}`, tpl: path.join(T, 'hosts', host, rel), cur: path.join(ROOT, targetRel) });
  }
}
for (const rel of walk(path.join(T, 'git', '.githooks'))) {
  pairs.push({ label: `.githooks/${rel}`, tpl: path.join(T, 'git', '.githooks', rel), cur: path.join(ROOT, '.githooks', rel) });
}

const identical = [];
const different = [];
const missingCurrent = [];
for (const p of pairs) {
  if (p.tpl.endsWith('.gitkeep')) continue;
  if (!fs.existsSync(p.cur)) {
    missingCurrent.push(p.label);
    continue;
  }
  const a = fs.readFileSync(p.tpl);
  const b = fs.readFileSync(p.cur);
  if (a.equals(b)) identical.push(p.label);
  else {
    const al = a.toString('utf8').split(/\r?\n/);
    const bl = b.toString('utf8').split(/\r?\n/);
    let i = 0;
    while (i < Math.min(al.length, bl.length) && al[i] === bl[i]) i += 1;
    different.push({ label: p.label, line: i + 1, tpl: (al[i] || '').slice(0, 100), cur: (bl[i] || '').slice(0, 100) });
  }
}

const EXCLUDE_RE = [
  /^\.agents\/cache\//,
  /^\.agents\/tmp\//,
  /^\.agents\/tools\//,
  /^\.agents\/confirmations\.d\//,
  /^\.agents\/(confirmations|judgments|verifications)\.jsonl$/,
  /^\.agents\/notes\/runtime-env\.local\.md$/,
  /^\.agents\/notes\/engine-map\.md$/,
  /^\.agents\/notes\/mto-pml-review-followups\.md$/,
  /^\.agents\/config\/model-roles\.local\.json$/,
  // 项目特性地图是装户业务数据，随技能目录但不进通用引擎模板。
  /^\.agents\/skills\/verify-ui\/features\/(?!\.gitkeep$)/,
];
const PROFILE_MOVED = new Set([
  'test-impact-map.json',
  'lane-surfaces.txt',
  'rule-budgets.txt',
  'workflow-modules.txt',
  'ledger-prune-manifest.json',
  'ledger-rebuild-manifest.json',
  'commit-check.config.json',
  'delete-guard-allowlist.txt',
]);

let tracked = [];
try {
  tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '.agents'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
} catch {
  tracked = [];
}
const covered = new Set(pairs.map((p) => p.label.replace(/^[^:]+: /, '').replace(/^\[profile\] /, '')));
const uncovered = tracked.filter((f) => {
  if (EXCLUDE_RE.some((re) => re.test(f))) return false;
  if (PROFILE_MOVED.has(path.basename(f))) return false;
  return !covered.has(f);
});

console.log('PARITY REPORT');
console.log(`  pairs: ${pairs.length}`);
console.log(`  identical: ${identical.length}`);
console.log(`  different: ${different.length}`);
console.log(`  missing in current: ${missingCurrent.length}`);
for (const d of different) console.log(`  ! ${d.label} (line ${d.line}) tpl=${JSON.stringify(d.tpl)} cur=${JSON.stringify(d.cur)}`);
for (const m of missingCurrent) console.log(`  ? ${m} (current missing)`);
console.log(`  current .agents tracked not covered by templates: ${uncovered.length}`);
for (const f of uncovered.slice(0, 60)) console.log(`  - ${f}`);
if (uncovered.length > 60) console.log(`  ... ${uncovered.length - 60} more`);

process.exit(uncovered.length ? 1 : 0);
