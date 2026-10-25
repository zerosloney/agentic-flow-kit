---
状态: open
级别: L2
发现: 2026-10-25
模块: infra
沉淀: 无
---
# INCIDENT — CI 环境变量泄漏进被测进程（v1.8.10/v1.8.11 两番发布失败同因）

## 症状
v1.8.11 release run 失败：check-local-gate-config.test 4 场景挂、verify.test 场景 13 挂——
v1.8.10 同款失败（当时未定位）。

## 根因
测试 spawnSync 透传 { ...process.env }，CI 的 GITHUB_ACTIONS=true 被测进程继承 →
check-local-gate-config 一进 loud-skip 分支，非 CI 场景（WARN/--strict/非 git）断言结构性失败；
verify 场景 13 的「未执行门」清单在 CI 里不含 local-gate-config（它 exit 0 不触发 fail-fast）。

## 防复发
1. 跨环境断言的测试须显式隔离环境面：spawnSync env 剥 GITHUB_ACTIONS，被测分支单独注入——已落 check-local-gate-config.test 场景 4 + verify.test 双环境断言（npm test 随跑）
2. 发布门（release.yml npm test）与本地全绿的差异面 = 环境变量——CI 盲区先查 env 泄漏

## 时间线
- 2026-10-25 用户确认：按「提交 打版本推送」指令链收口发布失败（对话内）

## 验收标准（可测试）
- [ ] 场景：R1 双环境（本地+GITHUB_ACTIONS=true 模拟）两套件全绿（证据：npm test）
- [ ] 场景：R2 verify --doc 八门全绿（证据：verify --doc 本单输出）
