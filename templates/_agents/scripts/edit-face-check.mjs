#!/usr/bin/env node
// edit-face-check — 常驻面编辑时快检（2026-10-09 engine-quality-round2 B2）
// 动机：常驻面（AGENTS.md 等）的机器约束此前只在 git 钩子层生效——check-loop 仓库模式只扫 HEAD，
//   工作树编辑期零反馈（实测：常驻面重构砍掉阶段索引，到提交才被检查 7 报警）。本脚本把判定左移到编辑时。
// 判定零复刻铁律：闭环判定**单源**复用 check-loop——以 CHECK_LOOP_ROOT=<root>（全扫模式，扫工作树
//   非 HEAD）子进程消费其裁决，本脚本不实现任何门判定；唯一自算是常驻面字节预算 advisory（工作树
//   LF 字节 vs rule-budgets.txt 上限——提交门口径走 git index/HEAD（rule-budget.sh），两者判据不同面，
//   此处为编辑时 advisory，冲突时以提交门为准）。
// exit 语义：check-loop hard（exit≠0）→ 2；预算 advisory 超限 → 1；其余 → 0。
//   WARN **不进 exit**（打印明细供 AI/人对照）——绝对 WARN 计数会让带存量 advisory 的仓库恒非零
//   （本仓即有用户拍板保留的存量 WARN），工具就不可用了；编辑破坏的表现（如阶段索引漂移 WARN）
//   在输出里一眼可见，由编辑者处置。
// 用法：node .agents/scripts/edit-face-check.mjs [--root <仓库根>]（缺省 cwd；测试注入 EDIT_FACE_CHECK_SPAWN）
// 测试：node templates/_agents/scripts/edit-face-check.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// LF 归一字节数（编辑时口径——工作区文件可能 CRLF，预算表口径注释声明「比较用 LF 归一」）
export function lfBytes(text) {
  return Buffer.byteLength(String(text).replace(/\r\n/g, '\n'), 'utf8');
}

// globToRe：rule-budgets.txt 行首路径 → 正则（支持 `*` 段内通配与结尾 `/` 目录前缀；其余字面）
export function globToRe(pattern) {
  const dir = pattern.endsWith('/');
  let src = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  if (dir) src += '.*';
  return new RegExp(`^${src}${dir ? '' : '$'}`);
}

// budgetAdvisory：常驻面预算 advisory（编辑时口径）。files: Map<rel, 工作树文本>；budgetsText: 表原文。
// 返回超限行 [{ rel, limit, actual }]；表缺失/行非法 → 空数组（advisory 层 fail-open）。
export function budgetAdvisory(files, budgetsText) {
  const out = [];
  if (!budgetsText) return out;
  for (const line of budgetsText.split(/\r?\n/)) {
    const t = line.replace(/\r$/, '').trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^(\S+)\s+(\d+)$/);
    if (!m) continue;
    const [, pattern, limitStr] = m;
    const limit = Number(limitStr);
    const re = globToRe(pattern);
    for (const [rel, text] of files) {
      if (!re.test(rel)) continue;
      const actual = lfBytes(text);
      if (actual > limit) out.push({ rel, limit, actual });
    }
  }
  return out;
}

// runCheck：工作树面 check-loop（CHECK_LOOP_ROOT 全扫）。返回 { code, output, ms }。
function runCheck(root, scriptDir) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(scriptDir, 'check-loop.mjs')], {
    cwd: root, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, CHECK_LOOP_ROOT: root },
  });
  return { code: r.status ?? 1, output: `${r.stdout || ''}${r.stderr || ''}`, ms: Date.now() - t0 };
}

export function main(root = process.cwd(), scriptDir = path.dirname(fileURLToPath(import.meta.url))) {
  // ① 闭环判定（单源 check-loop，工作树全扫）
  const ck = runCheck(root, scriptDir);
  const warnCount = (ck.output.match(/\[WARN /g) || []).length;
  // ② 常驻面预算 advisory（AGENTS.md + 预算表内文件的工作树字节）
  let over = [];
  try {
    const budgetsPath = path.join(root, '.agents', 'rule-budgets.txt');
    const budgetsText = fs.existsSync(budgetsPath) ? fs.readFileSync(budgetsPath, 'utf8') : null;
    const files = new Map();
    const agentsPath = path.join(root, 'AGENTS.md');
    if (fs.existsSync(agentsPath)) files.set('AGENTS.md', fs.readFileSync(agentsPath, 'utf8'));
    over = budgetAdvisory(files, budgetsText);
  } catch { /* advisory 层 fail-open：预算读不到不阻断编辑时反馈 */ }

  console.log(`▶ edit-face-check → ${root}（工作树面）`);
  console.log(`  check-loop：${ck.code === 0 ? '通过' : `exit ${ck.code}`}，WARN ${warnCount} 条（${ck.ms}ms）——与本仓存量 advisory 对照看新增`);
  // WARN 明细透传（编辑破坏的判读面——如删阶段索引会在此点名「阶段索引漂移」）
  for (const line of ck.output.split(/\r?\n/)) {
    if (/\[WARN /.test(line)) console.log('  ' + line.trim().slice(0, 200));
  }
  for (const { rel, limit, actual } of over) {
    console.log(`  ⚠️ 预算 advisory：${rel} 工作树 ${actual}B > 上限 ${limit}B（编辑时口径；提交门以 rule-budget.sh 为准）`);
  }
  if (ck.code !== 0) {
    console.error('❌ 闭环判定 hard 未过——先修复再提交（判定单源 check-loop，详见上方输出）');
    return 2;
  }
  if (over.length > 0) {
    console.error('⚠️ 常驻面预算 advisory 超限——建议编辑期就瘦，别留到提交门');
    return 1;
  }
  console.log('✅ 编辑时快检完成（hard/预算两道均过；WARN 明细请对照处置）');
  return 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('edit-face-check.mjs');
if (isMain) {
  let root = process.cwd();
  const i = process.argv.indexOf('--root');
  if (i > 0 && process.argv[i + 1]) root = path.resolve(process.argv[i + 1]);
  process.exit(main(root));
}
