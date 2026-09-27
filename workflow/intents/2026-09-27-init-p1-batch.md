---
状态: approved
级别: L2
日期: 2026-09-27
模块: pipeline
备注: init 安装器审查 P1×4 收口（用户拍板「init 的 4 个 P1 优先」）：①POSIX 钩子执行位 ②全新 init 必现 owned FAIL exit 1 ③目标侧预置脚本被执行（供应链）④init 记账 raw sha 口径分叉（+add-gate 同口径 rider）。其余审查发现（看板/kb/宿主模块 P1×7 与 P2 池）留待后续批
确认指纹: 9fe8c3da82b3de24
---
# INTENT — init-p1-batch

## 背景与问题

init 安装器能力审查（independent-reviewer，线上 tarball + 本地重打包 + 临时目录实测）判 4 个 P1，用户拍板优先收口：

1. **P1-1 POSIX 全平台 git 钩子静默失效**：`.githooks/*` 在 git index 与 npm tarball 中均为 0644（实测），renderTree 落盘无 mode、全仓无 chmod——Linux/macOS 装户钩子不可执行，git 静默跳过、全部门禁失效且无报错；doctor §3 只查 `core.hooksPath` 配置值照样 PASS（失效不可发现）。本仓 Windows dogfooding（MSYS 对可读文件 access(X_OK) 恒真）从未暴露。
2. **P1-2 全新安装必现 doctor FAIL 且 exit 1**：init step 6 记 owned sha → step 7 生成器重写 `wiki/INDEX.md` / `wiki/知识沉淀总览.html`（及 workflow/INDEX.md）→ step 8 doctor §6.6（已严化 FAIL）对旧账 → 每次全新 init 以 FAIL 收场、进程 exit 1（线上 tarball 实测）。
3. **P1-3 init/doctor/sync 无条件执行目标目录预置脚本**：「文件已存在保守跳过」语义下，目标仓库预植的 `.agents/scripts/*.mjs`（gen-workflow-index / gen-wiki-board / check-loop / agg-delegations / workflows-check）被当作自己人直接执行——`npx agentic-flow-kit init` 即任意代码执行（已实测复现：预植脚本写标记文件成功）。
4. **P1-4 init 记账 raw sha 与 doctor/sync LF 归一比较口径分叉**：CRLF 检出环境下 fresh init 后 §6.6 假 FAIL（Windows 常态 AGENTS.md 即触发，线上 tarball 实测；autocrlf=true 工作树发布会投递 CRLF 模板则 26 份 owned 中 24 份漂移）。closing-coverage 复核 P2-2 同时点名 `src/add-gate.mjs:80,84` 同款——随本批一并归一（2 行 rider）。

## 目标

- POSIX 装户钩子可执行且失效可发现（落盘 chmod + 本仓 index 置位 + doctor 检查）
- 全新 init（含 CRLF 环境）以 doctor 全绿、exit 0 收场
- init/doctor/sync 执行目标侧脚本前先过包源渲染值 sha 防线，失配即跳过并可见提示；README 声明威胁模型
- init/add-gate 记账与 doctor/sync 比较同口径（LF 归一）

## 非目标

- 不收本批外的审查发现（看板 P1×3 / kb P1×1 / 宿主模块 P1×3 与 P2 池——后续批）
- 不改 sync 三态语义、owned 两态模型、--force 行为（P2-1 另立）
- 不做 tarball 发布流程 EOL 断言（P2-2 的 prepack 部分；本批以落盘侧归一覆盖主路径）
- Windows 下不引入执行位语义（doctor 检查限 POSIX 平台）

## 约束

- 引擎改动走 src/ + templates/（doctor §3 强化不改检查项编号——gate-checklist PAIRS 不动）
- sha 防线用「包源模板渲染值（LF 归一）vs 目标侧盘面（LF 归一）」比对，与 closing-coverage 六处口径同族
- README 增量控制在预算内；根 README.md 为仓库自有件
- 测试先行：临时目录实测场景（恶意预植 / CRLF 合并 / fresh init 三件套）

## 影响面

- 模块：pipeline
- 数据库：无
- 前端页面：无

## 触达红线

- [x] 规则 / 契约变更（doctor §3 执行位检查 + 三命令执行防线 + 记账口径）→ L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3

## 验收标准（可测试）

- [ ] P1-1：renderTree 对 `.githooks/*` 以 0755 落盘、sync 恢复/更新路径补 chmod、本仓 `git ls-files -s .githooks/` 全 100755；doctor §3 在非 win32 校验执行位（缺失=FAIL），win32 跳过（测试：mode 落盘断言 + 平台分支）
- [ ] P1-2：临时目录全新 init（线上同构流程）→ doctor 0 FAIL、进程 exit 0（实测留证）
- [ ] P1-3：预植恶意 `.agents/scripts/gen-workflow-index.mjs` 的目标目录跑 init/doctor/sync → 脚本不被执行（无标记文件）+ 可见跳过提示（实测留证 ×3）
- [ ] P1-4：目标目录预置 CRLF 的 AGENTS.md 跑 init → 合并记账 LF 归一，doctor §6.6 0 FAIL（实测留证）；add-gate 记账同口径（断言）
- [ ] 回归：npm test 全绿、本仓 doctor 0 FAIL / check-loop advisory 不增、临时克隆四道门绿
- [ ] README 威胁模型一行（勿在不可信仓库运行 init/doctor/sync）+ P1-3 防线说明

> **闭环对账**：关单在 test 阶段。intent 置 done 前逐条勾验，每条勾选项后补证据。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内一句"可以"即确认）
- 确认范围：三件套全文
- 复核：L2 推荐独立复核（independent-reviewer，diff 固定后执行；POSIX 行为以代码+index 位实证，实机 Linux 标注未验证范围）
