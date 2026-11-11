---
name: csharp-quality-gates
description: C# 后端质量门——CRAP（复杂度×覆盖）、变异测试、重复代码三道确定性门的手动触发入口；内置本机 coverlet 采集失效的 TEMP 改道与「0 覆盖是采集故障还是真没测」的判别、报告解读判据、补测优先级排序；供「这改动有没有测试兜住 / 哪些方法该先补测试 / 复杂度或重复有没有超标 / 后端质量现状盘点」类问题使用。命令入口 .agents/skills/csharp-quality-gates/scripts/quality-gates.mjs。
---

# csharp-quality-gates — C# 后端质量门（手动触发）

后端代码与 ub-mode 的三阶段纪律对位（Uncle Bob 的 crapper/dryer/mutator 不支持 C#，本仓用等价物替代）：

| ub-mode 门 | Uncle Bob 原工具 | 本仓等价物 | 判据 |
|---|---|---|---|
| Crapper（Then Make it Right） | crapper | **dotnet-crap**（Crap4DotNet） | `CRAP = CC²×(1-cov)³+CC`，阈值默认 30 |
| Mutator（Then Make it Right） | mutator | **dotnet stryker**（Stryker.NET） | 变异得分（killed/total） |
| Dryer（Then Make it Right） | dryer | **PMD CPD**（`--language cs`） | 结构重复，token 数 |

下文 `qg` 代指 `node .agents/skills/csharp-quality-gates/scripts/quality-gates.mjs`。

## 触发 / 不触发

- **触发**：「后端质量现状 / 这改动有没有测试兜住 / 哪些方法该先补测试 / 复杂度有没有超标 / 有没有重复代码 / 变异测试怎么跑」；改动落在 `backend/` 且涉及业务逻辑；补完一批测试想验证"测试是不是真的在测"。
- **不触发**：纯前端改动（本仓 C# 门不覆盖 `frontend/`）；只想知道"能不能编译"（用 `commit-check.config.json` 的 build 段）；只想知道"跑不跑得过测试"（直接 `dotnet test`）。
- **不替代** `verify` 门禁：本技能是**手动触发**的诊断与盘点工具，不进提交门禁，不改任何门禁配置。

## 0. 前置探测

```bash
qg doctor
```

逐项打印工具是否就位：`dotnet` / `dotnet-crap` / `dotnet-stryker` / `pmd` / `java` / 单测工程 / 解决方案。缺装时脚本会打印安装命令：

```bash
dotnet tool install -g Crap4DotNet
dotnet tool install -g dotnet-stryker
# PMD：下载 pmd-dist-<ver>-bin.zip 解压到 ~/.agents/tools/pmd/（含 lib/ 与 conf/ 的那层）
```

机器上的实际路径登记在 `.agents/notes/runtime-env.local.md`（git-ignore，单源纪律）；脚本按 `环境变量 → 已知安装位 → PATH` 解析，不硬编码绝对路径。

## 1. 三道门

```bash
qg coverage                 # 跑单测收覆盖率（TEMP 改道内置）
qg crap [--threshold 30] [--top 15] [--min-crap N] [--coverage <绝对路径>]
qg dup [--minimum-tokens 100] [--top 10]
qg mutate "<glob>"          # 变异测试，必须定点
qg all                      # coverage → crap → dup（不含 mutate，太慢）
```

退出码：`0` 通过 / `1` 门未达标（有方法超阈值、有重复块、变异得分未达标）/ `2` 用法·配置·采集失败。**退出码 2 一律不是「通过」**，是"没跑起来"。

产物落在 `.agents/tmp/quality-gates/`（git-ignore）：覆盖率 XML、`crap-report.json`、Stryker 报告。

## 2. 采集失效陷阱（本机已知，必读）

**coverlet 在本机默认 TEMP 下会静默产出 0% 覆盖率。**

- 现象：测试全绿、代码确实调了生产服务，但 cobertura 里 `lines-covered=0`——每个类每行 hits 都是 0。
- 根因：coverlet 把插桩后的模块写到 `%TEMP%\<模块名>_<guid>` 再加载；该文件在默认 TEMP 下丢失，testhost 退出时抛**未处理** `FileNotFoundException`（进程 -532462766），命中数据没落进报告。
- 判据：测试明明 `new XxxService(...)` 调了生产代码，cobertura 却全 0。
- 修法：`qg coverage` 已把 `TEMP`/`TMP` 改道到 `.agents/tmp/quality-gates/tmp`；实测改道后 `lines-covered=23701/37805`（line-rate 0.6269）。
- **脚本守卫**：`coverage` 在 `lines-valid>0 && lines-covered==0` 时**报错退出 2**，不产出"零覆盖"结论；`crap` 拿到这种文件也会拒跑。

