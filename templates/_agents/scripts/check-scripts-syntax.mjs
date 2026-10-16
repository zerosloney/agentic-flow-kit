#!/usr/bin/env node
// check-scripts-syntax.mjs — 引擎脚本语法自检（node --check 全量扫描）
// 用途：守护者受守护——对 .agents/scripts 与 .agents/hooks 下全部 .mjs/.cjs 逐个 node --check，
//       任何文件不可解析即判红（先例教训：verify.mjs:31 SyntaxError 带病进 CI，全链门静默失效）。
// 语义与红线：只读裁决，不改任何状态；检查目录缺失或可检文件数为 0 一律判红（fail-closed，
//       防「改名/删除脚本即去门」）；不 import 任何引擎件，零依赖可独立调度。
// 性能（2026-10-16 自源仓 scripts-syntax-parallel 回灌）：node --check 无原地解析 ESM 的 API，
//       只能逐文件起子进程（单次 ~70ms × 全量脚本）；改工作池并发（min(8, cpus-2)），判红集合不变。
// 测试：node .agents/scripts/check-scripts-syntax.test.mjs
// 用法：node .agents/scripts/check-scripts-syntax.mjs [目录...]（相对仓库根；缺省 .agents/scripts .agents/hooks；
//       CHECK_LOOP_ROOT 可覆写仓库根，与 check-loop/verify 同口径）
// 沿革：2026-10-09 guardian-selfcheck（审计 P0-1 立项，verify.mjs GATES 首门消费）。

import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_DIRS = ['.agents/scripts', '.agents/hooks'];

const dirs = process.argv.slice(2);
const targets = dirs.length ? dirs : DEFAULT_DIRS;

// 守卫文件清单（目录缺失 fail-closed；可检文件数 0 fail-closed——防「改名/删除脚本即去门」）
const files = [];
const missing = [];
for (const d of targets) {
  const abs = path.resolve(ROOT, d);
  let names;
  try {
    if (!fs.statSync(abs).isDirectory()) { missing.push(d); continue; }
    names = fs.readdirSync(abs);
  } catch {
    missing.push(d);
    continue;
  }
  for (const f of names.filter((n) => /\.(mjs|cjs)$/.test(n)).sort()) files.push({ rel: `${d}/${f}`, abs: path.join(abs, f) });
}
const total = files.length;

// node --check 逐文件起子进程（无 API 可原地解析 ESM 而不执行），工作池并发后墙钟 ≈ 单次 spawn ×
// ceil(文件数/并发)。裁决口径不变：任一文件不可解析即判红，判红文件按路径排序输出（并发下不回放乱序）。
const reds = [];
{
  const conc = Math.max(2, Math.min(8, os.cpus().length - 2));
  let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const t = files[cursor++];
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
  await Promise.all(Array.from({ length: Math.min(conc, files.length) }, worker));
  reds.sort();
}

if (missing.length) {
  console.error(`[syntax] ❌ 检查目标目录缺失：${missing.join('、')}（fail-closed——脚本被改名/删除即去门）`);
  process.exit(1);
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
console.log(`[syntax] ✅ ${total} 个引擎脚本全部可解析（node --check）`);
process.exit(0);
