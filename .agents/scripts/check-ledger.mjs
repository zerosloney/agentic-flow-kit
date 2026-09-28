// check-ledger.mjs — managed 台账快检（2026-09-28 ledger-precommit-gate）：kit.json 台账 sha ↔ 盘面工作树
// 补 pre-commit 盲区：双源门禁（source-sync-check）查 templates↔.agents 正文，两侧成对回退时静默；
// doctor §4 查台账↔盘面但只在手动全量跑——「台账 sha 预 landing」（台账记了盘面尚不存在的内容 sha）
// 随常规提交静默落 main，三次真实发生（0272a1c 预入 / ff3c721 还原窗口 / 537df18 闭合），本脚本在
// 提交时刻补齐第三边。sha 口径：LF 归一 utf8（同 doctor §4 / render.mjs shaText / source-sync-check
// 读取侧，跨 checkout 稳定；装户自包含约束决定独立实现，三处口径改动须同批）。
// 边界：仅包源环境由 .githooks/pre-commit 触发（装户 managed 手改走 doctor §4 WARN 口径，不硬拦）；
//       managed 删除即拦——sync 对 removed 只报不删，删件须手动同步装副本并重跑 sync 刷台账。
// 用法：node .agents/scripts/check-ledger.mjs（cwd = 仓库根；非零出口即阻断提交）
//       单元测试：import { ledgerDrift } from './check-ledger.mjs'
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function ledgerDrift(target = process.cwd()) {
  const kitPath = path.join(target, '.agents', 'kit.json');
  if (!fs.existsSync(kitPath)) return { skipped: true, note: '无 .agents/kit.json（非 flow-kit 安装）' };
  let kit;
  try {
    kit = JSON.parse(fs.readFileSync(kitPath, 'utf8'));
  } catch (e) {
    return { skipped: false, fatal: `kit.json 解析失败：${e.message}`, modified: [], gone: [], total: 0, version: '?' };
  }
  if (!Array.isArray(kit.managed)) {
    // fail-loud（独立复核 P2-3，2026-09-28）：JSON 合法但 managed 缺失/非数组时静默「全对齐」= 假放，
    // 同 doctor §4 的 Array.isArray 显式判口径，台账结构坏了必须响
    return { skipped: false, fatal: 'kit.json managed 缺失或非数组', modified: [], gone: [], total: 0, version: kit.version };
  }
  const modified = [];
  const gone = [];
  const managed = kit.managed;
  for (const f of managed) {
    const p = path.join(target, f.rel);
    if (!fs.existsSync(p)) { gone.push(f.rel); continue; }
    const h = createHash('sha256').update(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex'); // LF 归一，同 doctor §4
    if (h !== f.sha256) modified.push(f.rel);
  }
  return { skipped: false, fatal: '', modified, gone, total: managed.length, version: kit.version };
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-ledger.mjs');
if (isMain) {
  const r = ledgerDrift();
  console.log('▶ flow-kit check-ledger');
  if (r.skipped) {
    console.log('  ' + r.note + '，跳过 ✅');
    process.exit(0);
  }
  console.log('  kit.json v' + r.version + '：managed ' + r.total + ' 份，台账 ↔ 盘面（工作树，LF 归一）');
  if (r.fatal) console.error('❌ ' + r.fatal);
  if (r.modified.length) {
    console.error('  台账漂移（盘面 ≠ 台账 sha）' + r.modified.length + '：');
    for (const rel of r.modified) console.error('    - ' + rel);
  }
  if (r.gone.length) {
    console.error('  managed 缺失 ' + r.gone.length + '：');
    for (const rel of r.gone) console.error('    - ' + rel);
  }
  if (r.fatal || r.modified.length || r.gone.length) {
    console.error('  提交被拦：kit.json 与盘面不一致（预 landing / 手改未随动）——跑 node bin/flow-kit.mjs sync 成对后原路重试');
    process.exit(1);
  }
  console.log('  全对齐 ✅');
  process.exit(0);
}
