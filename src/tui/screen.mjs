// 终端屏幕层：全仓唯一接触 stdin/stdout 的地方（终端状态机 + IO）。
// render 记住上次行数，重绘时上移清行重写（行数变化会清残留行）；print 重置渲染原点后写原始输出，
// 供 flows 在命令输出推进过光标时新起一块，无需感知光标行数协议。
// 降级模式在 setRawMode 不可用或非 TTY 直调时进入：交互全部改走「编号 + 回车」问答（prompts.mjs）。
// 视口高度裁剪明确不做：内容有界（最多 10 宿主选项 + 提示行），裁剪反而引入滚动定位复杂度。
import readline from 'node:readline';
import { box, cyan, dim } from './ansi.mjs';

// Ctrl+C / EOF 的退出哨兵：wizardCommand 捕获后返回 0，不裸抛堆栈
export class QuitError extends Error {}

export function createScreen({ input, output }) {
  const state = { interactive: false, last: 0 };
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
      readline.emitKeypressEvents(input);
      try {
        input.setRawMode(true);
        state.interactive = true;
      } catch {
        state.interactive = false;
      }
      // 交互模式隐藏光标，restore 配对显示，消除重绘闪烁
      if (state.interactive) output.write('\x1b[?25l');
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
