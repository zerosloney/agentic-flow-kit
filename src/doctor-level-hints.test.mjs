#!/usr/bin/env node
// checkLevelHints 供应链校验（2026-10-19 P0.2 补齐）——此前 §6.10 是 doctor 里唯一不经
// scriptGuard 就 spawn 目标侧脚本的位置，而它又是唯一「spawn 失配也继续跑完」的 FAIL 级检查：
// 预置/被改写的 level-criteria.mjs 可让体检恒 ok，把「配置有误」洗成「配置合法」。
// 本测试锁三态：guard 拒绝 → 不 spawn 且不判 FAIL；guard 放行 → 真跑（含抓错能力仍在）；
// 无 guard（旧调用签名/直接库调用）→ 行为不回退。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'templates', '_agents', 'scripts');
const PKG = path.join(SCRIPTS, 'level-criteria.mjs');
// 2026-10-19：level-criteria.mjs 起 import workflow-enums.mjs（LEVELS 改从单源派生），故夹具必须连它
//   一起拷——这正是 fixture-scripts.mjs 头部说的「手写枚举滞后 → ESM resolve 失败 → 门禁静默不跑 =
//   假绿」：漏拷的表现是 spawn 带着 MODULE_NOT_FOUND 崩，而不是跳过。
const PKG_ENUMS_MJS = path.join(SCRIPTS, 'workflow-enums.mjs');
// 读取器启动即读 `.agents/workflow-enums.txt`（数据与读取器分离，单源是那个 .txt）——故 .mjs 与 .txt
// 必须一起拷，只拷读取器会以「单源文件不可读」fail-loud 崩栈。
const PKG_ENUMS_TXT = path.join(ROOT, 'templates', '_agents', 'workflow-enums.txt');
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); }
};

const { checkLevelHints } = await import(pathToFileURL(path.join(ROOT, 'src', 'doctor.mjs')).href);

// --- 构造：最小装户盘面，含一个真 level-criteria.mjs + 一个真写错的 level-hints.txt ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-lh-'));
fs.mkdirSync(path.join(dir, '.agents', 'scripts'), { recursive: true });
fs.copyFileSync(PKG, path.join(dir, '.agents', 'scripts', 'level-criteria.mjs'));
fs.copyFileSync(PKG_ENUMS_MJS, path.join(dir, '.agents', 'scripts', 'workflow-enums.mjs'));
fs.copyFileSync(PKG_ENUMS_TXT, path.join(dir, '.agents', 'workflow-enums.txt'));
// 非法 ERE：`(` 未闭合 —— parseLevelHints fail-loud，退出非 0 且 stderr 有说明
fs.writeFileSync(path.join(dir, '.agents', 'level-hints.txt'), 'L2 (\n');

// G1 guard 拒绝 → 不 spawn、不判 FAIL、注明跳过（把「洗白」路径堵死）
{
  const r = checkLevelHints(dir, () => ({ ok: false, note: '与包源渲染值不一致' }));
  check('G1 guard 拒绝 → ok=true 但 skipped=false（不判 FAIL、也不当成配置合法）',
    r.skipped === false && r.ok === true && /校验跳过/.test(r.note || ''), JSON.stringify(r));
}

// G2 guard 放行 → 真跑，且对写错的清单仍然报 FAIL（抓错能力没被 guard 参数削弱）
{
  const r = checkLevelHints(dir, () => ({ ok: true, note: '' }));
  check('G2 guard 放行 → 仍跑真校验并抓出非法 ERE（ok=false 带 detail）',
    r.skipped === false && r.ok === false && !!r.detail, JSON.stringify(r));
}

// G3 清单合法时 guard 放行 → ok
{
  fs.writeFileSync(path.join(dir, '.agents', 'level-hints.txt'), 'L2 ^src/\n');
  const r = checkLevelHints(dir, () => ({ ok: true, note: '' }));
  check('G3 合法清单 + guard 放行 → ok', r.skipped === false && r.ok === true, JSON.stringify(r));
}

// G4 旧调用签名（无 guard）行为不回退：依然真跑、依然抓错
{
  fs.writeFileSync(path.join(dir, '.agents', 'level-hints.txt'), 'L2 (\n');
  const r = checkLevelHints(dir);
  check('G4 无 guard 参数（旧签名/直接库调用）→ 仍抓错', r.skipped === false && r.ok === false, JSON.stringify(r));
}

// G5 无脚本 → skipped（1.7.15 前旧装户），guard 不被调用
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-lh-e-'));
  let called = false;
  const r = checkLevelHints(empty, () => { called = true; return { ok: true }; });
  check('G5 无脚本 → skipped 且不调 guard（无脚本可校验，先过存在性）',
    r.skipped === true && r.ok === true && called === false, JSON.stringify(r));
  fs.rmSync(empty, { recursive: true, force: true });
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
