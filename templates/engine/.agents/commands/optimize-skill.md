---
description: 技能资产自优化进化飞轮，提取历史处方缺陷模式，执行影子 A/B 对抗裁决与零回归落地
stage: maintain
triggers:
  - "optimize-skill"
  - "技能进化"
  - "优化技能"
  - "技能对抗"
approval_required: true
next: .agents/commands/pipeline-run.md
---

# optimize-skill · 技能资产自优化进化飞轮

本命令由 `skill-optimizer.mjs` 模块驱动，对标中兴通讯 Co-Sight Harness 技能进化架构，实现从历史自愈处方与故障模式中提取技能缺陷、生成候选优化版本，并通过影子沙箱 A/B 对抗裁决，在零回归保证下完成技能资产的自我进化。

---

## 1. 核心操作指令

### 1.1 从历史处方提炼技能补丁建议
```bash
# 扫描历史处方与失败案例，针对指定技能生成演进建议与补丁候选
flow-kit run skill-optimizer.mjs extract --skill <技能名称> [--min-failures 3]
```

### 1.2 执行影子沙箱 A/B 对抗裁决
```bash
# 在隔离影子沙箱中对比基线技能（A）与候选技能（B）的评测表现
flow-kit run skill-optimizer.mjs arbitrate --skill <技能名称> --candidate <候选路径>
```
输出对抗裁决指标卡：
- **基线指标**：通过率、耗时、Token 消耗；
- **候选指标**：针对历史缺陷修复率、新增收益；
- **回归检测**：基线用例有无一例失败（零回归断言）。

### 1.3 零回归安全应用胜出技能
```bash
# 用户确认后，将通过对抗裁决的胜出技能安全应用回主干技能库
flow-kit run skill-optimizer.mjs apply --skill <技能名称> --winner candidate
```

---

## 2. 进化飞轮工作机制

1. **缺陷模式提炼**：
   分析 `.agents/prescriptions.json` 中频繁触发的错误模式与成功处方，定位技能说明中的指导盲区或歧义诱导点。
2. **候选生成（Variant Generation）**：
   在保证技能原始架构约束不变的前提下，补充前置检查约束、澄清边缘场景边界或优化提示词模板。
3. **影子双臂对抗（Twin-Arm Arbitration）**：
   在隔离影子环境中并发运行黄金基准测试集。
4. **一票否决制（Zero-Regression Gate）**：
   若候选版本导致任何原本通过的测试用例失败，哪怕整体得分上升，也立即一票否决淘汰，严禁损害已有质量基线。

---

## 3. 合规与维护守则

1. **人件确认门**：技能应用为主干资产前，必须出示 A/B 对抗评测数据并获得用户显式确认；
2. **版本留痕**：历史被替代的技能版本自动备份并记入演进台账，支持一键安全回退；
3. **退役重评**：连续 6 个有数据月零提炼与零胜出的技能进化任务自动降频并进入退役重评流程。
