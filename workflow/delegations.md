# 量化证据台账（委派 + 自做任务）

> 目的：把「一次完成率 / 平均返工次数 / 主兜底占比 / 月度故障数」从感觉变成数字——**数字达标之前不扩并发**（门槛见 §并发扩容门槛）。
> 记法（主智能体顺手写一行，不增加用户负担）：
> - **委派结果表**：每次向子智能体/执行模型委派后追加一行。
> - **自做任务结果表**：主智能体自己完成的 **L1+ 新需求任务**，闭环时（intent→done）追加一行；**修复类不重复记**——incident 本身即故障信号，聚合脚本按月扫 `workflow/incidents/` 计数。
> - 结果列取值：`一次通过`（静态门首跑全过且复核无 P0/P1 返工）/ `返工×N`（回炉 N 次）/ `主兜底`（executor 失败、主智能体接手——委派口径专用，计返工信号）/ `返工待修`（未闭环，不计入率，单列提示）。
> 聚合：`node .agents/scripts/agg-delegations.cjs` → 输出各月指标 + 扩容门判定 + 可粘贴快照行，粘贴进 §月度聚合快照（每月一行）。聚合时顺路按「三类清理清单」巡检 AGENTS.md：代码/配置已可推导的删；只针对一次需求的细节移 wiki 或删；已被脚本/hook/测试自动保证的只留入口。
> 口径说明：合并冲突率不适用（单人串行 + 每阶段确认）；人工复核负担以「复核类委派的返工行」近似（见结果列 + 备注）。
> 调整某角色的模型指派前，先从 `workflow/incidents/` 取 3 个已定性 bug 丢给候选模型做回归对比，再拍板。

## 委派结果

| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 |
|------|----------------|------------|------|------|
| 2026-09-23 | general-purpose(子代理) | agentic-flow-kit 抽包：15 份工作流文档清洗为通用模板（7 命令占位符化 + 2 角色去项目举例 + 6 适配层清洗） | 一次通过 | 项目 token 零残留扫描通过；通用脚本引用保留完好；主智能体复核清洗范围无偏离（intent 2026-09-23-agentic-flow-kit-npx-package，2026-09-23 自发起仓库迁入） |
| 2026-09-24 | Explore(子代理) | 全项目审查扫描：引擎脚本/门禁钩子/宿主模块/文档协议对照，产出 A-F 分级发现清单 | 一次通过 | 关键指控（台账吞数据/锚点静默跳过/ENOENT 崩栈）经主智能体逐条实证复核成立，据此立 incident 2026-09-24-review-fixes |

## 自做任务结果

