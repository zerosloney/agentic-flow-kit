---
状态: approved
级别: L1
日期: 2026-09-24
模块: pipeline
备注: 2026-09-24 用户对话内确认开工（「那边已经弄完了 开始搞」）。定序（2026-09-23 已留痕于 workflow/README.md）：Shipyard 引擎增量先收进包源，再整体回流。增量边界=包 v0.1.0 提交时刻（2026-09-23 21:22）之后的 Shipyard 引擎路径提交，共 3 笔：17ae8e6 / 56a1eed / 332d2a1；其工作区引擎路径已 clean。
---
# INTENT — Shipyard 引擎增量收包（抽取后 3 笔回流包源）

## 背景与问题
- M1 抽取后 Shipyard.Material 侧又对引擎做了口径演进（4 项），包源（templates/）尚无——不收进来，将来回流时会被包版本覆盖丢失。

## 目标
移植 4 项口径（语义忠实，Shipyard 专属引用通用化）：
1. check-loop 检查 14 裁定固化：恒 advisory 永不 hard-block；警告语义改为「确认后遗漏 docs 提交」提醒。
2. 新增存量出账：备注含「存量确认态豁免（…）」声明的 done 件跳过检查 14（口径同检查 8）。
3. 提交口径翻转：确认（approved）后**立即** `docs(*)` 单独提交留痕（废止「确认后只改状态不单独 commit」）——落 check-loop 注释、AGENTS.md 提交条目、plan/design「确认后」节、build.md 第 4 步。
4. 以上口径在包内通用化措辞：「根 AGENTS.md 第 5 条 / §5」→「根 AGENTS.md『门禁与提交』节」（包内无固定节号）。

## 非目标
- Shipyard.Material 回流迁移（其改为包消费者）——本任务收包完成后另立 L2。
- 332d2a1 中 workflow/* 留痕内容（Shipyard 自有文档，不移植）。
- 不动 check-loop 检查 14 之外的任何检查逻辑。

## 影响面
- 模块：pipeline；改动 templates 5 文件（check-loop.sh、AGENTS.md、commands/plan.md、build.md、design.md）→ sync 落地 .agents/ 装副本（managed）+ 本仓根 AGENTS.md（owned，手工）。
- 数据库：无；前端页面：无。

## 触达红线
- 不触及（模板内容移植，引擎检查 14 本就是 warning 级；`src/` 零改动）。

## 验收标准（可测试）
- [ ] check-loop.test.sh 34 例全绿（检查 14 语义不破坏存量用例）
- [ ] 包内 check-loop.sh 含裁定注释 + 存量确认态豁免出账行；grep 验证
- [ ] plan.md / design.md「确认后」节不再出现「不单独 commit」；build.md 第 4 步含「确认后立即 docs 提交留痕」
- [ ] AGENTS.md（模板 + 本仓根）提交条目含新口径
- [ ] npm test 7 套全绿；doctor 7 PASS；提交穿真钩子
