---
状态: approved
级别: L2
日期: 2026-10-05
模块: pipeline
备注: 检查 8「纯数字串豁免」误分类全数字短 SHA——守卫后移为 rev-parse 实证分流；与同名 incident 配对
确认指纹: 73431c6d64a847d7
---
# SPEC — check8-digit-sha-misfire

<!-- 与 intents/ 下同名入口文档配对；本单入口为同名 incident（check-loop 认 incident≡intent） -->
<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->

## 功能行为

**改前**（探针实证，40 轮 3 次现行）：

`verifyEvidenceTruth` 开头守卫 `if (!shaMatch || /^\d+$/.test(shaMatch[1])) return { ok: true, type: 'text' }`——意图豁免「证据:20260926」类时间戳/ID 文本，但 7 位全数字短 SHA（概率 ≈(10/16)⁷≈4.4%/夹具，git 哈希随机产生）在文本上与时间戳**不可区分**，被抢先分类为 text → 证据真相核验静默跳过 → 该文档的「证据无关/伪造」裁决消失（fail-open 漏检）。伴随缺陷：`linesOf` fs 告警**进程级去重**被合法缺失文件（夹具无 AGENTS.md，检查 7 每次 ENOENT）消耗 → 同进程后续真 fs 异常静默。

**改后**：

1. 守卫后移为 **rev-parse 实证分流**：`shaMatch` 命中后不再按字符形态抢先分类——纯数字串也先试 `git rev-parse <sha>`：能解析成提交（含同名 ref/tag）→ 走既有真相核验（plan 声明比对 / 过程证据 / forged 判定，全链不变）；解析失败 → 纯数字维持 `text` 豁免（时间戳/ID 语义保持），非数字维持既有 external/forged 判定
2. 各 return 分支补插桩出账（沿本仓 fail-loud 口径）：`text`/`no-plan`/`external`/`process` 豁免与放行路径出账一条（与既有 `irrelevant`/`sha` 路径的裁决可见性对齐）——此前「裁决消失」无法归因正是豁免路径零痕迹所致
3. `linesOf` 告警去重改**按文件**（每文件首异常出账一条）——合法缺失文件（AGENTS.md）不再消耗其他文件的告警额度
4. 语义红线（不动）：非数字 hex 的 forged/external 判定、时间戳豁免语义、`gitOut` 返回契约、非 git 仓跳过——全部保持

**边界与异常**：纯数字串撞上同名 ref/tag 时按提交核验（真实世界罕见；命中即实证存在，核验失败会走既有豁免/拦截路径，不误伤）——`证据:20260926` 类时间戳在无同名 ref 时维持豁免，零行为变化。

## 数据流

```
检查 8 closeItem → verifyEvidenceTruth(evidenceStr, planBase, ROOT)
  → shaMatch 命中 7-40 位 hex（含全数字）
  → spawnGit(['rev-parse', sha])                       ← 分流点（改前：纯数字在此前即被 text 豁免）
      ├─ 解析成功（含纯数字短 SHA 命中提交/ref）→ 真相核验：plan 声明比对 / 过程证据 / irrelevant / sha
      └─ 解析失败 → 纯数字 → text 豁免（时间戳/ID）；非数字 → external（残留）/ forged（纯引用）
  → 各豁免/放行分支出账一条（stderr，裁决可见性对齐 irrelevant/sha）

测试注入路径（场景 5u，构造性——不依赖哈希运气）：
  → fixture 提交 + git tag 2620913 <commit>（7 位全数字 ref）+ 证据引「2620913」
      → 修复前：/^\d+$/ 抢先 text 豁免（漏检）；修复后：rev-parse 经 ref 解析成功 → 证据无关
  → 负例：证据引「20260926」（纯数字、无 ref）→ text 豁免保持
```

消费方：检查 8（done 文档验收证据）、pre-commit/pre-push 钩子链、CI/发版链、装户 CI。

## 系统改动

