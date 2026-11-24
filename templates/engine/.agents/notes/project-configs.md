# 项目级门禁配置总表

> 引擎与门禁机制随包装发，**规则与开关归项目**。本页是项目级配置的单一入口：先看总表定位，再看对应小节。
> 通用语义：配置缺失 = 该项能力未启用（各门按「未配置」跳过，不拦人）；文件存在但格式非法 = **fail-closed**——由消费脚本报错并按各自退出码失败，不能当「未配置」放过。具体退出码以各脚本源码头注为准。
> 自检：`flow-kit doctor` 的 gate coverage 段逐项报告「已配置 / 未配置（SKIP）/ 配置错误」，并用 `git ls-files` 统计 faces 触发面命中的跟踪文件数（0 命中会告警）。

## 总表

| 文件 | 作用 | 何时触发 | 未配置语义 | 配置错误 |
|---|---|---|---|---|
| `.agents/config/project-faces.json` | 产品面（ui/code/tests/data）路径前缀单源 | 提交时 check-confirm-order；关单/CI 时 verify / verify-scope | 保守全触发：任何变更都按产品面 | exit 2 |
| `.agents/hooks/commit-check.config.json` | 条件构建 / 秒级质量检查 / 推送前测试 | pre-commit（builds/checks）；pre-push `--range`（pushTests） | 对应段全 SKIP | 读不了/JSON 坏时按未配置跳过（该脚本不 fail-closed） |
| `.agents/config/product-gates*.json` | 基础表之外的技术栈产品门 | verify（本地关单 / CI） | 无项目产品门 | exit 2 |
| `.agents/hooks/architecture-redlines.json` | 架构红线（forbidden / 导航属性 / catch 约束） | pre-commit 静态门；宿主写前拦截 | SKIP exit 0 | exit 2 |
| `.agents/hooks/delete-guard.json` | 删除调用扫描与 allowlist | pre-commit 静态门；宿主写前拦截 | SKIP exit 0 | exit 2 |
| `.agents/hooks/audit-fields.json` | 审计字段禁止手工补写 | pre-commit 静态门（暂存新增行） | SKIP exit 0 | exit 2 |
| `.agents/hooks/notify-guard.json` | 通知守卫：扫描目录 / 扩展名 / 命中正则 / 豁免文件 | pre-commit 静态门（目标目录全量） | 用内建默认（frontend/src + .vue/.ts + message.error/warning/info + utils/notify.ts 豁免） | exit 2 |
| `.agents/config/test-impact-map.json` | 影响面选测映射 | pre-push 选测；CI 重档 `--full` | 骨架态 SKIP exit 0（文件缺失属前置缺失 exit 1） | 读取/校验失败 exit 1 |
| `.agents/config/local-gates.json` | 本机必设环境变量（专用测试库） | `flow-kit run check-local-gates.mjs`、doctor `--deep` | SKIP（不拦） | 解析失败按缺项计 exit 1 |
| `.agents/config/lane-surfaces.txt` | L2 触达面 ERE 清单 | verify `lane-surface-ci`（关单 / CI diff 面） | 缺失或空 = 不校验 | 非法 ERE → 拦截 |
| `.agents/config/workflow-modules.txt` | workflow 模块词表 | 建档 / triage / 索引 / 检索 | 空 = 不校验 `模块:` 取值 | 词表外取值被 triage 拒绝 |

## .agents/config/project-faces.json

- **作用**：声明本项目的产品面路径前缀，是「哪些改动算产品契约面」的单源；四面 `ui` / `code` / `tests` / `data`。
- **何时触发**：pre-commit 的 `check-confirm-order`（产品路径先确认后改）；关单 / CI 的 `verify.mjs`（脏路径过滤、`--face` 面裁门）与 `verify-scope.mjs`；`flow-kit run faces.mjs` 供 shell 面自查。
- **未配置语义**：文件缺失或四键全空 = 未配置 → **保守全触发**（任何变更都当产品面处理）；这是安全默认，不会误放行。
- **配置错误**：解析失败 / 形状错误 = fail-closed exit 2（`faces.mjs`、`check-confirm-order.mjs`、`verify.mjs` 同口径）。
- **最小示例**：

