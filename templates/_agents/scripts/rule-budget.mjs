#!/usr/bin/env node
// 常驻面体积预算检查（单源：本脚本 + .agents/rule-budgets.txt；触发点：check-hygiene 检查 13（--all，WARN）、
// .githooks/pre-commit（--staged，硬拦））
// 自 sh 版移植 node（2026-10-08 ci 去 sh 化；2026-10-13 自 Shipyard.Material 参考实现回灌）——CI agent（Windows）
// 免 git-bash 依赖，check-loop 检查 13 从「无 sh 静默跳过」变恒可跑。语义逐条对齐 sh 版：
//   --all    查「提交后树」全量；--staged 仅查本次暂存触及的条目 + 触及目录的合计
//   退出码 0 通过 / 1 超限（违例打到 stdout，调用方决定警告还是阻断）；缺预算表 exit 0（fixture 沙箱不拦——既有语义）
// 「提交后树」= 索引（index）内容：staged 版优先于 HEAD；无 git（fixture）回退工作区文件。
// 字节口径 = 索引 / HEAD 内容（git cat-file，LF 归一）。禁用工作区 wc -c 口径（CRLF 膨胀系统性偏大，
// 2026-09-21 实测差 ~500B 一度误判超限）——本脚本所有字节数都走 cat-file，仅无 git 时才落工作区。
// 条目数预算（2026-10-15 减重手段② 自源仓回灌）：上限字段形如 `<N>#count` 时按「匹配文件条数」执法
//   而非字节——规则面一进一出（新增一条须先退役一条，退役判定 agg-judgments --retire-candidates）。
//   旧格式行（纯数字）不受影响；`#count` 行对旧读者（未升级的脚本副本）因上限非纯数字被跳过——
//   fail-open，不误拦。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2] === '--staged' ? '--staged' : '--all';

const git = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, out: (r.stdout || '').trim() };
};
const root = git(['rev-parse', '--show-toplevel']);
if (root.ok) process.chdir(root.out); // 非 git 环境（fixture 沙箱）留在原地

const BUDGETS = '.agents/rule-budgets.txt';
if (!fs.existsSync(BUDGETS)) process.exit(0);

// 「提交后」字节数：索引 → HEAD → 工作区
const fsize = (f) => {
  if (git(['cat-file', '-e', `:${f}`]).ok) return Number(git(['cat-file', '-s', `:${f}`]).out);
  if (git(['cat-file', '-e', `HEAD:${f}`]).ok) return Number(git(['cat-file', '-s', `HEAD:${f}`]).out);
  try { return fs.readFileSync(f).length; } catch { return 0; }
};

const staged = mode === '--staged'
  ? git(['-c', 'core.quotepath=off', 'diff', '--cached', '--name-only']).out.split('\n').filter(Boolean)
  : [];

// intentional-simple: glob 仅支持预算表在用的两形态——「固定目录 + * 后缀」（.agents/commands/*.md）
// 与目录本身（/ 结尾，展开一层直接子文件）；表出现更复杂 glob 时再升级
const expand = (pat) => {
  if (pat.endsWith('/')) {
    const dir = pat.replace(/\/$/, '');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile())
      .map((e) => path.join(dir, e.name));
  }
  if (pat.includes('*')) {
    const i = pat.lastIndexOf('/');
    const dir = i < 0 ? '.' : pat.slice(0, i);
    const name = pat.slice(i + 1);
    const star = name.indexOf('*');
    const pre = name.slice(0, star), suf = name.slice(star + 1);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()
      && e.name.startsWith(pre) && e.name.endsWith(suf))
      .map((e) => path.join(dir, e.name));
  }
  return fs.existsSync(pat) ? [pat] : [];
};

let viol = 0;
const over = (what, bytes, lim) => { console.log(`常驻面超限：${what} ${bytes}B > 上限 ${lim}B`); viol = 1; };
const overCount = (pat, n, lim) => { console.log(`常驻面超限（条目数）：${pat} ${n} 项 > 上限 ${lim} 项——一进一出：新增须先退役一条（退役判定 agg-judgments --retire-candidates）`); viol = 1; };

for (const line of fs.readFileSync(BUDGETS, 'utf8').split(/\r?\n/)) {
  const sp = line.lastIndexOf(' ');
  if (sp < 0) continue;
  const pat = line.slice(0, sp), lim = line.slice(sp + 1);
  if (pat === '' || pat.startsWith('#')) continue;
  // 条目数预算（2026-10-15 减重手段②）：`<N>#count` = 匹配文件数上限（一进一出的执法面）
  const cnt = /^(\d+)#count$/.exec(lim);
  if (!cnt && !/^\d+$/.test(lim)) continue;
  if (cnt) {
    if (mode === '--staged' && !staged.some((sf) => sf.startsWith(pat))) continue;
    const n = expand(pat).length;
    if (n > Number(cnt[1])) overCount(pat, n, cnt[1]);
    continue;
  }
  if (pat.endsWith('/')) {
    // 目录合计：--staged 下仅当暂存触及该目录内文件才查（字面前缀匹配，同 sh 版 2026-09-24 口径）
    if (mode === '--staged' && !staged.some((sf) => sf.startsWith(pat))) continue;
    const total = expand(pat).reduce((s, f) => s + fsize(f), 0);
    if (total > Number(lim)) over(`${pat} 合计`, total, lim);
  } else {
    for (const f of expand(pat)) {
      if (mode === '--staged' && !staged.includes(f.replace(/\\/g, '/'))) continue;
      const b = fsize(f);
      if (b > Number(lim)) over(f, b, lim);
    }
  }
}
process.exit(viol ? 1 : 0);
