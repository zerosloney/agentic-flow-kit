// shell 探测（供 .trae/hooks/ 各钩子共用）
// Windows 下 bash 常不在 PATH：优先 Git Bash 绝对路径，回退 PATH 的 bash/sh。
// 返回 null 表示不可用——调用方须 fail-closed 报告「门禁未执行」，不要当成检查通过。
const { execFileSync } = require('child_process');
const fs = require('fs');

function resolveShell() {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
  ];
  for (const p of candidates) {
    try { fs.accessSync(p); return p; } catch { /* 尝试下一个 */ }
  }
  for (const c of ['bash', 'sh']) {
    try { execFileSync(c, ['-c', 'exit 0'], { stdio: 'pipe', timeout: 5000 }); return c; } catch { /* 尝试下一个 */ }
  }
  return null;
}

module.exports = { resolveShell };
