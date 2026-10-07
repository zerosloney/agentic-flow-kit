---
状态: done
级别: L2
日期: 2026-10-07
模块: pipeline
备注: 关联 intents/plans 2026-10-07-adopter-ci-github（L2 防御道，intent 已 approved）
确认指纹: cdf2b2748475df25
---
# SPEC — adopter-ci-github

## 功能行为

**场景 A · 新装户 init（GitHub 托管）**：`flow-kit init` 渲染模板树时新增 `templates/_github/workflows/kit-ci.yml` → 装户根 `.github/workflows/kit-ci.yml`（renderTree 既有 `_`→`.` 顶层目录翻译，零新机制）。装户 push main / 提 PR 时 GitHub Actions 跑 kit-ci：checkout → setup-node（默认 22，文件头引导按项目 engines 调整）→（有根 package.json 才跑）依赖安装 → `node .agents/scripts/verify.mjs`。verify 即统一远端门入口：步骤 1 项目测试（根无 package.json 的装户仓显式跳过且不落凭证，v1.2.1 语义）+ 步骤 2 check-loop，任一非零 job 红。verify 全绿会向 runner 工作区 append 凭证行——runner 一次性，不污染仓库。**YAML 不复制任何门禁逻辑**（本地 / 远端单源）。

**场景 B · 存量装户 sync**：盘上无该件 → 既有 newOwned 分支出一行「新增 owned 起步文档（项目自持，未自动安装）」，不自动落盘，装户手动从包源 `templates/_github/` 拷贝；已装（含拷贝后自改）→ v1.1.9 感知锚生效：源演进且盘面未跟随 → advisory；盘面定制且源未演进 → 静默；源与盘面同步 → 静默。

**场景 C · TFS / 非 GitHub 装户**：文件落盘但 GitHub workflow 语义在 TFS 无效——文件头注释引导删除本文件；等价远端门 = 同入口命令写进 `azure-pipelines.yml`（用户手放，方案已留对话记录）+ 服务端分支策略。

**边界与异常**：装户仓工程在子目录（根无 package.json）→ CI 上只验 check-loop，文件头引导 `--test-cmd "<项目测试命令>"`；私有 npm registry / 私有 runner → owned 件装户自调依赖安装步骤；**GitHub 实跑真值不在本仓验证**（本仓不采用该文件、零依赖不引 YAML parser）——结构断言 + 人工核查 + 装户首跑，此边界显式申明。

## 数据流

- **init**：`templates/_github/workflows/kit-ci.yml` → renderTree（LF 归一 + {{VAR}} 渲染，本模板无占位符）→ 落盘 `.github/workflows/kit-ci.yml` → `isOwned` 判真 → owned 台账 `{rel, sha256}`，ownedFinal 段经 `srcTemplatePath`（泛化后命中 `templates/_github/...`）记 `srcSha256` 感知锚。
- **sync**：fresh map（模板树全渲染）含该 rel → 台账无 + isOwned → 盘上缺失 → newOwned 报告；已装 → ownedSha 按盘面自愈 + `templateDriftOf` 三态判定（stale-drift 唯一出账）。
- **doctor**：§4.5 覆盖率在 `!isOwned(rel)` 处豁免该件；§6.6 owned 漂移按盘面对账（含该件）；无新节、无 PAIRS 登记（S10 无涉）。
- **CI runner**：push/PR 事件 → kit-ci job → verify.mjs（spawnSync 测试 + node 直跑 check-loop）→ 退出码即红绿；check-loop 的 `CHECK_LOOP_ROOT` 既有 CI 支持（gate-coverage 先例）复用。

## 系统改动

1. **新增** `templates/_github/workflows/kit-ci.yml`（唯一新下发物；草案见下）。
2. **修改** `src/profiles.mjs`（唯二契约点）：
   - `isOwned` 增 `rel.startsWith('.github/')`——CI 配置归装户自持；
   - `srcTemplatePath`：`.agents/` 特例泛化为「首段 `.` 前缀 → `_` 前缀」——`.agents/x` → `_agents/x` 行为严格不变，`.github/y` → `_github/y` 新增命中，无点前缀 rel（`AGENTS.md` / `workflow/...`）不变。
3. **修改** `src/init.mjs`：安装面横幅字符串补 `.github/`（说明性，无逻辑）。
4. **修改** `templates/AGENTS.md`「门禁与提交」节补一行远端门口径（owned 模板演进；**本仓根 AGENTS.md 为 owned 装副本，须手动跟随**——双源纪律 owned 例外）。
5. **测试**：`src/sync.test.mjs`（.github 感知三态 + newOwned 提示不落盘）、`src/init.test.mjs`（fresh-init 断言 .github 件落盘 + 锚记入）、isOwned / srcTemplatePath 断言（含 `.agents` 行为不回归）。
6. 实现后 `node bin/flow-kit.mjs sync`（本批无 managed 件变更，预期 kit.json 仅版本对齐）；`npm test` 双套件（templates/ + shipped `.agents/`）。

