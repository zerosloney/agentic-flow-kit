---
状态: closed
级别: L1
发现: 2026-09-24
模块: pipeline
备注: 2026-09-24 用户核对「当前代码与 npm 打包版本是否一致」时发现——npm 实发 0.4.0 包混入测试残留 templates/_agents/cache/kb-index.json。M5 首发前曾手工清过一次同类残留（见 intents/2026-09-23-m5-npm-publish），系复发。修复已 npm 10/11 双版本 pack 实测。
---

# INCIDENT — 2026-09-24 npm 发布包混入 gitignore 的 cache 测试残留（0.4.0 实发）

## 时间线
- 2026-09-24 用户问「当前代码与 npm 打包版本是否一致」→ 拉取 npm 实发 0.4.0 tarball 与本地逐文件比对：122 个文件内容零差异，但包内多出 templates/_agents/cache/kb-index.json（gitignore 未跟踪件，提交后本地已无此文件）
- 定位：kb-search 测试会在 templates/_agents/cache/ 生成索引缓存；`files` 白名单列出 `templates` 后，npm-packlist 不再按根 .gitignore 排除白名单目录内的被忽略文件——.gitignore 规则（v0.2.0 起就有）形同虚设（实测根 .npmignore 同样不拦，子目录 .npmignore / files 负向模式才拦）
- 发布路径取证：v0.4.0 tag 已含 release.yml（469ebe6），CI 检出不可能带未跟踪文件 → 0.4.0 系本地手动 npm publish
- 修复：package.json files 负向排除 + prepack 物理清除 + pack.test.mjs 配置断言（P1/P2）；npm 10.9（CI node22 同大版）与 npm 11.16 本地双版本 `npm pack` 实测通过

## 影响面
- 仅 0.4.0 实发包多一个 19B 测试残留缓存（索引指向不存在的 /tmp/kb-search-test-* 临时目录），装户 init/sync 有 S10「cache 残留不被安装」防线不会被拷贝——无功能污染，属包卫生问题，不值得重发
- 本地检索缓存由 kb-search 首次运行再生，无数据损失

## 根因
npm `files` 白名单与 ignore 规则的交互误判：以为「files: templates + 根 .gitignore 排除 cache」双层生效，实测白名单目录内 ignore 规则不拦；深层原因：发布前无「包清单复核」步骤，残留有无全凭手工清账的运气。

## 为什么之前没拦住
- M5（2026-09-23）发布清单确实有「清 cache 残留」一项且手工清了；但测试每次重新生成，0.4.0 发布时残留已回来——一次性手工动作挡不住复发源
- 安装侧防线（S10）早有，打包侧零防线：无配置排除、无 prepack、无清单断言用例
- 发布走本地手动命令，release.yml 的 CI 干净检出路径未用上

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：随本单同一提交（package.json：files 负向 + scripts.prepack；src/pack.test.mjs 新增；src/run-tests.mjs 注册套件；本 incident + regression-checklist 条目）
   - 影响环境：dev（npm 包仓库本身；随下一版本发布生效，实发 0.4.0 不重发——残留无功能影响）
   - 是否需要新 intent：否（根因属打包配置单点遗漏，incident 即入口，L1 无需 plan 配对）
2. 防复发验证
   - 自动化用例：src/pack.test.mjs P1（files 负向排除在位）/ P2（prepack 清除在位），npm test 随跑——两道防线任一被移除即红
   - test 步骤：发布前 `npm pack --dry-run` 复核包清单不含 templates/_agents/cache（已实测 npm 10.9 / 11.16 双版本行为一致）
3. 规范条目
   - 落点：workflow/regression-checklist.md「防复发验证」节追加一行
   - 引用：文件:package.json（files 数组 / scripts.prepack）
