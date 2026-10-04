---
状态: open
级别: L2
发现: 2026-10-04
模块: pipeline
---
# INCIDENT — 2026-10-04 L1 plan 节名不匹配致验收证据校验误报

## 时间线

- 2026-10-04 实施 board-run-panel（执行器面板）关单：intent 验收证据引 commit 6ea0051（确实提交了 plan 声明的全部文件），doctor 仍报「证据无关：提交 6ea0051 未触及 plan 声明的任何文件」
- 2026-10-04 定位：check-loop `verifyEvidenceTruth` 只从 plan「## 改动面|任务拆解」节提取声明文件（`.agents/scripts/check-loop.mjs:602`），而 fill-plan 生成的 L1 plan 主节是「## 改动方案」（`templates/_agents/scripts/fill-plan.mjs:31`）→ `declaredFiles` 为空 → 任何真实 commit 均判 irrelevant
- 2026-10-04 尝试直接改 plan 节名为「改动面」可过校验，但触发 check-loop 检查 15「确认内容漂移」HARD-BLOCK（done 后内容绑定，关单编辑先于关单确认）——两难确认
- 2026-10-04 已记 papercut（workflow/papercuts.md，commit d8d3d7d），按「不当场顺手改」纪律未直接改引擎
- 2026-10-04 用户确认：立 incident 修引擎
- 2026-10-04 用户确认：incident + spec 草稿过目通过（「都可以」）
- 2026-10-04 用户确认：plan 草稿过目通过（「可以」）
- 2026-10-04 修复完成：check-loop.mjs 节名正则扩展 + check-loop.test.mjs 新增正/负例 + _TEMPLATE.md 注释统一（commit 94188ee）；npm test 全绿；doctor 0 FAIL（含 board-run-panel 误报消除）

## 影响面

- 所有用 fill-plan.mjs 生成的 L1 Quick-Plan：主节为「改动方案」，验收证据校验（check-loop 检查 8 / doctor）误报「提交未触及 plan 声明的文件」→ doctor FAIL
- 存量影响：`workflow/plans/` 下 14 份 L1 plan 使用「改动方案」节名（87 份 plan 中 14 份；59 份用「改动面」）
- 引擎双源：`templates/_agents/scripts/fill-plan.mjs` + `templates/_agents/scripts/check-loop.mjs` + `templates/workflow/plans/_TEMPLATE.md` 三处节名口径不一致

## 根因

- fill-plan.mjs 生成骨架的主节标题是「改动方案」，而 check-loop 证据校验只认「改动面」/「任务拆解」节——生成器与校验器节名契约未耦合。
- 深层原因：`templates/workflow/plans/_TEMPLATE.md` 注释写「L1 极简形态主节：改动方案」（第 9 行），但实际模板正文标题是「## 改动面（L1 极简形态主节）」（第 14 行）——模板注释、模板正文、fill-plan 生成器、check-loop 校验器四处口径分裂，且无机器校验兜底。

## 为什么之前没拦住

- 门禁：pre-commit / check-loop 对 plan 节名无「生成器输出 vs 校验器输入」一致性检查；`fill-plan.test.mjs` 只断言骨架节存在，未断言节名与 check-loop 提取口径一致
- 测试：`check-loop.test.mjs` 的证据校验用例只覆盖「改动面」节 plan，未覆盖 fill-plan 实际生成的「改动方案」节名 → 防线与真实形态错位（同 2026-09-25 wf-run-review-fixes 的「测试环境与真实威胁形态不同构」教训）
- 规范：模板注释与正文不一致长期存在（`_TEMPLATE.md` 第 9 行注释 vs 第 14 行正文），无「模板注释与机器校验口径须一致」的规范条目

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复方向：② check-loop 兼容「改动方案」节名（与 fill-plan 输出对齐，存量 L1 plan 证据校验自动通过；fill-plan 保持输出不变，改动集中在校验器一处）
   - 修复 commit：94188ee（`templates/_agents/scripts/check-loop.mjs` 节名正则 `(改动面|任务拆解)` → `(改动面|任务拆解|改动方案)`；`templates/_agents/scripts/check-loop.test.mjs` 新增场景 43 正例 / 44 负例；`templates/workflow/plans/_TEMPLATE.md` 第 9 行注释统一口径；含装副本同步）
   - 影响环境：dev（引擎包源 + 装副本 + 模板）
   - 是否需要新 intent：
     - 否 → 理由：根因属实现 bug（生成器/校验器节名契约未耦合），单点修复 + 防复发用例 + 规范条目可覆盖，incident 即 intent 等价物

2. 防复发验证（必须落到自动化用例或回归清单条目）
   - 自动化用例：`templates/_agents/scripts/check-loop.test.mjs` 场景 43/44——正例（L1 plan「改动方案」节 + 证据 SHA 触及声明文件 → 不报证据无关）与负例（声明不存在的文件 → 仍报证据无关）；`npm test` 全绿（195 断言全过）
   - 回归清单条目：`workflow/regression-checklist.md` 防复发验证节追加一行——L1 plan 主节名与 check-loop 证据提取口径一致性（见规范条目）

3. 规范条目（必须有可追溯的落点）
   - 落点：`templates/workflow/plans/_TEMPLATE.md` 第 9 行注释已统一——明确「模板正文用『改动面』，fill-plan 生成『改动方案』，check-loop 对 改动面/任务拆解/改动方案 三种节名均识别为声明文件来源」；`workflow/regression-checklist.md` 防复发验证节追加一行
   - 引用：修复 commit 94188ee；文件:`templates/_agents/scripts/check-loop.mjs`#L602、`templates/_agents/scripts/check-loop.test.mjs` 场景 43-44、`templates/workflow/plans/_TEMPLATE.md`#L9