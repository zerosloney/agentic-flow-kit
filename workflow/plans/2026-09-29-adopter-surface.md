---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 同名 intent / spec。本计划随实现一起落地，关单仍走 confirm-doc。
确认指纹: c24167b508e4b441
---
# PLAN — 装户表面收口

对应入口：../intents/2026-09-29-adopter-surface.md
对应 spec：../specs/2026-09-29-adopter-surface.md

## 改动面

- 公开说明与 CHANGELOG、workflow 协议、审计史归档
- check-loop 的 audit 开关、policy.mjs、检查 17、gate-checklist 登记
- HOSTS 三家薄适配与 Codex 技能
- 三个门禁模块、gates.test.mjs、fresh-init.test.mjs
- 本仓 kit.json 写 audit true、policyVersion 1（sync 时保留）

## 任务拆解

1. 文档与归档
   - 判据：README 不再把 0.5.1 标成待发布；归档文件存在
   - 风险：低
2. 门禁档位与检查 17
   - 判据：check-loop.test.mjs 新增场景通过，且原套件不回归
   - 风险：中（警告被误吞会让旧测试变红；缺省必须仍出警告）
3. 宿主与门禁、fresh init
   - 判据：sync-hosts 实仓漂移 0；gates 与 fresh-init 退出码符合 spec
   - 风险：中（fresh init 会跑完整 doctor）

## 执行顺序

1 → 2 → 3。templates 改完后 sync-hosts --apply，再 flow-kit sync，最后 npm test。

## 验证方式

- 静态门：`npm test`
- 不测浏览器页面

## 确认与复核

- 确认结果：approved（2026-09-29，用户对话内确认「plan已审完」，台账 ts 2026-09-29T01:18:06Z，batch d7f846）；done（待关单，随入口文档置终态）
- 独立复核：L2，不强制另开会话
- 独立复核（2026-09-30 关单前补做，independent-reviewer「衡之」）：0 P0 / 0 P1 / P2×4——结论与处置详见同名 spec「确认与复核」节