```json
{
  "ui": ["frontend/src/"],
  "code": ["backend/"],
  "tests": ["tests/"],
  "data": ["wiki/数据维护/"]
}
```

- **字段说明**：每键为数组，元素是仓库相对路径前缀（正斜杠；目录以 `/` 结尾；不接受绝对路径与 glob）。文件命中任一前缀即属于该面；未列出的路径（文档 / 工具链 / 引擎面）不触发产品门。

## .agents/hooks/commit-check.config.json

- **作用**：提交/推送路径上的三段执行器——`builds` 条件构建、`checks` 秒级确定性检查、`pushTests` 推送前测试。
- **何时触发**：pre-commit 跑 `builds`（常规提交带 `--no-build` 时跳过；合并提交走 `--full`）与 `checks`；pre-push 以 `--range <old> <new>` 跑 `builds` 与 `pushTests`。
- **未配置语义**：文件缺失或对应数组为空 → 该段 SKIP（`pushTests` 段完全不产生输出），不拦人。
- **配置错误**：读不了 / JSON 坏时脚本按「无配置」跳过对应段（该脚本不 fail-closed）；`flow-kit doctor` 会把这类文件标红提醒修正。
- **最小示例**：

```json
{
  "builds": [
    { "name": "backend", "command": "dotnet build", "ext": [".cs", ".sln", ".csproj"] }
  ],
  "checks": [
    { "name": "typecheck", "command": "npx tsc --noEmit", "ext": [".ts", ".tsx"], "when": ["tsconfig.json"] }
  ],
  "pushTests": [
    { "name": "backend-tests", "command": "npm test", "prefix": ["backend/", "tests/"], "when": ["package.json"], "whenEnv": "RUN_PUSH_TESTS=1", "timeoutMs": 600000 }
  ]
}
```

- **字段说明**：
  - `builds` / `checks` 元素：`name`、`command` 必填；`ext`（扩展名）与 `prefix`（路径前缀，数组或字符串）任一命中即触发；`cwd` 指定执行目录；`when` 见下；`lockPattern` / `lockHint` 可选，用于把文件锁类失败单独提示。`builds` 不计 `.agents/` 与 `.githooks/` 自身变更，`checks` 只不计 `.githooks/`。
  - `pushTests` 元素：仅在 `--range` 模式（pre-push）执行；`command` 中的 `{old}` / `{new}` 替换为校验过的两个 sha；`prefix` 可为字符串数组；`whenEnv` 是环境开关门槛（形如 `RUN_PUSH_TESTS=1`，不满足不执行也不打印）；`timeoutMs` 为单条墙钟上限。
  - `when`：数组任一满足才启用——路径存在 / 尾部 `*` 一层通配（如 `*.sln`）/ `pkg:<点分路径>`（读该条 `cwd` 下 `package.json`，取到非空字符串才算满足）。无 `when` = 无条件启用。

## .agents/config/product-gates*.json

- **作用**：把技术栈产品门（编译 / 单测 / lint / E2E 等）从引擎基础表移入项目配置；`verify.mjs` 将其插在 `wiki-consistency` 之后、栈自动探测门之前。
- **何时触发**：`verify.mjs`（本地关单 / CI）。门序 = 文件名排序（`product-gates.json`、`product-gates.<名称>.json`）× 文件内数组序。
- **未配置语义**：目录下没有任何 `product-gates*.json` = 无项目产品门，不报错不打印。
- **配置错误**：JSON 坏 / 缺必填字段 / `id` 与内置门或他门重复 / `deps` 指向不存在的门 → stderr 报错 exit 2（不能当没配置放过）。
- **最小示例**：

```json
{
  "gates": [
    { "id": "backend-build", "name": "后端编译", "cmd": "dotnet build", "folder": ".", "when": ["*.sln"] }
  ]
}
```

- **字段说明**：`id` / `name` / `cmd` 必填；`folder` 默认 `.`；`deps`（前置门 id）、`when`、`env` 可选；`type` 默认 `shell`。`when` 语义与 `commit-check.config.json` 一致（路径存在 / 尾部 `*` 一层通配 / `pkg:<点分路径>`）；不满足的门不进执行清单，只打 SKIP 行，不计失败。

## .agents/hooks/architecture-redlines.json

