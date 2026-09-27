---
状态: approved
级别: L2
日期: 2026-09-27
模块: pipeline
配对: ../intents/2026-09-27-confirm-gate-delegated.md
备注: 用户 2026-09-27 对话拍板「2选2」后起草与实现同批落地；approved 走用户 TTY 一次（新规则首单），done 走对话委托模式（新规则首例）——本单自身即两形态的交接仪式。
确认指纹: c596120a51b72831
---

# PLAN — 确认门对话委托代录模式（--delegated）

对应入口：../intents/2026-09-27-confirm-gate-delegated.md / 对应 spec：../specs/2026-09-27-confirm-gate-delegated.md

## 改动面

- `templates/_agents/scripts/confirm-doc.mjs`：
  - argv 解析加 `--delegated <原话>`（与 `--root` 同款取值方式）；空原话 exit 1 用法提示
  - TTY 门改为仅非委托模式生效（委托模式免 TTY，印代录警示横幅：台账将如实记 source=chat-delegated 与原话）
  - 主循环分叉：委托模式跳过 readline 逐份问答（直接落态记账），交互模式行为逐字节不变
  - `appendLedger` 行两形态都带 `source`（tty / chat-delegated），委托行加 `quote`；跳转/指纹/落态共用既有纯函数零改动
- `templates/_agents/scripts/confirm-doc.test.mjs`：S8 schema 断言扩展 source；新增 S11（非 TTY spawn + `--delegated "可以"` → 落态 + 指纹行 + 台账 source/quote 齐）、S13（`--delegated` 空原话 → exit 1 且零文件改动）
- `templates/_agents/scripts/check-loop.mjs`：检查 15 段注释 + 头部清单第 31 行补两形态口径（**逻辑零改动**）
- `templates/_agents/scripts/check-loop.test.mjs`：检查 15「指纹+台账配对齐」场景台账行加 source/quote 字段变体（锁定额外字段不破坏配对）
- `templates/AGENTS.md` + 根 `AGENTS.md`：确认门条目追加委托模式句（owned 双写）

## 验证方式

- 静态门：npm test 全部套件全绿（confirm-doc 13 场景含新增；check-loop 50 场景含扩展）；doctor 12 PASS；check-loop exit 0；source-sync-check 零差异
- 行为门：S9/S10（非 TTY 无 --delegated 照拒）不回归——AI 仍无法在无用户确认时伪装 TTY 确认

## 确认与复核

- 确认结果：（approved 待用户终端 TTY 一次——新规则自身首单按在位规则走；done 拟走本单引入的对话委托模式即首个正式用例）
- 确认门记录：用户 5 次要求代跑被拒（门首日实战）→ 问设计合理性 → 两选项明确拍板「2选2」→ 本单起草与实现
- 复核：L2 不强制独立复核（设计权衡与风险在 spec 风险评估节成文；台账诚实性由 S11/S13 场景机器锁定）
