// 降级向导 e2e fixture：非 TTY stdin 直调 wizardCommand，退出码透传。
// 测试经 spawn 喂行：`5\n` 选宿主列表 → 断言宿主表 → `n\n` 拒绝「返回菜单」→ exit 0；
// 直接关闭 stdin（EOF）则应在主菜单干净退出。
import { wizardCommand } from '../../src/tui/wizard.mjs';
import { makeT } from '../../src/i18n.mjs';

wizardCommand({ t: makeT('zh-CN'), lang: 'zh-CN' }).then(
  (v) => process.exit(typeof v === 'number' ? v : 0),
  (err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  },
);
