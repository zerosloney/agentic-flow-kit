---
description: 跨宿主适配层同步（正文段 sha 比对 + 用户拍板 + 单向 apply；frontmatter 不动；横向工具）
---

> **装户边界**：本文档中 `src/`、`bin/flow-kit.mjs`、`templates/_agents/`、`modules/hosts/` 为 kit 包源仓视角引用——装户仓（无 `templates/` 包源）对应命令不适用，本仓以 `.agents/` 装副本为准。

# Sync-Hosts · 跨宿主适配层正文段同步

> 本命令只在包源仓运行（需要 `templates/_agents` 与 `modules/hosts`）。改权威源（`templates/_agents/{commands,roles}/*.md`）后薄适配（`modules/hosts/<h>/{agents,commands}/*.md`）要同步——薄适配正文 = 权威源正文，frontmatter 各自保留宿主特化（commands 层文件名 = 宿主命令名，opencode / trae 同用 `wf-` 前缀，单源见 `src/profiles.mjs#HOSTS.commandPrefix`；trae 另有 `name: wf-X`，zcode/omp 各自原描述）。
> 装户的宿主文件由 `init` / `add-host` 写入。装户漂移由 `flow-kit doctor` §6.7 报告（包源环境跳过）；刷新用 `flow-kit add-host <宿主> --force`。`flow-kit sync` 不更新宿主适配。

## 1. 何时跑

- 改 `templates/_agents/commands/*.md` 正文后（11 个 commands 文件）
- 改 `templates/_agents/roles/*.md` 正文后（3 个 roles 文件）
- 不跑：装户仓（本命令会拒绝）；仅改 frontmatter；改 trae 钩子/规则；改包源其他文件

## 2. 怎么跑

### 2.1 默认 `--diff`（仅报告）

```
node bin/flow-kit.mjs sync-hosts --diff      # 包源仓（在包源根跑，或 --dir <包源根>）
node bin/flow-kit.mjs sync-hosts --json      # 机器可读
```

输出三类：
- **正文对齐 N 对** — sha 一致，无需处理
- **正文段漂移 N（权威源 vs 薄适配 sha 不一致）** — `--apply` 同步方向；不区分"权威源改了"或"薄适配手改了"，由用户拍板
- **⚠️ 权威源声明但薄适配缺失** — `add-host <h>` 接管后跑 `--apply` 才会装（apply 不自动创建）
- **⚠️ 孤儿薄适配（权威源无对应文件）** — 历史残留或宿主特化，apply 不删

### 2.2 `--apply` 单向同步

```
node bin/flow-kit.mjs sync-hosts --apply
```

按权威源正文覆盖薄适配正文段；薄适配原 frontmatter 保留（trae name: wf-X、opencode 描述、zcode/omp 中文风格各自不动）。apply 不反向同步——薄适配手改了正文也会被覆盖（这是设计选择，避免漂移方向歧义）。

### 2.3 自验

```
npm test                                       # 含 sync-hosts.test.mjs
node bin/flow-kit.mjs doctor                   # 包源环境 §6.7 skipped
```

## 3. 边界（禁做）

- 禁 `--apply` 反向同步（写权威源）:权威源是真相,薄适配手改会被覆盖——设计如此;apply 前先看 `--diff`
- 禁删孤儿薄适配（可能是宿主特化或历史残留,apply 不动）
- 禁改 frontmatter 让 sha 凑齐（frontmatter 是宿主特化字段,如 trae name: wf-X,工具不参与）
- 禁把「避免与权威版本漂移」明文加回（旧契约的指针风格,已被 B-b 正文副本取代）
- 装了新宿主后跑 `--apply`：新宿主目录空白，apply 不会自动创建薄适配（薄适配须经 `add-host <h>` 接管）

## 4. 不在本次同步范围

- trae 钩子（`modules/hosts/trae/hooks/*.cjs`）— 独立演进的工程件
- trae 规则（`modules/hosts/trae/rules/*.md`）— 同上
- 门禁脚本与钩子（`templates/_agents/scripts`、`templates/_githooks`）— 由 `flow-kit sync` 按 managed 台账下发，不走 sync-hosts

## 5. 相关留痕

- 立法出处：2026-09-25 cross-host-sync（intent/plan，含 B-b 方案拍板；父事件 = wf-runtime 双源纪律教训，规范 §7.x 包源环境跳过）——留痕在包源仓 git 历史与 CHANGELOG，装户径不引实例路径
