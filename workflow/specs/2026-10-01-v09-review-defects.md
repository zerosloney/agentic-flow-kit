---
状态: approved
级别: L2
日期: 2026-10-01
模块: pipeline
备注: v0.9.0 审查缺陷批修复——确认门契约防自动伪造 + 加固门目标分支判定；入口 incidents/2026-10-01-v09-review-defects.md
确认指纹: bd8515a757685dc2
---
# SPEC — v09-review-defects（审查缺陷批修复）

> 对应 incident：`incidents/2026-10-01-v09-review-defects.md`。修复两项审查发现的高危缺陷（Critical 伪造代录 + Major 加固门直推绕过）。

## 功能行为

### 修复 ①：solidify-task.mjs 移除自动伪造代录（Critical）

| 场景 | 现状 | 修复后 |
|------|------|--------|
| 无参运行 `solidify-task --topic X` | 自动 `--delegated "固化 L1 任务 X：用户确认草稿无误…"` 写 `source=chat-delegated` 台账 | **只迁移 + 更新索引**，绝不落账；末尾打印指引：逐份 `confirm-doc.mjs <rel>`（TTY）或由操作者在用户对话确认后以 `--delegated "<原话>"` 显式执行 |
| 显式传参 `solidify-task --topic X --delegated "<用户原话>"` | 无此参数 | 将**调用方提供的原话原样**转发给 `confirm-doc <rel> --delegated "<原话>"`（逐份）；quote 恒为外部输入，脚本不再编造任何话术 |
| 无 trust 检查 | 不读 trust-mode | 保持不变（`--delegated` 仍需用户对话确认，脚本不隐式用 `--auto`）；如需自动化可显式 `--auto`（配合 trust-mode=Trusted，由 confirm-doc 自身判定与拒绝 L2/L3） |
| 确认失败 | 打 stderr 后继续、仍报成功 | 失败计数 + 汇总，任一失败最终 `exit 1`；成功后仍更新索引，索引更新失败也传播退出码 |
| 死代码 | `targetName`/空 if/`targetKebab` 恒等函数 | 全部移除；`finalName` 保留为唯一命名逻辑（`/^\d{4}-\d{2}-\d{2}-/.test(file) ? file : today-前缀`） |
| 测试覆盖 | 无 `.test.mjs` | 新增 `templates/_agents/scripts/solidify-task.test.mjs`，纳入 npm test |

### 修复 ②：pre-push 加固门按目标分支判定（Major）

| 场景 | 现状 | 修复后 |
|------|------|--------|
| `push origin experiment/x:main` | `case "$local_ref" in experiment/*)` 命中即 advisory `continue`，加固门不执行 | **按 `$remote_ref` 判定**：`main` → 必跑 `--hardening`；`experiment/*` → advisory（报告不阻断）；其他 → normal 全量扫描 |
| `push origin main:main` | hardening ✓ | hardening ✓（不变） |
| `push origin experiment/x:experiment/y` | advisory | advisory ✓（不变） |
| `push origin main:experiment/x` | 不匹配本地 experiment → normal | advisory（目标在探索泳道——语义与 README「experiment 泳道降级 advisory」一致） |
| 头注/报错文案 | 分支语义混用 local_ref | 头注与 message 同步改为「目标分支」口径 |

## 数据流

- **solidify**：`.zcode/drafts/<topic>.md` → 迁移 `workflow/<intents|plans|specs|incidents>/YYYY-MM-DD-*` →（可选 `--delegated` 原话）逐份 `confirm-doc` → 台账 `.agents/confirmations.jsonl`（quote=外部输入原样）→ `gen-workflow-index` 重生成 → 汇总退出码
- **pre-push**：`git push` stdin 行（local_ref/local_sha/remote_ref/remote_sha）→ 按 `$remote_ref` 分派：main→`check-loop.sh --rev <sha> --hardening`；experiment→advisory 扫描；其他→全量扫描 → 任一非零阻断 push

## 系统改动

