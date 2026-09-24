---
状态: fixed
级别: L1
发现: 2026-09-24
模块: pipeline
备注: 源于全项目审查（主智能体 + Explore 子代理双路），P1/P2/P3 三档逐项修复；P4 备忘项未随本单处理。
---
# INCIDENT — 审查修复：量化台账静默吞数据 + 生成器静默跳过 + sync 基线化单周期陷阱

## 时间线
- 2026-09-24：全项目审查发现 workflow/delegations.md 自 v0.1.0 初始提交即无节结构，agg-delegations 只认 `## 委派结果` 节标题 → 实跑输出「台账为空」且 exit 0，已有委派记录被静默吞掉（量化链路断失效）
- 同日：三档修复——P1 台账解析改按表头签名识别 + 漂移 fail-loud + doctor 挂检查 + 台账文件恢复节结构；P2 gen-wiki-board 映射表/合计行锚点 fail-loud + 三脚本 ENOENT 守卫；P3 sync 跳过件停止台账基线化（持续报告语义）+ README/HELP 同步

## 影响面
- 量化链路（一次通过率/扩容门判定）整条失效且零告警——README 宣称的「数字达标前不扩并发」无从执行
- gen-wiki-board 映射表锚点缺失时静默陈旧仍报成功；drafts-archive/预算目录缺失时三个生成/校验脚本崩栈
- sync 跳过的本地改动被台账基线化，第二次升级即静默覆盖（README 未声明的单周期语义）

## 根因
三类静默失败路径共用一个模式：解析锚点（节标题/表头/目录/INDEX 锚点行）缺失时走了「当作空继续」的分支，而非 fail-loud 或按数据签名识别；sync 的台账基线化把「跳过并报告」当成「用户已处理」。

## 为什么之前没拦住
- agg-delegations 无测试（其余生成器有 fixture 测试，但恰好都没覆盖静默失败路径）；delegations.md 无类似 wiki 三方校验的机器防线
- sync 三态测试只断言了基线化行为本身（S1），未覆盖第二次升级场景；审查（双路人工 + 实跑验证）第一次暴露全链

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：ce302cd（改动清单见 ../plans/2026-09-24-review-fixes.md；装副本经 flow-kit sync 落地）
   - 影响环境：dev（v0.2.0 已发布版仍带缺陷，下次发版修复）
   - 是否需要新 intent：
     - 否 → 理由：根因属实现缺陷（静默失败分支），单点修复已完成且新增自动化用例覆盖；无规范缺位（协议文档口径本就要求报告而非静默）

2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - 自动化用例：templates/_agents/scripts/agg-delegations.test.mjs（无节标题+表头合规入账 / 数据行在表头不可识别 exit 1 / 空台账提示）；gen-wiki-board.test.mjs 场景 4/5（映射表锚点缺失 exit 1 未写盘 / drafts-archive 缺失不崩）；src/sync.test.mjs S11（二次 sync 不覆盖本地改动且持续报告）
   - 回归清单条目：workflow/regression-checklist.md（防复发验证节已追加）
   - 常驻哨兵：doctor 新增 delegations 台账结构检查项——每次 init/sync/doctor 自动重验，结构漂移即 WARN

3. 规范条目（必须有可追溯的落点）
   - 落点：workflow/regression-checklist.md §防复发验证（生成器/聚合器新增「锚点缺失」类分支必须 fail-loud 并配 fixture 用例）
   - 引用：本 incident + ../plans/2026-09-24-review-fixes.md；commit ce302cd
