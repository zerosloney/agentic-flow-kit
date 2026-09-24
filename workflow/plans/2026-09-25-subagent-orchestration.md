---
状态: draft
级别: L2
模块: pipeline
备注: plan 草稿随入口文档同提（配对门口径）；spec 确认通过后本 plan 才过确认门（draft → approved），未确认前仅可 --dry-run。
---

# PLAN — 脚本化子智能体编排（workflow 脚本 + runner）

对应入口：../intents/2026-09-25-subagent-orchestration.md
对应 spec：../specs/2026-09-25-subagent-orchestration.md（L2，确认后方可执行本 plan）

## 任务拆解

1. runner + 编排面：`templates/_agents/scripts/wf-run.mjs`
   - 判据：`wf.agent` / `wf.gate` / `wf.parallel` / `wf.log` 全语义实现；provider 解析（argv 标准 + 字符串兼容 + deep-merge 覆写 + PATH 缺失明确报错）；prompt 组装（角色契约 + 派单头 + 红线行）；汇总表 + 退出码 + delegations.md 追加行与既有列格式一致；`wf-run.test.mjs` fake provider 全链路绿（串行 / 并发上限 / gate 失败中止 / retries / 留痕行格式 / --dry-run 校验拒非法脚本）
   - 风险：中（spawn 跨平台行为——argv 数组不走 shell 规避；Windows 本机实跑用例）
2. workflows 目录：`templates/_agents/workflows/` 三件
   - 判据：`_TEMPLATE.md`（API 契约 + 信任边界 + provider 覆写法）＋ `示例-并行实现评审.mjs`（`--dry-run` 校验通过）＋ `providers.json`（内置三家）；init fixture 装户后 `.agents/workflows/` 与 runner 存在
   - 风险：低
3. 引用面：`templates/AGENTS.md` 一行引导 + `templates/_agents/commands/build.md` 子代理调用约定节一行
   - 判据：pre-commit 规则面预算门通过（AGENTS.md +≤150B / build.md +≤250B）
   - 风险：低
4. 双源同步 + 真实冒烟：`node bin/flow-kit.mjs sync`；本仓库 zcode provider 实跑最小 workflow（单 agent 单 gate）
   - 判据：sync 台账 new 落齐无漂移；冒烟产出汇总表 + delegations 留痕行
   - 风险：中（真实 CLI 认证/语法——冒烟即校准点，命令模板覆写兜底）

## 执行顺序

1 → 2 → 3 → 4（runner 是目录示例与冒烟的前置；3 可与 4 并行）

## 风险评估

见 spec §风险评估（spawn 差异 / 无沙箱信任边界 / 并发返工 / 留痕格式漂移，均有对应应对与用例）

## 验证方式

- 静态门：`npm test` 全绿（含新增 wf-run.test.mjs）
- 预算门：pre-commit 规则面预算（AGENTS.md / build.md 增量）
- 冒烟：zcode provider 实跑最小 workflow，delegations 留痕可被 agg-delegations.cjs 聚合
- 闭环：test 阶段逐条勾验 intent 验收标准后关单

## 遗留项

- provider JSON 结构化输出解析、TS 方言支持——需要时另立 intent
- 并发扩容（>2）按 delegations.md「并发扩容门槛」量化数据拍板，不在本单

## 确认与复核

- 确认结果：（待——spec 确认后本 plan 草稿全文过目，approved 后方可动代码）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）
