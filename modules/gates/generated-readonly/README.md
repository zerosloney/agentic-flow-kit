# generated-readonly

暂存 diff 若改到 `GENERATED:BEGIN` 与 `GENERATED:END` 之间的行，提交失败。生成器自己重写时：

```sh
FLOW_KIT_ALLOW_GENERATED=1 git commit
```

```sh
npx agentic-flow-kit add-gate generated-readonly
```

标记写在文件正文里。`workflow/INDEX.md` 与 `wiki/INDEX.md` 的生成区已经带这对标记。