无删除；check-loop / verify / doctor 门禁行为零改动。

**kit-ci.yml 草案**：

```yaml
# kit-ci —— agentic-flow-kit 装户远端门（GitHub Actions 薄模板，adopter-ci-github）
# 语义：本地 git hooks 可被 --no-verify / 未配 hooksPath 的克隆绕过——本工作流在 GitHub runner 上复跑
# 统一入口 node .agents/scripts/verify.mjs（测试【有根 package.json 才跑】+ check-loop），任一非零即红；
# 不在 YAML 里复制门禁逻辑（本地/远端单源，防口径漂移）。
# 本文件归装户自持（owned）：触发分支 / node 版本 / 测试命令可自改，flow-kit sync 永不覆盖。
# 装户仓工程在子目录（根无 package.json）时 verify 会跳过测试——改用
#   node .agents/scripts/verify.mjs --test-cmd "<项目测试命令>"
# 非 GitHub 托管（TFS / Azure DevOps / Jenkins…）可删除本文件：等价远端门 = 同入口命令 + 服务端分支策略。
# ⚠️ 真正的「门」在服务端：Settings → Branches → branch protection 勾「要求 PR + 状态检查绿才可合并」
# ——该配置带不进仓库文件，一次性人工动作，机器不校验。
name: kit-ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22   # 按项目 engines 调整（kit 引擎要求 >=18）
      - name: 安装依赖（有根 package.json 才跑；私有源在此加 registry 配置）
        if: hashFiles('package.json') != ''
        run: npm ci || npm install
      - name: 远端门（测试 + 闭环校验）
        run: node .agents/scripts/verify.mjs
```

## 约束遵守映射

| 红线 / 约束 | 本 spec 如何满足 |
|---|---|
| 引擎双源纪律（改 templates/ → sync 刷装副本；owned 手动跟随） | 引擎改动全在 `templates/` + `src/` 包源；唯一 owned 跟随项 = 根 AGENTS.md 一行，实现批内手动同步 |
| 零依赖（不引新包） | 不引 YAML parser：结构断言（含 verify 入口引用、无 Tab）+ 人工核查；YAML 极简单 job |
| isOwned / 映射属共享契约 → L2 | 走防御道三道门（intent 已 approved，本 spec + plan 逐门确认）；泛化对 `.agents` 严格向后兼容（spec §系统改动 2 论证） |
| 复用优先（验证阶梯） | relOf 翻译 / 感知锚 / newOwned / doctor 豁免全部复用既有机制，新增面 = 1 文件 + 2 个纯函数小改 |
| 不 `--no-verify`；L1+ 三段式闭环链 | 留痕提交按 docs(*) approved → 代码 → 关单 docs(*) |
| 不可消除噪声淹没真漏点（audit-gate-hardening P3） | 不加 doctor「CI 在位」检查（非 GitHub 装户会常驻告警）；本仓 newOwned 一行属诚实出账且 sync 手动跑才见 |

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| `.github/` 前缀 owned 过宽（未来装户 .github 下有想被 managed 的件） | 低 | isOwned 只作用于模板树内 rel；kit 只下发 workflows/kit-ci.yml；装户自建 .github 件本就不进台账 |
| srcTemplatePath 泛化改变无斜杠 owned rel（`.gitattributes`）探测路径 | 低 | 探测 `templates/_gitattributes` 不存在 → 返回 null，与现状（`templates/.gitattributes` 不存在）同为「不参与感知」，行为等价 |
| YAML 语法错误未被机器校验即下发 | 中低 | 模板极简（单 job 四步）；测试钉关键行与「无 Tab」；装户首跑即暴露，owned 可自修 |
| node 22 默认与装户 engines 不匹配 | 低 | 文件头 + 行内注释引导自调；kit 引擎 >=18 与 22 无冲突 |
| 本仓 sync 常驻 newOwned 一行 | 低 | 已声明接受（源仓自有 ci.yml 更全，不重复装薄门）；intent 非目标节留档 |
| CI runner 上 verify 落凭证文件 | 无 | runner 工作区一次性，不进 git |

## 确认与复核

- 确认日期：2026-10-07（对话原话「确认」）
- 复核：L2 推荐独立复核——independent-reviewer 已于实现后复核 diff（2026-10-07，总判定可提交，处置记录见 intent「确认与复核」）
