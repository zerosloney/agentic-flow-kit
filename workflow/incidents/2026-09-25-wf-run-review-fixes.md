---
状态: fixed
级别: L1
发现: 2026-09-25
模块: pipeline
备注: 2026-09-25 用户指令「审查一遍昨晚至今新加的功能」，独立复核（independent-reviewer 子智能体，52 次工具调实测）产出 1 P0 + 4 P1 + 6 P2；用户对话内拍板「照此立单修」（P0+P1 全修，P2 择廉修）。审查报告全文在对话留痕，git 历史即评审记录。
---

# INCIDENT — 2026-09-25 独立复核发现 wf-run runner P0 级缺陷（Windows .cmd prompt 截断）+ P1 批

## 时间线
- 2026-09-25 用户令审查 7a9a1fd（feat）+ 3ce4ef9（关单）；independent-reviewer 按仓库 review 标准独立复核（spec 双轴 + 实测），主智能体对两条最要害发现二次实证确认
- 结论：需修复后合入。P0-1（Windows .cmd provider 多行 prompt 截断为首行，四家内置 provider 在 Windows 全中，子智能体拿不到红线行却报 ok:true）+ P1×4（错误路径不等待在跑 agent 即退出且不写台账 / 留痕格式断言假绿 / task 含竖线致 agg-delegations 列错位 / providers.json managed 身份与「项目可覆写」契约矛盾）
- 用户拍板照此立单修；修复 = stdin 传输协议（prompt 不再进命令行）+ .cmd fail-fast 兜底 + 错误路径 settleAll + 台账竖线全角 + providers.local.json 侧车覆写 + P2 择廉批

## 影响面
- wf-run runner 全部用户（已在 7a9a1fd 合入 templates/ 与本仓库装副本）：Windows 下经 .cmd shim 的 provider 派单（npm 全局 CLI 默认形态）prompt 全丢——子智能体无任务、无授权文件、无禁 commit 红线，仍报成功并写台账「一次通过」（量化口径被污染为假绿）
- fake provider 测试全用 node.exe 直跑（非 .cmd 分支）未拦住；真实冒烟恰撞 codex 配额墙未跑通——两盲区叠加漏至复核
- 台账竖线错位仅在 task 含半角 | 时触发；错误路径留痕丢失在脚本异常 / fire-and-forget 写法时触发

## 根因
Windows .cmd shim 本质是 cmd.exe 批处理，命令行参数遇换行即截断——spawnPlan 把多行 prompt 内联进 shell 命令行的设计对该形态不成立；深层原因：fake provider 测试矩阵没有覆盖「Windows 真实 CLI 形态」（.cmd shim），防线与真实威胁形态错位。

## 为什么之前没拦住
- 23 例测试的 fake provider 全部用 process.execPath（node.exe，走 spawn 数组分支），.cmd 分支零覆盖——测试环境与真实环境形态不同构
- 真实冒烟是验收标准第 4 条，恰逢 codex 配额墙（10-01 恢复）未执行，挂 plan 遗留项——两道防线同时空缺
- P1-2 假绿：正则 `/^| 20…/` 行首未转义 `|` 构成空分支 alternation 恒真（写测试时未跑负例）

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：随本单同一提交（templates/_agents/scripts/wf-run.mjs 重写批修 + wf-run.test.mjs 正则修正与新增用例 + _TEMPLATE.md 契约文档更新 + regression-checklist 条目）
   - 影响环境：dev（包源 + 装副本同步；npm 包随下一版本发布）
   - 是否需要新 intent：否（incident 即入口，L1 无需独立 intent；含契约演进——{PROMPT} 语义收敛 + stdin 传输协议，已在 _TEMPLATE.md 成文）
2. 防复发验证
   - 自动化用例：wf-run.test.mjs 新增——⑧ 真实 .cmd shim fixture（Windows 实造 .bat/.cmd）端到端走 stdin 协议收到完整多行 prompt；内联多行 prompt 落 .cmd 分支被 fail-fast 拒绝；⑨ 脚本异常时在跑 agent 被 settle 等待并写台账；⑩ task 含半角 | 台账行经 agg 口径 split 列数正确；⑪ providers.local.json 覆写生效且不被 sync 跟踪；⑫ --concurrency/--timeout-ms 非数字 fail-fast；行格式断言修正 + 负例（垃圾串必须不匹配）
   - test 步骤：真实 provider 冒烟仍挂 plan 遗留项（codex 配额 2026-10-01 恢复后补跑）
3. 规范条目
   - 落点：workflow/regression-checklist.md「防复发验证」节追加一行
   - 引用：文件:templates/_agents/scripts/wf-run.mjs（spawnPlan stdin 协议 / fail-fast）
