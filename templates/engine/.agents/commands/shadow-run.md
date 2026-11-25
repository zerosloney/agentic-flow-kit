---
description: 受控无头驱动与隔离影子沙箱试跑，提供步数预算、超时熔断与状态指纹防空转三重防爆
stage: verify
triggers:
  - "shadow-run"
  - "影子试跑"
  - "无头试跑"
  - "受控试跑"
approval_required: false
next: .agents/commands/pipeline-run.md
---

# shadow-run · 受控无头驱动与影子试跑

本命令由 `headless-driver.mjs` 模块驱动，为高风险重构、复杂长程自治探索或前置方案验证提供物理隔离的工作区影子沙箱，并由受控无头驱动引擎提供三重物理防爆网。

---

## 1. 核心操作指令

### 1.1 启动隔离影子试跑
```bash
# 在隔离影子沙箱中无头驱动试跑指定目标任务
flow-kit run headless-driver.mjs run \
  --task "<任务描述>" \
  --max-steps 30 \
  --timeout 180000 \
  [--sync-on-success]
```

参数说明：
- `--max-steps <N>`：硬性步数预算上限（默认 50 步），超限自动熔断挂起；
- `--timeout <ms>`：物理墙钟耗时上限（毫秒，默认 300000ms），超时硬拦截；
- `--sync-on-success`：试跑成功且门禁全绿后，方允许将改动同步回生产工作区；默认不同步，仅生成试跑评估报告。

### 1.2 清理与重置影子工作区
```bash
# 显式重置影子沙箱临时目录
flow-kit run headless-driver.mjs clean
```

---

## 2. 三重物理防爆网机制

1. **步数预算熔断**：
   驱动引擎精确追踪每一次工单流转与工具调用，步数达到预设阈值立即产生 `STOP_MAX_STEPS` 阻断，杜绝无节制长程漫游。
2. **墙钟耗时熔断**：
   引擎级定时器看门狗，超过设定的执行耗时立即中止子进程并释放资源，产生 `STOP_TIMEOUT`。
3. **状态指纹循环检测（Anti-Stall）**：
   每一轮循环自动计算工单目标与工作区文件改动的联合指纹哈希（State Fingerprint）。若连续检测到重复状态且无正向收敛进展，立即判定死循环并产生 `STOP_STALL_LOOP`，防止智能体在同类错误中无限空转消耗 Token。

---

## 3. 安全与合规守则

1. **生产零污染**：所有探索性代码改动与编译测试仅在影子沙箱临时目录执行，失败时就地销毁，不污染当前 Git 工作区；
2. **门禁前置**：影子试跑产物同步回主干前，必须无条件通过 `verify.mjs` 全套门禁核验；
3. **留痕审计**：影子试跑的全程事件自动向 `timeline-trace.mjs` 注册，确保试跑过程可追溯。
