---
状态: approved
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 spec。同名 intent 已于 61ec130 approved。
确认指纹: c222b0d72f9eeb12
---
# SPEC — 委派台账对账

对应入口：../intents/2026-09-29-delegation-ledger.md

## 功能行为

新增检查 18，严重性 warning。头部清单加一行 `//  18. 委派台账对账 [warning]`，供 gate-checklist 解析。检查 1 到 17 的标题、严重性与判据保持原样。登记表追加 `{ doctor: '7', cl: '18', note: '经 §7 整体运行覆盖（委派台账对账）' }`。

### 检查 18 的范围

只警告下面两类，每份文件一行：

- intent、spec、plan：级别为 L2 或 L3，且状态为 done
- incident：级别为 L2 或 L3，且状态为 fixed 或 closed

级别缺失时不警告。intent、spec、plan 的日期取 frontmatter「日期」；incident 先取「发现」，没有再取「日期」。两处都没有时不警告。状态为 draft、approved、open、superseded、cancelled 的不警告。L1 的 done、fixed、closed 不警告。

### 怎样算有委派记录

只读 `ROOT/workflow/delegations.md` 里 `## 委派结果` 到下一个 `##` 之间的表。表不存在、文件不存在、或这一节为空，与「没有任何匹配行」相同，该警告的文件仍各出一行。

表行以 `|` 开头。跳过表头和分隔行。第一列必须是日历日（四位年、两位月、两位日，用连字符连接）。第一列不是这种日历日的行不参与。日期按字符串比较。

一行算数，当它的日期不早于该文档日期，且整行包含该文件的 basename（含 `.md`）。只写出去掉 `.md` 的主题名不算。`## 自做任务结果` 以及文件里其他节不算，哪怕那里写了文件名。

`--rev` 时 `ROOT` 已是被扫描提交的临时工作树。委派表和文档都从这棵树读。调用方工作区里后补的行不进入这次扫描。

警告经 `warnings.push` 发出，前缀为 `- [WARN 委派台账]`，并带上仓库相对路径（斜杠）和该文档日期。`audit: false` 时现有的空 `warnings.push` 吞掉它。退出码仍只由阻断项决定：只有这条警告时退出码为 0。

实现放在检查 17 的代码之后，使检查 1 到 17 已有警告的相对顺序不变。被新警告挤动的整段快照断言，只在本包的测试里改。

### journal 的只读对账

`wf-journal.mjs status` 在已有 run、并且打完「已完成 / 就绪 / 待定 / 中止」四行之后，增加一段只读对账。无 run、按首轮输出时不做对账，也不打印下面的标题。

对账对象：该次 run 里末次状态为 pass、且 stages 表解析出的 `role` 等于 `implementer` 或 `independent-reviewer` 的阶段。其他角色、以及末次为 fail 或 blocked 的阶段不列。`add` 的必填参数仍是 `--wf`、`--stage`、`--status`。

pass 的日期取该行 `ts` 的前 10 个字符，也就是 `toISOString()` 的 UTC 日历日。`ts` 缺失的 pass 不参与对账。

委派表的默认路径是 `cwd/workflow/delegations.md`，与 journal、workflows 目录一样按 cwd。新增可选参数 `--delegations <文件>`，测试用它指向夹具。这个参数只属于 `status`。

阶段上的文件名从三处收集：`files` 单元格、该 pass 行的 `note`、以及 `parseStages` 给出的 `_line` 所对应的原始表行。每一处里以 `.md` 结尾的路径，取最后一段（含 `.md`）。`parseStages` 的列集合不改，task 列今天没有单独抽出，所以靠原始行保留写在 task 里的文件名。

一行算这个阶段已记录，当它的日期等于该 pass 的 UTC 日历日，且满足下面任一：

- 含该阶段 id，且 id 两侧不是 ASCII 字母、数字、下划线或连字符
- 含上面收集到的某个 `.md` 文件名

阶段上一个 `.md` 都没有时，只按阶段 id 判定。这样补上一行带阶段 id 的同日记录后，该阶段从列表消失。

有未记录阶段时，在四行之后打印一行：`  委派台账未记录（N）：id1、id2`。全部对上时不打印这行。找不到委派表时，四行照常打完，再列出未记录阶段。不写 journal，不写 `delegations.md`。`status` 成功时退出码仍是 0。

检查 18 认的是工作流文件名，日期是「不早于文档日期」。journal 认的是阶段 id 或阶段上的 `.md` 文件名，日期是 pass 的 UTC 日相等。补了工作流文件名，消的是检查 18 里该文件的那一行。补了同日阶段 id，消的是 journal 里该阶段。两处各算各的。

## 数据流

