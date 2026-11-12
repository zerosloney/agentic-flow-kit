// 状态机 + 视图行，不接触 IO（不读 stdin、不写 stdout），渲染与接线由上层完成。
import { cyan, dim, green, red } from './ansi.mjs';

// select：单选列表。items: [{ value, label, hint? }]
export function createSelect({ items, cursor = 0 }) {
  let idx = cursor;
  const n = items.length;
  return {
    view() {
      return items.map((it, i) => {
        const head = i === idx ? cyan(`❯ ● ${it.label}`) : dim(`  ○ ${it.label}`);
        return it.hint ? `${head}  ${dim(it.hint)}` : head;
      });
    },
    onKey(key) {
      if (key.name === 'up') idx = (idx - 1 + n) % n;
      else if (key.name === 'down') idx = (idx + 1) % n;
      else if (key.name === 'return') return { value: items[idx].value };
      return undefined;
    },
  };
}

// multiselect：多选列表，min 为最少勾选数。items: [{ value, label, hint?, checked? }]
// minMessage：最少数量提示文案（可本地化注入），缺省为内置中文
export function createMultiSelect({ items, cursor = 0, min = 1, minMessage = `至少选择 ${min} 项` }) {
  let idx = cursor;
  const checked = items.map((it) => it.checked === true);
  let error = false;
  const n = items.length;
  return {
    view() {
      const rows = items.map((it, i) => {
        const head = checked[i]
          ? `${i === idx ? '❯ ' : '  '}◉ ${cyan(it.label)}${green(' ✓')}`
          : `${i === idx ? '❯ ' : '  '}○ ${dim(it.label)}`;
        return it.hint ? `${head}  ${dim(it.hint)}` : head;
      });
      if (error) rows.push(red(minMessage));
      return rows;
    },
    onKey(key) {
      if (error) error = false; // 任意键先清除错误提示
      if (key.name === 'up') idx = (idx - 1 + n) % n;
      else if (key.name === 'down') idx = (idx + 1) % n;
      else if (key.name === 'space' || key.sequence === ' ') checked[idx] = !checked[idx];
      else if (key.name === 'a' || key.sequence === 'a') checked.fill(!checked.every(Boolean));
      else if (key.name === 'return') {
        if (checked.filter(Boolean).length < min) {
          error = true;
          return undefined;
        }
        return { value: items.filter((_, i) => checked[i]).map((it) => it.value) };
      }
      return undefined;
    },
  };
}

// textinput：单行文本（模型 ID 手填）。view 返回一行；Esc 返回 null。
export function createTextInput({ initial = '', placeholder = '', validate = () => null } = {}) {
  let value = String(initial);
  let error = null;
  return {
    view() {
      const line = value ? `❯ ${value}█` : dim(`❯ ${placeholder}`);
      return error ? [line, red(error)] : [line];
    },
    onKey(key) {
      if (!key) return undefined;
      if (key.name === 'return') {
        const err = validate(value);
        if (err) {
          error = err;
          return undefined;
        }
        return { value };
      }
      if (key.name === 'escape') return { value: null };
      if (key.ctrl) return undefined;
      if (key.name === 'backspace') {
        value = value.slice(0, -1);
        error = null;
        return undefined;
      }
      if (key.sequence && !/[\x00-\x1f]/.test(key.sequence)) {
        value += key.sequence;
        error = null;
      }
      return undefined;
    },
  };
}

// confirm：是/否二选一（题干归 runPrompt 渲染，view 只返回两行选项）
export function createConfirm({ yesLabel = '是', noLabel = '否', defaultYes = true }) {
  let yes = defaultYes === true;
  const row = (text, active) => (active ? cyan(`❯ ● ${text}`) : dim(`  ○ ${text}`));
  return {
    view() {
      return [row(yesLabel, yes), row(noLabel, !yes)];
    },
    onKey(key) {
      if (key.name === 'left' || key.name === 'right') yes = !yes;
      else if (key.name === 'y' || key.sequence === 'y') yes = true;
      else if (key.name === 'n' || key.sequence === 'n') yes = false;
      else if (key.name === 'return') return { value: yes };
      return undefined;
    },
  };
}
