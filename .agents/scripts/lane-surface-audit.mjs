#!/usr/bin/env node
// lane-surface-audit.mjs — L2 触达面闭集防漂移审计（advisory 工具，恒 exit 0；2026-10-13 自
//   Shipyard.Material 参考实现回灌，源仓沿革留痕在包源仓 git 历史与 CHANGELOG——装户径不引实例路径）
// 问题：lane-surfaces.txt 的 ERE 闭集靠人工维护——新共享契约面若未登记，判低拦截对新面静默失效。
//   本审计反着问：**近窗口内 L2/L3 任务实际反复触及、却无任何文件被面清单命中的目录** = 候选漏登面，
//   供人工评估补登（不建议自动写清单——高频触及 ≠ 契约面，机器不猜语义）。
// 归因代理：提交触及某入口/事故文档的提交 = 该任务的落地提交（三件套随代码同一提交纪律），
//   取这些提交里的代码文件（剔 workflow/、.agents/、.githooks/、wiki/、根 AGENTS.md）作「任务触及面」。
//   已知粗度：任务中途未触文档的纯代码提交会被漏计（审计低招，不是执法——宁可漏报不误报）。
// 判据：目录签名（dirname 前 3 段）被 ≥ --min（默认 3）个**不同** L2/L3 文档触及，且该签名下
//   观测到的文件无一命中 ERE → 候选。被命中的文件所在目录不进候选（已覆盖）。
// 用法：node .agents/scripts/lane-surface-audit.mjs [--since <YYYY-MM-DD>] [--min <N>] [--root <dir>]
//   --since 缺省 = 今天−30 天。输出候选清单；无候选打印一行「无漂移信号」。
// 时机：月度手跑（登记位 = .agents/lane-surfaces.txt 文件头）；改共享契约频繁期可随时手跑。
// 测试：node .agents/scripts/lane-surface-audit.test.mjs（git fixture 注入）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
};
const ROOT = argOf('--root') || (() => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim() : '';
})() || process.cwd();
const SINCE = argOf('--since') || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
const MIN = Number(argOf('--min')) || 3;

const gitOut = (args) => {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '') : '';
};

// 面清单（解析同 check-lane-surface.mjs：逐行 ERE，# 注释与空行忽略——段标题行同为注释，不参与命中）
const loadPatterns = () => {
  const file = path.join(ROOT, '.agents', 'lane-surfaces.txt');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => { try { return new RegExp(l); } catch { return null; } })
    .filter(Boolean);
};
const patterns = loadPatterns();
const isCovered = (p) => patterns.some((re) => re.test(p));

// frontmatter 读取（CRLF 容忍，同 check-lane-surface.fmOf）
const fmOf = (file) => {
  const fm = {};
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return fm; }
  if (!/^---\s*$/.test(lines[0] || '')) return fm;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) break;
    const m = lines[i].match(/^([^:]+):\s*(.*)$/);
    if (m) fm[m[1].trim()] = m[2].trim();
  }
  return fm;
};

// 1) 窗口内 L2/L3 文档（任何状态——审计覆盖已关单历史；日期键 intent=日期 / incident=发现）
const docs = [];
for (const [dir, dateKey] of [['intents', '日期'], ['incidents', '发现']]) {
  const dirPath = path.join(ROOT, 'workflow', dir);
  if (!fs.existsSync(dirPath)) continue;
  for (const f of fs.readdirSync(dirPath).sort()) {
    if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
    const fm = fmOf(path.join(dirPath, f));
    if ((fm['级别'] || '') !== 'L2' && (fm['级别'] || '') !== 'L3') continue;
    if ((fm[dateKey] || '') < SINCE) continue;
    docs.push(`workflow/${dir}/${f}`);
  }
}
if (!docs.length) {
  console.log(`[lane-audit] 窗口（${SINCE} 起）内无 L2/L3 文档——无审计面。`);
  process.exit(0);
}

// 2) 一遍 git log 取 (commit → files) 与文档↔提交关联（--name-only 块解析；doc 路径含非 ASCII 须 quotepath=off）
const log = gitOut(['log', '--name-only', '--format=%H', '--', ...docs]);
if (!log) {
  console.error('[lane-audit] git log 不可用（非 git 环境或无历史）——跳过审计。');
  process.exit(0);
}
const filesByDoc = new Map(); // doc → Set(代码文件)
let commit = '';
const commitsForDoc = new Map(); // doc → Set(commit)
for (const line of log.split(/\r?\n/)) {
  if (!line.trim()) continue;
  if (/^[0-9a-f]{40}$/.test(line)) { commit = line; continue; }
  const p = line.replace(/"/g, ''); // quotepath=off 已关转义，防御性去引号
  if (docs.includes(p)) {
    if (!commitsForDoc.has(p)) commitsForDoc.set(p, new Set());
    commitsForDoc.get(p).add(commit);
  }
}
for (const [doc, commits] of commitsForDoc) {
  const set = new Set();
  for (const c of commits) {
    for (const f of gitOut(['show', '--name-only', '--format=', c]).split(/\r?\n/).filter(Boolean)) {
      const fp = f.replace(/"/g, '');
      if (/^(workflow|\.agents|\.githooks|wiki)\//.test(fp) || /\.md$/.test(fp) || fp === 'AGENTS.md') continue;
      set.add(fp);
    }
  }
  filesByDoc.set(doc, set);
}

// 3) 目录签名聚合（dirname 前 3 段）；仅聚合「未被 ERE 命中」的文件；按不同文档数计
const sigOf = (fp) => {
  const parts = path.posix.dirname(fp.replace(/\\/g, '/')).split('/');
  return parts.slice(0, 3).join('/');
};
const docsBySig = new Map(); // sig → Set(doc)
const samplesBySig = new Map(); // sig → Set(file)
for (const [doc, files] of filesByDoc) {
  for (const fp of files) {
    if (isCovered(fp)) continue;
    const sig = sigOf(fp);
    if (!docsBySig.has(sig)) { docsBySig.set(sig, new Set()); samplesBySig.set(sig, new Set()); }
    docsBySig.get(sig).add(doc);
    samplesBySig.get(sig).add(fp);
  }
}
const candidates = [...docsBySig.entries()]
  .filter(([, ds]) => ds.size >= MIN)
  .sort((a, b) => b[1].size - a[1].size);

if (!candidates.length) {
  console.log(`[lane-audit] ✅ 无漂移信号——窗口（${SINCE} 起）${docs.length} 份 L2/L3 文档的反复触及目录均被面清单覆盖（或未达阈值 ${MIN}）。`);
  process.exit(0);
}
console.log(`[lane-audit] ⚠️ 候选漏登面 ${candidates.length} 个（窗口 ${SINCE} 起 / 阈值 ≥${MIN} 个不同 L2/L3 任务 / ERE 均未命中）——人工评估是否补登 .agents/lane-surfaces.txt：`);
for (const [sig, ds] of candidates) {
  const samples = [...samplesBySig.get(sig)].slice(0, 3).join(' ');
  console.log(`  - ${sig}（${ds.size} 个任务；示例 ${samples}）`);
}
console.log('  判据提醒：仅「一处定义、多处消费」的契约/规则面才应登记（判据单源 .agents/scripts/level-criteria.mjs 的 L2_SURFACES）——高频触及 ≠ 契约面。');
process.exit(0);
