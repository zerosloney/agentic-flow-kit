#!/usr/bin/env node
// kb-search 结构缓存推送式失效（2026-09-23 intent kb-cache-post-commit-evict）
// 用途：.githooks/post-commit 把 `git diff-tree --name-only HEAD` 的清单经 stdin 传入，
//   摘除本次提交触及的 workflow/、wiki/ 文件在 .agents/cache/kb-index.json 中的全部命名空间条目，
//   收敛 [mtimeMs,size] 两元组的「同刻同尺寸」失效盲区至提交时点。
// 语义：非阻断维护——一切坏输入（缺缓存/坏 JSON/stdin 不可读）静默 exit 0；命中才回写且保留原 fp。
// 测试：node .agents/scripts/kb-cache-evict.test.mjs（--cache 指向临时文件，不触真实缓存）
// 用法：kb-cache-evict.mjs [--files-from <path>] [--cache <path>]；二者缺省时读 stdin 与默认缓存。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : '';
};

function readList() {
  const from = opt('--files-from');
  if (from) {
    try { return fs.readFileSync(from, 'utf8'); } catch { return ''; }
  }
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

const cacheFile = opt('--cache') || path.join(SCRIPT_DIR, '..', 'cache', 'kb-index.json');
const files = [...new Set(
  readList()
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/\\/g, '/'))
    .filter((s) => s.startsWith('workflow/') || s.startsWith('wiki/'))
)];
if (!files.length) process.exit(0);

let j;
try { j = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { process.exit(0); }
if (!j || !j.files || typeof j.files !== 'object') process.exit(0);

let removed = 0;
for (const k of Object.keys(j.files)) {
  const i = k.lastIndexOf('::');
  if (i > -1 && files.includes(k.slice(i + 2))) { delete j.files[k]; removed++; }
}
if (removed) {
  try { fs.writeFileSync(cacheFile, JSON.stringify(j)); } catch { /* 只读等写失败：下次查询两元组兜底 */ }
}
process.exit(0);
