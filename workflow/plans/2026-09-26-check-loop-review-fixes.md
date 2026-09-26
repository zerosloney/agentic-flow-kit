---
状态: approved
级别: L1
模块: pipeline
配对: ../incidents/2026-09-26-check-loop-review-fixes.md
备注: 随报随修回溯单：审查报告 + 修复清单 + 验证输出已于 2026-09-26 对话内逐项呈报，用户「开始修问题」授权修复后补立本单（代码已落盘未提交）。纯 JS 仓库——构建 / 前端 / UI 验证段不适用。
---

# PLAN — check-loop 自查误报批修复（审查 P1×2 + P2×2 + P3×4）

对应入口：../incidents/2026-09-26-check-loop-review-fixes.md

## 改动面（L1 极简形态主节）

- `templates/_agents/scripts/check-loop.mjs`（包源，经 flow-kit sync 双源同步）：
  - 检查 8（P1）：证据跨行吸收——pendX 状态机，`[x]` 续行含「证据：/证据:」即清零，遇下一条目 / 小节末 / 全文末仍无证据才计缺（消 5 条假阳性）
  - 检查 4（P1）：引用支持 `fill-{a,b,c}.mjs` 花括号展开（expandRef 逐路查存在）与 `fill-*.mjs` 星号通配（globExists 目录枚举 glob 匹配），正则字符类补 `{ } * , ，`（消 4 条假阳性；字符类漏逗号致 `fill-{intent` 截断为修复中实跑暴露的次生 bug）
  - 检查 2（P2）：`<主题>` 与 `.md` 同行 = 命名约定描述豁免（isNamingConv）；真未填占位（标题 `<主题>` 无 .md）仍拦（消 8 条假阳性）
- `templates/_agents/scripts/check-loop.test.mjs`：新增场景 40-47 共 8 个，正反例成对（详见 incident 复盘三件套 2）
- `templates/_agents/scripts/workflow-enums.mjs` + `templates/_agents/workflow-enums.txt`（P3）：消费方注释口径更新——check-loop.sh 的 sh/sed 消费方已随 2026-09-26 check-loop-node 迁移退役，全部消费方统一经 node 读取器
- `templates/_agents/roles/{implementer,independent-reviewer,ui-verifier}.md`（P3）：H1 后加公共角色契约引用行（`.agents/roles/<role>.md`）——check-loop 检查 6 Adapter 断线校验的锚
- `modules/hosts/{omp,opencode,trae,zcode}/agents/` 12 份薄适配（P3）：applyForward 同款拼装（薄适配 frontmatter + 权威源正文段，行尾字节保真）同步契约引用行；`.zcode/agents/` 3 份本地装副本同源拷贝
- `workflow/intents/2026-09-25-wf-runtime.md`（P3 收尾）：末条勾选项补挂证据——证据原文在 frontmatter 备注留痕（npm test 64/0 + doctor 0 WARN + 预算 5635B），按 dc1666f 补留痕先例挂到勾选项旁（唯一真阳性）

## 验证方式

- 静态门：`npm test` 全绿（check-loop 套件 49/49 含新增 8 场景）；`flow-kit doctor` 12 PASS / 0 WARN / 0 FAIL；`source-sync-check` 64 份零差异；`sync-hosts --diff` 维持既有基线（16 对齐，本批零新增漂移）
- 判据：本仓库 check-loop 实跑警告 32 → 10——17 条三检查项假阳性 + 3 条 Adapter 断线全消；剩余 10 条均为刻意保留的历史留档项（3 条引用断档在已关单文档的历史引用 + 6 条确认态缺失为已知债，2026-09-27 确认门生效后永绝）+ doctor 计数

## 确认与复核

- 确认结果：approved（2026-09-27 用户对话内确认「可以用」——审查报告 + 修复清单 + 验证输出随报随修一次过目）；done（关单提交时回填，随 incident 置 fixed 同笔）
- 确认门记录：主智能体双轴审查（Standards / Spec，70 提交 198 文件 + 五项实测）产出分级清单 → 用户「开始修问题」授权修复 → 用户「起草」立本单 → 「可以用」确认（bootstrap 末批，单据日期 2026-09-26 按 check 15 文档日期口径豁免 TTY 门）
- 复核：L1 不要求独立复核（审查即复核——双轴报告全文对话留痕）
