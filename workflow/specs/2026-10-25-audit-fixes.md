---
状态: approved
级别: L2
模块: infra
确认指纹: 36b0c400f88e3c71
---
# SPEC — 流程自审修复批

对应入口：../incidents/2026-10-25-audit-fixes.md

## 功能行为
① check-local-gate-config 判据③改验两行（.agents/*.jsonl 与 .agents/confirmations.d/*.jsonl 各一行
merge=jsonl-union）；测试夹具同步两行。② workflow-enums.txt：incident.status.all 扩为
open fixed closed superseded cancelled、新增 incident.status.abandoned=superseded cancelled；
检查 3 文案改动态枚举；stage-gates 的入口确认集 = all 减 abandoned（语义与 doc 侧
ENTRY_STATUSES=confirmed 减 abandoned 对称，incidents 无 confirmed 键故派生）；消费方
workflow-enums.mjs REQUIRED_KEYS 增键。③ README「存量装户迁移指引」补 deploy-observations 条
（主表 owned 不随 sync 下发、deploy.md §6 落账依赖它在场）。④ release.yml publish 前加
「CI conclusion 门」步骤：gh api 查该 SHA 的 ci workflow 最新 run，非 success 拒发。

## 系统改动清单
- 引擎（双落）：check-local-gate-config.mjs（+test）、workflow-enums.txt（模板+自举）、
  check-loop.mjs（检查 3 文案一行）、stage-gates.mjs（INCIDENT_STATUSES 派生一行）
- 配置：.gitattributes（本仓补第二行）；.github/workflows/release.yml + templates/_github（若有同构）
- 文档：README 迁移指引条（其余文档对齐批另行 docs 提交）

## 验收判据
| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 |
|---|---|---|
| 两行口径门+测试绿 | npm test | 覆盖 |
| 放弃态 WARN 消除 | npm test | 覆盖 |
| 八门全绿 | node .agents/scripts/verify.mjs | 覆盖 |

## 确认与复核
- 确认结果 / 确认时间写在文件头 frontmatter。
