#!/usr/bin/env node
// 删除拦截门禁：Application/API 层新增 Remove/RemoveRange 调用点必须登记 allowlist 并配守卫用例。
// 背景：2026-09-11 评审发现 6 处删除拦截存量缺口（incident 2026-09-11-masterdata-delete-interception-gaps），
// 根因门禁缺位——本脚本做「新增删除路径须显式登记」的触发式审查；守卫正确性由防复发用例保证。
// 用法：check-delete-guard.mjs [--update]
// 自 check-delete-guard.sh 移植 node（2026-10-08 门禁去 sh 化第二批）——语义逐条对齐：
// 按文件聚合计数（行号漂移不误报）、排除 _cache.Remove(、posix 相对路径、字典序对齐 sh sort。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(process.argv[1]);
const ROOT = path.resolve(process.env.FLOW_KIT_PROJECT_ROOT || path.join(SCRIPT_DIR, '..', '..'));
const ALLOWLIST = path.join(ROOT, '.agents', 'hooks', 'delete-guard-allowlist.txt');
const SCAN_DIRS = [
  path.join(ROOT, 'backend', 'material', 'Shipyard.Material.Application'),
  path.join(ROOT, 'backend', 'material', 'Shipyard.Material.API'),
];

const counts = new Map();
for (const dir of SCAN_DIRS) {
  if (!fs.existsSync(dir)) continue;
  const base = path.basename(dir);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.cs')) {
        let n = 0;
        for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
          if (/\.(Remove|RemoveRange)\(/.test(line) && !/_cache\.Remove\(/.test(line)) n++;
        }
        if (n > 0) counts.set(`${base}/${path.relative(dir, p).replace(/\\/g, '/')}`, n);
      }
    }
  };
  walk(dir);
}
const current = [...counts.entries()].map(([f, n]) => `${f} ${n}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

if (process.argv[2] === '--update') {
  fs.writeFileSync(ALLOWLIST, current.join('\n') + '\n');
  console.log(`删除拦截 allowlist 已更新：${ALLOWLIST}`);
  process.exit(0);
}

if (!fs.existsSync(ALLOWLIST)) {
  console.error(`❌ 删除拦截门禁：缺少 ${ALLOWLIST}（首次请跑 check-delete-guard.mjs --update 生成并人工核对全部调用点已配守卫）`);
  process.exit(1);
}

const listed = fs.readFileSync(ALLOWLIST, 'utf8').replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
const same = current.length === listed.length && current.every((l, i) => l === listed[i]);
if (same) {
  console.log('删除拦截门禁通过：Remove/RemoveRange 调用点与登记一致');
  process.exit(0);
}
console.error('❌ 删除拦截门禁：Remove/RemoveRange 调用点与 .agents/hooks/delete-guard-allowlist.txt 不一致');
console.error('—— 新增删除路径必须：1) 删前查引用，被引用抛中文 InvalidOperationException（统一 400）');
console.error('   2) 配防复发用例（删除被引用 → 断言异常） 3) 确认无误后跑 check-delete-guard.mjs --update 更新登记');
for (const l of current) if (!listed.includes(l)) console.error(`< ${l}`);
for (const l of listed) if (!current.includes(l)) console.error(`> ${l}`);
process.exit(1);
