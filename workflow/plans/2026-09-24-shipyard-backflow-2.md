---
状态: approved
级别: L1
日期: 2026-09-24
模块: pipeline
---
# PLAN — Shipyard 回流第二笔：owned 台账记账策略 + 模板装副本落地 + v0.2.1 备发

对应入口：../intents/2026-09-24-shipyard-backflow-2.md

## 改动面
- `src/add-gate.mjs`：接线 local-pre-commit 写盘后同步刷新其 owned 台账条目（哈希=盘面字节；原只给门禁文件记账，接线改写不记账即漂移根因）。
- `src/sync.mjs`：owned 台账哈希按盘面自愈刷新（文件存在且哈希漂移即更新，有变化时报一行）；owned 永不覆盖语义不变。
- `src/sync.test.mjs`：S8 补「接线后 local-pre-commit 进 owned 且哈希=盘面」断言；新增 S12（手改 owned → 文件不触碰 + 台账自愈 + 刷新报告）。
- `README.md`：升级语义段补 owned 记账策略一句；路线补 v0.2.1 条目。
- `package.json`：版本 0.2.0 → 0.2.1（备发；npm publish 待用户执行）。
- 装副本落地：flow-kit sync 将 6a16a0a 已入库的 6 份模板改动（plan/design/build/test 命令 + check-loop 注释 + workflow/README）刷进 `.agents/`，本单随附 kit.json 台账更新。

## 验证方式
- 静态门：`npm test` 全套件全绿（sync 套件含 S8 扩展与 S12）。
- 实跑对账：本仓 `flow-kit sync` 输出含 6 份模板装副本覆盖更新（或已一致）；`grep -r "门禁与提交」节" templates/` 归零（templates/AGENTS.md 的节定义本身保留）；doctor 全 PASS；kit.json 版本对齐 0.2.1。

## 确认与复核
- 确认结果：approved（2026-09-24 用户对话内点名「把消费仓的改动回哺到这个源代码仓，看下效果」）