- **作用**：架构红线规则外置——`forbidden`（禁止内容）、`noNavigationProperties`（实体禁导航属性）、`catchRequires`（catch 块必须含指定符号）。脚本只实现「读规则 → 扫目标 → 报违例」的机制。
- **何时触发**：pre-commit 静态门（`check-architecture.mjs`）；宿主写前拦截（`pre-write-check.cjs` 对目标文件复用同一脚本）。
- **未配置语义**：文件缺失，或三个数组全空 = SKIP exit 0（项目没有红线约定，不应拦人）。
- **配置错误**：读不了 / JSON 坏 / 顶层不是对象 / 未知顶层键 / 必填字段缺失 / 正则非法 / `id` 重复或格式不符 → exit 2。
- **最小示例**：

```json
{
  "forbidden": [
    { "id": "no-dbcontext-in-controller", "targets": ["backend/Controllers/"], "matches": "DbContext", "message": "控制器不得直接持有 DbContext" }
  ]
}
```

- **字段说明**：`forbidden[]` 的 `id` / `targets` / `message` 必填，`contains`（字面子串）与 `matches`（正则）至少配一方，`unless` 正则豁免命中行，`exclude` glob 豁免整文件，`optional: true` 允许字面目标缺失，`once: true` 只报第一条；`noNavigationProperties[]` 的 `id` / `dir` / `message` 必填，`extraTypeNames` 补充类型名；`catchRequires[]` 的 `id` / `files` / `catch` / `require` / `message` 必填。

## .agents/hooks/delete-guard.json

- **作用**：声明目录内的删除调用必须登记到 `delete-guard-allowlist.txt` 并配防复发用例；脚本只做「新增删除路径须显式登记」的触发式审查。
- **何时触发**：pre-commit 静态门（`check-delete-guard.mjs`）；宿主写前拦截（`pre-write-check.cjs`）。
- **未配置语义**：文件缺失 = SKIP exit 0（未声明的项目自动跳过，不误伤）。
- **配置错误**：JSON 坏 / 顶层不是对象 / 未知键 / `scan` 缺失或为空 / `dir` 缺失 / 正则非法 → exit 2；声明目录不存在按违例 fail-closed 处理。
- **最小示例**：

```json
{
  "scan": [
    { "dir": "backend/Services", "ext": [".cs"], "call": "\\.(Remove|RemoveRange)\\(", "ignore": "_cache\\.Remove\\(" }
  ]
}
```

- **字段说明**：`scan[]` 每项只认 `dir`（必填，相对项目根）、`ext`（默认 `[".cs"]`）、`call`（命中删除调用的正则）、`ignore`（豁免正则）。按文件聚合计数，行号漂移不误报。

## .agents/hooks/audit-fields.json

- **作用**：受保护审计字段（如 `CreatedBy` / `UpdatedBy`）禁止在业务代码里手工补写，必须走项目统一写入路径。
- **何时触发**：pre-commit 静态门（`check-audit-fields.mjs`，默认扫暂存区新增行；`--range` 可扫指定范围，存量违例不拦）。
- **未配置语义**：文件缺失 = SKIP exit 0（项目没有审计字段守卫，不应拦人）。
- **配置错误**：读不了 / JSON 坏 / 顶层不是对象 / 未知顶层键 / `fields` 缺失或为空 / 字段名不是合法标识符 → exit 2。
- **最小示例**：

```json
{
  "fields": ["CreatedBy", "UpdatedBy"],
  "ext": [".cs"],
  "allowFiles": ["SeedData.cs"],
  "allowLines": ["SetAudit("]
}
```

- **字段说明**：`fields` 必填非空（每项须为合法标识符）；`ext` 默认 `[".cs"]`；`allowFiles` 路径含该子串即整文件豁免；`allowLines` 行内含该子串即豁免。判定口径：新增行出现「字段名后接 `??=` 或 `=`（不含 `==`）」且不是同名字段拷贝才计违例。

## .agents/config/test-impact-map.json

