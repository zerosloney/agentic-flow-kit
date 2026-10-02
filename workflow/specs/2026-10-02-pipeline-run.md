---
状态: done
级别: L2
日期: 2026-10-02
模块: pipeline
备注: 关联 intents/2026-10-02-pipeline-run.md（已 approved）；工单协议与 run 事件流两张新宿主面契约在本 spec 定稿
确认指纹: 0fe9ec219d62da9f
---
# SPEC — pipeline-run

## 功能行为

### 命令面（唯一用户接口，跨宿主一致）

| 命令 | 参数 | 语义 |
|------|------|------|
| `start` | `"<需求原文>"`（必填）、`--hint "kind=require level=L1 module=wiki"`（可选，预判供 triage 参考） | 建 run（runId=`YYYYMMDD-HHmm-<slug>-<rand4>`，slug 为需求 ASCII kebab 化），落 run 文件，停机在 TRIAGE 工单 |
| `next` | `--run <id>`（缺省取最新未终态 run）、`--triage kind=\|level=\|module=`（triage 回填）、`--delegated "<用户原话>"`（确认门代录） | 从当前停机点推进：先机器校验上一工单产出，再连跑确定性步骤直到下一停机点（工单/确认门/门拒/完成） |
| `status` | `--run <id>`、`--adopt`、`--json` | run 全量细节：阶段、事件流水（每道门命令+真实退出码+耗时）、工单历史；`--adopt` 按文档现状重建丢失/损坏的 run 文件 |
| `watch` | `--run <id>`、`--interval <秒，默认 2>` | 轮询重绘终端视图（纯 reprint 清屏，无 TUI 依赖）；Ctrl+C 退出（不影响 run） |
| `abort` | `--run <id>`、`--to superseded\|cancelled`、`--delegated "<原话>"` | 显式放弃：对已 approved 的入口/spec/plan 逐份走 confirm-doc `--to`；run 置 aborted |

**退出码**：`0`=正常停机或完成；`2`=门拒绝（前置未过 / confirm-doc exit 2 / 修复环超限——原样透传原因，不绕不吞）；`1`=用法错 / 内部错。
**停机点机器可读标记**：stdout 末行恒为 `PIPELINE-STOP <type> <detail>`（type∈`work-order|await-confirm|gate-fail|done|aborted`），其前为人类可读工单全文/确认要点——宿主 AI 按末行分流，不解析自然语言。

### 状态机（阶段迁移表，next 的全部合法路径）

以 require×L2 为例（完整路径）；其余路径为其子集/变体：

```
TRIAGE(WO) ──triage 回填──▶ KB_GATE(kb-search，命中附进上下文) ─▶ FILL_INTENT(fill-intent)
  ─▶ DRAFT_INTENT(WO) ──校验──▶ AWAIT_CONFIRM(intent)
  ──next --delegated──▶ CONFIRM(confirm-doc) ─▶ DOCS_COMMIT_BATCH₁(三件套 approved 后，见提交节奏)
  ─▶ FILL_SPEC(fill-spec，G1 前置门兜底) ─▶ DRAFT_SPEC(WO) ──校验──▶ AWAIT_CONFIRM(spec)
  ──delegated──▶ CONFIRM ─▶ FILL_PLAN ─▶ DRAFT_PLAN(WO) ──校验──▶ AWAIT_CONFIRM(plan)
  ──delegated──▶ CONFIRM ─▶ AWAIT_CONFIRM(改动清单——对话级，--delegated 记 run 事件不进台账)
  ──delegated──▶ IMPLEMENT(WO) ──校验 diff⊆授权──▶ VERIFY_GATE(verify.mjs)
       ▲                                    │非零（stderr 入上下文，fixLoop.count++，cap 3）
       └──────── FIX(WO) ◄──────────────────┘
  ─零─▶ REVIEW(WO，仅 L2/L3) ──复核结论入 spec 节──▶ CLOSEOUT(WO 勾验收补证据)
  ──校验全勾+证据──▶ AWAIT_CONFIRM(done：入口+spec+plan 逐份) ──delegated──▶ CONFIRM×N
  ─▶ DOCS_COMMIT_BATCH₂(关单态) ─▶ DONE(总结报告)
```

变体：
- **L0 docs**：TRIAGE → DIRECT_EDIT(WO，豁免 intent) → 校验 → COMMIT(常规 pre-commit) → DONE
- **L1**：同 L2 去掉 spec/FILL_SPEC/DRAFT_SPEC 段（Quick-Plan 三节）
- **L3**：spec AWAIT_CONFIRM 前插 REVIEW(WO)（独立复核，结论写 spec「确认与复核」节）
- **incident（kind=fix）**：INCIDENT_DRAFT(WO，含三件套起草) → AWAIT_CONFIRM(草稿) → 两跳 fixed→closed 各自 AWAIT_CONFIRM；plan 不可免
- **verify-only / review**：TRIAGE → 短路径直达对应门与报告
- **deploy-prep**：清单校验（三件 done/回归清单）到授权点停机；tag 动作由宿主按 git 纪律执行（脚本不代办）

