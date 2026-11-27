#!/usr/bin/env node
// check-scripts-syntax.mjs — 引擎脚本语法自检（node --check；本地增量，全量需手动 CHECK_LOOP_FULL=1）
// 用途：守护者受守护——对 .agents/scripts 与 .agents/hooks 下全部 .mjs/.cjs 逐个 node --check，
//       任何文件不可解析即判红（先例教训：verify.mjs:31 SyntaxError 带病进 CI，全链门静默失效）。
// 2026-10-28 引擎减重第三刀：默认只检「本轮 diff 触及的引擎脚本」（.agents/scripts/.agents/hooks/
//   scripts/verify 面，运行器注入 FLOW_KIT_RUNTIME_* 时另含运行时目录）；CHECK_LOOP_FULL=1（本地手动，
//   CI 不跑治理门）或显式传目录 → 全量。目录存在性/空目录 fail-closed 检查仍按全量目录做，
//   防「改名/删除/清空即去门」。
// 语义与红线：只读裁决，不改任何状态；**任一**检查目录缺失、或该目录递归后一个可检文件都没有，
// 一律判红（fail-closed；运行器模式下项目侧补充目录缺失/无脚本除外——引擎实现由运行时提供）；递归扫描（2026-10-24 复核 M1：原实现只 readdirSync 顶层，
// `scripts/verify` 顶层 0 个 .mjs 时静默空转、总数不变无痕迹）；不 import 任何引擎件，零依赖可独立调度。
// 性能（scripts-syntax-parallel）：node --check 无原地解析 ESM 的 API，只能逐文件起子进程
//       （单次 ~70ms × 117 文件）；改工作池并发（min(8, cpus-2)）后本机 8.1s → 4.2s，判红集合不变。
// 用法：flow-kit run check-scripts-syntax.mjs [目录...]（相对仓库根；缺省 .agents/scripts .agents/hooks
//       scripts/verify——第三项为 backend 门执行器所在，2026-10-24 复核 P1 修复纳入守护；
//       FLOW_KIT_RUNTIME_SCRIPTS/HOOKS 注入时追加运行时目录；CHECK_LOOP_ROOT 可覆写仓库根，
//       与 check-loop/verify 同口径）
// 沿革：guardian-selfcheck（审计 P0-1 立项，verify.mjs GATES 首门消费）。

import fs from 'node:fs';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOW_KIT_PROJECT_ROOT || process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const RUNTIME_DIRS = [process.env.FLOW_KIT_RUNTIME_SCRIPTS, process.env.FLOW_KIT_RUNTIME_HOOKS].filter(Boolean);

const dirs = process.argv.slice(2);
const RUNTIME_MODE = RUNTIME_DIRS.length > 0 && dirs.length === 0;
const DEFAULT_DIRS = ['.agents/scripts', '.agents/hooks', 'scripts/verify', ...RUNTIME_DIRS];
// 项目侧目录：不存在时跳过（新装户可能没有 scripts/verify）；存在但为空仍 fail-closed。
// 运行器注入 FLOW_KIT_RUNTIME_* 时引擎实现由运行时目录提供，项目侧同名目录只是可选补充：
// 缺失或只含配置（如 .agents/hooks/gates.json）都不判红，有脚本则照常检查。
const PROJECT_DIRS = ['.agents/scripts', '.agents/hooks'];
const OPTIONAL_DIRS = new Set(['scripts/verify', ...(RUNTIME_MODE ? PROJECT_DIRS : [])]);
const EMPTY_OK = new Set(RUNTIME_MODE ? PROJECT_DIRS : []);
const targets = dirs.length ? dirs : DEFAULT_DIRS;

// 守卫文件清单（目录缺失 fail-closed；**每目录**可检文件数 0 fail-closed——防「改名/删除/清空即去门」）
const SKIP_DIRS = new Set(['node_modules', '.git', 'tmp']); // tmp = 一次性/生成件（gitignored），不入守护面
const walk = (abs, rel) => {
  const out = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.isSymbolicLink()) continue; // 防环；符号链接目标不属本仓守护面
    const childAbs = path.join(abs, ent.name);
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) out.push(...walk(childAbs, childRel)); continue; }
    if (ent.isFile() && /\.(mjs|cjs)$/.test(ent.name)) out.push({ rel: childRel, abs: childAbs });
  }
  return out;
};

// rel 必须与 git 输出同口径（仓库根相对、正斜杠）：运行器注入的运行时目录是绝对路径，
// 直接拿目录当 rel 前缀会与 changed 集合永不相等（增量门静默放行，E8b-H1）。
// 仓库外的目录保留绝对路径——本就不在项目 diff 面内，绝不参与增量匹配。
const toPosix = (p) => p.split(path.sep).join('/');
const relBase = (abs) => {
  const rel = path.relative(ROOT, abs);
  if (!rel) return '';
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) return toPosix(abs);
  return toPosix(rel);
};

