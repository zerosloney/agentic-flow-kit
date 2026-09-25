---
状态: done
级别: L1
日期: 2026-09-25
模块: pipeline
备注: 审查报告改进方向第 3 条。L1 极简两节（改动面 + 验证方式）。
---

# PLAN — 状态/级别枚举单源化

## 改动面

1. **新增 `templates/_agents/workflow-enums.txt`**：8 键（doc.status.all/confirmed/active/terminal/abandoned + incident.status.all/active + level.all），`key=value value` 纯文本（sh 可 sed / node 可 parse，沿 modules.txt 先例）。
2. **新增 `templates/_agents/scripts/workflow-enums.mjs`**：`parseEnums`（坏行/重复键/重复值抛错）+ `validateEnums`（子集不变量 + active∩terminal=∅ + approved∈confirmed/done∈terminal）+ `loadEnums`（缺文件抛错）+ 模块级 `ENUMS`。
3. **新增 `templates/_agents/scripts/workflow-enums.test.mjs`**：真实文件解析/不变量、坏数据 fail-loud、缺文件 fail-loud。
4. **check-loop.sh（templates 侧）**：启动段一次读 4 键预生成 case 模式（PAT_DOC_CONFIRMED / PAT_INCIDENT_STATUS / PAT_LEVEL / PAT_DOC_ABANDONED，零 per-call fork）；缺文件/缺键 exit 1；`st_ok_doc`、incident 状态、incident 级别词表、L3 放弃豁免四处换用。
5. **workflow-board-server.mjs**：STATUS_ENUM / PLAN_TERMINAL / L3 放弃豁免改 `ENUMS`。
6. **kb-search.mjs / gen-workflow-index.mjs**：`ACTIVE_STATUS = doc.status.active ∪ incident.status.active`；INDEX HEADER 活跃口径行改动态渲染。
7. **fill-{intent,plan,spec}.mjs ×3**：`LEVELS = ENUMS['level.all']`。
8. **check-loop.test.sh**：`mkfix()` 补写单源文件（内联 8 键，fixture 自包含）；新增场景「缺单源文件 → exit 1 + 关键词」。
9. **src/doctor.mjs §2**：布局清单 + `.agents/workflow-enums.txt`。
10. **templates/workflow/README.md**：文档协议段补「枚举单源」一句（owned 起步文档，仅模板侧）。
11. **sync + 手动 cp**：台账内（check-loop.sh/.test.sh、kb-search、gen-workflow-index、board-server）sync 自动覆盖；未入台账（fill-*×6）手动 cp。

## 验证方式

- `check-loop.test.sh`（当时为 sh 套件；2026-09-26 check-loop-node 迁移后为 `node .agents/scripts/check-loop.test.mjs`）：35 场景全绿（34 既有 + 1 新 fail-loud）。✅（证据：实跑 37/0——34 既有 + 缺文件/缺键/CRLF 3 新场景；另修实现 1 次：case 变量模式 POSIX 不成立 → in_set 内建成员测试）
- `node templates/_agents/scripts/workflow-enums.test.mjs` 全绿；`npm test` 全套件绿。✅（证据：12/0 + npm test 20 套件「全部套件通过」）
- 消费方字面量清零：`grep -n superseded` 仅剩注释/prose。✅（证据：11 处命中全为告警文案与生成注释模板）
- `node bin/flow-kit.mjs sync` 后 `source-sync-check --diff` 0 差异；doctor 0 FAIL；gen-workflow-index `--check` 无漂移（INDEX 内容不变）。✅（证据：无差异 / 11 PASS 0 FAIL / INDEX 无漂移）

## 确认与复核

- 确认结果：approved（2026-09-25 用户对话内确认「继续，改进方向 3」）
- 确认时间：2026-09-25
- 复核：L1 不要求独立复核；关单勾验见同名 intent
