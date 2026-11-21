---
name: tfs-pr
description: 内网自托管 TFS / Azure DevOps Server PR 技能，项目无关：自动识别 git 仓库与远端推导 collection/project/repo，PAT 缺失时引导创建并保存环境变量；查 PR / 建 PR（context 拉 diff 提炼标题与描述）/ 改 PR 描述 / 冲突预检与 worktree 隔离解决，context 附逐提交导读与噪声清理建议，checks 只读定位 CI 红，走 REST API + PAT（az devops 拒 http URL，不可用）。命令入口 .agents/skills/tfs-pr/scripts/tfs-pr.mjs。
---

# tfs-pr — 内网 TFS / Azure DevOps Server PR（项目无关）

零项目假设：远端是 TFS / Azure DevOps 形态（路径含 `_git`），或能给出 collection URL，即可用。技能目录自包含。宿主侧只放指针壳（本仓仅 `.codebuddy` 一处；`.trae` 壳 2026-11-08 移除），主本变更无同步义务。下文 `tfs-pr` 代指 `node .agents/skills/tfs-pr/scripts/tfs-pr.mjs`。

## 触发 / 不触发
- 触发：「查 PR / 有没有冲突」「补 / 改 PR 描述」「解决 PR 冲突」等内网 TFS 事务；`az devops login` 报 "Refusing to attach credentials to an invalid Azure DevOps organization URL" → 转本技能，禁再试 az。
- 建 PR：不读本技能。走 `flow-kit run pr-create.mjs`。本技能只处理 Azure。GitHub 不读本技能。禁止绕过入口直接调 `tfs-pr create`。查 PR、改描述、解冲突、定位 CI 红仍用本技能。面板评审见 `.agents/commands/pr-review.md`。
- 不触发：GitHub / GitLab 等公网托管 PR；普通代码评审、commit 消息。

## 0. 前置探测
```bash
git rev-parse --is-inside-work-tree   # 非 0 → 不是 git 仓库，停止告知
tfs-pr target                          # base/project/repo/tokenUrl/prPage，零请求、无需 PAT
```
- `target` 报错自带补救：让用户给 collection URL（形如 `http://<host>:<port>/tfs/<collection>`），按 `--base`（单次）/ `TFS_BASE`（环境变量）/ `git config tfs-pr.base`（仓库级）落位；project / repo 用 `--project` / `--repo` 覆盖；非 origin 远端用 `--remote` / `TFS_REMOTE`。
- 认得的远端形态：`ssh://host:22/tfs/COLL/PROJ/_git/R`、`git@host:tfs/...`（scp 式）、`https://host/tfs/COLL/PROJ/_git/R`、根挂载（无 /tfs）、短形态（project==collection）、`dev.azure.com` / `*.visualstudio.com`。
- ssh 远程 web base 默认 `http://<host>:8080`，`TFS_WEB_SCHEME` / `TFS_WEB_PORT` 覆盖；老 TFS 设 `TFS_API_VERSION=4.1`（默认 6.0）；目标分支可固化 `git config tfs-pr.target <branch>`。

## 1. PAT：读 → 引导 → 用
只存环境变量（禁进 argv / 对话 / 打印）：单台服务器用全局 `TFS_PAT`；多台按 base 主机名分存 `TFS_PAT_<HOST>`（非字母数字转 `_` 大写，如 `TFS_PAT_10_0_0_1`，命中优先）。
- 探测与引导一条命令：`tfs-pr setup`——打印两变量的进程/用户级状态、动态门户 `<base>/_usersSettings/tokens`（禁写死站点 IP）、setx 命令、whoami 自检。未配置 → 把 setup 输出的三步给用户：门户生成（scopes 勾 Code Read&Write + Pull Request Read&Write + Build (Read)（checks 定位 CI 需要）+ **Work Items Read**——建后核对关联工作项必需，缺了该 scope 核对步会 401）→ `setx <变量> "<PAT>"`（新开终端生效）→ `tfs-pr whoami` 真验证（长度非空 ≠ PAT 有效）。
- setx 后当前进程未继承：从注册表取值喂脚本，命令行不得出现值：`TFS_PAT="$(powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('TFS_PAT','User')")" tfs-pr …`（分存变量同理）。
- 兜底 `--pat-file` 仅限用户明确不用环境变量，收尾 `rm -f`；PAT 泄入对话/日志/历史 → 收尾必须提醒门户撤销重建。

