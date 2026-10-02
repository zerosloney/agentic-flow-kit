# workflow 规模与规则面月度快照

> 生成器 `node .agents/scripts/gen-workflow-metrics.mjs`（每月或有需要时跑；同月重跑即更新该行）。明细（类型分布 / 逐条预算占用）看脚本 stdout，不落表。
> 口径：文档 = 磁盘（排除 `_TEMPLATE.md`）；常驻面 = `.agents/rule-budgets.txt` 逐条实测，括号内为「预算占用峰值项」。
<!-- GENERATED:BEGIN — gen-workflow-metrics.mjs 整段重写，手工说明写在本行之前 -->

| 月份 | 文档（活跃/终态） | 文档字节 | 模块已填/总 | 常驻面字节（预算峰值） | INDEX（活跃行） |
|---|---|---|---|---|---|
| 2026-10 | 189（活跃 2 / 终态 187） | 966.0 KB | 189/189 | 65.9 KB（峰值 99.4% .agents/commands/*.md（单篇最大）） | 1.2 KB（2 行） |

<!-- GENERATED:END -->
