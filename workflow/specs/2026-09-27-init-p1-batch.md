---
状态: done
级别: L2
日期: 2026-09-27
模块: pipeline
备注: 同名 intent：../intents/2026-09-27-init-p1-batch.md（init 审查 P1×4 收口）
确认指纹: fe50ecc36e81b295
---
# SPEC — init-p1-batch

## 功能行为

### P1-1 POSIX 钩子执行位

- **renderTree**（src/render.mjs）：目标 rel 以 `.githooks/` 开头的文件以 `{mode: 0o755}` 落盘（init 装配路径即覆盖）；
- **sync**（src/sync.mjs）：managed 恢复/覆盖/新增路径对 `.githooks/*` 在 copyFileSync 后补 `fs.chmodSync(p, 0o755)`；
- **本仓源**：`git update-index --chmod=+x .githooks/*`（克隆即 100755，tarball 经 pacote 尊重 git mode）；
- **doctor §3 强化**（编号不动，节内扩展）：非 win32 平台对 `.githooks/*` 逐个校验 `statSync(p).mode & 0o111`，任一缺执行位 → FAIL（失效可发现）；win32 跳过（mode 无语义，沿既有 §3 只查配置值）。

### P1-2 init 时序缺陷

init step 7 生成器首跑完成后、step 8 doctor 前，对生成器目标（`wiki/INDEX.md`、`wiki/知识沉淀总览.html`、`workflow/INDEX.md`，按 owned 在册者）以 LF 归一 sha 重刷 kit.owned 条目并重写 kit.json——doctor §6.6 对账即绿，进程 exit 0。

### P1-3 目标侧脚本执行防线（供应链）

新增共享助手（src/render.mjs 导出）：`renderPkgText(pkgRoot, rel, vars)` —— 读 `templates/_agents/<rel 去前缀>.md|.mjs` 模板 → LF 归一 → `renderContent(vars)`（脚本无占位符时即原文）。
三命令在 spawn 目标侧脚本（`.agents/scripts/*.mjs`）前调用防线：

- **init**（step 7 两处 runNode）：目标文件（含保守跳过的预置件）与包源渲染值 sha（LF 归一双侧）一致才执行；失配 → 跳过执行 + 打印 `⚠️ 目标侧 <rel> 与包源渲染值不符，跳过执行（供应链防线——目标目录预置脚本不可信）`；
- **sync**（收尾两处 runNode）：同防线（vars 即 sync 既有 vars）；
- **doctor**（§6 gen-workflow-index --check、§6.5 agg-delegations、§6.8 workflows-check、§7 check-loop 四处）：失配 → 该节记 `WARN 跳过（目标侧脚本与包源不符，供应链防线）`，不执行不下 FAIL 结论（fail-visible，不静默）；
- doctor 侧 vars 从 kit.json options 重建（`{BOARD_PORT, ...pickStackVars(stack)}`，与 sync 同源构造）。
- **README.md**（仓库根）补一段威胁模型：勿在不可信仓库运行 init/doctor/sync；防线语义（只执行与包源渲染值一致的目标侧脚本）。

### P1-4 记账口径统一（+ add-gate rider）

- **init**：`agentsMergedSha`（AGENTS.md 追加合并后）与 owned 各记账点全部改 LF 归一 sha（与 doctor §6.6 / sync ownedSha 同函数口径）；
- **add-gate**（src/add-gate.mjs:80,84）：hooks 记账两处同口径归一（closing-coverage 复核 P2-2 点名的同族缺口，随批 rider）。

## 数据流

- P1-1：render/sync 落盘即带执行位；doctor §3 读 statSync mode（POSIX）。
- P1-3：`renderPkgText(pkgRoot, rel, vars)` → sha ↔ 目标盘面（LF 归一）sha → 一致才 spawn；无中间状态。
- P1-2/P1-4：owned 记账一律 `readFileSync(p,'utf8').replace(/\r\n/g,'\n')` 后 sha。

## 系统改动

| 件 | 改动 |
|---|---|
| src/render.mjs | renderTree hook 落盘 0755；新增 `renderPkgText` 导出 |
| src/init.mjs | step 7 后 owned 重刷重写 kit.json；两处 runNode 前防线；记账点 LF 归一 |
| src/sync.mjs | copyFileSync 后 hook chmod；两处 runNode 前防线 |
| src/doctor.mjs | §3 执行位检查（非 win32）；§6/§6.5/§6.8/§7 四处 spawn 前防线（vars 重建） |
| src/add-gate.mjs | 记账两处 LF 归一 |
| README.md（仓库根） | 威胁模型 + 防线说明一段 |
| .githooks/*（本仓） | git index 置执行位 |
| 测试 | src/init.test.mjs / doctor.test.mjs 增场景（mode 断言 / 防线跳过 / owned 归一）；临时目录实测三件套在 plan 验证节 |

## 约束遵守映射

- **检查项编号不动**：doctor §3 节内扩展，无新 §；gate-checklist PAIRS 零改动。
- **与 closing-coverage 六处口径同族**：防线与记账均 LF 归一双侧。
- **保守跳过语义不变**：预置文件仍不覆盖（render force 语义不动）——只加「不执行」防线。
- **win32 无执行位语义**：§3 新检查平台分支，Windows 行为零变化。
- **README 为仓库自有件**（不进 templates 分发面；装户 README 属 P2 另议）。

## 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 防线误伤合法本地化脚本（装户手改 .agents 脚本后 doctor 大面积跳过） | 中 | 跳过显式 WARN 可见（非静默）；手改 managed 本就违 doctor §4 口径；跳过不产生假绿（无结论 ≠ 通过） |
| chmodSync 在非 POSIX 文件系统（FAT/网络盘）不支持 | 低 | try/catch 包裹，失败降级提示不中断安装 |
| doctor §7 防线跳过后 check-loop 结论缺失，装户漏检 | 低 | WARN 显式列出；CI（本仓）跑的是包源校验过的脚本不受影响 |
| init owned 重刷漏目标（未来新增生成器目标） | 低 | 以「owned 在册 ∩ 生成器已知目标集」枚举，注释提示新增生成器时同步 |
| POSIX 实机未验证（本机 Windows） | 中 | 代码路径 + git index 位 + tarball mode 实证；复核标注未验证范围，发布前建议 Linux CI 跑一轮（ci.yml 已有 ubuntu 腿） |
| 回滚 | 低 | 单 feat 提交 revert 即回 |

## 确认与复核

- 确认日期：
- 复核：L2 推荐独立复核（independent-reviewer，diff 固定后）