## 2. 命令
| 动作 | 命令 | 说明 |
|---|---|---|
| 识别目标 | `tfs-pr target` | base/project/repo/tokenUrl/prPage |
| PAT 指引 | `tfs-pr setup` | 门户地址 + 持久化 + 自检命令 |
| 验证 PAT | `tfs-pr whoami` | 当前身份 + base/project/repo + PR 页 |
| 查 PR | `tfs-pr list [--source <b>] [--target <b>] [--status active\|all] [--json]` | `#12 [active/succeeded] feat/x → develop <title>` |
| 查单个 | `tfs-pr get <id> [--json]` | status/mergeStatus + PR 页 URL；JSON 含完整描述 |
| 建前上下文 | `tfs-pr context [--source <b>] [--target <b>] [--no-fetch] [--patch] [--json]` | commits/files/stat/overlap/conflicts/push/dirty 一把梭，附 guide 逐提交导读与噪声清理建议（见 §8） |
| 建 PR | `tfs-pr create [--source <b>] [--target <b>] --title <t> --body-file <f\|-> [--dry-run] [--json]` | `CREATED #id …` 或幂等 `EXISTING #id` |
| 改描述 | `tfs-pr desc <id> --body-file <f\|-> [--dry-run] [--json]` | `UPDATED #id …`（已回读比对） |
| 冲突预检 | `tfs-pr conflicts <id> [--no-fetch] [--json]` | 按 PR 分支取 conflicts/overlap/mergeBase |
| 本地冲突预检 | `tfs-pr conflicts --source <b> --target <b> [--no-fetch] [--json]` | 无需 PAT、无需 PR id |
| CI 红定位 | `tfs-pr checks [<prId>] [--source <b>] [--build <id>] [--top n] [--json]` | 只读定位失败检查（builds + timeline）；CI 红仍退出 0，见 §9 |

- source 默认当前分支（detached HEAD 需 `--source`）；target 默认 `--target` / `TFS_TARGET` / `git config tfs-pr.target` / 远端 HEAD；分支名无需 `refs/heads/` 前缀。
- `--body-file -` 从 stdin 读正文免临时文件；正文 UTF-8（BOM 自动剥），中文与换行原样。
- `--dry-run` 零请求且无需 PAT；退出码 0 成功（含 EXISTING）/ 1 HTTP·API·网络错误 / 2 用法·配置错误。

## 3. 建 PR：从 diff 提炼标题与描述
1. `tfs-pr context --target <目标分支> --json`（默认自动 fetch；`--no-fetch` 仅离线或 refs 已新鲜）。产出：commits、files、stat/shortstat、overlap（双方都改过）、conflicts（merge-tree；`conflictsSupported=false` 表示 git 不支持预检，勿当无冲突）、push（未推送/远端无分支）、dirty（未提交改动）。建 PR / 评审前先读输出附带的 guide 逐提交导读定镜头顺序（噪声清理建议见 §8）。
2. 建前检查：`push.unpushed` 或远端无分支 → 先正常 `git push`（被门禁拦修根因，禁 `--no-verify` / force push）；`dirty` → 确认未提交改动是否入 PR，勿静默忽略；`conflicts.files` 非空 → 先按 §5 解；`overlap` 非空但无文本冲突 → 人工过双方改动确认语义。
3. 需要看具体改动再读关键文件或 `git diff origin/<目标分支>...HEAD`（`--patch` 可附完整 diff）。
4. **标题**：Conventional Commits 中文 `feat(scope): 摘要`（复合主题 `+` 串联，约 70 字符内，禁空标题 / 带 PR 号）；scope 取主要模块/目录，主题从 diff 主要变更 + commits 归纳，非复述 commit message。
   - **`#数字` 禁令（2026-10-26 实证）**：commit message / PR 标题 / PR 描述里**引用 PR 号一律写「PR 720」，禁写 `#720`**——`#N` 是工作项关联语法，推送即自动把工作项 N 挂到提交与 PR 上；PR 号与工作项 ID 同数值空间，必撞无关工作项（PR #719 曾因此错挂）。`#N` 仅在真实要关联某工作项时使用。**PR 描述里引用其他 PR 用 markdown 链接**（`[PR 720](<prPage>/<id>)`，`prPage` 见 `target` 输出，单页 URL 为 `pullrequest/<id>`）；首个 PR 号出现处链接即可，其余纯文本。
