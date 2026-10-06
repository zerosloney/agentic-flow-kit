---
状态: approved
级别: L2
模块: pipeline
确认指纹: caf9298505d9ed08
---
# PLAN — template-downstream

对应入口：../intents/2026-10-06-template-downstream.md
对应 spec：../specs/2026-10-06-template-downstream.md

## 改动面

- src/profiles.mjs：新增两个导出——`srcTemplatePath(pkgRoot, rel)`（包源同 rel 模板存在返回绝对路径否则 null；映射单源，renderTree 的「srcRoot/templates ↔ targetRoot/项目根」同 rel 关系即映射规则）+ `templateDriftOf({ disk, srcRecord, srcCur })`（三态判定纯函数：返回 'stale-drift' / 'custom-synced' / 'synced' / 'no-anchor'，sync 与 doctor 共用防第二份字面量——N3 教训）
- src/init.mjs：装入时段对 owned 条目写初始锚——renderTree 落盘且有包源对应的文件记 `srcSha256 = shaText(包源文件)`；ownedGenerated 生成类配置（无模板源）不写
- src/sync.mjs：owned 自愈段（:152 附近）扩展——逐条三态判定 + 末尾「模板感知」advisory 输出段（`stale-drift` 聚合出账，含 rel 清单）+ 收尾把 `srcSha256` 统一刷新为本次包源 sha；既有 `sha256`（盘面自愈）字段语义与刷新时机一字不动
- src/doctor.mjs：只读同判据 advisory（复用 `templateDriftOf`，不写 kit.json）
- 测试：sync.test.mjs +3 场景（演进未拉取 → advisory 含清单；定制跟源 → 静默；旧 schema 无锚 → 静默跳过；手工拉取 → 静默且锚刷新）、init.test.mjs +1 断言（新装 owned 模板条目带 srcSha256 且等于包源 sha）、doctor 侧断言（出账/静默且台账零写入）
- 版本收尾：package.json / kit.json → 1.1.9 + CHANGELOG

## 任务拆解

1. profiles.mjs 映射与判定单源
   - 判据：`srcTemplatePath` 存在/不存在两分支 + `templateDriftOf` 四态分支有单测覆盖
   - 风险：低（纯函数，无副作用）
2. init 初始锚
   - 判据：init.test.mjs 断言新装 kit.json 中 workflow 模板条目带 srcSha256 且等于包源文件 sha；ownedGenerated 类条目（commit-check.config.json 等）无该键
   - 风险：低（只加字段；旧 kit.json 消费方对未知键透明）
3. sync 三态判定 + advisory + 锚刷新
   - 判据：sync.test.mjs 四场景（见改动面）；既有 owned 自愈测试零改动全绿（不回归证明）
   - 风险：中（动 sync 主流程段——保守点：新逻辑独立成段插在自愈段后，不改自愈循环本体；出账恒 advisory 不改退出码）
4. doctor 只读回显
   - 判据：出账/静默断言 + doctor 运行后 kit.json 字节不变
   - 风险：低（只读）
5. 本仓自装验证 + 版本收尾
   - 判据：`node bin/flow-kit.mjs sync` 输出模板感知段（首跑为旧账 → 静默写锚，二跑构造演进场景验证出账）；npm test 全绿
   - 风险：低

## 执行顺序

1 → 2 → 3 → 4 → 5（2/3/4 均依赖 1 的单源函数；3 与 4 判定同源后可并行实现，串行做以控制 diff 审阅面）

## 验证方式

- 静态门：`npm test` 全绿（含新增 5+ 场景、既有 init/sync/doctor 套件零回归）
- 实仓冒烟：本仓 `sync` 二跑（首跑写锚 / 次跑改包源 fixture 验证出账——以测试为主，实仓只验「首跑写锚 + 输出格式」）；`git diff` 确认装户 owned 文件内容零改动（只许 kit.json 变化）

## 确认与复核

- 确认结果：approved（2026-10-06 用户对话内代录）；done（关单时随入口文档置终态）
- 确认门记录：spec 三方 sha 比对方案已在对话内过目并 approved；plan 为其函数级落点拆解，无新增行为决策
- 复核：L2 推荐独立复核（实现完成后 independent-reviewer 横切）
