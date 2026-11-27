# 代码库架构治理与降熵演化进度表 (Refactoring Progress)

> 分支：`refactor/arch-governance`（已 Fast-Forward 合入 `main`）
> 基线：1952 tests, 1948 pass, 0 fail, 4 skipped | 4/4 repo checks pass
> 最终状态：1955 tests, 1951 pass, 0 fail, 4 skipped | 循环依赖 0 | 跨层违规 0 | 100% 通过

---

## 一、架构全景地图与分层规约

```
[Presentation / Entrypoints]
  bin/flow-kit.mjs -> src/cli/main.mjs, src/cli/args.mjs, src/cli/exit.mjs, src/tui/*
         │
         ▼
[Commands / Orchestration]
  src/commands/* (install, upgrade, doctor, gate, bundle, sbom, diff, etc.)
         │
         ▼
[Domain & Core Subsystems]
  src/install/*   : 安装管线、清单管理、基线三方合并、权限与 Hook 编译、派生工件
  src/rules/*     : 规则包模型、YAML/JSONC 解析、规则求值与插件系统
  src/models/*    : 模型角色解析、探测、已知模型表
  src/hosts/*     : 14 宿主适配能力注册表、外部宿主加载、宿主探测
  src/skills/*    : 技能包分发、校验与准入、评测线
  src/ci/*        : CI 门禁卡口流水线与工作流生成
  src/git/*       : 本地 git 状态、配置与钩子映射
         │
         ▼
[Kernel / Foundation]
  src/kernel/index.mjs : 散列摘要、脏树检测、三方合并
  src/install/version.mjs : 版本与引擎需求单源
  src/install/target.mjs : 目标路径与目录校验单源
  src/install/runtime-paths.mjs : 运行时模板与脚本路径单源
  src/i18n.mjs : 国际化与翻译单源
```

---

## 二、架构熵与偏离清单 (Entropy Inventory)

| 编号 | 类别 | 现象与位置 | 治理动作 | 状态 |
|---|---|---|---|---|
| E-01 | 循环依赖 | `src/commands/install.mjs` ↔ `src/commands/bundle.mjs` | `bundle.mjs` 等改从 `src/install/version.mjs` 引入 `readKitVersion` | ✅ 已完成 (`e62ca67`) |
| E-02 | 循环依赖 | `src/rules/model.mjs` ↔ `src/rules/yaml.mjs` | 抽离 `src/rules/errors.mjs`，解耦 `RulesConfigError` | ✅ 已完成 (`e62ca67`) |
| E-03 | 工具重复 | `sha256` / `canonical` 重复出现在 5 个文件 | 归一至 `src/install/notary.mjs`，消除各处平行手写 | ✅ 已完成 (`e62ca67`) |
| E-04 | 职责外溢 | 17 个命令从 `commands/install.mjs` 引入 `resolveTarget` | 提取 `src/install/target.mjs` 权威实现，迁移所有调用方 | ✅ 已完成 (`2acc10b`) |
| E-05 | 逻辑重复 | `requireManifest` 在 `diff.mjs`、`skills.mjs`、`flows.mjs` 重复 | 归一至 `src/install/manifest.mjs` 单源，迁移所有命令 | ✅ 已完成 (`2acc10b`) |
| E-06 | 跨层倒灌 | `src/install/derived.mjs` 从 `commands/runtime.mjs` 引入路径 | 提取 `src/install/runtime-paths.mjs` 单源，彻底消除跨层导入 | ✅ 已完成 (`566ebad`) |
| E-07 | 内部重复 | `getFileLayer` 在 `src/install/arch-guard.mjs` 内重复定义两次 | 提升至模块作用域单一函数 | ✅ 已完成 (`e62ca67`) |
| E-08 | 模块内聚 | `rehashDerivedArtifacts` 滞留在 `install.mjs` | 迁移至 `src/install/derived.mjs` 领域模块 | ✅ 已完成 (`fad354c`) |
| E-09 | 防回归 | 仓库自身缺乏机器可执行的架构守卫测试 | 建立 `tests/kit-architecture.test.mjs` 自动化架构回归测试 | ✅ 已完成 (`566ebad`) |

---

## 三、治理批次与推进记录

### Batch 1: 消除循环依赖与工具函数归一 (`e62ca67`)
- [x] 解除 Cycle 1 (`install.mjs` ↔ `bundle.mjs`)
- [x] 解除 Cycle 2 (`model.mjs` ↔ `yaml.mjs`)
- [x] 归一 `sha256` 与 `canonical`，消除 4 处手写副本
- [x] 消除 `arch-guard.mjs` 内的重复 `getFileLayer`
- [x] 验证循环依赖数从 2 降为 0
- [x] 全量验证与独立提交

### Batch 2: 目标路径解析解耦与 Manifest 统一 (`2acc10b`)
- [x] 新建 `src/install/target.mjs`
- [x] 迁移 18 个模块的 `resolveTarget` 调用，消除 `policy.mjs` 的重复定义
- [x] 在 `src/install/manifest.mjs` 增加 `requireManifest`，迁移 9 处手写校验
- [x] 全量验证与独立提交

### Batch 3: 派生工件生命周期内聚 (`fad354c`)
- [x] 将 `rehashDerivedArtifacts` / `generateDerivedArtifacts` 迁移入 `src/install/derived.mjs`
- [x] 在 `install.mjs` 保持别名导出以兼容历史测试与外部导入方
- [x] 全量验证与独立提交

### Batch 4: 架构分层守卫与防回归机制 (`566ebad`, `3308350`)
- [x] 提取 `src/install/runtime-paths.mjs`，消除 `install` 对 `commands` 的唯一跨层依赖
- [x] 建立 `tests/kit-architecture.test.mjs` 自动化架构回归测试
- [x] 保证 `agentic-flow-kit/kernel` 外部契约 4 函数精确锁定不变
- [x] 确保测试集成入 `npm test`，常态化防循环与防跨层
- [x] 全量验证与独立提交

### Batch 5: 全量套件端到端验证与主干合流 (`main`)
- [x] 运行全量测试套件 `npm test`：1955 项测试（1951 通过，0 失败，4 跳过）
- [x] 运行工程检查套件：`check:i18n` (147 文件)、`lint:templates` (5 矩阵)、`policy:check` (46 机制)、`devcontainer:check` (9 栈) 全部通过
- [x] Fast-Forward 合入 `main` 分支并清理临时 worktree
- [x] 更新 ADR 与架构治理总报告工件
