---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 同名 intent：../intents/2026-09-29-adopter-surface.md
确认指纹: 19c2a346186e6ea7
---
# SPEC — 装户表面收口

对应入口：../intents/2026-09-29-adopter-surface.md

## 功能行为

- `init` 写入的 kit.json 带 `policyVersion: 1` 与 `audit: false`。
- check-loop 读 kit.json。`audit === false` 时 `warnings.push` 改为空操作，`blockers` 照常。字段缺省或为 true 时警告照常。
- 检查 12、14、15 的日期阈值改读 `policy.mjs` 的版本 1 表，数值与改前代码一致。未知 `policyVersion` 回退版本 1。
- 检查 17 取 `git log` 里最新一次 `package.json` 的 `version` 与父提交不同的提交，列出当时 `workflow/{intents,specs,plans}` 中状态为 draft 的文件；工作区该路径仍是 draft 则阻断。其后新建的文件不在该次树里，不拦。incident 的 open 不参与。
- `HOSTS` 在原四家之后追加 claude、cursor、codex，都带 `commandPrefix: wf-`，`localOnly: false`。菜单序号 1 至 4 不变。
- Codex 额外带 `skills/flow-kit/SKILL.md`。README 写明加载差异：Claude 加载 commands 与 agents，Cursor 加载 commands，Codex 加载 AGENTS.md 与该技能。
- 三个门禁只读 `git diff --cached`。`generated-readonly` 在 `FLOW_KIT_ALLOW_GENERATED=1` 时直接退出 0。

## 数据流

`kit.json` 的 audit / policyVersion → `loadKitPolicy` → check-loop。权威源 `templates/_agents/{commands,roles}` 正文 → `sync-hosts --apply` → `modules/hosts/<宿主>/` → `init` / `add-host` 渲染进 `.<宿主>/`。

## 系统改动清单

- 后端：`src/profiles.mjs`、`src/init.mjs`、`src/cli.mjs`、`src/doctor.mjs`、`templates/_agents/scripts/check-loop.mjs`、`policy.mjs`、`gate-checklist.mjs`
- 数据库：无
- 前端：无
- 文档：README、CHANGELOG、templates/workflow/README.md、本仓 workflow/README.md、归档、三份闭环文档

## 约束遵守映射

| 红线 | 本 spec 如何满足 |
|------|------------------|
| 规则 / 契约（check-loop 阻断面、宿主注册表） | 阻断面收成 audit 开关加检查 17；阈值单源 policy.mjs；宿主只追加不改原四家序号 |
| 双源 | 引擎脚本只改 templates/，装副本靠 sync；薄适配靠 sync-hosts |
| schema | 不涉及 |

## 风险评估

- 旧装户 kit.json 没有 audit 字段，若把缺省当成 false，升级后警告会消失。应对：缺省保持全量，只有 init 新装写 false。夹具无 kit.json 的既有测试因此不变。
- 检查 17 不把提交说明映射到主题文档。应对：在检查文案和 README 写明覆盖面。
- fresh init 依赖 doctor 退出码。应对：测试用空 git 仓库并挂上钩子，失败时打印 doctor 尾部。

## 确认与复核

- 独立复核：L2，不强制另开会话
- 用户确认前三件套保持 draft（起草期口径——2026-09-29 逐件确认后已 approved）
- 确认结果：approved（2026-09-29，台账 ts 2026-09-29T01:00:27Z，source=chat-delegated，原话「spec已审完」，batch c7daf7）；done（待关单，随入口文档置终态）
- 独立复核（2026-09-30 关单前补做，independent-reviewer「衡之」，独立上下文，只读）：**0 P0 / 0 P1 / P2×4**——8 项验收标准逐条复核成立（README / CHANGELOG / 归档 / audit 三场景 / 检查 17 / 实仓断言 / fresh init / 三门禁），6 组反向注入验证测试承重（audit 吞警告 / 检查 17 范围 / node-layer 暂存语义 / sync-hosts 实仓 / init audit / 检查 17 approved 分支）；实施提交 2c83677（107 文件）
- P2 处置：P2-1 勾验证据按实际结构写实（「硬规则开头」=规则先行）；P2-2 spec 清单未列同期落地的 modules/hosts/{claude,cursor,codex}、modules/gates/* 与 src/*.test——功能由「功能行为」段覆盖，终态不追溯改写、此处登记；P2-3 policyVersion 历史值（1→2，由 2026-09-30-stage-gate-machine 升级）不追溯；P2-4 README 增量列表已补检查 18/19 与逐阶段门
