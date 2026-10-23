# papercut-debt 控制回路 — 设计（2026-10-07 拍板；B10a 自 Shipyard.Material 回灌）

> 本文件是回路的**设计单一真相源**。传感器 / 控制器 / 执行器技能 / 记忆文件均按此实现，改设计先改本文件。
> 范围：把 `workflow/papercuts.md` 的未升级存量债驱动到 0。执行器为**对话内手动触发**（kit 不为回路接线 CI/定时）。

## 1. 设定点（Set point）

**`workflow/papercuts.md` 中未消债条目数 → 0。**

- **判定口径（单源，本文件）**：
  - **已消债（settled）** = 该行含 `✅`（真修完）**或** 含 `⏸ 暂缓（日期）：理由`（人读过、判失效）。
  - **未消债（debt）** = 其余，即 `debt = 总数 − settled`。
  - `⏸ 暂缓` **无理由者仍计债** —— 堵"标个符号清零"的路，迫使人真读一遍。
  - **环境约束类（`[env]` 前缀）**：「位置」列以 `[env]` 开头（外层可带反引号包裹，传感器兼容）的行**不进债池**（`scan()` 不返回，控制器 import 债池数组天然不选），单列 `envPending`（仅未 settled 的）。清账两路径：环境前提复测消失 → `⏸ 暂缓（日期）：前提已消失`；定性实为代码缺陷 → 去前缀转正回债池。理由：环境自愈不该由回路轮询发现（源仓首轮实证：pypi 恢复后自愈的环境条目，却占 debt 名额等人工定性一轮——留痕在包源仓 git 历史与 CHANGELOG）。
  - 两类分开计数（`resolved` / `deferredReasoned`），避免"暂缓"冒充"修完"。
- 终态：全部条目 settled。**"暂缓"是合法终态，但必须有人写理由。**
- 基线：装户首次跑传感器时的 `debt` 读数即基线，随后每轮 `debt` 恰好 -1。装户侧不预填数字。

> **首轮修正（设计教训，单源保留）**：初版口径只有 `✅` 判债、`⏸` 不消债。后果是执行器走"判失效"分支（写 `⏸`）后 `debt` 不减，完成判据"debt 恰好 -1"永远达不到，且控制器下一轮仍选中同一条 → **回路空转**。现口径按上表，`settled` 由传感器单源判定、控制器 import 复用（两处各判一次必然漂移，见 §3 末）。

为什么选它（三条依据）：

1. **计数客观**：`papercuts.md` 是人写的自由文本表格，但"是否已升级"是二值事实，解析成本低、复跑稳定。
2. **改动面天然是文档**：每条 papercut 的"拟修"列指向的多是 `.agents/commands/`、`.agents/skills/`、`.githooks/` 下的提示文本与脚本 —— 与回路执行器边界（文档面）**天然对齐**，不需人为收窄。
3. **不撞人工门**：`papercuts.md` 是普通台账，**不走 `confirm-doc` 状态机**（不同于 intent/spec/plan），所以回路可以无人值守跑而不会卡在人工确认点。

不选的候选与理由属**装户实测数据**（源仓实例：回归清单未勾项、常驻面体积瘦身、check-loop 存量 warning——留痕在包源仓 git 历史与 CHANGELOG）。装户立回路时按同原则自评：单轮以小时计的、改 AI 行为指令的、性价比最低的候选不进本回路。

## 2. 传感器（Sensor）

**脚本**：`.agents/scripts/papercut-debt-sensor.mjs`
**输出**：`--json` 时给结构化 JSON；默认给人读的中文摘要。退出码恒 0（**测量失败不该阻断回路**，但会显式打印 ERROR 行）。

测量口径：

| 字段 | 含义 |
|---|---|
| `unresolved` | 未升级条目数组，每项含 `line` / `date` / `location` / `symptom` / `proposedFix` / `hits`（scope 由控制器 §3 判定，不在此列） |
| `resolved` | 已升级条目数 |
| `total` | 台账数据行总数（排除表头与分隔行） |
| `debt` | `unresolved.length` —— 设定点的当前误差 |

关键设计约束：

- **零子进程**。不 spawn git / node。理由（源仓实测，留痕在包源仓 git 历史与 CHANGELOG）：曾有托管 Node 环境 `spawnSync` 对**任意**可执行文件（含 node 自身）返回 `EBUSY`，任何依赖 git 历史的传感器在该环境不可用——已有 `check-loop.mjs` 就是这么崩的。零子进程设计保留：传感器不依赖子进程比依赖更稳，且免受环境回退影响。
- **CRLF 容忍**。台账检出为 CRLF（全局 `core.autocrlf=true`），按 `split(/\r?\n/)` 切行，**禁止依赖行尾格式**。
- **管道符安全**。单元格内可能含 `|`（代码片段），按"切分后多于 6 段则把中间段并回症状列"处理，取前 3 列 + 末列。
- **失效路径不阻塞**。对每条的"位置"列抽出形如 `.agents/…` / `wiki/…` 的路径并检查存在性；不存在只标 `stale: true`，不排除该条 —— 台账记的是历史事实，路径后来被重命名/删除是常态，不等于债已消。
- **分片感知**（kit 侧随 ledger-shards 落地）：读侧走 `readLedgerText(root,'papercuts')`（主台账 ∪ `workflow/papercuts.d/*.md`），无分片时等价原读法——传感器零额外逻辑，口径不变。

## 3. 控制器（Controller）