**提交节奏（定稿，沿用房风 d9b30c7/f824e40）**：入口+spec+plan 全部 approved 后一笔 `docs(workflow)` 提交（满足 pre-commit 配对门的树内成对要求）；关单 done 后再一笔 docs 提交；代码 `feat|fix(...)` 提交随实现。全程禁 `--no-verify`。

### 工单协议（宿主面契约一）

停机点工单（stdout 全文 + run 文件 `workOrder` 字段同构）：

```json
{
  "id": 7,
  "kind": "triage | draft | implement | fix | review | closeout | deploy-prep",
  "title": "人类可读标题（如：起草 spec workflow/specs/xxx.md）",
  "goal": "一句话目标",
  "instructions": ["编号步骤…（含引用的既有命令文档）"],
  "context": { "docPath": "", "kbHits": ["命中文件 — 匹配行"], "stderrTail": "", "relatedDocs": [] },
  "constraints": ["授权文件：…（偏离即停：公共接口/计划外文件/新依赖 → 停机上报，不自行放行）"],
  "acceptance": ["脚本将机器校验的判据（见校验规则）…"]
}
```

宿主义务（由命令文档 pipeline-run.md 承载）：按单干活、不越授权、需要用户输入时转述要点索原话、**永不编造原话**、干完回跑 `next`。

### run 事件流（宿主面契约二）

run 文件 `.agents/cache/pipeline-runs/<runId>.json`（gitignored；非权威——workflow/ 文档 + confirmations.jsonl 仍是唯一真相源，run 丢失可 `status --adopt` 按文档现状重建）：

```json
{
  "runId": "…", "requirement": "…", "hint": "…",
  "createdAt": "ISO", "updatedAt": "ISO",
  "triage": { "kind": "require", "level": "L2", "module": "pipeline", "decidedBy": "ai|hint", "decidedAt": "ISO" },
  "stage": "…", "stopType": "work-order | await-confirm | gate-fail | done | aborted",
  "workOrder": { …当前工单，done 后为 null },
  "awaitConfirm": { "doc": "workflow/specs/….md", "points": "要点摘要", "ledger": true } ,
  "fixLoop": { "count": 0, "cap": 3 },
  "docs": { "entry": "", "spec": null, "plan": null },
  "events": [
    { "t": "ISO", "type": "run-created" },
    { "t": "ISO", "type": "work-order", "id": 7, "kind": "draft" },
    { "t": "ISO", "type": "gate", "cmd": "node .agents/scripts/fill-spec.mjs …", "exit": 2, "ms": 210 },
    { "t": "ISO", "type": "confirm", "doc": "…", "to": "approved", "source": "chat-delegated", "quote": "…" },
    { "t": "ISO", "type": "commit", "sha": "…", "subject": "docs(workflow): …" },
    { "t": "ISO", "type": "stop", "stopType": "await-confirm", "workOrderId": null },
    { "t": "ISO", "type": "done" }
  ]
}
```

写入原子化（临时文件 + rename）；事件为 append-only（run 内），gate 事件记录**真实退出码**（脚本亲写，非宿主自报）。

### 校验规则（next 入口对上一工单产出的机器校验，不过不放行）

| 工单 | 校验 |
|------|------|
| triage | `--triage` 三值在枚举内；kind∈require/fix/verify/review/deploy、level∈L0-L3、module∈workflow-modules.txt；需求文本命中红线词而 level<L2 → 打 warning 提示就高（不自动改判，回填者负责） |
| draft（intent/spec/plan/incident） | 目标文件存在；frontmatter 键完整（状态/级别/日期/模块）；必填节标题在且内容非空；无模板占位符残留（`<…>`、`YYYY-MM-DD 用户`、`<主题>` 模式）；L 级省节合法（L1 intent 可无非目标/约束节） |
| implement / fix | `git status --porcelain` 改动集 ⊆ 工单授权文件清单；超出 → 停机上报偏离（gate-fail，不自动放行、不代删） |
| review（L2/L3） | spec「确认与复核」节含复核结论（P0/P1 清单或「无」）；有 P0/P1 未定性 → 停机交用户 |
| closeout | 入口文档验收节 `- [ ]` 全部为 `- [x]` 且每条含 `证据：` |
| deploy-prep | 三件同名 done；否则停机列出缺口 |

### 测试注入契约

引擎脚本须可测（check 20）：`PIPELINE_RUN_ROOT`（仓库根重定向，对齐 CHECK_LOOP_ROOT 惯例）+ `PIPELINE_RUN_BIN`（脚本目录覆写，默认 `<root>/.agents/scripts`）+ `PIPELINE_RUN_GIT_BIN`（默认 git）——夹具目录放假 fill-*/confirm-doc/git，状态机全分支与退出码路径在夹具上跑通；所有子进程调用经单一 `runGate()` 收口。（实现披露 2026-10-02：npm 不设独立注入点——测试门统一走 verify.mjs、其内部自跑 npm test，原方案 `PIPELINE_RUN_NPM_BIN` 裁撤。）

