---
状态: open
级别: L2
发现: 2026-10-25
模块: infra
沉淀: 无
---
# INCIDENT — append-compensation 补偿行落错主台账（doc 链倒挂）

## 症状
source-port-batch-2 关单后勾验补正首用补偿行通道：appendLedger 未传 shard → 补偿行落主台账
.agents/confirmations.jsonl（新建文件），而本仓（policyVersion 12）确认行生而走分片——该 doc
既有行在 .agents/confirmations.d/，补偿行错域造成：① doc 链时序倒挂（台账链断裂 HARD-BLOCK）；
② 检查 15 末次行误取（确认内容漂移假红）。

## 根因
append-compensation.mjs 直接调 appendLedger(root, r.row) 用了函数层缺省 shard=false，
未对齐 confirm-doc CLI 层「分片默认（CONFIRM_SHARDED=0 回退）+ doc 链激活（policyVersion ≥8）
才分片」的生产口径——源仓参考实现无分片机制（单台账形态），回灌时该差异点未被识别。

## 防复发
1. 跨形态回灌须核对「写入域」差异（分片/主台账、doc 链/物理链），不能只对齐判据函数
2. 补偿行通道用例补「分片仓形态」（夹具带 kit.json v8+ 断言落分片）
3. 根因在「回灌适配差异」非「补偿行判据」——bindingSha256/prev/quote 语义未被推翻

## 时间线
- 2026-10-25 用户确认：按「按照你建议来→提交 打版本推送」授权链收口 hotfix（对话内）

## 验收标准（可测试）
- [ ] 场景：R1 append-compensation 分片口径与 confirm-doc 单源（证据：append-compensation.test 夹具 v12 分片断言）
- [ ] 场景：R2 勾验补正后 check-loop 零 HARD-BLOCK（证据：本单提交前 check-loop 输出）
- [ ] 场景：R3 全量测试绿（证据：npm test 82 套件 0 失败）
