# agentic-flow-kit

AI-Native 闭环工作流 + wiki 知识层脚手架。`flow-kit init` 一条命令为新项目装好整套项目级 AI 工作流引擎：8 个阶段命令、3 个子智能体角色契约、git 门禁钩子（闭环配对 / 敏感信息扫描 / 条件构建 / 规则面预算）、kb 跨语料检索、workflow 实时看板、intents→specs→plans→incidents 文档闭环、wiki 知识库三件套。

**装完即自包含**：引擎文件拷贝进项目（零 npm 运行时依赖，Node ≥ 18 即可跑），clone 后只差 `git config core.hooksPath .githooks`——init 会自动挂好。

## 快速开始

```bash
cd <你的项目根>
npx agentic-flow-kit init                        # 交互模式：宿主 → 技术栈 → 端口 → 显式确认安装
# 或直接给参数
npx agentic-flow-kit init --stack node --hosts zcode,opencode

# 体检（布局 / git 钩子 / managed 台账 / 索引漂移 / check-loop）
npx agentic-flow-kit doctor

# 包出新版后升级（未改动→覆盖；本地已改→跳过并报告，--force 才覆盖；owned 永不触碰）
npx agentic-flow-kit sync

# 后补宿主 / 装门禁（dotnet-ca：Clean Architecture 红线守卫，装后归项目）
npx agentic-flow-kit add-host opencode
npx agentic-flow-kit add-gate dotnet-ca
```

| 选项 | 说明 |
|------|------|
| `--stack` | `dotnet` / `node` / `python` / `go` / `none`（默认 none）——**门禁配置三处**：commit-check 条件编译检查（暂存对应扩展名时 commit 前自动构建）+ **质量检测**（`checks`：lint / 类型检查 / vet 等秒级确定性检查，存在对应配置文件（tsconfig / eslint / ruff / go.mod 等）才启用，没有则自动跳过；测试不放提交门——关单在 test.md 阶段门）、settings.json 自检验命令权限、AGENTS.md「项目适配区」命令预填 |
| `--hosts` | `zcode` / `opencode` / `trae` / `omp` 逗号多选（默认 zcode）——生成对应宿主薄适配层；zcode/omp 为本地配置自动进 .gitignore |
| `--board-port` | workflow 看板端口（默认 8933） |
| `--dir` | 目标项目根（默认当前目录） |
| `--force` | 覆盖已存在的同名文件（默认保守跳过） |

init 不问项目名 / 描述：`AGENTS.md` 只生成「AI工作流 + Wiki」两章骨架 + 「项目适配区」；技术栈经 `--stack` 传入只用于门禁配置（编译检查与自检验命令初值），密钥白名单等其余细节在 `.agents/hooks/commit-check.config.json` 里按项目填。

## 装了什么

```
.agents/            阶段命令×8 / 角色契约×3 / 门禁钩子 / 引擎脚本（检索·索引·看板·预算·聚合）/ 技能×2 / settings.json / kit.json 台账
.githooks/          pre-commit（通用门禁编排+项目门禁挂载点）/ pre-push（闭环断档）/ commit-msg / post-commit / pre-merge-commit
workflow/           intents/specs/plans/incidents 模板×4 + README 协议 + 台账三件（delegations/papercuts/regression-checklist）
wiki/               INDEX 骨架 + 知识沉淀总览 + drafts-archive
AGENTS.md           项目规范骨架（项目段占位待填）
modules/gates/      可选门禁模块（dotnet-ca：Clean Architecture 参考实现，装进项目后归项目）
```

**两态文件模型**：`.agents/kit.json` 记录 managed（引擎件，随包升级）与 owned（项目内容，永不覆盖）清单及 sha256；`doctor` 会校验漂移。已存在的文件 init 保守跳过（`--force` 覆盖）。

**升级语义（sync）**：managed 文件三方比对（台账 sha / 磁盘 sha / 新版渲染 sha）——未改动 → 直接覆盖新版；本地已改 → 跳过并报告（`--force` 才覆盖，git diff 自查差异）；改动恰好等于新版 → 视为已最新。包内新增文件自动安装；包内已删文件仅报告不删盘；缺失的 managed 文件自动恢复。INDEX / wiki 看板等生成器目标不比对 sha，收尾重跑生成器走锚点重写。门禁模块（add-gate 装入）归项目所有，sync 永不覆盖。

## 设计原则

- **权威单源**：角色行为只在 `.agents/roles/`，流程只在 `.agents/commands/`，宿主适配层是纯转发薄层——换宿主不换流程。
- **门禁即 git 钩子**：不依赖任何 agent 客户端自觉；项目专属门禁挂 `.agents/hooks/local-pre-commit`。
- **中文优先**：文档协议、命令、检查输出全中文；frontmatter 受限子集供机器断言。
- 抽取自真实项目长期运转的引擎（某真实项目），dogfooding 是后续路线（sync 升级 / add-host / add-gate / npm 发布）的一部分。

## 路线

- [x] v0.1.0：init（flags 模式）+ doctor + 4 宿主适配 + dotnet-ca 门禁模块
- [x] v0.2.0：sync 升级（未动覆盖 / 已改跳过报告 + `--force` / 生成器锚点重写）+ add-host / add-gate
- [ ] npm 发布
