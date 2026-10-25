---
状态: approved
级别: L2
模块: infra
确认指纹: 98ffbec90d9174f2
---
# SPEC — append-compensation 补偿行分片口径修正

对应入口：../incidents/2026-10-25-append-compensation-shard.md

## 功能行为
append-compensation.mjs 的台账写入口径改为与 confirm-doc CLI 层单源：分片默认
（CONFIRM_SHARDED=0 显式回退主台账）且 ledgerDocChainActive(loadKitPolicy(root)) 为真才落
分片 .agents/confirmations.d/<doc>.jsonl；否则（夹具无 kit.json → v1）回退主台账——
测试语义天然稳定（同 confirm-doc 回退逻辑）。补偿行与该 doc 既有确认行同域，doc 链按台账视图
接续，检查 15 末次行正确取补偿行。

## 系统改动清单
- 引擎（双落）：append-compensation.mjs（写入口径 4 行）+ append-compensation.test（夹具补
  v12 分片断言）+ engine-lock --note
- 数据库：无；前端：无

## 验收判据
| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 |
|---|---|---|
| 分片口径断言绿 | append-compensation.test | 覆盖 |
| check-loop 零 HARD-BLOCK | node .agents/scripts/check-loop.mjs | 覆盖 |
| 全量测试绿 | npm test | 覆盖 |

## 确认与复核
- 确认结果 / 确认时间写在文件头 frontmatter。
