---
状态: approved
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户要求按审查顺序改进公开说明、门禁档位、宿主店面与冒烟。
确认指纹: 4d0aa162c82db872
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

- [ ] README 含五条硬规则、60 秒路径、英文摘要，路线节不再把 0.5.1 标成待发布（证据：README.md 对应小节）
- [ ] CHANGELOG.md 覆盖 0.1.0 到 0.8.0（证据：文件本身）
- [ ] 审计史在 wiki/drafts-archive/2026-09-29-protocol-archaeology/README.md，workflow/README.md 以硬规则开头可执行（证据：两份文件）
- [ ] audit false 的夹具里占位符不出账且缺 plan 仍 exit 1；无 kit.json 时占位符仍警告（证据：check-loop.test.mjs 对应场景）
- [ ] 检查 17 的两则场景通过（证据：check-loop.test.mjs）
- [ ] sync-hosts 实仓缺失 0 且漂移 0（证据：sync-hosts.test.mjs 实仓断言）
- [ ] fresh init --hosts claude 退出码 0，kit.audit 为 false，.claude/commands/wf-plan.md 存在（证据：fresh-init.test.mjs）
- [ ] 三个门禁的违规 / 放行场景通过（证据：gates.test.mjs）
