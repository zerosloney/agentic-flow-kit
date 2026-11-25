---
description: 流水线全生命周期时序轨迹追踪、自包含离线复盘包导出与时间旅行投影回放
stage: trace
triggers:
  - "timeline"
  - "时序追踪"
  - "复盘包导出"
  - "时间旅行"
approval_required: false
next: .agents/commands/pipeline-run.md
---

# timeline · 流水线时序轨迹与回溯对质

本命令由 `timeline-trace.mjs` 模块驱动，提供流水线执行全生命周期的精确时序事件流审计、时间旅行投影与自包含离线 HTML 复盘包生成能力。

---

## 1. 核心操作指令

### 1.1 查询时序事件流
```bash
# 查询当前或指定 run 的时序事件
flow-kit run timeline-trace.mjs list [--run <runId>] [--type <type>] [--limit 50]
```

### 1.2 导出自包含离线 HTML 复盘包
```bash
# 导出单个独立单页 HTML 复盘包（无需网络、纯原生渲染）
flow-kit run timeline-trace.mjs export-html --run <runId> [--out .agents/timeline/replays/<runId>.html]
```
导出的复盘包包含：
- 全局阶段耗时与跃迁图；
- 门禁执行通过与拦截时序；
- 人件确认与委托代录证据链；
- 关键状态快照（Keyframes）对比与时间旅行滑块。

### 1.3 时间旅行快照投影回放
```bash
# 投影重放指定时间步或关键帧的状态
flow-kit run timeline-trace.mjs replay --run <runId> --step <stepIndex>
```

---

## 2. 规范事件流 Schema

时序事件流统一追加写入 `.agents/timeline/<runId>.jsonl`，规范 schema 字段：
- `timestamp`: ISO-8601 UTC 毫秒时间戳；
- `runId`: 流水线运行实例全局唯一 ID；
- `stage`: 阶段枚举（`triage` / `intent-draft` / `spec-draft` / `plan-draft` / `implement` / `verify` / `done`）；
- `type`: 事件类型（`stage-enter` / `stage-exit` / `gate-start` / `gate-pass` / `gate-fail` / `confirm` / `mutation` / `halt`）；
- `actor`: 执行角色（`pipeline-driver` / `agent` / `user`）；
- `summary`: 简明事实描述；
- `metadata`: 上下文详细载荷（参数、退出码、耗时毫秒、影响文件等）。

---

## 3. 对质与审计守则

1. **不可篡改性**：时序流文件为 append-only 写入，严禁人工修改或回写真实历史事件；
2. **事故复盘闭环**：发生严重门禁拦截或流程回滚时，必须导出复盘包附于 Incident 记录中；
3. **退役与清理**：复盘包由本地保存，随任务归档定期清理，主干时序关键帧永久保留。
