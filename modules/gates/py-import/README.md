# py-import

暂存的业务 `.py`（路径中不含 `tests/` 或 `test/`）不得出现行首 `import tests`、`from tests`、`import test`、`from test`。

```sh
npx agentic-flow-kit add-gate py-import
```

这是边界的一个窄实现。更细的分层用项目自己的 import linter，按 `modules/gates/README.md` 的平铺约定挂上。
