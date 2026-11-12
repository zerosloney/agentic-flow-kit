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
import {
  parseModelFlags, readInjectedModels, resolveModels, summarizeModels, writeLocalModelRoles,
} from '../models/resolve.mjs';

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

// 可选技术栈单一来源：TUI 向导栈菜单由它生成
export const STACKS = ['dotnet', 'node', 'empty'];

export function resolveStack(args, target) {
  const stack = String(args.stack || args.profile || detectStack(target));
  const abs = fileURLToPath(new URL(`../../templates/profiles/${stack}/`, import.meta.url));
  return fs.existsSync(abs) ? stack : 'empty';
}

export function installCommand({ args, t, lang, onLog }) {
  const hosts = resolveHosts(args, t);
  return runInstall({ args, t, lang, hosts, commandLabel: 'install', onLog });
}

// CLI 缺省进度行：action 前缀 + 消息（TUI 经 onLog 接管渲染）
function logLine(action, msg) {
  console.log(`${{ create: '+', update: '~', skip: '-', conflict: '!', merge: '~' }[action] || ' '} ${msg}`);
}

function normalizeModelMode(value) {
  const v = String(value || 'recommend').toLowerCase();
  return ['recommend', 'detect', 'inherit'].includes(v) ? v : 'recommend';
}

// onLog 回调契约：(action, msg, done, total) —— action ∈ create/update/skip/conflict/merge，
// done/total 为已完成/总文件数，供 TUI 渲染 spinner 进度；缺省走 CLI 前缀行。
export function runInstall({ args, t, lang, hosts, planHosts = hosts, categories, commandLabel, stackOverride, onLog = logLine }) {
  const target = resolveTarget(args);
  const dryRun = flag(args, 'dry-run');
  const force = flag(args, 'force');
  const stack = stackOverride || resolveStack(args, target);
  const projectName = args.name || path.basename(target);
  const previous = readManifest(target);
  const hostSet = [...new Set([...(previous?.hosts || []), ...hosts])];
  const trackHosts = flag(args, 'track-hosts');

  let modelFlags;
  try {
    modelFlags = parseModelFlags(args.models || []);
  } catch (err) {
    if (err.code !== 'BAD_MODEL') throw err;
    const e = new Error(t('error.badModel', { value: err.value || '' }));
    e.code = 'BAD_MODEL';
    throw e;
  }
  const tuiModels = args.tuiModels || null;
  const explicitModels = Object.keys(modelFlags.global).length > 0
    || Object.keys(modelFlags.hosts).length > 0
    || Boolean(tuiModels && Object.keys(tuiModels).length);
  const modelMode = normalizeModelMode(args['model-mode']);
  // 升级默认不重新探测：以本地 model-roles.local.json 为准，保证 agent 文件哈希稳定。
  const shouldProbe = !previous || commandLabel === 'add-host' || explicitModels || modelMode === 'detect' || flag(args, 'probe-models');
  const previousModels = commandLabel === 'upgrade'
    ? readInjectedModels({ target, hosts: planHosts })
    : {};
  const models = flag(args, 'no-model-config') ? null : resolveModels({
    hosts: planHosts,
    target,
    cli: modelFlags,
    tui: tuiModels,
    previous: previousModels,
    mode: modelMode,
    probe: shouldProbe,
    allowCli: flag(args, 'probe-models'),
  });

  const plan = buildPlan({ target, hosts: planHosts, lang, stack, projectName, categories, models: models?.hosts });
  let done = 0;
  const total = plan.entries.length;
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
  if (models) {
    console.log(t('install.models', { models: summarizeModels(models) }));
    for (const warning of models.warnings || []) {
      console.log(t('install.modelWarning', { host: warning.host, role: warning.role }));
    }
  }
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
    log: (action, msg) => onLog(action, msg, (done += 1), total),
  });

  console.log(summaryLine(result.stats, t));

  if (!dryRun) {
    // 模型 ID 是机器本地状态：只写 gitignore 的 local 覆盖，不进 manifest。
    if (models && (commandLabel !== 'upgrade' || explicitModels)) {
      const saved = writeLocalModelRoles(target, models, {
        overwrite: explicitModels || commandLabel === 'add-host',
      });
      if (saved.written) console.log(t('install.localModels', { path: path.join(target, '.agents/config/model-roles.local.json') }));
    }

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
