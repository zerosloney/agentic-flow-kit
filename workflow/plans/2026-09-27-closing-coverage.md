---
状态: done
级别: L2
模块: pipeline
确认指纹: b659e0c67ff7be83
---
# PLAN — closing-coverage

对应入口：../intents/2026-09-27-closing-coverage.md
对应 spec：../specs/2026-09-27-closing-coverage.md

## 改动面

- `templates/_agents/scripts/confirm-doc.mjs`：`--to <superseded|cancelled>` 参数 + 合法跳转表（cancelled 自 draft/approved/open/fixed；superseded 自 approved/done/fixed/closed）+ 拒绝对话；头注释/用法
- `templates/_agents/scripts/confirm-doc.test.mjs`：跳转表断言（合法 8 条 / 非法 4 条）+ `--to cancelled` 委托代录 CLI 场景（台账 stage=cancelled / prev）
- `templates/_agents/scripts/check-loop.mjs`：15 终态绑定目标集 {done, closed} → 四终态；头注释口径
- `templates/_agents/scripts/check-loop.test.mjs`：+3 场景（superseded 配对缺台账拦 / superseded 篡改终态绑定拦 / cancelled 配对+绑定一致过）
- `src/sync.mjs`：managed diskSha 读取 LF 归一（主循环 + 收养分支）
- `src/doctor.mjs`：§4 managed 比对读取归一；§6.7 adapter bodySha 归一
- `src/sync-hosts.mjs`：bodySha 正文段归一
- `templates/_agents/scripts/source-sync-check.mjs` + test：双侧 sha 归一 + CRLF 等价/内容差异双场景
- `AGENTS.md`（owned）+ `templates/AGENTS.md`：确认门条款补 `--to` 一句
- 装副本/薄适配：sync + sync-hosts --apply 下发

## 任务拆解

1. **T1 终态确认门**（confirm-doc --to + 15 四态绑定 + 测试 + 文案）
   - 判据：confirm-doc.test / check-loop.test 新场景全绿；核实本仓无 superseded/cancelled 新档（或有则逐一验证绑定不误伤）
   - 风险：中（状态机分叉——跳转表定死 + 台账可对质）
2. **T2 sha LF 归一**（五处 + sync 重记 + 克隆实证）
   - 判据：sync 后开发机 doctor §4 0 WARN（managed 本地改动清零）；临时克隆 doctor 全绿（13 份 WARN 消失）；CRLF 等价场景绿
   - 风险：低（owned 侧同款先例）
3. **T3 收口**（sync + sync-hosts + 全套回归 + feat 提交）
   - 判据：npm test 全绿；check-loop advisory 不增；gate-checklist 0 断档；预算内
   - 风险：低

## 执行顺序

T1 → T2 → T3（T1/T2 独立可并行；T3 收口）。

## 验证方式

- 静态门：npm test 全套；doctor 0 FAIL（开发机 + 临时克隆双侧）；check-loop 无新增 hard-block 且 advisory 不增；source-sync-check 0 差异
- L2 追加：`--to` 合法/非法表实测留证；克隆 doctor 对比留证；AGENTS.md 预算复核
- 回滚：单 feat 提交 revert 即回；无 schema/数据迁移

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现。
- 确认结果：approved（2026-09-27 用户对话内确认，confirm-doc --delegated 代录「可以」）；done（2026-09-27 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 推荐独立复核（independent-reviewer；采纳/驳回由用户定性）
