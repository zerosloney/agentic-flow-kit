---
状态: fixed
级别: L1
发现: 2026-09-26
模块: pipeline
配对: ../plans/2026-09-26-check-loop-review-fixes.md
备注: 随报随修回溯单（先例 2026-09-25-wf-run-review-fixes / 2026-09-24-doctor-sh-enoent）：双轴审查 + 修复 + 验证已同日完成于对话内，本单为提交前闭环收口。检查项编号 / severity / 清单零变更——仅修判定实现使其贴合仓库既有文档通写法，非规则面演进（L1）。遗留：sync-hosts 既有 12 对命令正文漂移 + 6 份缺失宿主适配（本单前已存在，超出范围，另行立项）。
---

# INCIDENT — 2026-09-26 check-loop 对自家文档格式的自查误报批（审查发现 P1×2 + P2×2 + P3×4）

## 时间线
- 2026-09-26 晚 用户令「审查一遍这个项目昨天和今天的提交」——主智能体双轴审查（Standards / Spec）70 提交 198 文件，实测 npm test / doctor / check-loop / source-sync-check / sync-hosts，产出 P1×2 + P2×2 + P3×4 分级清单
- 用户令「开始修问题」→ 修复批落地：check-loop 检查项 2 / 4 / 8 误报消除 + workflow-enums 注释口径 + 公共角色引用断线 + wf-runtime 证据补挂；8 个回归场景入套件
- 修复中实跑暴露次生真 bug：引用正则字符类漏逗号（`fill-{intent` 截断）——测试先红后绿抓住
- 用户令「起草」→ 立本单回溯收口（代码已落盘未提交）

## 影响面
- check-loop 全部装户（templates 包源 + 装副本 64 份同步面）：检查 2 / 4 / 8 三项判定——此前对仓库自家文档通写法（证据续行、`fill-{a,b,c}.mjs` 花括号、`fill-*.mjs` 通配、`<主题>.md` 命名示意）产生 17 条假阳性警告，advisory 噪音削弱门禁可信度；3 条 ZCode Adapter 断线警告掩盖真实断线信号
- `workflow/intents/2026-09-25-wf-runtime.md` 末条勾选项补挂证据（唯一真阳性收尾）

## 根因
判定实现与仓库自家文档通写法错位：工具按「证据须与 [x] 同行」「引用为字面路径」实现，而仓库惯例是证据另起续行、引用用花括号 / 通配简写。深层原因：2026-09-26 sh→node 迁移的安全网目标是「与 sh 版语义逐条对齐」而非「判定正确」——sh 版的误报被当基线原样移植（连缺陷也一致）。

## 为什么之前没拦住
- 37 场景迁移安全网断言的是输出文案与 exit 码（对齐基线），不是真值——基线本身错，测试全绿照旧
- doctor 只转达 check-loop 警告计数（32 条 advisory），无「工具对自家仓库自查零误报」的基线断言
- 假阳性与真断档（历史文档引用已删除文件）混排同为 advisory，未逐条核真假——噪音掩护了信号

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：随本单同一提交（templates/_agents/scripts/check-loop.mjs 检查 2 / 4 / 8 判定修正 + check-loop.test.mjs 新增 8 场景 + workflow-enums.mjs 与 workflow-enums.txt 注释口径 + templates/_agents/roles/ 三份契约引用行 + modules/hosts/ 四宿主 agents/ 12 份薄适配 + .zcode/agents/ 3 份本地装副本 + workflow/intents/2026-09-25-wf-runtime.md 证据补挂）
   - 影响环境：dev（包源 + 装副本经 flow-kit sync 同步；npm 包随下一版本发布）
   - 是否需要新 intent：否 → 理由：判定实现 bug 单点修复，检查项清单 / 编号 / severity 零变更，既有规范（检查项头部注释）已覆盖
2. 防复发验证
   - 自动化用例：check-loop.test.mjs 新增 8 场景（正反例成对）——证据续行（正：全角冒号续行不报 / 负：续行仍无证据照报）、花括号展开（正：三路存在不报 / 负：三路皆无仍报带完整展开式文案）、星号通配（正：目录有匹配不报 / 负：ghost-*.mjs 无匹配仍报）、`<主题>`.md 命名约定（正：豁免 / 负：标题占位仍拦）、薄适配角色引用（正：含引用不报断线）；套件 49 例全绿
3. 规范条目
   - 落点：回归清单 workflow/regression-checklist.md 防复发验证节追加一行（关单时落）
   - 引用：文件:templates/_agents/scripts/check-loop.mjs（检查 2 isNamingConv / 检查 4 expandRef + globExists / 检查 8 pendX 状态机）
