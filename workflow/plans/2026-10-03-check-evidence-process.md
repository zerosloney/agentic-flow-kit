---
状态: approved
级别: L2
模块: pipeline
确认指纹: 077998b852329f44
---
# PLAN — check-evidence-process

对应入口：../intents/2026-10-03-check-evidence-process.md（approved）
对应 spec：../specs/2026-10-03-check-evidence-process.md（approved）

## 改动方案

- templates/_agents/scripts/check-loop.mjs：verifyEvidenceTruth 在 hasIntersection 为 false 处（现 :610-612）先探测提交信息——spawnSync(GIT,["log","-1","--format=%s",sha])，匹配 /（pipeline-run [A-Za-z0-9-]+）/ → return {ok:true,type:'process'}；不匹配维持 irrelevant。+判据注释（来源 intent 防复发节）
- templates/_agents/scripts/check-loop.test.mjs：+3 场景（git init 夹具造真实提交：提交信息带标记+改动面外文件 → exit 0 放行；无标记同形态 → 拦；证据 SHA 不存在 → forged 拦）
- workflow/regression-checklist.md：防复发一行（勾验后 done 前必须重跑 check-loop；证据引用外部提交须带执行器标记方可作过程证据）
- 收尾：bin/flow-kit.mjs sync 装副本入台账

## 任务拆解

1. 判据分支 + 3 测试场景
   - 判据：templates 侧 check-loop.test.mjs 含新 3 场景全绿、既有场景零回归；真实仓 node .agents/scripts/check-loop.mjs exit 0（37b552a 放行）
   - 风险：低（纯增量分支）
2. regression-checklist 行 + sync + 全量门
   - 判据：npm test 全部套件通过；verify.mjs 全绿；doctor 0 FAIL；source-sync-check --diff 0 命中
   - 风险：低

## 执行顺序

1 → 2；随后 p2-pool-batch3 incident 全量绿背景下两跳关单（fixed→closed，plan 同步 done）。

## 验证计划

- 静态门：npm test（全部套件）+ verify.mjs + doctor + source-sync-check --diff
- 契约比对：spec 三不变量逐条对实现（forged 在前/process 仅救 irrelevant/no-plan 与 external 不动）

## 确认与复核

- 确认结果：approved（2026-10-03 用户对话内确认）；done（2026-10-03 关单，随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门）
- 复核：改动面极小（+8 行判据+3 场景+1 行清单），独立复核由用户在 test 阶段拍板是否补
