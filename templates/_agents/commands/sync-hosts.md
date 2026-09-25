---
description: 跨宿主适配层同步（正文段 sha 比对 + 用户拍板 + 单向 apply；frontmatter 不动）
stage: helper（横向工具，不占 6 阶段）
triggers:
  - "同步宿主适配层"
  - "改了角色契约要不要同步"
  - "扫一下宿主漂移"
delegation:
  - role: implementer
    instructions: .agents/roles/implementer.md
    when: 用户已确认同步范围与策略（仅 apply 大批同主题漂移时委托）
    required: false
    fallback: main
approval_required: true
next: .agents/commands/build.md（漂移属 build 改权威源未同步导致的，修复后回 build）
---

# Sync-Hosts · 跨宿主适配层正文段同步

> 改权威源（`templates/_agents/{commands,roles}/*.md`）后薄适配（`modules/hosts/<h>/{agents,commands}/*.md`）要同步——薄适配正文 = 权威源正文，frontmatter 各自保留宿主特化（trae commands 加 `name: wf-X`、opencode/zcode/omp 各自原描述）。
> 装户视角：`flow-kit doctor` §7.x 跑同名检查（仅装户，包源环境跳过——包源下永远是 drift）。

## 何时跑

- 改 `templates/_agents/commands/*.md` 正文后（8 个 commands 文件）
- 改 `templates/_agents/roles/*.md` 正文后（3 个 roles 文件）
- 装户跑 `flow-kit doctor` 报"跨宿主薄适配正文漂移 N 对" WARN 时
- 不跑：仅改 frontmatter；改 trae 钩子/规则；改包源其他文件

## 怎么跑

### 默认 `--diff`（仅报告）

```
node bin/flow-kit.mjs sync-hosts --diff
node bin/flow-kit.mjs sync-hosts --json   # 机器可读
```

输出三类：
- **正文对齐 N 对** — sha 一致，无需处理
- **正文段漂移 N（权威源 vs 薄适配 sha 不一致）** — `--apply` 同步方向；不区分"权威源改了"或"薄适配手改了"，由用户拍板
- **⚠️ 权威源声明但薄适配缺失** — `add-host <h>` 接管后跑 `--apply` 才会装（apply 不自动创建）
- **⚠️ 孤儿薄适配（权威源无对应文件）** — 历史残留或宿主特化，apply 不删

### `--apply` 单向同步

```
node bin/flow-kit.mjs sync-hosts --apply
```

按权威源正文覆盖薄适配正文段；薄适配原 frontmatter 保留（trae name: wf-X、opencode 描述、zcode/omp 中文风格各自不动）。apply 不反向同步——薄适配手改了正文也会被覆盖（这是设计选择，避免漂移方向歧义）。

### 自验

```
npm test                                       # 含 sync-hosts.test.mjs 8 场景
node bin/flow-kit.mjs doctor                   # 装户跑 §7.x PASS；包源跑 §7.x skipped
sh .agents/scripts/check-loop.sh                # Windows 无 sh 时 doctor 已探测分流
```

## 边界（不要做）

- 不要 `--apply` 反向同步（写权威源）：权威源是真相，薄适配手改会被覆盖——这是设计，apply 前先看 `--diff`
- 不要删除孤儿薄适配：可能是宿主特化或历史残留，apply 不动
- 不要改 frontmatter 让 sha 凑齐：frontmatter 是宿主特化字段（trae name: wf-X 等），工具不参与
- 不要把「避免与权威版本漂移」明文加回去——这是旧契约的指针风格，已被 B-b 正文副本取代
- 装了新宿主后跑 `--apply`：新宿主目录空白，apply 不会自动创建薄适配（薄适配须经 `add-host <h>` 接管）

## 不在本次同步范围

- trae 钩子（`modules/hosts/trae/hooks/*.cjs`）— 独立演进的工程件
- trae 规则（`modules/hosts/trae/rules/*.md`）— 同上
- 包源 .agents/scripts/*.cjs（pre-commit 等钩子）— 同步由 `flow-kit sync` 走 managed 台账负责

## 相关留痕

- intent：`workflow/intents/2026-09-25-cross-host-sync.md`
- plan：`workflow/plans/2026-09-25-cross-host-sync.md`（含 B-b 方案拍板）
- incident：`workflow/incidents/2026-09-25-wf-runtime.md`（双源纪律教训，规范 §7.x 包源环境跳过）