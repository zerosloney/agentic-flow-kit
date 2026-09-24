---
状态: done
级别: L1
日期: 2026-09-24
模块: pipeline
备注: 需求来源：EvoX 评审文档（2026-09-24/EvoX-c808f473/agentic-flow-kit-workflow-review.md）建议的 runtime/state machine/事件协议，经对话取舍收敛为最小固定编排。2026-09-24 用户对话内选定范围「只做关单 verify 脚本」并回复「开工」确认实施。定性：新增独立工具，不改既有门禁语义（测试仍不进提交门，check-loop 行为不变），故 L1。
---

# INTENT — 关单 verify 固定编排脚本

## 背景与问题
仓库口径「测试不放提交门，关单在 test 阶段门」，但 test 阶段目前没有机器门：npm test 跑没跑、过没过，靠 agent 按文档自觉执行；check-loop 只拦「验收框没勾」，拦不住「没跑测试就勾」。关单是流程中唯一没有固定编排的时刻。

## 目标
- 新增一个写死顺序的关单验证脚本（拟 `.agents/scripts/verify.mjs`，包源 `templates/_agents/scripts/` 同步）：依次执行 `npm test` → `check-loop.sh`，逐项输出 pass/fail，任一步失败则非零退出且保留失败原因
- 关单动作收敛为：跑 verify → 绿了才翻 done

## 非目标
- 不做 DSL / 配置文件 / 状态文件 / step cursor（固定编排的价值在写死，可配置即绕回 schema）
- 不做按阶段 stage runner 框架、不做 `flow-kit run` 入口、不做 next 状态导航
- 不改提交门：测试依旧不进 pre-commit，check-loop 与各 hooks 行为不变
- 不做事件日志 / run ID / 事件协议

## 约束
- 复用现有 `check-loop.sh` 与项目 `npm test`，不重写等价校验
- 引擎双源纪律：改 `templates/_agents/scripts/`（包源），经 `node bin/flow-kit.mjs sync` 更新 `.agents/` 装副本
- 风格随现有 `.agents/scripts/*.mjs`（node 直跑、无新依赖）

## 影响面
- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）
- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2

> 红线说明：新增独立脚本与 test.md 关单节的增量用法说明，不改任何既有契约 / 门禁语义，故保持 L1；若实施中发现需改动既有 hooks 或 check-loop 行为，则升级 L2 并补 spec。

## 验收标准（可测试）
- [x] 绿路径：`node .agents/scripts/verify.mjs` 依次执行 npm test 与 check-loop，全过时退出 0 且逐项输出 pass（证据：实跑 exit 0，输出「✅ 1/2 测试通过 / ✅ 2/2 闭环校验通过 / 全绿——可以关单」；npm test 全套件含 check-loop bash 套件 34 PASS，实现 commit 434755e）
- [x] 红路径：npm test 或 check-loop 任一失败时非零退出，失败原因原样保留不被吞（证据：verify.test.mjs 6/6 PASS——场景 2 步骤 1 假败 exit 1、场景 3 配对断裂夹具 exit 1；stdio inherit 直通不吞）
- [x] 双源一致：sync 后 `.agents/scripts/verify.mjs` 与 templates 包源一致，doctor 无漂移告警（证据：flow-kit sync「新增安装 2 + 覆盖更新 1」，doctor 8 PASS 0 FAIL 无漂移）
- [x] test.md 关单节补一行 verify 用法（证据：commit 434755e diff——templates/_agents/commands/test.md 与装副本关单节首行）

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 warning。