- **作用**：影响面选测的唯一映射——由改动路径推出应跑的测试类，避免「新增测试类未登记 → 推送时被静默跳过」。
- **何时触发**：pre-push 选测（`test-impact-lib.mjs`，无法判定时回退全量）；CI 重档 `--full` 跑 `check-test-impact-map.mjs` 硬校验。
- **未配置语义**：骨架态（`namespace` / `areas` / `paths` 均空）= 明确 SKIP exit 0，不做校验；文件缺失属前置缺失，检查 exit 1（保留随装骨架文件）。
- **配置错误**：映射读取 / 解析 / 校验失败 → exit 1（fail-closed，不静默跳过）。
- **最小示例**：

```json
{
  "version": 1,
  "namespace": "MyApp.IntegrationTests",
  "dirs": { "test": "tests/Integration", "unit": "tests/Unit", "fullchain": "tests/FullChain" },
  "faces": { "code": ["backend/"], "sql": ["db/"] },
  "areas": { "order": ["OrderTests"] },
  "always": ["SmokeTests"],
  "paths": [{ "glob": "backend/Order/**", "areas": ["order"] }]
}
```

- **字段说明**：`namespace` 测试命名空间（生成 vstest filter）；`dirs` 目录面 `test` / `unit` / `fullchain`（未声明 = 无法裁定，回退全量）；`faces` 代码面 `code` / `sql`（未声明 = 未知路径回退全量）；`areas` 业务域 → 该域的测试类（同一测试类可跨域）；`always` 任何集成子集必跑的基建/冒烟类（须已在 `areas` 登记）；`paths` 生产文件 glob → 业务域，按序首命中，未命中或 `areas` 含 `*` = 回退全量。

## .agents/config/local-gates.json

- **作用**：声明本机 clone 后必须设置的环境变量，典型是「专用测试库连接串」守卫（禁止连生产/共享库跑集成测试）。
- **何时触发**：手动 `flow-kit run check-local-gates.mjs`（clone 上岗自检）、`doctor --deep`；`testDb` 声明后按环境变量值判定。
- **未配置语义**：文件缺失，或没有 `testDb` 声明 = SKIP（该项目没有专用测试库约束，不静默、不误拦）。
- **配置错误**：JSON 解析失败 = 该检查项记缺失，脚本 exit 1（fail-loud）。
- **最小示例**：

```json
{
  "testDb": {
    "env": "TEST_DB_CONNECTION",
    "forbiddenDatabases": ["Production", "Master"]
  }
}
```

- **字段说明**：`testDb.env` 为环境变量名；`testDb.forbiddenDatabases` 为禁用库名（大小写不敏感）。环境变量存在、能解析出 `Database` / `Initial Catalog` 且不指向禁用库才算通过。

## .agents/config/lane-surfaces.txt

- **作用**：L2 触达面 ERE 清单——命中即表示本次改动触及「一处定义、多处消费」的契约 / schema 面。
- **何时触发**：verify 的 `lane-surface-ci` 门（关单 / CI diff 面）；`## engine` / `## product` 分段，标记行前的 ERE 默认归 engine。
- **未配置语义**：文件缺失或清单为空（只有注释）= 检查跳过（装户无感）。
- **配置错误**：非法 ERE 行 → 门禁 fail-closed 拦截（防静默空洞），修配置后重试。

## .agents/config/workflow-modules.txt

- **作用**：workflow 文档的模块词表单源（`模块:` frontmatter 取值），被建档、triage、索引与检索脚本共读。
- **未配置语义**：空词表 = 项目尚未登记模块枚举，不校验 `模块:` 取值；填写后表外值会被 triage 拒绝。

## .agents/hooks/notify-guard.json

- **作用**：通知守卫的扫描面与命中规则——目录、扩展名、命中正则、豁免文件清单。
- **何时触发**：pre-commit 静态门（`docs/events/` 之外的代码面提交）；规则模型里投影为 `notify.message-guard`（face=ui）。
- **未配置语义**：用内建默认（`frontend/src`、`.vue|.ts`、`message.error|warning|warn|info(`、豁免 `frontend/src/utils/notify.ts`）——与历史行为一致；目标目录不存在时静默跳过。
- **配置错误**：非对象 / 字段类型错 / 正则非法 → exit 2（错配不得当未配置放过）。
- **最小示例**：
  ```json
  {
    "targets": ["frontend/src"],
    "ext": [".vue", ".ts"],
    "pattern": "message\\.(error|warning|warn|info)\\s*\\(",
    "allowFiles": ["frontend/src/utils/notify.ts"]
  }
  ```
