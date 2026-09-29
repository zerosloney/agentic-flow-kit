#!/usr/bin/env node
// 暂存 diff 不得改写 GENERATED:BEGIN / GENERATED:END 之间的行。
// 区间按索引里的文件计算（git show :path），不读工作区。
// 生成器重写该区域时设 FLOW_KIT_ALLOW_GENERATED=1。
import { spawnSync } from 'node:child_process';

if (process.env.FLOW_KIT_ALLOW_GENERATED === '1') process.exit(0);

const git = process.platform === 'win32' ? 'git.exe' : 'git';
const listed = spawnSync(git, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' });
if (listed.status !== 0) {
  console.error('check-generated: git diff --cached 失败（需在 git 仓库的暂存区上运行）');
  process.exit(1);
}
const diff = spawnSync(git, ['diff', '--cached', '-U0', '--'], { encoding: 'utf8' });
if (diff.status !== 0) process.exit(1);

function rangesOf(text) {
  const out = [];
  let start = -1;
  String(text).split(/\n/).forEach((line, i) => {
    if (line.includes('GENERATED:BEGIN')) start = i + 1;
    else if (line.includes('GENERATED:END') && start > 0) {
      out.push([start, i + 1]);
      start = -1;
    }
  });
  return out;
}

const files = new Map();
let cur = null;
for (const line of String(diff.stdout).split(/\n/)) {
  const name = /^diff --git a\/(.+?) b\//.exec(line);
  if (name) { cur = name[1]; if (!files.has(cur)) files.set(cur, []); continue; }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (hunk && cur) files.get(cur).push([Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2])]);
}

let bad = 0;
for (const rel of listed.stdout.split(/\n/).map((s) => s.trim()).filter(Boolean)) {
  const norm = rel.split('\\').join('/');
  const shown = spawnSync(git, ['show', `:${norm}`], { encoding: 'utf8' });
  if (shown.status !== 0) {
    console.error(`${norm}: 读不到暂存内容`);
    bad += 1;
    continue;
  }
  const text = shown.stdout;
  const ranges = rangesOf(text);
  if (!ranges.length) continue;
  for (const [start, len] of files.get(norm) || []) {
    const from = start;
    const to = len === 0 ? start : start + len - 1;
    if (!ranges.some(([s, e]) => !(to < s || from > e))) continue;
    console.error(`${norm}: 暂存改动落入 GENERATED 区（${ranges.map(([s, e]) => `${s}-${e}`).join('、')}）。生成器重写时设 FLOW_KIT_ALLOW_GENERATED=1`);
    bad += 1;
    break;
  }
}
process.exit(bad ? 1 : 0);
