#!/usr/bin/env node
// check-lane-surface.mjs — 泳道完整性门禁（pre-commit 增量；2026-10-01 drift-hardening）
// 检查 A「触达面判低」：暂存 diff 命中项目 L2 触达面（.agents/lane-surfaces.txt，ERE 逐行；
//   # 注释与空行忽略；文件缺失或清单为空 = 检查跳过，装户无感）时——
//   存在活跃 L2/L3 入口 → 放行（归因歧义为已知边界：机器不猜「哪个入口在干这批改动」）；
//   活跃入口全为 L0/L1（含级别缺失）→ hard 拦，点名最新 L0/L1 入口 + 三选修法；
//   无任何活跃入口 → 仅 advisory（docs / bootstrap 豁免类改动的合法形态）。
//   活跃 = intents draft/approved + incidents open/fixed（incident≡intent 等价口径）。
//   experiment/* 分支降级 advisory（泳道哲学：PoC 免闭环纪律，转正由 pre-push 加固门兜底）。
// 检查 B「探索标记缺失」：experiment/* 分支暂存的 workflow/intents/*.md（排除 _TEMPLATE）
//   frontmatter 无「阶段: exploring」且无「状态: exploring」（口径同 check-loop 加固门）→ hard 拦。
//   标记是加固门覆盖率的前提且补写零成本——advisory 免的是纪律负担，不免标记本身。
// 判据原则（incidents/2026-09-28-batch-ledger-audit 教训）：只用一手事实——暂存文件清单、
//   当前分支名、工作区 frontmatter 字段；不用时间戳 / 字符串相等反推过程事实。
// 边界：git 调用一律 -c core.quotepath=off（非 ASCII 路径教训，同 check-pairing-incremental.sh）；
//   frontmatter 读取容忍 CRLF（显式按 \r?\n 切分）；detached HEAD 分支不可判 → A 按 strict、
//   B 跳过（沿 pairing 门先例）；配置行正则语法错误 → fail-closed（防静默空洞）。
// 已知边界：commit-time 门禁，CI / pre-push 复跑面无对应全量检查（push 时刻无暂存 diff 一手事实，
//   树级反推违背判据原则）——沿增量门禁 pre-commit-only 先例，声明于 spec 风险评估 R2。
// 用法：node check-lane-surface.mjs [--root <dir>] [--branch <名>] [--staged-file <清单文件>]
//   （--root/--branch/--staged-file 为测试注入位；缺省自 git 发现。staged-file 每行一个仓库相对路径）
// 退出码：0 放行（含 advisory）；1 阻断（stderr 出 [标签] 消息与修法）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
};

const gitOut = (cwd, gitArgs) => {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...gitArgs], { cwd, encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '') : '';
};

const ROOT = argOf('--root') || gitOut(process.cwd(), ['rev-parse', '--show-toplevel']).trim() || process.cwd();
// detached HEAD 时 abbrev-ref 返回 'HEAD' → 不匹配 experiment/* → A strict / B 跳过
const BRANCH = argOf('--branch') || gitOut(ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
const stagedArg = argOf('--staged-file');
const STAGED = stagedArg
  ? fs.readFileSync(stagedArg, 'utf8').split(/\r?\n/).filter(Boolean)
  : gitOut(ROOT, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split(/\r?\n/).filter(Boolean);

const isExperiment = /^experiment\//.test(BRANCH);

// frontmatter 读取（CRLF 容忍；口径同 check-loop fmGet：--- 包夹、键行前缀匹配）
const fmOf = (file) => {
  const fm = {};
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    return fm;
  }
  if (!/^---\s*$/.test(lines[0] || '')) return fm;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) break;
    const m = lines[i].match(/^([^:]+):\s*(.*)$/);
    if (m) fm[m[1].trim()] = m[2].trim();
  }
  return fm;
};

// 触达面配置：缺失/空 → []（检查 A 跳过）；语法错误 → fail-closed
const loadPatterns = () => {
  const file = path.join(ROOT, '.agents', 'lane-surfaces.txt');
  if (!fs.existsSync(file)) return [];
  const bad = [];
  const pats = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      try {
        return new RegExp(l);
      } catch {
        bad.push(l);
        return null;
      }
    })
    .filter(Boolean);
  if (bad.length) {
    console.error(`泳道完整性（增量）— BLOCK:\n  [面清单语法错误] .agents/lane-surfaces.txt 存在非法 ERE 行：${bad.join(' | ')}\n  修法：修正或删除该行后重试（fail-closed，防静默空洞）`);
    process.exit(1);
  }
  return pats;
};

