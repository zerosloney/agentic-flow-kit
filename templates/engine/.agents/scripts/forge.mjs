import { spawnSync } from 'node:child_process';

// origin 远端 → 托管。只认 GitHub 与 Azure。认不出返回 null。
export function forgeFromRemote(url) {
  const u = String(url || '').trim().toLowerCase();
  if (!u) return null;
  if (/(^|[@/])github\.com([/:]|$)/.test(u)) return 'github';
  if (u.includes('dev.azure.com') || u.includes('visualstudio.com') || u.includes('/tfs/') || u.includes('/_git/')) return 'azure';
  return null;
}

export function originUrl(cwd) {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return '';
  return r.stdout.trim();
}
