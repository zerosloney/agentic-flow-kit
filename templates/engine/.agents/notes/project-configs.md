# 项目级门禁配置总表

> 引擎与门禁机制随包装发，**规则与开关归项目**。本页是项目级配置的单一入口：先看总表定位，再看对应小节。
> 通用语义：配置缺失 = 该项能力未启用（各门按「未配置」跳过，不拦人）；文件存在但格式非法 = **fail-closed**——由消费脚本报错并按各自退出码失败，不能当「未配置」放过。具体退出码以各脚本源码头注为准。
> 写错必报错：规则包与各门禁配置一律按字段契约校验，未知字段、类型不符、必填缺失、正则非法都按配置错误处理（exit 2）并点名位置，不会被静默忽略；`_note`（字符串）是各层级都认的注释键。
> 自检：`flow-kit doctor` 的 gate coverage 段逐项报告「已配置 / 未配置（SKIP）/ 配置错误」，按规则模型统计各门禁族的生效规则数，并用 `git ls-files` 统计 faces 触发面命中的跟踪文件数（0 命中会告警）。

## 总表

| 文件 | 作用 | 何时触发 | 未配置语义 | 配置错误 |
|---|---|---|---|---|
| `.agents/config/project-faces.json` | 产品面（ui/code/tests/data）路径前缀单源 | 提交时 check-confirm-order；关单/CI 时 verify / verify-scope | 保守全触发：任何变更都按产品面 | exit 2 |
| `.agents/hooks/commit-check.config.json` | 条件构建 / 秒级质量检查 / 推送前测试 | pre-commit（builds/checks）；pre-push `--range`（pushTests） | 对应段全 SKIP | exit 2（JSON 坏 / 未知字段 / 条目残缺均 fail-closed） |
| `.agents/config/product-gates*.json` | 基础表之外的技术栈产品门 | verify（本地关单 / CI） | 无项目产品门 | exit 2 |
| `.agents/hooks/architecture-redlines.json` | 架构红线（forbidden / 导航属性 / catch 约束） | pre-commit 静态门；宿主写前拦截 | SKIP exit 0 | exit 2 |
| `.agents/hooks/delete-guard.json` | 删除调用扫描与 allowlist | pre-commit 静态门；宿主写前拦截 | SKIP exit 0 | exit 2 |
| `.agents/hooks/audit-fields.json` | 审计字段禁止手工补写 | pre-commit 静态门（暂存新增行） | SKIP exit 0 | exit 2 |
| `.agents/hooks/notify-guard.json` | 通知守卫：扫描目录 / 扩展名 / 命中正则 / 豁免文件 | pre-commit 静态门（目标目录全量） | 用内建默认（frontend/src + .vue/.ts + message.error/warning/info + utils/notify.ts 豁免） | exit 2 |
| `.agents/config/test-impact-map.json` | 影响面选测映射 | pre-push 选测；CI 重档 `--full` | 骨架态 SKIP exit 0（文件缺失属前置缺失 exit 1） | 读取/校验失败 exit 1 |
| `.agents/config/local-gates.json` | 本机必设环境变量（专用测试库） | `flow-kit run check-local-gates.mjs`、doctor `--deep` | SKIP（不拦） | 解析失败按缺项计 exit 1 |
| `.agents/config/check-loop.json` | check-loop 段策略（`redline.activeOnly`） | `flow-kit run check-loop.mjs`（pre-push / CI / 手动） | 默认判定：终态文档也判红线 | 解析失败 = 未启用（回落默认判定，不静默放行） |
| `.agents/config/lane-surfaces.txt` | L2 触达面 ERE 清单 | verify `lane-surface-ci`（关单 / CI diff 面） | 缺失或空 = 不校验 | 非法 ERE → 拦截 |
| `.agents/config/workflow-modules.txt` | workflow 模块词表 | 建档 / triage / 索引 / 检索 | 空 = 不校验 `模块:` 取值 | 词表外取值被 triage 拒绝 |

## .agents/config/check-loop.json

