---
状态: draft
级别: L2
日期: 2026-09-28
模块: pipeline
备注: pre-commit 补 managed 台账快检——根治 kit.json sha 预 landing 三连发的提交时刻盲区
---
# INTENT — ledger-precommit-gate

## 背景与问题

需求来源：2026-09-28 code-review 双轴审查（537df18 opencode wf- 前缀改造）Spec 轴发现，用户对话内拍板根治（「台账预 Landing 若想根治，可考虑把 pre-commit 加一条 doctor 台账快检」）。

「kit.json 台账 sha 预 landing」——台账记录了盘面尚不存在的内容 sha——已三次真实发生，且都随常规提交静默落 main：

1. 37b3c05：`.agents/commands/sync-hosts.md` 新口径 sha（67233036…）入台账，此后盘面回退为旧内容（cf1035d 实测为 49c730ca…），直到 537df18 才闭合——窗口内 main 上台账↔盘面不一致
2. ff3c721：doctor.test 装副本内容回退（还原误带入的 rename 预期），kit.json 未随动，同类窗口
3. 593c074：`profiles.mjs#HOSTS.commandPrefix` 预入库，19 个提交后 537df18 才兑现实现

现有门禁各查一边，交集处无人管：

- 双源一致性门禁（source-sync-check --gate）：查 templates↔.agents 正文——**两侧成对回退时静默**（第 2 例即如此通过）
- doctor §4：查 kit.json↔盘面——但只在手动全量跑时（modified=WARN），pre-commit 门禁序不含 doctor

危害：窗口内 doctor 报 WARN、spec 断言的改动面与 commit 边界对不上账（审计失真）；第 1 例实测 HEAD~1 盘面 LF sha ≠ 台账。

## 目标

- pre-commit 增量快检：包源环境且暂存触及 `.agents/` 或 `templates/_agents/` 时，校验 kit.json managed 台账 sha ↔ 盘面（工作树、LF 归一），漂移/缺失即阻断，提示 `node bin/flow-kit.mjs sync` 成对后原路重试
- 检查器为 managed 自包含脚本（装户随包带走），测试套件随 `templates/_agents/scripts/*.test.mjs` 被 npm test 自动发现

## 非目标

- 不改 doctor §4 语义：装户 managed 手改仍 WARN 不硬拦（装户合法手改 managed 是既有口径，硬拦会破坏升级合并流）
- 不在装户环境启用本硬门禁（包源环境限定，与双源门禁同边界）
- 不处理 managed 删除的自动清理（sync 对 removed 只报不删的既有边界不变）

## 约束

- sha 口径单源纪律：LF 归一 utf8，与 doctor §4 / render.mjs shaText 同口径；装户自包含约束（.agents/scripts 不能 import src/）决定了第三份物理实现，头注释交叉引用三处——沿 source-sync-check 同款先例
- 门禁序位置：双源一致性之后、local-pre-commit 之前；触发条件与双源门禁同款 grep
- 比较工作树而非暂存区（沿双源门禁口径）：分两笔提交但最终一致时不拦

## 影响面

- 模块：pipeline
- 数据库：无

## 触达红线

- [x] 规则 / 契约变更（commit 门禁序新增一道增量硬拦）→ 级别至少 L2

## 验收标准（可测试）

- [ ] `check-ledger.mjs`：全对齐 exit 0；内容漂移 / 缺失 exit 1 且逐份列出 rel
- [ ] CRLF 盘面 × LF 台账不误报（LF 归一口径）
- [ ] 无 kit.json → skip exit 0（非 flow-kit 安装兼容）；kit.json 解析失败 → exit 1
- [ ] pre-commit 负例实测：临时弄脏 managed 件（仅工作树）→ commit 被拦且提示 sync；还原后放行
- [ ] `npm test` 全部套件通过；`flow-kit sync` 后 doctor 12 PASS / 0 WARN / 0 FAIL

> **闭环对账**：关单在 test 阶段（不依赖 deploy）。intent 置 done 前逐条勾验，每条勾选项后补证据——`- [x] <判据>（证据：<commit SHA / 测试用例名 / 冒烟脚本输出>）`。
> done 状态仍有未勾项会被 check-loop 拦截（2026-09-12 起新建 intent 为 hard-block，存量 intent 仅 warning 提示）；勾选但缺「证据：」为 warning。

## 确认与复核

- 确认日期：
- 确认人：用户（对话内确认后经 confirm-doc 留痕）
- 确认范围：
- 复核：L2 推荐独立复核
