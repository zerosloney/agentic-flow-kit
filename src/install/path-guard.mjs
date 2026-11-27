import path from 'node:path';

// 把 target 相对的 rel 解析成绝对路径；绝对路径（Windows 盘符、UNC）与 `..` 逃逸一律返回 null。
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || rel.length === 0) return null;
  if (path.isAbsolute(rel) || path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel)) return null;
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  return abs.startsWith(prefix) ? abs : null;
}
