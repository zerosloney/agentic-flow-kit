---
状态: approved
级别: L2
模块: pipeline
确认指纹: d6e4d1374367c859
---
# PLAN — ledger-ci-invariant（台账提交不变量）

对应入口：../intents/2026-10-02-ledger-ci-invariant.md
对应 spec：../specs/2026-10-02-ledger-ci-invariant.md（真仓 90 提交前缀预检零违例，R1 已排除）

## 改动方案

- `templates/_agents/scripts/check-ledger-invariant.mjs`（新增）：双模式——①历史全扫：`git log --format=%H --reverse -- <台账>` 逐提交取 blob（`git show <sha>:<file>`，对象库 buffer 口径），每次变更须以旧 blob 为逐字节前缀（首异偏移进诊断）；终树行级校验五项（ts ISO 非降序 / fingerprint 64-hex / chat-delegated 必有非空 quote / doc 匹配 `workflow/(intents|specs|plans|incidents)/*.md` 且当前树存在 / stage ∈ 合法跳转集）。②`--staged`：暂存 blob（git show :file）须以 HEAD blob（HEAD:file）为前缀。台账缺失/零历史/未触暂存 → 静默 0
- `templates/_agents/scripts/check-ledger-invariant.test.mjs`（新增，检查 20 合规）：真 git 仓注入 fixture——合法追加 ×2 过 / 删历史行拦 / 改历史行拦 / 非前缀改写拦 / ts 乱序拦 / 伪指纹（非 64-hex）拦 / chat-delegated 空 quote 拦 / doc 路径不存在拦 / --staged 合法过 + 删改拦 / 首次入库过 / 空台账过
- `templates/_githooks/pre-commit`（+装副本）：managed 台账快检（check-ledger）之后接线 `--staged`（guard 存在性 + 暂存触台账才调）
- `.github/workflows/ci.yml`：checkout `fetch-depth: 0` + 机器门步骤追加 `node .agents/scripts/check-ledger-invariant.mjs`
- `workflow/README.md` + `templates/workflow/README.md`（owned 对）：硬规则第 6 条「台账不可变——历史行禁删改（CI 全扫 + pre-commit --staged 机器门），修正走追加补偿行」
- `.agents/kit.json`：sync 自动登记

## 任务拆解（L2/L3 必填）

1. 脚本本体（双模式）
   - 判据：真仓跑历史全扫 exit 0（90 提交 / 207 行实录）；fixture 各违例注入 exit 1 且消息含提交 SHA 与不变量类型
   - 风险：中（git 对象库读取、前缀比较、行级校验三层；消息格式沿门禁约定）
2. 测试套件
   - 判据：真 git 仓 fixture 全场景绿（含合法追加防误拦与首次入库/空台账静默）；npm test 全绿
   - 风险：低
3. pre-commit 接线（模板 + 装副本）
   - 判据：接线后本批自身提交实测（暂存触台账 → --staged 前缀过）；guard 旧副本跳过
   - 风险：中（改门禁编排本体；注意消息格式与标签约定）
4. ci.yml 接线 + README 硬规则 6（owned 对）
   - 判据：ci.yml diff 含 fetch-depth:0 与新步骤；README 对逐字一致
   - 风险：低
5. sync + 全量验证
   - 判据：sync 无漂移；npm test 全绿；verify 全绿；gate-checklist 0/0；真仓全扫 exit 0
   - 风险：低

## 执行顺序（L2/L3 必填）

1 → 2 → 3（依赖 1）→ 4（并行可）→ 5 收口。

## 验证计划

- 静态门：测试 = `npm test`（含新套件）；构建 = 无
- L2 追加：真仓历史全扫实录（90 提交/207 行 exit 0）；篡改注入六类全检出；本批提交实测 --staged 路径；独立复核不变量判据与 fixture 真实性
- 前端 / UI / L3：不适用

## 确认与复核

> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done。
- 确认结果：approved（2026-10-02 用户对话内确认，原话「确认」——plan 全文过目）；done（关单时随入口文档置终态）
- 确认门记录：plan 草稿全文过目 + 改动清单确认（改动方案节随 plan 全文一并过目确认）
- 复核：L2——independent-reviewer 复核前缀不变量不可绕面、fixture 真实性（真 git 仓）、CI 接线有效性