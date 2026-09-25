---
状态: done
级别: L1
模块: pipeline
备注: incident 即入口已 approved 收口；plan 极简两节（改动面 + 验证方式），与 incident 同步补齐配对闭环（pre-commit check-pairing-incremental 要求）。
---

# PLAN — doctor 加 owned 漂移校验

对应入口：../incidents/2026-09-25-doctor-owned-drift.md
对应 spec：../specs/2026-09-25-doctor-owned-drift.md（L1 省略）

## 改动面
- `src/doctor.mjs` — 文件末尾新增 export function checkOwnedDrift(target) → { drift, gone, total, skipped, error? }；主流程在第 6.5 节后插入第 6.6 节调用并输出 PASS/WARN（首次引入用 WARN 不 FAIL）
- `templates/_agents/scripts/doctor.test.mjs` — 新增 fixture 驱动测试 7 场景：对齐 / 手改 / 缺失 / 无 owned / kit.json 不存在 / 解析失败 / 多 owned 部分漂移；动态 import src/doctor.mjs 的 checkOwnedDrift
- `workflow/regression-checklist.md` — 「防复发验证」节追加第 8 条指 doctor.test.mjs 场景 1-7
- `workflow/incidents/2026-09-25-doctor-owned-drift.md` — frontmatter 状态 open → closed + 备注键说明 WARN 不 FAIL 策略
- `workflow/INDEX.md` — 重生成（活跃 13 → 14 +doctor-owned-drift incident L1）
- `.agents/scripts/doctor.test.mjs` — sync 装副本副本（managed 51 → 52）
- `.agents/kit.json` — sync 自动加 managed 项

## 验证方式
- 静态门：`npm test`（全部套件 PASS，含 doctor.test.mjs 7/0）；`node bin/flow-kit.mjs doctor --no-color`（9 PASS / 0 WARN / 0 FAIL，owned 16 份无漂移）
- 预算门：`bash .agents/scripts/rule-budget.sh --staged` exit 0
- L1 极简：单笔 commit 收口，pre-commit 闭环配对门需 plan 配对（已补本 plan）

## 确认与复核
- 确认结果：approved（2026-09-25 用户对话内拍板「继续处理遗留项」）；done（2026-09-25 关单随 incident 置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门已合一次——incident 已是修复类入口，省略 plan 草稿逐次确认；按 papercut 节奏此为最小例外）