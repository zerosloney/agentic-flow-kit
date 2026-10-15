---
name: review-method
description: 代码复核走查方法（Standards×Spec 双轴 + 坏味道清单 + 合入标尺）。供 independent-reviewer 或主智能体复核 diff 时使用；是 .agents/commands/review.md 执行流程的方法层单源，不依赖宿主全局技能。
---

# review-method — 复核走查方法

## 定位与分工
复核三层各自单源，本文件只管「怎么走查」：

| 层 | 单源 |
|---|---|
| 拦什么（不变量） | `.agents/commands/review.md` P0/P1 表 |
| 以什么身份查（证据纪律） | `.agents/roles/independent-reviewer.md` Constraints |
| 怎么走查（本文件） | 双轴框架 + 坏味道清单 + 合入标尺 |

宿主有全局 `code-review` / `review-verification-protocol` 技能时可叠加；无则本文件兜底。

## 双轴框架（分轴报告，禁合并排序）
| 轴 | 问的问题 | 依据 |
|---|---|---|
| **Standards** | 是否符合本仓成文标准 | 根/目录级 `AGENTS.md` + review.md P0/P1 表 |
| **Spec** | 是否忠实实现入口文档承诺 | intent/plan「验收标准」+ spec §测试用例 |

两轴独立成立：合规范但做错事（Standards 过、Spec 挂）与做对事但破规范（Spec 过、Standards 挂）都存在——分开报告防一轴掩盖另一轴。Spec 轴报三类发现：承诺缺失/部分落地、超范围（scope creep）、实现走样。

## 坏味道走查清单（Standards 轴补充）
P0/P1 表之外的判断项。约束：仓库成文标准优先（成文认可即压制本清单）；始终是判断项非硬违规；门禁/tooling 已拦的跳过。每条 = 是什么 $\rightarrow$ 怎么修：

| 坏味道 | 是什么 $\rightarrow$ 怎么修 |
|---|---|
| Mysterious Name 神秘命名 | 名字不揭示用途 $\rightarrow$ 重命名；起不出诚实名字 = 设计混浊 |
| Duplicated Code 重复代码 | 同形逻辑在多处出现 $\rightarrow$ 提取共享实现，两处调用 |
| Feature Envy 依恋情结 | 方法够别家数据多过自己 $\rightarrow$ 把方法移到所依恋的数据上 |
| Data Clumps 数据泥团 | 几个字段/参数总是结伴出行 $\rightarrow$ 捆成一个类型传递 |
| Primitive Obsession 基本类型偏执 | 原始值顶替领域概念 $\rightarrow$ 为概念建专属小类型 |
| Repeated Switches 重复开关 | 对同一类型的 switch/级联 if 反复出现 $\rightarrow$ 多态或共享映射 |
| Shotgun Surgery 霰弹式修改 | 一个逻辑变更迫使多文件分散编辑 $\rightarrow$ 聚拢到同一模块 |
| Divergent Change 发散式变化 | 一个模块因多个不相关原因被改 $\rightarrow$ 按单一变化理由拆分 |
| Speculative Generality 投机泛化 | 为 spec 没有的需求加抽象/参数/钩子 $\rightarrow$ 删掉内联，等真实需求出现 |
| Message Chains 消息链 | 长 `a.b().c().d()` 导航 $\rightarrow$ 在首对象上藏一个方法 |
| Middle Man 中间人 | 类/函数几乎只做转发 $\rightarrow$ 删掉，直调真目标 |
| Refused Bequest 拒绝继承 | 子类忽略/覆盖大部分继承物 $\rightarrow$ 弃继承改组合 |

性能三项（P1 分页条款之外）：N+1 查询、无界取数/循环、热路径大对象。

## 结构化修复动作
报结构问题时给命名动作，禁只说「这里复杂」让作者猜：消条件链建类型/分发器、折叠重复分支、编排与业务分离、特性逻辑移回所属层、复用权威 helper 禁近亲复制、显式类型边界消下游分支、删无澄清价值的透传包装、抽 helper 或拆大文件。

## 合入标尺（防 P2 纠缠）
确定改善整体代码健康即建议合入，不因「不是我会这么写」而拦——完美不存在，持续改进是目标。样式偏好与假设性风险禁报（证据纪律见角色契约 Constraints）。

## 出处
- 双轴框架与坏味道清单：提炼自宿主全局 `code-review` 技能（Fowler《Refactoring》ch.3 基线）。
- 结构化修复动作与合入标尺：借自 [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)（MIT）。