**脚本**：`.agents/scripts/papercut-debt-controller.mjs`
**输入**：`papercut-debt-sensor.mjs --json` 的输出（或自己调传感器）。
**输出**：本轮唯一目标（top-1），markdown 片段，直接拼进执行器提示词。

排序键（**确定性，无随机、无 LLM 判断**）：

1. **命中次数降序** —— 台账文件头自己的规则："同一文件命中第 2 次或用户点名时，升级为 docs 修复 commit"。`第 N 次命中` 从症状/拟修文本中正则抽取。
2. **日期降序** —— 同命中次数下，日期新的优先（近期痛点更可能仍成立）。
3. **原行序升序** —— 完全平手时按台账原始顺序，保证结果可复现。

**Scope gate（出选前过滤）**：`拟修` 明确指向 `backend/` `frontend/` `tests/` `wiki/` `sqlcmd` `db_tool`，或文本含 `数据库` / `DDL` / `DROP` 的条目，本轮跳过并列为 `skipped-out-of-scope`。记入输出，由用户决定是否授权。执行器只改文档面。指向业务代码或连库的条目超出授权。

**单轮只取 1 条。** L2/L3 要求独立复核，控制器不得一次给出 3 条。

**口径复用（硬约束）**：控制器**不得复制** `✅` / `⏸` / `hits` / `stale` 的任何判定正则，一律 `import { scan } from './papercut-debt-sensor.mjs'`。控制器只负责排序与 scope gate。理由（源仓首轮实证，留痕在包源仓 git 历史与 CHANGELOG）：两处各判一次必然漂移——初版传感器按 `✅` 判债、控制器也按 `✅` 选目标，导致已 `⏸` 的条目被反复选中。

## 4. 执行器（Actuator）

**技能**：`.agents/skills/papercut-fix/SKILL.md`（装副本随 `.agents/skills/` 分发）。
**触发**：你说"跑一轮 papercut 回路"。
**验证门**（改动后必跑，全部零 spawn 或纯本地）：

```bash
node .agents/scripts/check-loop.mjs          # 闭环骨架（实证留痕在包源仓 git 历史与 CHANGELOG）
node .agents/scripts/papercut-debt-sensor.mjs --json   # debt 应恰好 -1
```

> **注意**：`verify.mjs` 默认不在本回路跑 —— 回路只动台账与技能文件（文档面），`verify.mjs` 含构建/测试（源码面，按装户技术栈），与 papercut 回路边界无关，回路收尾以传感器计数核验为准。需要关单凭证时直跑 `node .agents/scripts/verify.mjs`（全绿自动落 verifications.jsonl）。

**金样（golden patterns）**，已固化进技能：

- 台账写入**一律用 Edit 工具**（源仓实证 papercut：`node -e` 批量 replace 遇 CRLF 静默无操作、假落账——留痕在包源仓 git 历史与 CHANGELOG）。
- 写后**必 grep 回读验证**再报成功。
- 标 ✅ 时**追加**升级记录（日期 + commit），不删原"拟修"文本 —— 原文本是复发时的对照物。
- 改动 `.agents/commands/` 后必看 `.agents/rule-budgets.txt` 的体积上限（常驻面只增不减，一进一出；机器门 `node .agents/scripts/rule-budget.mjs --staged`）。

## 5. 扰动与阻尼器（Disturbances / Dampener）

**扰动源**（通用形态）：

- 用户并发提交：回路运行期间，用户可能修改同一文件。
- 生成物漂移 —— `workflow/INDEX.md`、`workflow/metrics.md`、`gen-wiki-board` 产物会随任何状态变更而重生成。
- 工具链升级 —— kit bump 会重写 `.agents/` 装副本，台账里的"拟修"可能已失效。

**阻尼器（已存在，不另建）**：`.githooks/pre-commit` 门禁（常驻面体积预算 `rule-budget --staged` 硬拦等）+ `pre-push` 的 `check-loop` hard-block。**新条目带 `⏸ 暂缓` 而无理由**、或同一行被并发改写压行，都会在这两道门上现形。回路**不新增任何门禁** —— 现有门禁已足够挡住"回路把台账改坏"。

## 6. 人在环上（Human on the loop）

- **记忆文件**：装户自持（owned 面参考 `.agents/notes/`）——常驻反馈（永久范围排除、已知失效区、reviewer 意见）。每轮在控制器之后、提示词之前注入。**只写耐久规则，不写单轮日志**。
- **人工放行**：回路不自动 commit、不 push。产出 diff 后停止，等待用户明确放行。
- **`/iterate` 不实现**。追加范围或暂缓须由用户在对话中逐条给出，例如「修第 3 条」或「这条暂缓，理由 X」。

## 7. 流控（Flow control）

**在途判据**：工作区存在本回路产生的未提交 diff。手动触发时同一工作区只跑一轮，不另绑远端评审流。`--dry-run` 只输出目标清单，不改文件。

## 8. 历史阻塞与豁免（源仓实证，单源保留结论）

1. **回路脚本落 `.agents/scripts/` 是否命中 L2 触达面**：不命中——`check-lane-surface.mjs` 在无活跃 L2/L3 入口时只出 advisory、exit 0 放行（**规则**：无活跃入口即放行）。**结论：不必为回路另立 intent**；若日后 `.agents/scripts/` 确有 L2 语义改动被拦，再按 `new-task.md` 立入口。实测过程留痕在包源仓 git 历史与 CHANGELOG。
2. **依赖 git 历史的传感器在本机必崩**（EBUSY）：以零子进程设计规避（§2），不做环境假设。源仓后来环境升级后该崩溃消失，但零子进程约束不回退——传感器不依赖子进程比依赖更稳。
