// 终端屏幕层：全仓唯一接触 stdin/stdout 的地方（终端状态机 + IO）。
// render 记住上次行数，重绘时上移清行重写（行数变化会清残留行）；print 重置渲染原点后写原始输出，
// 供 flows 在命令输出推进过光标时新起一块，无需感知光标行数协议。
// 降级模式在 setRawMode 不可用或非 TTY 直调时进入：交互全部改走「编号 + 回车」问答（prompts.mjs）。
// 视口高度裁剪明确不做：内容有界（最多 10 宿主选项 + 提示行），裁剪反而引入滚动定位复杂度。
// 交互按键弃用内置 readline.emitKeypressEvents、改用自研解码器（attachKeyDecoder）：内置解码器在部分
// Windows 终端 / Node 组合下对分片到达与 SS3 序列产出 undefined key（方向键 ↑↓ 失效），且事件契约不变。
// 解码器不监听 stdin close：真实 EOF 由上层兜底（runPrompt 的 close → QuitError、降级路径的 eof），
// 虚假 close（Windows 同步子进程后控制台句柄抖动）不得终止解码，否则 doctor 后的提问会冻结。
import readline from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import { box, cyan, dim } from './ansi.mjs';

// Ctrl+C / EOF 的退出哨兵：wizardCommand 捕获后返回 0，不裸抛堆栈
export class QuitError extends Error {}

// 方向键 / Home / End 映射：CSI（\x1b[<params><final>）与 SS3（\x1bO<final>，老终端）的终止字节 → key.name
const SEQUENCE_KEYS = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' };

// 自研轻量按键解码器：监听 stdin 原始 data，解出 key 对象后逐个 emit ('keypress', key)，
// 事件契约与内置解码器一致（runPrompt / widgets 无感知）。返回 detach：仅供 restore 摘监听、清计时。
// 不监听 close：真实 EOF 由 runPrompt 兜底，虚假 close（Windows 同步子进程控制台句柄抖动）不得终止解码。
function attachKeyDecoder(input) {
  const decoder = new StringDecoder('utf8'); // 多字节字符跨 chunk 边界在此拼合
  let buf = ''; // 未解完的余量（不完整转义序列前缀 / 孤立 ESC）
  let escTimer = null; // 孤立 ESC 的 50ms 等待计时
  const emit = (key) => {
    if (process.env.FLOW_KIT_KEY_DEBUG) console.error('[flow-kit key] emit:', JSON.stringify(key));
    input.emit('keypress', key);
  };
  const onEscTimeout = () => {
    escTimer = null;
    if (buf !== '\x1b') return; // 防御：等待期内已无孤立 ESC（正常应在 data 到达时清计时）
    buf = '';
    emit({ name: 'escape', sequence: '\x1b' });
  };
  const parse = () => {
    while (buf.length > 0) {
      if (buf[0] === '\x1b') {
        if (buf.length === 1) {
          // 只剩孤立 ESC：50ms 内无后续 → escape；期间 data 到达则清计时续解为序列
          if (escTimer === null) escTimer = setTimeout(onEscTimeout, 50);
          return;
        }
        if (buf[1] === '[' || buf[1] === 'O') {
          // CSI 终止字节 0x40-0x7E，之前的 0x20-0x3F 是参数 / 中间字节；SS3 终止字节固定在第三位
          let end = 2;
          if (buf[1] === '[') while (end < buf.length && buf[end] >= ' ' && buf[end] <= '?') end += 1;
          if (end >= buf.length) return; // 不完整前缀：保留余量等下一 chunk 续解
          const final = buf[end];
          const sequence = buf.slice(0, end + 1);
          buf = buf.slice(end + 1);
          // 仅无参数的单终止字节序列映射方向键 / Home / End；其余（带参数修饰、未识别）→ unknown，不误动光标
          const name = end === 2 ? SEQUENCE_KEYS[final] : undefined;
          emit({ name: name ?? 'unknown', sequence });
          continue;
        }
        // ESC 后跟其他字符：整段按未知序列交付（不崩、不误动光标）
        const sequence = buf.slice(0, 2);
        buf = buf.slice(2);
        emit({ name: 'unknown', sequence });
        continue;
      }
      const ch = buf[0];
      buf = buf.slice(1);
      const code = ch.charCodeAt(0);
      if (code === 13 || code === 10) emit({ name: 'return', sequence: ch }); // \r \n → 回车
      else if (code === 9) emit({ name: 'tab', sequence: ch }); // \t
      else if (code === 127 || code === 8) emit({ name: 'backspace', sequence: ch }); // \x7f \x08
      else if (code >= 1 && code <= 26) emit({ name: String.fromCharCode(code + 96), ctrl: true, sequence: ch }); // \x01-\x1a → ctrl+小写字母（含 \x03 → Ctrl+C）
      else if (ch === ' ') emit({ name: 'space', sequence: ch });
      else emit({ name: ch, sequence: ch }); // 字母 / 数字 / 普通字符逐字符；粘贴多字符按序逐个
    }
  };
  const onData = (chunk) => {
    if (escTimer !== null) {
      clearTimeout(escTimer); // 后续数据到达：取消孤立 ESC 判定，按序列续解
      escTimer = null;
    }
    const text = decoder.write(chunk);
    if (process.env.FLOW_KIT_KEY_DEBUG) console.error('[flow-kit key] raw:', JSON.stringify(text));
    buf += text;
    parse();
  };
  const detach = () => {
    if (escTimer !== null) {
      clearTimeout(escTimer); // restore 时清计时，避免挂着的 timer 悬住事件循环
      escTimer = null;
    }
    input.removeListener('data', onData);
  };
  input.on('data', onData);
  return detach;
}

