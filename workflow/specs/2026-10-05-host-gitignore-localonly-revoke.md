---
状态: approved
级别: L2
日期: 2026-10-05
模块: pipeline
备注: 撤销 zcode/omp 的 localOnly 档位；与 intent / plan 同名配对
确认指纹: 801a74dd850bab26
---
# SPEC — host-gitignore-localonly-revoke

对应入口：../intents/2026-10-05-host-gitignore-localonly-revoke.md

## 功能行为

### 改前

`src/profiles.mjs#HOSTS` 中 zcode 与 omp 标 `localOnly: true`，其余五宿主 `localOnly: false`。`init` 与 `add-host` 据此把选中宿主的目录名整条写进装户 `.gitignore`：

```
# agentic-flow-kit
.agents/cache/
.zcode/
```

结果是装户的薄适配 `agents/*.md`（managed 台账件）被 git 忽略，`git clone` 出的 CI runner 拿不到，doctor 的 managed 台账校验与 check-loop 的跨宿主薄适配 sha 比对会失配。

### 改后

七个宿主一律 `localOnly: false`。`init` 的 `.gitignore` 追加清单实际只剩 `.agents/cache/` 一条（运行时缓存，与宿主无关）；`add-host` 的 localOnly 分支保留但无宿主命中。

装户口径变为：

- **入库**：各宿主薄适配 `<host>/agents/*.md`、`<host>/commands/*.md`、trae 专属 `hooks/` `rules/`、codex 的 `skills/flow-kit/`——与本仓 2026-09-27 gate-coverage 返工后的形态一致；
- **不入库**：`.agents/cache/`（init 自动写）、`.agents/trust-mode.json`（本仓手写）、zcode 会话级液态草稿 `.zcode/drafts/`、`.zcode/plans/`（**改由装户自管**，README 已给实例）。

### 保留的结构

`localOnly` 字段**不从 `HOSTS` 删除**，`init.mjs` / `add-host.mjs` 的分支代码也不删。判定单源仍是 `profiles.mjs#HOSTS.localOnly`；未来若重开「本机专属宿主」档位（例如某宿主装出大量本机态文件），只需改这一处表项，两处消费点自动跟随。

## 数据流

```
flow-kit init --hosts <逗号分隔>
  → src/cli.mjs 解析 argv
  → src/profiles.mjs#HOSTS 查表得 hosts[] 与每宿主的 localOnly
  → src/init.mjs 渲染 templates/ 树 + modules/hosts/<h>/ 树到 HOSTS[h].dir
  → src/init.mjs 第 4 步：giNeed = ['.agents/cache/', ...hosts.filter(localOnly).map(dir + '/')]
  → 缺失行追加进 <target>/.gitignore
  → src/doctor.mjs 校验台账 / 钩子 / 薄适配漂移

flow-kit add-host <h>
  → src/add-host.mjs 渲染 modules/hosts/<h> → HOSTS[h].dir
  → managed 台账按 rel 去重补记 + options.hosts 补记
  → if (HOSTS[h].localOnly) 追加 .gitignore 条目   ← 本次后无宿主命中
  → doctor
```

字段契约（本次改动的唯一数据面）：

| 字段 | 改前 | 改后 | 消费点 |
|---|---|---|---|
| `HOSTS.zcode.localOnly` | `true` | `false` | `init.mjs:247`、`add-host.mjs:55` |
| `HOSTS.omp.localOnly` | `true` | `false` | 同上 |
| 其余五宿主 `localOnly` | `false` | `false`（不变） | 同上 |

## 系统改动清单

- 后端（包源 `src/`）：
  - `src/profiles.mjs` — zcode/omp `localOnly: true → false`，附取舍注释（唯一行为改动）
  - `src/init.mjs` — 仅第 4 步上方注释，说明该分支暂无命中、实际只补 `.agents/cache/`
  - `src/add-host.mjs` — 仅头注释与分支注释，说明保留原因与判定单源
  - `src/cli.mjs` — `--hosts` 帮助文本去掉「zcode/omp 为本地配置，自动进 .gitignore」
  - `src/sync.test.mjs` — S7 断言由「进 .gitignore」翻转为「不进」；新增 `ROpt` 可选读 helper（装户端无 localOnly 宿主时不再创建 `.gitignore`，断言须容忍文件不存在）