| 日期 | 任务一句话 | 结果 | 备注 |
|------|------------|------|------|
| 2026-09-24 | 关单 verify 固定编排脚本（npm test + check-loop 一键过门） | 一次通过 | intent closeout-verify-script；fixture 6 断言 + 真实双步绿路径实跑首跑全过 |
| 2026-09-25 | workflows 编排脚本机器 linter（解析校验先行落地）+ doctor §6.8 接线 | 一次通过 | intent 2026-09-25-workflows-linter；fixture 14 场景 + 真实仓库 baseline 断言；期间修复测试断言自身 E 码切片 bug 一次（非实现返工），实现一次通过 |
| 2026-09-25 | gate-checklist 关键词匹配退役→显式配对登记表 + --json/死代码修复 | 返工×1 | intent 2026-09-25-gate-checklist-registry；实现返工 1 次——实跑暴露小节号无尾随点解析 bug（doctorCount 8/12），正则二次修正后 14 场景全绿；真实仓库登记完整 0/0 |
| 2026-09-25 | 状态/级别枚举单源化（workflow-enums.txt + 10 处消费方归一） | 返工×1 | intent 2026-09-25-enum-single-source；实现返工 1 次——case 变量模式串 POSIX 不成立（| 是语法层 alternation，参数展开不出），实跑 69 份误报暴露后改 in_set 内建成员测试；CRLF 防御（enum_val 去 \r + 双场景）顺手落地；终态 37/0 + 20 套件全绿 |
| 2026-09-26 | 编排执行面补强（human 确认门第四形态 + wf-journal run journal） | 一次通过 | intent 2026-09-26-orchestration-journal-human；linter 15/0 + wf-journal 9/0 + 21 套件全绿首跑全过；端到端 add×3+status 实跑分层正确，演示数据已清理 |
| 2026-09-26 | check-loop sh→node 全量迁移（14 检查项 + 37 场景移植 + 5 消费方接线 + shim） | 返工×2 | intent 2026-09-26-check-loop-node；实现返工 2 次——①检查 4 漏 workflow 根级 *.md（fixture 移植实跑暴露）②.mjs 头部清单编号错位（5 并入 1 致 #7 空缺，gate-checklist 登记断档即时抓住）；终态基线快照逐行一致 + 22 套件全绿 + 净减 ~1850 行 |
| 2026-09-26 | 确认门机器化（confirm-doc TTY 脚本 + 指纹台账 + check 15） | 一次通过 | intent 2026-09-26-confirm-gate-machine；本单为流程违规复盘的机制修复，三件套逐件对话确认（bootstrap）后开工；confirm-doc 10/0 + check-loop 41/0 + 23 套件全绿首跑全过 |
| 2026-09-27 | check-loop 自查误报批修复（审查 P1×2+P2×2+P3×4 + 8 回归场景 + 适配层引用断线修复） | 返工×2 | incident 2026-09-26-check-loop-review-fixes（随报随修回溯单）；实现返工 2 次——①引用正则字符类漏逗号（`fill-{intent` 截断，场景 42 实跑红）②适配层首版脚本行尾 LF 化 + 漏 omp 宿主（sync-hosts --diff 对账暴露，改 applyForward 同款拼装重写 12+3 份）；主智能体双轴审查（子智能体供应商不可用降级亲审）+ 修复同会话；警告 32→10、check-loop 套件 49/49、doctor 12 PASS |
| 2026-09-27 | sync-hosts 适配层欠账清零（12 对 apply + 6 份新建，34 对全对齐） | 一次通过 | intent 2026-09-27-sync-hosts-adapter-backlog（incident 2026-09-26-check-loop-review-fixes 备注的遗留立项）；方向分析先行——行尾归一化 sha 比对权威源 git 全历史 12/12 命中排除手改，apply 安全；欠账根因（改权威源命令后未跑 --apply）随每次 sync-hosts --diff 非零漂移可见 |
| 2026-09-27 | 确认门对话委托代录模式（--delegated + 台账 source/quote 如实记账） | 一次通过 | intent 2026-09-27-confirm-gate-delegated（L2）；用户 5 次要求代跑被 TTY 门拒 → 问设计合理性 → 拍板「2选2」改设计；confirm-doc 13/13 + check-loop 50/50；三件套双跳用户 TTY 亲跑闭环，委托模式正式首用为同日 backlog 关单 |
| 2026-09-27 | 门禁体系加固批（审查复核 6 项：done 内容绑定 + 双源门禁接 pre-commit + 引用扫描收窄 + 配对补 spec + 边界声明） | 一次通过 | intent 2026-09-27-audit-gate-hardening（L2）；check-loop 56/0 + source-sync-check 19/0 + verify.mjs 全绿首跑全过；L2 独立复核（independent-reviewer 子代理）实证指纹互逆性 + 复跑全套，判「有条件通过」0 P0/P1（条件=用户关单追认绑定生效日切换 2026-09-28）；T2/T4 拦截探针实测留证；advisory 10→6 |
| 2026-09-27 | 机器门覆盖面补齐（incidents 确认门 + CI 服务端四道门 + quotepatch） | 返工×1 | intent 2026-09-27-gate-coverage（L2）；首提交 4652309 全绿，L2 独立复核临时克隆实证抓出 P1（CI 门在 runner 克隆必红：hooksPath / .zcode gitignore 冲突 / owned CRLF 漂移三根因）→ 2a40afb 返工收口（owned sha LF 归一 + .zcode 入库 + CI hooksPath）后克隆复跑四道门 + npm test 全绿；quotepatch 非 ASCII 探针实测；confirm-doc 15/0 + check-loop 62/0 |
| 2026-09-27 | 闭环收尾批（--to 终态确认门 + managed sha 六处 LF 归一） | 返工×1 | intent 2026-09-27-closing-coverage（L2）；实现返工 1 次——首版只归一读取侧，fresh sha 仍 CRLF（sync 23 份「本地已改」暴露），补 render.mjs 写盘归一后六处口径闭合、克隆 managed WARN 13→0（复核基线对照实证）；期间误触发 soft reset 摘掉立项提交，ORIG_HEAD 即时恢复零丢失（commit-msg 门禁拦 "wip" 试提交后清理命令时序错误的连锁，全程无内容损失）；L2 独立复核判「通过」0 P0/P1，P2-1 措辞随 a526a7f 收口；confirm-doc 19/0 + check-loop 65/0 + source-sync-check 21/0 |

## 月度聚合快照

（`node .agents/scripts/agg-delegations.cjs` 输出的可粘贴快照行落这里，每月一行）

| 月份 | 有效任务 | 一次通过率 | 平均返工 | 主兜底 | incident | 扩容门 | 备注 |
|------|----------|-----------|----------|--------|----------|--------|------|
| 2026-09 | 2 | 100% | 0.00 | 0% | 2 | ❌ 未达标项:1+4 | 样本含待修0 |

## 并发扩容门槛

连续两个月一次完成率 ≥ 90%、月度返工次数为 0 且无主兜底信号，才考虑扩大并发委派；任一不达标维持单并发。门槛判定由聚合脚本输出，两处同步修改。
