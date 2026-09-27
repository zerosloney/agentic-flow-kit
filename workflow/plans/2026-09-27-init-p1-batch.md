---
状态: done
级别: L2
模块: pipeline
确认指纹: eda4c4065cef0622
---
# PLAN — init-p1-batch

对应入口：../intents/2026-09-27-init-p1-batch.md
对应 spec：../specs/2026-09-27-init-p1-batch.md

## 改动面

- `src/render.mjs`：renderTree 对 `.githooks/*` 落盘 mode 0755；新增 `renderPkgText(pkgRoot, rel, vars)`（模板 → LF 归一 → 渲染文本，供防线比对）
- `src/init.mjs`：step 7 生成器后重刷 owned（LF 归一）重写 kit.json；两处 runNode 前防线；agentsMergedSha 与 owned 记账点全归一
- `src/sync.mjs`：hook 文件 copyFileSync 后 chmodSync（try/catch 降级）；两处 runNode 前防线
- `src/doctor.mjs`：§3 执行位检查（非 win32，FAIL）；§6/§6.5/§6.8/§7 四处 spawn 前防线（失配 WARN 跳过）+ vars 从 kit options 重建
- `src/add-gate.mjs`：记账两处 LF 归一（rider）
- `README.md`（仓库根）：威胁模型 + 防线一段
- `.githooks/*`：git index 置执行位（update-index --chmod=+x）
- 测试：init.test / doctor.test 增场景（hook mode 断言、防线跳过断言、owned 归一断言）

## 任务拆解

1. **T1 P1-1 执行位**（render mode + sync chmod + 本仓 index 位 + doctor §3）
   - 判据：临时目录 init 后 `ls -l`/statSync mode 断言 0755（win32 下断言 chmod 不炸）；git ls-files -s 全 100755；doctor §3 平台分支测试
   - 风险：中（POSIX 实机未验证——实证到代码+index 位为止）
2. **T2 P1-2+P1-4 记账与时序**（init owned 重刷 + 归一 + add-gate rider）
   - 判据：临时目录 fresh init → doctor 0 FAIL exit 0；预置 CRLF AGENTS.md 的目标 init → §6.6 0 FAIL
   - 风险：低
3. **T3 P1-3 防线**（renderPkgText + 三命令接线 + README）
   - 判据：预植恶意 gen-workflow-index 实测 ×3（init/doctor/sync 均不执行、有提示、无标记文件）；正常路径（脚本与包源一致）三命令行为不变
   - 风险：中（误伤面——跳过均显式 WARN）
4. **T4 收口**（全套回归 + 克隆四门 + feat 提交）
   - 判据：npm test 全绿；本仓 doctor 0 FAIL / advisory 不增；克隆四道门绿
   - 风险：低

## 执行顺序

T1 → T2 → T3 → T4（T1/T2/T3 部分共享 render.mjs，串行最稳）。

## 验证方式

- 静态门：npm test 全套；doctor 0 FAIL；check-loop advisory 不增；克隆四道门
- L2 追加：三件套实测留证（fresh init exit 0 / 恶意预植 ×3 / CRLF 合并）；git ls-files -s 位断言；防线正常路径回归（本仓 doctor 不劣化）
- 回滚：单 feat 提交 revert 即回

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节，done 只在关单出现。
- 确认结果：approved（2026-09-27 用户对话内确认，confirm-doc --delegated 代录「可以」）；done（2026-09-27 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
- 复核：L2 推荐独立复核（independent-reviewer；采纳/驳回由用户定性）
