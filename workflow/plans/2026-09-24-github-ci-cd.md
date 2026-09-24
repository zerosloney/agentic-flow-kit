---
状态: approved
级别: L1
日期: 2026-09-24
模块: pipeline
---
# PLAN — GitHub CI/CD（Actions 测试矩阵 + tag 自动发布）

对应入口：../intents/2026-09-24-github-ci-cd.md

## 改动面
- 新增 `.github/workflows/ci.yml`：`on: push(branches:[main]) + pull_request`；matrix `{os:[ubuntu-latest, windows-latest], node:[18, 22]}` 四 job；`defaults.run.shell: bash`（windows 走 Git Bash，spawnSync('sh') 能找到 → bash 套件真实执行）；步骤 checkout@v4 → setup-node@v4（缓存关，零依赖）→ `npm test`。
- 新增 `.github/workflows/release.yml`：`on: push(tags:['v*'])`；单 job ubuntu-latest + node 22 + `registry-url: https://registry.npmjs.org/`；步骤 checkout → setup-node → 版本一致性校验（`GITHUB_REF_NAME` 去 v 前缀 ≠ package.json version 则 exit 1）→ `npm test` → `npm publish --provenance`（`permissions: contents:read + id-token:write`；`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`）。
- `package.json`：补 `repository`（git+https://github.com/zerosloney/agentic-flow-kit.git）/ `bugs` / `homepage` 三字段（M5 欠账，npm 元数据下次发布生效）。

## 验证方式
- 静态门：本地 `npm test` 全套件全绿；两 yml 经 GitHub push 后 Actions 实跑验证（CI 四组合绿 + workflow 语法被 GitHub 接受）。
- CD 验证：首次真实发布随下版本 tag 走（v0.2.1 起），本次先验证 workflow 语法与步骤逻辑（dry 视角审查）。

## 确认与复核
> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 `draft → approved` 并回填本节（确认环节的机器可见态），`done` 只在关单出现——禁从 `draft` 直跳 `done`（2026-09-22 papercut）。
- 确认结果：approved（2026-09-24 用户对话内确认 CD 取「tag 触发自动发布」方案）
- 确认门记录：CD 三档（自动发布 / 手动按钮 / 仅 CI）方案过目，用户选择 tag 自动发布