| # | 文件（双源：templates/ ↔ .agents） | 类型 | 内容 |
|---|------|------|------|
| 1 | `templates/_agents/scripts/solidify-task.mjs` | 修改 | 移除自动 `--delegated`；新增 `--delegated "<原话>"` 与 `--auto` 显式旗标（转发原话 / 委托 confirm-doc 自治）；失败计数 + 退出码传播；清理死代码 |
| 2 | `templates/_agents/scripts/solidify-task.test.mjs` | 新增 | fixture：默认不落账 / `--delegated` 原样转发断言 / 缺主题 exit 1 / 非文档草稿跳过 / 失败退出码 |
| 3 | `templates/_githooks/pre-push` | 修改 | 判定键从 `$local_ref` 改 `$remote_ref`；三态分派（hardening/advisory/normal）；头注与 message 口径更新 |
| 4 | `templates/_agents/scripts/check-loop.test.mjs` 或新增 hook fixture | 修改/新增 | pre-push 决策 e2e：注入桩 `check-loop.sh` 记录 argv，断言 `experiment/x:main` → 含 `--hardening`、`experiment/x:experiment/y` → 不含、`main:main` → 含 |
| 5 | `workflow/README.md` + `templates/workflow/README.md`（owned 对） | 修改 | 规范条目①：确认门禁隐式调用——`--delegated` 仅限对话内用户原话，官方脚本不得自动代录 |
| 6 | `.agents/commands/build.md` / `new-task.md` 或快车道文档（owned 对） | 修改 | L1 快车道流程补「solidify 需显式用户确认后带参执行」说明 |
| 7 | `.agents/kit.json` | 自动 | sync 登记新测试文件 |
| 8 | `.agents/confirmations.jsonl` | 不动作 | 当前零伪造行，无需清理（修复前复核确认） |

## 约束遵守映射

- **确认门契约（AGENTS.md / workflow/README 确认门）**：`--delegated` 仅用于对话内用户原话——修复后脚本不产生任何 quote，quote 全部来自调用方显式参数（或 confirm-doc 的 TTY/--auto 自身判定）✓
- **不吞异常（AGENTS.md §6）**：确认失败计数并退出非零 ✓
- **清理孤儿（§3）**：targetName/空 if/targetKebab 死代码随本修复删除（本批直接产生的废弃）✓
- **双源纪律**：全部先改 `templates/` 再 sync ✓
- **只增不松**：pre-push 的 normal/hardening 行为不减弱；唯一放宽面是「main→experiment」从 normal 变 advisory——语义与 README「experiment 泳道」一致，属修正常非放宽 ✓
- **非平凡逻辑留可运行检查（§4）**：两个修复均补 fixture 用例，纳入 npm test ✓

## 风险评估

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| R1 | 修改后 solidify 无参运行时用户忘了确认步骤，L1 任务草稿落档但未确认（闭环断档） | 低 | 输出显式指引 + 迁移后的文档仍为 draft（check-loop 会对 approved/done 前状态不硬拦）；配对门在提交时会提示 |
| R2 | `--auto` 旗标在 Strict 下被 confirm-doc 拒绝（exit 2），脚本误报失败 | 低 | 失败计数 + message 引导查 trust-mode；测试覆盖拒绝路径 |
| R3 | pre-push 判定键迁移遗漏 local 分支语义（如 detached 推送） | 低 | 三态用例覆盖 local/remote 组合；detached 时 local_ref 为 HEAD、按 remote 判定仍正确 |
| R4 | 装户升级差异（旧钩子/旧脚本） | 低 | 双源 sync 整体下发；pre-push 行为仅判定键变化，无 schema/状态 |
| R5 | 回归 | 低 | 全量 npm test + verify.mjs + fresh-clone 门禁复跑 |

## 确认与复核

- 确认日期：2026-10-01（用户对话内「确认」代录，台账 source=chat-delegated）
- 复核：L2——independent-reviewer 复核两项修复与 spec/incident 判据一致（含防复发用例真实性）