export function createScreen({ input, output }) {
  const state = { interactive: false, last: 0, detachKeyDecoder: null };
  const renderLines = (lines) => {
    let out = state.last > 0 ? `\x1b[${state.last}A` : '';
    for (const line of lines) out += `\r\x1b[2K${line}\n`;
    for (let i = lines.length; i < state.last; i += 1) out += '\r\x1b[2K\n';
    if (state.last > lines.length) out += `\x1b[${state.last - lines.length}A`;
    state.last = lines.length;
    output.write(out);
  };
  const screen = {
    input,
    output,
    // interactive 是交互态唯一事实源：setup 探测 raw mode 可用性后置位
    get interactive() {
      return state.interactive;
    },
    setup() {
      try {
        input.setRawMode(true);
        state.interactive = true;
      } catch {
        state.interactive = false;
      }
      if (state.interactive) {
        // 交互模式挂自研按键解码器（弃用 readline.emitKeypressEvents，理由见文件头）；重复 setup 不重复挂
        if (state.detachKeyDecoder === null) state.detachKeyDecoder = attachKeyDecoder(input);
        // 交互模式隐藏光标，restore 配对显示，消除重绘闪烁
        output.write('\x1b[?25l');
      }
    },
    render: renderLines,
    clear: () => renderLines([]),
    // 重置渲染原点后写原始输出：后续 render 从当前光标处新起一块，不覆盖已有内容
    print(str) {
      state.last = 0;
      output.write(str);
    },
    restore() {
      if (state.interactive) output.write('\x1b[?25h');
      if (state.detachKeyDecoder !== null) {
        state.detachKeyDecoder(); // 摘 data 监听并清孤立 ESC 计时
        state.detachKeyDecoder = null;
      }
      try {
        input.setRawMode(false);
      } catch {
        /* 非 TTY 无 raw mode */
      }
    },
  };
  return screen;
}

// 交互式单问：渲染 box → keypress 驱动 widget → 完成清掉区块返回 value；Ctrl+C / EOF 抛 QuitError
export function runPrompt(screen, { title, question, hint, widget }) {
  const draw = () => screen.render(box(title, [cyan(`◆ ${question}`), '', ...widget.view(), '', dim(hint)]));
  draw();
  return new Promise((resolve, reject) => {
    const input = screen.input;
    // keypress 与 close 监听成对清理，避免多问后监听器堆积
    const cleanup = () => {
      input.removeListener('keypress', onKey);
      input.removeListener('close', onClose);
    };
    const onKey = (key) => {
      // readline 对不完整/分片到达的转义序列会 emit ('keypress', undefined)，静默忽略
      if (!key) return;
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new QuitError());
        return;
      }
      const done = widget.onKey(key);
      if (done) {
        cleanup();
        screen.clear();
        resolve(done.value);
        return;
      }
      draw();
    };
    // stdin 关闭（EOF）：与降级路径同语义，按 Ctrl+C 干净退出
    const onClose = () => {
      cleanup();
      reject(new QuitError());
    };
    input.on('keypress', onKey);
    input.on('close', onClose);
  });
}

// 降级读行器：整个会话共用一个 readline interface + 行队列，
// 管道一次性到达的行按序消费不丢；EOF（stdin 关闭）resolve null，保证任意一步干净退出
export function createLineReader(input, output) {
  const queue = [];
  let pending = null;
  let eof = false;
  const rl = readline.createInterface({ input, output });
  rl.on('line', (line) => {
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve(line);
    } else {
      queue.push(line);
    }
  });
  rl.on('close', () => {
    eof = true;
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve(null);
    }
  });
  return () => new Promise((resolve) => {
    if (queue.length) return resolve(queue.shift());
    if (eof) return resolve(null);
    pending = resolve;
  });
}
