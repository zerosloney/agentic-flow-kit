# ADR 2026-11-28：代码库系统性架构降熵、规范化归一与模块解耦

## 状态
已实施 (Implemented) — 决策主体已落地（`e62ca67..beb48f3` 已合入 `main`）。两项偏离如实记录：
1. 上下文 §2 中的 `isObject` 归一未在本轮执行，顺延为后续批次（对应 REFACTORING_PROGRESS.md E-06 待处理）。
2. 决策 §7 原计划的 `.agents/config/architecture.json` 配置文件未落地，由 `tests/kit-architecture.test.mjs` 以硬编码层规则等价实现替代。

## 上下文
`agentic-flow-kit` 是面向 AI-Native 工作流引擎的安装器 CLI（Node.js ≥22、ESM、零运行时依赖）。随着系统演进至 14 个宿主、多栈配置、多层规则引擎、沙箱与门禁支持，代码库积累了以下架构熵：
1. **循环依赖**：
   - `src/commands/install.mjs` ↔ `src/commands/bundle.mjs`（通过 `readKitVersion` 交叉依赖）。
   - `src/rules/model.mjs` ↔ `src/rules/yaml.mjs`（通过 `RulesConfigError` 交叉依赖）。
2. **工具函数与规范多源扩散**：
   - `sha256` 与 `canonical` JSON 序列化在 `bundle.mjs`、`sbom.mjs`、`attest.mjs`、`handoff.mjs`、`notary.mjs` 等 5 处独立重复实现。
   - `resolveTarget`（目标目录解析与校验）被定义在 `src/commands/install.mjs` 中，导致 17 个子命令反向强耦合到 `install.mjs`。
   - `requireManifest`（严格要求 manifest 存在）在 `diff.mjs`、`skills.mjs`、`flows.mjs` 等处重复定义。
   - `isObject` 对象校验在 `external.mjs`、`hooks.mjs`、`mcp.mjs`、`permissions.mjs`、`user-hooks.mjs` 等 5 处重复定义。
   - `getFileLayer` 在 `src/install/arch-guard.mjs` 同一文件内部重复定义两次。
3. **上帝模块与职责外溢**：
   - `src/commands/install.mjs` 承担了目标解析、宿主解析、产品感知、脚手架解析、派生工件重算与生成、企业级证明链配置等，混合了 CLI 层与领域层能力。
   - 派生工件重算 `rehashDerivedArtifacts` 位于 `install.mjs`，与已有的 `src/install/derived.mjs` 领域模块分离。
4. **架构规范缺乏自动化机器约束**：
   - 尽管系统内建了 `arch-guard` 工具，但本仓库自身未配置 `.agents/config/architecture.json` 分层守卫，缺少对循环依赖与分层穿越的自动化测试防护。

## 决策

遵循 7 大核心工程属性：
1. **Single Source of Truth**：
   - `readKitVersion` 权威单源为 `src/install/version.mjs`，所有命令统一直接引用。
   - `resolveTarget` 提取至 `src/install/target.mjs`，作为目标路径校验权威单源。
   - `canonical` 与 `sha256` 归一至 `src/install/notary.mjs` 或 `src/kernel/index.mjs`。
   - `requireManifest` 权威单源收敛至 `src/install/manifest.mjs`。
2. **Canonical Implementation**：
   - 消除散落的同名实现，所有相同语义必须复用单源实现。
3. **Deep Modules**：
   - 将派生工件生命周期管理（重算与生成）内聚封装在 `src/install/derived.mjs`。
   - 简化命令层实现，命令仅负责参数提取、调用业务深模块、格式化输出。
4. **High Cohesion, Low Coupling**：
   - 彻底切断循环依赖，依赖方向单向流动：`cli/tui -> commands -> install/ci/rules/models/hosts -> kernel`。
5. **Locality of Change**：
   - 变更概念（如目标路径校验逻辑、规则错误类、版本读取）只需修改单一点。
6. **Deletion over Accumulation**：
   - 迁移旧调用方，删除冗余私有辅助函数与平行实现，不保留无调用的历史残留。
7. **Enforceable Architecture**：
   - 在 `tests/` 下建立自动化架构防回归测试（`tests/kit-architecture.test.mjs`，扫描范围收口至 `src/**`），确保未来开发零循环依赖、零分层破损。
   - （2026-11-28 修正：原计划的 `.agents/config/architecture.json` 配置文件未落地，由上述测试中的硬编码层规则等价替代。）

## 影响评估
- 向后兼容：所有向外导出的公共接口（如 `package.json` 的 exports、测试中直接引用的符号）均保持原签名或保留别名转发，现有 1952 个测试 100% 保持通过。
- 零运行时依赖：重构完全基于 Node.js 内置能力，不引入任何第三方依赖。
