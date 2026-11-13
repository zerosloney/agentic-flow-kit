# 前端切面（frontend）

> 由 `--surface frontend`（或 `--stack <stack>+frontend`）叠加；与 stack profile 同层，同名文件后声明的 surface 覆盖前者。

- **验证面**：改 UI 先跑类型检查与构建，再按 `.agents/skills/verify-ui/SKILL.md` 做真实界面验证并留截图证据；像素对齐按 `visual-parity`，性能按 `perf`。
- **接口边界**：前端只消费已登记的 API 契约；契约变更走后端面，不在本切面顺手改。
- **证据**：UI 实测结论写进任务记录，链接截图或看板地址；仅凭静态阅读不得宣称“界面正常”。
- **门禁**：不绕过 commit / merge / push 钩子；本地 dev 端口与代理以 `.agents/notes/runtime-env.md` 为准。
