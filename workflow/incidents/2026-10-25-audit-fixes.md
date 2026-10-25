---
状态: open
级别: L2
发现: 2026-10-25
模块: infra
沉淀: 无
---
# INCIDENT — 流程自审修复批（挂载自检两行口径 / incident 放弃态枚举收口 / 升级指引 / release 前置 CI）

## 症状
本仓 AI-Native 流程自审（两路子代理盘点 + 实战亲历）发现四处实现级不一致：
① confirmations.d 分片的 .gitattributes 第二行缺失无门可验——glob 不跨目录，本仓自身即处于
分片合并退化文本冲突态（workflow/README:74 两行口径 vs 根 README/ARCHITECTURE/挂载门一行口径）；
② confirm-doc 允许 incident→superseded/cancelled（测试钉死）而枚举单源 incident.status.all 不含
——落盘即检查 3「状态非法」WARN 永不可消退，违背「无不可消除噪声」红线；
③ deploy-observations 主表属 owned、sync 不装，deploy.md 指针在存量装户悬空，README 迁移指引未覆盖；
④ release.yml 不依赖 CI 结果——ci.yml 红后 tag 照常发布（1.8.11 首推实录）。

## 根因
1. 分片默认（2026-10-13）时 glob 不跨目录的边界未传导到门判据与三处文档
2. incident 放弃态跳转（--to 通道）与枚举单源两条线各自演进，无对账面
3. owned/managed 分类设计正确，缺的是「managed 指向 owned 件」的升级指引条目
4. release 与 ci 两条 workflow 无依赖接线

## 防复发
1. 门判据与迁移指引同批改（判据单源 check-local-gate-config；口径统一两行）
2. 枚举收口方向记入 workflow-enums.txt 注释：incident 补 abandoned 键、all 扩全集、入口确认集排除 abandoned（与 doc 侧对称）
3. 「managed 指向 owned 件」新增时迁移指引必须随批（README 存量装户迁移指引节）
4. release 前置 CI conclusion 门（gh api 查 HEAD run）——CI 红不发布

## 时间线
- 2026-10-25 用户确认：继续修（自审问题清单修复授权，对话内）

## 验收标准（可测试）
- [ ] 场景：R1 挂载自检验两行 gitattributes（缺任一行 WARN/--strict 拦）（证据：check-local-gate-config.test）
- [ ] 场景：R2 incident superseded/cancelled 不再出「状态非法」WARN（证据：check-loop.test 扩展用例）
- [ ] 场景：R3 入口确认集仍排除 incident 放弃态（stage-gates 对称性）（证据：stage-gates 行为不回归）
- [ ] 场景：R4 release 前置门（CI 非 success 即拒）（证据：release.yml 步骤 + yml 语法过 workflows-check）
- [ ] 场景：R5 README 迁移指引含 deploy-observations（证据：文档批提交）
- [ ] 场景：R6 全量测试绿 + verify 八门绿（证据：npm test + verify --doc）
