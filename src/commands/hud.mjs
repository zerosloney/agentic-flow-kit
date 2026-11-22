import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { gatherHudState, renderHudView, hudWatchLoop } from '../tui/hud.mjs';

/**
 * hud 命令处理器
 */
export async function hudCommand({ args, t, lang = 'zh-CN' }) {
  const target = path.resolve(args.target || process.cwd());

  // 1. JSON 结构化输出模式
  if (flag(args, 'json')) {
    const state = gatherHudState(target, t);
    console.log(JSON.stringify(state, null, 2));
    return state.gate.passed ? 0 : 1;
  }

  // 2. 实时监听看板循环模式 (--watch)
  if (flag(args, 'watch') || flag(args, 'w')) {
    const interval = args.interval ? Number(args.interval) : 2;
    return hudWatchLoop({ target, t, lang, interval });
  }

  // 3. 快照单次看板渲染模式
  const state = gatherHudState(target, t);
  const view = renderHudView(state, t);
  console.log(view);
  return state.gate.passed ? 0 : 1;
}
