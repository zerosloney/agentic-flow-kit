---
状态: approved
级别: L1
日期: 2026-09-25
模块: pipeline
备注: L1（新增 3 个填空工具脚本 fill-{intent,spec,plan}.mjs + 套件 + 双源同步 + plan/design 流程嵌入；不修改契约字段、不触红线）
---
# INTENT — 文档闭环填空工具（fill-{intent,spec,plan}.mjs）

<!-- 复制本模板为 YYYY-MM-DD-<主题>.md 后填写；plans/ 下同名文件与本文件配对 -->
<!-- frontmatter 受限子集（2026-09-13）：每行 `键: 值`；状态∈draft/approved/done/superseded/cancelled（严格枚举，附注写备注键）；级别∈L0/L1/L2/L3；check-loop 只扫 frontmatter 取机器字段，正文不再写状态/级别行 -->

## 背景与问题

- 立 intent / spec / plan 时 AI 起草 6/5/4 节内容，质量参差：有时漏填、有时不展开、字段顺序混乱
- 当前无结构化填空工具——AI 起草全靠自觉读 `_TEMPLATE.md`，质量无量化保证
- intent 6 节（背景与问题 / 目标 / 非目标 / 约束 / 影响面 / 触达红线）+ 验收标准共 7 段；spec 5 节；plan 4 节（L1 极简 2 节）。每节必填项不统一，AI 容易遗漏
- 33 个历史 intent + 19 个 plan + 3 个 spec 显示起草规范化有需求
- 模板化填空 + 测试断言是最高 ROI 的改进路径（与 2026-09-25-cross-host-sync 同源经验）

## 目标

- 新增 3 个工具脚本：`templates/_agents/scripts/fill-intent.mjs` + `fill-spec.mjs` + `fill-plan.mjs`
- 每个工具读 `_TEMPLATE.md` 结构 + 用户问答结果 → 输出符合 frontmatter 受限子集与 6/5/4 节规范的草稿文件
- L1 默认输出极简形态（plan §1 段）、L2/L3 输出完整 4 节
- 新增 3 个套件（每个工具 1 个），断言：①必填字段都在 ②frontmatter 字段值符合协议 ③正文段数匹配模板
- 双源纪律：包源（templates/）+ 装副本（.agents/）双写；按 2026-09-25-wf-runtime 复盘手动同步
- 嵌入 plan.md / design.md 流程：「起草前先跑 `node .agents/scripts/fill-plan.mjs` 拿结构化清单」

## 非目标

- 不替代 AI 起草能力（填空清单让 AI 据此填空，但思考由 AI 做）
- 不做 KB 检索（kb-search.mjs 已存在）
- 不替代 `_TEMPLATE.md`（fill 工具读模板后填空，不重写模板）
- 不改 plan.md / design.md / maintain.md 流程的"两道确认门"（仅嵌入填空工具作为起草阶段）
- 不引入新依赖（零运行时依赖纪律）

## 约束

- **零依赖**：仅 `node:fs` / `node:path`，不引第三方
- **frontmatter 受限子集**：状态 / 级别 / 日期 / 模块 / 备注 5 个字段；check-loop 扫 frontmatter 取机器字段，正文不再写状态/级别行
- **引擎双源纪律**：templates/_agents/scripts/fill-*.mjs（包源）+ .agents/scripts/fill-*.mjs（装副本）双写；按 2026-09-25-wf-runtime 复盘手动同步装副本，commit 内一并落地
- **零引入模板变更**：`_TEMPLATE.md` 内容不动（fill 工具读模板后填，不重写）
- **结构化填空清单**：每节明确"必填 + 选填 + 模板句"，AI 据此填空；不强制字段值（让 AI 决定内容）

## 影响面

- 模块：pipeline
- 数据库：无
- 新增/修改文件：
  - `templates/_agents/scripts/fill-intent.mjs`（包源 + 装副本双写）
  - `templates/_agents/scripts/fill-spec.mjs`（包源 + 装副本双写）
  - `templates/_agents/scripts/fill-plan.mjs`（包源 + 装副本双写）
  - `templates/_agents/scripts/fill-intent.test.mjs` + `fill-spec.test.mjs` + `fill-plan.test.mjs`（包源 + 装副本）
  - `.agents/scripts/fill-*.mjs`（装副本 6 份）
  - `.agents/commands/plan.md`（嵌入 fill-plan 步骤）
  - `.agents/commands/design.md`（嵌入 fill-spec 步骤）
  - 装副本对应件（按双源纪律手动同步）
  - `.agents/kit.json`（新增 6 份 managed 文件台账）

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）

- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2
- [ ] schema / 迁移 SQL / DI 链 / 认证与中间件管线 → 级别 L3

> 本 intent 不触及上述任一红线——新增工具脚本不修改契约字段、不修改既有接口语义。故 L1 立项，不立 spec。

## 验收标准（可测试）

- [ ] `node .agents/scripts/fill-intent.mjs` 跑出含 frontmatter（状态/级别/日期/模块/备注 5 字段）+ 7 节正文（背景与问题/目标/非目标/约束/影响面/触达红线/验收标准）的草稿文件
- [ ] `node .agents/scripts/fill-spec.mjs` 跑出含 5 节正文（功能行为/数据流/系统改动/约束遵守映射/风险评估）的草稿文件
- [ ] `node .agents/scripts/fill-plan.mjs --level L1` 跑出极简 2 节（改动面/验证方式）；`--level L2` 跑出完整 4 节
- [ ] 草稿 frontmatter 字段值符合协议：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3
- [ ] 双源纪律（包源 + 装副本 6 份 + 6 份套件双写）
- [ ] 3 个新套件全绿（fill-intent / fill-spec / fill-plan 各 1 PASS 套件；断言必填字段、frontmatter 协议、正文段数）
- [ ] `npm test` 全绿（既 113 + 3 新 = 116 PASS）
- [ ] `flow-kit doctor` 10 PASS / 0 WARN / 0 FAIL
- [ ] plan.md / design.md 流程嵌入「先跑 fill-{plan,spec}.mjs 拿结构化清单」步骤；不修改两道确认门

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 实测输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 warning。

## 确认与复核

- 确认日期：2026-09-25
- 确认人：用户（对话内一句"开始"即确认）
- 确认范围：intent 整体 + 4 个关键决策点拍板：
  1. **L1 立项**（不改既有契约）
  2. **3 个工具独立**（不合并为单入口；让 plan.md / design.md 各自引用对应工具）
  3. **frontmatter 受限子集约束**（5 字段枚举值严格；超出报错）
  4. **零依赖**（与既有 .agents/scripts/ 风格一致）
- 复核：L1 不要求独立复核