> 同机另两条死路：`--collect:"Code Coverage"`（Microsoft.CodeCoverage）只产出 0KB 空文件；`/p:CollectCoverage=true` 需要 `coverlet.msbuild` 包（本仓只有 `coverlet.collector`）。**别再在这两条上耗时间。**

## 3. 报告解读：先分清「采集坏了」vs「代码没被测到」

顺序不能颠倒——先确认采集是好的，再谈覆盖率。

1. **采集是否可信**：看 `qg coverage` 输出的 `lines-covered`。0 → 采集故障（§2），先修采集，**禁把 0% 当结论**。
2. **CRAP 表读法**：按 CRAP 从差到好排，最上面那些"又复杂又没覆盖"才是优先级；**别只看 CRAP 绝对值**——一个 CC=2 但覆盖 100% 的方法 CRAP=2，不是问题。
3. **变异得分读法**：得分低有两种成因，处置完全不同——
   - (a) **测试无效**：NoCoverage 少、被杀比例低 → 断言太松，测试通过但没验证逻辑；
   - **本仓实测是 (b)**：NoCoverage 多（607/23274 变异点落在没人测到的代码路径上）→ **该路径缺测试**，不是断言不够严。先分清再动手。
4. **重复检测读法**：PMD 的 `--minimum-tokens` 是相似度旋钮（默认 100 ≈ dryer 的 0.8 相似度档）；同一文件内多行命中优先看"三处共用同一 helper"这类结构性重复（`PurchaseOrderService.cs` 2026-10-31 基线快照 451/775 行、62 行/397 token；行号为基线值，非当前）。

## 4. 补测优先级

**判据 = 零覆盖 ∧ 高 CRAP**，不是 CRAP 绝对值。脚本已按此排好序（`qg crap` 输出的"零覆盖且超阈值"清单）。

本仓 2026-10-31 基线：方法总数 1622，**零覆盖 1264（78%）**，超阈值 323，其中 319 个同时零覆盖。Top：

| 方法 | CC | CRAP |
|---|---|---|
| `PMLService.FinishMatchAsync` | 74 | 5550 |
| `MaterialCodeImportService.PreviewAsync` | 58 | 3422 |
| `OutboundOrderService.MatchAndLockCoreAsync` | 53 | 2862 |
| `MaterialCodeService.CreateAsync` | 51 | 2652 |
| `MaterialCodeImportService.ValidateImportRowsAsync` | 49 | 2450 |

**为什么 78% 零覆盖**：只有集成测试覆盖的服务在常规档位是盲区——`tests/Shipyard.Material.IntegrationTests/` 需要 DB，CI mid 档 `backend-test` 带 `--unit-only`（不连测试库），full 档因 CI 未定义 `TEST_DB_CONN` 走共享 dev 库逃生。`ExchangeRateImportService` 就是典型：唯一测试在集成测试工程里，变异测试里把 Excel 表头字符串全换成 `""` 依然全绿。

补测方向因此是两条：**把不碰 DB 的纯逻辑下沉到单测**（Excel 表头/模板生成、校验口径这类），或**给 CI 配 `TEST_DB_CONN`** 走真实集成档。

## 5. 输出格式

做完盘点后按这四节给结论：

- **现状**：三道门各自的数字（覆盖率 line-rate / CRAP 超阈值数与占比 / 重复块数 / 变异得分），标注采集是否可信。
- **风险**：按"零覆盖 ∧ 高 CRAP"排序的前 N 个方法，含 `file` 定位。
- **原因**：区分"测试无效"与"代码没被测到"；若属后者，指出盲区来源（集成测试档位 / DB 依赖 / 纯逻辑未下沉）。
- **下一步**：具体到"给哪个方法补哪种测试"；不要停在"建议提高覆盖率"。

## 6. 本仓落点与边界

- 门禁单源：`.agents/hooks/commit-check.config.json`（build 段 = `dotnet build Shipyard.Material.sln`；**checks 段当前为空**，本地提交门不跑测试）。本技能**不改**该文件。
- 与 ub-mode 的接口：First Make it Work → 补测试（让 TDD 有落点）；Then Make it Right → 三道门；Practice → Keep a Log（本技能的结论就是决策日志的素材）。
- 与 `review-method` 的接口：复核 diff 时，"影响面证明"可用本技能的 dup/crap 补机器证据。
- 边界：只跑**单测工程**（集成测试要 DB，本机无 DB 会挂）；Stryker **必须定点**（全量 2 万+ 变异点不可接受）；不写任何仓库文件（除本技能自身目录）；不提交代码。
