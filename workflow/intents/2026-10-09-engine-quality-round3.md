---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-09
模块: pipeline
备注: 四工作流：W1 git索引增量缓存（降频决策样本1<5缓做）/ W2 fill-intent 历史坑强制注入 / W3 registry fallback + 台账锚缓做定性 / W4 metrics 历史序列+确认负担
确认指纹: 53ca7439f9e0ffba
---

# INTENT — engine-quality-round3

## 背景与问题

用户以上一条消息「按此顺序我可以直接走 L2 闭环」批准执行同日会话九维提升分析中的优先级清单（1→4 + 同批趋势序列）。四工作流：

- **W1（性能）git 索引增量缓存**：check-loop 的 addedDates（检查 8/10 的生效日锚数据源）每次运行全史 `git log --diff-filter=A`——ROI 实测检查 8 单段 12.6s；同 HEAD 下（verify 内 npm test+check-loop、edit-face-check、pre-commit、CI 多入口一天多次）结果幂等，可持久缓存。
- **W2（知识闭环）历史坑强制注入**：fill-intent 的「历史教训/防复发」节留的是检索命令占位，命中靠 AI 自觉执行（pipeline-run 工单已注入，手动路由没有）——机器化为生成时自动检索注入。
- **W3（安全/可靠）registry fallback + 台账锚评估**：CI npm install 无镜像故障兜底；哈希链「整文件重写可重建」边界补强方案评估。
- **W4（可观测/协作）metrics 历史序列 + 确认负担**：质量指标全是快照无趋势；确认门调用负担无量化（治理效率议题的数据前提）。

## 历史教训/防复发

- 检索结果：kb-search 命中 round2/round2-v2（哈希链与 sync-hosts 先例）、engine-quality-batch（lint/拆分先例）——本单全部沿用其纪律（判定零复刻/清单契约/双源）。
- 避坑 1（round2-v2 事故）：验收标准起草即写终态判据；勾验逐条精确编辑，禁全文替换。
- 避坑 2（round2 复核 P1-1）：冒烟一律 tmp fixture，禁写实仓台账。
- 避坑 3（gate-stats 自警）：样本 <5 只作线索不作决策——W1 的降频决策据此缓做定性。

## 目标

- **G-W1**：addedDates 持久缓存——`git log --diff-filter=A --format=@%aI --name-only` 结果按 HEAD 键缓存于 .agents/cache/added-dates.json（cache 已 gitignore）；同 HEAD 复用、HEAD 变更/缓存缺失重算、缓存不可写 fail-open 回退全算；--rev 模式语义不变。**降频决策缓做**：gate-stats 有效样本 1 次（<5，聚合器自警不决策）——定性入 plan 偏离留痕。
- **G-W2**：fill-intent 生成时自动跑 kb-search（--scope workflow --type incidents,plans，同目录子进程），命中注入「历史教训/防复发」节（替换占位行为实际命中列表，每条一行）；零命中/失败/超时 fail-open 保留占位；renderIntent 加 kbHits 参数保持纯函数可测。
- **G-W3**：CI registry fallback——kit-ci.yml `npm ci || npm install` 与 ci.yml `npm install` 均加末级 `npm install --registry=https://registry.npmjs.org` 兜底；**台账锚缓做定性**：评估结论=锚文件与台账同属本地信任域，重写者可同改锚，增量≈0——真增量需仓库外锚（CI 侧存储），超本批，记 papercuts。
- **G-W4**：gen-workflow-metrics 增两条——①趋势序列：.agents/cache/metrics-history.jsonl 每日一行幂等（date/docs/一次通过率/确认调用数），metrics.md 加「趋势（环比昨日）」行；②确认负担：本月确认门调用次数（confirmations.jsonl 按 ts 月度计数，void 行除外）+ 环比，写「闭环漏斗」节。

## 非目标（L1 微改动无实质内容可删本节，不硬填）

- 门禁降频/并行化（样本 1<5 不决策，缓做定性）。
- 台账锚实装（同信任域无增量，缓做定性）。
- 语义检索、fleet 视图、MCP 化（既有缓做定性不变）。

## 约束（L1 微改动无实质内容可删本节，不硬填）

- 判定零复刻：缓存只包「git log→Map」提取，判据消费方不变；kb 注入只替换占位行，fill-intent 模板与节结构不动（frontmatter/节标题机器保证不变量）。
- 缓存 fail-open：.agents/cache 不可读/不可写时回退全算，门禁不失效。
- 零运行时依赖；双源纪律（改 templates/ → sync）。
- 测试不 weakening：check-loop 237 / fill-intent 既有断言零改动。

## 影响面

- 模块：pipeline
- 数据库：无
- 文件面：templates/_agents/scripts/check-loop.mjs + check-loop.test.mjs（W1 缓存）/ fill-intent.mjs + fill-intent.test.mjs（W2）/ .github/workflows/ci.yml + templates/_github/workflows/kit-ci.yml（W3）/ gen-workflow-metrics.mjs + gen-workflow-metrics.test.mjs（W4）/ papercuts.md（W1/W3 缓做定性）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 或 Quick-Plan 中说明）

- [x] 规则 / 契约变更——check-loop 内部数据源改造（addedDates 缓存）+ gen-workflow-metrics 输出扩展 → L2（本单即防御道流程）
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3——未触及，不勾

## 验收标准（可测试）

- [ ] G-W1 缓存生效：tmp git 仓直测——同 HEAD 二次调用 gitLog 调用次数为 1（缓存命中）、HEAD 变更后重算、缓存文件损坏 fail-open；check-loop.test 237 断言零改动全绿
- [ ] G-W2 注入生效：fill-intent.test 新场景——fixture 语料命中注入「历史教训」节（含文件路径行）、零命中保留占位、kb-search 不可用 fail-open；真实生成骨架含命中行
- [ ] G-W3 fallback 在案：kit-ci.yml 与 ci.yml 均含 registry.npmjs.org 兜底段；papercuts 含台账锚缓做定性行（同信任域论证）
- [ ] G-W4 趋势与负担：metrics-history.jsonl 同日重跑幂等（仍一行）；metrics.md 含「确认负担」（本月调用次数+环比口径）与「趋势（环比昨日）」行；gen-workflow-metrics.test 全绿
- [ ] G-降频缓做：plan 偏离留痕含「样本 1<5 不决策」定性（gate-stats 实测样本数引用）
- [ ] 全量门：npm test 全部套件通过（含 lint 首步）；eslint 0；doctor 14 PASS 0 WARN 0 FAIL；source-sync 0 漂移；rule-budget exit 0；check-loop 仅存量 1 条 advisory；sync-hosts 84 对 0 漂移

> **闭环对账**：关单在 test 阶段。勾验逐条精确编辑补实测数据，禁止全文替换类批量操作（round2-v2 教训）。

## 确认与复核

- 确认日期：2026-10-09（自治批次——授权链：用户消息「按此顺序我可以直接走 L2 闭环」= 对同日九维分析优先级清单的对话内放行；delegated 台账逐件记该原话供对质）
- 确认人：用户（goal 指令）
- 确认范围：优先级 1→4 工作流 + 同批趋势序列（= 本 intent 目标节）
- 复核：L2——实现完成后 independent-reviewer 独立复核
