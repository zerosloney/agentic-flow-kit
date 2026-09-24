---
状态: approved
级别: L2
模块: pipeline
---

# SPEC — 脚本化子智能体编排（workflow 脚本 + runner）

对应入口：../intents/2026-09-25-subagent-orchestration.md

## 功能行为

### ① workflow 脚本（编排面）

脚本 = JS ESM `.mjs`，放在 `.agents/workflows/`（建议，不强制路径），default 导出一个编排定义：

```js
// .agents/workflows/并行修两域.mjs
export default {
  name: '并行修两域',
  description: '后端+前端并行实现 → 汇聚过测试 → 独立评审',
  provider: 'zcode',     // 默认 provider，单 agent 可覆写
  concurrency: 2,        // 同时在跑的子智能体上限
  async run(wf) {
    const [be, fe] = await wf.parallel([
      () => wf.agent('implementer', '实现 X', { files: ['src/api/**'], accept: 'npm test 过' }),
      () => wf.agent('implementer', '改 Y', { files: ['web/**'], accept: 'npm run build 过' }),
    ]);
    wf.gate('npm test');                       // 非零 → throw，可 try/catch 自行降级
    const rv = await wf.agent('independent-reviewer', '评审两域改动', { context: ['workflow/plans/x.md'] });
    return { be, fe, rv };                     // 结构化结果，runner 汇总打印
  },
};
```

编排面 API（runner 注入的 `wf` 对象，契约如下）：

| API | 语义 |
|-----|------|
| `wf.agent(role, task, opts)` | 派单一个子智能体。`role` 必须是 `.agents/roles/` 下存在的角色；`opts`: `files`(授权文件清单) / `accept`(验收判据) / `context`(必读材料) / `provider` / `timeoutMs`(默认 600000) / `retries`(默认 0，重试=全新会话重跑)。返回 `Promise<{ok, exitCode, output, durationMs, provider, retriesUsed}>`——失败**不 throw**，由脚本决定后续 |
| `wf.gate(cmd, opts)` | 阶段门禁：spawnSync 跑项目命令（shell 口径，跨平台），非零 throw `GateError`；`opts`: `cwd` / `timeoutMs` / `quiet` |
| `wf.parallel(tasks)` | 并行 fan-out：任务函数数组，在 `concurrency` 上限内调度，全完成才 resolve |
| `wf.log(msg)` | 进度输出到 runner stderr |
| `wf.provider` / `wf.concurrency` | 顶层定义透传，脚本内可读 |

信任边界（明示）：workflow 脚本是全权 node 代码，**无沙箱**——安全性来自「脚本随 plan 草稿一起过目确认」；禁止执行来路不明的 workflow 脚本（写入 _TEMPLATE.md 与 AGENTS.md 引导行）。

### ② runner（`.agents/scripts/wf-run.mjs`）

```
node .agents/scripts/wf-run.mjs <script.mjs> [--provider <名>] [--concurrency N]
                                           [--timeout-ms N] [--dry-run] [--quiet] [--no-ledger]
```

执行流程：import 脚本 → 校验 default 导出形态（`name` + `async run`，API 面存在性、role 合法性在派单时校验）→ 构造 `wf` → 执行 `run()`（子进程输出带 `[role#序号]` 前缀流式转发，`--quiet` 抑制）→ 汇总表（每个 agent 的 ok / 耗时 / 重试 + gate 结果）→ 退出码（全过 0，任一 agent `ok:false` 或未捕获异常 1）→ 追加 `workflow/delegations.md` 委派结果表（`--no-ledger` 跳过；行格式与既有表格列完全一致，agg-delegations.cjs 可直接聚合）。`--dry-run` 仅加载校验不执行（控制流动态，无法静态穷举派单——诚实口径）。

子智能体 prompt 组装（每个 spawn）：角色契约全文（`.agents/roles/<role>.md`）+ 派单头（目标 / 授权文件 / 必读材料 / 验收判据）+ 红线行（只改授权文件；**禁 git commit / push / reset**；缺输入或需偏离 → 返回 `BLOCKER:` 不扩大范围）+ 输出行（末尾 `## 结果` 节：改动文件 / 摘要 / 验证 / 风险）。子智能体不跨用户确认门（角色契约原文已含）。

### ③ provider 注册表（`.agents/workflows/providers.json`，项目可覆写）

```json
{
  "zcode":    { "cmd": ["zcode", "exec", "{PROMPT}"] },
  "claude":   { "cmd": ["claude", "-p", "{PROMPT}"] },
  "opencode": { "cmd": ["opencode", "run", "{PROMPT}"] }
}
```

- **argv 数组形式为标准**（不经 shell，规避 Windows 引号转义）；兼容字符串形式（shell:true）。`{PROMPT}` 替换为完整 prompt。项目文件存在则与内置默认 deep-merge。
- 真实语法以冒烟校准为准（验收第 4 条），模板注释写明「装好后先冒烟再投产」。
- trae / omp 无 headless CLI：不进注册表，`_TEMPLATE.md` 明示「不承担 provider；装有任一 provider CLI 即可跑 runner」。
- provider 不在 PATH：runner 启动派单时明确报错（含 provider 名与覆写方法），不算 crash。

