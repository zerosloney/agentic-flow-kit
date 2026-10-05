---
状态: approved
级别: L2
日期: 2026-10-05
模块: pipeline
备注: 与 intent / spec 同名配对
确认指纹: a8c84582b9c4f7a9
---
# PLAN — host-gitignore-localonly-revoke

对应入口：../intents/2026-10-05-host-gitignore-localonly-revoke.md
对应 spec：../specs/2026-10-05-host-gitignore-localonly-revoke.md

## 改动方案

- `src/profiles.mjs`：`HOSTS.zcode.localOnly` 与 `HOSTS.omp.localOnly` 由 `true` 改 `false`；表上方加注释块记录撤销日期、理由（装户口径对齐本仓 gate-coverage 返工后形态）与代价（草稿目录改由装户自管）。**这是本次唯一的行为改动**。
- `src/init.mjs`：第 4 步上方注释改为「七个宿主一律 `localOnly:false`，实际只补 `.agents/cache/`」；`giNeed` 表达式不动（仍从 `HOSTS.localOnly` 派生，保持判定单源）。
- `src/add-host.mjs`：头注释第 3 行与 `if (HOSTS[host].localOnly)` 分支注释改为「暂无宿主命中，保留是为了未来重开本机专属宿主档位不必改结构，判定单源在 `profiles.mjs#HOSTS.localOnly`」；分支代码与 `console.log` 不动。
- `src/cli.mjs`：`--hosts` 帮助文本「zcode/omp 为本地配置，自动进 .gitignore」→「七个宿主一律入库，不自动进 .gitignore」。
- `src/sync.test.mjs`：新增 `ROpt = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '')` 可选读 helper；S7 断言由 `R(...).includes('.zcode/')` 翻转为 `!ROpt(...).includes('.zcode/')`，断言名同步改为「宿主目录不再进 .gitignore（localOnly 已撤销，zcode 与其余宿主同策）」。
- `README.md`：`--hosts` 选项表说明改为「七个宿主一律入库（2026-10-05 起 zcode/omp 撤销 localOnly——换宿主不丢文件、CI 克隆面与本仓一致）」，并补「zcode 会话级液态草稿是本机态、不该入库——init 不再自动写这条规则，请自行加进 `.gitignore`（本仓实例见根 `.gitignore`）」。
- `.gitignore`：`# agentic-flow-kit` 段内保留 `.zcode/drafts/`、`.zcode/plans/` 两行（净效果与改动前一致），上方加注释「zcode 会话级液态草稿（本机态，不入库）；`.zcode/agents/` 薄适配是 managed 件，保持 tracked」。

## 任务拆解

1. 改 `profiles.mjs` 判定单源
   - 判据：`grep 'localOnly: true' src/profiles.mjs` 0 命中；七个宿主表项齐全
   - 风险：低（单表数据面，两处消费点随之生效）
2. 同步四处代码注释与帮助文案
   - 判据：`grep -rn '自动进 .gitignore\|自动进 \.gitignore' src/ README.md` 0 命中残留；`init.mjs` / `add-host.mjs` 注释与新行为一致
   - 风险：低（纯文案，但漏改会让装户照抄陈旧口径——2026-09-29 p0-gate-noise-batch 同类）
3. 翻转 S7 断言并加 `ROpt` 可选读
   - 判据：`node src/sync.test.mjs` exit 0，输出「合计: PASS 56 / FAIL 0」
   - 风险：中（首次改完实测崩过 ENOENT——装户端不再创建 `.gitignore`；`ROpt` 即由此修掉）
4. 本仓 `.gitignore` 补注释
   - 判据：`git check-ignore -v .zcode/plans/<任一文件>` 有输出且指向 `.gitignore` 的 `.zcode/plans/` 行；`git ls-files .zcode` 仍返回三份 `agents/*.md`
   - 风险：低
5. 全套验证 + 独立复核
   - 判据：`src/` 八个套件 + `templates/_agents/scripts` 二十八个套件全 exit 0；`node bin/flow-kit.mjs doctor` 输出 13 PASS / 0 WARN / 0 FAIL；`independent-reviewer` 复核结论记入本 plan「确认与复核」节
   - 风险：低

## 执行顺序

1 → 2 → 3 → 4 → 5。

依赖说明：1 必须最先（2/3 的文案与断言都以新行为为准）；3 依赖 1；4 与 1–3 无耦合，可并行；5 收口，须在 1–4 全部落盘后执行。

已完成情况（本次会话内已按此顺序执行完毕，1–4 落盘、5 的套件与 doctor 已实跑，剩独立复核）：

- 任务 1–4：✅ 已完成
- 任务 5：部分完成——`src/sync.test.mjs` 56/0、`init.test` 32/0、`fresh-init` 4/0、`stack-profile` 14/0、`sync-hosts` 29/0、`pack` 2/0、`gates` 12/0、`gate-dotnet-ca` 5/0、`trae-hooks` 22/0；`templates/_agents/scripts` 28 套件全 exit 0；`doctor` 13 PASS / 0 WARN / 0 FAIL。独立复核待执行。

## 验证计划

- 静态门：本仓为纯 JS 脚手架包，无构建 / 无类型检查（见根 `AGENTS.md` 项目适配区）；实际静态门 = 测试套件
- 测试（`项目测试命令` = `npm test`）：本机 PowerShell 管道整跑会 OOM 且 `workflow-enums.test.mjs` 依赖 `sh -c sed`（Windows 无 sh），故按套件逐个 `node <suite>` 跑并逐个记 exit code——这是环境限制的绕行，不是对 `npm test` 脚本的修改
- 契约 / 规则面比对（L2 追加）：`grep 'localOnly: true'` 在 `src/` 与 `README.md` 0 命中；`git check-ignore` 确认本仓草稿目录被忽略且 `.zcode/agents/` 仍 tracked；`doctor` 的 managed 台账与薄适配 sha 比对 0 FAIL
- 冒烟：`node bin/flow-kit.mjs doctor` 全绿（本仓自举装户口径体检）
- 独立复核：L2 按根 `AGENTS.md` 在关单前由 `independent-reviewer` 复核（读 `.agents/roles/independent-reviewer.md`），结论记入本节

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。

- 确认结果：approved（2026-10-05 用户对话内确认，原话见 confirmations.jsonl）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 关单前由 `independent-reviewer` 复核代码改动面（结论待回填）