const files = [];
const missing = [];
const empty = [];
const seen = new Set();
for (const d of targets) {
  const abs = path.resolve(ROOT, d);
  try {
    if (!fs.statSync(abs).isDirectory()) { missing.push(d); continue; }
  } catch {
    if (OPTIONAL_DIRS.has(d)) continue;
    missing.push(d);
    continue;
  }
  // 项目目录与运行时目录可能指向同一路径（运行时即项目）：只走一遍，防重复计数。
  const key = process.platform === 'win32' ? abs.toLowerCase() : abs;
  if (seen.has(key)) continue;
  seen.add(key);
  const found = walk(abs, relBase(abs));
  if (!found.length) {
    if (EMPTY_OK.has(d)) continue;
    empty.push(d);
    continue;
  }
  files.push(...found);
}

// 增量面（2026-10-28 第三刀）：默认只检本轮 diff 触及的脚本；CHECK_LOOP_FULL=1 / 显式传目录 /
// 夹具根（CHECK_LOOP_ROOT）→ 全量。目录存在性检查仍按全量目录做（防去门）。
const explicitDirs = dirs.length > 0;
const FULL = process.env.CHECK_LOOP_FULL === '1' || explicitDirs || !!process.env.CHECK_LOOP_ROOT;
let changed = null;
if (!FULL) {
  const gitOut = (args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return '';
    }
  };
  const set = new Set();
  const add = (text) => String(text || '').split(/\r?\n/).forEach((l) => {
    const p = l.trim().replace(/\\/g, '/');
    if (/\.(mjs|cjs)$/.test(p)) set.add(p);
  });
  const head = gitOut(['rev-parse', '--verify', 'HEAD']).trim();
  // --relative：git 默认打「仓库根相对」路径，本项目根可能是仓库子目录——统一成 ROOT 相对，
  // 与 f.rel / ls-files 同口径，否则子目录运行同样恒空放行。
  // HEAD 存在：HEAD..工作区（含暂存）；仓库尚无提交：索引 vs 空树，否则暂存文件整个漏掉。
  add(gitOut(['diff', '--name-only', '--no-renames', '--relative', head ? 'HEAD' : '--cached']));
  add(gitOut(['ls-files', '--others', '--exclude-standard']));  // untracked 新脚本
  changed = set;
}
const checked = changed ? files.filter((f) => changed.has(f.rel)) : files;
const total = checked.length;

// node --check 逐文件起子进程（无 API 可原地解析 ESM 而不执行），单次 ~70ms × 108 文件 = 8.1s 实测；
// 工作池并发后墙钟 ≈ 单次 spawn × ceil(文件数/并发)（scripts-syntax-parallel）。
// 裁决口径不变：任一文件不可解析即判红，判红文件按路径排序输出（并发下不回放乱序）。
const reds = [];
{
  const conc = Math.max(2, Math.min(8, os.cpus().length - 2));
  let cursor = 0;
  const worker = async () => {
    while (cursor < checked.length) {
      const t = checked[cursor++];
      const r = await new Promise((resolve) => {
        const child = spawn(process.execPath, ['--check', t.abs]);
        let err = '';
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', (e) => resolve({ status: null, stderr: String(e.message) }));
        child.on('close', (status) => resolve({ status, stderr: err }));
      });
      if (r.status !== 0) {
        const first = (r.stderr || '').split(/\r?\n/).find((l) => l.trim()) || `exit ${r.status}`;
        reds.push(`[syntax] ❌ ${t.rel}: ${first}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, checked.length) }, worker));
  reds.sort();
}

if (missing.length) {
  console.error(`[syntax] ❌ 检查目标目录缺失：${missing.join('、')}（fail-closed——脚本被改名/删除即去门）`);
  process.exit(1);
}
if (empty.length) {
  console.error(`[syntax] ❌ 检查目标目录递归后无可检脚本：${empty.join('、')}（fail-closed——目录被清空/改名即去门）`);
  process.exit(1);
}
if (changed && total === 0) {
  console.log(`[syntax] ✅ 本轮无引擎脚本变更（增量；全量 ${files.length} 个脚本请用 CHECK_LOOP_FULL=1）`);
  process.exit(0);
}
if (total === 0) {
  console.error('[syntax] ❌ 可检文件数为 0（目录为空或参数指错，fail-closed）');
  process.exit(1);
}
if (reds.length) {
  for (const line of reds) console.error(line);
  console.error(`[syntax] 共 ${total} 个引擎脚本，${reds.length} 个不可解析`);
  process.exit(1);
}
console.log(`[syntax] ✅ ${total} 个引擎脚本全部可解析（node --check${changed ? `；增量面，全量 ${files.length}` : ''}）`);
process.exit(0);
