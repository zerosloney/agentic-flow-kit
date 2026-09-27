---
状态: done
级别: L1
日期: 2026-09-27
模块: pipeline
备注: 随报随修回溯单（先例 2026-09-25-fix-double-source-drift）：欠账由 2026-09-26 审查发现、记于 incident 2026-09-26-check-loop-review-fixes 备注「另行立项」，本单即该立项。用户指令「收口」授权执行；2026-09-27 起 TTY 确认门生效，本单按 check 15 走 confirm-doc.mjs 用户终端确认。
确认指纹: 6fbf8abf3b6448f3
---

# INTENT — sync-hosts 适配层欠账清零（12 对命令漂移 + 6 份缺失适配）

## 背景与问题
- 2026-09-26 双轴审查发现 B-b 欠账两类：① 12 对命令正文漂移——build / design / maintain / plan / review / test × opencode+trae，09-25/26 多次改权威源命令（human 确认门、check-loop 迁移、填空工具嵌入等）后未跑 `sync-hosts --apply`；② 6 份缺失适配——gate-checklist / source-sync-check / sync-hosts 三个 helper 命令 09-25 新增权威源时未建 opencode / trae 薄适配（apply 不自动创建是 B-b 设计）
- 危害：装户经 add-host 补装到的适配层落后权威源一个或多个版本；sync-hosts --diff 长期非零漂移，「漂移=待同步」信号失真

## 目标
- 欠账清零：12 对滞后适配 apply 归位 + 6 份缺失适配创建（宿主特化 frontmatter + 权威源正文段，applyForward 同款拼装）
- 终态判据：`sync-hosts --diff` 报「正文对齐 34 对 / 无漂移 ✅」（权威源缺失 0、正文漂移 0）

## 非目标
- 不改任何权威源正文（templates/_agents/commands/ 零改动）
- 不动 omp / zcode（pairsFor 命令映射只及 opencode / trae）
- 不改 apply「不自动创建薄适配」的设计（创建须人审 frontmatter，本次即按此手工建）

## 约束
- **方向安全先行**：apply 前须证 12 对均为「适配滞后」而非「适配手改」——薄适配当前正文（行尾归一化）与权威源 git 全历史版本正文 sha 比对，历史命中 = 单向 apply 安全；任一未命中即停，单独研判
- 权威源正文字节保真（不重排行尾 / 不重排内容）

## 影响面
- `modules/hosts/opencode/commands/`：3 份 apply 归位 + 3 份新建
- `modules/hosts/trae/commands/`：3 份 apply 归位 + 3 份新建
- npm 包随下一版本发布后经 add-host 补装路径惠及装户；本仓库引擎双源面（templates/_agents ↔ .agents）零改动

## 触达红线
- 无（不动契约 / schema / 门禁判定；纯正文同步与适配文件创建，纯 JS 仓库无迁移）

## 验收标准（可测试）
- [x] 方向判定：12 对薄适配正文均命中权威源 git 历史版本（行尾归一化 sha 比对），apply 方向安全（证据：临时脚本实跑输出 12/12「滞后（历史命中，apply 安全）」——脚本用后即删，比对口径与 sync-hosts bodySha 同源 + \r\n 归一）
- [x] `sync-hosts --apply` 后 `--diff` 终态：正文对齐 34 对 / 权威源缺失 0 / 正文漂移 0（证据：apply 输出「同步后正文对齐：34 对；权威源缺失：0；正文漂移：0」+ 复核 diff「无漂移 ✅」）
- [x] 6 份缺失适配创建齐：opencode 三份（仅 description frontmatter）+ trae 三份（name: wf-X + description），正文段 sha 与权威源一致（证据：34 对对齐计数含新增 6 对；frontmatter 按既有宿主样板）
- [x] 全门绿：npm test 全部套件通过 + doctor 12 PASS / 0 WARN / 0 FAIL + check-loop exit 0（证据：实跑输出，2026-09-27）
- [x] 流程留痕：delegations 自做一行 + INDEX 重生成（证据：workflow/delegations.md 自做任务结果表 + workflow/INDEX.md 活跃层含本单）
