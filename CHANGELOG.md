# 更新日志

本文件由 tools/gen-changelog.mjs 从 Conventional Commits 生成，勿手改；重渲染用 --write。

## [2.4.0]

### 新增

- feat(engine): pipeline 产物目录 workflow/tasks/<task>/——自动化落点与手动路径隔离
- feat(engine): usage 凭证自动采集——PostToolUse(Agent) 观测腿（仅 claude，缺 usage 零写入）
- feat(engine): 任务状态投影——projectTasks 单源聚合进 INDEX 与看板（advisory，不做权威状态文件）
- feat(engine): pipeline 配置 schema 与看板退回态——route/route-enter/resume 时间线 + stageBar 退回标注
- feat(engine): 人读门禁清单并入 effective-policy 生成物（单源生成 + --check 防漂移）
- feat(engine): 派发报告预算——dispatch.json 单源 + 七角色预算行 + agg/outcome 计量
- feat(engine): pipeline 失败路由表与恢复语义——onFail 边、per-stage 重试、resume 产物判定（R6-1/R6-2）

### 修复

- fix(doctor): 不适用 hook 规格降级为 guarantee advisory（inapplicableSpecs 单源判定）
- fix(engine): route:false 不消耗退回预算 + 空路由表静态门非零（PR #53 评审）

### 文档

- docs(readme): 全局安装源改用 @latest，避免版本号随发版漂移
- docs(readme): 子命令改表格、治理面图改树形结构、补全局安装源
- docs(readme): 定位改为引擎本体，新增工作流与治理面图表，移除维护节
- docs(readme): 精简为定位/能力/维护三块——细节指路 CLAUDE.md 与 --help
- docs(readme): 按双能力面重构——总览/安装/工作流运行/工程治理四段式

## [2.3.0]

### 新增

- feat(hosts): CodeArtsDoer 内置宿主——.github/hooks 接线与指针薄壳（closes #48）
- feat(hosts): Codex 内置宿主——用户级 hooks 接线（closes #45）
- feat: CI 二选一开关、--stack 多技术栈与 sbom lockfile 位置配置

### 修复

- fix(doctor): --deep/--fix 改走 flag()，布尔旗标真正生效（closes #49）
- fix(budget): dotnet 预算表对齐发行模板，守卫测试防再漂移（closes #44）
- fix(test): baseline 用例补仓库级 git 身份，CI runner 无全局身份不再失败
- fix: 台账归并时序、宿主探测盲区、policy 迁移与基线重建（closes #39 #40 #42 #43）

## [2.2.0]

### 新增

- feat(devcontainer): 增加容器可构建的 CI 硬证据（R3-8 第四片）
- feat(devcontainer): 增加开发容器生成与镜像白名单门（R3-8 第三片）
- feat(sbom): 增加 SBOM 生成与许可证策略门（R3-8 第二片）
- feat(mcp): 增加 MCP 工具权限策略（R3-8 第一片）
- feat(memory): 增加记忆生命周期状态机与统一查询（R3-6）
- feat(skills): 增加技能包分发与准入（R3-4）
- feat(pipeline): 执行器支持断点续跑、门重试与并行分支
- feat(observability): 增加成本延迟聚合与模型质量时间线
- feat(hosts): 增加 new-host 生成器与模板 lint
- feat(install): 收缩安装面，运行时能力随包分发
- feat(runtime): 增加包内运行时入口 flow-kit run/hook
- feat(upgrade): 增加 manifest schemaVersion 迁移框架
- feat(doctor): 增加安装证明链 --attest
- feat(upgrade): 增加 --explain-policy 策略差异视图
- feat(policy): 策略即代码校验与 effective-policy 视图
- feat: Wave 4 多仓 Workspace、Spec 工件与 eval-log 证据
- feat(enterprise): 企业档宿主矩阵 (#16)
- feat(permissions): 权限 / 工具白名单编译 (#13)
- feat(upgrade): 基线留存与三方合并 (#8)
- feat(hooks): Hook 编译器 (#11)
- feat(profile): 组合式 profile (#15)
- feat(mcp): MCP 接线 (#12)
- feat(hosts): 外部宿主插件 (#10)
- feat(adopt): 接管已有安装 (#9)
- feat(install): 增加 --auto-hosts 宿主探测 (#14)
- feat(i18n): 增加英文覆盖一致性检查 (#17)
- feat(doctor): 以 advisory 报告 manifest 漂移 (#7)
- feat(remove): 增加 remove-host / uninstall (#4)
- feat(cli): 统一 --json 输出与退出码契约 (#5)
- feat(explain): 增加 explain 文件来源解释 (#6)
- feat(prune): 增加 prune 清理孤儿文件 (#2)
- feat(diff): 增加 diff/status 漂移视图 (#3)

### 修复

- fix(devcontainer): node 解到 /usr/local，否则 npm 全局 bin 不在 PATH（R3-8 CI 修复 3）
- fix(devcontainer): dotnet/go/java 也需要补装 node（R3-8 CI 修复 2）
- fix(devcontainer): 修正镜像 tag 与容器身份（R3-8 CI 修复）
- fix(pipeline): 修复关单归档死锁与 commit-msg 运行时面调用
- fix: 处理 Wave 2 合并后审查问题

### 文档

- docs(roadmap): 新增能力扩展路线图并拆分 Wave 1 issues

### 其他

- chore(test): 测试临时目录改用 makeTmp helper 并在退出时清理

## [2.1.0]

### 新增

- feat: AI-Native 治理面、安装档位与评测记忆机制
- feat(install): 宿主原生技能与子代理模型配置
- feat(tui): 零依赖交互式向导（readline+ANSI），入口分流、降级问答、逐文件进度

### 文档

- docs(claude): CLAUDE.md 架构指引入库
- docs(agents): 新增 AGENTS.md 会话指引
- docs(readme): 清除本机绝对路径，改用 npx 与「项目目录」占位

### 其他

- chore(git): 忽略根目录 .qwen / .claude 本机工具状态
- chore(license): 明确 MIT 开源协议

## [2.0.0]

### 修复

- fix(engine): check-scope-range 补 L0 极简道豁免通道

### 其他

- ci: add test workflow and npm publish on semver tag, bump version to 2.0.0
- chore: initialize repository with project files and gitignore
