/**
 * PI 宿主接线（本机私有，.pi/ 已 gitignore）。
 * 把 PI 的 tool_call 桥到仓库既有的 .agents/hooks/*.cjs 门禁；
 * 判据单源仍在 .agents/hooks/，本文件不复制任何规则。
 *
 * 覆盖：
 *   bash / ctx_execute / ctx_batch → pre-shell-check.cjs
 *   write / edit → pre-write-check.cjs
 * 另含 L1 自保护：.pi/ 接线区写入须人工确认 + 会话启动接线完整性自检。
 */
// /reload 只重编译 TS 扩展，CJS 依赖会留在 require 缓存里：旧 core 缺新导出会让每次
// tool_call 抛 TypeError。加载时按 cwd 强制重读磁盘副本，保证 core 与 TS 同步。
import { createRequire } from "node:module";
import path from "node:path";

const req = createRequire(path.join(process.cwd(), "pi-host-noop.js"));
const corePath = path.join(process.cwd(), ".pi", "extensions", "lib", "gates-core.cjs");
delete req.cache[req.resolve(corePath)];
const core = req(corePath);

const PRE_GATES: Record<string, string> = {
  bash: "pre-shell-check.cjs",
  // 代码执行类工具：core.toHookPayload 会把工具名规范化为门禁可识别的 bash 视图，
  // 并交出 code / commands 作为命令文本，避免形成命令门绕过口。
  ctx_execute: "pre-shell-check.cjs",
  ctx_batch: "pre-shell-check.cjs",
  write: "pre-write-check.cjs",
  edit: "pre-write-check.cjs",
};
// 会话内解锁：人工确认一次后 5 分钟内不再重复询问（纯内存态，PI 的文件工具改不到）。
const SELF_UNLOCK_MS = 5 * 60 * 1000;
let selfUnlockUntil = 0;

export default function (pi: any) {
  pi.on("session_start", async (_event: any, ctx: any) => {
    const cwd: string = ctx.cwd || process.cwd();
    const state = core.checkWiring(cwd);
    if (state.ok) return;
    const msg = `PI 门禁接线不完整，缺失：${state.missing.join("、")}。写前门/命令门可能未生效，请检查 .pi/extensions 与 .agents/hooks。`;
    if (ctx.hasUI) ctx.ui.notify(msg, "error");
    console.error(`[shipyard-gates] ${msg}`);
  });

  pi.on("tool_call", async (event: any, ctx: any) => {
    const tool = String(event.toolName || "");
    const cwd: string = ctx.cwd || process.cwd();
    const input = event.input || {};

    // L1 自保护：.pi/ 接线区不入库、git 侧不可见，任何写入须人工确认。
    // 代码执行类工具同样能写 .pi/，按 core 提取出的命令文本判写入语义。
    const isShellTool = PRE_GATES[tool] === "pre-shell-check.cjs";
    const touchesPi =
      ((tool === "write" || tool === "edit") && core.isProtectedPiPath(input.path, cwd)) ||
      (isShellTool && core.isPiWriteCommand(core.toShellCommand(tool, input)));
    if (touchesPi && Date.now() >= selfUnlockUntil) {
      const where = String(isShellTool ? core.toShellCommand(tool, input) : input.path || "").slice(0, 160);
      const reason = `本次调用会改写 .pi/ 接线区（不入库、git 不可见，改后门禁可能失效）：${tool} → ${where}`;
      if (!ctx.hasUI) return { block: true, reason };
      const ok = await ctx.ui.confirm("PI 接线区写入需确认", reason);
      if (!ok) return { block: true, reason };
      selfUnlockUntil = Date.now() + SELF_UNLOCK_MS;
    }

    const script = PRE_GATES[tool];
    if (!script) return;

    const result = core.runGate(
      script,
      core.toHookPayload(tool, event.input, cwd, "PreToolUse"),
      cwd,
    );

    // 门禁脚本不可用时不放行：静默绕过比阻断更危险。
    if (result.failed) {
      return {
        block: true,
        reason: `门禁脚本未成功执行（${script}）：${result.failure || `exit ${result.status}`}。为避免静默绕过，本次调用已阻止。`,
      };
    }

    const out = result.output;
    if (!out) return;
    if (out.decision === "deny") return { block: true, reason: out.reason || "门禁拒绝" };
    if (out.decision === "ask") {
      const reason = out.reason || "命令门禁要求人工确认";
      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm("命令门禁需确认", reason);
        if (!ok) return { block: true, reason };
        return;
      }
      return { block: true, reason: `需人工确认（当前模式无交互 UI）：${reason}` };
    }
  });

}
