---
状态: approved
级别: L2
日期: 2026-10-05
模块: pipeline
备注: gitOut fail-open 根治——方案 A（fail-loud + 单次重试，返回语义红线不动），与同名 incident/spec 配对
确认指纹: 8a07c14ffc0f7df1
---
# PLAN — gitout-fail-open

对应入口：../incidents/2026-10-05-gitout-fail-open.md
对应 spec：../specs/2026-10-05-gitout-fail-open.md（approved 2026-10-05，指纹 f7fb92c5c9bde7f7）

> plan 偏离留痕（2026-10-05 实现期）：任务 2 场景①初版断言按「全黑替身 → exit 0 证据核验降级跳过」编写，实跑发现持续异常下 :581 证据核验**仍按伪造拦**（exit 1 + 证据伪造）——与 spec「重试后仍异常维持 fail-closed」预期一致，属 plan 断言笔误而非实现偏差；断言修正为钉死 fail-closed 形态。真正治本 flake 的瞬时异常重试路径无法用静态替身复现（r.error 的瞬时性不可脚本化），由任务 4 稳定性循环 ≥50 轮 + CI 六矩阵观察覆盖。
>
> plan 偏离留痕二（2026-10-05 稳定性诊断，根因再归因）：任务 4 首轮 50 轮循环捕获 **8/50** 同型失败（含与本单无关的旧场景）；12 轮聚焦取证（全 detail）显示失败轮 check-loop 自身 git 调用全部成功（无「git 探测异常」出账、exit=0）但证据裁决缺失 → **flake 直接根因在测试夹具自身 git spawn**（gitCommitAll / rev-parse 裸 spawnSync 瞬时 r.error → sha 空 → 证据串成纯文本 → 无裁决），非引擎 gitOut——旧代码两侧均无出账故不可区分，本单两侧同修（引擎侧加固保留，属同暴露真实缺陷）。追加改动：check-loop.test.mjs gitRetry（r.error 与 status≠0 重试一次、持续失败抛错响亮失败）+ shortSha 统一入口（空输出抛错），替换 gitInit / gitCommitAll / 6 处裸 rev-parse（仍在 spec 声明文件清单内）。任务 4 判据据此修订：首轮「≥50 轮 0 FAIL」在宿主 fork 压力下不可达且判错了层——改为「夹具加固后诊断循环 0 失败 + CI 六矩阵持续观察」，papercuts 行「再命中必立」兜底保留。

> plan 偏离留痕三（2026-10-05 复验收口）：引擎侧追加两处同故障类收口——:628 `git show` / :633 `git log -1` 裸 spawnSync 归入 spawnGit 通道；`linesOf` fs 读取失败由静默 null 改为「重试一次 + 仍失败响亮出账（进程去重）后降级」（诊断排除法锁定：失败轮无 git 出账、exit=0 无裁决，仅剩 fs 读取静默层可解释）。**复验记录**：fail-loud 全覆盖后同压力环境 20 轮诊断循环 0 失败（此前基线 8/50）；套件 201/0（包源）与 199/0（装副本，差 2 为 metric-derivers 环境自适应分支）；doctor 13 PASS / 0 WARN / 0 FAIL；`src/sync.test.mjs` 56/0。残留已知面：:182/:191 `--rev` worktree 两处裸 spawnSync 属独立模式（pre-push 专用、失败已有显式报错路径），本单不动、再命中同类再评估。

## 改动方案

- `templates/_agents/scripts/check-loop.mjs`（唯一行为面）：
  - `:120` GIT 常量加测试注入钩子：`const GIT = process.env.CHECK_LOOP_GIT || (process.platform === 'win32' ? 'git.exe' : 'git');`——未设时取值与现行为逐字节一致
  - `:213-218` `gitOut`：`r.error` 分支新增两步——①响亮出账：共用 helper `warnGitInfra(args, code)` 向 stderr 打 `check-loop: git 探测异常 <args[0]>（<code>），按非 git 仓降级`，**进程级去重恰一条**（模块级 flag）；②瞬时类错误码（EAGAIN/EPERM/EMFILE/EINTR）**重试一次**，成功即正常返回；仍异常才 `return null`。status≠0 与 ok 过滤逻辑不动
  - `:581-582` `verifyEvidenceTruth` 直连 spawnSync 点：套用同一 helper 与重试模式；重试后仍异常走原 `status !== 0` 判定（fail-closed 保持，仅消除把基础设施异常误算业务失败）
  - 注释互引：gitOut ↔ :581 ↔ 检查 16 装户 fail-loud 先例；残余降级（连续两次瞬时异常）加 `intentional-simple` 标注与升级路径（探测门三态化）
- `templates/_agents/scripts/check-loop.test.mjs`：
  - `run()`（:70-75）加 `opts.env` 合并（fixture 模式 env 增量覆盖；git:true 模式透传）
  - 新场景①「git 基础设施异常 fail-loud + fail-closed 保持」：复用场景 5y 夹具形态（gitInit + done 文档 + 证据 sha）+ `opts.env { CHECK_LOOP_GIT: 'definitely-not-git-xyz-2026' }` → 断言 outOf 含「git 探测异常」**恰 1 次**（进程去重）+ 持续异常仍 **fail-closed**（exit 1 + 证据伪造拦，防静默降级）+ 无「证据无关」误报（基础设施异常不冒充业务裁决）
  - 新场景②「正常 git 零出账」：同夹具不设替身 → outOf **不含**「git 探测异常」+ 无标记无关提交仍拦「证据无关」（防误报负例 + 行为不变复证）
  - 既有 196 断言零改动
