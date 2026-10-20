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

## 校准集（golden-set.md，装户自建）
校准集是独立复核质量的已知答案样本库：正例 = 应报缺陷、负例 = 应放行，每条带「为何需本仓上下文才可判」要点（外部实证：注入仓库上下文的缺陷识别率远高于通用样本——校准集必须用本仓已闭环的 incidents/返工件构造才有校准力，通用样本不算数）。建集方法：从本仓已闭环件选样，同族第二例须带来新失败形态才入集（宁缺毋滥）；答案锚定闭环时定性，代码后续演进不改答案。使用（**双臂**）：复核员/新会话上岗前对样本盲评后对答案（命中/误报/漏报三档）自检校准差——A 臂（默认）装载本技能复核；B 臂（对照，月度抽 5–8 条即可）把同样题面交给干净会话，只给样本内联的仓库上下文、不载技能。**Δ = A 命中差 − B 命中差**是唯一能证明「上下文注入起作用」的数：两臂同样准 → 校准力来自样本内联而非技能文档；两臂同样差 → 该样本已知答案不可判——两种情形都记进留痕表「臂」列，不互相冒充。可疑判定（与已知答案不符、或与常识相悖的轻松命中）须**方差复跑**：同会话原样再评，判定翻转 → 计评分方差（题面或 rubric 有歧义），本轮不计命中差、另开 papercut 修题面；不翻转才计校准差——别让基础设施噪声冒充复核方差。月度对账抽样与 reviews.d 当月片互参（事件级计数 vs 样本级命中差，两种粒度不混算，只在备注关联）；命中差连续两月 >20% 在 papercuts 登记校准债，**前提是先剔掉方差翻转的判定**（否则评的是题面、不是复核员）。盲评结果按月落 golden-set.md「月度盲评留痕」表（列架：月份｜参评样本数｜臂｜命中/误报/漏报｜Δ｜方差复跑翻转次数｜与 reviews.d 互参谋注）。样本文件放本技能同目录 `golden-set.md`（装户数据，kit 不随包分发）；建集后在 mechanism-registry 登记一行（数据面，退役阈值参考：连续 6 个有数据月零盲评）。

## 双轴框架（分轴报告，禁合并排序）
| 轴 | 问的问题 | 依据 |
|---|---|---|
| **Standards** | 是否符合本仓成文标准 | 根/目录级 `AGENTS.md` + review.md P0/P1 表 |
| **Spec** | 是否忠实实现入口文档承诺 | intent/plan「验收标准」+ spec §测试用例 |

两轴独立成立：合规范但做错事（Standards 过、Spec 挂）与做对事但破规范（Spec 过、Standards 挂）都存在——分开报告防一轴掩盖另一轴。Spec 轴报三类发现：承诺缺失/部分落地、超范围（scope creep）、实现走样。

### 派发前自检与轴隔离

- **基准自检先行**：派复核（或自查）前 `git rev-parse <基准>` 可解析 + `git diff <基准>...HEAD` 非空——坏引用/空 diff 在派发前失败，不在两个轴的走查中途爆。
- **Spec 源发现序**：commit 消息里的 workflow 引用 → 用户给的路径 → 入口文档同名家族（intent/spec/plan）→ 都没有则问用户；找不到时 Spec 轴显式报「无 spec 可依」，禁静默跳过整轴。
- **双轴可分派隔离**：宿主支持子代理时两轴分派两个只读子代理并行走查（上下文隔离防互染），聚合时逐轴原样呈现——跨轴重排的禁令不因此放松。

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
