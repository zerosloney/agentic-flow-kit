import fs from 'node:fs';
import path from 'node:path';
import { readManifest } from '../install/manifest.mjs';
import { readKitVersion } from './install.mjs';

// 多仓 Workspace：显式清单 + 各仓安装摘要。只读聚合，不隐式发现仓库，
// 也不把 workspace 配置混入单仓的 install-manifest。
export const WORKSPACE_REL = '.flow-kit/workspace.json';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function resolveRoot(args, t) {
  const root = path.resolve(args.target || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    fail('TARGET_MISSING', t('error.workspaceTargetMissing', { target: root }));
  }
  return root;
}

function repoArgs(args) {
  return (args.repos || [])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function readWorkspace(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, WORKSPACE_REL), 'utf8'));
  } catch {
    return null;
  }
}

function inspectRepo(root, rel, t) {
  const abs = path.resolve(root, rel);
  const normalized = path.relative(root, abs).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('..') || path.isAbsolute(normalized)) {
    fail('BAD_REPO', t('error.badRepo', { path: rel }));
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    fail('BAD_REPO', t('error.badRepoMissing', { path: normalized }));
  }
  if (!fs.existsSync(path.join(abs, '.git'))) {
    fail('BAD_REPO', t('error.badRepoGit', { path: normalized }));
  }
  const manifest = readManifest(abs);
  return {
    path: normalized,
    name: path.basename(abs),
    installed: Boolean(manifest),
    kitVersion: manifest?.version || null,
    hosts: manifest?.hosts || [],
    stack: manifest?.stack || null,
    language: manifest?.language || null,
    tier: manifest?.tier || null,
  };
}

function summarize(repos) {
  return {
    repos: repos.length,
    installed: repos.filter((repo) => repo.installed).length,
    missing: repos.filter((repo) => !repo.installed).length,
  };
}

function writeWorkspace(root, config) {
  const abs = path.join(root, WORKSPACE_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function initCommand({ args, t, asJson, root }) {
  const requested = repoArgs(args);
  if (!requested.length) fail('MISSING_ARG', t('error.workspaceUsage'));
  const repos = requested.map((rel) => inspectRepo(root, rel, t));
  const previous = readWorkspace(root);
  const now = new Date().toISOString();
  const config = {
    kit: 'agentic-flow-kit',
    version: readKitVersion(),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    repos,
  };
  writeWorkspace(root, config);

  if (asJson) {
    console.log(JSON.stringify({ command: 'workspace init', target: root, path: WORKSPACE_REL, ...config }, null, 2));
  } else {
    console.log(t('workspace.init', { path: WORKSPACE_REL, count: repos.length }));
    for (const repo of repos) {
      console.log(t('workspace.repo', {
        path: repo.path,
        status: t(repo.installed ? 'workspace.installed' : 'workspace.notInstalled'),
        hosts: repo.hosts.join(', ') || '-',
      }));
    }
  }
  return 0;
}

function statusCommand({ t, asJson, root }) {
  const config = readWorkspace(root);
  if (!config) fail('NO_WORKSPACE', t('error.noWorkspace', { path: WORKSPACE_REL }));
  const repos = (config.repos || []).map((repo) => {
    try {
      return inspectRepo(root, repo.path, t);
    } catch (err) {
      if (err.code !== 'BAD_REPO') throw err;
      return { ...repo, installed: false, missingPath: true, hosts: [], kitVersion: null, stack: null, language: null, tier: null };
    }
  });
  const summary = summarize(repos);

  if (asJson) {
    console.log(JSON.stringify({
      command: 'workspace status',
      target: root,
      path: WORKSPACE_REL,
      version: config.version,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      repos,
      summary,
    }, null, 2));
  } else {
    console.log(t('workspace.status', { path: WORKSPACE_REL, count: summary.repos, installed: summary.installed }));
    for (const repo of repos) {
      console.log(t('workspace.repo', {
        path: repo.path,
        status: t(repo.missingPath
          ? 'workspace.missingPath'
          : (repo.installed ? 'workspace.installed' : 'workspace.notInstalled')),
        hosts: repo.hosts.join(', ') || '-',
      }));
    }
  }
  return 0;
}

export function workspaceCommand({ args, t }) {
  const root = resolveRoot(args, t);
  const asJson = args.flags.has('json');
  const sub = args._[1] || 'status';
  if (sub === 'init') return initCommand({ args, t, asJson, root });
  if (sub === 'status') return statusCommand({ t, asJson, root });
  fail('BAD_COMMAND', t('error.workspaceUsage'));
  return 2;
}
