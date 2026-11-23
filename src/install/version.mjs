import fs from 'node:fs';

// 读取 kit 版本号的单源（审查遗留批 2026-11-23：此前 install.mjs 与 metrics.mjs 各读一份 package.json）。
// 只依赖 node:fs、不 import 任何 src 模块：供 commands 与 install 两侧共用而不成环。
export function readKitVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
