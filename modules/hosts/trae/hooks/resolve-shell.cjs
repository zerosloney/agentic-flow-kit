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
  // PATH 回退须避开 WSL 启动器：C:\Windows\System32\bash.exe 能过 exit 0 探测，但路径/行尾语义是 Linux 侧的（2026-09-24）
  for (const c of ['bash', 'sh']) {
    let cand = c;
    try {
      const hits = execFileSync('where.exe', [c], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const good = hits.find((p) => !/system32/i.test(p)); // 全部命中都在 System32（纯 WSL）→ 跳过该候选
      if (good) cand = good;
      else continue;
    } catch { /* where 不可用（非 Windows）：按原名探测，保持旧行为 */ }
    try { execFileSync(cand, ['-c', 'exit 0'], { stdio: 'pipe', timeout: 5000 }); return cand; } catch { /* 尝试下一个 */ }
  }
  return null;
}

module.exports = { resolveShell };
