# 回归清单（活文档）

> 用途：deploy 清单「回归必过」与 incidents 复盘「防复发验证」的统一落点。
> 本清单是**活文档**：随模块上线补充、随 incident 追加、随功能演进修订；代码演进后以本清单与实际行为为准。

## 维护规则

1. **deploy 前**：过本清单中「涉及模块」的全部条目 + 跑自动化测试（项目防复发用例）
2. **incident 后**：防复发条目追加到「防复发验证」节，不留在 incident 文档里；能自动化的落测试用例
3. **模块上线/走查后**：为该模块补关键路径条目
4. 条目过时（功能下线/行为变更）时删除或改写，不保留失效条目
5. **新增防复发条目落点优先级**：自动化用例 > 脚本化断言 > 人工步骤（仅剩视觉/交互断言无法脚本化时）

## 回归必过

| 模块 | 条目 | 依据 |
|------|------|------|

## 防复发验证

| incident | 条目 | 落点 |
|----------|------|------|
| 2026-09-23-cjs-ext-in-typemodule | 在 `"type":"module"` 的 Node 项目装包后 commit：pre-commit 链须通过（commit-check 不崩） | 本仓库真钩子常开（每份提交自动重验） |
| 2026-09-24-review-fixes | 生成器/聚合器新增「锚点缺失」类分支必须 fail-loud 并配 fixture 用例；delegations 台账解析、wiki 生成器锚点、sync 跳过件行为随 npm test 回归 | agg-delegations.test.mjs（三场景）/ gen-wiki-board.test.mjs 场景 4-5 / sync.test.mjs S11 |
| 2026-09-24-p4-sweep | 字面量数据（标题/预算路径/命令）当正则或裸子串匹配前先加 token 边界或字面量转义；钩子异常分支先分流（ENOENT≠违例、脚本崩溃≠无违例）再报 | gen-workflow-index.test.mjs 场景 5/6 + agg-delegations.test.mjs 场景 1（npm test 随跑）；commit-msg 随本仓库每次提交重验 |
| 2026-09-24-metrics-glob-vocab | 自实现 mini 解析器（glob 等）必须校验词表边界——出表形态警告跳过，不做丢弃前缀的放宽匹配 | gen-workflow-metrics.test.mjs 场景 4（npm test 随跑） |
| 2026-09-24-npm-pack-cache-leak | 运行时生成件 `templates/_agents/cache` 不得进 npm 发布包——files 负向排除 + prepack 清除两道防线须在位，发布前 `npm pack --dry-run` 复核包清单无 cache | pack.test.mjs P1/P2（npm test 随跑）；npm 10/11 双版本 pack 实测 |
