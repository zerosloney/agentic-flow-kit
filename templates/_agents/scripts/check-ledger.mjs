// check-ledger.mjs — managed 台账快检（2026-09-28 ledger-precommit-gate）：kit.json 台账 sha ↔ 盘面工作树
// 补 pre-commit 盲区：双源门禁（source-sync-check）查 templates↔.agents 正文，两侧成对回退时静默；
// doctor §4 查台账↔盘面但只在手动全量跑——「台账 sha 预 landing」（台账记了盘面尚不存在的内容 sha）
// 随常规提交静默落 main，三次真实发生（0272a1c 预入 / ff3c721 还原窗口 / 537df18 闭合），本脚本在
// 提交时刻补齐第三边。sha 口径：LF 归一 utf8（同 doctor §4 / render.mjs shaText / source-sync-check
// 读取侧，跨 checkout 稳定；装户自包含约束决定独立实现，三处口径改动须同批）。
// 入库态口径（2026-10-08 papercuts-cleanup-batch 修 5，独立复核 P1 修正取值链）：快检原比「工作树」，
// 而分批提交时提交树（= HEAD + 暂存合成，删除同样被应用）里的 kit.json sha 可能指向「工作区已改、
// 未提交」内容 → clone/CI 跑 doctor 必红（e8445c5 实证 6 项不符）。无参运行自适应：**暂存区非空即
// 入库态**（不判「提交集含 kit.json」——diff --cached 只列与 HEAD 有差异的文件，kit.json 无变化暂存
// 时不出现，但其合成提交树同样可能预 landing：只 add 件不 add 台账是姊妹漏洞）。入库态取值：
// 台账清单 = 暂存版 kit.json（`git show :.agents/kit.json`）；暂存无而 HEAD 有 = 退出性提交（kit.json
// 被暂存删除）放行；managed 内容 = `git show :rel` 暂存版，**暂存无即 gone**（提交树=index——
// 未暂存改动的文件 index 仍在，`:rel` 必命中；`:rel` 缺失唯一可达路径是暂存删除，HEAD 兜底会把它
// 误读为「未触碰」放行 = 提交门绕过，复核 P1 实证）。
// 暂存区空（amend 等罕见态）→ 维持工作树口径零变化。
// 边界：仅包源环境由 .githooks/pre-commit 触发（装户 managed 手改走 doctor §4 WARN 口径，不硬拦）；
//       managed 删除即拦——sync 对 removed 只报不删，删件须手动同步装副本并重跑 sync 刷台账。
// 用法：node .agents/scripts/check-ledger.mjs（cwd = 仓库根；非零出口即阻断提交；无参自适应两口径）
//       单元测试：import { ledgerDrift } from './check-ledger.mjs'（{staged:true} 显式入库态）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const gitText = (target, args) => {
  const r = spawnSync('git', args, { cwd: target, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};

export function ledgerDrift(target = process.cwd(), { staged = false } = {}) {
  const kitPath = path.join(target, '.agents', 'kit.json');
  if (!fs.existsSync(kitPath)) return { skipped: true, note: '无 .agents/kit.json（非 flow-kit 安装）' };
  // staged 模式：台账清单取暂存版 kit.json（提交树=index 合成语义）；暂存无而 HEAD 有 = 退出性提交
  // （kit.json 被暂存删除）放行；两者皆无（新仓无 kit.json）同样放行
  let kit = null;
  if (staged) {
    const stagedKit = gitText(target, ['show', ':.agents/kit.json']);
    const headKit = stagedKit === null ? gitText(target, ['show', 'HEAD:.agents/kit.json']) : null;
    if (stagedKit === null) {
      return { skipped: true, note: headKit !== null ? '提交树无 .agents/kit.json（退出 flow-kit 的提交），跳过' : '提交树无 .agents/kit.json（新仓），跳过', mode: 'staged' };
    }
    try {
      kit = JSON.parse(stagedKit);
    } catch (e) {
      return { skipped: false, fatal: `kit.json（暂存版）解析失败：${e.message}`, modified: [], gone: [], total: 0, version: '?', mode: 'staged' };
    }
  }
  if (!kit) {
    try {
      kit = JSON.parse(fs.readFileSync(kitPath, 'utf8'));
    } catch (e) {
      return { skipped: false, fatal: `kit.json 解析失败：${e.message}`, modified: [], gone: [], total: 0, version: '?', mode: staged ? 'staged' : 'worktree' };
    }
  }
  if (!Array.isArray(kit.managed)) {
    // fail-loud（独立复核 P2-3，2026-09-28）：JSON 合法但 managed 缺失/非数组时静默「全对齐」= 假放，
    // 同 doctor §4 的 Array.isArray 显式判口径，台账结构坏了必须响
    return { skipped: false, fatal: 'kit.json managed 缺失或非数组', modified: [], gone: [], total: 0, version: kit.version, mode: staged ? 'staged' : 'worktree' };
  }
  const modified = [];
  const gone = [];
  const managed = kit.managed;
  for (const f of managed) {
    let content = null;
    if (staged) {
      // 入库态：提交树 = index（暂存版）；`:rel` 缺失唯一可达路径是暂存删除 → gone 拦（复核 P1：
      // HEAD 兜底会把暂存删除误读为「未触碰」放行——提交树已无该件而台账仍跟踪，clone/CI 必红）
      content = gitText(target, ['show', `:${f.rel}`]);
      if (content === null) { gone.push(f.rel); continue; }
    } else {
      const p = path.join(target, f.rel);
      if (!fs.existsSync(p)) { gone.push(f.rel); continue; }
      content = fs.readFileSync(p, 'utf8');
    }
    const h = createHash('sha256').update(content.replace(/\r\n/g, '\n'), 'utf8').digest('hex'); // LF 归一，同 doctor §4
    if (h !== f.sha256) modified.push(f.rel);
  }
  return { skipped: false, fatal: '', modified, gone, total: managed.length, version: kit.version, mode: staged ? 'staged' : 'worktree' };
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-ledger.mjs');
if (isMain) {
  // 无参自适应：暂存区非空（有提交发生）→ 入库态口径；暂存区空（amend 等罕见态/非 git 仓）→ 工作树口径
  const cached = gitText(process.cwd(), ['diff', '--cached', '--name-only']) || '';
  const staged = cached.split(/\r?\n/).some((l) => l.trim() !== '');
  const r = ledgerDrift(process.cwd(), { staged });
  console.log('▶ flow-kit check-ledger');
  if (r.skipped) {
    console.log('  ' + r.note + '，跳过 ✅');
    process.exit(0);
  }
  console.log('  kit.json v' + r.version + '：managed ' + r.total + ' 份，台账 ↔ ' + (r.mode === 'staged' ? '提交树入库态（暂存版=index，暂存删除即拦，LF 归一）' : '盘面（工作树，LF 归一）'));
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
    console.error('  提交被拦：kit.json 与' + (r.mode === 'staged' ? '提交树（暂存面）' : '盘面') + '不一致（预 landing / 手改未随动）——跑 node bin/flow-kit.mjs sync 成对后原路重试');
    process.exit(1);
  }
  console.log('  全对齐 ✅');
  process.exit(0);
}
