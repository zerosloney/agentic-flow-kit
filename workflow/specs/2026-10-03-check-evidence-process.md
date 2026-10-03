---
状态: approved
级别: L2
日期: 2026-10-03
模块: pipeline
备注: 关联 intents/2026-10-03-check-evidence-process.md（approved）
确认指纹: c3226c55c6bedd5b
---
# SPEC — check-evidence-process

## 功能行为

检查 8 的证据语义核验（verifyEvidenceTruth）新增一类放行形态：

- 判定位置：git show --name-only 得 changedFiles 与 plan 声明文件无交集、即将判 irrelevant 处，先做过程证据探测：
  `spawnSync(GIT, ["log", "-1", "--format=%s", sha])` 取提交信息首行，匹配 /pipeline-run [0-9]{8}-[0-9]{4}-[A-Za-z0-9-]+/（runId 严格形态：日期8位-时间4位-主题-尾——docsCommit 四种提交格式共有段）→ 返回 `{ ok: true, type: 'process' }`；不匹配 → 维持原 irrelevant 判定。（实现披露 2026-10-03：首版判据 `/（pipeline-run [A-Za-z0-9-]+）/` 只认全角括号紧邻形态，L0 提交格式「（L0，pipeline-run <runId>）」不匹配——实测 37b552a 未放行后收紧为 runId 严格形态，覆盖执行器全部提交格式且防蹭更强。）
- 顺序与不变量：forged 判定（SHA 不存在）在前、不受影响；process 只救 irrelevant，不放松任何既有拦截；plan 缺失（no-plan）与外部引用（external）分支不动。
- 输出语义：放行不打 warning（与 sha/text 同级静默）；blocker 文案不变。
- 用户场景：done 档验收证据引用执行器驱动的提交（如 37b552a）→ 原 hard-block，新判据下放行；引用普通无关提交（无标记）→ 仍 hard-block；引用不存在 SHA → 仍 forged hard-block。

## 数据流

check-loop 检查 8 扫 done intent 验收节 → 证据行含疑似 SHA → rev-parse（存在性）→ plan 声明文件比对 →（新）无交集时 git log 提交信息标记比对 → 判定（process 放行 / irrelevant 拦）。新增一次 git log 子进程调用（仅无交集路径触发，秒内）。

## 系统改动

- `templates/_agents/scripts/check-loop.mjs`：verifyEvidenceTruth 增 process 分支（约 +8 行）+ 判据注释；
- `templates/_agents/scripts/check-loop.test.mjs`（夹具现场 git init 建仓，已核实）：+3 用例（有标记放行 / 无标记仍拦 / 不存在 SHA 仍拦）；
- `workflow/regression-checklist.md`：防复发条目一行（勾验后、done 前必须重跑 check-loop——本次事件顺序教训的轻落点）；
- sync 装副本随批。

## 约束遵守映射

- 双源纪律：改包源 templates/ 再 sync ✓；不触装副本直改。
- 门禁纪律：不放松既有拦截（forged/irrelevant 判据仅新增放行分支）✓；检查 15 不动 ✓。
- 测试覆盖（check 20）：check-loop 既有测试套件随批扩充 ✓。
- 常驻面预算：regression-checklist（workflow/ 非 .agents 常驻面）不触预算 ✓。

## 风险评估

- 判据被蹭（普通提交塞 pipeline-run 字样）：低——git 提交信息本身入库留痕，蹭标记等同伪造提交信息，事后 git 历史可对质；forged 线不受影响。
- 子进程开销：低——仅无交集路径多一次 git log。
- 回滚：删分支即回原判据，纯增量。

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核；本改动面极小（+8 行判据+3 测试），用户可择免，关单前 test 阶段拍板
