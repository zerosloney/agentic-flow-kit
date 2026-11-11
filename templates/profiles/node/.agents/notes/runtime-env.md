# Runtime & Environment Facts

> 本文件是环境事实的单源登记处。新装户按项目实际替换端口、启动命令与工具解析结果；不要把绝对路径写入本文件（本机事实登记在 `runtime-env.local.md`，模板 `runtime-env.local.example.md`）。

## 1. 端口

| 服务 | 端口 | 槽位偏移 | 协议 | 启动命令 |
|---|---|---|---|---|
| API | {{apiPort}} | `+slot×10` | HTTP | `<API 启动命令>` |
| 前端 dev | {{webPort}} | `+slot×10` | HTTP | `<前端启动命令>` |
| 流程看板 | {{boardPort}} | `+slot×10` | HTTP | `node .agents/scripts/ensure-board.mjs` |

## 2. 本地 Clone 必做

```bash
git config core.hooksPath .githooks
git config merge.ours.driver true
git config merge.jsonl-union.driver "node .agents/scripts/git-merge-jsonl.mjs %O %A %B"
node .agents/scripts/check-local-gates.mjs --fix
```

## 3. 可执行文件解析

解析顺序：① 环境变量（浏览器仅 `CHROME_PATH`）→ ② `runtime-env.local.md` 工具表登记 → ③ 标准安装位置探测 → ④ 按名回退。

| 工具 | 用途 |
|---|---|
| `node` | 引擎脚本与 git 钩子（要求 ≥ 22） |
| `git` | 门禁与台账 |
| `browser` | UI 实测（仅 `verify-ui` / E2E 需要） |

## 4. 门禁与钩子

| 钩子 | 职责 |
|---|---|
| `pre-commit` | 静态门与引擎检查 |
| `commit-msg` | Conventional Commits 与 plan 引用 |
| `pre-merge-commit` | merge 提交转发 `pre-commit --full --merge` |
| `pre-push` | 闭环扫描、构建、范围门、宿主接线对账 |
| `post-commit` | 缓存回收与积压提醒 |

## 5. 已知环境缺陷

按项目实际补充；每条写「症状 / 判据 / 修法」。
