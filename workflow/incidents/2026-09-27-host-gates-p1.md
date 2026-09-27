---
状态: open
级别: L1
发现: 2026-09-27
模块: pipeline
备注: 宿主模块审查 P1×3 收口（用户「继续」按建议切法）：dotnet-ca 豁免清单多值 BRE 失效（P1-B1）+ CONTROLLERS_DIR fail-open（P1-B3）+ 红线 1 csproj glob 静默放行（随 B3）；trae pre-shell-check deny 强推换序绕过（P1-B2，token 化）；rider P2-B4（127 未装区分，两 hook 同修）。修复类，incident 即 intent 等价入口；L1 配 plan 不需 spec
---

# INCIDENT — 2026-09-27 宿主门禁模块三处判定失效（dotnet-ca / trae）

## 时间线
- 2026-09-27 宿主模块深处能力审查（independent-reviewer，静态核对 + 最小复现实验）判 3 个 P1：
  - **P1-B1**：`check-architecture.sh:30` 豁免清单 `tr ':' '|'` 造 `A|B`，POSIX BRE 中 `|` 是字面量 → `grep -v -e "A|B"` 永不命中 → **多值豁免全部失效**（实测：`echo "Controllers/CtrlA.cs:10: var x = _db.AppDbContext;" | grep -v -e "CtrlA|CtrlB"` 行保留）——豁免的 Controller 被误报违例、提交被误阻断（fail-wrong 方向）
  - **P1-B3**：`check-architecture.sh` 红线 5 的 `CONTROLLERS_DIR` 不在 `require_target` 清单（:24-28 仅 4 项），grep `2>/dev/null` 吞目录缺失 → Controllers 目录改名/改 minimal API 时**红线 5 静默失效**（fail-open，违反脚本自述「目标缺失 fail-closed」硬约束）；红线 1 `"$APP_DIR"/*.csproj` glob 展开失败同样静默放行
  - **P1-B2**：`pre-shell-check.cjs:82-83` deny 模式 `git push --force` 子串定位，`git push origin main --force`（最自然语序）与 `git push origin +main`（强推变体）均不匹配 → 绕过；该钩子自定位为 core.hooksPath 漏配时唯一门禁，此 deny 即主要执行点
- 同日用户拍板「继续」收口，立本 incident

## 影响面
- `modules/gates/dotnet-ca/check-architecture.sh`（包源件，经 add-gate 装入户项目）
- `modules/hosts/trae/hooks/pre-shell-check.cjs`（trae 宿主装户）
- `modules/hosts/trae/hooks/post-edit-check.cjs`（P2-B4 rider 同修）
- 本仓无 dotnet 项目、无 .trae 目录——缺陷只影响装户侧，本仓 dogfooding 未暴露（与钩子执行位同款盲区）

## 根因
三处同族：**POSIX/shell 语义与写作意图错位**——BRE 无 `|` 交替（B1）、glob 不匹配时字面串传给 grep 被吞（B3）、子串定位无法表达「flag 存在性」（B2）。审查报告原话「集中在门禁声明口径 vs 实际判定的缝隙」。

## 为什么之前没拦住
- 三件均无任何自动化测试（gate 模块与宿主 hook 是测试盲区——npm test 只覆盖 src/ 与 templates/_agents/scripts/）
- 本仓 dogfooding 不触装户面（无 .NET 项目、无 .trae 目录），fail-wrong/fail-open 都不可见
- 审查（人）拦住了——最小复现实验在报告内实证

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：随本单 feat 提交落（关单时回填 SHA）
   - 影响环境：dev（包源件，未发布版本面）
   - 是否需要新 intent：
     - 否 → 理由：实现级判定缺陷单点修复（BRE 拆分 / fail-closed 补齐 / token 化），无门禁缺位类系统性根因

2. 防复发验证（必须落到自动化用例，禁止只写「已人工验证」）
   - 自动化用例：新增 `src/gate-dotnet-ca.test.mjs`（豁免多值拆分 / CONTROLLERS_DIR 缺失 fail-closed / csproj 缺失 fail-closed，fixture 临时 git 仓）+ `src/trae-hooks.test.mjs`（换序强推拦 / +refspec 拦 / --force-with-lease 放行 / 127 未装区分）；`src/run-tests.mjs` 注册两套件

3. 规范条目（必须有可追溯的落点）
   - 落点：两脚本头部注释（BRE 无交替约束 / token 化口径 / 127 语义）
   - 引用：随本单 feat 提交
