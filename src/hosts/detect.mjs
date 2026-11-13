import fs from 'node:fs';
import path from 'node:path';
import { HOSTS, HOST_NAMES } from './registry.mjs';

// 只读探测：宿主点目录存在，或注册表声明的根级配置 / 记忆文件存在。
// 返回顺序固定为 HOST_NAMES，供 CLI --auto-hosts 与 TUI 预选共用。
export function detectHosts(target) {
  return HOST_NAMES.filter((name) => {
    const host = HOSTS[name];
    if (!host) return false;
    if (fs.existsSync(path.join(target, host.dir))) return true;
    return (host.detect || []).some((rel) => fs.existsSync(path.join(target, rel)));
  });
}