- **作用**：check-loop 的段级策略开关（可选）。当前唯一字段 `redline.activeOnly`。
- **语义**：`{"redline":{"activeOnly":true}}` → §1 红线判低只判活跃态文档（`draft` / `approved`），终态（`done` / `superseded` / `cancelled`）不判。
- **何时触发**：`flow-kit run check-loop.mjs`（pre-push / CI / 手动）。
- **未配置语义**：全量判定（终态文档也判红线）——缺省行为不变。
- **适用场景**：历史文档继续沉淀的项目；批量补级别会触发大量已 approved 文档的承诺面漂移（须逐份重确认）时，用它替代「按文件名日期豁免」这类移动靶口径。
- **边界**：只影响红线段；配对/回归证据/确认指纹/收敛对账等其余段不受影响。否定声明（「不触 … schema」）的剔除是 kit 内建通用规则，无需配置。

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
  "data": ["{{wikiMaintenance}}/"]
}
```

- **字段说明**：每键为数组，元素是仓库相对路径前缀（正斜杠；目录以 `/` 结尾；不接受绝对路径与 glob）。文件命中任一前缀即属于该面；未列出的路径（文档 / 工具链 / 引擎面）不触发产品门。

## .agents/hooks/commit-check.config.json

- **作用**：提交/推送路径上的三段执行器——`builds` 条件构建、`checks` 秒级确定性检查、`pushTests` 推送前测试。
- **何时触发**：pre-commit 跑 `builds`（常规提交带 `--no-build` 时跳过；合并提交走 `--full`）与 `checks`；pre-push 以 `--range <old> <new>` 跑 `builds` 与 `pushTests`。
- **未配置语义**：文件缺失或对应数组为空 → 该段 SKIP（`pushTests` 段完全不产生输出），不拦人。
- **配置错误**：读不了 / JSON 坏 / 未知顶层键 / 条目残缺 / 字段类型错 → exit 2（fail-closed：按未配置放过等于三段检查全部静默失效）。条目只认 `name` / `command` / `ext` / `prefix` / `cwd` / `when` / `whenEnv` / `timeoutMs` / `lockPattern` / `lockHint`，其中 `ext` 必须是数组，`prefix` 与 `when` 可为字符串或数组。
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

- **字段说明**：`id` / `name` / `cmd` 必填；`folder` 默认 `.`；`deps`（前置门 id）、`when`、`env`、`timeoutMs`（墙钟上限，毫秒）可选；`type` 默认 `shell`。不声明 `timeoutMs` = 不限时（与历史行为一致）。`when` 语义与 `commit-check.config.json` 一致（路径存在 / 尾部 `*` 一层通配 / `pkg:<点分路径>`），可写字符串或数组；不满足的门不进执行清单，只打 SKIP 行，不计失败。

## .agents/hooks/architecture-redlines.json

- **作用**：架构红线规则外置——`forbidden`（禁止内容）、`noNavigationProperties`（实体禁导航属性）、`catchRequires`（catch 块必须含指定符号）。脚本只实现「读规则 → 扫目标 → 报违例」的机制。
- **何时触发**：pre-commit 与宿主写前拦截统一经 `flow-kit rules check`（规则由本文件投影）；`check-architecture.mjs` 保留作手动复核。
- **未配置语义**：文件缺失，或三个数组全空 = SKIP exit 0（项目没有红线约定，不应拦人）。
- **配置错误**：读不了 / JSON 坏 / 顶层不是对象 / 未知顶层键 / 条目含未知字段 / 必填字段缺失 / 正则非法 / `id` 重复或格式不符 → exit 2。
- **最小示例**：

```json
{
  "forbidden": [
    { "id": "no-dbcontext-in-controller", "targets": ["backend/Controllers/"], "matches": ["DbContext"], "message": "控制器不得直接持有 DbContext" }
  ]
}
```

- **字段说明**：`forbidden[]` 的 `id` / `targets` / `message` 必填，`contains`（字面子串）与 `matches`（正则数组）至少配一方，`unless` 正则豁免命中行，`exclude` glob 豁免整文件，`optional: true` 允许字面目标缺失，`once: true` 只报第一条；`noNavigationProperties[]` 的 `id` / `dir` / `message` 必填，`extraTypeNames` 补充类型名；`catchRequires[]` 的 `id` / `files` / `catch` / `require` / `message` 必填。

## .agents/hooks/delete-guard.json

- **作用**：声明目录内的删除调用必须登记到 `delete-guard-allowlist.txt` 并配防复发用例；脚本只做「新增删除路径须显式登记」的触发式审查。
- **何时触发**：pre-commit 与宿主写前拦截统一经 `flow-kit rules check`（规则由本文件投影）；`check-delete-guard.mjs` 保留作手动复核与 `--update` 生成清单。
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
- **何时触发**：pre-commit 经 `flow-kit rules check` 扫暂存区新增行（规则由本文件投影，只看新增行，存量违例不拦）；`check-audit-fields.mjs --range` 可手动扫指定范围。
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

## dispatch.json 策略开关

- `reviewPolicy.enforceHeterogeneous`：异构评审开关。出厂 `false`（不强制，复核记录只需一行带上下文 id 的背书）；`true` 时复核须声明模型，且与起草 / 实现模型不同族；显式 `false` 时 CLI `--heterogeneous` 不生效；该键不写（缺省）才回退看 `--heterogeneous` 与 `roles.<角色>.heterogeneous`。L3 恒要求两位不同会话、不同模型族的复核人（`requireDualReviewLevels`）。
- `queuePolicy.enforceQueueBrake`：防洪队列熔断开关。出厂 `false`（不启用）；`true` 时 `start` 阶段活跃 run 数达到 `queuePolicy.maxActiveRuns`（缺省 3）即硬拦新单；CLI `--queue-brake` 可单次临时开启，`--force-queue` 可穿透并记录 `queue-brake-bypassed` 留痕事件；超过 14 天未更新的 run 视为陈旧，不计入活跃数。

## .agents/rules/ 与插件（rules v1）

- **作用**：统一规则模型——legacy（旧配置投影）← `stack.<栈名>.json`（kit 管理；多栈各带各的规则包，按文件名序叠加）← `project.json`（项目所有）← `local.json`（本机，git 忽略）逐层合并，同 id 后者整条替换；`{ "id": "...", "enabled": false }` 即可禁用下层同名规则。原语闭集：content / require / absence / inventory / env / command / navProperties / plugin。`command` 参数为 `run/cwd/env/timeoutMs/expectExit`：缺省退出码 0 才通过，`expectExit`（非负整数或其数组）声明其它预期退出码（如「反例必须被拦下」的负向门）。
- **执行入口**：`flow-kit rules validate | explain <id> | init [--force] | check [--staged|--range <old>..<new>|--files a,b] [--with-commands] [--prefix k,l] [--face k,l] [--phase p] [--json]`；pre-commit、宿主写前门、verify 的 code 门与产品门、commit-check（构建 / 质检 / 推送前测试）已走该入口；旧配置文件仍由 legacy 适配器投影（`rules validate` 会提示迁移路径）。退出码：0 通过、1 有 block 违例、2 配置或用法错误。
- **扫描面与裁剪**：`--staged` / `--range` 与全量模式都扫全仓（diff 作用域规则只看新增行），只有写前门的 `--files` 把扫描收窄到待写文件；`--prefix` 按 id 段匹配（`arch.` 选中 `arch.*`，`product.api` 不吞 `product.api-tests`）。`when` 数组内 OR，`pkg:` 读规则 `cwd`（产品门为 `folder`）下的 package.json；`whenEnv`（`KEY=VAL`）是与 `when` 并列的独立门槛，不满足不执行也不打印，写法有误的规则永不启用并会在输出里点名。
- **校验**：`rules validate` 除 schema 外还查引用——同层 id 重复、豁免指向不存在的规则、插件模块缺失、`when` / `whenEnv` 永不成立——有问题 exit 2。
- **写错必报错（schema）**：规则包里每个对象都按契约校验，报错用 JSON 路径定位并列出允许的键（如 `rules[0].assert.args 未知字段「unlesss」（允许：targets / files / …）`、`…matches[1] 正则非法（…）`）。只写 `{ "id": "...", "enabled": false }` 即可禁用下层规则；`when` 必须是非空字符串数组；`scope: "diff"` 只对 `content` 有意义。
- **原语参考**（`assert.args`，键闭集）：
  - `content`：仓库作用域（缺省）读 `targets` / `files`、`ext`（缺省 `.cs`）、`contains`（子串）、`matches` / `pattern`（正则）、`unless`（豁免命中行）、`exclude`（豁免整文件）、`allow: [{glob, pattern?}]`、`optional`、`once`；diff 作用域（`"scope": "diff"`，只看新增行）读 `ext`、`pattern`（必填）、`copyPattern`、`allowFiles`、`allowLines`。写了另一作用域才读的键会报错。
  - `require`：`files`（必填）、`ext`（目录目标的扩展名，缺省 `.cs`，缺省过滤下零匹配而目标内有其它类型文件时判违例，不静默通过）、`trigger` 与 `require`（均必填）、`exclude`、`optional`。
  - `absence`：`glob`（必填）、`unless`。`inventory`：`scan: [{dir, ext?, call?, ignore?, optional?}]` 与 `baseline`（均必填）。
  - `env`：`name`（必填）、`forbiddenValues`。`navProperties`：`dir`（必填）、`extraTypeNames`、`optional`。
  - `command`：`run`（必填；支持 `{old}` / `{new}`（range 的两个 sha）与 `{gradlew}`（Gradle 启动器：有 wrapper 用 wrapper，否则用 gradle）占位符）、`cwd`、`env`、`lockPattern`、`lockHint`、`name`、`deps`、`expectExit`（非负整数或其数组；不声明时只有退出码 0 通过）。
  - `plugin`：`module`（必填）、`config`（插件自己的契约，键不限）。
- **时限**：规则顶层 `timeoutMs`（毫秒）。`command` 缺省 10 分钟（与旧 commit-check 一致），`null` = 不限时（产品门的缺省值，与旧 verify 一致）；`plugin` 缺省 10 秒，只能是正整数。`rules explain <id>` 原样输出（不出现 = 用缺省值）。
- **豁免**：`waivers: [{ rule, glob?, expires, reason }]`——到期日与理由必填（豁免带到期与审计），到期自动失效并提示。
- **插件**：`.agents/rules/plugins/<module>.mjs` 子进程执行（stdin JSON `{version,root,files,face,faces,config}`，stdout JSON `{violations:[{file,line,message}]}`）；在 `project.json` 的 `plugins` 数组显式登记（id/module/face/phase/severity/timeoutMs/config），不自动加载目录，只能在项目层声明，栈层 / 本机层声明即报错；超时/崩溃按登记的 severity 记为违例，并留痕到 `.agents/cache/rules-plugins.json`（doctor 据此告警，同一条插件再次正常求值即清除）。
- **不进规则模型的旧配置**：`lane-surfaces.txt`、`workflow-modules.txt`、`test-impact-map.json` 是选择器 / 词表而不是规则，仍由各自脚本读取，`rules validate` 不列它们。
- **插件示例**：
  ```js
  // .agents/rules/plugins/no-console.mjs
  import fs from 'node:fs';
  const ctx = JSON.parse(fs.readFileSync(0, 'utf8'));
  const hits = (ctx.files || []).filter((f) => fs.readFileSync(f, 'utf8').includes('console.log'));
  process.stdout.write(JSON.stringify({ violations: hits.map((file) => ({ file, message: 'no console.log' })) }));
  ```
  ```json
  // .agents/rules/project.json（节选）
  { "version": 1, "plugins": [{ "id": "proj.no-console", "module": "no-console", "face": "ui", "phase": "pre-commit", "severity": "warn" }] }
  ```
- **未配置语义**：`rules` 层全空 = 没有额外规则；legacy 配置仍生效。
