---
状态: done
级别: L2
模块: pipeline
确认指纹: 649d3d9c98144f09
---
# PLAN — engine-quality-batch

对应入口：../intents/2026-10-08-engine-quality-batch.md
对应 spec：../specs/2026-10-08-engine-quality-batch.md

## 改动方案

- `package.json`：+`devDependencies.eslint@^9`、+`scripts.lint`（`eslint .`）
- `package-lock.json`：npm install 产物新增入库（CI 可复现）
- `eslint.config.mjs`（新增）：flat config——`@eslint/js` recommended 基线；ignores = `.agents/`、`modules/hosts/`、`**/cache/`、`workflow/`、`wiki/`、`docs/`；必要豁免以行内 `// eslint-disable-next-line` 最小标注（如 CLI 脚本的 `no-process-exit`）
- `src/run-tests.mjs`：套件序列首位插 lint 步——eslint 可用则 spawn `npm run lint` 非零即整体失败；不可用（未 install 的裸 checkout）显式打印 `[lint] skipped: eslint not installed` 后继续（可诊断性容错，非装户场景——装户无 npm test 编排器）
- `.github/workflows/ci.yml`（owned）：`npm test` 前补 `npm install`
- `templates/_agents/scripts/check-loop.mjs`：头部清单项 2/9/11/12/13 的**续行判据注**删除（清单行 `// N. 标题 [severity]` 逐字保留，行尾加短指针「（实现已迁 check-hygiene.mjs）」已有者不动）→ `flow-kit sync`
- `templates/_agents/scripts/check-hygiene.mjs`：对应 5 项检查实现处接收判据注（含变更史与 incident 引用，原文搬运不改写）→ `flow-kit sync`
- `templates/_agents/scripts/pipeline-run-docs.mjs`（新增）：文档纯函数层（`placeholdersIn` / `validateDraftContent` / `closeoutComplete` / `summarizeDoc` / `sectionBody` / `fmGet`）→ `flow-kit sync`
- `templates/_agents/scripts/pipeline-run-run.mjs`（新增）：run 存储层（`ctxEnv` / `moduleList` / `runFileOf` / `loadRun` / `saveRun` / `emit` / `latestRunId` / `newRunId`）→ `flow-kit sync`
- `templates/_agents/scripts/pipeline-run.mjs`：瘦身为 CLI 编排层（五子命令 / 工单协议 / `runNode` / `runGit` / 主流程），import 上两层 → `flow-kit sync`
- `templates/_agents/scripts/pipeline-run.test.mjs`：仅 import 与被测模块路径随迁，断言零改动 → `flow-kit sync`

## 任务拆解

1. **T1 · lint 工具链落地**
   - 步骤：npm install eslint@^9 → 写 flat config → `npx eslint .` 干跑盘点存量 error → 最小行内豁免清零 → package.json scripts + run-tests.mjs 首步 + ci.yml install 步骤
   - 判据：`npm run lint` exit 0；`npm test` 首步为 lint 且全量 exit 0；临时移走 `node_modules/.bin/eslint` 后 `node src/run-tests.mjs` 打印 `[lint] skipped` 且继续执行套件（容错分支冒烟）
   - 风险：中（存量 error 数量未知——recommended 基线对 18k 行；干跑后若超 ~30 处则豁免面回 spec 评估，不闷头刷豁免）
2. **T2 · check-loop 头部判据下沉**
   - 步骤：逐项（2/9/11/12/13）把续行判据注剪切到 check-hygiene.mjs 对应实现函数上方 → 清单行尾补短指针 → `flow-kit sync`
   - 判据：`node .agents/scripts/gate-checklist.mjs --diff` 输出「登记完整（0 断档 / 0 未登记）」；`git diff templates/_agents/scripts/check-loop.mjs` 显示清单行零变化（仅续行注删除）；`check-loop.test.mjs` + `check-hygiene.test.mjs` + `gate-seg.test.mjs` 全绿
   - 风险：低（纯注释搬运，三道测试兜底）
