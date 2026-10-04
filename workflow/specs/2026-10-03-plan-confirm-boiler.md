---
状态: done
级别: L2
日期: 2026-10-03
模块: pipeline
备注: 与 ../incidents/2026-10-03-plan-confirm-boiler.md 配对——检查 2 模板占位符判定豁免 plan「确认与复核」节样板句，消除三个 plan 的「模板未填」误报
确认指纹: f74f71099a24e594
---
# SPEC — plan-confirm-boiler

对应入口：../incidents/2026-10-03-plan-confirm-boiler.md

## 功能行为

检查号仍是 2（模板字段占位符残留，warning 级）。`boilerRe` 豁免清单增加 plan 模板「确认与复核」节的样板句精确匹配：

`确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）`

行为变化：

| 输入（plan 文档某行） | 修改前 | 修改后 |
|---|---|---|
| `- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）` | WARN 模板未填 | 不报 |
| `- 确认结果：approved（2026-10-03 用户对话内确认）；done（2026-10-03 关单，随入口文档置终态）` | 不报 | 不报 |
| `- 日期: YYYY-MM-DD`（真实未回填） | WARN 模板未填 | WARN 模板未填（照拦，不豁免） |

豁免范围只限**整句样板**（含中文括号与分号），不做前缀/子串放宽——避免把真实未回填的确认行（如用户只改了日期但保留其他占位）误豁免。plan 模板中其他占位形态（`<主题>` 命名约定、`L0 / L1 / L2 / L3` 等）判据不变。

## 数据流

`docFiles(plans)` 遍历 → `stripSamples`（剔除代码引用/围栏）→ 行级 `phRe` 命中且 `!boilerRe.test(line)` 且 `!isNamingConv(line)` → 命中则 WARN。本次改动仅扩展 `boilerRe` 正则分支，数据流不变。

## 系统改动

- `templates/_agents/scripts/check-loop.mjs`：检查 2 的 `boilerRe` 正则增加 plan 确认节样板分支（含中文标点的整句），并在 `boilerRe` 定义处注释说明豁免口径（plan 模板确认节样板，2026-10-03-plan-confirm-boiler）
- `templates/_agents/scripts/check-loop.test.mjs`：检查 2 新增回归场景——含确认节样板行的 plan 不报「模板未填」（正例）；含真实未填 `日期: YYYY-MM-DD` 的 plan 仍报（负例）
- `workflow/papercuts.md`：检查 6（模板占位符误报）条目更新为「已由 2026-10-03-plan-confirm-boiler 豁免处理」
- `workflow/regression-checklist.md`：「防复发验证」节追加一行——plan 确认节样板句由 boilerRe 豁免，真实占位仍拦（check-loop.test.mjs 检查 2 场景）
- 改完 templates 后 `node bin/flow-kit.mjs sync` 更新装副本
- 三个已关单 plan **不改内容**（避免触发检查 15 确认内容漂移）

## 约束遵守映射

| 红线 | 本 spec 如何满足 |
|---|---|
| 规则 / 契约变更走 L2 | 修改检查 2 的判定集合（boilerRe 豁免清单），立 incident + spec + plan，走确认门 |
| 双源 | 引擎脚本改 `templates/_agents/scripts/`，装副本靠 `sync`；`workflow/` 下文档手改 |
| 最小改动 / 不扩散 | 只改 `boilerRe` 正则 + 配套测试与文档；不动三个已关单 plan 内容，不改其他检查号判据 |
| 不掩盖真实缺陷 | 豁免仅限整句样板，真实未填占位（`日期: YYYY-MM-DD` 等）照拦，配套负例测试钉住 |

## 风险评估

- 风险：低。判定放宽仅覆盖 plan 模板确认节整句样板；该节回填情况由检查 15 确认指纹对账机器兜底，样板豁免不产生确认盲区。
- 缓解：正例 + 负例成对回归场景；`npm test` 全量验证；本仓推送后三个 WARN 消失可实测复核。

## 确认与复核

- 确认日期：（用户对话内确认后回填）
- 复核：L2 推荐独立复核（本单为判定集合单点扩展 + 双场景测试，低风险；如安排复核由 independent-reviewer 执行）