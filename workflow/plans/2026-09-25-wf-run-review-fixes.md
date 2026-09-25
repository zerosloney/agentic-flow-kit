---
状态: done
级别: L1
模块: pipeline
备注: 2026-09-25 独立复核报告用户对话内确认（「照此立单修」），改动清单与复核 P0/P1 清单同口径——确认与清单一次过（随报随修单，先例 2026-09-24-doctor-sh-enoent）。
---

# PLAN — wf-run 独立复核缺陷修复（P0 prompt 截断 + P1 批）

对应入口：../incidents/2026-09-25-wf-run-review-fixes.md

## 改动面（L1 极简形态主节）
- `templates/_agents/scripts/wf-run.mjs`：
  - P0-1：prompt 传输改 **stdin 协议**——spawn 后经 child.stdin 写入完整 prompt；模板 argv 含 `{PROMPT}` 仍内联（POSIX / Windows 非 cmd 可用），但 Windows 解析为 .cmd/.bat 且 prompt 含换行 → fail-fast 明确报错（不静默截断）；内置四家 provider 模板改为无 `{PROMPT}` 的 stdin 形态（`codex exec -` / `claude -p` / `opencode run` / `zcode exec -`，以真实冒烟校准为准）
  - P1-1：错误路径也 `await settleAll()`；`agent()` 启动即入收尾链（不只在 parallel 内），fire-and-forget 派单也被等待并写台账
  - P1-3：台账 task/备注列半角 `|` 替换全角 `｜`（agg-delegations.cjs 按 split('|') 切列，不识别 `\|` 转义）
  - P1-4：新增 `providers.local.json` 侧车覆写（builtin → providers.json → providers.local.json 三层 deep-merge；local 不进模板清单，sync 天然不跟踪）
  - P2 批：`fail()` 两处 msg/hint 互换修正；BUILTIN_PROVIDERS 补 codex（与 shipped providers.json 一致）；`--concurrency/--timeout-ms` Number.isFinite 校验（NaN 死锁）；子进程输出改行缓冲前缀转发（不预写悬空 tag）；台账写入保留原文件主导行尾（CRLF 不翻写）；gate 超时后按 pid 树杀（taskkill /T，POSIX kill 进程组）
- `templates/_agents/scripts/wf-run.test.mjs`：P1-2 正则 `/^\|` 修正 + 垃圾串负例；新增 ⑧ 真实 .cmd/.bat shim fixture（Windows 实造批处理文件）端到端 stdin 协议 + 内联多行 fail-fast、⑨ 异常路径 settle 留痕、⑩ 竖线列对齐（split 口径）、⑪ providers.local.json 覆写、⑫ 非数字参数 fail-fast
- `templates/_agents/workflows/_TEMPLATE.md`：stdin 传输协议说明、providers.local.json 覆写口径、dry-run 文案改「校验 default 导出形态」（去掉与实现不符的「role 合法性」）

## 验证方式
- 静态门：`npm test` 全绿（含新增用例）；Windows 本机实跑（真实 .cmd fixture 是 P0-1 的同构威胁形态）
- 闭环：随 incident 置终态关单；真实 provider 冒烟仍挂 2026-09-25-subagent-orchestration plan 遗留项（codex 配额 10-01 恢复后补跑，stdin 协议同步校准四家内置模板）

## 确认与复核
- 确认结果：approved（2026-09-25 用户对话内确认「照此立单修」——独立复核报告 + 修复范围一次过目）；done（2026-09-25 关单随 incident 置 closed）
- 确认门记录：独立复核（independent-reviewer 子智能体）产出分级清单，主智能体对 P0-1/P1-2 二次实证后呈用户定性；随报随修单（复核报告即改动清单）
