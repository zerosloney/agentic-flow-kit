import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

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

export const FORGE_PROVIDERS = {
  github: {
    id: 'github',
    name: 'GitHub',
    cli: 'gh',
    envHook: 'PR_CREATE_GH',
    defaultTarget: 'main',
    buildPrArgs({ source, target, title, bodyFile }) {
      const args = ['pr', 'create'];
      if (source) args.push('--head', source);
      if (target) args.push('--base', target);
      if (title) args.push('--title', title);
      if (bodyFile) args.push('--body-file', bodyFile);
      return args;
    },
    parsePrResponse(stdout) {
      const match = /https?:\/\/\S+\/pull\/(\d+)/.exec(stdout || '');
      return {
        ok: !!match,
        url: match ? match[0] : null,
        number: match ? Number(match[1]) : null,
      };
    },
  },
  gitlab: {
    id: 'gitlab',
    name: 'GitLab',
    cli: 'glab',
    envHook: 'PR_CREATE_GLAB',
    defaultTarget: 'main',
    buildPrArgs({ source, target, title, bodyFile, dryRun = false }) {
      const args = ['mr', 'create'];
      if (source) args.push('--source-branch', source);
      if (target) args.push('--target-branch', target);
      if (title) args.push('--title', title);
      if (bodyFile) {
        if (dryRun) {
          args.push('--description', `"$(cat ${bodyFile})"`);
        } else {
          let description;
          try {
            description = fs.readFileSync(bodyFile, 'utf8');
          } catch {
            const err = new Error(`读不到 --body-file：${bodyFile}`);
            err.code = 'BODY_FILE_NOT_FOUND';
            throw err;
          }
          args.push('--description', description);
        }
      }
      return args;
    },
    parsePrResponse(stdout) {
      const match = /https?:\/\/\S+\/-\/merge_requests\/(\d+)/i.exec(stdout || '');
      return {
        ok: !!match,
        url: match ? match[0] : null,
        number: match ? Number(match[1]) : null,
      };
    },
  },
  azure: {
    id: 'azure',
    name: 'Azure DevOps / TFS',
    cli: 'tfs-pr',
    envHook: null,
    defaultTarget: 'develop',
    buildPrArgs({ rawArgs }) {
      const hasCreate = rawArgs[0] === 'create';
      return hasCreate ? rawArgs : ['create', ...rawArgs];
    },
    parsePrResponse(stdout) {
      const match = /https?:\/\/\S+\/pullrequest\/(\d+)/i.exec(stdout || '');
      return {
        ok: !!match,
        url: match ? match[0] : null,
        number: match ? Number(match[1]) : null,
      };
    },
  },
};

export function getForgeProvider(remoteOrName) {
  if (!remoteOrName) return null;
  const id = FORGE_PROVIDERS[remoteOrName] ? remoteOrName : forgeFromRemote(remoteOrName);
  return id ? FORGE_PROVIDERS[id] : null;
}
