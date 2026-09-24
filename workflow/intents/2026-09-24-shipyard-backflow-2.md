---
状态: done
级别: L1
日期: 2026-09-24
模块: pipeline
备注: 需求来源：消费仓 Shipyard.Material 并行会话（sess_ceea0adb）交接胶囊的「仍在包侧待回哺」清单；归因补记——该会话的 6 份模板措辞修正确实已入库但被并行提交 6a16a0a（metrics 主题）一并扫入，归因混杂、内容完整，不重写历史仅此补记。
---
# INTENT — Shipyard 回流第二笔：owned 台账记账策略 + 模板装副本落地 + v0.2.1 备发

## 背景与问题
消费仓 Shipyard.Material（装户）在回流感理中发现：kit.json 的 owned 台账哈希与实件漂移，被迫手工刷新（local-pre-commit ca855027→8620c43a、commit-check.config.json dfa925dd→b74669a5）。定位根因：add-gate 接线 local-pre-commit 时改写了文件却不刷新其 owned 记账（init 按模板态记账，追加挂载行后必然停旧值）；且 owned 件手改后台账无自愈通道。另：交接清单所列待回哺项 1-3（存量确认态豁免 / 检查 14 恒 advisory / approved 立即留痕口径）经核实早已随 97a52ca 增量收包在库；6 份模板引用去死链修正已随 6a16a0a 入库但装副本未 sync。

## 目标
- add-gate 接线后刷新 local-pre-commit 的 owned 记账（哈希=写入后盘面）
- sync 对 owned 台账哈希按盘面自愈（owned 仅记账不约束，手改无须手工对账），README 语义同步
- 6 份模板改动装副本经 flow-kit sync 落地；模板内「门禁与提交」死链引用 grep 归零
- 版本 bump 0.2.1 备发（npm publish 留待用户执行）

## 影响面
- 模块：pipeline
- 数据库：无

## 验收标准（可测试）
- [x] 交接清单待回哺项 1-3 核实已在库，无须重复回流（证据：grep check-loop.sh 命中「存量确认态豁免」L769/L788-789、「恒为 advisory」L28/L768；templates/AGENTS.md:28 与 plan/design/build 的 docs(workflow) 口径齐——97a52ca 增量收包已含）
- [x] add-gate 接线后 local-pre-commit 进 owned 台账且哈希=盘面（证据：sync.test.mjs S8 扩展断言 PASS）
- [x] sync 对手改 owned 件不触碰文件、台账哈希自愈为盘面值（证据：sync.test.mjs S12 三断言 PASS；本仓 sync 实跑输出「owned 台账哈希按盘面刷新 7 份」）
- [x] 6 份模板改动装副本落地，「门禁与提交」节死链引用在 templates/ 内 grep 为 0（证据：flow-kit sync 覆盖更新 5 份 .agents/{commands×4, scripts/check-loop.sh}；grep 残留 0，templates/AGENTS.md 节定义保留）
- [x] npm test 全套件全绿；doctor 全 PASS（证据：9 套件 178 断言 ✅ 全部套件通过；doctor 8 PASS / 0 WARN）
- [x] package.json 版本 0.2.1，README 路线与升级语义同步（证据：commit f28e93a package.json 版本行；kit.json 台账版本对齐 0.2.1；README 两处更新随同提交）

## 触达红线（对照 AGENTS.md）
- 规则 / 契约变更：未触及——owned「永不覆盖」语义不变，新增的仅是记账自愈（README 已文档化）；模板改动为引用措辞与已定口径的操作化，无契约面变化
