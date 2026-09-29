# node-layer

暂存的 `src/**/*.{js,mjs,cjs,jsx,ts,tsx}` 不得 `import` / `require` `tests/`、`test/` 或 `__tests__/`。

```sh
npx agentic-flow-kit add-gate node-layer
```

装进 `.agents/hooks/` 后归项目所有。目录名或更多禁引路径直接改脚本里的判断。
