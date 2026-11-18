import fs from 'node:fs';
import path from 'node:path';

// 原子写：先落同目录确定性 tmp 再 rename——rename 前任何失败旧文件字节不动，残留 tmp 会被下次写覆盖（自愈）；不重试，失败上抛 fail-loud。
export function writeAtomicSync(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}
