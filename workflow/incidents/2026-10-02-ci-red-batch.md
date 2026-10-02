---
状态: closed
级别: L1
发现: 2026-10-02
模块: pipeline
确认指纹: 4da85ceb0ef2d8f2
---
# INCIDENT — CI/Release 全红批（pre-push 测试平台缺陷 ×2 + owned 台账漂移）

## 时间线

- 2026-10-02 08:01 用户发现 GitHub Actions 两个工作流（CI / Release）自 v0.9.1（2026-10-01 12:19 起）全部失败，最后绿的 run 在 2026-10-01 10:39
- 2026-10-02 定位三个独立根因（详见「根因」）：
  - ① `templates/_agents/scripts/pre-push.test.mjs` 挂钩子未设执行位 → Linux 上 git 静默跳过不可执行钩子，ubuntu 双 Node 腿 `argv 含 --hardening` 2 断言失败（Windows 不看执行位全绿）
  - ② 该测试随 sync 落到 `.agents/scripts/` 后钩子相对路径 `../../_githooks` 悬空（装户钩子在仓库根 `.githooks/`）→ Windows CI `.agents` 套件 setup 即 ENOENT 崩溃（本地 Windows 同样复现）
  - ③ fc95150 手改 owned 文件 `.agents/settings.json` 后未跑 sync 刷台账 → doctor §6.6 owned 漂移 FAIL，main 的 CI 挂在门禁步
- 2026-10-02 附带处置：此前 v0.9.4 tag 打在非发版提交上（package.json 仍 0.9.3）被 Release 版本守卫拦截——已删远端+本地 tag，随本批修复后走正式 0.9.4 发版重打
- 2026-10-02 用户确认：方案 a——删 tag、修三缺陷、正式发版 0.9.4 重打（对话内原话「方案 a（推荐）」）

## 影响面

- CI（main push，ubuntu×2 / windows×2）与 Release（tag push，ubuntu）自 2026-10-01 12:19 起全红；v0.9.1 之后 v0.9.2 / v0.9.3 两个 tag 的 Release 均未走到 npm publish——npm 侧停留 0.9.1，git tag 已到 v0.9.3（双源版本错位）
- 装户影响：无——三缺陷均在测试基建与包源台账，不触及引擎运行时行为

## 根因

1. **测试挂钩子未设执行位（Linux 平台缺陷）**：`setup()` 用 `copyFileSync` 落 pre-push 后无 `chmod +x`——Linux 上 git 静默跳过不可执行钩子，推送成功但桩 `check-loop.sh` 无 argv 记录，两个 `--hardening` 断言失败；「推送成功」断言反而通过，掩盖方向
2. **钩子相对路径仅 templates 布局成立**：`SCRIPT_DIR/../../_githooks` 在包源（`templates/_githooks/` 存在）正确，随 sync 原样落 `.agents/scripts/` 后指向不存在的仓库根 `_githooks/`（装户钩子在根 `.githooks/`）——装户侧套件崩溃
3. **owned 台账未随盘面刷新**：fc95150 直改 `.agents/settings.json`（deny `--no-verify`）后未跑 `node bin/flow-kit.mjs sync`——owned sha 记账漂移（sync 本具备盘面自愈能力，属漏跑而非机制缺失）

深层：pre-push.test.mjs 是 v09-review-defects（2026-10-01）修复新增件，只在 Windows 本地验证过即随 v0.9.1 发版——「Windows 绿 = 绿」的平台盲区；CI 从 v0.9.1 起持续红，但后续发版推送未等 CI 结论即打 tag。

## 为什么之前没拦住

- **门禁层**：pre-commit 各门不跑 `*.test.mjs`（测试不进提交门，关单在 test 阶段——但发版时未先跑全量 `npm test`）
- **流程层**：CI 红灯未被发版动作消费——10-01/10-02 的 tag 推送未确认 CI 结论；Release 复用同一 `npm test` → 连带红、npm publish 从未执行
- **审查层**：v09-review-defects 当次复核聚焦钩子判定逻辑改写本身，新增测试件未做平台矩阵复跑

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：`8121e4d`（fix(test)：测试双修 + sync 台账自愈；立档 `81c92bd`）
   - ① `templates/_agents/scripts/pre-push.test.mjs`：挂钩子后 `chmodSync 0o755`（Linux 执行位）② `PRE_PUSH` 改双布局探测（templates `_githooks` / 装户 `.githooks`）③ 跑 `node bin/flow-kit.mjs sync`——managed 装副本成对更新 + owned sha 盘面自愈（治 ③）
   - 影响环境：dev（包源）+ CI（ubuntu/windows）+ 装户（sync 下发）
   - 是否需要新 intent：否——实现级缺陷单点修复完成，防复发用例即修复后的测试自身（见下）
2. 防复发验证（落到自动化用例）
   - 自动化用例：`pre-push.test.mjs` 6/6——修复后 Linux 两断言（`main→main argv 含 --hardening` / `experiment/x→main argv 含 --hardening`）转绿即为回归用例；`.agents/scripts/pre-push.test.mjs`（装户侧副本）setup 不再 ENOENT
   - 全量回归：`npm test` 全绿 + `doctor` owned 漂移 0
3. 规范条目
   - 理由：已有条目覆盖——引擎双源纪律（AGENTS.md 项目适配区「改 templates 后 sync」）与本 incident 本身；平台矩阵验证教训记入本件供 kb-search 检索，不再新增长驻规则面
