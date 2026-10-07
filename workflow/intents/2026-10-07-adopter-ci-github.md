---
状态: approved
级别: L2
risk_level: L2
日期: 2026-10-07
模块: pipeline
备注: 装户 GitHub Actions 远端门模板下发（templates/_github → .github，owned）
确认指纹: 9d5d73a7397a3483
---
# INTENT — adopter-ci-github

## 背景与问题

Anthropic「AI 原生 SDLC」基准核对（2026-10-07 会话）确认两个必修缺口：①验证机器凭证（已随 v1.2.0 落地）；②**CI 远端门**——至今未做。现状：装户从 kit 拿到的门禁全部是**本地** git hooks（pre-commit / pre-push），可被 `--no-verify` 或未配 `core.hooksPath` 的克隆绕过（本仓自身 `.github/workflows/ci.yml` 头注释对此已有论述：CI 在 runner 上复跑真实仓库门是服务端兜底）；但 kit 的 `templates/` 不下发任何远端 CI 配置，装户仓库没有云端第二道门。

用户拍板（2026-10-07 对话）：**先做 GitHub**——kit 下发装户 GitHub Actions 远端门薄模板；TFS（Azure DevOps Server）装户由用户在装户仓库**手放** `azure-pipelines.yml`（方案已在对话给出：统一入口 `node .agents/scripts/verify.mjs` + 服务端分支策略，不进模板面）。

## 历史教训/防复发

- 检索：`kb-search "模板演进 装户"` → incidents/2026-10-06 前后 S18/S20（模板演进不达装户，源仓改了装户静默陈旧）。防复发：本单新增的 owned 模板**必须带 srcSha256 感知锚**——而 `srcTemplatePath` 现只特判 `.agents/` 前缀，`.github/...` 映射不到 `templates/_github/...`（与该单复核 P2-1 同族陷阱：点前缀漏翻译 → owned 件永不参与感知），须一并泛化。
- 检索：incidents/2026-09-28-adopter-derivers（owned/managed 归属误判 → sync 永久报「本地已改」+ 门禁停摆）。防复发：CI 配置项目特定性强（触发分支 / node 版本 / 测试命令 / 私有 runner），**归 owned**，sync 永不覆盖。
- 检索：papercuts 2026-10-07（装户仓无根 package.json，verify 默认 npm test 恒 ENOENT，v1.2.1 已改显式跳过不落凭证）。防复发：CI 模板对这类装户在文件头引导 `--test-cmd`，不为它加机器逻辑。
- 零依赖纪律：不引入 YAML parser 做模板语法机器校验（结构断言 + 人工核查代替，见验收）。

## 目标

- 装户 `flow-kit init` 后获得 `.github/workflows/kit-ci.yml`：薄远端门（checkout + setup-node + `node .agents/scripts/verify.mjs`），push(main)/PR 触发，云端复跑「测试（有工程根才跑）+ check-loop」，任一非零即红——**只引用既有统一入口，不在 YAML 里复制门禁逻辑**（防本地/远端口径漂移，双源纪律同理）。
- 该件为 **owned**：装户自改分支 / node 版本 / `--test-cmd` 无 sync 压力；带模板感知锚（源演进 → sync advisory，盘面定制跟源 → 静默）。
- 存量装户 sync 时收到「新增 owned 起步文档（项目自持，未自动安装）」提示行，不自动落盘（既有 newOwned 分支零改动）。
- 文件头注释写明边界：非 GitHub 装户（TFS / Azure DevOps / Jenkins）可删除本文件；**服务端分支策略（要求 PR + 构建绿才可合并）是人工一次性配置，仓库文件带不过去、机器不校验**。

## 非目标（防止范围蔓延）

- TFS / Azure DevOps 管线模板与多 CI 宿主选项（init 加问句 / kit.json 加 ciHost 字段）——用户 TFS 装户手放，方案已留对话记录；等第 2 个真实 CI 宿主需求再泛化。
- doctor 新增「CI 在位」检查——非 GitHub 装户会常驻 advisory 噪声（audit-gate-hardening P3 教训：不可消除噪声淹没真漏点）；可发现性由 init 直装 + sync newOwned 提示覆盖。
- 分支策略自动配置 / 机器校验（服务端面）；YAML parser 依赖；对装户依赖安装策略的深度定制（模板给条件安装步骤，owned 件装户自调）。
- 本仓自身**不采用**该薄门（自有 ci.yml 六矩阵 + 五道门覆盖更全）——本仓 sync 将持续出现一行 newOwned 提示，属预期诚实出账，不做抑制。

## 约束

- 引擎双源纪律：改动一律 `templates/` + `src/`（包源），随后 `node bin/flow-kit.mjs sync` 刷 managed 装副本；owned 件（workspace AGENTS.md 等）手动同步。
- 复用既有机制零新概念：renderTree 顶层 `_` 前缀翻译（render.mjs relOf 已天然支持 `_github` → `.github`，**零改动**）；owned 台账 + 感知锚（init.mjs ownedFinal / sync.mjs driftList）；newOwned 提示（sync.mjs）；doctor §4.5 覆盖率在 `!isOwned(rel)` 处豁免（doctor.mjs:333）。
- 唯二契约点：`profiles.isOwned` 增 `.github/` 前缀（两态模型归属扩展）；`profiles.srcTemplatePath` 点前缀翻译泛化（`.agents/` 特例推广为通用「首段 `.` → `_`」，`.agents` 行为不变）。
- 不改 check-loop / verify.mjs / 门禁行为本身。

## 影响面

- 模块：pipeline
- 数据库：无
- 触达红线：规则 / 契约变更（isOwned 归属契约 + srcTemplatePath 映射契约）→ 级别 L2，specs 同名文件写明满足方式

## 触达红线（对照 AGENTS.md）

- [x] 规则 / 契约变更（isOwned 两态归属 + 感知映射泛化）→ L2，spec 说明兼容性论证（`.agents` 特例被泛化严格包含，存量行为不变）
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3

## 验收标准（可测试）

- [ ] `isOwned('.github/workflows/kit-ci.yml') === true` 且 `isOwned('.agents/notes/x.md')` 等存量断言不回归（单元）
- [ ] fresh init 夹具：目标树落盘 `.github/workflows/kit-ci.yml`，kit.json owned 含该 rel 且 `srcSha256` == 包源模板 LF 归一 sha；模板内容断言含统一入口引用（`node .agents/scripts/verify.mjs`）与分支策略人工边界提示
- [ ] sync 感知场景：源模板改一字 → 夹具 sync 出 stale-drift advisory 含该 rel；盘面定制且源未演进 → 不出账（custom-synced）
- [ ] 存量装户夹具（盘上无该件）sync：出 newOwned 提示行且不自动写盘
- [ ] `npm test` 全绿（含 templates/ 与 shipped `.agents/` 两套件）

> 运行时真值（GitHub Actions 实跑）留装户首跑验证——本仓不采用该文件、零依赖纪律不引 YAML parser，此边界在 spec 申明。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内明确放行即确认）
- 确认范围：intent 全文（含非目标与验收标准）
- 复核：L2 防御道，独立复核时机与范围在 plan 约定
