---
状态: open
级别: L1
发现: 2026-09-24
模块: pipeline
备注: 2026-09-24 用户装户实测（dsh-prompt-sparkle，PowerShell 7 + v0.3.0）报「check-loop 有 hard-block:」且原因为空；同项目 Git Bash 手动跑 check-loop exit 0——非真断档，系 doctor 环境误报。
---

# INCIDENT — 2026-09-24 doctor 把 sh ENOENT 误报成 check-loop hard-block（空原因）

## 时间线
- 2026-09-24 用户在 Windows PowerShell 7 对装户项目跑 `flow-kit init`（v0.3.0），doctor 报 `❌ check-loop 有 hard-block:` 且原因空白（doctor 7 PASS ｜ 1 FAIL）
- 同项目 Git Bash 手动 `sh .agents/scripts/check-loop.sh` → exit 0，无任何断档
- 定位：`src/doctor.mjs` 第 7 项 `spawnSync('sh', ...)` 在 PowerShell 无 sh 的环境抛 ENOENT——`cl.status=null`（≠0）落进 hard-block 分支，`cl.stderr=undefined` → `String(undefined||'')` 空原因

## 影响面
- Windows 仅 PowerShell 环境（sh 不在 PATH）的所有装户：doctor 体检第 7 项恒假 FAIL，init 收尾误导用户以为工作流骨架断档；doctor exit code 非零可能误伤以 doctor 为门的外部调用
- 真实门禁不受影响：git 钩子由 git 以自带 sh 执行，pre-commit / pre-push 照常工作

## 根因
doctor 对 `spawnSync('sh')` 的三种结局（正常 / 真断档 / ENOENT 环境不可用）只写了两个分支，ENOENT 被吞进 hard-block 分支；副因：run-tests.mjs 早有 `sh -c true` 探测先例，doctor 未对齐。

## 为什么之前没拦住
- 开发与验证环境（Git Bash 常驻）sh 永远在 PATH，ENOENT 分支从未被走到
- doctor.mjs 无测试套件，环境分支零覆盖
- check-loop 自身 fixture 充足，但调用方（doctor）的解析层是盲区

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：<见销单回填——src/doctor.mjs：先 `sh -c true` 探测，不可用 → WARN（装 Git Bash / WSL 后重跑 doctor；git 钩子不受影响）；可用才跑 check-loop，真断档维持 FAIL 带原因>
   - 影响环境：dev（本仓库 npm 包，随下一版本发布；当前 0.3.0 已发布，修复进 0.3.1/0.4.0）
   - 是否需要新 intent：否（incident 即入口，同名 plan 配对）
2. 防复发验证
   - <见销单回填：PATH 剥离 sh 的模拟环境实测 doctor 输出 WARN 而非 hard-block；真断档夹具实测 FAIL 仍带原因>
3. 流程/规范改进
   - 调用方解析层与被调脚本同等对待：凡 spawn 外部解释器（sh/node/python）先探测可用性再分流，模式对齐 run-tests.mjs
