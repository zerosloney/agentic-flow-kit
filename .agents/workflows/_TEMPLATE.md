# Workflow 编排 — 脚本化子智能体 runner 使用契约

> 用 `node .agents/scripts/wf-run.mjs <脚本>.mjs` 把多个子智能体派单编成确定性脚本：串行 / 并行 fan-out（`wf.parallel`）、阶段门禁（`wf.gate`）、失败重试（`retries`），执行留痕自动追加 `workflow/delegations.md`。子智能体 = 宿主 CLI 无头会话，prompt 由 `.agents/roles/<role>.md` 角色契约组装。

## 纪律（先读）

- **脚本随 plan 确认后方可执行**：workflow 脚本是 plan 任务拆解的执行器，随 plan 草稿一并全文过目；确认前只可 `--dry-run`。
- **无沙箱**：脚本是全权 node 代码——不执行来路不明的 workflow 脚本；只写自己项目里、可 git 追溯的脚本。
- runner 与子智能体均不 commit / push；提交由主智能体复核后执行。
- trae / omp 无 headless CLI，不承担 provider；装有任一 provider CLI 即可跑 runner。

## 脚本格式

`.agents/workflows/<主题>.mjs`，default 导出：

```js
export default {
  name: '并行修两域',
  description: '一句话说明（进汇总与台账）',
  provider: 'zcode',   // 默认 provider，单 agent 可覆写
  concurrency: 2,      // 同时在跑的子智能体上限
  async run(wf) {
    const [be, fe] = await wf.parallel([
      () => wf.agent('implementer', '实现 X', { files: ['src/api/**'], accept: 'npm test 过' }),
      () => wf.agent('implementer', '改 Y', { files: ['web/**'], accept: 'npm run build 过' }),
    ]);
    wf.gate('npm test'); // 非零 throw GateError，可 try/catch 自行降级
    return { be, fe };
  },
};
```

### 编排面 API

| API | 语义 |
|-----|------|
| `wf.agent(role, task, opts)` | 派单一个子智能体。`role` 必须是 `.agents/roles/` 下存在的角色。返回 `Promise<{ok, exitCode, output, durationMs, provider, retriesUsed, blocker}>`——失败**不 throw**，脚本自决后续 |
| `wf.gate(cmd, opts)` | 阶段门禁：跑 shell 命令，非零 throw；`opts`: `cwd` / `timeoutMs` / `quiet` |
| `wf.parallel(tasks)` | fan-out：任务函数数组（`() => wf.agent(...)`），受 `concurrency` 上限调度 |
| `wf.log(msg)` | 进度输出（stderr） |

`wf.agent` 的 `opts`：`files`（授权文件清单，写进派单红线）/ `accept`（验收判据）/ `context`（必读材料路径）/ `provider` / `timeoutMs`（默认 600000）/ `retries`（默认 0，重试 = 全新会话）。
子智能体输出含「BLOCKER:」时结果标记 `blocker: true`（角色按契约停下待主智能体处置，不扩大范围）。

## runner 命令

```
node .agents/scripts/wf-run.mjs <脚本.mjs> [--provider <名>] [--concurrency N] [--timeout-ms N] [--dry-run] [--quiet] [--no-ledger]
```

- 退出码：全过 0；任一 agent 失败或脚本异常 1。
- `--dry-run`：只加载校验脚本（default 导出形态、role 合法性），不执行——控制流是动态的，静态审不出派单全集，确认门靠人。
- `--no-ledger`：跳过 delegations.md 留痕（默认追加委派结果表行，列格式与既有台账一致，`agg-delegations.cjs` 可直接聚合）。

## provider（子智能体 = 哪家宿主 CLI 无头会话）

`.agents/workflows/providers.json`（项目可覆写，与本表 deep-merge；`cmd` 用 argv 数组为标准，不走 shell）：

```json
{
  "zcode":    { "cmd": ["zcode", "exec", "{PROMPT}"] },
  "claude":   { "cmd": ["claude", "-p", "{PROMPT}"] },
  "opencode": { "cmd": ["opencode", "run", "{PROMPT}"] },
  "codex":    { "cmd": ["codex", "exec", "{PROMPT}"] }
}
```

- `{PROMPT}` 替换为完整派单 prompt（角色契约 + 目标 / 授权文件 / 验收判据 + 红线行）。
- **装好后先冒烟再投产**：各 CLI 无头语法/登录态随版本变化，先跑一条最小 workflow（单 agent 单 gate）校准，命令模板按实际输出覆写；**冒烟/校准跑加 `--no-ledger`**，不污染量化台账。
- provider 不在 PATH：派单明确报错（含覆写提示），不算 crash。
