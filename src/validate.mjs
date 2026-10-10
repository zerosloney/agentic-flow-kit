// flow-kit validate：只读校验装户盘面（2026-10-10 validate-entry；对照 OpenSpec validate 形态：
// 只读 + 0/1 退出码 + --strict/--json）。
// 语义：用**包内置** check-loop 引擎（templates/_agents/scripts/check-loop.mjs 的 runCheckLoop，
// isMain 主守卫保证 import 零副作用）对目标仓 workflow/ 闭环跑全部 20 项检查——不执行装户侧
// .agents/scripts/*（供应链面：判定引擎随包版本走、目标侧零代码执行；doctor 走另一极：scriptGuard
// 先验后跑装户侧脚本，两命令互补不重复）。root 经 runCheckLoop({root}) 传入，spawnGit 以 cwd:ROOT
// 落在目标仓——tracked 过滤按目标仓 HEAD 算，与 git 钩子看到的提交面一致。
// 只读范围：check-loop 自身仅有的两处落盘都在 .agents/cache/ 运行时缓存（gate-stats 需 --gate-stats
// 才触发、added-dates 缓存 best-effort），且该目录已 gitignore——本命令不改任何文档与台账。
// 不暴露 --rev：runCheckLoop 中 rev 与 root 互斥（提交时点判定属钩子链职责，validate 只看盘面现状）。
// 输出契约：check-loop 的 HARD-BLOCK/WARN 两段式原样走 stderr（稳定输出契约，消费者 .githooks/pre-push）；
// stdout 只承载本命令的汇总行 / --json——机器消费者按 stdout 解析，人按 stderr 读明细。
// 退出码：blocker → 1；--strict 下 advisory warning 同样 → 1（判据单源 validateExit，纯函数可单测）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 退出码判定单源（独立 export 供单元测试）：引擎 exitCode 非 0 → 1；--strict 时 warning 也红；
// 结果缺失（引擎调用异常路径）fail-closed → 1。
export function validateExit(result, strict) {
  if (!result || result.exitCode !== 0) return 1;
  if (strict && (result.warnings || []).length > 0) return 1;
  return 0;
}

export async function validate(args, pkgRoot) {
  let target = process.cwd();
  let strict = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') target = path.resolve(args[++i]);
    else if (args[i] === '--strict') strict = true;
    else if (args[i] === '--json') json = true;
    else {
      console.error(`validate: 未知参数 ${args[i]}——用法 flow-kit validate [--strict] [--json] [--dir <目录>]`);
      process.exit(1);
    }
  }

  // 装户盘面前置：枚举单源（workflow-enums.txt 等）都在 .agents/ 下，无装副本则引擎无从判定——
  // 先给指引再红，不产出「20 项全断档」的噪音墙
  if (!fs.existsSync(path.join(target, '.agents'))) {
    const msg = `缺 .agents/——validate 校验 flow-kit 装户盘面，先跑 npx agentic-flow-kit init`;
    if (json) console.log(JSON.stringify({ target, strict, checkLoopExitCode: null, exitCode: 1, blockers: [msg], warnings: [] }, null, 2));
    else console.error(`❌ validate: ${target} ${msg}`);
    process.exit(1);
  }

  // 动态 import 包内置引擎：pkgRoot = npx 缓存 / 全局安装 / 仓内直跑三种形态下都指向包源模板
  const engineUrl = pathToFileURL(path.join(pkgRoot, 'templates', '_agents', 'scripts', 'check-loop.mjs')).href;
  const { runCheckLoop } = await import(engineUrl);
  const result = runCheckLoop({ root: target });
  const code = validateExit(result, strict);

  if (json) {
    console.log(JSON.stringify({
      target,
      strict,
      checkLoopExitCode: result.exitCode,
      exitCode: code,
      blockers: result.blockers,
      warnings: result.warnings,
    }, null, 2));
  } else {
    const n = (result.blockers || []).length;
    const w = (result.warnings || []).length;
    if (code === 0) console.log(`✅ flow-kit validate 通过——blocker 0 / warning ${w}${w ? '（advisory 不阻断；--strict 可把 warning 判红）' : ''}`);
    else if (result.exitCode !== 0) console.log(`❌ flow-kit validate 未通过——blocker ${n} / warning ${w}（明细见上方 HARD-BLOCK / WARN 输出）`);
    else console.log(`❌ flow-kit validate（--strict）未通过——warning ${w} 条判红（默认退出码 0，advisory 不阻断）`);
  }
  process.exit(code);
}
