#!/usr/bin/env node
// check-notify-guard: 前端提示守卫门禁（intent 2026-09-19-auth-expiry-explicit-guard）
// 红线：目标目录下禁止直接调用 antd 的 message.error / warning / warn / info——
//       认证失效跳转期间这些提示必须能被静默，页面层发坏消息一律经统一 notify.* 出口。
//       message.success / loading / open 不在守卫范围（正常提示），不拦。
// 配置（可选）：.agents/hooks/notify-guard.json
//   { "targets": ["frontend/src"], "ext": [".vue", ".ts"],
//     "pattern": "message\\.(error|warning|warn|info)\\s*\\(",
//     "allowFiles": ["frontend/src/utils/notify.ts"] }
//   缺省 = 历史内建值（frontend/src + .vue/.ts + 上述 pattern + notify.ts 豁免），行为不变。
//   配置存在但不是合法对象 / 字段类型错 / 正则非法 = fail-loud exit 2（错配不得当未配置放过）。
// 扫描面：目标目录全量（非仅暂存区新增行）——既拦新增调用点，也暴露迁移遗漏；注释行不判违例。
// 约定：违例输出到 stderr 并 exit 1；参数错误 exit 2；干净无输出 exit 0（对齐 check-architecture）。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { t } from '../scripts/lang.mjs';

const CONFIG = '.agents/hooks/notify-guard.json';
const DEFAULTS = {
  targets: ['frontend/src'],
  ext: ['.vue', '.ts'],
  pattern: 'message\\.(error|warning|warn|info)\\s*\\(',
  allowFiles: ['frontend/src/utils/notify.ts'],
};

if (process.argv.length > 2) {
  console.error(t(`用法: ${path.basename(process.argv[1])}（无参数；扫描面由 ${CONFIG} 或内建默认决定）`,
    `usage: ${path.basename(process.argv[1])} (no arguments; scan surface comes from ${CONFIG} or built-in defaults)`));
  process.exit(2);
}
const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (gitRoot.error || gitRoot.status !== 0) {
  console.error(t('check-notify-guard: 不在 git 仓库内,门禁 fail-closed,不静默放行', 'check-notify-guard: not inside a git repository; gate fails closed instead of silently passing'));
  process.exit(1);
}
process.chdir(gitRoot.stdout.trim());

const failConfig = (reason) => {
  console.error(t(`提示守卫门禁：${CONFIG} 配置无效——${reason}`, `Notify guard: invalid ${CONFIG} config — ${reason}`));
  process.exit(2);
};
const arr = (v, key) => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || s === '')) failConfig(`「${key}」必须是非空字符串数组`);
  return v;
};

let cfg = {};
if (fs.existsSync(CONFIG)) {
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch (e) {
    failConfig(`不是合法 JSON（${e.message}）`);
  }
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) failConfig('顶层必须是 JSON 对象');
  const unknown = Object.keys(cfg).filter((k) => !['targets', 'ext', 'pattern', 'allowFiles', '_note'].includes(k));
  if (unknown.length) failConfig(`未知键「${unknown.join('、')}」`);
  if (cfg.pattern !== undefined && (typeof cfg.pattern !== 'string' || !cfg.pattern)) failConfig('「pattern」必须是非空字符串');
}
const targets = arr(cfg.targets, 'targets').length ? arr(cfg.targets, 'targets') : DEFAULTS.targets;
const exts = arr(cfg.ext, 'ext').length ? arr(cfg.ext, 'ext') : DEFAULTS.ext;
const allowFiles = new Set(arr(cfg.allowFiles, 'allowFiles').length ? arr(cfg.allowFiles, 'allowFiles') : DEFAULTS.allowFiles);

let HIT;
try {
  HIT = new RegExp(typeof cfg.pattern === 'string' && cfg.pattern ? cfg.pattern : DEFAULTS.pattern);
} catch (e) {
  failConfig(`「pattern」正则非法（${e.message}）`);
}

const hits = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.some((x) => e.name.endsWith(x))) hits.push(p);
  }
};
for (const target of targets) {
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) walk(target);
}

const viol = [];
for (const f of hits) {
  const rel = f.replace(/\\/g, '/');
  if (allowFiles.has(rel)) continue; // 守卫自身实现豁免
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!HIT.test(lines[i])) continue;
    if (/^\s*(\/\/|\*|\/\*)/.test(lines[i])) continue; // 注释行不算违例
    viol.push(`${rel}:${i + 1}:${lines[i]}`);
  }
}
if (viol.length > 0) {
  console.error(t('提示守卫违例：目标目录下直接调用 message.error/warning/info（应改经统一 notify.* 出口）：',
    'Notify guard violation: direct message.error/warning/info calls under the target dirs (route them through the unified notify.* API):'));
  console.error(viol.join('\n'));
  process.exit(1);
}
process.exit(0);
