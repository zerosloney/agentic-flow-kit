---
状态: done
级别: L1
模块: pipeline
---
# PLAN — init 交互 TUI 美化 + ts/js 技术栈别名

对应入口：../intents/2026-09-24-init-tui-polish.md

## 改动面（L1 极简形态主节）
- `src/profiles.mjs`：新增 `STACK_ALIASES` 表（ts/js/typescript/javascript→node，栈知识单源）
- `src/init.mjs`：interactive() 重写为序号菜单问答——hand-rolled ANSI（NO_COLOR/!isTTY 降级）、分步标题、序号/名称混输、非法输入就地重问；导出 normalizeStack/parseChoices 供测试；确认前加已选 recap 行
- `src/cli.mjs`：--help 的 --stack 行补「node（ts/js）」与别名说明
- `src/run-tests.mjs`：nodeSuites 增补 `src/init.test.mjs`（对齐 sync.test.mjs 挂法）
- `src/init.test.mjs`：新增——归一/解析纯函数断言（别名、序号、混输、全角逗号、非法输入）

## 验证方式
- 静态门：`npm test`（新测试入套件，全绿）
- 实测：printf 管道喂答案，临时目录跑 `flow-kit init` 交互全流程（含 NO_COLOR 降级观察）
- 闭环：本任务自己走 verify + 关单勾验

## 确认与复核
- 确认结果：approved（2026-09-24 用户截图反馈随报随修——「美化这个 tui」+「开发语言没用 ts/js 这样的选项」，需求即确认）；done（2026-09-24 关单，随入口文档置终态）
- 确认门记录：改动面 = 反馈两项的直接展开，方案要点（零依赖手写 ANSI + 序号菜单 + 别名归一 node）随 intent 记录
