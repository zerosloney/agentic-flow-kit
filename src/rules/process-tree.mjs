// process-tree — 进程表快照与后代收集的纯函数（杀树执行器 run-tree.mjs 用）。
// 为什么单独拆：杀树路径跨平台不同（Windows 走 taskkill /T，POSIX 走进程组 + 逐个杀），
// 但「从进程表快照找出全部后代」是共用的纯逻辑，拆出来才能在任意平台单测。
import { spawnSync } from 'node:child_process';

/**
 * 解析 `ps -eo pid=,ppid=` 的输出：返回 父 pid → 子 pid 列表 的映射。
 */
export function parseProcessTable(text) {
  const table = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    if (!table.has(ppid)) table.set(ppid, []);
    table.get(ppid).push(pid);
  }
  return table;
}

/**
 * 收集 pid 的全部后代（先父后子：父一定先于子被发现，倒序即「先子后父」）。
 */
export function collectDescendants(table, pid) {
  const out = [];
  const seen = new Set([pid]);
  const stack = [pid];
  while (stack.length) {
    const cur = stack.pop();
    for (const child of table.get(cur) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

/**
 * 取当前进程表快照（POSIX 的 ps；不可用时返回空表，调用方按「杀不到后代」处理）。
 */
export function snapshotProcessTable() {
  const out = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (out.error || out.status !== 0 || !out.stdout) return new Map();
  try {
    return parseProcessTable(out.stdout);
  } catch {
    return new Map();
  }
}
