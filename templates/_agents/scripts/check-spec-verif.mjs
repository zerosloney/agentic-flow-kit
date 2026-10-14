// check-spec-verif.mjs — 检查 21：spec 验证落地核查 [warning]（2026-10-13 B6b-2 自 Shipyard.Material
//   check-loop-sections/s21-spec-verif.mjs 回灌；段体判据逐字对齐，出处沿革留痕在包源仓 git 历史与
//   CHANGELOG——装户径不引实例路径）
// review P1「spec 承诺落地：spec §测试用例须真落到测试」的机器面：L2/L3 done spec 且建档日 ≥ 锚
// （policy v9 specVerifSince；v1–v8 缺键 → 本段整体跳过），其「测试用例 / 验证计划 / 验证方式」节
// 无测试文件或验证命令引用 → WARN（advisory——spec 可能以 UI 实测等人工可复跑方式验证，不做 hard）。
// 缺键（v1–v8）→ 整体跳过；存量（< 锚）豁免。
// 模块形态（kit check-hygiene / check-stage-index 先例的 run(ctx)）：判定语义单源在本文件，ctx 只传
// check-loop.mjs 既有共享面（helper 单源在那边，复刻即造口径分叉）；warn 直接进 ctx.warnings，
// 输出序 = check-loop 调用序（稳定输出契约）。
// kit 适配（源仓→kit 逐条）：证据正则剔除源仓实例路径面（backend/…Tests.cs、frontend/__tests__、
//   verify-ui）——kit 口径保留通用形态（.test.mjs / 回归清单 / 测试与门命令），见 VERIF_EVIDENCE_RE 注。
import path from 'node:path';

export function run(ctx) {
  const { docFiles, fmGet, linesOf, addedDateOf, kitPolicy, warnings } = ctx;
  // --- 21. spec 验证落地核查 [warning]（锚 specVerifSince）---
  {
    const anchor = kitPolicy.specVerifSince;
    if (anchor) {
      const VERIF_SEC_RE = /^##\s+.*(测试用例|验证计划|验证方式|测试与验证)/;
      // 证据引用形态（宽匹配——门的是「验证节里有可复跑资产的身影」，不猜具体测试名）：
      //   引擎 .test.mjs / 回归清单（kit 模板 workflow/regression-checklist.md）/ 冒烟与测试命令
      //   （npm test、dotnet test、run-tests、check-scope、verify.mjs）。源仓实例路径面
      //   （backend/…、\w+Tests.cs、frontend/…、verify-ui）按 instance-ref 门修法剔除，判据方向不变。
      const VERIF_EVIDENCE_RE = /\.test\.mjs|workflow\/regression-checklist\.md|regression-smoke|npm\s+test|dotnet\s+test|run-tests|check-scope|verify\.mjs/;
      for (const spec of docFiles('specs')) {
        const st = fmGet(spec, '状态');
        const lvl = fmGet(spec, '级别');
        if (st !== 'done' || !['L2', 'L3'].includes(lvl)) continue;
        const add = addedDateOf(spec);
        if (!add || add < anchor) continue;
        const lines = linesOf(spec) || [];
        const secLines = [];
        let inSec = false;
        for (const l of lines) {
          if (VERIF_SEC_RE.test(l)) { inSec = true; continue; }
          if (inSec && /^##\s+/.test(l)) { inSec = false; continue; }
          if (inSec) secLines.push(l);
        }
        if (secLines.length && !secLines.some((l) => VERIF_EVIDENCE_RE.test(l))) {
          warnings.push(`- [WARN spec 验证落地] ${path.basename(spec)} 验证节无测试文件/验证命令引用——review P1「spec 承诺落地」要求落到可复跑验证资产`);
        }
      }
    }
  }
}
