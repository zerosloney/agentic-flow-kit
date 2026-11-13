#!/usr/bin/env node
// check-hook-wiring — 宿主接线宣称 ↔ 实态一致性机检（2026-10-29 P0）
//
// 为什么需要：引擎测试面退役（2026-10-28）后接线漂移无自动防线——实证案例（2026-10-29）：
//   ① registry 行 40 记「zcode 接线坐实」，实态 = .zcode/config.json Bash 槽 enabled:false。
// 本脚本只做「宣称 == 实态」对账（drift 检出），不替 owner 决定期望态——期望态变更（如 zcode Bash
// 槽启用）须同步改 CLAIMS 与 registry 行；两侧任一漂移本门即红。
//
// 挂载点：.githooks/pre-push（推送范围触及宿主壳/.agents/hooks/registry 时条件执行）；手动：node 本文件。
// 退出码：0 一致 / 1 漂移或自检失败。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.FLOW_KIT_PROJECT_ROOT || path.join(HERE, '../..'));

// 宣称表（单源：期望态在此声明并指回 registry 行；改期望态 = 改本表 + registry 行同提交）
// 只列**入库宿主**（engine.json options.hosts = trae / codebuddy）。本机宿主壳（.zcode/.qoder/.grok/
// .omp/.qwen 等，见 .gitignore 宿主政策）禁止入表：文件不随 clone 传播，写了必在他机假红
// （实证：2026-11-07 移出 zcode 跟踪后本门恒红一日无人见——pre-push 仅推送范围触宿主壳才条件起它）。
const CLAIMS = [
  {
    host: '.trae/hooks.json', event: 'PreToolUse', matcher: 'RunCommand|Bash|Shell|Terminal',
    cmdIncludes: 'pre-shell-check', enabled: null, // null = 该宿主配置无 enabled 字段（缺省即启用），只验存在
    claim: 'runtime-env §6.4 宿主事实（Trae RunCommand）',
  },
  {
    host: '.codebuddy/settings.json', event: 'PreToolUse', matcher: 'Bash|PowerShell|RunCommand|Shell|Terminal',
    cmdIncludes: 'pre-shell-check', enabled: null,
    claim: 'runtime-env §6.4 宿主事实（CodeBuddy Bash 主通道 + PowerShell 次通道）',
  },
  {
    host: '.codebuddy/settings.json', event: 'PreToolUse', matcher: 'Write|Edit|MultiEdit',
    cmdIncludes: 'pre-write-check', enabled: null,
    claim: 'registry 宿主写前门行（2026-11-11 codebuddy 接线，trae 仍无写前壳）',
  },
  // post-edit-check（PostToolUse 反馈腿）已于 2026-11-08 档 1 减重退役（与写前门/pre-commit 重复执法），
  // 对应 CLAIMS 两行随码同批删除；registry「宿主写前门」行口径同批更新。
];

const problems = [];
for (const c of CLAIMS) {
  const abs = path.join(ROOT, c.host);
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    problems.push(`${c.host} 不可读/不可解析（${e.message}）——宣称 ${c.event}[${c.matcher}] 无法核验`);
    continue;
  }
  const entries = cfg?.hooks?.events?.[c.event] ?? cfg?.hooks?.[c.event] ?? [];
  const hit = entries.find((e) => e?.matcher === c.matcher);
  if (!hit) {
    problems.push(`${c.host} 缺 ${c.event}[${c.matcher}]（宣称：${c.claim}）`);
    continue;
  }
  const wired = (hit.hooks || []).find((h) => typeof h?.command === 'string' && h.command.includes(c.cmdIncludes));
  if (!wired) {
    problems.push(`${c.host} ${c.event}[${c.matcher}] 未挂 ${c.cmdIncludes}（宣称：${c.claim}）`);
    continue;
  }
  if (c.enabled !== null && wired.enabled !== c.enabled) {
    problems.push(`${c.host} ${c.event}[${c.matcher}] → ${c.cmdIncludes} enabled=${wired.enabled}，宣称=${c.enabled}（${c.claim}）`);
  }
}

if (problems.length) {
  console.error('check-hook-wiring: 接线漂移——宣称与实态不一致：');
  for (const p of problems) console.error('  ❌ ' + p);
  console.error('处置：改实态（宿主配置/挂载）或改宣称（本脚本 CLAIMS + mechanism-registry 对应行）后重跑；两侧须同提交。');
  process.exit(1);
}
console.log(`check-hook-wiring: ✅ ${CLAIMS.length} 项宣称与实态一致`);
