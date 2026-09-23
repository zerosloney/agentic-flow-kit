---
状态: approved
级别: L1
日期: 2026-09-23
模块: pipeline
备注: 2026-09-23 用户对话内确认「sync 对本地改动 = 跳过+报告+--force」（README 路线预告的 diff 确认就此定形收窄）后当日完成。实现中连带修复 M1 遗留缺陷：local-pre-commit 模板尾部 exit 0 会吞掉其后接线门禁的失败——模板改 set -e 去尾 exit 0、挂载点归 owned（isOwned）、add-gate 对旧装态归一化剥尾；e2e 以「接线后 commit 被 fail-closed 真拦截」验证生效。
---
# INTENT — M3：flow-kit sync / add-host / add-gate

## 背景与问题
- v0.1.0 已可 init / doctor，但装完后无升级通道：包模板修 bug、加文件时已装项目只能手工同步。
- 后补宿主与门禁无子命令：modules/hosts、modules/gates 有货无门（dotnet-ca README 仍指导手工 cp 接线）。
- 升级判定基础已在：init 落 .agents/kit.json 双台账（managed 带 sha256、owned 永不动）。

## 目标
- `flow-kit sync`：按三态升级 managed 文件——
  - 未改动（磁盘 sha == 台账 sha）→ 覆盖为新版渲染；
  - 本地已改（磁盘 sha != 台账 sha）→ 跳过并报告，`--force` 才覆盖；
  - 生成器目标（INDEX.md / wiki 看板）→ 不比对，重跑生成器走锚点重写。
  - 附带：包内新增文件 → 安装；包内已删 → 仅报告不删盘；managed 文件缺失 → 恢复。
  - 收尾：台账版本对齐当前包 + doctor。
- `flow-kit add-host <h>`：init 后补装宿主适配层（渲染 → managed 台账补记 → options.hosts 补记 → localOnly 宿主进 .gitignore）。
- `flow-kit add-gate <g>`：装门禁模块文件到 .agents/hooks/ 并接线 local-pre-commit 挂载点（幂等）；门禁装后归项目（owned 台账，sync 永不覆盖）。
- CLI help 与 README 用法 / 路线同步更新；版本 0.1.0 → 0.2.0。

## 非目标
- README 路线预告的「本地改动 diff 确认」收窄为「跳过 + 报告 + `--force`」——不实现交互式逐文件 diff 确认（git 本身即 diff 工具）。
- 不做 `--prune`（不删包内已移除文件的磁盘残留）、不做跨版本迁移逻辑。
- M4（本仓库 dogfooding 全量安装）、M5（npm 发布）另立。
- 不改 init / doctor 既有行为与输出。

## 影响面
- 模块：pipeline（工具仓库自身）；新增 src/sync.mjs、src/add-host.mjs、src/add-gate.mjs、src/cli.mjs 路由分支与 HELP、README 两节、package.json 版本号。
- 数据库：无；前端页面：无。

## 触达红线
- 不触及（纯新增子命令；不修改既有引擎模板与 init / doctor 行为）。

## 验收标准（可测试）
- [x] sync 单测：未改动文件随模板变更被覆盖；本地改动被跳过且 `--force` 可覆盖；新增模板文件被安装；包内已删仅报告不删盘；managed 缺失被恢复；无 kit.json 明确报错引导 init。（src/sync.test.mjs S1–S6，2026-09-23 全绿）
- [x] add-host 单测：文件就位、managed 台账补记、localOnly 宿主 .gitignore 追加、options.hosts 补记。（S7）
- [x] add-gate 单测：文件落 .agents/hooks/、local-pre-commit 接线幂等、owned 台账补记。（S8/S9，含旧装态归一化）
- [x] e2e：临时 git 仓库 init → 删一个 + 改一个 managed 文件 → sync 恢复与跳过各自生效 → doctor 全绿（7 PASS/0 WARN）；init 后 add-host opencode 安装 11 份且 doctor 布局通过；add-gate 接线后 commit 被门禁 fail-closed 真拦截（git log 零提交），去接线后 commit 通过。
- [x] 既有 6 套引擎测试维持全绿（无回归）。（5 个 *.test.mjs 71 PASS + check-loop.test.sh 34 PASS）
