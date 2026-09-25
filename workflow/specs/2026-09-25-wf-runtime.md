---
状态: draft
级别: L2
模块: pipeline
---

# SPEC — 编排运行时扶正：kit 自有通用运行时 + 自定义步骤扩展

对应入口：../intents/2026-09-25-wf-runtime.md

## 功能行为

### ① 运行时（`templates/_agents/scripts/wf-run.mjs`，从 git 6d6e239 复活）

workflow 脚本 = JS ESM `.mjs`（`.agents/workflows/<主题>.mjs`），default 导出 `{ name, description?, provider?, concurrency?, async run(wf) }`——**真控制流**（循环 / 条件 / Promise 组合），运行时确定性执行：

| API | 语义 |
|-----|------|
| `wf.agent(role, task, opts)` | 派单子智能体（宿主 CLI 无头会话，**不依赖宿主编排能力**）；`opts`: files / accept / context / provider / timeoutMs / retries；失败不 throw 返回 `{ok, exitCode, output, retriesUsed, blocker}` |
| `wf.gate(cmd, opts)` | 阶段门禁：shell 命令非零 throw |
| `wf.parallel(tasks)` | fan-out，受 concurrency 上限调度 |
| `wf.step(name, params)` | **调用项目自定义步骤**（见 ②），返回步骤结果 |
| `wf.log(msg)` | 进度输出 |

- prompt 组装（角色契约 + 派单头 + 红线行）、**stdin 传输协议**（批处理 shim 多行内联 fail-fast）、delegations.md 留痕、`--dry-run`、错误路径 settleAll 收尾、汇总表与退出码——全部随 6d6e239 复活（incident 2026-09-25-wf-run-review-fixes 修复不回退）。
- provider 注册表（`.agents/workflows/providers.json` 四家 stdin 形态内置 + `providers.local.json` 侧车覆写）同步回归。
- 纪律：脚本随 plan 确认后方可执行（确认前 `--dry-run`）；脚本与步骤是全权 node 代码、无沙箱、不跑来路不明件；runner 与子智能体不 commit/push。

### ② 自定义步骤扩展（新增扩展点）

`.agents/workflows/steps/<名>.mjs` 导出步骤处理器：

```js
// .agents/workflows/steps/deploy-staging.mjs —— 项目领域动作注册进编排机制
export default async function deployStaging(ctx, params) {
  ctx.log(`部署 ${params.env}…`);
  const r = ctx.spawn('npm', ['run', 'deploy', '--', params.env]); // ctx 提供 log / spawnSync 封装 / root
  if (r.status !== 0) throw new Error(`部署失败: ${r.stderr.slice(-500)}`);
  return { env: params.env, ok: true };
}
```

- 运行时启动时加载 `steps/` 目录全部 `.mjs`（文件名即步骤名）；脚本 `await wf.step('deploy-staging', { env: 'staging' })` 调用；step 内 throw → 进脚本异常路径（脚本可 try/catch）。
- `ctx`：`{ root, log, spawn(cmd, args) → {status,stdout,stderr}, params }`——刻意薄，步骤内需要更多能力直接 import node 内置与项目模块（与脚本同级信任边界，文档明示）。
- **第二层扩展**：workflow 脚本本身可 import 项目任意本地模块——steps 目录解决「可复用、跨 workflow 注册」，脚本自由解决「一次性编排逻辑」。

### ③ orchestrate.md 废止与口径改写

- 删 `templates/_agents/commands/orchestrate.md`（+ 装副本）；AGENTS.md / build.md 引用行改回 runtime 口径（「多工作包编排用运行时跑 workflow 脚本」）。
- `workflows/_TEMPLATE.md` 重写：运行时 + 编排面 API + steps 扩展 + 纪律 + **宿主互补口径**（kit 运行时不依赖宿主；ZCode / Claude Code 用户要会话内交互、断点续跑可直接用宿主原生 dynamic workflows）。
- 示例恢复 `示例-并行实现评审.mjs`（含一个 `wf.step` 用法示意，steps 示例处理器写进 _TEMPLATE 文档而非随包发货，保持装户树干净）。
- init.test.mjs ⑥ 装户面断言再改：runner / providers.json / steps 扩展点（用 fixtures steps 目录 + 探测 wf.step）/ 示例在位；**负向断言改防 orchestrate.md 回流**。

## 数据流

plan（已确认）→ workflow 脚本（.mjs）→ 运行时解析校验 → `wf.agent` spawn provider CLI（stdin 协议）/ `wf.step` 调项目步骤 → 结果回脚本控制流 → gate → delegations 留痕 → 汇总退出码。

## 系统改动清单

- 引擎（templates/）：复活 `scripts/wf-run.mjs`（+ steps 加载与 `wf.step`）与 `scripts/wf-run.test.mjs`（+ steps 用例）；复活 `workflows/providers.json`；重写 `_TEMPLATE.md`；恢复示例 .mjs；删 `commands/orchestrate.md`；AGENTS.md / build.md 引用行改写。
- 测试：wf-run.test.mjs 回归 34 例 + 新增 steps 加载 / 调用 / 抛错路径；init.test.mjs ⑥ 再改。
- 不动：src/init·sync·doctor；宿主适配层；.githooks（预算门照常）。收尾 sync。

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 规则 / 契约变更 → L2 | 本 spec 即契约（运行时唯一形态 + steps 扩展点 + orchestrate 废止） |
| 零运行时依赖 | 运行时与脚本仅 node 内置；CLI 是环境既有工具 |
| 规则面预算 | orchestrate.md 删除（-3.4KB）> 引用行改写增量，净减 |
| 子智能体不跨确认门 / 不自行提交 | 派单红线行 + 角色契约照旧；脚本随 plan 确认 |
| 引擎双源纪律 | 全改 templates/ 后 sync |

## 风险评估

- 与 orchestrate-in-session 单日两次形态反转，文档 / 引用残留风险 ｜ 应对：grep 全仓扫描旧口径（orchestrate / provider spawn 语义混写）+ 装户面负向断言
- steps 是全权代码、扩展面扩大 ｜ 应对：信任边界成文（同脚本：随 plan 确认、不跑来路不明件）
- 复活件与两次形态间文档漂移 ｜ 应对：以 6d6e239 为基线复核 diff，仅叠加 steps 扩展

## 确认与复核

- 确认结果：（待确认）
- 确认通过后起草 ../plans/2026-09-25-wf-runtime.md
