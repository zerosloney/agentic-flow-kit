import fs from 'node:fs';
import path from 'node:path';

// POSIX 权限位：git 只执行带 x 位的 hook；Windows 不看权限位（chmod 只切只读位），直接跳过。
export function ensureModeSync(file, mode) {
  if (process.platform === 'win32') return;
  if ((fs.statSync(file).mode & 0o777) === mode) return;
  fs.chmodSync(file, mode);
}

// 原子写：先落同目录确定性 tmp 再 rename——rename 前任何失败旧文件字节不动，残留 tmp 会被下次写覆盖（自愈）；不重试，失败上抛 fail-loud。
// mode：给定时落盘后校准权限。writeFileSync 的 mode 只对新建 tmp 生效，残留 tmp 可能带着旧权限，故 rename 后再统一 chmod。
export function writeAtomicSync(file, text, mode = null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  if (mode != null) ensureModeSync(file, mode);
}
