---
状态: approved
级别: L1
模块: pipeline
---
# PLAN — 关单 verify 固定编排脚本

对应入口：../intents/2026-09-24-closeout-verify-script.md

## 改动面（L1 极简形态主节）
- `templates/_agents/scripts/verify.mjs`：新增——写死顺序 `npm test` → `sh check-loop.sh`，stdio inherit 原样透传失败原因；任一步非零即 exit 1（fail-fast）；缺 sh 环境明确报错不静默放行；`--test-cmd` 仅供测试注入红/绿路径
- `templates/_agents/scripts/verify.test.mjs`：新增 fixture 测试——绿路径（假过命令 + CHECK_LOOP_ROOT 空夹具）exit 0；红路径两态（步骤 1 假败 / 步骤 2 配对断裂夹具）exit 1；断言只落在 verify 自身标记与退出码（孙进程 inherit 输出不进管道）
- `templates/_agents/commands/test.md`：「关单」节补一行 verify 用法（关单前一键过门，非绿不关单）
- `.agents/` 装副本：`node bin/flow-kit.mjs sync` 同步，不手改

## 验证方式
- 静态门：`npm test`（verify.test.mjs 经 src/run-tests.mjs 自动入套件，全绿）
- 实跑：`node .agents/scripts/verify.mjs` 真实双步绿路径留证（本任务关单前自己走一遍）
- 闭环：workflow/INDEX.md 重生成 + check-loop 通过

## 确认与复核
- 确认结果：approved（2026-09-24 用户对话内选定范围「只做关单 verify 脚本」并回复「开工」）
- 确认门记录：intent 摘要（目标 / 非目标 / 验收 4 条 / 改动清单）经用户过目后开工确认；plan 为该验收的文件级展开，无新增决策点