检查 18：被扫描树上的 frontmatter → 文档日期与级别、状态 → `ROOT/workflow/delegations.md` 的委派结果表 → `warnings`。`audit: false` 在 `warnings.push` 被换成空函数之后生效，所以这条警告必须走 `warnings.push`。

journal：`status` 读编排脚本的 stages 表与 journal 的末次 pass，再读委派结果表，把未记录的阶段 id 打到 stdout。

## 系统改动

- `templates/_agents/scripts/check-loop.mjs`：检查 18 与头部清单一行
- `templates/_agents/scripts/check-loop.test.mjs`：下面的夹具。既有用例保持通过
- `templates/_agents/scripts/check-loop-rev.test.mjs`：一条 `--rev` 夹具，证明委派表读的是被扫描的树
- `templates/_agents/scripts/wf-journal.mjs`：`status` 的只读对账与 `--delegations`
- `templates/_agents/scripts/wf-journal.test.mjs`：对账夹具。既有 `add` 缺参失败保持通过
- `templates/_agents/scripts/gate-checklist.mjs`：登记 cl 18
- `workflow/README.md` 与 `templates/workflow/README.md`：在「发版草稿」段落后加一段「委派台账」，写明哪些文档出警告，以及 `audit: false` 时与其他卫生警告一起被吞掉。`policyVersion` 那句保持原样
- 改完 templates 里的脚本后 `node bin/flow-kit.mjs sync`

检查 18 的夹具用日期 2026-09-12，使检查 15 保持豁免。L2 的 done intent 配上同名 spec 与 plan。需要 git 的夹具给 done intent 写上已勾的验收与证据，避免检查 8 阻断。incident 夹具写全复盘三件套，且「是否需要新 intent」为否，使退出码保持 0，警告可见。

夹具要覆盖：

1. L2 done、委派表没有该 `.md`：输出含 `- [WARN 委派台账]` 与该文件名，退出码 0
2. 补上日期不早于文档日期、且含该 `.md` 的一行：该警告消失
3. 行的日期早于文档日期：警告仍在
4. 行里只有去掉 `.md` 的主题名：警告仍在
5. 文件名只出现在自做任务结果：警告仍在
6. L1 done：没有这条警告
7. L2 且状态为 approved：没有这条警告
8. L2 incident 状态 closed：有警告且退出码 0。L1 的 closed、L2 的 open：没有该文件的警告
9. 范围内但缺日期：不警告
10. `audit: false`，配对完整的 L2 done：退出码 0，输出不含 `委派台账`。既有用例「audit false：缺 plan 仍阻断」保持通过
11. 委派表文件不存在：与没有匹配行相同
12. `--rev` 指向没有匹配行的提交，工作区稍后补上匹配行：该 `--rev` 仍输出 `委派台账`

journal 夹具要覆盖：

1. pass 且 role 为 implementer，委派表为空：stdout 含 `委派台账未记录` 与该阶段 id
2. role 为 independent-reviewer 时同样列出
3. role 为 ui-verifier：不打印该标题
4. 同日行含阶段 id：该阶段不列出
5. 同日行含 files 里的 `.md` 文件名：该阶段不列出
6. 行的日期与 pass 的 UTC 日不同：该阶段仍列出
7. 无 journal run：不打印该标题

## 约束遵守映射

| 红线 | 本 spec 如何满足 |
|---|---|
| 规则 / 契约 | 新增检查 18，warning。检查 1 到 17 的含义不变。新号同一次登记进 gate-checklist |
| 双源 | 引擎脚本改 `templates/_agents/scripts/`，装副本靠 sync。两份 README 手改 |
| 确认门 | 不改 confirm-doc，不改检查 15 |
| 审计档 | 新警告走 `warnings.push`，`audit: false` 沿现有空函数吞掉 |
| 委派门槛 | 不改 `delegations.md` 的并发扩容数字，不改聚合脚本 |
| schema | 不涉及 |

## 风险评估

- 2026-09-29 对当前工作区预演：有日期、在范围内、委派结果表对不上的 58 份（intent 19、spec 21、plan 10、incident 8）。另有 17 份 L2 done 的 spec 或 plan 没有「日期」，按本规则不警告。规则落地后，check-loop 每次多约 58 行警告，doctor 经检查 7 跑到的警告计数跟着上升，退出码仍是 0。这 58 份的委派行留到以后按真实委派补。本包的规则提交只加检查。
- pass 的 `ts` 是 UTC。本地日历日与 UTC 日相差一天时，同日手写的委派行对不上 journal。`add` 的 `ts` 写法保持 `toISOString()`。
- 阶段 id 用子串会把短 id 撞进别的词。应对：两侧必须是单词边界。
- 输出顺序是稳定契约。新警告追加在检查 17 之后，只改因此移动的断言。

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
- 复核：L2，独立复核留到关单前
