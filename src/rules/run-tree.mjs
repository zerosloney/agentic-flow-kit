// run-tree — command 规则的进程树执行器：超时时连同子孙进程一起终止。
// 为什么需要它：spawnSync 的 timeout 只杀掉 shell 本身（Windows 下是 cmd.exe），
// shell 启动的子进程会继续存活，挂住的测试进程照样占资源、占文件锁。
// 另一层原因：子进程若继承本执行器的 stdout 管道，父进程（spawnSync）要等所有
// 持管道的后代退出才返回——超时后命令还在跑，父进程就被拖住。所以管道由本执行器
// 持有并转发输出，父进程只等执行器退出。
// 用法：node run-tree.mjs <timeoutMs|0> <command>；超时以退出码 124 结束，并在 fd 3 写 ETIMEDOUT。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { collectDescendants, snapshotProcessTable } from './process-tree.mjs';

const [timeoutArg, command = ''] = process.argv.slice(2);
const timeoutMs = Number(timeoutArg) || 0;
const MAX_CAPTURE = 8 * 1024 * 1024;

const child = spawn(command, {
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});

let outBuf = '';
let errBuf = '';
child.stdout?.on('data', (chunk) => { outBuf = (outBuf + chunk).slice(-MAX_CAPTURE); });
child.stderr?.on('data', (chunk) => { errBuf = (errBuf + chunk).slice(-MAX_CAPTURE); });

/** 把捕获到的输出转发给父进程：writeSync 是同步的，process.exit 不会丢内容。 */
function flushOutput() {
  if (outBuf) {
    try { fs.writeSync(1, outBuf); } catch { /* 管道已关时忽略 */ }
    outBuf = '';
  }
  if (errBuf) {
    try { fs.writeSync(2, errBuf); } catch { /* 管道已关时忽略 */ }
    errBuf = '';
  }
}

/** 超时 kill：能连树一起杀就连树杀，杀不动至少把外壳（cmd.exe）杀掉，别让它继续占着管道。 */
function killTree() {
  if (process.platform === 'win32') {
    // /T 连子孙进程一起杀：cmd.exe 只是外壳，真正的命令在它的子进程里。
    const r = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    if (r.status === 0) return;
    // taskkill 不可用或被拒（受限环境 / 权限不足）：退回到直接杀外壳。
    try { child.kill('SIGKILL'); } catch { /* 已退出时忽略 */ }
  } else {
    // 后代可能自己 detached 出去（自成一组 / 自成一会话），进程组杀不到：
    // 先按进程表快照找出全部后代，逐个杀，再杀组。
    const descendants = collectDescendants(snapshotProcessTable(), child.pid);
    for (const pid of descendants.reverse()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* 已退出时忽略 */
      }
    }
    // detached 让子进程成为进程组组长，杀负 pid 即杀整组；再兜底杀一次子进程本身。
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* 组不存在时忽略 */
    }
    try {
      child.kill('SIGKILL');
    } catch {
      /* 已退出时忽略 */
    }
  }
}

let timer = null;
if (timeoutMs > 0) {
  timer = setTimeout(() => {
    killTree();
    flushOutput();
    try {
      fs.writeSync(3, 'ETIMEDOUT');
    } catch {
      /* fd 3 未打开时忽略 */
    }
    process.exit(124);
  }, timeoutMs);
}

child.on('error', () => {
  if (timer) clearTimeout(timer);
  flushOutput();
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (timer) clearTimeout(timer);
  // stdio 数据可能还在路上：让事件循环跑一轮再转发，别丢掉尾部输出。
  setTimeout(() => {
    flushOutput();
    process.exit(signal ? 1 : (code ?? 1));
  }, 10);
});
