---
状态: approved
级别: L2
模块: pipeline
确认指纹: 1eed3783ce3b10d3
---
# PLAN — gate-script-test-coverage（引擎脚本测试覆盖门）

对应入口：../intents/2026-10-01-gate-script-test-coverage.md
对应 spec：../specs/2026-10-01-gate-script-test-coverage.md

## 改动方案

- `templates/_agents/scripts/check-loop.mjs`（修改）：新增**检查 20 引擎脚本测试覆盖**（warning 级、仅包源环境：扫描 `templates/_agents/scripts/*.mjs` 排除 `*.test.mjs` 与豁免登记，缺兄弟测试→warning）；头注释检查清单同步
- `templates/_agents/scripts/check-loop.test.mjs`（修改）：检查 20 fixture（缺测试→warning / 有测试→不报 / 豁免登记→不报 / 无 templates→跳过）
- `templates/_agents/scripts/trust-mode.test.mjs`（新增）：三级语义 + 缺文件 fail-closed + `--level` 写入 + confirm-doc `--auto` e2e（Strict 拒 / Trusted 放行）
- `templates/_agents/scripts-test-exempt.txt`（新增 managed）：6 行豁免登记（格式 `脚本名 | 理由 | 覆盖证据`）
- `templates/workflow/README.md` + `workflow/README.md`（owned 对）：硬规则增补「新增引擎脚本默认必须带 `.test.mjs`，缺失由检查 20 列出；库件/工具须登记豁免」
- gate-checklist 登记表：检查 20 条目同步
- `.agents/kit.json`：sync 自动登记

## 任务拆解（L2/L3 必填）

1. 检查 20 实现 + 头注释
   - 判据：临时 fixture——缺测试脚本 → warning 含脚本名；有测试 → 不报；豁免登记 → 不报；无 templates/ → 跳过；退出码 0
   - 风险：中（新检查项需与 check-loop 既有结构一致，含头注释编号清单与 gate-checklist 登记）
2. 检查 20 fixture 用例
   - 判据：四场景用例全绿；`npm test` 全量无回退
   - 风险：低
3. trust-mode.test.mjs
   - 判据：四级断言全绿（含 confirm-doc `--auto` e2e 的 Strict 拒/Trusted 放行，台账 source=ai-auto-trust-L2 断言）
   - 风险：中（e2e 依赖 confirm-doc 行为；Strict 拒绝路径已有 solidify T3 先例）
4. 豁免文件 + 登记核对
   - 判据：6 行按 spec 初始内容落盘；`grep` 复核每行覆盖证据存在性（policy/stage-gates 被 check-loop.test import；check-metric-claims 经 check-loop 消费）
   - 风险：低
5. owned 双改 + gate-checklist 登记
   - 判据：README 对逐字一致；`node .agents/scripts/gate-checklist.mjs --diff` 显示检查 20 两侧已登记（若该工具有登记表）
   - 风险：低
6. sync + 全量验证
   - 判据：sync 后 source-sync-check 无漂移；check-loop 输出无「脚本测试缺失」存量告警（豁免+补测后零噪声）；npm test + verify.mjs 全绿
   - 风险：低

## 执行顺序（L2/L3 必填）

1 → 2 → 3 → 4（与 2/3 并行可）→ 5 → 6 收口。

## 验证计划

- 静态门：测试 = `npm test`（含新 trust-mode.test.mjs 与 check-loop 检查 20 用例）；构建 = 无
- L2 追加：检查 20 四场景 fixture 对账；豁免登记 grep 实据对账；gate-checklist --diff 口径对账；独立复核复核判据与豁免真实性
- 前端 / UI / L3：不适用

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（2026-10-01 用户对话内确认，原话「确认」——plan 全文过目）；done（关单时随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（改动方案节随 plan 全文一并过目确认）
- 复核：L2——independent-reviewer 复核检查 20 判据、豁免真实性、trust-mode.test 有效性