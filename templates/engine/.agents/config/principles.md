# 纠偏短名索引

> 用途：任务中途用短名纠偏，按指针去读权威原文。**本文件只放短名与指针，不复制规则正文**（正文单源在指针处）。
> 用法：`用「删除优先」再看一遍` / `这步按「证明它能跑」走`。
> 维护：只增删短名与指针；指针必须存在（原 principles.test.mjs 校验已随引擎测试面退役 2026-10-28，现为人工纪律），单元格不得塞正文。

| 短名 | 何时报它 | 权威指针（单源） |
|---|---|---|
| 删除优先 | 想加抽象、开关或兼容层时 | `AGENTS.md` §3 最小改动；`.agents/skills/review-method/SKILL.md` 坏味道走查 |
| 单源 | 同一事实要写第二处时 | `AGENTS.md` §3 单源纪律 |
| 守卫上下文 | 准备把长输出贴回主线时 | `AGENTS.md` §3 上下文纪律 |
| 证明它能跑 | 准备说「完成」时 | `.agents/commands/stages.md` Test §1 静态门、§3 UI 实测 |
| 解释这个数 | 要引用测量值或性能结论时 | `.agents/skills/number-vetting/SKILL.md` |
| 修根因 | 症状反复或准备加守卫时 | `.agents/commands/maintain.md` §2 结构性修复 |
| 攻击前提 | 同一前提下两种修法都过不了同一道验证时 | `.agents/commands/maintain.md` §2 攻击前提 |
| 先对齐再动手 | 接手、切 worktree、中断续作时 | `.agents/skills/session-resume/SKILL.md` |
| 可验证单元 | 拆任务、拆提交时 | `.agents/commands/stages.md` Build §3 任务清单与自验 |
| 规则要执法 | 新增规则或回归条目时 | `workflow/regression-checklist.md` 规则 7 规则-执法者配对 |
| 先升层再写文 | 想靠「写一句规范」防复发时 | `.agents/skills/papercut-fix/SKILL.md` §0 落点阶梯 |
| 不弱化旅程 | UI 实测前置条件缺失时 | `.agents/skills/verify-ui/SKILL.md`「禁为通过而弱化验证路径」 |
| 边界收口 | 校验、异常、解析要散落到各处时 | `backend/AGENTS.md` §6 项目硬约束（数据完整性 / API 契约）；`frontend/AGENTS.md` §8 规则与门禁 BC 组 |
| 可实验先跑 | 准备向用户提问前 | `.agents/commands/new-task.md` §1 提问分型 |
| 模型按角色 | 委派实现或复核前 | `.agents/config/model-roles.json`；`.agents/commands/review.md` §执行流程 |
| 爆炸半径 | 小改动但不确定还会碰坏什么时 | `.agents/skills/blast-radius/SKILL.md` |
| 决策留痕 | 长跑/无人值守要留可复核轨迹时 | `.agents/skills/show-me-your-work/SKILL.md` |
| 先问为什么 | 动手改一段不理解的代码前 | `.agents/skills/why/SKILL.md` |
| 多镜拆解 | 复核要覆盖多个风险面时 | `.agents/skills/interrogate/SKILL.md` |
| 盲评改动 | 技能/提示词改动要证据时 | `.agents/skills/eval/SKILL.md` |
| 暂停留痕 | 长跑中断/离开前要可续时 | `.agents/skills/pause-safely/SKILL.md` |
| 并行编排 | 设计选型或多切片覆盖时 | `.agents/skills/arena/SKILL.md` |
| 门轻闭环 | 想新增门/机制、扩门耗时，或发现机制纸面零使用时（用户基线 2026-10-29：门禁不能重、要简化、流程要闭环） | `workflow/gate-cost.md`（当前态单源）；`.agents/config/mechanism-registry.md`（退役棘轮） |
| 质量门兜底 | 后端改动要判断「有没有测试兜住 / 哪些方法该先补测试」时 | `.agents/skills/csharp-quality-gates/SKILL.md`（手动触发；CRAP／变异／重复三道门） |
