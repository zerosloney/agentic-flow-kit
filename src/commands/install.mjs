import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { flag } from '../cli/args.mjs';
import { buildPlan } from '../install/plan.mjs';
import { parseProfileArgs } from '../install/profiles.mjs';
import { applyPlan, summaryLine } from '../install/apply.mjs';
import { emptyManifest, readManifest, sha256Text, writeManifest } from '../install/manifest.mjs';
import { buildVars } from '../render/tokens.mjs';
import { HOST_NAMES, HOSTS, resolveHost } from '../hosts/registry.mjs';
import { detectHosts } from '../hosts/detect.mjs';
import { configureGit, isGitRepo } from '../git/config.mjs';
import { writeBaseline } from '../install/baseline.mjs';
import { explainPolicyDiff, renderPolicyDiff } from '../install/policy-diff.mjs';
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

// 根目录标记，先匹配者胜出。package.json 放在最后，避免吞掉 Cargo.toml / go.mod / pom.xml / tsconfig.json。
// label 是菜单上的典型标记；match 返回实际命中的文件名。
const STACK_MARKERS = [
  {
    stack: 'dotnet',
    label: '.sln / .csproj',
    match: (names) => names.find((n) => n.endsWith('.sln')) || names.find((n) => n.endsWith('.csproj')) || null,
  },
  { stack: 'rust', label: 'Cargo.toml', match: (names) => (names.includes('Cargo.toml') ? 'Cargo.toml' : null) },
  { stack: 'go', label: 'go.mod', match: (names) => (names.includes('go.mod') ? 'go.mod' : null) },
  {
    stack: 'java',
    label: 'pom.xml / build.gradle',
    match: (names) => ['pom.xml', 'build.gradle', 'build.gradle.kts'].find((n) => names.includes(n)) || null,
  },
  { stack: 'typescript', label: 'tsconfig.json', match: (names) => (names.includes('tsconfig.json') ? 'tsconfig.json' : null) },
  { stack: 'node', label: 'package.json', match: (names) => (names.includes('package.json') ? 'package.json' : null) },
];

export function stackMarkerLabel(stack) {
  return STACK_MARKERS.find((marker) => marker.stack === stack)?.label || '';
}

export function matchStack(names) {
  const list = Array.isArray(names) ? names : [];
  for (const marker of STACK_MARKERS) {
    const file = marker.match(list);
    if (file) return { stack: marker.stack, file };
  }
  return { stack: 'empty', file: null };
}

export function detectStackDetail(target) {
  let top = [];
  try {
    top = fs.readdirSync(target);
  } catch {
    return { stack: 'empty', file: null };
  }
  return matchStack(top);
}

export function detectStack(target) {
  return detectStackDetail(target).stack;
}

// 可选技术栈单一来源：TUI 向导栈菜单由它生成
export const STACKS = ['dotnet', 'node', 'typescript', 'rust', 'go', 'java', 'empty'];

export function resolveStack(args, target) {
  const stack = String(args.stack || args.profile || detectStack(target));
  const abs = fileURLToPath(new URL(`../../templates/profiles/${stack}/`, import.meta.url));
  return fs.existsSync(abs) ? stack : 'empty';
}

export function installCommand({ args, t, lang, onLog }) {
  const target = resolveTarget(args);
  const detectedHosts = detectHosts(target);
  const explicit = args.agents && args.agents.length;
  // --auto-hosts 仅在显式开启且未指定 --agent 时采用探测结果；探测为空给出明确错误。
  if (flag(args, 'auto-hosts') && !explicit && !detectedHosts.length) {
    const err = new Error(t('error.noHostsDetected', { hosts: HOST_NAMES.join(', ') }));
    err.code = 'NO_HOSTS';
    throw err;
  }
  const hosts = resolveHosts(args, t, flag(args, 'auto-hosts') ? detectedHosts : []);
  return runInstall({ args, t, lang, hosts, commandLabel: 'install', onLog, detectedHosts });
}

const ACTION_MARK = { create: '+', update: '~', skip: '-', conflict: '!', merge: '~' };

