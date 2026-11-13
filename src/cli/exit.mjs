// 退出码契约：0 成功、1 冲突/严格模式漂移、2 用法错误、
// 3 目标或 manifest 缺失、4 未知宿主、5 IO 失败。
export const EXIT = {
  OK: 0,
  CONFLICT: 1,
  USAGE: 2,
  TARGET: 3,
  HOST: 4,
  IO: 5,
};

const BY_CODE = {
  BAD_COMMAND: EXIT.USAGE,
  BAD_LANG: EXIT.USAGE,
  BAD_MODEL: EXIT.USAGE,
  BAD_TIER: EXIT.USAGE,
  NO_HOSTS: EXIT.USAGE,
  MISSING_ARG: EXIT.USAGE,
  HOST_NOT_INSTALLED: EXIT.USAGE,
  HOST_MANIFEST: EXIT.USAGE,
  TARGET_MISSING: EXIT.TARGET,
  NO_MANIFEST: EXIT.TARGET,
  NO_HOSTS_IN_MANIFEST: EXIT.TARGET,
  UNKNOWN_HOST: EXIT.HOST,
};

const IO_CODES = new Set([
  'EACCES', 'EPERM', 'ENOENT', 'EISDIR', 'ENOTDIR', 'ENOSPC',
  'EROFS', 'EBUSY', 'EMFILE', 'ENFILE', 'EEXIST',
]);

export function exitCodeForError(err) {
  const code = err?.code;
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(BY_CODE, code)) {
    return BY_CODE[code];
  }
  if (typeof code === 'string' && IO_CODES.has(code)) return EXIT.IO;
  return 1;
}
