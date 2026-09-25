---
状态: done
级别: L2
日期: 2026-09-26
模块: pipeline
备注: 审查报告改进方向第 6 条。L2 四节。
---

# PLAN — check-loop sh→node 迁移

## 任务拆解

1. **迁移前基线快照**：真实仓库 sh 版输出（hard/warn 全文）存档，作为迁移后 node 版对照。判据：迁移后 node 输出与快照逐类一致（条目集合相同，顺序容差）。
2. **check-loop.mjs**：14 检查项 + 头部 `// N.` 清单 + fmGet/tracked/enums(CHECK_LOOP_ROOT 契约)/git 交互。判据：真实仓库 exit 0、输出与基线一致；sh 特有 hack（awk 预扫/fd 对齐/临时文件/trap）零迁移。
3. **check-loop.test.mjs**：37 场景全量移植（枚举三场景随迁）。判据：全绿且关键词断言与 sh 版同名场景一致。
4. **shim + 消费方**：check-loop.sh 4 行 shim；verify.mjs / doctor §7 / run-tests.mjs / gate-checklist（.mjs 优先解析）/ doctor §2 +mjs / test.md 路径行。判据：verify.test 6/0、doctor.test 16/0、gate-checklist 14/0（登记表不动）。
5. **双源 + 门禁**：sync（旧 test.sh 出台账、新件入台账）+ source-sync-check 0 差 + npm test 全套件绿 + pre-push 路径经 shim 实测。判据：见验证方式。

## 风险评估

- 行为漂移 → 基线快照 + 37 场景双保险（任务 1 前置）。
- 旧装户撕裂 → shim 保留文件名 + 缺 .mjs 明确指引 sync。
- 真实仓库警告条目受当日文档状态影响 → 快照与迁移在同一工作区状态（未提交变更不进扫描）下先后采集。

## 执行顺序

1（基线先行）→ 2 → 3（对 2 逐场景验证）→ 4 → 5（收口门禁 + 提交）。

## 遗留项

- rule-budget.sh / check-pairing-incremental.sh 仍为 sh（git 钩子环境保证，无迁移收益）——留观。
- check 10 git 全量 log 的增量化（性能优化空间）——不阻塞。

## 确认与复核

- 确认结果：approved（2026-09-26 用户对话内确认执行方向 6）
- 确认时间：2026-09-26
- 复核：L2 不要求新会话独立复核；基线快照 + fixture 全量移植 = 对齐证明
