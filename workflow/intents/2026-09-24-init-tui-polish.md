---
状态: approved
级别: L1
日期: 2026-09-24
模块: pipeline
备注: 需求来源：2026-09-24 用户截图反馈 flow-kit init 交互「不好看」且「开发语言没有 ts/js 这样的选项」（技术栈问句现值 dotnet/node/python/go/none，node 叫法不直观）。2026-09-24 用户对话内直接要求美化 + 补选项，随报随修。定性：init 交互层 UX 改造 + 技术栈别名，不改 CLI 参数面（--stack 语义不变、新增归一别名）、不改安装产物，L1。
---

# INTENT — init 交互 TUI 美化 + ts/js 技术栈别名

## 背景与问题
`flow-kit init` 交互环节是朴素行式问答：无色彩、无菜单结构，宿主要手打 `zcode,opencode`，技术栈问句的 `node` 对 ts/js 用户不直观（截图反馈「不好看」「没有 ts/js 选项」）。同时包的卖点是零运行时依赖，不能引入 inquirer/prompts 类 TUI 库。

## 目标
- 交互问答升级为带 ANSI 色彩的序号菜单（①②③ 编号 + 暗色提示 + 分步标题），接受序号/名称混输，宿主多选逗号分隔；NO_COLOR / 非 TTY 自动降级为纯文本
- 技术栈新增 ts/js/typescript/javascript 别名，归一为 node 栈；问句展示为「node（ts/js）」；--help 同步
- 保留 makePrompt 行式问答的管道/EOF 稳健语义；确认门仍显式 y（回车取消）

## 非目标
- 不引第三方 TUI/颜色库（零依赖纪律）；不做箭头键 raw-mode 交互（牺牲管道稳健性）
- 不改 CLI 参数面与安装产物结构（--hosts/--stack/--board-port 语义不变）
- 不动 sync / add-host / add-gate / doctor 交互

## 约束
- 色彩输出 hand-rolled ANSI，尊重 NO_COLOR 与 !isTTY
- 技术栈别名表放 profiles.mjs（栈知识单源），解析/归一导出供测试

## 影响面
- 模块：pipeline
- 数据库：无

## 触达红线（对照 AGENTS.md，勾选仅标记触及范围；具体如何满足在同名 spec 中说明）
- [ ] 规则 / 契约变更（编码权威 / 共享契约 / 接口签名 / 既有参数语义 / 全局口径）→ 级别至少 L2

> 红线说明：--stack 新增别名是增量放宽（原有取值行为不变），安装产物与门禁配置不因此变化，故 L1。

## 验收标准（可测试）
- [ ] 归一与解析纯函数测试：ts/js/typescript/javascript→node；序号/名称/混输/全角逗号解析正确；非法输入返回可重问信号（证据：src/init.test.mjs 断言全过，入 npm test 套件）
- [ ] 交互全流程管道实测：printf 喂入「序号 + ts + 端口 + y」能在临时目录完成安装，recap 显示「技术栈 node」（证据：临时目录安装成功输出）
- [ ] 色彩降级：NO_COLOR=1 或非 TTY 下输出无 ANSI 转义残留（证据：管道实测输出为纯文本可读）
- [ ] 既有套件不回归：npm test 全绿（含 sync.test.mjs 与 templates 脚本套件）（证据：npm test 输出）