3. **T3 · pipeline-run 三层拆分**
   - 步骤：先拆 docs 纯函数层 → 再拆 run 存储层 → pipeline-run.mjs 改 import → test 文件路径随迁 → `flow-kit sync`
   - 判据：`pipeline-run.test.mjs` 全绿且 `git diff` 显示断言零改动；夹具环境跑 `start`/`status`/`next` 输出与拆分前对照一致（PIPELINE-STOP 标记行逐字节）；gate-seg 段归属核对（selfmeasure 避坑：拆出层不得错接全局收集器——pipeline-run 无 gate-seg 段则记「无段归属」核实结论）
   - 风险：低（分层单向 import + 全量测试）
4. **T4 · CI 与双源收尾**
   - 步骤：ci.yml 补 install → 全量验证矩阵 → shipped 视角一致性核对
   - 判据：`node .agents/scripts/source-sync-check.mjs --diff` 0 漂移；`node bin/flow-kit.mjs doctor` 0 WARN 0 FAIL；`sh .agents/scripts/rule-budget.sh --all` exit 0

## 执行顺序

T1 → T2 → T3 → T4。依赖：T1 独立（不触 templates）；T2、T3 互相独立（均「包源改完即 sync」）；T4 收尾全量门。三段实现各自独立 commit（feat/refactor 分开，可单独 revert）。

## 验证计划

- 静态门：`npm test`（已含 lint 首步）全量 exit 0
- L2 契约比对（逐项对应任务判据）：
  - `gate-checklist.mjs --diff` 登记完整（S2 契约）
  - check-loop 头部清单行 vs HEAD 逐字对照（S2 契约）
  - pipeline-run 五子命令输出 vs 拆分前对照（S3 契约）
  - `pipeline-run.test.mjs` 断言 diff 为零（测试不 weakening）
  - `source-sync-check` 0 漂移 + `doctor` 0 WARN 0 FAIL + `rule-budget --all`（双源与预算）
- 提交链：docs(workflow) approved 留痕（三件套一次提交）→ 代码三笔（T1 feat / T2+T3 refactor / T4 chore 或并入）→ 关单 docs(workflow)

### 偏离留痕（对 spec / 先例的已声明裁量）

1. **S3 拆出模块不单独建同名 .test.mjs**（偏离 selfmeasure「新模块带测试」先例）：纯函数与存储层由 `pipeline-run.test.mjs` 全量覆盖（迁 import 后继续），为拆分单造测试文件属形式主义——判据以「断言零改动全绿」承接。
2. **lint 存量清零用行内 disable 非规则降级**：豁免点位逐处标注、进评审视野；不用文件级 `/* eslint-disable */`。
3. **「装户跳过 lint」表述修正**（spec 约束遵守映射小偏差）：装户仓无 `src/run-tests.mjs` 编排器、verify.mjs 已单独处理无 package.json 场景——run-tests.mjs 的跳过容错实际保护的是**裸 checkout / 未 install 的包源仓场景**的可诊断性，语义不变、适用面收窄。
4. **「三笔独立 commit」并为一笔**（284d9e2）：lint 清零与拆分重构在 check-loop.mjs / pipeline-run.mjs 同文件交错，hunk 级分离的误分险 > 独立 revert 收益；提交信息已留痕。
5. **G2 端态措辞偏离**（独立复核 P2-2）：intent/spec 描述「清单行尾加短指针（实现已迁 check-hygiene.mjs）」，实现为整删迁移注续行、清单行未加新指针——映射信息已由 check-hygiene.mjs 头部（列明承载 2/9/11/12/13）与 check-loop.mjs import 区注释承载，判据（清单行与 HEAD 逐字一致、仅续行迁移）全部满足。
6. **package-lock.json 87/87 包钉 registry.npmmirror.com**（独立复核 P2-1）：本机 npm 配置钉国内镜像（环境事实，非本单选择）；官方源重生成尝试未生效。接受：integrity 哈希齐全兜底内容完整性；镜像偶发滞后时 `npm install --package-lock-only --registry=https://registry.npmjs.org` 重生成即可。

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（待用户确认）；done（关单时随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（本 plan 即改动清单，确认本文件即两道门合一前提是「文件清单与步骤」获得明确放行）
- 复核：L2——实现完成后 test 阶段按 test.md §4 走 independent-reviewer 独立复核
