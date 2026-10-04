---
状态: approved
级别: L2
日期: 2026-10-04
模块: pipeline
备注: 对应 incidents/2026-10-04-plan-section-name-evidence.md
确认指纹: d6bc9743a761a53c
---
# SPEC — plan-section-name-evidence

对应入口：../incidents/2026-10-04-plan-section-name-evidence.md

## 功能行为

### 背景

- `fill-plan.mjs` 生成的 L1 Quick-Plan 主节标题为「改动方案」（`templates/_agents/scripts/fill-plan.mjs` `L1_SECTIONS[0].title`）。
- `check-loop.mjs` 的 `verifyEvidenceTruth`（检查 8 证据真相校验）只从 plan 的「`## 改动面` 或 `## 任务拆解`」节提取声明文件（`.agents/scripts/check-loop.mjs:602`）。
- 结果：L1 plan 用「改动方案」节时 `declaredFiles` 为空 → 任何真实 commit SHA 证据都判 `irrelevant`（「提交未触及 plan 声明的任何文件」）→ doctor FAIL。2026-10-04-board-run-panel 实证触发。

### 行为变化

- `check-loop.mjs` `verifyEvidenceTruth` 的声明节名正则从 `^##\s+(改动面|任务拆解)` 扩展为 `^##\s+(改动面|任务拆解|改动方案)`，使 fill-plan 生成的 L1 Quick-Plan「改动方案」节被识别为声明文件来源。
- 行为边界：
  - 三种节名（改动面 / 任务拆解 / 改动方案）均为合法声明节，证据校验对三者一视同仁。
  - 节名不在三者内（如「修改内容」「变更清单」）→ 维持现状（不识别，`declaredFiles` 为空 → 证据判 irrelevant）。这不是本次修复范围；新增节名须同步扩展正则。
  - 校验逻辑其余部分（SHA 解析 / rev-parse / 文件交集 / pipeline-run 过程证据兜底）不变。

### 用户 / 系统影响

- 存量 14 份用「改动方案」节的 L1 plan 的验收证据校验自动通过（不再误报 doctor FAIL）。
- 未来 fill-plan 生成的 L1 plan 验收证据校验直接通过。
- 模板正文（`_TEMPLATE.md` 第 14 行「改动面」）与 fill-plan 输出（「改动方案」）的节名差异不再导致机器误报；但注释口径仍须统一（见规范条目）。

## 数据流

```
plan 文档（L1「改动方案」节）→ check-loop verifyEvidenceTruth
  → 节名正则匹配（改动面|任务拆解|改动方案）→ 提取声明文件列表
  → git show <证据SHA> --name-only → 与声明文件求交集
  → 有交集 → 证据有效（sha）；无交集且非 pipeline-run 过程证据 → irrelevant（维持现状，不误报）
```

## 系统改动

- `templates/_agents/scripts/check-loop.mjs`（包源，sync 后 `.agents/` 装副本）：
  - `verifyEvidenceTruth` 内声明节名正则 `^##\s+(改动面|任务拆解)` → `^##\s+(改动面|任务拆解|改动方案)`（约 1 行）
- `templates/_agents/scripts/check-loop.test.mjs`（包源，sync 后装副本）：
  - 新增用例：plan 用「改动方案」节 + 证据 SHA 触及声明文件 → 校验通过（type=sha）；plan 用「改动方案」节 + 证据 SHA 不触及 → 仍判 irrelevant
- `templates/workflow/plans/_TEMPLATE.md`（owned，手动同步）：
  - 第 9 行注释「L1 极简形态主节：改动方案」改为「L1 极简形态主节：改动面（fill-plan 生成「改动方案」；check-loop 对 改动面/任务拆解/改动方案 均识别为声明节）」——消除注释与正文的分裂
- 不动：`fill-plan.mjs`（保持「改动方案」输出，与模板正文差异已由 check-loop 兼容）、`workflow/plans/` 存量已 done plan（内容绑定，不编辑）

## 约束遵守映射

| 红线 / 约束 | 本 spec 如何满足 |
|------|------|
| 引擎双源纪律（改 templates/ 后 sync） | 改动全落 `templates/_agents/scripts/` 包源 + `templates/workflow/plans/_TEMPLATE.md`（owned），收尾 `node bin/flow-kit.mjs sync` 更新 `.agents/`；`_TEMPLATE.md` 属 owned 手动同步装副本 |
| 规则 / 契约变更 → L2 | 本 incident 定级 L2，走 incident + spec + plan 三件套；check-loop 校验口径是规则面，改动经确认门 |
| 测试不放提交门，关单在 test | 新增 check-loop 正/负例用例进 `npm test`，test 阶段验证 |
| done 内容绑定（2026-09-28） | 不编辑任何已 done 的存量 plan；仅改引擎与模板注释 |
| 规则面预算 | `_TEMPLATE.md` 注释小幅修改（+约 40B），在预算内 |

## 风险评估

- check-loop 节名扩展后，`改动方案` 节被当作声明文件来源：风险极低，因为该节本就包含文件路径列表，语义与「改动面」一致。
- 测试覆盖不足：新增正/负例用例钉住两种节名行为。
- 模板注释与生成器仍不一致（fill-plan 输出「改动方案」，模板正文「改动面」）：已由 check-loop 兼容吸收，且注释更新说明两者均为合法声明节，不再误导。

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核——建议 spec 确认前由 independent-reviewer 预审节名扩展正则与测试用例（用户拍板是否需要）