# 行为评测（agent-eval）

静态门回答“脚本是否还能跑”；行为评测回答“智能体的行为是否还一样”。

适用改动面（`.agents/config/agent-eval.json` 的 `sensitive`）：

- `.agents/skills/**`、`.agents/commands/**`、`.agents/roles/**`
- 模型角色 / 严格度 / pipeline 配置

## 跑一次

1. 按 `.agents/skills/eval/SKILL.md` 准备任务集：5–10 条，有已知判据，正负例都有。
2. 用新子代理跑两臂（A=新配置，B=旧配置），同模型、同上下文、盲评。
3. 用 `eval-score.mjs` 算通过率，然后落凭证：

```bash
node .agents/scripts/agent-eval.mjs record --pass-rate 0.9 --tasks 8 --model opus --note "skill x v2"
```

4. 门禁检查：

```bash
node .agents/scripts/agent-eval.mjs check            # 严格：无凭证/过期/不达标 → 非零
node .agents/scripts/agent-eval.mjs check --advisory # 试点：只告警
```

## 新装为什么严格 check 会失败

新装项目没有任何评测凭证，`check` 报 `no-eval-for-tree` 是**门在工作**，不是安装坏了。
此时只有两条路：

1. 按上面的流程真跑一次评测并 `record`（推荐）；
2. 试点期在 CI 里用 `--advisory`，严格 check 留到改敏感面时再跑。

`record` 拒绝不可追溯的凭证：`--pass-rate` 必须是 0..1 的显式值，`--tasks` 不少于
`minTasks`（默认 5），`--model` 不能为空。不要把 `record --pass-rate 1` 当“免测开关”。

## 判据

- 凭证绑定的是**评测敏感面的内容签名**，不是提交号：只改业务代码不会让凭证失效。
- 凭证默认 30 天过期；模型升级、技能重写、命令改步骤都应重跑。
- `results.jsonl` 是 append-only 台账；多机/多分支用 jsonl-union 合并。
- 通过率写“A 臂命中率”；Δ 与翻转任务留在评测报告里，不进凭证。
- `results.jsonl` 属于运行态：不随安装器模板出厂（`listFiles` 已排除），否则新项目会继承一张假凭证。

## 放进 CI

`templates/git/azure-pipelines.yml` 与 `templates/git/.github/workflows/ci.yml`
在 `verify --full` 之后调用 `check --advisory`。稳定后去掉 `--advisory`。
