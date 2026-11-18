# 更新日志

本文件由 tools/gen-changelog.mjs 从 Conventional Commits 生成，勿手改；重渲染用 --write。

## [2.10.4]

### 修复

- fix: 模型解析宿主键归一口径——resolveModels/readInjectedModels 与 parseModelFlags 同源，混合大小写不再静默丢宿主

### 其他

- refactor: list-hosts 从分派层抽离——main.mjs 不再内联宿主表组装，18 个命令全部委托 commands/

## [2.10.3]

### 新增

- feat: 外部宿主能力面对齐内置——hooks.event 支持多事件声明，mcp.scope 死字段清理（外部显式拒绝）

### 修复

- fix: 模型探测同意门知情性——TUI 确认与 CLI 审计行逐条列出将执行的命令
- fix: wizard 命令执行期可中断——runPrompt 对称切换 raw/cooked，Ctrl+C 走原生 SIGINT；降级路径挂 SIGINT 监听语义对齐 EOF

## [2.10.2]

### 新增

- feat: 安装锁退出码契约 6 与锁消息本地化——锁冲突可被脚本区分重试，消除 i18n 旁路

### 修复

- fix: 全 manifest 写路径持锁收口——remove-host/uninstall/prune/skills/adopt 不再与并发安装交错

## [2.10.1]

### 修复

- fix: registerHost 入口 fail-loud——空白名与非对象定义不再静默进注册表
- fix: 模型角色兜底值来源标注为 configured——roleConfig 默认不再误标 detected
- fix: 迁移清理资格持久化——schemaVersion 落盘后安装失败，重跑凭 pendingRemovals 完成清理不再丢

## [2.10.0]

### 新增

- feat: 安装单写者锁与崩溃续装——内容认领、createdAt 复用、user-hooks 按配置派生全局锁

### 修复

- fix: 写入安全收敛——原子写推广至 baseline/user-hooks，readManifest 区分缺失与损坏

## [2.9.0]

### 修复

- fix: manifest 改原子写（tmp+rename）——半截写坏 JSON 致 readManifest 返回 null、安装史整体遗忘的路径关闭
- fix: tasks-path——confirm-doc 与台账不变量闭集同步收编 workflow/tasks/<task>/ 路径

## [2.8.0]

### 修复

- fix: __none__ 哨兵不再泄漏到模型计划展示，--model 未知宿主报错附候选列表
- fix: CLI 入口健壮性——version/help 先于外部宿主加载、unknown command 附候选、非目录 --target 语义化报错、list-hosts 探测提示走 i18n
- fix: 外部宿主 skills.file 改用 isRelPath 校验、hookExtras 禁止覆写 command/args——堵住反斜杠路径逃逸与已渲染命令覆盖两个信任边界缺口
- fix: 派生重哈希按错误码分流——空 catch 把瞬时读错误（Windows EBUSY/EPERM）当生成器删文件，静默将文件从 manifest 永久除名（升级永久 skip、attest 不校验、uninstall 不清理）
- fix: 技能 frontmatter name 采信前过 SKILL_NAME_RE——此前原样拼进宿主指针路径，../ 可逃逸宿主目录，Windows 非法字符致 flush 中途 EINVAL 半安装
- fix: doctor 对未安装目标不再崩溃——manifest 为 null 时 stacks/stack 成员访问无守卫，空目录跑 doctor 必抛 reading 'stacks'
- fix: wizard 体检流 argv 补齐 flags 集合——doctorCommand 内 flag() 解引用 args.flags，主菜单体检与安装后体检此前必抛 TypeError

### 其他

- refactor: TUI 流 manifest 读取收敛为 requireManifest，删除 modelFlow 死值 explicit

## [2.7.1]

### 修复

- fix: commitmentFingerprint 归一补表格证据列——spec 验收判据表补证据不再误判承诺面改写（fixes #67）

## [2.7.0]

### 新增

- feat: 落地 BACKLOG 条目 30——引擎侧定时「出厂凭证」新鲜度报告（eval-freshness）
- feat: 落地 BACKLOG 条目 28/29——跨模型复核三阶判定与面板评审收敛控制