- 装副本同步：`flow-kit sync` 刷 `.agents/scripts/check-loop.{mjs,test.mjs}` 与 `.agents/kit.json` 两个 sha256
- `workflow/papercuts.md`：2026-10-05 行「拟修」列回填「已立 incident（修复 SHA，fixed 时）」
- `workflow/regression-checklist.md`：防复发验证节追加「引擎内 spawn 基础设施异常须与业务失败区分并响亮出账（2026-10-05-gitout-fail-open）」
- **不动**：其余 20+ gitOut 业务调用点、:156 基础设施消息、非 git 仓跳过语义（exit 0）、检查 16 取数器路径、fix workflow（CI/Release yaml）

## 任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）

1. check-loop.mjs 引擎改动（env 钩子 + gitOut loud/retry + :581 同模式）
   - 判据：真仓 + `CHECK_LOOP_GIT=<不存在路径>` 手动跑 → stderr「git 探测异常」恰一条且 exit 0；正常跑零出账；`grep -c CHECK_LOOP_GIT templates/_agents/scripts/check-loop.mjs` = 1（仅 GIT 常量消费，无第三处）
   - 风险：中（主门禁引擎件；缓解——返回契约不变、20+ 调用点零接触、出账走 stderr 不改 stdout 协议）
2. check-loop.test.mjs 两新场景 + run() env 支持
   - 判据：`node templates/_agents/scripts/check-loop.test.mjs` 全绿（既有 196 + 新增断言；出账恰一次、降级语义、防误报负例全钉住）
   - 风险：低（增量场景，不动既有断言；替身=不存在路径跨平台稳定触发 r.error，无平台分支）
3. sync 刷装副本 + kit.json sha
   - 判据：`node bin/flow-kit.mjs sync` 覆盖更新 2 份；`node bin/flow-kit.mjs doctor` 13 PASS / 0 WARN / 0 FAIL（managed/owned 校验含新 sha）
   - 风险：低（机械双源同步；漏刷会被 doctor/门禁抓）
4. 稳定性循环（本单 flaky 的复现面验证）
   - 判据：本机 node 连跑 `check-loop.test.mjs` ≥50 轮 0 FAIL；CI 六矩阵后续观察（原 flake 仅 ubuntu+node22 单次，papercuts 行「再命中必立」兜底）
   - 风险：低
5. 台账回填（papercuts 拟修列 + regression-checklist 防复发节）
   - 判据：doctor 13/0/0；两处行内容含 incident 主题与修复 SHA（fixed 后）
   - 风险：低（纯文档台账）
6. 关单（test 阶段）：逐条勾验 spec 改动面并补证据 → incident fixed→closed、spec/plan done（确认门逐件 delegated）
   - 判据：L2 独立复核（independent-reviewer，基准 = plan approved 时的 HEAD）结论记入「确认与复核」节；check-loop 无新增 advisory
   - 风险：低

## 执行顺序（L2/L3 必填；L1 单文件微改动删本节）

1 → 2 → 3 → 4 → 5 → 6。依赖说明：2 依赖 1（新场景以 CHECK_LOOP_GIT 钩子为前提）；3 依赖 1–2 落盘；4 依赖 1–2；5 依赖 1（出修复 SHA 后回填）；6 收口，L2 独立复核在 6 之前执行。

## 验证计划

- 静态门：纯 JS 无构建/类型检查（根 AGENTS.md 项目适配区口径）；实际静态门 = 测试套件
- 测试：`npm test` 整跑在本机受 PowerShell 管道 OOM 与 `workflow-enums.test.mjs` 依赖 `sh` 限制（2026-10-05-host-gitignore-localonly-revoke 先例）→ 逐套件 `node <suite>` 直跑记 exit code；重点 = `templates/_agents/scripts/check-loop.test.mjs`（本单主战场）+ `src/sync.test.mjs`（sync 面）+ `.agents/scripts/check-loop.test.mjs`（装副本同文复跑）
- 契约 / 规则面比对（L2 追加）：`grep` 断言 `CHECK_LOOP_GIT` 全仓仅 check-loop.mjs GIT 常量一处消费；「git 探测异常」出账字样唯一来源为 gitOut/:581 共用 helper；`gitOut` 返回签名（string|null）未变
- 稳定性：本机 ≥50 轮 0 FAIL（任务 4）；CI 六矩阵持续观察
- 冒烟：`node bin/flow-kit.mjs doctor` 13 PASS / 0 WARN / 0 FAIL
- 独立复核：L2 推荐独立复核——关单前 `independent-reviewer`（读 `.agents/roles/independent-reviewer.md`）复核代码改动面，结论记入「确认与复核」节

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。
- 确认结果：approved（2026-10-05 用户对话内确认，原话「确认」）；done（关单时随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 推荐独立复核——关单前 independent-reviewer 复核，结论此处回填
