---
状态: approved
级别: L1
模块: pipeline
确认指纹: 1833205cdbef61c0
---
# PLAN — ci-red-batch

<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->
<!-- L1 快车道 (Quick-Plan)（2026-09-30 更新）：合并 Spec 与 Plan 核心。必填三节：[改动方案, 约束与风险, 验证计划]。仅多文件多步骤时保留任务拆解/执行顺序 -->

对应入口：../incidents/2026-10-02-ci-red-batch.md
对应 spec：（L1 快车道省略）

## 改动方案

- `templates/_agents/scripts/pre-push.test.mjs`：① `setup()` 拷钩子后补 `fs.chmodSync(…, 0o755)`——Linux 上 git 静默跳过不可执行钩子（治根因①）② `PRE_PUSH` 由单路径改双布局探测（`../../_githooks` templates 布局 / `../../.githooks` 装户布局，`fs.existsSync` 取首个命中）——治装户侧 ENOENT（根因②）
- `node bin/flow-kit.mjs sync`：刷 managed 装副本（`.agents/scripts/pre-push.test.mjs` 成对）+ owned sha 盘面自愈（`.agents/settings.json` 台账对齐，治根因③）+ kit.json managed 哈希
- 发版：0.9.4 bump（package.json + .agents/kit.json version + CHANGELOG），提交并推送后重打 v0.9.4 tag（原误打 tag 已删）

## 约束与风险

- 约束：引擎双源纪律——只改 `templates/` 源，装副本一律经 sync 成对（pre-commit 双源门 / managed 台账快检拦截单边漂移）；`git commit/merge/push` 禁 `--no-verify`；确认走 confirm-doc 对话代录
- 约束：不动 `templates/_githooks/pre-push` 钩子本体（缺陷在测试件，钩子判定逻辑 v09-review-defects 已修）
- 风险：Linux 侧无法本地验证（开发机 win32）——chmod 修复依据 git 平台行为（不可执行钩子被跳过）与失败形态完全吻合；由 CI ubuntu 腿最终验证，红则回本 plan 迭代
- 风险：低——改动面收敛在一个测试文件 + sync 产物 + 发版三件

## 验证计划

- 静态门：`npm test` 全套件绿（含 `templates/_agents/scripts/pre-push.test.mjs` 6/6）
- 装户侧：`node .agents/scripts/pre-push.test.mjs` 不再 ENOENT（双布局探测命中根 `.githooks/`）
- 台账：`node bin/flow-kit.mjs doctor` 13 项 PASS、owned 漂移 0；pre-commit managed 台账快检过
- CI：push main 后 CI（ubuntu×2/windows×2）全绿；v0.9.4 tag 的 Release 走到 npm publish 成功（npm 侧 0.9.1 → 0.9.4）

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-10-02 用户对话内确认「方案 a（推荐）」）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：方案 a 全文（删 tag / 修三缺陷 / 正式发版 0.9.4 重打）与用户逐项对过——对话内含四个根因定位与两方案取舍，用户选 a
- 复核：L1 不要求独立复核