### ④ 与既有闭环的衔接

- workflow 脚本文件是 plan「任务拆解」的执行器：**随 plan 草稿一起全文过目、一起确认**（build.md 补一行指引），确认前只可 `--dry-run`。
- runner 与子智能体均不 commit / 不 push（prompt 红线行 + 角色契约双保险）；提交由主智能体复核后执行。
- 阶段路由不动：编排发生在 Build/Maintain 确认后的执行环节，不新增阶段。

## 数据流

plan（已确认）→ workflow 脚本（.mjs）→ `wf-run.mjs` 解析校验 → `wf.agent()` 派单 → providers.json 解析 spawn 命令 → 宿主 CLI 无头会话（prompt = 角色契约 + 派单头）→ stdout / exit code → `{ok, output, ...}` 汇聚回脚本 → 脚本控制流（parallel / gate / 重试）→ 返回结构化结果 → runner 汇总表（stdout）+ 委派结果表追加（`workflow/delegations.md`，与 agg-delegations.cjs 列格式对齐）。

## 系统改动清单

- 引擎（`templates/`，包源）：
  - 新增 `templates/_agents/scripts/wf-run.mjs`——runner（零依赖，node 内置模块 only）
  - 新增 `templates/_agents/scripts/wf-run.test.mjs`——fake provider 全链路用例（run-tests.mjs 按目录 glob 自动收录）
  - 新增 `templates/_agents/workflows/`：`_TEMPLATE.md`（API 契约 + 编排面参考 + 信任边界）＋ `示例-并行实现评审.mjs`（可执行示例）＋ `providers.json`（内置默认，项目可覆写）
  - `templates/AGENTS.md`：AI 工作流节加一行编排能力引导（≤150B，预算 7680B 现用 5308B）
  - `templates/_agents/commands/build.md`：「子代理调用约定」节加一行——多工作包编排用 runner，脚本随 plan 确认（预算内增量）
- 不动：`src/init.mjs`（renderTree 整树拷贝自动含新目录）、`src/doctor.mjs`（新增面不进必检清单，避免旧装户 sync 前误报）、宿主适配层四家（headless spawn 不经宿主 agent 注册，角色契约直拼 prompt）、`.githooks`（预算门照常覆盖 build.md / AGENTS.md 增量）
- 装户同步：改完跑 `node bin/flow-kit.mjs sync`（new 文件按三态 new 落台账）

## 约束遵守映射（对照 AGENTS.md 触达红线）

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 规则 / 契约变更 → L2（入口文档红线已勾） | 本 spec 即契约面：workflow API / runner 语义 / provider 注册表 / prompt 组装口径全部成文，确认后起草 plan |
| 引擎双源纪律（改 templates/ 后 sync） | 改动清单全部落在 templates/，收尾 `node bin/flow-kit.mjs sync` 更新 .agents/，不直改装副本 |
| 零运行时依赖 | runner 与脚本仅 node 内置模块；宿主 CLI 是环境既有工具非 npm 依赖；不引 TS / 沙箱依赖 |
| 规则面预算（只增不减须一进一出） | 新增不占 commands 目录（不新增命令文件）；AGENTS.md +≤150B、build.md +≤250B，均在余量内；pre-commit 预算门机器校验 |
| 子智能体不跨确认门 / 不替用户批准 / 不自行提交 | prompt 红线行 + 角色契约双保险；runner 自身不 commit/push；脚本须随 plan 确认后方可执行 |
| 测试不放提交门，关单在 test | runner 用例进 npm test（fake provider，不依赖真实 CLI/登录态）；真实冒烟在 test 阶段做 |

## 风险评估

- 宿主 CLI 语法/可用性差异（认证、版本）｜ 应对：argv 模板项目可覆写 + 冒烟校准 zcode 一家 + provider 不在 PATH 的明确报错；测试全用 fake provider
- workflow 脚本无沙箱（全权 node 代码）｜ 应对：信任边界成文（脚本随 plan 确认；不跑来路不明脚本）；AGENTS.md 引导行明示
- 并发放大返工（多子智能体同时写盘冲突）｜ 应对：concurrency 默认 2；delegations.md 量化一次完成率，扩并发受「并发扩容门槛」约束（既有口径复用）
- Windows spawn 差异（引号 / 信号）｜ 应对：argv 数组不走 shell；gate 才用 shell:true；用例在本机 Windows 实跑
- 留痕格式漂移导致聚合脚本解析失败 ｜ 应对：runner 追加行与既有表格列逐一对照，wf-run.test.mjs 断言行格式

## 确认与复核

- 确认结果：approved（2026-09-25 用户对话内确认 spec 契约——API 面 / provider 注册表 / 信任边界 / 衔接方式逐项过目无异议）
- 确认通过后，方可执行 ../plans/2026-09-25-subagent-orchestration.md（plan 草稿已随入口文档同提，状态 draft，spec 确认后再过 plan 确认门）
