---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户要求按审查顺序改进公开说明、门禁档位、宿主店面与冒烟。
确认指纹: 64e03fcd4223c9ef
---
# INTENT — 装户表面收口

## 背景与问题

包版本已到 0.8.0，README 路线仍停在未勾选的 0.5.1。check-loop 把卫生警告和硬阻断叠在同一条路径上，新装项目一上来就要读完整套审计史。宿主注册表只有 zcode、opencode、trae、omp。发版提交可以在入口文档仍为 draft 时通过。

## 目标

- README 写明当前能力、60 秒路径、英文摘要和五条硬规则，并指向 CHANGELOG
- 本仓 workflow/README.md 只留现行规则；审计史归档到 wiki/drafts-archive/2026-09-29-protocol-archaeology/
- 新装 kit.json 写 audit false 与 policyVersion 1；本仓显式 audit true。audit false 时配对断裂仍阻断，占位符警告不出账
- 检查 17：最近一次 version 变更提交树上的 draft，工作区仍是 draft 则阻断；该提交之后新建的 draft 不拦
- claude、cursor、codex 薄适配与权威源正文对齐（sync-hosts 缺失 0、漂移 0）
- fresh init --hosts claude 在空 git 仓库上 doctor 退出码 0
- node-layer、py-import、generated-readonly 三个门禁对违规暂存退出码 1，干净暂存退出码 0

## 非目标

- 不把 2026-09-23 至 09-28 已确认文档改成 done 或 closed。那些正文绑着确认指纹，关单要逐份 confirm-doc
- 不改 package.json 版本号，不发布 npm
- 不采集外部仓库的效果数字
- 不把 Codex 的 commands 目录说成会被注册成斜杠命令

## 约束

- 引擎改动先改 templates/，再 flow-kit sync。宿主正文用 sync-hosts --apply，frontmatter 不动
- 检查项只新增 17，并登记 gate-checklist。豁免日期改读 policy.mjs，不另写一套阈值

## 影响面

- 模块：pipeline
- 数据库：无
- 装户：新装少一批默认警告；旧台账没有 audit 字段时行为与现在相同

## 触达红线

- [x] 规则 / 契约变更（check-loop 阻断范围、宿主注册表、kit.json 字段）→ 级别 L2

## 验收标准（可测试）

- [x] README 含五条硬规则、60 秒路径、英文摘要，路线节不再把 0.5.1 标成待发布（证据：README.md:7 `## English` / :20 `## 60 秒路径` / :29 `## 五条硬规则`；全文件「0.5.1」零命中；路线节已改为 :87「当前能力（已发布 0.8.0）」）
- [x] CHANGELOG.md 覆盖 0.1.0 到 0.8.0（证据：CHANGELOG.md 10 节全（0.1.0→0.8.0）无缺口无占位——复核逐节核对）
- [x] 审计史在 wiki/drafts-archive/2026-09-29-protocol-archaeology/README.md，workflow/README.md 以硬规则开头可执行（证据：归档 README 与迁移前 workflow/README.md 逐字比对 36 行相同（复核实证）；workflow/README.md:46-60 硬规则节完整——按复核 P2-1 写实：「开头」指规则先行而非物理首节，功能面成立）
- [x] audit false 的夹具里占位符不出账且缺 plan 仍 exit 1；无 kit.json 时占位符仍警告（证据：check-loop.test.mjs:1634-1657 三场景；复核反向注入 A（删审计吞警告）→ 2 条按预期变红）
- [x] 检查 17 的两则场景通过（证据：check-loop.test.mjs:1660+/1740/1759/1784（draft 后建不拦 / 锚前 approved 不拦 / 锚后 approved 阻断 / v1 不启用）；复核反向注入 B/F 均按预期变红）
- [x] sync-hosts 实仓缺失 0 且漂移 0（证据：src/sync-hosts.test.mjs:189 + 实跑 `flow-kit sync-hosts` 76 对无漂移；复核反向注入 D（改 claude/wf-plan.md）→ 断言 FAIL（drift=1））
- [x] fresh init --hosts claude 退出码 0，kit.audit 为 false，.claude/commands/wf-plan.md 存在（证据：src/fresh-init.test.mjs 4/0；复核反向注入 E（audit false→true）→ 断言 FAIL）
- [x] 三个门禁的违规 / 放行场景通过（证据：src/gates.test.mjs 12/0；复核反向注入 C（node-layer 改读工作区）→ 暂存语义 2 条 FAIL——「只看暂存区」语义确证）

## 确认与复核

- 确认日期：2026-09-29（台账 ts 2026-09-29T00:33:55Z，source=chat-delegated，原话「workflow/intents/2026-09-29-adopter-surface.md 确认」，batch 52edf9；spec / plan 随批：c7daf7「spec已审完」/ d7f846「plan已审完」）
- 复核：L2 独立复核（2026-09-30 关单前补做，independent-reviewer「衡之」，独立上下文，只读）——**0 P0 / 0 P1 / P2×4**；8 项验收标准逐条成立、6 组反向注入验证测试承重；P2 处置：P2-1 勾验证据按实际结构写实；P2-2（清单未列同期落地文件）/ P2-3（policyVersion 历史值，终态不追溯）关单说明登记；P2-4 README 增量列表补至检查 19
- 实施提交：2c83677（feat(pipeline): 装户表面收口，107 文件）——实施完成于 2026-09-29，本日补复核与关单收口
