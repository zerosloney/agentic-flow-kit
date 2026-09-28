---
状态: draft
级别: L2
日期: 2026-09-28
模块: pipeline
备注: opencode 命令适配改用 wf- 前缀，与 trae 对齐
---
# INTENT — opencode-cmd-wf-prefix

## 背景与问题

需求来源：用户对话内指令「opencode 命令适配改成同 trae 一样的 wf- 前缀」。

当前 4 宿主注册表（`src/profiles.mjs` `HOSTS`）下，命令层薄适配只有 trae 与 opencode 两份，但**命令名口径不一致**：

- trae：`modules/hosts/trae/commands/wf-<name>.md` + frontmatter `name: wf-<name>` → 命令名 `wf-plan`
- opencode：`modules/hosts/opencode/commands/<name>.md` + frontmatter 仅 `description` → 命令名 `plan`

后果有两处：

1. **命名空间裸露**：opencode 侧 11 个通用名（`plan` / `test` / `build` / `review` …）直接占用宿主顶层命令名，与宿主内置命令、项目自有命令、其他插件命令撞名时无法规避。trae 侧已用 `wf-` 前缀解决同一问题。
2. **维护口径分叉**：B-b 同步方案里「commands 权威源 → 两份薄适配」的映射写了两种特例（`opencode/commands/<name>.md` 与 `trae/commands/wf-<name>.md`），孤儿反推逻辑也硬编码 `h === 'trae'`（`src/sync-hosts.mjs` `pairsFor` / `adapterOrphans`）。多一处特例 = 多一处日后漏改的面。

## 目标

- opencode 命令层薄适配 11 份改为 `wf-` 前缀命名，命令名与 trae 同构。
- 薄适配映射收敛为「commands 权威源 → N 份 `wf-` 前缀适配」的单一口径，消除按宿主分叉的特例分支。
- `doctor` §7.x 装户侧漂移校验与 `sync-hosts` 包源侧同步，两处口径一致，覆盖 opencode。
- 测试锁死新口径：`sync-hosts` 与 `doctor` 两套测试的 opencode fixtures 与断言全量改前缀。

## 非目标

- 不给 opencode 命令 frontmatter 新增 `name: wf-<name>` 字段——opencode 命令名由文件名驱动，加了冗余；且 `src/sync-hosts.test.mjs` S3 场景「opencode frontmatter 保留（仍无 name 字段）」是 2026-09-25 B-b 落地时的**刻意设计断言**，不是遗漏。
- 不为存量装户做自动迁移/清理（详见「风险评估」的迁移口径）。
- 不给 zcode / omp 补命令层适配（它们当前只有角色层，本次不在范围内）。
- 不动 `roles/` 适配（4 宿主 agents 文件名不带前缀，本次不涉及）。
- 不改 trae 侧既有 11 份文件与 frontmatter。

## 约束

- 引擎改动一律改包源（`templates/` 与 `modules/hosts/`、`src/`），随后 `node bin/flow-kit.mjs sync` 刷新本仓装副本；不直改 `.agents/` 下的 managed 文件。
- 正文段同步与漂移判定仍走 B-b 语义：只比正文段 sha，frontmatter 双方各自维护。
- 保持 `sync-hosts` 三条既有语义不变：apply 不自动创建缺失薄适配、apply 不删孤儿薄适配、孤儿只报告。
- 新旧口径不留双轨：改完包源不得残留按宿主分叉的映射分支。

## 影响面

- 模块：pipeline
- 包源脚本：`src/sync-hosts.mjs`（`pairsFor` + `adapterOrphans`）、`src/doctor.mjs`（`checkAdapterDrift` 映射）
- 包源数据：`modules/hosts/opencode/commands/` 11 份 `.md` 重命名（内容不变）
- 测试：`src/sync-hosts.test.mjs`、`templates/_agents/scripts/doctor.test.mjs`（装副本经 sync 刷新）
- 装户可见：opencode 宿主下命令名由 `plan` 变为 `wf-plan` 等 11 个

## 触达红线

- [x] 规则 / 契约变更（宿主可见命令名契约 + B-b 同步映射口径）→ 级别至少 L2

> 本条即判级依据：命令名是宿主对外可见的接口契约，级别 L2，立同名 spec 写明如何满足。

## 验收标准（可测试）

- [x] `modules/hosts/opencode/commands/` 下 11 份文件全部为 `wf-<name>.md`，无残留无前缀文件（证据：`git status` 11 条 `R modules/hosts/opencode/commands/<old>.md -> .../wf-<old>.md`，git 识别为 rename 即内容零改动）
- [x] `node bin/flow-kit.mjs sync-hosts --diff` 输出「无漂移 ✅」，对齐 34 对（证据：11 commands × 2 宿主 + 3 roles × 4 宿主 = 34；输出「正文对齐：34 对 / 无漂移 ✅」，权威源缺失 0、正文漂移 0）
- [x] opencode 映射行呈现 `commands/<name>.md → opencode/commands/wf-<name>.md`（证据：`src/sync-hosts.test.mjs` S2 断言 PASS「列出 opencode/commands/wf-build.md（opencode wf- 前缀映射）」，同一 `pairsFor` 映射 plan 等全部 11 个）
- [x] 孤儿反推对 opencode 的 `wf-` 前缀文件给出正确权威源推测（证据：`src/sync-hosts.test.mjs` S8 两条新断言 PASS——「带 wf- 前缀 → 反推去掉前缀」`commands/legacy.md`、「不带前缀 → 原样反推」`commands/orphan.md`）
- [x] `npm test` 全绿（证据：补 `C:\Program Files\Git\usr\bin` 入 PATH 后「✅ 全部套件通过」；首跑 3 个套件红为 Windows PATH 无 `sh` 的环境假失败——`check-loop.test.mjs` 单跑 82/0、`gate-dotnet-ca.test.mjs` 单跑 5/0，均与本次改动无关）
- [x] `node .agents/scripts/check-loop.mjs` 无 hard-block（证据：doctor 汇总「check-loop 干净（11 条 advisory 警告）」，11 条均为存量项——模板占位残留、确认态缺失等）
- [x] `flow-kit doctor` 包源环境 §7.x skip 口径不变（证据：doctor 输出「✅ 跨宿主薄适配校验跳过（包源环境……仅在装户环境有意义）」，doctor 汇总 12 PASS / 0 WARN / 0 FAIL）

## 确认与复核

- 确认日期：
- 确认人：用户（对话内一句「可以」即确认）
- 确认范围：
- 复核：L2 推荐独立复核（本次改动面为纯映射逻辑 + 文件重命名，回归由 `npm test` 覆盖）
