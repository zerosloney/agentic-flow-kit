---
状态: draft
级别: L2
模块: pipeline
---
# PLAN — check16-inline-debt

对应入口：../intents/2026-09-29-check16-inline-debt.md
对应 spec：../specs/2026-09-29-check16-inline-debt.md

## 改动面

- `templates/_agents/scripts/check-metric-claims.mjs`（新增）：检查 16 全部逻辑自 `check-loop.mjs:735-998` 迁入；导出 `runCheck16(ctx)`；扫描集改 `ctx.docFiles` + 根级 tracked `*.md`；`countDocs` 删除，取数器改 `ctx.docFiles(sub).length`
- `templates/_agents/scripts/check-loop.mjs`：检查 16 块缩为头注释摘要 + `import` + `ctx` 组装（8 符号）+ 调用
- `templates/_agents/scripts/check-loop.test.mjs`：检查 16 既有用例适配；新增口径双向用例（未跟踪签名不出账 / add 后出账）
- `templates/_agents/scripts/confirm-doc.mjs`：`ttyForced` 双条件（`CONFIRM_DOC_TEST_TTY=1` ∧ `NODE_ENV=test`）+ 信任边界注释
- `templates/_agents/scripts/confirm-doc.test.mjs`：两处 env 注入补 `NODE_ENV: 'test'`；新增「仅设 TTY 变量、不设 NODE_ENV → 仍走非 TTY 拒绝」用例
- `workflow/regression-checklist.md`：追加本单条目
- 装副本 + `.agents/kit.json`：经 `flow-kit sync` 下发（新 managed 件入台账）

## 任务拆解

1. **T1 拆分迁移**（结构等价）
   - 判据：迁移后 `node .agents/scripts/check-loop.mjs` 全量输出与迁移前逐字节一致（本仓当前 exit 0 / 存量告警集不变）；`grep -c '数字前缀.*tracked\|/^\d/' check-loop.mjs` 中过滤链实现仅 `docFiles` 一处
   - 风险：中（迁移漂移）——以输出 diff 为空作门，不为绿而放宽
2. **T2 口径统一 + 用例**
   - 判据：`scanFiles16` 复用 `ctx.docFiles`；新增 git 仓库模式双向用例（未跟踪档含未回填签名 → 不出账；`git add` 后 → 出账）均按预期断言
   - 风险：低（行为变化已在 spec 声明并双向钉住）
3. **T3 TTY 双条件 + 用例**
   - 判据：先 grep 复核 `NODE_ENV` 无其他读者；双条件落地后 `confirm-doc.test.mjs` 全绿（含新用例：只设 TTY 变量 → 非委托非 TTY 仍拒绝）
   - 风险：低
4. **T4 sync + 真装验证**
   - 判据：`flow-kit sync` 后 `source-sync-check --diff` 0 差异、`check-ledger` 全对齐（`check-metric-claims.mjs` 入台账）；真装环境（临时目录 init）跑 shipped `check-loop.test.mjs` 全绿、`doctor` 无新增 WARN
   - 风险：中（装户 import 新文件失败——adopter-derivers P1 同型教训，必须真装跑，不信「本仓能跑」）
5. **T5 回归清单登记**
   - 判据：`workflow/regression-checklist.md` 新增本单条目（口径 tracked-only + TTY 双条件两处防复发点）

## 执行顺序

1（T1 迁移，输出 diff 为空）→ 2（T2 口径，行为变化点）→ 3（T3 独立并行）→ 4（T4 sync + 真装，依赖 1-3）→ 5（T5 收尾）。T1 与 T2 不得同批混改——先证迁移等价、再动口径，两步各自可回退。

## 验证方式

- 静态门：`npm test` 全量套件全绿
- 等价门：迁移前后 `check-loop` 全量输出 diff 为空（T1 完成时点）
- 契约面：`sync-hosts --diff` 不受影响（本次不涉薄适配）；`source-sync-check --diff` 0 差异 + `check-ledger` 全对齐
- 装户复验：真装环境 shipped 套件 + doctor（§7.x 薄适配、§4 台账）
- L2 追加：口径双向用例 + TTY 双条件用例（见 T2/T3 判据）；建议独立复核（迁移等价性为复核重点）
- UI：不涉及

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（两道门，逐次，不合并）
- 复核：L2 推荐独立复核（结构迁移等价性 + 口径行为变更），以「迁移前后输出 diff 为空 + 双向口径用例 + 真装 shipped 全绿」为证据集
