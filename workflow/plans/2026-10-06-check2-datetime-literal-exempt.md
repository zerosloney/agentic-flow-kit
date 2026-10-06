---
状态: done
级别: L2
risk_level: L2
模块: infra
确认指纹: ef52436e504e827a
---

# PLAN — 检查 2 日期显示格式字面量豁免（回流）

对应入口：../intents/2026-10-06-check2-datetime-literal-exempt.md
对应 spec：../specs/2026-10-06-check2-datetime-literal-exempt.md

## 改动面

| # | 源仓目标（双侧） | 来源（装仓） |
|---|------|------|
| 1 | `templates/_agents/scripts/check-loop.mjs` + `.agents/scripts/check-loop.mjs` | `.agents/scripts/check-loop.mjs` |
| 2 | `templates/_agents/scripts/check-loop.test.mjs` + `.agents/scripts/check-loop.test.mjs` | `.agents/scripts/check-loop.test.mjs` |
| 3 | `package.json`（1.1.6）+ `CHANGELOG.md` | 本仓新增 |

## 执行顺序

1. 三件套 → confirm-doc approved ×3 → docs 提交
2. 复制 2 份双侧 → `flow-kit sync` 刷台账 → run-tests + gate 验证
3. version 1.1.6 + CHANGELOG → feat 提交 → 勾验 → done ×3 + delegations 落账 → docs 关单提交
4. 通知装仓侧台账对齐（装仓随其关单提交收口）

## 验证方式

- run-tests FAIL 0；gate exit 0；两仓 2 份零 diff（LF 归一 diff 实跑）
