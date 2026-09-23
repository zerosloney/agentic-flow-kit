---
状态: approved
级别: L2
日期: 2026-09-23
模块: pipeline
备注: M1 intent 非目标预留「M4 dogfooding 迁移，另立 L2」。原始语境「本仓库」指发起仓库 Shipyard.Material；该仓库现有并行业务会话（MTO/采购单），引擎迁移不混入——M4 范围调整为包仓库自身安装（真 dogfooding：吃自己的狗粮），Shipyard.Material 回流迁移待其并行任务收尾后另立任务。待用户确认后转 approved。
---
# INTENT — M4：agentic-flow-kit 自装 dogfooding（包仓库成为包消费者）

## 背景与问题
- 包已具备 init / doctor / sync / add-host / add-gate 全能力（v0.2.0），但包仓库自身仍是「无引擎」裸仓库：无 .agents/、无 AGENTS.md、未挂 git 门禁——自己的开发没用上自己的引擎，workflow/ 留痕只靠手工维护，无 check-loop 门禁、无看板、无闭环配对检查。
- 引擎模板的日常正确性目前只靠 e2e 临时仓库验证；真装长跑才能暴露真实使用问题（钩子误拦 / 生成器边角 / 留痕协议摩擦）。

## 目标
- `flow-kit init --hosts zcode --stack none --board-port 8933` 装入本仓库：.agents/ 引擎 + .githooks/ 真门禁 + wiki/ 骨架 + AGENTS.md。
- 已有 workflow/ 留痕（M1/M3 四份 + README + delegations）保守保留；模板基线件（_TEMPLATE ×4、papercuts、regression-checklist）增量补齐；INDEX.md 生成。
- M4 提交本身穿过真钩子门禁（闭环配对 / wiki 台账 / 规则预算 / commit-check / commit-msg）——dogfooding 的第一验证点。
- 建立双源纪律：引擎改动一律改 templates/（包源）→ `flow-kit sync` 更新 .agents/（装副本）；.agents/ 直改会被 doctor 漂移告警。写入 AGENTS.md 项目适配区。
- 测试入口收敛：`npm test` 一条命令跑全部套件，供 test.md 阶段门与后续 npm 发布消费者使用。

## 非目标
- Shipyard.Material 引擎迁移回流（其有并行业务会话，收尾后另立任务）。
- 不改 templates/ 引擎内容（本轮纯安装消费；发现问题立 incident 再改包源走 sync）。
- 不动 src/ 既有实现。

## 影响面
- 模块：pipeline；新增 .agents/（managed 引擎 + owned 基线）、.githooks/、wiki/、AGENTS.md、workflow/ 增量模板件；package.json 加 test script + src/run-tests.mjs；.gitignore 追加；.zcode/ 本地不提交。
- 数据库：无；前端页面：无。

## 触达红线
- 不触及（纯新增安装与配置；既有留痕文档零改动）。

## 验收标准（可测试）
- [x] init 后 doctor 7 PASS / 0 WARN（目录布局 / 钩子挂载 / managed 台账 45 份 / 无占位符残留 / INDEX 无漂移 / check-loop 干净）
- [x] 既有 workflow/ 留痕原样保留（git diff 48dd392..6829585 对 M1/M3 四份文档为空）
- [x] AGENTS.md 项目适配区填本仓库真实口径（无构建、纯 JS）；`npm test` 跑全 7 套测试（38 + 105 = 143 例）全绿
- [x] M4 提交穿过真钩子（pre-commit / commit-msg）成功落库（6829585）——且先被真钩子拦下两次：一次抓到 CJS 扩展名真缺陷（走 incident 闭环修复，5 份改 .cjs 经 sync 落地）、一次逼出 incident-plan 配对要求；提交后 doctor / check-loop 复跑干净（见收尾提交后验证）
- [x] 双源纪律（改 templates/ → sync）落 AGENTS.md 项目适配区；sync 首次实战：覆盖 pre-commit、新增 2 份 .cjs、报告 2 份旧 .js 待手删（已删）

## 实施纪要（dogfooding 摩擦实录，供后续装户参考）
- 首次 commit 即被拦：CJS 脚本 `.js` 扩展名在 type:module 项目崩溃（incidents/2026-09-23-cjs-ext-in-typemodule.md，closed）
- 闭环配对门禁逼出协议要求：incident 须配同名 plan；L2 intent 须配 spec（本 intent 的 spec 为事后回填）
- spec 模板红线表残留 Shipyard 项目行 → 记 papercuts.md（不当场顺手改）
