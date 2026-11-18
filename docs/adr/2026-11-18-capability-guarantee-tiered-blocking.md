---
状态: accepted
日期: 2026-11-18
主题: capability-guarantee-tiered-blocking
---
# ADR — 关键约束无法满足时的阻断语义：按「显式高档承诺」分级阻断，常规档保持 advisory
<!-- 本仓自用 ADR，按 templates/scaffold/workflow/adr/_TEMPLATE.md 形状记录；对应 BACKLOG #35（来源④）的设计决策 -->

## 背景
BACKLOG #35（2026-11-18，来源④ Nexum SDLC Workflow 对照）：文章要求「执行环境无法兑现关键约束时，应阻断执行或调整路径」。本仓现状：`doctor` 对能力缺口（宿主无 hooks / 无 modelField，相关保证只能 advisory）一律 warn 不 fail（`src/commands/doctor.mjs` guaranteeGap，L152-153、L283-285）；唯一例外是 enterprise 档证明链 / 策略缺失已按 fail 处理（L376-385）。结果：`--tier enterprise`（hardened 档）装在 `hardening: none` 宿主上静默降级——声称的保证没有兑现，且不吭声。不决定的代价：阻断语义漂在「文章要求」与「现状 advisory」之间，enterprise 档的承诺面没有机器背书。

## 决策
**进，但窄化为三级口径**（阻断只作用于「用户显式选择的高档承诺无法兑现」，常规档不动）：

| 级 | 触发 | 行为 |
|---|---|---|
| **阻断（安装期）** | `--tier enterprise`（含 `--hardened`）且目标宿主 registry `hardening.level: none`（无 settings / hooks 兜底可执法 hardened 接线） | 该宿主**拒装**（exit 非零，提示换宿主或降档）；多宿主时其余照装并逐个列明被拒者与原因 |
| **阻断（体检期）** | manifest 记录 tier=enterprise 的装户，宿主 hardened 接线缺失 / 漂移 | `doctor` fail（现状 gaps warn 升格，与既有证明链缺失 fail 口径合并） |
| **调整路径** | 宿主无子代理 / 无前置拦截（如 L2/L3 独立复核、写前门） | 既有口径成文：无子代理宿主「另开新会话」复核；引擎门（verify / check-loop / git hooks）在关单路径执法，不依赖宿主前置拦截——不新增机制 |
| **advisory（不变）** | lean / standard 常规档宿主无 hooks / modelField / permissions | `doctor` warn（现状保留） |

纪律：分级判定单源挂 `src/hosts/registry.mjs` 能力字段（`hardening.level` / `permissions` / `hooks`），**禁按宿主名分支**；本 ADR 属安装器面决策，不新增装户门禁机制（不涉 mechanism-registry 登记）。

## 备选与取舍
| 方案 | 关键取舍 | 风险 | 为什么没选 |
|---|---|---|---|
| 不进（维持全 advisory） | 零改动 | enterprise 档静默降级持续——与本仓「不静默」纪律冲突（cf. doctor 头注「不能 advisory 的保证要显式」既定方向） | 显式高档承诺缺兑现却不吭声，是现状缺陷不是特性 |
| 全面阻断（任何能力缺口即 fail） | 字面满足文章 | opencode / pi / cline（`hardening: none`）常规档 doctor 全红、不可用；且引擎门在关单路径执法，宿主前置拦截只是加强层——阻断名不副实 | 把「加强层缺失」升格为「不可用」代价错配 |
| 窄化分级（选定） | 只阻断「显式承诺未兑现」；常规档零影响 | enterprise 档在部分宿主不可装，需输出支持矩阵；实现含 install / doctor 两处判定 + 测试 | — |

## 后果
- 正面：enterprise 档的承诺面获得机器背书（装不上 = 明确拒，装上 = doctor 持续对账）；「静默降级」变「显式选择」；与既有 enterprise 证明链 fail 语义拼成完整口径。
- 负面 / 代价：`hardening: none` 宿主（现状：opencode / pi / cline）不能以 enterprise 档安装——须在 install 输出与 README 宿主矩阵写明；实现不默认开工，立 BACKLOG #38 跟踪（install 拒装判定 + doctor 分级 + 测试 + en 文案）。**实现回执（2026-11-18，#38 DONE）**：实现细化为「单宿主全拒 exit 2 不落盘；混合照装其余 + warn 列明；doctor 的 none 级 fail 与 gaps(hooks) advisory 阈值统一为 none」；upgrade 复用安装管线自动覆盖；新增 `tests/install-tier.test.mjs` / `tests/enterprise.test.mjs` 4 用例（含 registry 单源破坏性测试），全量 627 pass / 0 fail。
- 术语影响：无新增术语（tier / hardening / guaranteeGap 均为既有词）。

## 依据
- 授权链：用户指令「按顺序执行 backlog 登记项」（2026-11-18）覆盖 #35 验收「先产出 ADR：进/不进 + 分级口径」；本 ADR 的「进·窄化」为主 Agent 分析结论，owner 若异议可按 superseded 链重开。
- registry 现状（`src/hosts/registry.mjs`）：hardening 分布 = claude: managed；qwen / commandcode / qoder: permissions；trae / codebuddy / codex / codeartsdoer / zcode: hooks；opencode / pi / cline: none。
- doctor 现状：guaranteeGap warn（L152-153、L283-285）；enterprise 证明链 / 策略缺失 fail（L376-385）——「显式高档承诺缺兑现 = fail」已有先例，本 ADR 是其推广而非新语义。
- 调整路径级先例：`workflow/README.md` L57「宿主不支持子智能体时另开新会话」。
- ADR 形状先例：`docs/adr/2026-11-17-release-control-out-of-scope.md`（#31）。
