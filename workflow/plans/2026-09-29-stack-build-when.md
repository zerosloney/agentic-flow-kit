---
状态: approved
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 plan。同名 intent 806efdf、spec 17112ca 已 approved。
确认指纹: 65bbd3cc58d13608
---
# PLAN — 技术栈构建门认脚本、帮助文本列全门禁

对应入口：../intents/2026-09-29-stack-build-when.md
对应 spec：../specs/2026-09-29-stack-build-when.md

## 任务拆解

1. `commit-check.cjs` 识别 `pkg:` 谓词，builds 在命中扩展名但 `when` 不满足时 SKIP。
   - 判据：无 `scripts.build` 时命令不执行、退出码 0、输出含该谓词；有非空 `scripts.build` 时命令执行。
   - 风险：中（与现有文件型 `when` 共用函数，旧用例必须仍绿）
2. `profiles.mjs`：node 的 build 带上谓词；python 的 builds 改为空数组。
   - 判据：`commitCheckConfig('node')` 含 `pkg:scripts.build`；`commitCheckConfig('python')` 不含 pytest。
   - 风险：低
3. `cli.mjs` 帮助文本按 `modules/gates/` 目录生成门禁列表。
   - 判据：HELP 同时含四个目录名。
   - 风险：低
4. sync 装副本。
   - 判据：`source-sync-check --gate` 对钩子与其测试无漂移。
   - 风险：低

## 风险评估

- 旧装户配置不跟着变。应对：不写迁移脚本，验收只覆盖新 init。
- 帮助文本若仍手写，下次加门禁会再落后。应对：只保留目录扫描这一处。

## 执行顺序

1 → 2 → 3 可与 1 并行 → 测试 → sync。owned 的本仓 `commit-check.config.json` 不改。

## 遗留项

- 已装项目要新谓词时，自行编辑 `commit-check.config.json`，或在空配置上重新 init。
- WP-C 及之后的工作包不在本 plan。

## 验证方式

- 静态门：`node templates/_agents/scripts/commit-check-trigger.test.mjs` 与 `node src/stack-profile.test.mjs`
- 临时目录各跑一次 `init --stack node` 与 `init --stack python`，再跑其中的 `commit-check.cjs`

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
- 复核：L2，无新会话独立复核要求
