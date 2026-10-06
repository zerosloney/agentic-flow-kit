---
状态: done
级别: L2
日期: 2026-10-06
模块: pipeline
备注: 对应 intent 2026-10-06-template-downstream（workflow/ 模板下发感知机制）；方案 = 包源运行时可达 × 三态 sha 比对感知层，不改 owned 所有权语义
确认指纹: d50e892198120020
---
# SPEC — template-downstream

## 功能行为

**前提事实（本方案的地基）**：npm 包 `files` 随包分发 `templates/`（package.json files 字段实证），且 sync / doctor / init 均经包 bin（`bin/flow-kit.mjs`）运行——**包源模板在装户侧运行时可达**。因此感知不需要跨机版本号约定，包源 sha 当场可算。

场景 1｜装户 sync 时感知源仓模板演进（核心场景）
- 对 owned 台账中「包源 `templates/` 树有对应模板」的条目（workflow/ 四类 `_TEMPLATE.md`、README、AGENTS.md 等；判定规则：按 init/renderTree 既有的「模板路径 → 装户落盘路径」映射反推，包源存在同源文件即参与，映射逻辑单源复用、不另写第二份），计算三方 sha（一律 LF 归一，同 ownedSha 口径）：
  - `disk`＝装户盘面文件；`srcRecord`＝`kit.json owned[].srcSha256`（**上次 sync/init 时的包源 sha**，新字段）；`srcCur`＝本次运行时包源 sha
- 判据（三态，保证可消退）：
  - `srcCur ≠ srcRecord 且 disk ≠ srcCur` → **出账**：「模板感知（advisory）：源仓 N 份模板自上次同步后有演进且盘面未跟随：<清单>」（演进可见性即 S18 缺口的解；文案含「自上次同步以来」锚定时间语义）
  - `disk ≠ srcCur 但 srcCur == srcRecord` → 静默（装户定制且与上次源一致——owned 语义的正常态，永远不告警）
  - `disk == srcCur` → 静默（完全跟随；装户手工 cp 拉取即此态，拉取动作天然可消退出账）
- 本次 sync 收尾时 `srcSha256` 统一刷新为 `srcCur`（装户「看过」的最新源版本，与盘面是否跟随无关——与现有 owned sha「按盘面自愈」并列，两字段职责正交）

场景 2｜init 记录初始锚
- init 装户时，对有模板对应的 owned 条目写 `srcSha256` = 装入时包源 sha（复用 renderTree 落盘时机的 sha 计算，不二次读盘）

场景 3｜doctor 只读感知
- doctor 以同判据出同款 advisory，**不写台账**（doctor 与 sync 读同一 srcRecord，故 advisory 在两次 sync 之间由 doctor 持续回显，sync 后按判据自然消隐——「错过一次输出」由 echo 兜底）

场景 4｜向后兼容（旧装户）
- 既有装户 `owned[]` 无 `srcSha256` → 检查**静默跳过**（「无判定依据的行不产出告警」红线）；下一次 sync 写入锚后自动生效，不追溯、不告警缺锚

边界与异常：包源无对应模板的 owned 文件（如 `.agents/hooks/commit-check.config.json` 项目配置）不参与；包源模板文件缺失（包损）→ 该条目按无判定依据静默跳过；所有比对失败不阻断 sync/doctor 主流程（advisory 层，恒不 hard-block）。

**S18 类断链覆盖论证**：S18/S20 的操作根因是「装户没人看见模板演进」——本机制把分歧打印在 sync（装户高频动作）与 doctor（CI/体检）输出里，使「看不见」变成「每次都看得见」；随包测试对装户模板的自检命令（强制层）列非目标，待感知层运行证据充分后另案。

## 数据流

纯本地文件比对，无外部服务 / 表 / 网络：
`pkgRoot/templates/**`（包源现状）↔ `kit.json owned[].srcSha256`（上次见过源）↔ 装户盘面 `workflow/**`、`AGENTS.md` 等 owned 文件。
sha 口径 = LF 归一（与 ownedSha 自愈、rule-budgets「索引字节」同口径——papercuts 2026-09-27 行「sha 记账跨机稳定」教训，禁止盘面原始字节）。kit.json 为唯一新增持久化面（owned 条目附加可选键），无其他存储。

## 系统改动

1. `src/sync.mjs`：owned 自愈段扩展——有模板对应条目计算/刷新 `srcSha256`；输出「模板感知」advisory 段（判据见功能行为）
2. `src/init.mjs`（如 renderTree 记账在 render.mjs 则连带）：装入时写初始 `srcSha256`
3. `src/doctor.mjs`：只读同判据 advisory
4. `src/profiles.mjs` 或 `src/render.mjs`：「owned rel ↔ 包源模板路径」映射单源化（init/sync/doctor 三方复用，防第二份字面量漂移——2026-09-30 复核 N3 同款教训）
5. 测试：sync.test.mjs / init.test.mjs（及 doctor 覆盖处）+3 场景——①源演进未拉取 → advisory 出账含清单；②定制但跟源（`srcCur == srcRecord`）→ 静默；③旧 schema 无锚 → 静默跳过；另加④装户手工拉取（disk == srcCur）→ 静默且锚刷新
6. 与 plan §改动面一一对应（plan 起草时按函数级拆解）

## 约束遵守映射

- **引擎双源纪律**：改动全部落 `src/`（包源即运行体）→ 本仓自装经 `node bin/flow-kit.mjs sync` 装回验证 ✓
- **「owned 文件 sync 不动」**：不写任何装户 owned 文件内容，仅读盘比对 + 写 kit.json 台账——kit.json 记账维护正是 shipyard-backflow-2 闭环赋予 sync 的职责 ✓
- **「无判定依据的行不产出告警」红线**：三态判据全部可消退（拉取 / 下次 sync 刷新锚 / 旧账静默跳过），无不可消退形态 ✓
- **owned 哈希「记账非约束」**（shipyard-backflow-2 闭环结论）：`sha256`（盘面自愈）字段语义与刷新时机一字不动，`srcSha256` 为正交新增 ✓
- **papercuts 2026-09-27「sha 记账跨机稳定」**：全链 LF 归一，与既有六处闭合口径一致 ✓
- **常驻面预算**：命令文档零增行，机制说明入模板注释 / `src/` 内注释 ✓

## 风险评估

- 性能：N（owned 有模板对应条目 ≈ 十几份）× sha 计算，毫秒级，可忽略
- 兼容：新键对旧版 flow-kit 透明（未知 JSON 键）；旧装户静默跳过后自愈启用，无迁移
- 误报：唯一出账形态是「源真的演进了且盘面没跟」——语义即用户需要知道的；装户定制不跟源（`srcCur == srcRecord`）永不出账，故「定制不跟」装户无永久噪声
- 语义取舍（已论证）：锚采用「见过即刷新」（场景 1 收尾刷新）而非「拉取才刷新」——后者对「有意定制不跟源」的装户构成永久噪声，违反可消退红线；代价是单次演进只出一个同步周期的账，由 doctor echo 与文案「自上次同步以来」兜底
- 回滚：纯 advisory + 附加字段，revert 提交即完整回滚，无数据迁移、无破坏性
- 安全：本地 sha 比对，不触及信任边界外输入

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核（independent-reviewer，实现完成后横切）
