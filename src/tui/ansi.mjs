// 零依赖 ANSI 渲染原语：转义序列、可视宽度、着色、进度条与圆角边框。
const ESC = '\x1b'; // 转义起始符（与 tui 其余文件的 \x1b 字面量写法统一）
// CSI 序列（ESC[ ... 字母）与 OSC 序列（ESC] ... BEL/ST）
const ANSI_RE = new RegExp(ESC + '\\[[0-9;]*[A-Za-z]|' + ESC + '\\][^\\x07]*(?:\\x07|' + ESC + '\\\\)', 'g');

// 移除 ANSI 转义序列
export function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

// 东亚宽字符区间（CJK/全角），可视宽度按 2 计
const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

export function visualWidth(str) {
  let width = 0;
  for (const ch of stripAnsi(str)) width += WIDE_RE.test(ch) ? 2 : 1;
  return width;
}

const paint = (code, reset) => (str) => ESC + code + str + ESC + reset;

export const cyan = paint('[36m', '[39m');
export const dim = paint('[2m', '[22m');
export const green = paint('[32m', '[39m');
export const red = paint('[31m', '[39m');

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// 第 n 帧 spinner（按帧表长度自动回绕）
export const spinner = (n) => SPINNER_FRAMES[n % SPINNER_FRAMES.length];

// 单行进度：回车 + 清行 + spinner + 进度条（TUI 逐文件进度渲染用）。detail 是当前文件，随下一帧被清掉。
export function progressLine(done, total, detail = '') {
  const tail = detail ? ` ${detail}` : '';
  return `\r\x1b[2K${spinner(done)} ${progress(done, total)}${tail}`;
}

export function progress(current, total, width = 24) {
  // total=0 时 filled=0，避免除零
  const filled = total > 0 ? Math.round((width * current) / total) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled) + ` ${current}/${total}`;
}

// 圆角边框盒：对齐按 stripAnsi 后的可视宽度计算，正文含 CJK/色码不歪
export function box(title, bodyLines) {
  const lines = bodyLines.map(String);
  const titleW = visualWidth(title);
  const inner = Math.max(titleW + 1, ...lines.map((l) => visualWidth(l)));
  const out = [`╭─ ${title} ${'─'.repeat(inner - titleW - 1)}╮`];
  for (const line of lines) {
    out.push(`│ ${line}${' '.repeat(inner - visualWidth(line))} │`);
  }
  out.push(`╰${'─'.repeat(inner + 2)}╯`);
  return out;
}
