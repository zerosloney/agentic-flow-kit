import { spawnSync } from 'node:child_process';

// origin 远端 → 托管。认 GitHub / GitLab / Azure。认不出返回 null。
export function forgeFromRemote(url) {
  const u = String(url || '').trim().toLowerCase();
  if (!u) return null;
  if (/(^|[@/])github\.com([/:]|$)/.test(u)) return 'github';
  // 主机名含 gitlab：gitlab.com 或自建（gitlab.example.com）。只看 authority，避免路径里的 "gitlab" 误判。
  const host = (/^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]+@)?([^/:]+)/.exec(u) || [])[1] || '';
  if (host.includes('gitlab')) return 'gitlab';
  if (u.includes('dev.azure.com') || u.includes('visualstudio.com') || u.includes('/tfs/') || u.includes('/_git/')) return 'azure';
  return null;
}

export function originUrl(cwd) {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return '';
  return r.stdout.trim();
}
