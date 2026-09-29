---
状态: done
级别: L2
日期: 2026-09-29
模块: pipeline
备注: 用户 2026-09-29 对话「可以」确认本 plan。同名 intent ac64e65、spec 823565b 已 approved。
确认指纹: e7de65256623ea37
---
# PLAN — 发版树上的未收口文档

对应入口：../intents/2026-09-29-release-unclosed.md
对应 spec：../specs/2026-09-29-release-unclosed.md

## 改动面（L1 极简形态主节；L2/L3 可作任务拆解的汇总或删本节）

- `templates/_agents/scripts/policy.mjs`：`POLICIES` 增加版本 2
- `templates/_agents/scripts/check-loop.mjs`：检查 17 的状态组合与版本锚
- `templates/_agents/scripts/check-loop.test.mjs`：夹具
- `src/init.mjs`、`src/fresh-init.test.mjs`：新装 `policyVersion` 改为 2
- `.agents/kit.json`、`workflow/README.md`：本仓生效版本改为 2
- sync 更新装副本

## 任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）

1. 回放已写入同名 spec。实现前不再改锚。
   - 判据：spec 里 0.6.0、0.7.0、0.8.0 的名单与再跑一次的结果一致
   - 风险：低
2. `POLICIES[2]` 复制版本 1 的五个日期键，并加 `check17UnclosedAfter: '0.8.0'`。
   - 判据：未知 `policyVersion` 仍得到版本 1；版本 2 的五个日期与版本 1 相同
   - 风险：中（漏键会改动其他检查的生效日）
3. 检查 17 按 spec 的状态表阻断。阻断句仍含「发版草稿」。
   - 判据：intent 的前五条验收在临时仓库里成立；既有三条检查 17 用例不回退
   - 风险：高（把 draft 仍是 draft 也放进版本锚，会让旧夹具变绿）
4. `init` 新装写 `policyVersion` 2，本仓 `kit.json` 与 `workflow/README.md` 改为 2。
   - 判据：`fresh-init.test.mjs` 断言 `policyVersion === 2` 且 `audit === false`
   - 风险：低
5. sync。
   - 判据：`policy.mjs` 与 `check-loop.mjs` 在 source-sync-check 下无漂移
   - 风险：低

## 执行顺序（L2/L3 必填；L1 单文件微改动删本节）

1 已完成于 spec。2 → 3 与测试一起写 → 4 → sync → `npm test`。规则提交不包含历史文档的关单。

## 验证方式

- 静态门：`node templates/_agents/scripts/check-loop.test.mjs` 与 `node src/fresh-init.test.mjs`
- 不测浏览器页面

## 确认与复核

- 确认结果：approved（2026-09-29 用户对话原话「可以」，仅本份）
- 复核：L2 独立复核已执行（独立上下文，基准 `894cf8c` → `fc1ceff`）。未发现阻断问题，无 P0/P1/P2。
- 关单：done（2026-09-29 用户对话原话「可以」，仅本份）
