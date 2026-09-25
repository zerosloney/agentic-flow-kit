---
状态: done
级别: L1
模块: pipeline
备注: incident 即入口已 approved 收口；plan 极简两节（改动面 + 验证方式），与 incident 同步补齐配对闭环。规则严度参数化升级 WARN→FAIL，非规则语义变更。
---

# PLAN — doctor owned 漂移 WARN 升级 FAIL

对应入口：../incidents/2026-09-25-doctor-owned-drift-strict.md
对应 spec：../specs/2026-09-25-doctor-owned-drift-strict.md（L1 省略）

## 改动面
- `src/doctor.mjs` — 第 6.6 节 owned 漂移分支（drift + gone）输出级别 WARN → FAIL；注释更新「首次引入用 WARN / 严化 FAIL（2026-09-25 doctor-owned-drift-strict）」
- `templates/_agents/scripts/doctor.test.mjs` — 新增场景 8（8a/8b/8c）：源码层 grep 断言 owned 漂移分支 / gone 分支已用 `add('FAIL', …)`、FAIL fail-loud 路径保留
- `workflow/regression-checklist.md` — 防复发节第 8 条更新文案：「首次引入 WARN 2026-09-25 / 严化 FAIL 2026-09-25-strict」+「源码层 WARN→FAIL 严化断言」
- `workflow/incidents/2026-09-25-doctor-owned-drift-strict.md` — frontmatter 状态 open → closed + 备注键说明严化生效
- `workflow/INDEX.md` — 重生成（活跃 12 行不变，档案计数 PLAN pipeline 18 → 19）

## 验证方式
- 静态门：`npm test`（doctor.test.mjs 10/0 PASS）；`node bin/flow-kit.mjs doctor --no-color`（本仓库装副本已对齐，应 9 PASS / 0 WARN / 0 FAIL —— owned 16 份无漂移，证明严化生效但无误伤）
- L1 极简：单笔 commit 收口

## 确认与复核
- 确认结果：approved（2026-09-25 用户对话内拍板「doctor owned 漂移 WARN 升级 FAIL」）；done（2026-09-25 关单随 incident 置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（incident 即入口已 approved，plan 与 incident 同步补齐配对）