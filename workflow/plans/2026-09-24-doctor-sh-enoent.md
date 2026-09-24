---
状态: approved
级别: L1
模块: pipeline
---
# PLAN — doctor sh ENOENT 误报 hard-block 修复

对应入口：../incidents/2026-09-24-doctor-sh-enoent.md

## 改动面（L1 极简形态主节）
- `src/doctor.mjs` 第 7 项：先 `spawnSync('sh', ['-c', 'true'])` 探测（对齐 run-tests.mjs 先例）——探测不过 → WARN「环境无 sh——check-loop 未跑，勿当作通过；装 Git Bash / WSL 后重跑 doctor（git 钩子门禁不受影响）」；探测过才跑 check-loop，真断档维持 FAIL + stderr 原因

## 验证方式
- 静态门：`npm test` 全绿
- 实测三态：①PATH 剥离 sh 的模拟环境 → doctor 报 WARN 不再出现「hard-block」；②正常环境 → PASS；③真断档夹具（已提交 intent 无 plan）→ FAIL 且原因（配对断裂）可见
- 闭环：本任务自己走 verify + 关单勾验

## 确认与复核
- 确认结果：approved（2026-09-24 用户截图报障随报随修，定位过程已在对话留痕，需求即确认）
- 确认门记录：改动面 = 单文件单分支分流，方案（探测分流对齐 run-tests 先例）随 incident 记录