// 活跃入口收集（incident≡intent 等价；日期键 intent=日期 / incident=发现）
const ACTIVE = {
  intent: new Set(['draft', 'approved']),
  incident: new Set(['open', 'fixed']),
};
const collectActive = () => {
  const out = [];
  for (const [dir, kind, dateKey] of [['intents', 'intent', '日期'], ['incidents', 'incident', '发现']]) {
    const dirPath = path.join(ROOT, 'workflow', dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const f of fs.readdirSync(dirPath).sort()) {
      if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
      const fm = fmOf(path.join(dirPath, f));
      if (!ACTIVE[kind].has(fm['状态'] || '')) continue;
      out.push({ rel: `workflow/${dir}/${f}`, base: f.replace(/\.md$/, ''), level: fm['级别'] || '', date: fm[dateKey] || '', kind });
    }
  }
  return out;
};

const blocks = [];
const advisories = [];

// --- 检查 A：触达面判低 ---
const patterns = loadPatterns();
const hits = patterns.length ? STAGED.filter((p) => patterns.some((re) => re.test(p))) : [];
if (hits.length) {
  const active = collectActive();
  const hasHigh = active.some((e) => e.level === 'L2' || e.level === 'L3');
  if (!hasHigh) {
    const low = active.filter((e) => e.level !== 'L2' && e.level !== 'L3');
    if (low.length) {
      const newest = [...low].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.rel.localeCompare(a.rel))[0];
      const text = [
        `[触达面判低] 暂存命中 L2 触达面，但活跃入口全为 L0/L1（含级别缺失）：`,
        `  命中: ${hits.join(' ')}`,
        `  关联入口: ${newest.rel}（${newest.level || '级别缺失'}${newest.date ? `，${newest.date}` : ''}；活跃 L0/L1 共 ${low.length} 件）`,
        `  修法（三选一）: ① 升级该入口「级别/risk_level」至 L2/L3 并补同名 spec（.agents/commands/design.md）`,
        `    ② 该入口已完成则关单（done）或显式放弃（superseded/cancelled）——不留活跃残留`,
        `    ③ 面清单误配则修 .agents/lane-surfaces.txt`,
      ].join('\n');
      if (isExperiment) advisories.push(`（advisory·experiment 泳道，不阻断；转正由 pre-push 加固门兜底）\n${text}`);
      else blocks.push(text);
    } else {
      advisories.push(`[触达面判低]（advisory）暂存命中 L2 触达面（${hits.length} 个文件），但当前无任何活跃入口——若非 docs / bootstrap 豁免类改动（.agents/commands/new-task.md §intent 豁免），请先立入口文档`);
    }
  }
}

// --- 检查 B：探索标记缺失（仅 experiment/* 分支）---
if (isExperiment) {
  const missing = STAGED
    .filter((p) => /^workflow\/intents\/[^/]+\.md$/.test(p) && path.basename(p) !== '_TEMPLATE.md')
    .filter((p) => {
      const fm = fmOf(path.join(ROOT, p));
      return fm['阶段'] !== 'exploring' && fm['状态'] !== 'exploring';
    });
  if (missing.length) {
    blocks.push([
      `[探索标记缺失] experiment/* 分支暂存的 intent 缺「阶段: exploring」标记：`,
      ...missing.map((p) => `  ${p}`),
      `  修法（二选一）: ① frontmatter 补一行「阶段: exploring」（advisory 免纪律不免标记——标记是 pre-push 加固门覆盖率的前提）`,
      `    ② 该件不属探索——换正式分支走标准泳道`,
    ].join('\n'));
  }
}

for (const a of advisories) console.error(`泳道完整性（增量）— advisory:\n${a}\n`);
if (blocks.length) {
  for (const b of blocks) console.error(`泳道完整性（增量）— BLOCK:\n${b}\n`);
  console.error('pre-commit: 泳道完整性未通过，提交已阻止（spec: workflow/specs/2026-10-01-drift-hardening.md）');
  process.exit(1);
}
process.exit(0);
