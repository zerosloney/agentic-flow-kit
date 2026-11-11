import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag } from '../cli/args.mjs';
import { buildPlan } from '../install/plan.mjs';
import { applyPlan, summaryLine } from '../install/apply.mjs';
import { emptyManifest, readManifest, writeManifest } from '../install/manifest.mjs';
import { buildVars } from '../render/tokens.mjs';
import { HOST_NAMES, resolveHost } from '../hosts/registry.mjs';
import { configureGit, isGitRepo } from '../git/config.mjs';

export function readKitVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const KIT_VERSION = readKitVersion();

export function resolveTarget(args) {
  const target = path.resolve(args.target || process.cwd());
  if (!fs.existsSync(target)) {
    const err = new Error(`target not found: ${target}`);
    err.code = 'TARGET_MISSING';
    throw err;
  }
  return target;
}

export function resolveHosts(args, t, fallback = []) {
  const names = args.agents && args.agents.length ? args.agents : fallback;
  if (!names.length) {
    const err = new Error(t('error.noHosts', { hosts: HOST_NAMES.join(', ') }));
    err.code = 'NO_HOSTS';
    throw err;
  }
  const out = [];
  for (const name of names) {
    try {
      resolveHost(name);
    } catch {
      const err = new Error(t('error.unknownHost', { name, hosts: HOST_NAMES.join(', ') }));
      err.code = 'UNKNOWN_HOST';
      throw err;
    }
    const key = String(name).trim().toLowerCase();
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

export function detectStack(target) {
  let top = [];
  try {
    top = fs.readdirSync(target);
  } catch {
    return 'empty';
  }
  if (top.some((n) => n.endsWith('.sln') || n.endsWith('.csproj'))) return 'dotnet';
  if (top.includes('package.json')) return 'node';
  return 'empty';
}

export function resolveStack(args, target) {
  const stack = String(args.stack || args.profile || detectStack(target));
  const abs = fileURLToPath(new URL(`../../templates/profiles/${stack}/`, import.meta.url));
  return fs.existsSync(abs) ? stack : 'empty';
}

export function installCommand({ args, t, lang }) {
  const hosts = resolveHosts(args, t);
  return runInstall({ args, t, lang, hosts, commandLabel: 'install' });
}

export function runInstall({ args, t, lang, hosts, planHosts = hosts, categories, commandLabel, stackOverride }) {
  const target = resolveTarget(args);
  const dryRun = flag(args, 'dry-run');
  const force = flag(args, 'force');
  const stack = stackOverride || resolveStack(args, target);
  const projectName = args.name || path.basename(target);
  const previous = readManifest(target);
  const hostSet = [...new Set([...(previous?.hosts || []), ...hosts])];
  const trackHosts = flag(args, 'track-hosts');

  const plan = buildPlan({ target, hosts: planHosts, lang, stack, projectName, categories });
  const vars = buildVars({
    target,
    projectName,
    stack,
    language: lang,
    hosts: hostSet,
    kitVersion: KIT_VERSION,
    installedAt: new Date().toISOString(),
    trackHosts,
  });

  console.log(t('install.start', { command: commandLabel, target }));
  console.log(t('install.plan', { hosts: hostSet.join(', '), stack, lang, count: plan.entries.length }));
  if (dryRun) console.log(t('install.dryRun'));

  const manifest = previous || emptyManifest({
    kitVersion: KIT_VERSION,
    language: lang,
    hosts: hostSet,
    stack,
  });

  const result = applyPlan({
    plan,
    vars,
    manifest,
    dryRun,
    force,
    log: (action, msg) => {
      const prefix = { create: '+', update: '~', skip: '-', conflict: '!', merge: '~' }[action] || ' ';
      console.log(`${prefix} ${msg}`);
    },
  });

  console.log(summaryLine(result.stats, t));

  if (!dryRun) {
    const next = {
      ...manifest,
      version: KIT_VERSION,
      installedAt: new Date().toISOString(),
      language: lang,
      hosts: hostSet,
      stack,
      files: result.files,
    };
    writeManifest(target, next);
    console.log(t('install.manifest', { path: path.join(target, '.agents/install-manifest.json') }));

    const gitConfig = flag(args, 'git-config') || (!flag(args, 'no-git-config') && isGitRepo(target));
    if (gitConfig && isGitRepo(target)) {
      configureGit(target);
      console.log(t('install.gitConfig'));
    } else if (!gitConfig) {
      console.log(t('install.gitSkip'));
    }
    console.log(t('install.next'));
  }

  return result.stats.conflict > 0 ? 0 : 0;
}
