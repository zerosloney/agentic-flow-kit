---
状态: done
级别: L2
模块: infra
确认指纹: 5ea73a72f401f512
---
# PLAN — CI 环境变量泄漏测试隔离修复

对应入口：../incidents/2026-10-25-ci-env-leak.md
对应 spec：../specs/2026-10-25-ci-env-leak.md

## 改动方案
- check-local-gate-config.test：run helper env 剥 GITHUB_ACTIONS（已改待提交）
- verify.test：场景 13 环境无关断言（已改待提交）

## 验证计划
本地+GITHUB_ACTIONS=true 双环境各跑两套件；npm test；verify --doc 本单

## 确认与复核
- 确认后补「确认结果 / 确认时间」；`done/fixed` 只在关单出现。