- **包源引擎**（唯一行为面）：
  - `templates/_agents/scripts/check-loop.mjs` — `verifyEvidenceTruth`：删除前置 `/^\d+$/` 抢先分类，改为 rev-parse 实证后分流（纯数字解析失败 → text；成功 → 真相核验）；`text`/`no-plan`/`external`/`process` 四条豁免/放行 return 补一条 stderr 出账（`check-loop: 证据豁免 <type> <base>` 形态，进程级按 type 去重）；`linesOf` fs 告警去重粒度改按文件
  - `templates/_agents/scripts/check-loop.test.mjs` — 新增场景 5u 两块：①全数字 ref 正例（`git tag 2620913` + 证据引数字串 → 须报「证据无关」，确定性钉死修复前漏检）；②纯数字时间戳负例（无 ref → 维持豁免，防误报）
- **装副本同步**：`flow-kit sync` 刷 `.agents/scripts/check-loop.{mjs,test.mjs}` 与 `.agents/kit.json` 两个 sha256
- **台账回填**：`workflow/papercuts.md` 2026-10-05 gitout-fail-open 行追加「再命中已立项 → 同名 check8-digit-sha-misfire 单（真根因为全数字短 SHA 误分类，与 git/fs/夹具三层无关）」
- **规范条目**：`workflow/regression-checklist.md` 防复发验证节追加「证据校验的文本豁免须以 rev-parse 实证兜底，禁以字符形态抢先分类」
- **不动**：非数字 forged/external 判定链、时间戳豁免语义、gitOut/spawnGit（前单已修，本单零接触）、`--rev` worktree 路径

## 约束遵守映射

| 红线 / 约束 | 本 spec 如何满足 |
|---|---|
| 既有接口语义变化 → L2（new-task L2-3） | `verifyEvidenceTruth` 的豁免分类口径变化（纯数字串从「形态豁免」改「实证分流」）被检查 8/钩子链/CI 消费 → L2 三件套，防御道确认门 |
| 根因修复不扩散（AGENTS.md §3） | 改动集中在守卫一处 + 同函数豁免分支插桩；检查 8 其余判据、检查 1-7/9-20 零接触 |
| 引擎双源纪律 | 全部引擎改动落 `templates/` 包源 → `flow-kit sync` 刷装副本与 kit.json sha；装副本不直改 |
| 信任边界 / 数据安全 | forged 判定（防伪线）对非数字路径零变化；纯数字路径从「盲豁免」改「实证」——防伪能力只增不减 |
| 简洁优先 | 守卫后移 ≈6 行 + 四条出账 + 去重粒度一行；构造性用例用 git tag 钉死（不依赖哈希运气）——无新抽象、无新依赖 |
| 确认门（2026-09-27 起） | incident 已 open（时间线含用户确认立项行）；本 spec 用户确认后方可起草同名 plan，plan 确认后方可动手；各态经 `confirm-doc.mjs --delegated` 逐件代录 |
| 禁 `--no-verify` | 全程走 .githooks 门禁 |

## 风险评估

- **纯数字串撞同名 ref/tag**（低）→ 命中即实证存在、按 SHA 核验；核验不过走既有豁免/拦截，不误伤；「证据:日期」在无同名 ref 时维持豁免（零行为变化）
- **出账噪音**（低）→ 豁免分支出账按 type 进程级去重，正常文档每类至多一条；stderr 通道不改 stdout 协议
- **时间戳语义回归**（低）→ 负例用例钉死「纯数字无 ref → 豁免保持」；`git rev-parse` 对不存在串 status≠0 实证可靠
- **修复验证的构造性**（已解决）→ 全数字短 SHA 无法人为构造（哈希随机），改用 **git tag 数字名** 实证同一解析路径——确定性钉死，不依赖运气
- **回滚难度**（低）→ 单 commit revert 即回改前行为，无数据/状态迁移

## 确认与复核

- 确认日期：（用户对话内确认后回填，confirm-doc 代录原话见 confirmations.jsonl）
- 复核：L2 推荐独立复核——关单前由 independent-reviewer 复核（基准 = 本 spec approved 时的 HEAD）
