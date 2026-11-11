#!/usr/bin/env node
// check-notify-guard: 前端提示守卫门禁（intent 2026-09-19-auth-expiry-explicit-guard）
// 红线：frontend/src 下禁止直接调用 antd 的 message.error / warning / warn / info——
//       认证失效跳转期间这些提示必须能被静默，页面层发坏消息一律经 utils/notify.ts 的 notify.*。
//       message.success / loading / open 不在守卫范围（正常提示），不拦。
// 扫描面：全仓 frontend/src（非仅暂存区新增行，与 check-audit-fields 的渐进收口不同）——
//         存量调用点已于 2026-09-19 一次性清零，故可直接全量扫描：既拦新增调用点，也暴露迁移遗漏。
// 豁免：frontend/src/utils/notify.ts（守卫自身的实现，只有它允许直接调 message.error/warning/info）
// 约定：违例输出到 stderr 并 exit 1；参数错误 exit 2；干净无输出 exit 0（对齐 check-architecture）
// 自 check-notify-guard.sh 移植 node（2026-10-08 门禁去 sh 化第二批）——语义逐条对齐。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

if (process.argv.length > 2) {
  console.error(`用法: ${path.basename(process.argv[1])}（无参数；扫描面为全仓 frontend/src，不区分暂存区）`);
  process.exit(2);
}
const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (gitRoot.error || gitRoot.status !== 0) {
  console.error('check-notify-guard: 不在 git 仓库内,门禁 fail-closed,不静默放行');
  process.exit(1);
}
process.chdir(gitRoot.stdout.trim());
if (!fs.existsSync('frontend/src')) process.exit(0);

const HIT = /message\.(error|warning|warn|info)\s*\(/;
const hits = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(vue|ts)$/.test(e.name)) hits.push(p);
  }
};
walk('frontend/src');

const viol = [];
for (const f of hits) {
  const rel = f.replace(/\\/g, '/');
  if (rel === 'frontend/src/utils/notify.ts') continue; // 守卫自身实现豁免
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!HIT.test(lines[i])) continue;
    if (/^\s*(\/\/|\*|\/\*)/.test(lines[i])) continue; // 注释行不算违例
    viol.push(`${rel}:${i + 1}:${lines[i]}`);
  }
}
if (viol.length > 0) {
  console.error('提示守卫违例：frontend/src 下直接调用 message.error/warning/info（应改经 notify.*，见 utils/notify.ts）：');
  console.error(viol.join('\n'));
  process.exit(1);
}
process.exit(0);
