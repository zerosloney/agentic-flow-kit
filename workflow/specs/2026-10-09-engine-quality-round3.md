---
状态: superseded
级别: L2
日期: 2026-10-09
模块: pipeline
备注: engine-quality-round3（增量缓存/kb 注入/fallback/趋势+负担）
确认指纹: 223e3a02d2a7569c
---
# SPEC — engine-quality-round3

## 功能行为

四项行为变化（S1–S4 对应 intent G-W1…G-W4），全部为引擎内部效率/质量增强，装户可见行为仅两处变化（S2 骨架多了命中行、S4 metrics.md 多两行），其余零外部行为变化：

**S1 · addedDates 持久缓存（G-W1）**
- 场景：check-loop 在 git 仓运行时，`git log --diff-filter=A --format=@%aI --name-only` 的全史解析结果按 HEAD 缓存于 `.agents/cache/added-dates.json`（`{head, map: {rel: iso}, savedAt}`）。
- 命中条件：缓存 head === 当前 `rev-parse HEAD` 且 map 非空。HEAD 变更 / 缓存缺失 / 解析失败 → 重算并尝试写回。
- 边界：缓存不可读/不可写 → fail-open 回退全算（门禁不失效）；--rev 模式下 worktree 的 HEAD 为 detached rev，与缓存键不匹配 → 自动全算（语义不变）；非 git 环境 → 无缓存路径（现状）。
- 判定零复刻：缓存只包「log 文本 → Map」提取函数（导出供测试），检查 8/10 消费 addedDates 的判据零变化。

**S2 · fill-intent 历史坑注入（G-W2）**
- 场景：`fill-intent.mjs` 落盘前以同目录 kb-search 子进程检索（关键词 = topic 的 ascii 段 + 模块名，`--scope workflow --type incidents,plans -n 4`），命中行（📄 行）替换「历史教训/防复发」节的「检索结果」占位行为：
  `- 检索结果（自动注入 N 条）：` + 每条 `  - <📄 行原文>`
- 边界：kb-search 非零/零命中/超时（3s）→ 保留原占位行 + 注释行「（自动检索不可用，手工跑：命令）」；renderIntent 增可选 kbHits 参数（数组）保持纯函数——注入拼装在 render 内、子进程调用在 main。

**S3 · registry fallback + 台账锚评估（G-W3）**
- kit-ci.yml：`npm ci || npm install` → `npm ci || npm install || npm install --registry=https://registry.npmjs.org`。
- ci.yml：`npm install` → `npm ci || npm install || npm install --registry=https://registry.npmjs.org`（npm ci 先行——lock 完整性校验优先）。
- 台账锚评估结论（写 papercuts）：锚文件与台账同属本地信任域——重写者可同改锚，增量≈0；真增量需仓库外锚（CI 侧存储），超本批范围。**缓做定性，不实装**。

**S4 · metrics 趋势序列 + 确认负担（G-W4）**
- 趋势序列：gen-workflow-metrics 每次运行向 `.agents/cache/metrics-history.jsonl` 追加/更新当日一行（`{date, docsTotal, passRate, confirmCalls, savedAt}`——同日重跑覆盖当日行，幂等）。
- 确认负担：本月 confirmations.jsonl 行数（stage=void 除外）记「确认调用 N 次」；与上月比得环比；写入 metrics.md「闭环漏斗」节新行 + 「趋势（环比昨日）」行（对比 history 前一日 docsTotal/confirmCalls）。
- 边界：history 文件损坏 → 重建（fail-open）；首日无昨日行 → 趋势行写「无前值」。

## 数据流

- S1：check-loop → rev-parse HEAD → cache 命中？Map ： git log 全算 → 写 cache → addedDateOf 消费（不变）。
- S2：fill-intent → spawn kb-search（同目录）→ 命中数组 → renderIntent(kbHits) → 骨架「历史教训」节。
- S3：CI runner → npm ci（lock 校验）→ install → 官方源兜底。
- S4：gen-workflow-metrics → 读 ledger/delegations（既有）+ history 文件（新）→ metrics.md + history 追加。

## 系统改动

| # | 文件 | 改动 |
|---|------|------|
| 1 | templates/_agents/scripts/check-loop.mjs | addedDates IIFE 改走缓存函数（新增 export 提取函数）；其余零变化 |
| 2 | templates/_agents/scripts/check-loop.test.mjs | +缓存三断言（命中/HEAD 变更重算/损坏 fail-open） |
| 3 | templates/_agents/scripts/fill-intent.mjs | renderIntent 加 kbHits；main 加 spawn 检索与占位替换 |
| 4 | templates/_agents/scripts/fill-intent.test.mjs | +注入三断言（命中/零命中/不可用） |
| 5 | .github/workflows/ci.yml + templates/_github/workflows/kit-ci.yml | registry fallback（S3） |
| 6 | templates/_agents/scripts/gen-workflow-metrics.mjs + test | 趋势序列 + 确认负担行（S4） |
| 7 | workflow/papercuts.md | +2 行缓做定性（降频决策样本不足 / 台账锚同信任域） |

引擎双源纪律：1/2/3/4/6 改 templates/ → sync；5 双侧直接改。

## 约束遵守映射

- **判定零复刻**：S1 缓存是数据获取层（log→Map），检查 8/10 判据不复制不漂移；S2 注入只动「历史教训」节占位行，模板节结构机器保证不变。
- **gate-checklist 契约**：check-loop 头部清单逐字不动。
- **测试不 weakening**：check-loop 237 / fill-intent 既有断言零改动（新增除外）。
- **缓存正确性**：键 = HEAD（同 HEAD 同祖先 → log 幂等）；重写历史（rebase）必改 HEAD → 必重算——无陈旧窗口。
- **metrics.md 生成物漂移门**：S4 输出走 gen-workflow-metrics 自身（口径单源），--check 漂移门自动覆盖。
- **常驻面预算**：本批不触 .agents/commands/*.md 与 AGENTS.md。

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| S1 缓存陈旧 | 低 | 键含完整 HEAD sha（同 commit 祖先不可变）；rebase 必改 HEAD 必重算 |
| S1 缓存文件竞态（多会话并行写） | 低 | 原子写 tmp+rename；写失败 fail-open |
| S2 spawn kb-search 拖慢 fill-intent | 低 | 3s 超时 + 零命中保留占位 |
| S4 history 文件被并发写坏 | 低 | 每日一行幂等覆盖 + 损坏重建（fail-open） |
| 回滚难度 | 低 | 四工作流相互独立，可单独 revert |

## 确认与复核

- 确认日期：2026-10-09（自治批次——授权链：用户消息「按此顺序我可以直接走 L2 闭环」）
- 复L2 独立复核已完成（2026-10-09，提交 3817ea7 后）——结论 P0=0、P1×1、P2×5，处置：P1-1 W2 关键词缺模块名（实现与批准 spec S2 不符）→ 已补模块名入关键词并对齐；P2-1 注释「最早」误述→勘误为「最新一次加入」；P2-2 fail-open 注释行已实现（spec 承诺的测试断言缺口=spawn 层无法无框架 mock，plan 偏离留痕声明）；P2-3 spec「--check 自动覆盖」说法勘误（gen-workflow-metrics 无 --check 不挂门禁，history 为本机观测面跨机不可复现属口径内）+ P2-4 shallow 陈旧窗口注记 + P2-5 固定 tmp 名并发有界自愈——均注释/声明处置。复核实测：npm test 全绿/eslint 0/doctor 14 PASS/登记完整/84 对。未验证：CI runner fallback 链实跑（push 后佐证）
