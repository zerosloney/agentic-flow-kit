# 评审成本纪律：面板只跑一次，并发会话分槽

> **退役注记（2026-11-09，owner 指令）**：PR 面板自动门已拆——pre-push / CI / pr-create 不再强制评审台账。
> 本页保留为**手动跑面板**的成本纪律，fast 档实测数据留档；编排入口移至 `.agents/commands/pr-review.md`。

来源：2026-11-07/08 出库表头附件交付（run `pr-8fb73ea` / `pr-9e50909` / `pr-741f609` / `pr-6b535e0` 四轮面板，实测 ~2.5 小时，其中两轮完全作废）。`pr-review` 脚本只写「怎么跑」，本页写「什么时候跑、跑几次」——**流程约束，不重复工具细节**。

## 规则

1. **一次评审原则**：同一交付批次的面板评审**只跑一次**。顺序固定为
   **整改全部落地 → 提交 → `plan` → finder/verifier → `dispose` → `summary` → 推送**。
   禁「边评审边改」：`run.json` 的 `diffHash` 绑定 base..head，head 一变台账即失效，必须整轮重跑。
2. **拿到 findings 后先改完再重开**：本轮确认项（`confirmed`）一次性改完并提交，再对**新的 head** 起新一轮；
   不允许「改一条 → 重评 → 再改一条」（每轮 3 lens，2026-11-08 档 3 减配）。
3. **先看 dispose 结论再决定改不改**：`waived` / `deferred` / `rejected` 的项不产生代码改动，
   不要为它们改 head（改了就白跑一轮）。
4. **并发会话必须分槽**：同一台机器上多个会话/多个 agent 并行时，各自设 `SHIPYARD_SLOT`
   （端口槽与派生规则单源：`runtime-env.md` §6.1b）。共用一个槽会同时顶「工作区文件」与「分支 HEAD」，
   评审期间 head 漂移 = 台账失效（本次实测另一会话在同分支追加了 `a4b347a02` / `02d269a79` / `c77f50b44`）。
5. **引擎面提交不跑面板**：范围只落 `.agents/` `.githooks/` `.codebuddy/` `.trae/` `workflow/` `wiki/` `docs/`
   与根配置时不值得起面板（原 pre-push 引擎面豁免随 2026-11-09 自动门退役，改人工把握）；
   手动起面板前发现范围纯引擎/文档 → 这是文档任务，别跑面板。

## 判定清单（起面板前逐条自答）

- [ ] 本轮改动是否**已全部提交**？工作区是否只剩与本批无关的其它任务文件？
- [ ] 是否**没有**待改的 confirmed finding？（有 → 先改，别起面板）
- [ ] 本会话是否独占端口槽 / 分支？（不独占 → 先设 `SHIPYARD_SLOT` 或换分支）
- [ ] 改动范围是否真的含业务面？（纯引擎/文档 → 不值得跑面板）

任一条为「否」，起面板就是浪费。

## 成本事实（供判断，2026-11-08 实测）

| 动作 | 耗时 | 备注 |
|---|---|---|
| 单轮面板 finder（6 lens；2026-11-08 起减配 3 lens） | 8–27 min（6 lens 时实测） | 单份 brief 最大 131 KB（内嵌 diff 80 KB + base 50 KB） |
| 单轮面板 verifier | 12–21 min | 改后：默认 1 票，Important/security 追加 1 票 |
| `pre-push` 本地门 | 改前 110–130 s / 改后 15–20 s | 集成档默认交 CI（`PREPUSH_RUN_INTEGRATION=1` 可本地复现） |
| 一次「改完就重评」的返工 | +15–30 min | 本次因顺序倒置浪费两轮（~33 min） |
| fast 档单轮面板（--fast；单镜头单票，目标 ≤5 min） | **实测 377s**（零仓库读 finder 2 次工具调用 343s + 脚本 34s；首跑含队列 640s） | 模型延迟是地板，超硬顶按 fast-timeout 收口；判据与编排契约：`.agents/scripts/pr-review.mjs` 头注 fast 档节 + config `fast` 节 |

## 相关单源

- 评审面板机制与命令：`.agents/scripts/pr-review.mjs`（--help）+ `.agents/commands/pr-review.md`
- 确认门与三件套顺序：`.agents/notes/process-order-rule.md`
- 端口槽与并发：`.agents/notes/runtime-env.md` §6.1b（**本页不复述端口数值**）
- 门禁卡口一览：`.agents/notes/engine-map.md`
