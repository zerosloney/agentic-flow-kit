---
状态: draft
级别: L2
日期: 2026-10-05
模块: pipeline
备注: 检查 8 全数字短 SHA 误分类根治——守卫后移 rev-parse 实证分流 + 豁免分支插桩 + linesOf 按文件去重；与同名 incident/spec 配对
---
# PLAN — check8-digit-sha-misfire

对应入口：../incidents/2026-10-05-check8-digit-sha-misfire.md
对应 spec：../specs/2026-10-05-check8-digit-sha-misfire.md（approved 2026-10-05，指纹 73431c6d64a847d7）

## 改动方案

- `templates/_agents/scripts/check-loop.mjs`（唯一行为面）：
  - `verifyEvidenceTruth` 守卫后移：删除前置 `if (!shaMatch || /^\d+$/.test(shaMatch[1])) return { ok: true, type: 'text' }` 中的纯数字抢先分类，改为——`!shaMatch` 仍直接 text；`shaMatch` 命中后统一走 `spawnGit(['rev-parse', sha])`，解析失败时按 `isDigitOnly = /^\d+$/` 分流：纯数字 → `text` 豁免（时间戳/ID 语义保持），非数字 → 既有 residue external/forged 判定；解析成功（含纯数字短 SHA 命中提交/ref）→ 既有真相核验全链
  - 豁免/放行分支补出账（进程级按 type 去重，`check-loop: 证据豁免 <type> <base>` 形态，stderr）：`text`/`no-plan`/`external`/`process` 四条——与既有 irrelevant/sha 的裁决可见性对齐
  - `linesOf` fs 告警去重粒度：进程级 `fsReadWarned` flag 改为按文件 `Set`（每文件首异常出账一条）——合法缺失文件不再消耗其他文件的告警额度
  - 守卫处注释：文本启发式与实证的先后纪律（形态判断可被 rev-parse 实证兜底时禁抢先分类）
- `templates/_agents/scripts/check-loop.test.mjs`：
  - 新增场景 5t 两块（构造性钉子，不依赖哈希运气）：
    - ①全数字 ref 正例：evidenceFixture 形态 + `git tag 2620913`（7 位全数字 ref 指向证据提交）+ 证据引「2620913」→ 断言 outOf 含「证据无关」（修复前 `/^\d+$/` 抢先 text 静默漏检——确定性钉死）
    - ②纯数字时间戳负例：证据引「20260926」（纯数字、无同名 ref）→ 断言不含「证据无关/伪造」（豁免保持，防误报）
- 装副本同步：`flow-kit sync` 刷 `.agents/scripts/check-loop.{mjs,test.mjs}` 与 `.agents/kit.json` 两个 sha256
- `workflow/papercuts.md`：gitout-fail-open 行「拟修」列追加「再命中已立项 → 同名 check8-digit-sha-misfire 单（真根因为全数字短 SHA 误分类，与 git/fs/夹具三层无关）」
- `workflow/regression-checklist.md`：防复发验证节追加「证据校验的文本豁免须以 rev-parse 实证兜底，禁以字符形态抢先分类」
- **不动**：非数字 forged/external 判定链、时间戳豁免语义、gitOut/spawnGit（前单已修）、检查 8 其余判据、检查 1-7/9-20、`--rev` worktree 路径

## 任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）

1. check-loop.mjs 引擎改动（守卫后移 + 豁免分支出账 + linesOf 按文件去重）
   - 判据：`node --check` 通过；探针脚本（/tmp/probe-44.mjs 改造为 /tmp/probe-5u.mjs：夹具打全数字 tag）复跑——修复前 40 轮可复现裁决消失、修复后 40 轮 0 次；grep 断言 `/^\d+\$/` 在 verifyEvidenceTruth 内仅 rev-parse 失败分支一处
   - 风险：中（主门禁引擎件；缓解——改动集中在单函数守卫 + 四条出账 + 一行去重粒度，非数字路径与既有豁免语义逐字节保持）
2. check-loop.test.mjs 场景 5t 两块（构造性正例 + 时间戳负例）
   - 判据：`node templates/_agents/scripts/check-loop.test.mjs` 全绿（既有 201 + 新增断言）；正例在修复前跑会红（变异自验：暂还原守卫 → 正例 FAIL → 还原）
   - 风险：低（增量场景；git tag 数字名构造确定性钉子，无平台分支）
3. sync 刷装副本 + kit.json sha
   - 判据：`node bin/flow-kit.mjs sync` 覆盖更新 2 份；`node bin/flow-kit.mjs doctor` 13 PASS / 0 WARN / 0 FAIL
   - 风险：低
4. 稳定性验证
   - 判据：探针 40 轮裁决消失 0 次（根因为概率性哈希形态——构造性用例已钉死后，探针作为回归观测）；套件连跑 10 轮 0 FAIL
   - 风险：低
5. 台账回填（papercuts 拟修列 + regression-checklist 防复发节）
   - 判据：doctor 13/0/0；两处行内容含本单主题与修复 SHA（fixed 后）
   - 风险：低
6. 关单（test 阶段）：逐条勾验 spec 改动面并补证据 → incident fixed→closed、spec/plan done（确认门逐件 delegated）
   - 判据：L2 独立复核（independent-reviewer，基准 = plan approved 时的 HEAD）结论记入「确认与复核」节；check-loop 无新增 advisory
   - 风险：低

## 执行顺序（L2/L3 必填；L1 单文件微改动删本节）

1 → 2 → 3 → 4 → 5 → 6。依赖说明：2 依赖 1（正例钉子以守卫后移为前提）；3 依赖 1–2 落盘；4 依赖 1–2；5 依赖 1（出修复 SHA 后回填）；6 收口，L2 独立复核在 6 之前执行。

## 验证计划

- 静态门：纯 JS 无构建/类型检查（根 AGENTS.md 项目适配区口径）；实际静态门 = 测试套件 + `node --check`
- 测试：逐套件 `node <suite>` 直跑（本机 npm test 整跑限制沿先例）；重点 = `templates/_agents/scripts/check-loop.test.mjs`（本单主战场）+ `.agents/scripts/check-loop.test.mjs`（装副本同文）+ `src/sync.test.mjs`（sync 面）
- 契约 / 规则面比对（L2 追加）：探针复跑（/tmp/probe-5u.mjs，全数字 tag 构造）修复前后对照——修复前裁决消失可复现、修复后 40 轮 0 次；grep 断言 `/^\d+\$/` 在引擎内仅 rev-parse 失败分支一处
- 稳定性：探针 40 轮 0 次 + 套件 10 轮 0 FAIL；CI 六矩阵持续观察
- 冒烟：`node bin/flow-kit.mjs doctor` 13 PASS / 0 WARN / 0 FAIL
- 独立复核：L2 推荐独立复核——关单前 `independent-reviewer`（读 `.agents/roles/independent-reviewer.md`）复核代码改动面，结论记入「确认与复核」节

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 推荐独立复核——关单前 independent-reviewer 复核，结论此处回填
