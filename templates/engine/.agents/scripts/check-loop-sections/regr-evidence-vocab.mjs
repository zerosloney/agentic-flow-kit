// regr-evidence-vocab — incident「防复发验证」证据词表（单源）。
//
// 门的是「落到可复跑的验证资产」，不是猜具体测试名：命中任一形态即视为有自动化/清单落点。
// 词表沿革：
//   - 2026-10-09 首版：引擎 .test.mjs / 后端 xunit / 前端测试目录 / 回归清单 / 冒烟 / 测试命令。
//   - 2026-10-28 补分片：regression-checklist.d/<YYYY-MM>.md（append-only 分片）——此前只认主台账
//     workflow/regression-checklist.md，只引分片的 incident 被误判（2026-10-27-aggrid-hover-popconfirm 实证）。
//   - 2026-11-16 补仓库验证脚本：scripts/verify/**/*.mjs 是 kit `verify` 门实际执行的验证资产族
//     （business UI 断言、契约检查等），却不在此词表——incident 引用
//     `scripts/verify/business/verify-mto-column-filters-ui.mjs` 仍被判「回归证据缺失」
//     （Shipyard.Material PR 895 实证）。词表漏项 → 假阳性硬阻断，且 closed 文档已无补登记出口
//     （confirm-doc --reconfirm 仅受理 approved），故本次一并补上。
export const REGR_EVIDENCE_RE = /\.test\.mjs|backend\/[^\s]*[Tt]ests?[\/.]|\w+Tests\.cs|frontend\/[^\s]*(?:__tests__|tests?)\/|scripts\/verify\/[^\s]*\.mjs|workflow\/regression-checklist\.md|workflow\/regression-checklist\.d\/|regression-smoke|npm\s+test|dotnet\s+test|run-tests/;
