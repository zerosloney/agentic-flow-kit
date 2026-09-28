---
状态: draft
级别: L2
日期: 2026-09-28
模块: pipeline
备注: 对应 intent/plan 同名主题 opencode-cmd-wf-prefix
---
# SPEC — opencode-cmd-wf-prefix

## 功能行为

**变更前**：opencode 宿主装出的命令为 `plan` / `design` / `build` / `test` / `deploy` / `maintain` / `review` / `gate-checklist` / `new-task` / `sync-hosts` / `source-sync-check`，共 11 个，直接占用宿主顶层命令名。

**变更后**：同 11 个命令以 `wf-` 为前缀安装，命令名为 `wf-plan` / `wf-design` / … / `wf-source-sync-check`。用户视角的调用方式从 `/plan` 变为 `/wf-plan`。trae 侧行为不变（已是 `/wf-*`）。

**边界与异常**：

- `src/sync-hosts.mjs` 的 `pairsFor` 是包源侧唯一的权威源→薄适配映射函数。改后 commands 分支对两个宿主产出同构的 `wf-` 路径，差异只剩宿主目录名。
- `adapterOrphans` 的权威源反推原本硬编码 `h === 'trae' && f.startsWith('wf-')`。改后前缀反推对 `opencode` 与 `trae` 一体适用；不带前缀的 `commands` 薄适配文件按原逻辑直接猜 `commands/<file>`（反推失败时只是推测文案，不阻断）。
- `doctor.mjs` 的 `checkAdapterDrift` 是装户侧同一映射的第二份实现（bodySha 逻辑同源但代码独立）。改后两处口径一致——任一处漏改都会表现为「包源 sync 干净但装户 doctor 报漂移」或反之，因此两处与测试必须同批改。
- 存量装户：已装过旧名的项目，`flow-kit sync` 会把 `.opencode/commands/<name>.md` 判为「包内已移除（文件保留在盘上，可手动删除）」，并新增 `.opencode/commands/wf-<name>.md`。旧文件**不会自动删除**（sync 既有语义：包内已删只报告不删盘）。用户手工删除后完全等价于全新安装；不删则旧裸名命令与新前缀命令并存。

## 数据流

无数据层变更（无 schema / 无持久化 / 无网络调用）。全链路为「包源模板树 → 渲染 → 装户 `.opencode/commands/`」：

```
templates/_agents/commands/<name>.md        （权威源，正文段唯一来源）
        │  src/sync-hosts.mjs#pairsFor（映射）
        ▼
modules/hosts/opencode/commands/wf-<name>.md  （薄适配：宿主 frontmatter + 权威源正文段）
        │  src/sync.mjs#renderTree（台账三态比对）
        ▼
<target>/.opencode/commands/wf-<name>.md     （装户；旧 <name>.md 留在盘上不入新台账）
```

台账侧：`kit.json` 的 `managed` 条目按 rel 记录，重命名表现为旧 rel 出册（「包内已移除」）+ 新 rel 新增（「新增安装」），版本号对齐包版本。

## 系统改动

1. `src/profiles.mjs`（映射单源）：`HOSTS` 给 opencode / trae 两宿主加 `commandPrefix: 'wf-'` 字段。原设计里 `pairsFor`（包源侧）与 `doctor.mjs`（装户侧）两份实现各自硬编码「opencode 无前缀 + trae 有前缀」，新增命令层宿主要改两处且易漏；收敛到宿主注册表这一处后两份实现均从 `HOSTS` 派生。缺该字段的宿主（zcode / omp）自然不参与 commands 映射，语义自解释。
2. `src/sync-hosts.mjs`
   - `pairsFor`：commands 分支改为遍历带 `commandPrefix` 的宿主各产出一份 `<h>/commands/<prefix><name>.md`。
   - `adapterOrphans`：权威源反推条件由 `h === 'trae' && f.startsWith('wf-')` 改为「该宿主有 `commandPrefix` 且文件名以之开头」，opencode / trae 同口径；不带前缀的文件走原分支不变。
   - 头部注释：删去「opencode/zcode/omp 各自原描述」中关于 opencode 的表述，改为与实际一致。
3. `src/doctor.mjs`（装户侧第二份实现）
   - 新增 `HOST_CMD_DIR`（`[装副本目录名, 前缀]` 列表，由 `HOSTS` 派生）。
   - `checkAdapterDrift` 的 commands 映射改走 `HOST_CMD_DIR` 循环，roles 分支不变。
