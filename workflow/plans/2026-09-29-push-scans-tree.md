---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 plan。同名 intent e8bdf04、spec 05c4a0e 已 approved。
确认指纹: d6eec4e5dfbf0002
---
# PLAN — push 扫描被推送的那棵树

对应入口：../intents/2026-09-29-push-scans-tree.md
对应 spec：../specs/2026-09-29-push-scans-tree.md

## 任务拆解

1. `check-loop.mjs` 增加 `--rev` 与修订读层。不带参数的读取路径不改。
   - 判据：同名 spec 的六条行为在临时仓库里成立；`CHECK_LOOP_ROOT` 与 `--rev` 同现时 exit 1。
   - 风险：高（读层要盖住全部仓库文件读取，漏一处就会让脏工作区改变结论）
2. `pre-push` 按 stdin 逐行调用 `--rev`。全 0 的本地 sha 不调用。无行时仍无参数跑一次。
   - 判据：两行 stdin，一行全 0、一行树有配对断裂，钩子非零；两行都全 0 时钩子为 0。
   - 风险：中
3. 新增 `check-loop-rev.test.mjs`，并断言 `src/doctor.mjs` 调用扫描时没有 `--rev`。
   - 判据：`npm test` 含该套件且既有 `check-loop.test.mjs` 仍通过。
   - 风险：低
4. sync 装副本。
   - 判据：钩子与 `check-loop.mjs` 在 source-sync-check 下无漂移。
   - 风险：低

## 风险评估

- 修订读层与检查 11 的临时目录导出容易漏文件。应对：第一例必须是「好提交 + 脏工作区」exit 0。
- 本 plan 为了让 intent 能过配对钩子而先落盘。确认顺序仍是 spec 先于本文件。

## 执行顺序

1 → 3 与 1 一起写测试 → 2 → 跑套件 → sync。

## 遗留项

- 检查 17 扩到 approved、委派台账、拆分 check-loop 不在本 plan。
- 不扫远端与本地之间的祖先提交。

## 验证方式

- 静态门：`node templates/_agents/scripts/check-loop-rev.test.mjs` 与既有 `node templates/_agents/scripts/check-loop.test.mjs`
- 钩子用例在同一新套件里用临时仓库喂 stdin，不依赖真实远端

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
- 复核：L2 独立复核已执行（独立上下文，基准 `e081bde` → `2841d4d`）。未发现阻断问题，无 P0/P1。P2×2 已采纳：仓库外 `--rev` 改为退出码 1 并打印 sha；补上 stdin 先好后坏、断档不在当前 HEAD、索引漂移与常驻面预算只认被推送提交。提交 `fcf82c7`。
- 关单：done（2026-09-29 用户对话原话「可以」，仅本份）
