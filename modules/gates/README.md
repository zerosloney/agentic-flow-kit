# 门禁模块

可选红线。`flow-kit add-gate <名>` 把模块里除元数据外的文件平铺进 `.agents/hooks/`，并把 `local-pre-commit.line` 的那一行追加到 `.agents/hooks/local-pre-commit`。装完归项目所有，`sync` 不覆盖。

## 约定

| 文件 | 作用 |
|---|---|
| `check-*.mjs` 或其他脚本 | 拷入 `.agents/hooks/`，由 pre-commit 调用 |
| `local-pre-commit.line` | 一行挂载命令，不拷入项目；已有相同行则不重复 |
| `README.md` | 只留在包内 |

脚本只看暂存区，退出码非 0 即拦住这次提交。不要在模块里放子目录。

## 现有模块

| 名 | 拦住什么 |
|---|---|
| `dotnet-ca` | Clean Architecture 分层红线（参考实现） |
| `node-layer` | `src/` 引用 `tests/`、`test/`、`__tests__/` |
| `py-import` | 业务 `.py` 引用 `tests` / `test` 包 |
| `generated-readonly` | 手改 `GENERATED:BEGIN` 与 `GENERATED:END` 之间的行 |

项目自己的红线复制其中一个目录，改判断，再用 `add-gate` 装上。
