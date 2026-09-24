---
状态: done
级别: L1
模块: pipeline
---
# PLAN — npm 打包排除 templates/_agents/cache 防线

对应入口：../incidents/2026-09-24-npm-pack-cache-leak.md

## 改动面（L1 极简形态主节）
- `package.json`：files 数组追加 `!templates/_agents/cache` 与 `!templates/_agents/cache/**` 负向排除（实测根 .gitignore / 根 .npmignore 对 files 白名单目录内的被忽略文件均不生效；负向模式 npm 10/11 双版本生效）
- `package.json`：scripts.prepack 兜底 `rmSync('templates/_agents/cache',{recursive:true,force:true})`——不依赖 npm ignore 语义，任何打包路径物理清除（实测打包时残留被自动删除）
- `src/pack.test.mjs`（新增）+ `src/run-tests.mjs`（注册套件）：P1 断言负向排除在位 / P2 断言 prepack 在位，两道防线任一被移除即红

## 验证方式
- 静态门：`npm test` 全绿（含新增 P1/P2）
- 实测：`npm pack` 实打比对实发 0.4.0 tarball——包清单差异仅「新增 src/pack.test.mjs + 不含 cache」两处，其余 122 文件零误伤；npm 10.9（CI node22 同大版）与 11.16 本地双版本各验一轮
- 闭环：随 incident 置终态关单

## 确认与复核
- 确认结果：approved（2026-09-24 用户对话内确认加防线，实施与双版本验证过程在对话留痕）；done（2026-09-25 提交关单，随 incident 置 closed）
- 确认门记录：改动面 = 打包配置单点两道防线 + 配置断言用例；方案比选（files 负向 / 子目录 .npmignore / 根 .npmignore）已在对话留痕
