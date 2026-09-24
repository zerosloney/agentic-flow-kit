---
状态: done
级别: L1
日期: 2026-09-24
模块: pipeline
备注: 2026-09-24 用户对话内确认 CD 取「tag 触发自动发布」（npm publish --provenance，NPM_TOKEN secret 已在 GitHub 配置）。实施期间并行会话提交 shipyard-backflow-2（f28e93a/12b6620），version bump 与 INDEX 归其所有，本任务 diff 未混入。
---
# INTENT — GitHub CI/CD（Actions 测试矩阵 + tag 自动发布）

## 背景与问题
- M5（npm 发布）非目标明确「不做 npm CI/OSS 自动化（后续需要再立）」——现远程仓库已建（zerosloney/agentic-flow-kit），GitHub Secrets 已配 NPM_TOKEN，测试仍只在本机手动跑，发布仍在本机手动执行，缺持续验证与自动化发布。
- M5 欠账：package.json 无 repository/bugs/homepage 字段（当时无远程仓库，注明「后续建远程后补」）。

## 目标
- CI：`.github/workflows/ci.yml`——push(main) 与全部 PR 触发，ubuntu + windows × node 18/22 四组合跑 `npm test`；统一 bash shell 让 windows 真实执行 bash 套件（check-loop）而非跳过。
- CD：`.github/workflows/release.yml`——push tag `v*` 触发，tag 与 package.json 版本一致性门禁 → `npm test` → `npm publish --provenance`（NPM_TOKEN secret）。
- 补 package.json `repository` / `bugs` / `homepage`（M5 欠账）。

## 非目标
- 不做 GitHub Release / CHANGELOG 自动生成；不动版本号（下版本发布时随 tag 走）。
- 不把 CI 模板放进 templates/ 分发给装户（装户项目平台不一，未要求）。

## 影响面
- 模块：pipeline；改动：新增 `.github/workflows/` 两文件 + package.json 元数据三字段。
- 数据库：无

## 触达红线
- 不触及（CI/CD 管线配置，不动规则契约、不动引擎逻辑）。

## 验收标准（可测试）
- [x] push 后 GitHub Actions CI 四组合全绿（含 windows 实际执行 bash 套件，日志无「跳过」提示）（证据：Actions run 35949854368——ubuntu/windows × node 18/22 四 job ✓，windows 日志含「check-loop.test.sh（bash 套件）」段且无「环境无 sh」警告、终局「✅ 全部套件通过」）
- [x] release workflow 含版本一致性校验步骤（tag ≠ package.json version 时 fail-fast 不发布）（证据：release.yml「校验 tag 与 package.json 版本一致」步骤（469ebe6）；动态验证随首次版本 tag 实跑，plan 已声明）
- [x] package.json 含 repository/bugs/homepage 三字段且指向 zerosloney/agentic-flow-kit（证据：commit 469ebe6，diff 纯三字段新增）
- [x] 本地 `npm test` 全绿（证据：本地实跑「合计: PASS 34 / FAIL 0 ✅ 全部套件通过」，2026-09-24）
