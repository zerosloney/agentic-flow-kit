---
状态: approved
级别: L2
日期: 2026-09-23
模块: pipeline
备注: M4 范围经用户对话内确认（包仓库自装；Shipyard.Material 回流另立）。时序说明：plan 先于本 spec 起草（dogfooding 首轮对 L2 配对要求感知不足，由 check-loop 逼出补齐）——内容无冲突，spec 为设计权威回填。
---
# SPEC — M4 自装 dogfooding

对应入口：../intents/2026-09-23-m4-dogfooding.md

## 功能行为
- 本仓库以普通消费者身份执行 `flow-kit init --hosts zcode --stack none --board-port 8933`：安装 .agents/ 引擎、.githooks/ 真门禁、wiki/ 骨架、AGENTS.md（项目适配区自填）；既有 workflow/ 留痕走保守跳过，不迁移不改写。
- 安装后本仓库的每次 commit 依次穿过：闭环配对（增量）→ wiki 台账 → 规则面预算 → local-pre-commit 挂载点 → commit-check（敏感扫描 + 条件构建/checks）→ commit-msg；pre-push 再跑 check-loop 全量断档扫描。
- 双源纪律：本仓库既是包源（templates/）又是装户（.agents/）。引擎改动一律改 templates/ → `node bin/flow-kit.mjs sync` 更新装副本；sync 按 kit.json 台账三方比对分派（未动覆盖 / 已改跳过 / 移除报告）。

## 数据流
- 包源 `templates/` + `modules/` --init/sync 渲染（BOARD_PORT 等变量）--> 装副本 `.agents/`、`.githooks/`；台账 `.agents/kit.json`（managed sha256 + owned）随写随更；doctor 按台账校验漂移。
- 留痕回路：intents/specs/plans/incidents → `gen-workflow-index.mjs` 生成 `workflow/INDEX.md`（锚点内重写）→ 检索（kb-search）与看板（board server）消费。
- 测试入口：`npm test` → `src/run-tests.mjs` 顺序 spawn 7 套（CLI 单测 + 引擎 5 套 + check-loop bash 套件）。

## 系统改动清单
- 后端（本仓库即工具链）：新增 `.agents/` 全套、`.githooks/`、`wiki/`、`AGENTS.md`、`src/run-tests.mjs`、package.json scripts.test；`flow-kit sync` 首次实战落地装副本。
- 数据库：无。
- 前端：无。

## 约束遵守映射（对照 AGENTS.md 触达红线）
| 红线 | 本 spec 如何满足 |
|------|------------------|
| workflow 留痕可增不可删 | 既有 M1/M3 文档零改动（git diff 空），仅增量补模板基线件 |
| 引擎双源（templates 为包源） | 安装后引擎改动走 templates → sync；.agents/ 直改会被 doctor 台账漂移告警（写入 AGENTS.md 项目适配区） |
| 测试不放提交门 | commit-check 保持 none 空基线；测试收敛为 `npm test` 供 test 阶段门使用 |
| 存量包行为不变 | src/ 既有实现零改动；新缺陷（CJS 扩展名）走 incident 闭环修复 |

## 风险评估
- 旧装户（v0.1.0 手动装）没有 sync 台账 ｜ 应对：sync 无 kit.json 时明确报错引导 init（已实现）
- e2e 环境单一性盲区（无 package.json / 无 type:module 场景） ｜ 应对：本仓库真装常驻即常驻哨兵；回归清单已追加条目
- 看板端口与既有进程冲突 ｜ 应对：ensure-board 幂等探活，他人进程不 kill 只报告

## 确认与复核
> 个人工作流：确认 = 用户在对话内一句话通过；无第二审批人，追溯靠 git（commit 记录确认时点）。

- 确认通过（2026-09-23 对话内：M4 范围=包仓库自装）后起草并回填 plan/spec；实施结果见 intent 验收勾验。
