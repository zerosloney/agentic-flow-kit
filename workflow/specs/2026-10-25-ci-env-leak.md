---
状态: approved
级别: L2
模块: infra
确认指纹: b20cd7f7967254f2
---
# SPEC — CI 环境变量泄漏测试隔离修复

对应入口：../incidents/2026-10-25-ci-env-leak.md

## 功能行为
check-local-gate-config.test 的 run helper 显式剥 GITHUB_ACTIONS（被测 CI 分支仅场景 4 注入）；
verify.test 场景 13 改环境无关断言（恒四门；本地另含 local-gate-config）。

## 系统改动清单
- 引擎（双落）：两 test 文件各一处；无判据变化

## 验收判据
| 判据（可观察行为） | 证据（测试文件 / 命令 / 证据文件） | 状态 |
|---|---|---|
| 双环境测试绿 | npm test | 覆盖 |
| 八门全绿 | node .agents/scripts/verify.mjs | 覆盖 |

## 确认与复核
- 确认结果 / 确认时间写在文件头 frontmatter。
