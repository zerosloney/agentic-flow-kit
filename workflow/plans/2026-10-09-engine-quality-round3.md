---
状态: done
级别: L2
模块: pipeline
确认指纹: 0e4525e3230e1c61
---
# PLAN — engine-quality-round3

对应入口：../intents/2026-10-09-engine-quality-round3.md
对应 spec：../specs/2026-10-09-engine-quality-round3.md

## 改动方案

- `templates/_agents/scripts/check-loop.mjs`：新增 `export function parseAddedDatesLog(logText)`（log 文本→Map 提取，纯函数）与缓存读写 helper（`<ROOT>/.agents/cache/added-dates.json`，键=HEAD sha，原子写 tmp+rename，读写 fail-open）；addedDates IIFE 改为「rev-parse HEAD → 缓存命中？Map：gitLog 全算 + 写缓存」
- `templates/_agents/scripts/check-loop.test.mjs`：+缓存三断言（同 HEAD 命中不再全算 / HEAD 变更重算 / 缓存损坏 fail-open）——tmp git 仓，gitLog 调用计数断言
- `templates/_agents/scripts/fill-intent.mjs`：renderIntent 加 `kbHits` 可选参数（数组非空时替换「检索结果」占位行为注入列表）；main 落盘前 spawn 同目录 kb-search（`--scope workflow --type incidents,plans -n 4`，3s 超时，fail-open 保留占位）
- `templates/_agents/scripts/fill-intent.test.mjs`：+注入三断言（命中注入含 📄 行 / 零命中保留占位 / 脚本不可用 fail-open）——fixture 复制 kb-search 及依赖
- `.github/workflows/ci.yml`：install 行改 `npm ci || npm install || npm install --registry=https://registry.npmjs.org`
- `templates/_github/workflows/kit-ci.yml`：`npm ci || npm install` 尾加同款官方源兜底
- `templates/_agents/scripts/gen-workflow-metrics.mjs`：①读/写 `.agents/cache/metrics-history.jsonl`（每日一行幂等：date/docsTotal/passRate/confirmCalls/savedAt；损坏重建）；②metrics.md「闭环漏斗」节加「确认调用 N 次（环比口径：void 除外，按 ts 月度计数）」；③metrics.md 加「趋势（环比昨日）」行（docsTotal/confirmCalls 对比 history 前一日）
- `templates/_agents/scripts/gen-workflow-metrics.test.mjs`：+断言（history 幂等 / 确认负担行 / 趋势行无前值形态）
- `workflow/papercuts.md`：+2 行缓做定性（降频决策样本 1<5 / 台账锚同信任域增量≈0）

## 任务拆解

1. **T-W1 · addedDates 持久缓存**
   - 步骤：提取 parseAddedDatesLog 纯函数 → 缓存读写 helper → addedDates 接线 → 三断言测试 → `flow-kit sync`
   - 判据：check-loop.test 新三断言全绿 + 既有 237 断言零改动全绿；实仓两连跑第二次耗时显著下降（门禁段计时对照，gate-stats 记录）
   - 风险：中（缓存键正确性——HEAD sha 键 + rebase 必重算论证；坏缓存 fail-open 测试覆盖）
2. **T-W2 · fill-intent 历史坑注入**
   - 步骤：renderIntent 加 kbHits → main spawn 检索 → 三断言测试 → `flow-kit sync`
   - 判据：fill-intent.test 新三断言全绿 + 既有断言零改动；真实生成骨架含「自动注入」行（冒烟）
   - 风险：低（fail-open 全覆盖）
3. **T-W3 · registry fallback + 缓做定性**
   - 步骤：两份 yml 改装 → papercuts 两行（降频样本不足 / 台账锚同信任域）
   - 判据：yml grep 命中 registry.npmjs.org；内联语法解析通过；papercuts 两行在案
   - 风险：低
4. **T-W4 · metrics 趋势 + 确认负担**
   - 步骤：gen-workflow-metrics 加 history 读写与两行输出 → 测试补断言 → 实跑一次生成
   - 判据：gen-workflow-metrics.test 全绿（含新断言）；metrics.md 含「确认调用」与「趋势（环比昨日）」行；同日二跑 history 仍一行（幂等）
   - 风险：低（fail-open 全覆盖）
5. **T-F · 收尾**
   - 步骤：独立复核（L2）→ 全量验证矩阵 → 关单（verify --doc → 逐条精确勾验 → confirm-doc ×3）→ 提交
   - 判据：复核无 P0/P1；全量门绿；三件套 done
   - 风险：低

## 执行顺序

T-W1 → T-W2 → T-W3 → T-W4 → T-F。依赖：四工作流相互独立（各自「包源改完即 sync」）；T-F 收尾全量门。提交分组：docs(workflow) approved 留痕 → W1+W2（feat，引擎件）→ W3+W4（fix/chore）→ 关单 docs。

## 验证计划

- 静态门：`npm test`（含 lint 首步）全量 exit 0；`npx eslint .` 0 error
- L2 契约比对：`gate-checklist --diff` 登记完整；check-loop 头部清单 vs 6e96edf 逐字一致；`source-sync-check` 0 漂移；`sync-hosts --diff` 84 对 0 漂移；`doctor` 0 WARN 0 FAIL；`rule-budget --all` exit 0
- 性能对照：同 HEAD 两连跑 check-loop，第二次的检查 8 段耗时（gate-stats）对比首跑
- 独立复核：independent-reviewer 对照三件套 + diff
- 关单：verify --doc → 逐条精确勾验（禁批量替换）→ confirm-doc ×3（先 approved 留痕提交再 done——round2 前置门教训）

### 偏离留痕（对 spec / 惯例）

1. **三件套 delegated 同句**（goal 原话「按此顺序我可以直接走 L2 闭环」×N 件）：自治批次授权链，同 round2 偏离①口径，如实留痕供对质。
2. **W1 降频决策缓做**：gate-stats 有效样本 1 次（<5，聚合器自警不决策）——降频/并行化留待样本达标后按数据决策，本批只做缓存。
3. **W3 台账锚缓做**：评估结论=锚文件与台账同属本地信任域，重写者可同改锚，增量≈0；真增量需仓库外锚（CI 侧存储），记 papercuts 留用户拍板。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现。
- 确认结果：approved（2026-10-09 自治批次，授权链同 intent——用户「按此顺序我可以直接走 L2 闭环」放行优先级 1→4 + 同批趋势序列）；done（关单时随入口文档置终态）
- 确认门记录：本 plan 即改动清单（四工作流 + 收尾，文件面见改动方案）
- 复核：L2——实现完成后 independent-reviewer 独立复核