export function formatInstallLog(action, msg) {
  return `${ACTION_MARK[action] || ' '} ${msg}`;
}

// 「已是最新」在升级时会占绝大多数，进度条已能表达。冲突和其余跳过必须留下原文。
export function installLogNotable(action, msg) {
  if (action === 'conflict') return true;
  if (action === 'skip') return !String(msg).includes('已是最新');
  return false;
}

// CLI 缺省进度行：action 前缀 + 消息（TUI 经 onLog 接管渲染）
function logLine(action, msg) {
  console.log(formatInstallLog(action, msg));
}

function normalizeModelMode(value) {
  const v = String(value || 'recommend').toLowerCase();
  return ['recommend', 'detect', 'inherit'].includes(v) ? v : 'recommend';
}

// 派生工件（索引/引擎地图）从单源现场取数生成，不能静态随模板漂移。
// 它们不进 manifest：属于生成区，升级时重新生成即可。
function generateDerivedArtifacts(target) {
  for (const script of ['gen-workflow-index.mjs', 'gen-engine-map.mjs']) {
    const abs = path.join(target, '.agents', 'scripts', script);
    if (!fs.existsSync(abs)) continue;
    try {
      spawnSync(process.execPath, [abs], {
        cwd: target, stdio: 'ignore', windowsHide: true, timeout: 30000,
      });
    } catch { /* 派生工件失败不阻断安装；verify/dream 会报漂移 */ }
  }
}

const TIERS = ['lean', 'standard', 'enterprise'];

// enterprise 证明链所需工件；policyChecks 记录实际落盘的策略面。
export const PROOF_CHAIN_FILES = [
  '.agents/scripts/agent-eval.mjs',
  '.agents/config/agent-eval.json',
  '.agents/scripts/check-pipeline-state.mjs',
  '.agents/config/pipeline.json',
  '.agents/scripts/outcome-metrics.mjs',
];
export const GIT_HOOKS = ['pre-commit', 'commit-msg', 'post-commit', 'pre-merge-commit', 'pre-push'];

// 实际启用的加固姿态：managed（宿主 managed-only 配置）/ permissions（权限编译）/
// hooks（仅命令门禁）/ none。hooks 与 none 都算缺口（无权限面）。
export function computeEnterprise({ target, hosts, hardened }) {
  if (!hardened) return null;
  const matrix = {};
  const gaps = [];
  for (const host of hosts) {
    const level = HOSTS[host]?.hardening?.level || 'none';
    matrix[host] = level;
    if (level !== 'managed' && level !== 'permissions') gaps.push(host);
  }
  const proofChain = PROOF_CHAIN_FILES.every((rel) => fs.existsSync(path.join(target, rel)));
  const policyChecks = [];
  if (GIT_HOOKS.every((name) => fs.existsSync(path.join(target, '.githooks', name)))) policyChecks.push('githooks');
  if (['azure-pipelines.yml', '.github/workflows/ci.yml'].some((rel) => fs.existsSync(path.join(target, rel)))) policyChecks.push('ci');
  if (Object.values(matrix).some((level) => level === 'managed' || level === 'permissions')) policyChecks.push('permissions');
  return { posture: 'hardened', hosts: matrix, gaps, proofChain, policyChecks };
}

function normalizeTier(value, t) {
  const v = String(value || 'standard').toLowerCase();
  if (!TIERS.includes(v)) {
    const err = new Error(t('error.badTier', { value: value || '' }));
    err.code = 'BAD_TIER';
    throw err;
  }
  return v;
}