4. `modules/hosts/opencode/commands/` 11 份 `.md` 重命名为 `wf-*.md`（`git mv`，**内容不变**——frontmatter 保持仅 `description`，正文段不动）。
5. `src/sync-hosts.test.mjs`：opencode fixtures（build/test）与全部断言行路径加 `wf-`；fixture 新增带前缀孤儿 `wf-legacy.md`（原有无前缀孤儿 `orphan.md` 保留），新增 2 条断言锁死「带前缀 → 反推去前缀 / 不带前缀 → 原样反推」两条分支。
6. `templates/_agents/scripts/doctor.test.mjs`：3 处 `.opencode/commands/build.md` fixture 改名 `wf-build.md`（adapter drift 三场景：无漂移 / 有漂移 / 缺失）。装副本 `.agents/scripts/doctor.test.mjs` 经 `flow-kit sync` 刷新，不直改。
7. 口径文档：`templates/_agents/commands/sync-hosts.md` 与根 `AGENTS.md`「项目适配区」中「opencode/zcode/omp 各自原描述」一句改为「opencode / trae 同用 `wf-` 前缀，单源见 `profiles.mjs#HOSTS.commandPrefix`」。前者是权威源 → 经 `sync-hosts --apply` 同步到 2 份薄适配、经 `flow-kit sync` 刷新装副本。

## 约束遵守映射

- **引擎双源纪律**（AGENTS.md 项目适配区）：改动只落在包源 `src/` 与 `modules/hosts/`；`.agents/` 下的 managed 装副本由 `node bin/flow-kit.mjs sync` 重生成，不手改。本仓 `kit.json` 的 `options.hosts` 为 `["zcode"]`，故 sync 不触及 opencode 装副本目录。
- **跨宿主适配层同步（B-b 方案）**（AGENTS.md 项目适配区）：正文段仍为权威源单向覆盖薄适配，frontmatter 双方各自维护；本次只改**文件名契约**不动 B-b 语义本身。改完后跑 `node bin/flow-kit.mjs sync-hosts --apply` 应显示无漂移。
- **禁 `--no-verify`**（AGENTS.md 门禁与提交）：本轮不提交（用户未要求），故不触发 pre-commit；若后续提交，`git commit` 一律走钩子原路重试。
- **提交策略**（AGENTS.md 工作原则 3）：本次只改任务所需文件，不提交、不动无关的存量未提交改动（`.agents/scripts/check-loop.mjs` 等属上一任务 2026-09-28-claim-exceeds-fix，不在本任务范围）。
- **确认门**（AGENTS.md 门禁与提交）：intent/spec/plan 置 approved 走 `node .agents/scripts/confirm-doc.mjs <path> --delegated "<用户原话>"` 逐件代录；done 只在 test 阶段逐条勾验验收标准后置。

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 存量装户 opencode 用户需改调用方式（`/plan` → `/wf-plan`） | 中 | 属改名类破坏性变更，intent 与 spec 已明写；`sync` 输出「包内已移除」行即为提示，用户删旧文件即完成迁移；不自动删盘避免误删本地改动 |
| 存量装户旧裸名文件留在盘上，导致 11 个命令重名并存 | 中 | 同上；`doctor` 不覆盖此类（台账只管新 rel）。缓解建议写入 release notes |
| 包源 `pairsFor` 与装户 `doctor.mjs` 两份映射漏改一处 → 漂移误报/漏报 | 中 | 两处同批改 + `sync-hosts.test.mjs` 与 `doctor.test.mjs` 双侧断言；`npm test` 全量覆盖 |
| 孤儿反推逻辑改宽后对**不带前缀**的 opencode 遗留文件误判 | 低 | 判定条件是「宿主 ∈ {opencode, trae} 且文件名以 `wf-` 开头」，不带前缀的文件走原分支不变 |
| 重命名丢失文件内容 | 低 | 纯 `git mv` 语义，不改内容；改名后 `sync-hosts --diff` 的正文对齐对数不降即为证 |
| opencode 侧 `wf-` 与宿主/其他插件既有 `wf-*` 命令撞名 | 低 | `wf-` 是本 kit 在 trae 侧已用的前缀，两宿主各自独立命名空间内不互相影响；同宿主内若有同名第三方命令，需在 spec 风险中由使用方确认（当前未知信息，不臆断） |

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核；本次改动为纯映射逻辑 + 文件重命名，回归由 `npm test`（sync-hosts / doctor / pack / init 全套）覆盖。
