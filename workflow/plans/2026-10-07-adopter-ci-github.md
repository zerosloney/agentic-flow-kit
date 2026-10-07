---
状态: approved
级别: L2
模块: pipeline
确认指纹: 47399654c3e5cb8a
---
# PLAN — adopter-ci-github

对应入口：../intents/2026-10-07-adopter-ci-github.md
对应 spec：../specs/2026-10-07-adopter-ci-github.md

## 改动方案

- `templates/_github/workflows/kit-ci.yml`：**新建**装户远端门薄模板——内容 = spec「kit-ci.yml 草案」整段（checkout / setup-node 22 / 条件装依赖 / `node .agents/scripts/verify.mjs`；文件头含 owned 自持、非 GitHub 可删、分支策略人工边界三段口径）。
- `src/profiles.mjs`：① `isOwned`（:109-116）增 `rel.startsWith('.github/')`；② `srcTemplatePath`（:131-135）`.agents/` 特例泛化为「首段 `.` 前缀 → `_` 前缀」（`.agents/x` → `_agents/x` 严格不变，`.github/y` → `_github/y` 新增，无点前缀 rel 不变）。
- `src/init.mjs`（:100 安装面横幅）：补 `.github/`（说明性字符串，无逻辑）。
- `templates/AGENTS.md`「门禁与提交」节：补一行远端门口径（kit-ci 薄门 + 分支策略人工边界）；**根 `AGENTS.md` 为 owned 装副本，同批手动跟随同一行**（双源纪律 owned 例外）。
- `src/sync.test.mjs` / `src/init.test.mjs`：补测试（见任务 2 判据）。

## 任务拆解（L2/L3 必填）

1. **下发物 + 契约点 + 横幅**：kit-ci.yml 落 `templates/_github/workflows/`；profiles.mjs 两处小改；init.mjs 横幅。
   - 判据：`isOwned('.github/workflows/kit-ci.yml') === true`；`srcTemplatePath` 正例（`.agents/...`、`.github/workflows/kit-ci.yml` 均命中 `templates/_*`）+ 反例（`.gitattributes` → null，与现状等价）；模板文本断言含 `node .agents/scripts/verify.mjs` 与分支策略提示、无 Tab 字符（YAML 硬约束）。
   - 风险：低（纯函数小改；`.agents` 特例被泛化严格包含，spec 已论证）
2. **测试补充**：fresh-init 断言（.github 件落盘 + kit.json owned 含该 rel 且 `srcSha256` == 包源 LF 归一 sha）；sync 感知三态（源改一字 → stale-drift advisory；盘面定制跟源 → 静默）；存量装户 newOwned 提示且不自动落盘；isOwned / srcTemplatePath 断言（含 `.agents` 存量不回归）。
   - 判据：`npm test` 全绿（templates/ 与 shipped `.agents/` 双套件）。
   - 风险：低（复用 template-downstream 批的夹具与断言模式）
3. **AGENTS.md 口径行**：`templates/AGENTS.md` 门禁节 + 根 `AGENTS.md`（owned 跟随）同一行两处落。
   - 判据：两处同文；sync 对根 AGENTS.md 的感知不出 stale-drift（跟随即静默）。
   - 风险：低
4. **装副本对齐**：`node bin/flow-kit.mjs sync`（本批无 managed 件变更——预期仅版本对齐 + 一行 newOwned 提示 `.github/workflows/kit-ci.yml`，属 intent 非目标节声明行为）。
   - 判据：sync 收尾 doctor 全绿、无 FAIL。
   - 风险：低
5. **独立复核 + 留痕提交**：independent-reviewer 复核 diff（两契约点兼容性论证 + 测试覆盖）；三段式闭环链提交。
   - 判据：复核零 P0/P1（P2 逐条处置）；`docs(*)` 三件套 approved 留痕 → `feat` 代码 → 关单 `docs(*)`。
   - 风险：低

## 执行顺序（L2/L3 必填）

1 → 2 → 3 → 4 → 5（1 是 2 的被测对象；3 依赖 1 的模板树定形；4 是 1/3 落盘后的对齐步；5 收口）。

## 验证计划

- 静态门：`npm test`（全部套件；双份字节同源验证由 shipped 套件步骤覆盖）。
- L2 追加（契约 / 口径对账）：isOwned / srcTemplatePath 行为断言（`.agents` 存量不回归、`.gitattributes` 反例等价）；感知三态对账（stale-drift 出账 / custom-synced 静默）；YAML 结构断言（统一入口引用 / 无 Tab / 关键节在位）。
- 无前端、无 UI、无 schema（相关行不适用）。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节；done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-10-07 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 独立复核——independent-reviewer 复核契约点与测试覆盖（任务 5，提交前）