## 数据流

```
宿主（AI/人）─ start/next ─▶ pipeline-run.mjs ─┬─ 读写 run 文件（.agents/cache/pipeline-runs/）
                                               ├─ spawn 既有门：kb-search / fill-* / confirm-doc /
                                               │  verify.mjs / check-loop / doctor / gen-workflow-index
                                               │  （PIPELINE_RUN_BIN 注入点；退出码入事件流）
                                               ├─ spawn git（add/commit——经 .githooks pre-commit，
                                               │  永不 --no-verify；PIPELINE_RUN_GIT_BIN 注入点）
                                               └─ 校验产出：读 workflow/ 文档 frontmatter/节/git status
stdout ◀── 阶段条 + 工单全文 + PIPELINE-STOP 末行（宿主消费）
持久化真相源：workflow/ 文档（frontmatter 状态机）+ .agents/confirmations.jsonl（append-only 台账）+ git
观测面：run 文件 → status/watch/阶段条；（二期）ensure-board 读 pipeline-runs/ 渲染面板
```

无网络、无第三方调用、无数据库；run 文件为本地缓存态。

## 系统改动

| 类型 | 文件 | 说明 |
|------|------|------|
| 新增 | `templates/_agents/scripts/pipeline-run.mjs` | 状态机 + 命令面 + 工单协议 + 事件流 + 校验（约 600-800 行，零依赖） |
| 新增 | `templates/_agents/scripts/pipeline-run.test.mjs` | 夹具驱动：全路径分支 / 门退出码 / 工单 schema / 校验规则 / 观测输出 |
| 新增 | `templates/_agents/commands/pipeline-run.md` | 命令封装：frontmatter（triggers/fallback=主智能体亲自做 AI 槽位）+ 驱动协议正文 |
| 同步 | `.agents/scripts/` 与 `.agents/commands/` 装副本 | `bin/flow-kit.mjs sync` 收养（managed 台账登记） |
| 修改 | `templates/_agents/commands/new-task.md`（+装副本） | 互引一行：pipeline-run=自动化驱动并列入口 |
| 修改（owned 手动） | 根 `AGENTS.md` 项目适配区 | 一行入口说明 |
| 不改 | CI / package.json | shipped 套件通配 `*.test.mjs` 自动捡入；npm test 走 run-tests.mjs 既有发现逻辑 |
| 二期（不在本 spec 范围） | ensure-board.mjs 执行器面板 | 另立任务 |

## 约束遵守映射

- **AGENTS.md「三处禁 --no-verify」**：所有 git 调用不带该旗标；被拦即 gate-fail 停机透传（settings deny 已双层兜底）。
- **确认唯一入口 confirm-doc**：脚本永不直改文档状态；代录原话逐份透传、不编造（沿用官方语义，2026-10-01 v09 教训）；改动清单等对话级确认只记 run 事件、不伪装台账。
- **逐阶段前置（stage-gate-machine）**：不复制判据——fill-spec/confirm-doc 自带 G1/G2 硬门，脚本顺序调用自然受其约束，exit 2 原样停机。
- **双源纪律**：一切改动落包源 templates/_agents/ 再 sync；new-task.md 改动后 sync-hosts --apply；AGENTS.md owned 手动。
- **引擎脚本测试覆盖（check 20）**：pipeline-run.test.mjs 同批交付，登记免测表不需要。
- **Conventional Commits 中文**：docs/feat 提交格式沿用。
- **不 spawn AI / 零依赖 / 跨平台**：纯 node:child_process+node:fs；Windows/Linux/macOS 同码（对齐 ensure-board 经验，无 shell 专属调用）。
- **用户全局 AGENTS.md 验证阶梯**：复用全部既有门脚本，无新造轮子；新增面最小（1 脚本+1 测试+1 命令文档）。

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| 宿主不照单干活/跳 next | 低 | 状态不推进（脚本垄断状态迁移）；跳步被 fill/confirm 前置门 exit 2 打回；无损失 |
| run 文件被篡改 | 低 | 非权威；权威在文档+台账；--adopt 重建即现形 |
| 状态机边角死循环 | 中 | 每停机点幂等（重跑 next 重校验不重做）；修复环 cap 3；负例演练覆盖 |
| confirm-doc 语义漂移（脚本透传错） | 中 | 薄封装不重实现——仅拼参数 spawn，退出码透传；测试夹具钉住 exit 1/2 行为 |
| git 提交在无钩子环境漏门 | 低 | CI 五道门服务端兜底（ci.yml 既有）；pre-push check-loop 复扫 |
| 工单协议成为新的 prose 漏洞面 | 中 | 命令文档只管「怎么驱动」；放行权全在机器门——工单写得再好也过不了没跑的门 |
| 回滚 | 低 | 纯新增文件，回滚=删文件+sync；run 文件在 cache 不入库 |

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核——建议 spec 确认前由 independent-reviewer 预审工单/事件流两张 schema（用户拍板是否需要）
