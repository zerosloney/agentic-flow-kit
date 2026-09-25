---
状态: approved
级别: L2
日期: 2026-09-26
模块: pipeline
备注: 源自 2026-09-25 双维度审查报告改进方向第 6 条（长期建议）。用户对话内确认执行。行为保持重构：14 检查项判定语义与消息文案零变化，fixture 套件全量移植为对齐安全网；check-loop 为全局横切门禁本体且调用方 ≥5 处 → L2。
---

# INTENT — check-loop 内部结构 sh→node 迁移（消除 sh/awk 双实现维护面）

## 背景与问题
- 审查实证：check-loop.sh 已 ~850 行 POSIX sh + awk/grep 混合实现。为规避 MSYS fork 开销（历史 6 分钟误判卡死），检查 3/8 用「awk 单次预扫写临时文件 → 循环内 fd 3/4 顺序读、与 glob 序逐行对齐」手法，并立注释契约「此处必须最先读，不能落在任何 continue 之后」——重排循环/改 glob/加 continue 即静默错位；四处临时文件无 trap 清理；frontmatter 解析手写空白剥离。
- node 已是 kit 硬依赖（pre-commit 无 node 即 exit 1；全部新工具 node 化），sh/awk 双语言实现面是纯维护负担。
- Windows 无 sh 环境当前跑不了关单门第 2 步（verify fail-closed「环境无 sh 关单门不可跳过」）——迁移后该限制消失。

## 目标
- 新 `check-loop.mjs`：14 检查项全量 node 实现（零依赖），判定语义/消息文案/exit 语义与 sh 版逐条对齐（fixture 套件为对齐安全网）；frontmatter 解析 / 枚举单源（经 workflow-enums.mjs，读 `<root>/.agents/workflow-enums.txt` 保持 fixture fail-loud 契约）/ 已提交过滤（git ls-tree）/ CHECK_LOOP_ROOT 注入全保留。
- `check-loop.sh` 改 4 行兼容 shim（exec node check-loop.mjs）——.githooks/pre-push 与全部文档/适配层对「check-loop.sh」的引用零改动继续有效；shim 头注释指向 .mjs 头部（「头部注释为准」引用链保持）。
- `check-loop.test.sh` → `check-loop.test.mjs`：37 场景 fixture 全量移植（同 fixture 同关键词断言），进 node 套件常规发现（run-tests 撤 bash 套件特判块与「无 sh 跳过」警告）。
- 消费方直连 node：verify.mjs 第 2 步（撤 sh-ENOENT fail-closed 特判——node 自体运行必然在）、doctor §7（撤「先探 sh」探测——sh 依赖随迁移消失，保留 incident 注记）、gate-checklist parseCheckLoopChecks 改读 check-loop.mjs 的 `// N.` 头部注释清单（编号/标题沿用，登记表零变化）、doctor §2 布局 + `check-loop.mjs`。
- 14 检查项以 `// N. 标题 [severity]` 清单写进 .mjs 头部（沿 sh 版编号与标题，gate-checklist 登记表 id 1-14 不动）。

## 非目标
- 不改任何判定语义、消息关键词、hard/warning 分级（fixture 断言为准）；不加新检查项（gate-checklist 登记面零变化）。
- 不改 .githooks/*（pre-push 经 shim 照常；git 钩子环境自带 sh）；不改 AGENTS.md / 命令文档 prose 引用（shim 保留文件名，引用链不变；仅 test.md 中「sh …check-loop.test.sh」一处改 node 路径）。
- 不迁移 rule-budget.sh / check-pairing-incremental.sh（各自仍是 pre-commit 硬门，git 钩子 sh 环境保证）；check 13 在无 sh 环境静默跳过（advisory，pre-commit 侧照常硬拦）。

## 约束
- 零依赖；fixture 契约保持（CHECK_LOOP_ROOT / 枚举单源缺文件·缺键 fail-loud / CRLF 容忍）；双源纪律。

## 影响面
- 模块：pipeline
- 数据库：无
- 前端页面：无

## 触达红线（对照 AGENTS.md）
- [x] 规则 / 契约变更（门禁本体的实现载体与 5 处调用方接线变更；判定契约本身零变化，fixture 全量为证）→ 级别 L2

## 验收标准（可测试）
- [ ] check-loop.mjs 落位（templates + 装副本，sync 入台账）：14 检查项 `// N.` 头部清单齐（gate-checklist 登记表 1-14 校验通过）；真实仓库跑 exit 0 且警告输出与 sh 版逐类一致（对照快照）
- [ ] check-loop.test.mjs：sh 版 37 场景全量移植全绿（含枚举缺文件/缺键/CRLF、仓库模式 tracked 过滤×2、检索层接线、确认态×2、非 git 跳过）
- [ ] check-loop.sh shim：pre-push 路径实测（真实仓库经 shim 跑 exit 0）；shim 后 sh 实现面清零（awk/fd 对齐/临时文件/trap 消失——grep 证实无 awk、无 fd 3/4）
- [ ] 消费方接线：verify.mjs 第 2 步直连 node（无 sh 环境提示语更新，verify.test 6 场景全绿）；doctor §7 直连 node（撤 sh 探测，doctor.test 场景 8 不回归）；run-tests 撤 bash 特判（npm test 全套件绿）；gate-checklist --diff 登记完整 0/0
- [ ] doctor §2 布局含 `.agents/scripts/check-loop.mjs`（29 项）且 doctor 0 FAIL
- [ ] `npm test` 全绿 + `source-sync-check --diff` 0 差异 + verify 全绿 + check-loop 真实仓库 exit 0

## 确认与复核
- 确认日期：2026-09-26
- 确认人：用户（对话内「剩下的方向 6（check-loop.sh 内部结构 sh→node 迁移）」——审查报告改进方向第 6 条）
- 确认范围：sh→node 迁移 + shim + 消费方接线 + fixture 全量移植；非目标不含语义变化与 .githooks 改动
- 复核：L2 不要求新会话独立复核；fixture 套件 = 行为对齐安全网