### 文档

- docs(backlog): 关闭 #31——发布控制不进引擎定位，ADR 记依据
- docs: 官网版本徽标与命令页副标对齐 v2.6.1

## [2.6.1]

### 修复

- fix(engine): 评测双臂发现两门语义缺陷——sbom-license 零依赖仓库 pass-with-note 不再 fail-closed、verify --scope 无 origin/零提交 loud-skip 降级指引（声明依赖无 lockfile 仍 fail-closed，git 故障仍 fail-loud），补 24 例破坏性/回归测试

### 文档

- docs(backlog): 行为评测重跑清账入账——12 子代理盲评 12/12 PASS 双树凭证落账、verify 两门修复记录、全仓模板 EOL 归一（586 文件转 CRLF，签名定型 fab13142/f0145f5）

## [2.6.0]

### 新增

- feat: 落地 BACKLOG 条目 15–27——五新技能、SessionStart 会话入口路由令与复盘/协作面补强

### 文档

- docs: 同步会话入口接线说明——CLAUDE.md hook 事件/工具闭集补 session 与编译期过滤 advisory，README 风险路由条目补 SessionStart 路由令（对应 BACKLOG #18）
- docs: 官网双主题与内容扩展——深色工业控制台皮肤（本地记忆 + theme-color 同步）、12 宿主接线矩阵、命令台账/场景总览/实战案例/未来演进等章节，语义令牌化皮肤与动效降级，零外链不变
- docs: 新增官网内容页——内嵌字体与图标子集零外链，修正中文字重与容器对齐，版本对齐 v2.5.0

## [2.5.0]

### 新增

- feat(engine): stageArtifacts 声明式 {apiDocs} 占位符——展开为任务目录 api.md，模板默认不声明，触达 API 契约面的项目自行加
- feat(engine): 角色补位 test-designer——Build §1 测试面先行委派位（advisory，产物回填 plan 验证方式节）+ 十宿主壳与双语契约

### 修复

- fix(engine): 评审四项——stage-gates 补齐时间线/验收标准/复盘三件套同病正则、range 出账改逐 plan 口径、mechanism-registry 同步 #63 语义、行注补齐（PR #65）
- fix(engine): 机读解析两处装户假红——合并提交基准取第一父不分 PR 构建（#63）+ 机读节标题容忍编号前缀与声明 0 出账（#56）
- fix: 评审四项——旧 run {apiDocs} 兜底派生、声明即校验语义双语文档、status 文档列表补员、inherit 回读单元断言（PR #64）
- fix: 基线缺口收尾——readInjectedModels 不再跳过 inherit 值（diff 模板更新误报 + remove-host 收敛丢行）+ pr-adjudicator/finder/verifier 补 zcode 壳（删反向遍历豁免）
- fix(engine): 评审四项——验证节名双名兼容、check-scope 补扫「验证方式」、check-local-gates 八员清单、角色×宿主壳反向遍历测试（PR #62）

### 其他

- ci: 重触发 PR 事件（push 后 webhook 丢失）

## [2.4.1]

### 新增

- feat(changelog): CHANGELOG 机制化——Conventional Commits 单源渲染 + --check 防漂移进 CI
- feat(engine): observability 默认定价表——claude 官方标价快照 21 键（来源 platform.claude.com）

### 修复

- fix(changelog): 评审六项——.gitattributes 钉 LF 防假红、发版序列补 amend 语义、git 层容错去栈、兜底桶单源化、CLAUDE.md 补 --notes、分支测试（PR #59）
- fix(check-loop): 回归证据词表补仓库验证脚本族 scripts/verify/**/*.mjs
- fix: 评审三处——reports 限委派节、schema 双键说明、doctor advisory 收敛（PR #57）
- fix(engine): check-scope-range 跳过范围内已删除/更名的 plan（不再 exit 2 阻断推送） (#58)
- fix(doctor): userHooks 宿主（codex）不适用 hook 规格降级为 guarantee advisory
- fix(engine): 派发预算超限改按「报告数×单报告预算」月口径判定，reports=0 不计费

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
