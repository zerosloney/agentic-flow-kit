---
状态: approved
级别: L2
模块: pipeline
确认指纹: c67aebe8b1745b41
---
# PLAN — plan-section-name-evidence

对应入口：../incidents/2026-10-04-plan-section-name-evidence.md
对应 spec：../specs/2026-10-04-plan-section-name-evidence.md

## 改动方案

- `templates/_agents/scripts/check-loop.mjs`（包源，sync 后 `.agents/` 装副本）：`verifyEvidenceTruth` 声明节名正则 `^##\s+(改动面|任务拆解)` → `^##\s+(改动面|任务拆解|改动方案)`（约 1 行），使 fill-plan 生成的 L1「改动方案」节被识别为声明文件来源
- `templates/_agents/scripts/check-loop.test.mjs`（包源，sync 后装副本）：新增用例——① plan 用「改动方案」节 + 证据 SHA 触及声明文件 → 校验通过（type=sha）；② plan 用「改动方案」节 + 证据 SHA 不触及 → 仍判 irrelevant
- `templates/workflow/plans/_TEMPLATE.md`（owned，手动同步装副本）：第 9 行注释统一口径——说明 L1 主节「改动面」与 fill-plan 输出「改动方案」均为 check-loop 合法声明节

## 任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）

1. 改 `check-loop.mjs` 节名正则
   - 判据：`verifyEvidenceTruth` 对「改动方案」节 plan 提取到声明文件；`node .agents/scripts/check-loop.test.mjs` 新增用例通过
   - 风险：低（正则只增一个分支，不改判定逻辑）
2. 改 `check-loop.test.mjs` 加正/负例
   - 判据：新增用例在 `npm test` 全绿；负例（SHA 不触及）仍判 irrelevant
   - 风险：低（纯测试新增）
3. 改 `templates/workflow/plans/_TEMPLATE.md` 注释
   - 判据：注释说明两种节名均合法；装副本同步
   - 风险：低（文档注释）
4. sync 更新装副本 + 手动同步 owned 模板
   - 判据：`source-sync-check --diff` 0 漂移；doctor owned 无漂移
   - 风险：低（双源纪律常规操作）

## 执行顺序

1 → 2 → 3 → 4（依赖：测试用例先钉住行为，再改实现，最后同步文档）

## 验证计划

- 静态门：`npm test`（含 check-loop.test.mjs 新增用例全绿）
- L2 追加：`node bin/flow-kit.mjs doctor` 0 FAIL——验证 2026-10-04-board-run-panel 的「证据无关」误报消除
- 双源：`node .agents/scripts/source-sync-check.mjs --diff` 0 差异

## 确认与复核

- 确认结果：approved（2026-10-04 用户对话内确认）；done（2026-10-04 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 不要求独立复核（用户未启用）