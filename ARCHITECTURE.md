# ARCHITECTURE — AI-Native 工作流引擎架构（单源速览）

> 本文件是引擎架构的在案单源（2026-10-09 engine-quality-round2 E 落地）。定位：新读者 10 分钟理解骨架，
> AI 会话免于「靠会话记忆手答架构」。变更随引擎演进更新；门禁判据的权威面仍在 `.githooks/` /
> `check-loop.mjs` 头部注释（本文件只做索引，不复制判据——防双源漂移）。

## 1. 一句话定位

把软件工程治理（门禁、确认、溯源）编译成「机器可执行的文件系统协议」：AI 干活，机器把门，
用户只在风险决策点出现。引擎 ~23k 行零运行时依赖纯 JS（node ≥18），46 测试套件（`npm test` 按盘面 glob 枚举）。

## 2. 三层分发（引擎如何到达宿主）

```
templates/（包源，唯一改这里）
   │ flow-kit sync（三态覆盖 + kit.json managed 台账，109 份）
   ▼
.agents/（装副本 —— 本仓自己也是装户）
   │ flow-kit sync-hosts --apply（单向：正文段对齐，frontmatter 保留宿主特化）
   ▼
modules/hosts/{claude,codex,cursor,omp,opencode,trae,zcode}/ + 项目根宿主点（.zcode/ 等）
```

- 直改 `.agents/` → doctor 台账漂移告警（检查 §6.6）；双源差异三道兜底：`source-sync-check`
  （结构比对）/ doctor §6.6（owned 哈希）/ §6.7（薄适配正文漂移）。
- sync-hosts 对账面自描述（`--diff` 输出「对账面：」行）——对账覆盖哪些根一目了然（B1 教训）。

## 3. 闭环模型（任务如何流动）

**唯一真相源 `workflow/`**：`intents`（为什么）→ `specs`（怎么设计）→ `plans`（怎么做）→
`incidents`（学到了什么），同名配对即闭环。

**风险泳道**（`new-task.md` §级别判断）：L0/L1 协作道（轻确认 + 异步审计）｜L2/L3 防御道
（同步确认门：spec 确认才能起草 plan，plan 确认才能动手；L3 加新会话独立复核）。

**确认门 `confirm-doc.mjs`**：全部状态流转唯一入口。两跳闭环禁单跳；TTY / `--delegated "<原话>"`
双形态（台账记 source+quote 供对质）；内容绑定（关单即冻结，编辑触发检查 15 hard）；approved
留痕前置。台账 append-only + **哈希链**（每行 prevHash/hash，就地改/删必留断链痕迹——整文件
重写不可机器防，兜底 = 台账自身 git 历史，边界见 `policy.mjs#ledgerChainHash`）。

## 4. 门禁体系（20 项检查 + 三层布防）

```
.githooks/pre-commit（闭环配对/泳道/wiki台账/规则预算/双源/敏感扫描）
   ↓
check-loop.mjs（20 项检查，237 断言）——闭环完整性总裁判
   ├─ check-hygiene.mjs（2/9/11/12/13）   ├─ check-stage-index.mjs（7）
   ├─ check-metric-claims.mjs（16）        └─ policy.mjs（policyVersion 生效日锚表）
   ↓
verify.mjs（npm test + check-loop，绿凭证落 verifications.jsonl，--doc 绑单）
   ↓
CI（ci.yml：五道机器门 + npm install + npm test + shipped 装户视角 + CI 红回溯点名）
```

- **20 检查索引**：1 配对(hard) 2 占位符 3 复盘三件套 4 引用有效 5 状态+L3复核 6 角色契约
  7 阶段索引 8 验收对账(凭证/SHA) 9 文件名 10 迁移一致 11 生成物漂移 12 模块词表
  13 体积预算 14 确认留痕 15 指纹+台账+哈希链(hard) 16 量化签名 17 发版收口(hard)
  18 委派对账 19 逐阶段审计 20 测试覆盖。权威判据=check-loop.mjs 头部清单（gate-checklist 按 id 消费）。
- **生效日锚**：机制上线前的存量单不被新机制追责（`verifySince`/`verifyDocSince`/`delegationSince`
  等）——「不追溯」与「不伪造」是门禁可信度的两根柱子。
- **编辑时防护**：`edit-face-check.mjs`（工作树面 CHECK_LOOP_ROOT 全扫 + 预算 advisory）——
  常驻面约束左移到编辑期（check-loop 仓库模式只扫 HEAD，编辑期原为零反馈）。

## 5. 双入口执行器

| 入口 | 形态 |
| :- | :-- |
| 手动路由 `new-task.md` | AI 读阶段索引 + 级别判据，逐阶段走命令文档 |
| 自动化 `pipeline-run.mjs` | 状态机六阶段（882 行），AI 槽位走工单协议，人件门 `PIPELINE-STOP` 停机 |

内部三层单向：CLI 编排 → `pipeline-run-run.mjs`（run 存储）→ `pipeline-run-docs.mjs`（文档纯函数）；
契约（五子命令输出/exit/四注入点）逐字节稳定。

## 6. 自我度量

gate-seg 插桩（20 段计时/计数）→ `agg-gate-stats`（噪声率 top/死检查）；`delegations.md`
双归因（返工×N / 门禁噪声×M）→ 月度一次通过率（门槛 ≥90%）；DASHBOARD/metrics 生成物带
`--check` 漂移门。

## 7. 质量底座

46 测试套件（`npm test` 按 `src/` 与 `templates/_agents/scripts/` 两面 glob 盘面枚举，新增测试文件不会被静默漏挂）；eslint 9 入 npm test 首步（裸 checkout 显式 skip）；零运行时依赖；scripts-test-exempt
登记制（登记 ≠ 免责，评估定性在案）。

## 8. 已知边界与缓做项（诚实声明）

- 台账可伪造的完整边界见 §3 与 policy.mjs 注释（本地信任边界的诚实口径）。
- 缓做（papercuts 在案）：MCP server 化、多仓 fleet 视图、门禁增量缓存（样本<5 不决策）、
  stage-gates 机器层 L2 快车道（治理语义留拍板）。