- 数据库：无
- 前端：无
- 文档与本仓配置：
  - `README.md` — `--hosts` 选项表说明改为「七宿主一律入库」+ 草稿目录自管提示（指向本仓 `.gitignore` 实例）
  - `.gitignore` — 净效果与改动前一致（`.zcode/drafts/`、`.zcode/plans/` 保留），补一行注释说明 `.zcode/agents/` 为何不入此段
- 装户侧 `.agents/`、`modules/hosts/**`：**不动**（薄适配正文与 managed 记账均无变化）

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 规则 / 契约变更 → 至少 L2 | 触及：`HOSTS.localOnly` 是被 `init.mjs`、`add-host.mjs`、`sync.test.mjs` 多处消费的宿主注册表契约；`--hosts` 对 zcode/omp 的行为变化（不再写 gitignore）属「既有参数语义」。故定 L2，本 spec + 同名 plan + 入口 intent 三件套齐备，spec/plan 均经用户确认后方可提交 |
| schema / 迁移 SQL / DI 链 / 认证与中间件管线 → L3 | **不触及**：无数据库、无 schema、无迁移、无 DI 注册、无中间件/认证管线改动。`--stack` 各 profile 的 builds/checks/allow 亦不变 |
| 引擎双源纪律（本仓特有） | 改动全在包源 `src/`；装户侧 `.agents/` 无对应件（`localOnly` 不进模板树），故**无需** `flow-kit sync`。已核对 `templates/_agents/` 下无「自动进 .gitignore」类文案，无需成对提交 |
| 跨宿主适配层同步（B-b 方案） | 不涉及：`modules/hosts/**` 与 `templates/_agents/{commands,roles}` 正文均未改，无需 `sync-hosts --apply` |
| 禁 `--no-verify` | 三次提交（intent 留痕 / 代码 / 关单）一律走 pre-commit 钩子，被拦即按提示修完原路重试 |
| 确认门（2026-09-27 起） | intent 与 spec、plan 的 approved/done 均经 `confirm-doc.mjs --delegated "<用户原话>"` 代录，台账如实记 `source: chat-delegated` 与原话，不伪装 TTY |
| 五条硬规则 / managed-台账双源 | 改动不新增/删除任何 managed 件，`kit.json` 台账无需变动；`.gitignore` 属单侧自有文件（本仓实例），不在台账内 |

## 风险评估

- **装户既有仓库的 .gitignore 残留** ｜ 已按旧口径装出的项目，`.gitignore` 里仍有 `.zcode/` / `.omp/` 整目录条目，本次改动**不会自动清理**（sync / init 均不重写 `.gitignore`，只做「缺哪条补哪条」的追加）。应对：README 选项表已显式提示「薄适配须入库」；如需彻底解决应另立装户迁移单（本次非目标，不做无确认的批量改写他人仓库）
- **zcode 会话草稿误入库** ｜ 撤销产品自动规则后，新装户若不自管 `.zcode/plans/`，会话草稿会出现在 `git status`。应对：README 与本仓 `.gitignore` 注释均给出实例；本仓自身已加回两行规则
- **断言回归（ENOENT）** ｜ 装户端不再创建 `.gitignore` 时，直接 `readFileSync` 会 ENOENT 崩测试。应对：新增 `ROpt` 可选读 helper，`sync.test.mjs` 已实跑验证（首次改完确实崩了，已由此修掉）
- **文案漂移** ｜ 只改代码忘改文档会让装户照抄陈旧口径（本仓 2026-09-29 p0-gate-noise-batch 即此类）。应对：README、cli.mjs、init.mjs、add-host.mjs 四处文案同批改；验收标准含 grep 断言
- **CI runner 克隆面** ｜ 这是本次要修的缺陷本身，不是新风险。应对：验收标准含 `doctor` 13 PASS / 0 WARN / 0 FAIL 与 fresh-init 冒烟

## 确认与复核

> 个人工作流：确认 = 用户在对话内一句话通过；无第二审批人，追溯靠 git（commit 记录确认时点）。

- 确认结果：approved（2026-10-05，对话委托代录，原话见 confirmations.jsonl）
- 确认范围：七宿主一律入库；保留 localOnly 字段与分支代码；草稿目录改由装户自管；不做装户迁移
- 独立复核：L2 不设同步复核前置；按根 AGENTS.md「L2/L3 走防御道」与本仓先例，本单在关单前由 `independent-reviewer` 复核代码改动面（复核结论记入同名 plan）
- 确认通过后，方可起草 ../plans/2026-10-05-host-gitignore-localonly-revoke.md