5. **描述**（`create` / `desc` 都是整段替换，必须给完整正文；模板为**缺省值**——宿主仓库已有自己的 PR body 约定时以宿主约定为准，查宿主的评审/合并文档，本模板仅兜底）：
   ```markdown
   ## Summary
   - 为什么改、改了什么（1-4 条，指向关键模块/文件；必须来自实际 diff）

   ## Evidence
   - 实际运行的测试/构建/手工验证；没运行就明确写「未运行」及原因，禁编造

   ## Merge Danger
   - Door: 影响面（API / DB / 配置 / 权限 / 兼容性）；无风险写「无」，禁省略
   - Blast Radius: 局部 / 模块 / 全局
   - Rollback: 回滚方式与风险
   ```
   diff 大、overlap 非空或不可逆变更 → 追加 `## Tradeoffs`：引用 shortstat 真实规模 + 为什么仍这样做。
6. 先 `--dry-run` 验 URL 与正文，再正式 create；`mergeStatus=queued` 用 `get` 轮询，`conflicts` 转 §5；PR 页 URL 返回用户。

## 4. 改 PR 描述
`get <id> --json` 读现有 → 判断替换还是补充（补充 = 把新内容合并进现有，保留有用三节）→ `desc <id> --body-file -`（stdin）或文件。**desc 是整段替换不是追加**，禁用增量片段覆盖原文。源分支又有新提交 → 先重跑 context 再更新描述，防 Summary 与实际 diff 脱节。

## 5. 解决 PR 冲突
定位：`tfs-pr conflicts <id> --json`（从 PR 取分支 → fetch → merge-tree + overlap + mergeBase）。服务端 conflicts 但本地空 → refs 过期/服务端未刷新，重新 fetch 后 `get` 确认，**禁直接断言无冲突**。

解决（worktree 隔离，不动用户当前工作区，不 stash/reset 用户未提交改动）：
```bash
git fetch <remote> <src> <tgt>
git worktree add <tmp>/pr-<id> -b tfs-pr/<id>-resolve refs/remotes/<remote>/<src>
cd <tmp>/pr-<id> && git merge refs/remotes/<remote>/<tgt>
# 逐文件解决、保留双方意图，禁盲目 --ours/--theirs；overlap 自动合并成功的也要过语义（调用方/配置/迁移/契约）
# 跑项目测试/构建；只 stage 已解决文件；提交信息说明解决了哪些冲突——PR 号禁写 #N（同 §3 步骤 4 禁令：#N 会错挂无关工作项，写「PR 720」）
git push <remote> HEAD:<src>
```
- 禁 force push（含 `--force-with-lease`，除非用户明确确认）；push 被拦 = 门禁执法，修根因，禁 `--no-verify`；分支策略禁直接推 → 停下报告选项，不绕过。
- fork 源分支本地 fetch 失败 → 请用户提供源仓库或在源仓解决，不猜；PR 已 completed/abandoned → 不解冲突，报告状态。
- 收尾只删本技能建的 worktree/分支：`git worktree remove <tmp>/pr-<id> && git branch -D tfs-pr/<id>-resolve`，不动用户任何分支/worktree。
- 复查：`get <id>` → mergeStatus 离开 conflicts（queued 轮询到收敛）才算完成。

## 6. 错误判读
- **响应三判**（脚本已内建，手工排查同序）：先判 `status` → 再判 `content-type`（`401 + text/html` = 没带/带错凭据，常见 `TF400813`；直接 `JSON.parse` 只会得到误导的 `Unexpected token '<'`，禁硬 parse）→ 确认 JSON 再 parse。
- `401 JSON` = PAT 无效/过期/scope 不足（门户重建）；`404 JSON` = base 指错站点/端口（如 API 在 8080 而 base 指 80）或 project/repo 拼错（`target` 核对）；`EXISTING` = 同 source→target 已有 active PR（改走 `desc` 或先 abandon）；网络/TLS 错误查 VPN/代理/证书（`--verbose` 只打 URL 不打 PAT）。

