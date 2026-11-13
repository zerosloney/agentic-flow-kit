---
name: eval
description: 盲评技能/提示词改动——A/B 两臂、同模型同上下文、已知答案任务集，算命中率与 Δ；供「这个技能改动真的有用吗」时使用。
---

# eval — 盲评改动

## 触发

- 新增/修改技能、提示词、结构，想知道是否真的改善行为。
- `/reflect` 落了一次技能修改，需要证据决定保留/回退。
- 两个方案争不出高下，用任务集裁决。

## 步骤

1. **定义任务集**：5–10 个任务，每个有**已知答案/验收判据**；正例与负例都要有。写成 TSV：
   ```
   task	expected	a	b
   ```
   `a`/`b` 先留空，跑完填 `pass`/`fail`。
2. **定义两臂**：A = 带新技能/新提示；B = 不带/旧版。**同模型、同上下文、同任务**；评估者不知道哪臂是哪臂（盲评）。
3. **跑**：每个任务用**新子代理**跑两臂，互不共享结论；记录实际结果对照 `expected`。
4. **算**：`node .agents/skills/eval/scripts/eval-score.mjs <results.tsv>` → A/B 命中率、Δ、翻转任务。
5. **判**：Δ 明显且翻转可解释 → 保留；Δ 接近 0 或负 → 回退/调整；翻转多 → 任务歧义，先修任务集。
6. **落账**：结论写任务文档或 `workflow/reviews.d/<当月>.md`；机制改动更新 `mechanism-registry.md`。

## 落凭证（行为评测门禁）

盲评结论要落成机器可核验的凭证，否则下次改技能时没人知道“上次到底测没测”：

```bash
flow-kit run agent-eval.mjs check          # 无当前内容签名的凭证 → 非零
flow-kit run agent-eval.mjs record \
  --pass-rate 0.9 --tasks 10 --model <评测模型>
flow-kit run agent-eval.mjs status
```

- 凭证按**敏感文件内容签名**（SHA-256）绑定，不认提交号；任何 `.agents/skills/**`、`commands/**`、`roles/**`、`model-roles.json`、`steering.json`、`pipeline.json` 变化都会让旧凭证失效。
- 通过率阈值、有效期、敏感面在 `.agents/config/agent-eval.json`；CI 在稳定前用 `check --advisory`，不要未评测就把 `advisory` 设为 `false`。
- 任务集可直接用 `.agents/evals/tasks.tsv`，跑完回填 `a`/`b` 两列。
- 新装没有凭证时严格 `check` 必然失败——这是要求先跑基线，不是安装缺陷；`record` 要求显式 `--pass-rate`、`--tasks >= minTasks`、非空 `--model`。

## 任务集模板

```
task	expected	a	b
bug-fix-1	复现失败用例后修复，测试转绿		
bug-fix-2	不修改测试断言，只改实现		
feature-1	新增行为有边界用例		
negative-1	拒绝在无 spec 时直接实现		
```

## 边界

- 小 N 有噪声；Δ < 20pp 不要宣称有效。
- 不盲评就不是 eval——评估者知道臂别会自我实现。
- 不用同一模型跑两臂又当裁判；裁判用不同模型或人工。
- 任务集要能区分「技能有用」与「模型本来就会」；负例是防自欺的关键。
