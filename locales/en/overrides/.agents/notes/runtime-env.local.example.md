# Runtime Environment Registry (machine-specific template — copy to `runtime-env.local.md` and fill in per actual conditions)

> **This file is the checked-in template; the real file `runtime-env.local.md` is git-ignored — each machine registers its own, and it is not committed or shared.**
> For the mechanics and resolution order see `runtime-env.md` §6.3. Consumers (they automatically read the "Tool" table rows at runtime):
> 5 dwf workflows (`.zcode/workflows/*.dwf.ts`), `scripts/verify/e2e/browser-resolve.mjs`, `.agents/scripts/check-local-gates.mjs`.
> Unregistered tools get built-in standard-install-location probing (node/dotnet/git tried candidate by candidate via `--version`, browser probed by filesystem existence);
> **registration is only for overriding non-standard install locations** — after cloning, first run `node .agents/scripts/check-local-gates.mjs`,
> and use its output to decide which tools need registration.

| Tool | Local path | Notes |
|---|---|---|
| node | <example: D:/Program Files/NodeJs/node.exe> | standard install (C:/Program Files/nodejs) needs no registration |
| npm-cli | <example: D:/Program Files/NodeJs/node_modules/npm/bin/npm-cli.js> | can be omitted: when dwf is unregistered it is derived automatically from the node directory |
| dotnet | <example: C:/Program Files/dotnet/dotnet.exe> | standard location, no registration needed |
| git | <example: C:/Program Files/Git/cmd/git.exe> | standard location, no registration needed |
| bash | <example: C:/Program Files/Git/bin/bash.exe> | only needed on machines where `bash` is not on PATH; to get the exit code, run `& "<this path>" -c '…; echo EXIT=$?'` |
| browser | <example: C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe> | only needed when the browser is installed in a non-standard location; alternatively use the env var `CHROME_PATH` |

## Other machine-specific facts (for agents to read; no machine consumers)

- <example: terminal defaults to PowerShell; local Chrome 83 engine too old and disabled; CPU core count and other measured facts>