## 7. 收尾判据
查/建/改后 status/mergeStatus 与预期一致（desc 已回读比对）；**关联工作项已核对**（`curl -s -u ":$TFS_PAT" "<base>/<project>/_apis/git/repositories/<repo>/pullrequests/<id>/workitems?api-version=6.0"` 列出后逐条核对是否为预期工作项——本仓默认无工作项关联，非空即须解释；错挂须在门户移除后复核为空，PAT 无 Work Items Read scope 时该步 401、需门户人工核对）；PR 页 URL 已返回用户；解冲突后推送成功且不再 conflicts；临时正文/凭据文件已删；PAT 未进仓库/日志/对话，泄露已提醒撤销；汇报 PR 号、URL、status/mergeStatus 与实际做过的验证，没跑测试就明说。

## 8. 逐提交导读与噪声历史清理建议
`context` 在文本输出与 `--json` 里都附带 `guide`（逐提交导读，时间正序 = 建议阅读顺序；默认最近 50 条，超限标注截断）：
- 每条提交：short/subject、type/scope/breaking（主题带 `!` 即破坏性）、parents（父提交数）、files（至多列 8 个路径）、added/deleted（`+N/-M`）、flags（conflict / overlap / breaking / revert / noise）、note（冲突/重叠/破坏性/回滚的中文提示）；末尾给「重点先看」（focus：带非 noise 标记的提交）与「类型分布」（types）。
- `noise` 五类清理**建议**（fixup / merge / wip / non-conventional / duplicate），逐条带 suggestion；只给建议，不代跑改写。
- `notice` 两套授权措辞：已推送历史 → 改写（rebase/squash + force push）**须用户显式授权**，脚本与本技能都不代跑，未授权就保持原历史并把噪声写进 PR 描述让评审者知情；未推送（或推送状态未知）→ 可在本地整理后再推送，一旦推送，改写同样须用户显式授权（禁 force push，见 §5）。
- 硬边界：本技能在历史清理上只读、只给建议——禁自动合并、禁自动 force push、禁代跑 rebase/squash；清理已推送历史须用户显式授权后才动手，且只限用户点名的那次整理。

## 9. CI 红：定位失败检查与聚焦修复
`tfs-pr checks [<prId>] [--source <b>] [--build <id>] [--top n] [--json]`：只读定位失败检查；CI 红不改变退出码（仍退出 0），不参与门禁、不排队构建。PAT 需 Build (Read) scope（§1；`401 + text/html` 报错自带 Build scope 补救提示）。
- 用法：无参数取当前分支；给 PR id 查该 PR（验证构建跑在 `refs/pull/<id>/merge`、普通 CI 跑在分支 ref，两处都查再按 id 去重）；`--build <id>` 直接指定构建；`--top n` 限构建数（默认 10，上限 100）。
- 输出：builds 列表（id/buildNumber/result/status/reason/branch/repository，非本仓标注）→ 分析最新构建 timeline：失败记录给 `FAIL [type] name`、path 父链、errors=errorCount、warnings、attempt、issues 消息（`type: message`，至多 5 条）、log 指针（URL 或 logId，正文不抓取）；`WARN` = succeededWithIssues。timeline 无 issues 明细 → 按 log 指针取日志正文。
- 结论 `CI=red|green|running|canceled|no-builds|unknown`：running 别当绿，稍后重跑 checks。
- 无构建 = loud-empty：明说 branch/pr/repository 与可能原因（CI 未配置/未触发、分支未推送、构建定义在别的 project、老 TFS 不支持该过滤），给 `--build <id>` 与 `_build` 页人工核对两条出路。
- 按分支命中的构建 repository 名与本仓不符 → 输出 repoNote，列出全部并请用 `--build <id>` 指定本仓构建。
- `CI=red` 的动作：按 FAIL 的 issues 定位文件/行 → 只改该处 → 跑本地对应测试 → 推送后重跑 checks 复核；聚焦修复完成前不进评审（pr-review 派 finder 前先 checks）。禁自动合并、禁 force push、禁绕门。