// onLog 回调契约：(action, msg, done, total) —— action ∈ create/update/skip/conflict/merge，
// done/total 为已完成/总文件数，供 TUI 渲染 spinner 进度；缺省走 CLI 前缀行。
export function runInstall({ args, t, lang, hosts, planHosts = hosts, categories, commandLabel, stackOverride, onLog = null, detectedHosts = [] }) {
  const target = resolveTarget(args);
  const dryRun = flag(args, 'dry-run');
  const force = flag(args, 'force');
  const asJson = flag(args, 'json');
  // --json 时 stdout 只允许出现最终 JSON；人类进度走 stderr，逐文件日志默认静默。
  const emit = asJson
    ? (...line) => console.error(...line)
    : (...line) => console.log(...line);
  const logger = onLog || (asJson ? () => {} : logLine);
  const previous = readManifest(target);
  const profile = parseProfileArgs({
    stackArg: args.stack,
    surfaceArgs: args.surfaces || [],
    fallbackSurfaces: previous?.surfaces || [],
    t,
  });
  const stack = stackOverride
    || (profile.stack ? resolveStack({ ...args, stack: profile.stack }, target) : resolveStack(args, target));
  const surfaces = profile.surfaces;
  const projectName = args.name || path.basename(target);
  // 渲染与 manifest 使用同一时间戳，避免 diff 把 {{installedAt}} 误判为模板更新。
  const installedAt = new Date().toISOString();
  const hostSet = [...new Set([...(previous?.hosts || []), ...hosts])];
  const trackHosts = flag(args, 'track-hosts');
  // 档位：CLI > --hardened（=enterprise）> 既有 manifest > standard。
  // 档位只影响交付面（CI / 加固），不削弱引擎门禁。
  const tier = normalizeTier(
    args.tier || (flag(args, 'hardened') ? 'enterprise' : null) || previous?.tier || 'standard',
    t,
  );
  const hardened = flag(args, 'hardened') || tier === 'enterprise' || Boolean(previous?.hardened && !args.tier);

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

  // MCP 设置随 manifest 走：install/add-host 可用 --no-mcp 关闭；
  // upgrade 重放既有值，避免无意识地把已关闭的项目重新打开。
  const mcpEnabled = commandLabel === 'upgrade'
    ? previous?.mcp !== false
    : (flag(args, 'no-mcp') ? false : previous?.mcp !== false);

  // 基线默认开启；--no-baseline 关闭，--baseline 在旧安装上重新开启，upgrade 重放 manifest 选择。
  const baselineEnabled = flag(args, 'no-baseline')
    ? false
    : (flag(args, 'baseline') || previous?.baseline !== false);

  const plan = buildPlan({
    target, hosts: planHosts, lang, stack, projectName, categories, models: models?.hosts, tier, hardened,
    mcp: mcpEnabled, surfaces,
    managedPermissions: previous?.managedPermissions || {},
  });
  let done = 0;
  const total = plan.entries.length;
  const vars = buildVars({
    target,
    projectName,
    stack,
    language: lang,
    hosts: hostSet,
    kitVersion: KIT_VERSION,
    installedAt,
    trackHosts,
  });

  const explainPolicy = flag(args, 'explain-policy');
  const policyDiff = explainPolicy ? explainPolicyDiff({ target, plan, vars }) : null;

  emit(t('install.start', { command: commandLabel, target }));
  emit(t('install.plan', { hosts: hostSet.join(', '), stack, lang, count: plan.entries.length }));
  emit(t('install.tier', { tier, hardened: t(hardened ? 'tui.yes' : 'tui.no') }));
  if (policyDiff?.changed) {
    for (const line of renderPolicyDiff(policyDiff.changes, t)) emit(line);
  }
  if (models) {
    emit(t('install.models', { models: summarizeModels(models) }));
    for (const warning of models.warnings || []) {
      emit(t('install.modelWarning', { host: warning.host, role: warning.role }));
    }
  }
  if (dryRun) emit(t('install.dryRun'));
  const manifest = previous || emptyManifest({
    kitVersion: KIT_VERSION,
    language: lang,
    hosts: hostSet,
    stack,
  });
  let enterprise = null;

  const result = applyPlan({
    plan,
    vars,
    manifest,
    dryRun,
    force,
    baseline: baselineEnabled,
    // upgrade 时模板侧未变（base === theirs）视为无冲突；install/add-host 保持旧冲突语义。
    benignUnchanged: commandLabel === 'upgrade',
    log: (action, msg) => logger(action, msg, (done += 1), total),
  });

  emit(summaryLine(result.stats, t));

  let gitConfigured = false;
  if (!dryRun) {
    const beforeDerived = { ...result.files };
    const derived = new Set(previous?.derived || []);
    generateDerivedArtifacts(target);
    // 派生工件会改写已写入的托管文件（如 workflow/INDEX.md）；重算这些文件的哈希，
    // 否则 manifest 记录的是生成前的文本，fresh install 会立刻显示为漂移。
    // 被生成器改写的文件登记到 derived，diff 不对其做静态模板比对。
    for (const rel of result.written || []) {
      // 三方合并冲突/合并文件保留旧哈希，供 diff / doctor 继续提示未解决。
      if ((result.skipRehash || []).includes(rel)) continue;
      try {
        const text = fs.readFileSync(path.join(target, rel), 'utf8');
        const nextHash = sha256Text(text);
        result.files[rel] = nextHash;
        if (beforeDerived[rel] !== nextHash) {
          derived.add(rel);
          // 派生工件在安装期重写，基线同步为最终文本，避免下次升级误判。
          if (baselineEnabled) writeBaseline(target, rel, text);
        } else derived.delete(rel);
      } catch {
        /* 生成器删除的文件不保留 manifest 记录 */
        delete result.files[rel];
        derived.delete(rel);
      }
    }
    // 模型 ID 是机器本地状态：只写 gitignore 的 local 覆盖，不进 manifest。
    if (models && (commandLabel !== 'upgrade' || explicitModels)) {
      const saved = writeLocalModelRoles(target, models, {
        overwrite: explicitModels || commandLabel === 'add-host',
      });
      if (saved.written) emit(t('install.localModels', { path: path.join(target, '.agents/config/model-roles.local.json') }));
    }

    const next = {
      ...manifest,
      version: KIT_VERSION,
      installedAt,
      language: lang,
      hosts: hostSet,
      stack,
      surfaces,
      projectName,
      trackHosts,
      derived: [...derived].filter((rel) => result.files[rel]).sort(),
      tier,
      hardened,
      mcp: mcpEnabled,
      mcpServers: result.mcp || {},
      managedPermissions: result.managedPermissions || {},
      mergeOrigins: result.mergeOrigins || {},
      baseline: baselineEnabled,
      baselineVersion: baselineEnabled ? KIT_VERSION : null,
      files: result.files,
    };
    enterprise = computeEnterprise({ target, hosts: hostSet, hardened });
    if (enterprise) {
      next.enterprise = enterprise;
      emit(t('install.enterprise', {
        posture: enterprise.posture,
        gaps: enterprise.gaps.length ? enterprise.gaps.join(', ') : '-',
      }));
    } else {
      delete next.enterprise;
    }
    writeManifest(target, next);
    emit(t('install.manifest', { path: path.join(target, '.agents/install-manifest.json') }));

    const gitConfig = flag(args, 'git-config') || (!flag(args, 'no-git-config') && isGitRepo(target));
    if (gitConfig && isGitRepo(target)) {
      configureGit(target);
      gitConfigured = true;
      emit(t('install.gitConfig'));
    } else if (!gitConfig) {
      emit(t('install.gitSkip'));
    }
    emit(t('install.next'));
  }

  if (asJson) {
    console.log(JSON.stringify({
      command: commandLabel,
      target,
      dryRun,
      language: lang,
      stack,
      surfaces,
      tier,
      hardened,
      ...(enterprise ? { enterprise } : {}),
      ...(policyDiff ? { policyDiff } : {}),
      hosts: hostSet,
      detectedHosts,
      mcp: mcpEnabled,
      baseline: baselineEnabled,
      models: models ? summarizeModels(models) : null,
      plan: { count: plan.entries.length },
      stats: result.stats,
      conflicts: result.conflicts || [],
      written: result.written || [],
      manifest: dryRun ? null : path.join(target, '.agents/install-manifest.json'),
      gitConfigured,
    }, null, 2));
  }
  return flag(args, 'strict') && result.stats.conflict > 0 ? 1 : 0;
}
