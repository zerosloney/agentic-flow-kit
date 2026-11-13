// TUI 向导入口：主循环表驱动 FLOWS；交互终端走 keypress 状态机（screen.mjs），
// 非交互终端降级为「编号 + 回车」问答（prompts.mjs）。
// 任何一步 EOF（stdin 关闭）都干净退出返回码 0；Ctrl+C 同样以退出码 0 退出。
import { createScreen, createLineReader, QuitError } from './screen.mjs';
import { pickOne, confirmYes, showError } from './prompts.mjs';
import { FLOWS, baseArgs } from './flows.mjs';

// 主菜单：无位置参数且无任何选项、交互终端时由 cli/main.mjs 懒加载进入
export async function wizardCommand({ t, lang }) {
  const screen = createScreen({ input: process.stdin, output: process.stdout });
  screen.setup();
  const ctx = { screen, t, lang };
  // 降级模式：会话级读行器（交互模式禁用，避免与 keypress 抢输入）
  if (!screen.interactive) ctx.reader = createLineReader(screen.input, screen.output);
  try {
    while (true) {
      const action = await pickOne(ctx, {
        question: t('tui.menuQuestion'),
        hint: t('tui.hint.moveEnter'),
        items: [
          { value: 'install', label: t('tui.menu.install') },
          { value: 'upgrade', label: t('tui.menu.upgrade') },
          { value: 'add-host', label: t('tui.menu.addHost') },
          { value: 'doctor', label: t('tui.menu.doctor') },
          { value: 'list-hosts', label: t('tui.menu.listHosts') },
          { value: 'remove-host', label: t('tui.menu.removeHost') },
          { value: 'uninstall', label: t('tui.menu.uninstall') },
          { value: 'quit', label: t('tui.menu.quit') },
        ],
      });
      if (action === null || action === 'quit') return 0;
      try {
        await FLOWS[action]?.(ctx);
      } catch (err) {
        if (err instanceof QuitError) return 0;
        // 命令抛错（如无 manifest）：红字 box 显示 message，confirm 后回菜单，不裸抛堆栈
        showError(ctx, err);
      }
      // 命令输出可能推进过光标，confirm 从当前位置新起一块
      screen.print('');
      const again = await confirmYes(ctx, t('tui.backOrQuit'));
      if (!again) return 0;
    }
  } catch (err) {
    if (err instanceof QuitError) return 0;
    throw err;
  } finally {
    screen.restore();
  }
}

// 纯函数：向导选择 → runInstall 入参（argv 形状与 cli/args.mjs parseArgs 经 baseArgs 一致）。
// git 配置 CLI 侧默认开，--no-git-config 关闭
export function buildInstallArgs({ hosts, lang, stack, gitConfig = true, dryRun = false, force = false, models = null }) {
  const args = {
    ...baseArgs(),
    _: ['install'],
    agents: hosts,
    lang,
    stack,
    flags: new Set([
      ...(gitConfig ? [] : ['no-git-config']),
      ...(dryRun ? ['dry-run'] : []),
      ...(force ? ['force'] : []),
    ]),
  };
  // 模型参数保持 opt-in：默认路径不新增 flag，避免破坏既有 argv 断言。
  if (models && Object.keys(models).length) args.tuiModels = models;
  return args;
}
