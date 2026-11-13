#!/usr/bin/env node
// closeout.mjs — 关单序列串接（closeout-skill-hardening 2026-11-08）
// 把 .agents/skills/shipyard-workflow-closeout/SKILL.md §3–§5 的固定三步收成一次调用：
//   ① confirm-doc 落终态 → ② gen-workflow-index 重生成 → ③ git add 固定路径清单 → ④ commit。
// 动机：三步顺序与路径清单每次相同，手工逐条跑时漏 add 分片 / 夹带无关文件是高发段；收成入口后
// 技能正文从操作手册缩成调用 + 判据。提交一律不用 --no-verify（钩子照常跑）。
// 幂等 / 恢复：任一步失败即停并报「从哪一步重入」；重跑时已到终态（done/closed/cancelled/superseded）
// 的文档跳过 confirm，index 生成器幂等，无暂存改动则跳过 commit。
// 安全边界：commit 前核对暂存区只有候选路径——存在外来暂存路径即拒绝提交，不夹带用户其它在途改动。
// 用法：flow-kit run closeout.mjs <workflow/.../x.md> --delegated "<用户对话原话>"
//         [--msg "<提交主题>"] [--root <仓库根>] [--dry-run]
//   --dry-run 只报告当前状态 / 下一跳 / 候选路径变更，不落态、不写盘、不提交。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : ''; };
let quote = null;
let msg = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--delegated') { quote = argv[++i] ?? ''; continue; }
  if (argv[i] === '--msg') { msg = argv[++i] ?? ''; continue; }
  if (argv[i] === '--root') { i++; continue; }
  if (argv[i] === '--dry-run') continue;
  positional.push(argv[i]);
}
const DRY = argv.includes('--dry-run');
const ROOT = path.resolve(argOf('--root') || process.env.FLOW_KIT_PROJECT_ROOT || path.join(SCRIPT_DIR, '..', '..'));

const USAGE = '用法：flow-kit run closeout.mjs <workflow/{intents,specs,plans,incidents}/x.md> --delegated "<用户原话>" [--msg "<主题>"] [--root <仓库根>] [--dry-run]';
const RECOVER = (doc) => `恢复：修掉报错原因后重跑同一命令（已完成的步骤幂等跳过）：flow-kit run closeout.mjs ${doc} --delegated "<用户原话>" [--msg "<主题>"]`;
if (positional.length !== 1) { console.error(`❌ 需且仅需一份文档\n${USAGE}`); process.exit(1); }
const doc = positional[0].replace(/\\/g, '/');
if (!/^workflow\/(intents|specs|plans|incidents)\/[^/\\]+\.md$/.test(doc)) {
  console.error(`❌ 文档路径不合法：${doc}\n${USAGE}`); process.exit(1);
}
const abs = path.join(ROOT, doc);
if (!fs.existsSync(abs)) { console.error(`❌ 文档不存在：${abs}`); process.exit(1); }

const base = path.basename(doc, '.md');
const candidates = [
  doc,
  'workflow/INDEX.md',
  'workflow/verify-evidence.md',
  `.agents/confirmations.d/${base}.jsonl`,
  '.agents/confirmations.jsonl',
];
const TERMINAL = ['done', 'closed', 'cancelled', 'superseded'];
function statusOf() {
  const nl = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
  if (!/^---\s*$/.test(nl[0] || '')) return '';
  for (let i = 1; i < nl.length && !/^---\s*$/.test(nl[i]); i++) {
    const m = nl[i].match(/^状态:\s*(.*)$/);
    if (m) return m[1].trim();
  }
  return '';
}
function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}
function porcelain(args) {
  const r = git(args);
  if (r.status !== 0) return [];
  return String(r.stdout || '').split(/\r?\n/)
    .map((l) => l.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, '').replace(/\\/g, '/'))
    .filter(Boolean);
}
// git diff --name-only 输出是纯路径（无 XY 前缀），不能走 porcelain 的 slice(3)。
function nameOnly(args) {
  const r = git(args);
  if (r.status !== 0) return [];
  return String(r.stdout || '').split(/\r?\n/)
    .map((l) => l.trim().replace(/^"|"$/g, '').replace(/\\/g, '/'))
    .filter(Boolean);
}
function run(label, args, opts = {}) {
  const r = spawnSync(opts.cmd || process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  if (r.status !== 0) {
    console.error(`❌ 步骤 ${label} 失败（exit ${r.status}）:\n${out}`);
    console.error(RECOVER(doc));
    process.exit(r.status || 1);
  }
  if (out) console.log(out);
}
const st = statusOf();
const terminal = TERMINAL.includes(st);
console.log(`[closeout] ${doc}：当前状态 ${st || '缺失'}${terminal ? '（终态，跳过代录）' : '（待代录）'}`);
if (DRY) {
  console.log('[closeout] --dry-run：不落态、不写盘、不提交');
  console.log(`[closeout] 候选路径变更：${porcelain(['status', '--porcelain', '--', ...candidates]).join('、') || '(无)'}`);
  console.log(`[closeout] 暂存区路径：${nameOnly(['diff', '--cached', '--name-only']).join('、') || '(无)'}`);
  process.exit(0);
}
// ① 代录终态（状态行只由 confirm-doc.mjs 改；incident 两跳各跑一次本脚本）
if (!terminal) {
  if (quote === null) { console.error(`❌ 代录须 --delegated "<用户对话原话>"\n${USAGE}`); process.exit(1); }
  run('① confirm-doc', [path.join(SCRIPT_DIR, 'confirm-doc.mjs'), doc, '--delegated', quote, '--root', ROOT]);
} else {
  console.log('[closeout] ① 已是终态，跳过 confirm-doc（幂等重入）');
}
// ② 索引（生成器按磁盘重写 GENERATED 区，幂等）
run('② gen-workflow-index', [path.join(SCRIPT_DIR, 'gen-workflow-index.mjs')]);
// ③ git add 固定路径清单（只 add 有变更的候选）
const changed = porcelain(['status', '--porcelain', '--', ...candidates]);
if (changed.length) run('③ git add', ['add', '--', ...changed], { cmd: 'git' });
else console.log('[closeout] ③ 候选路径无变更，跳过 git add');
// 提交前安全边界：暂存区若有候选清单之外的路径，拒绝提交（用户其它在途改动须自己提交）
const staged = nameOnly(['diff', '--cached', '--name-only']);
const foreign = staged.filter((p) => !candidates.includes(p));
if (foreign.length) {
  console.error(`❌ 步骤 ④ 拒绝提交：暂存区有本序列之外的路径（${foreign.slice(0, 5).join('、')}${foreign.length > 5 ? '…' : ''}）——不夹带其它在途改动`);
  console.error(`   先单独提交或撤销这些路径，再重跑（本次已落态与索引，重跑幂等跳过）\n${RECOVER(doc)}`);
  process.exit(1);
}
if (!staged.length) {
  console.log('[closeout] ④ 暂存区无改动（可能已提交），跳过 commit——关单完成');
  process.exit(0);
}
console.log(`[closeout] 待提交：${staged.join('、')}`);
const subject = msg || `docs(workflow): ${base} 关单`;
run('④ git commit', ['commit', '-m', subject], { cmd: 'git' });
console.log(`[closeout] ✅ 关单提交完成：${subject}`);
