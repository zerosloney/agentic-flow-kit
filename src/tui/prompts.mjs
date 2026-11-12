// 问答原语层：交互路径走 keypress widget（经 screen.mjs 的 runPrompt），
// 非交互终端降级为「编号 + 回车」读行问答。本层只经 screen 输出，不直接触碰终端状态。
import { box, dim, red } from './ansi.mjs';
import { createSelect, createMultiSelect, createConfirm, createTextInput } from './widgets.mjs';
import { runPrompt } from './screen.mjs';

// 降级问答原语：每轮打印「题干 + 选项行 + 行内提示」→ 读一行 → parse 裁决。
// parse 返回 { value } 结束；{ error } 红字重试；{ silent } 静默重印（如切换勾选后刷新行）；
// undefined 视为非法输入，红字提示后重试。EOF（stdin 关闭）一律返回 null。
async function askLine(ctx, { question = '', rows = () => [], prompt, parse }) {
  const { screen, t, reader } = ctx;
  while (true) {
    const lines = [...(question ? [question] : []), ...rows()];
    if (lines.length) screen.output.write(lines.join('\n') + '\n');
    screen.output.write(prompt);
    const line = await reader();
    if (line === null) return null;
    const result = parse(line.trim());
    if (result === undefined) screen.output.write(`${red(t('tui.invalidNumber'))}\n`);
    else if (result.error) screen.output.write(`${red(result.error)}\n`);
    else if (!result.silent) return result.value;
  }
}

// 降级三问：只保留 rows 生成与 parse，循环/读行/EOF/重试归 askLine
async function askSelectDegraded(ctx, { question, items }) {
  const { t } = ctx;
  return askLine(ctx, {
    question,
    rows: () => items.map((it, i) => `  ${i + 1}. ${it.label}${it.hint ? `  ${dim(it.hint)}` : ''}`),
    prompt: `${t('tui.inputNumber')} `,
    parse: (s) => {
      const idx = Number(s) - 1;
      return Number.isInteger(idx) && idx >= 0 && idx < items.length ? { value: items[idx].value } : undefined;
    },
  });
}

async function askMultiSelectDegraded(ctx, { question, items, min = 1 }) {
  const { t } = ctx;
  const checked = items.map((it) => it.checked === true);
  return askLine(ctx, {
    question,
    rows: () => items.map((it, i) => `  ${i + 1}. [${checked[i] ? 'x' : ' '}] ${it.label}${it.hint ? `  ${dim(it.hint)}` : ''}`),
    prompt: `${t('tui.toggleNumber')} `,
    parse: (s) => {
      if (s === '') {
        const value = items.filter((_, i) => checked[i]).map((it) => it.value);
        return value.length < min ? { error: t('tui.minSelection', { min }) } : { value };
      }
      const idx = Number(s) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < items.length) {
        checked[idx] = !checked[idx];
        return { silent: true };
      }
      return undefined;
    },
  });
}

async function askConfirmDegraded(ctx, label, defaultYes = true) {
  return askLine(ctx, {
    prompt: `${label} ${defaultYes ? '[Y/n]' : '[y/N]'} `,
    parse: (s) => {
      if (!s) return { value: defaultYes };
      if (s === 'y' || s === 'yes') return { value: true };
      if (s === 'n' || s === 'no') return { value: false };
      return undefined; // 非法输入红字提示后重试（原为静默重印，统一归 askLine）
    },
  });
}

// 交互 / 降级统一入口；降级路径 EOF 一律返回 null
export function pickOne(ctx, { question, hint, items, cursor = 0 }) {
  const { screen, t } = ctx;
  if (screen.interactive) {
    return runPrompt(screen, { title: t('tui.title'), question, hint, widget: createSelect({ items, cursor }) });
  }
  return askSelectDegraded(ctx, { question, items });
}

export function pickMany(ctx, { question, hint, items, min = 1 }) {
  const { screen, t } = ctx;
  if (screen.interactive) {
    return runPrompt(screen, {
      title: t('tui.title'),
      question,
      hint,
      widget: createMultiSelect({ items, min, minMessage: t('tui.minSelection', { min }) }),
    });
  }
  return askMultiSelectDegraded(ctx, { question, items, min });
}

export function confirmYes(ctx, label, defaultYes = true) {
  const { screen, t } = ctx;
  if (screen.interactive) {
    return runPrompt(screen, {
      title: t('tui.title'),
      question: label,
      hint: t('tui.hint.moveEnter'),
      widget: createConfirm({ yesLabel: t('tui.yes'), noLabel: t('tui.no'), defaultYes }),
    });
  }
  return askConfirmDegraded(ctx, label, defaultYes);
}

export function askText(ctx, { question, hint, initial = '', placeholder = '', validate = () => null }) {
  const { screen, t } = ctx;
  if (screen.interactive) {
    return runPrompt(screen, {
      title: t('tui.title'),
      question,
      hint: hint || t('tui.hint.typeEnter'),
      widget: createTextInput({ initial, placeholder, validate }),
    });
  }
  return askLine(ctx, {
    question,
    rows: () => (placeholder ? [dim(placeholder)] : []),
    prompt: `${t('tui.hint.typeEnter')} `,
    parse: (s) => {
      const err = validate(s);
      return err ? { error: err } : { value: s };
    },
  });
}

export function showLines(ctx, lines) {
  if (ctx.screen.interactive) ctx.screen.render(lines);
  else ctx.screen.output.write(lines.join('\n') + '\n');
}

export function showError(ctx, err) {
  const { t } = ctx;
  const message = err && err.message ? err.message : String(err);
  // 多行 message 先拆行再进 box，避免转义后残影错位
  showLines(ctx, box(t('tui.errorTitle'), message.split('\n').map(red)));
}
