import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { flag } from '../cli/args.mjs';
import { makeT } from '../i18n.mjs';
import { buildPlan, CI_MODES, ciModeFor, ciTemplateRels, TEMPLATES, LOCALES } from '../install/plan.mjs';
import { prepareBundleForInstall } from './bundle.mjs';
import { forgeFromRemote, originUrl } from '../install/forge.mjs';
import { parseProfileArgs, STACKS } from '../install/profiles.mjs';
import { stackMarkers } from '../install/stack-registry.mjs';
import { applyPlan, readPlanEntry, summaryLine } from '../install/apply.mjs';
import { emptyManifest, readManifest, sha256Text, writeManifest } from '../install/manifest.mjs';
import { acquireInstallLock } from '../install/lock.mjs';
import { cleanupMigratedFiles } from '../install/migrations.mjs';
import { scanGateConfigs } from '../install/gate-summary.mjs';
import { buildVars } from '../render/tokens.mjs';
import { HOST_NAMES, HOSTS, resolveHost, canonicalHostName } from '../hosts/registry.mjs';
import { detectHosts } from '../hosts/detect.mjs';
import { configureGit, HOOKS_PATH, isGitRepo, readLocalHooksPath } from '../git/config.mjs';
import { isBinaryPath, writeBaseline } from '../install/baseline.mjs';
import { wireUserHooks } from '../install/user-hooks.mjs';
import { explainPolicyDiff, renderPolicyDiff } from '../install/policy-diff.mjs';
import { RUNTIME_SCRIPTS } from './runtime.mjs';
import { readInstalledAt } from './replay.mjs';
import {
  parseModelFlags, readInjectedModels, resolveModels, summarizeModels, writeLocalModelRoles,
} from '../models/resolve.mjs';

// 审查遗留批 2026-11-23：实现迁往 src/install/version.mjs 单源；此处 import + 再导出，
// 既有外部导入方（tools/lint-templates、tui/hud、workspace、bundle）零变化，模块内 KIT_VERSION 照常可用。
import { readKitVersion } from '../install/version.mjs';
import { detectProductMode } from '../install/profiler.mjs';
export { readKitVersion, detectProductMode };

const KIT_VERSION = readKitVersion();

// 项目形态 / 脚手架档位：CLI 校验与 TUI 向导共用的单一来源（顺序即合法值列表与菜单顺序）。
export const PRODUCT_MODES = ['web', 'api', 'library', 'cli', 'monorepo'];
export const SCAFFOLD_MODES = ['full', 'minimal', 'none'];

// 端口规则（1–65535 的整数）：CLI 的 --api-port/--web-port 与 TUI 输入共用；非法值返回 null。
export function parsePortNumber(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

export function resolveTarget(args) {
  const target = path.resolve(args.target || process.cwd());
  if (!fs.existsSync(target)) {
    const err = new Error(`target not found: ${target}`);
    err.code = 'TARGET_MISSING';
    throw err;
  }
  if (!fs.statSync(target).isDirectory()) {
    // 复用 TARGET_MISSING 让退出码落在目标类（3）；专用映射需改 src/cli/exit.mjs（本次范围外）。
    const t = makeT(args.lang || 'zh-CN');
    const err = new Error(t('error.targetNotDirectory', { target }));
    err.code = 'TARGET_MISSING';
    throw err;
  }
  return target;
}

// 安装时间戳沿用已装 engine.json 的 createdAt（重跑 / 崩溃续装字节幂等）；读取口径与重放共用：replay.mjs 的 readInstalledAt。读不到（首装 / 损坏）返回 null。

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
    const key = canonicalHostName(name);
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

// 根目录标记（单源：stack-registry.mjs，顺序即优先级；package.json 在最后，避免吞掉 Cargo.toml / go.mod / pom.xml / tsconfig.json）。
// label 是菜单上的典型标记；match 返回实际命中的文件名。
const STACK_MARKERS = stackMarkers();

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

// 可选技术栈闭集单一来源在 profiles.mjs；TUI 向导栈菜单由它生成
export { STACKS };

// 闭集校验：任何显式声明的栈不在 STACKS 内 → BAD_STACK（废除旧的 existsSync 静默回落 empty）。
export function validateStacks(values, t) {
  for (const value of values) {
    if (!STACKS.includes(value)) {
      const err = new Error(t('error.badStack', { value, stacks: STACKS.join(', ') }));
      err.code = 'BAD_STACK';
      throw err;
    }
  }
}

export function resolveStack(args, target, t) {
  const stack = String(args.stack || args.profile || detectStack(target));
  validateStacks([stack], t);
  return stack;
}

// 显式声明（--stack 重复/逗号收集，或 --profile）→ 闭集校验后去重；无显式声明 → 探测。
export function resolveStacks(args, target, t) {
  const declared = args.stacks?.length ? args.stacks : [args.stack || args.profile].filter(Boolean);
  if (!declared.length) return [detectStack(target)];
  validateStacks(declared, t);
  return [...new Set(declared)];
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

// 派生工件会改写已写入的托管文件（如 workflow/INDEX.md）；重算这些文件的哈希，
// 否则 manifest 记录的是生成前的文本，fresh install 会立刻显示为漂移。
// 被生成器改写的文件登记到 derived，diff 不对其做静态模板比对。
export function rehashDerivedArtifacts({ target, result, derived, beforeDerived, baselineEnabled, warn }) {
  for (const rel of result.written || []) {
    // 三方合并冲突/合并文件保留旧哈希，供 diff / doctor 继续提示未解决。
    if ((result.skipRehash || []).includes(rel)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(target, rel), 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') {
        /* 生成器删除的文件不保留 manifest 记录 */
        delete result.files[rel];
        derived.delete(rel);
      } else {
        // 瞬时读错误（Windows EBUSY/EPERM，杀毒/索引服务常见）：写入已成功、记录是写入文本的哈希，
        // 保留记录留下可见漂移（doctor 可检出）而非静默失忆（升级永久 skip / uninstall 不清理）；
        // 不 fail-loud，避免把瞬时错误放大成重跑半安装。
        warn?.(`${rel}（读取失败 ${err?.code || err}，保留 manifest 记录）`);
      }
      continue;
    }
    const nextHash = sha256Text(text);
    result.files[rel] = nextHash;
    if (beforeDerived[rel] !== nextHash) {
      derived.add(rel);
      // 派生工件在安装期重写，基线同步为最终文本，避免下次升级误判。
      if (baselineEnabled) writeBaseline(target, rel, text);
    } else derived.delete(rel);
  }
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
// 运行时实现已随包分发，因此从包内脚本执行，只把 cwd/根指向目标项目。
function generateDerivedArtifacts(target) {
  for (const script of ['gen-workflow-index.mjs', 'gen-engine-map.mjs']) {
    const abs = path.join(RUNTIME_SCRIPTS, script);
    if (!fs.existsSync(abs)) continue;
    try {
      spawnSync(process.execPath, [abs], {
        cwd: target,
        stdio: 'ignore',
        windowsHide: true,
        timeout: 30000,
        env: { ...process.env, FLOW_KIT_PROJECT_ROOT: target },
      });
    } catch { /* 派生工件失败不阻断安装；verify/dream 会报漂移 */ }
  }
}

const TIERS = ['lean', 'standard', 'enterprise'];

// enterprise 证明链所需工件；脚本随包分发，目标侧只核对声明式配置。
export const PROOF_CHAIN_FILES = [
  '.agents/config/agent-eval.json',
  '.agents/config/pipeline.json',
];
export const PROOF_CHAIN_RUNTIME = [
  'agent-eval.mjs',
  'check-pipeline-state.mjs',
  'outcome-metrics.mjs',
];
export const GIT_HOOKS = ['pre-commit', 'commit-msg', 'post-commit', 'pre-merge-commit', 'pre-push'];

// 实际启用的加固姿态：managed（宿主 managed-only 配置）/ permissions（权限编译）/
// hooks（仅命令门禁）/ none。hooks 与 none 都算缺口（无权限面）。
export function computeEnterprise({ target, hosts, hardened, ci = null }) {
  if (!hardened) return null;
  const matrix = {};
  const gaps = [];
  for (const host of hosts) {
    const level = HOSTS[host]?.hardening?.level || 'none';
    matrix[host] = level;
    if (level !== 'managed' && level !== 'permissions') gaps.push(host);
  }
  const proofChain = PROOF_CHAIN_FILES.every((rel) => fs.existsSync(path.join(target, rel)))
    && PROOF_CHAIN_RUNTIME.every((name) => fs.existsSync(path.join(RUNTIME_SCRIPTS, name)));
  const policyChecks = [];
  const ciRels = ciTemplateRels(ciModeFor({ tier: 'enterprise', ci }));
  if (GIT_HOOKS.every((name) => fs.existsSync(path.join(target, '.githooks', name)))) policyChecks.push('githooks');
  if (ciRels.length && ciRels.some((rel) => fs.existsSync(path.join(target, rel)))) policyChecks.push('ci');
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

function normalizeCi(value, t) {
  const v = String(value || '').toLowerCase();
  if (!CI_MODES.includes(v)) {
    const err = new Error(t('error.badCi', { value: value || '' }));
    err.code = 'BAD_CI';
    throw err;
  }
  return v;
}

// onLog 回调契约：(action, msg, done, total) —— action ∈ create/update/skip/conflict/merge，
// done/total 为已完成/总文件数，供 TUI 渲染 spinner 进度；缺省走 CLI 前缀行。
// 整个安装流程（含 dry-run）持单写者锁：入口取锁，finally 释放，异常/崩溃路径同样解锁。
export function runInstall(options) {
  const target = resolveTarget(options.args);
  const releaseInstallLock = acquireInstallLock(target, { label: options.commandLabel, t: options.t });
  try {
    return runInstallUnlocked(options);
  } finally {
    releaseInstallLock();
  }
}

function runInstallUnlocked({ args, t, lang, hosts, planHosts = hosts, categories, commandLabel, stackOverride, stacksOverride = null, onLog = null, detectedHosts = [], migration = null, quiet = false }) {
  const bundleArg = args.bundle || null;
  const bundleHandle = bundleArg ? prepareBundleForInstall(bundleArg, t) : null;
  const templatesRoot = bundleHandle?.templatesRoot || TEMPLATES;
  const localesRoot = bundleHandle?.localesRoot || LOCALES;

  try {
    const target = resolveTarget(args);
  const dryRun = flag(args, 'dry-run');
  const force = flag(args, 'force');
  const asJson = flag(args, 'json');
  // --json 时 stdout 只允许出现最终 JSON；人类进度走 stderr，逐文件日志默认静默。
  // quiet：命令间复用（add-skill / remove-skill 重放宿主面）时完全静默，由调用方统一输出。
  const emit = quiet
    ? () => {}
    : asJson
      ? (...line) => console.error(...line)
      : (...line) => console.log(...line);
  const logger = onLog || (quiet || asJson ? () => {} : logLine);
  const previous = readManifest(target);
  const profile = parseProfileArgs({
    stackArg: args.stacks,
    surfaceArgs: args.surfaces || [],
    fallbackSurfaces: previous?.surfaces || [],
    fallbackStacks: previous?.stacks || [],
    t,
  });
  // 栈序列：显式 override > 显式声明（--stack/--profile）> 单栈 override（add-host 等重放）> 探测。
  const stacks = stacksOverride
    || (profile.stacks.length ? profile.stacks : (stackOverride ? [stackOverride] : resolveStacks(args, target, t)));
  validateStacks(stacks, t);
  const stack = stackOverride || stacks[0];
  const surfaces = profile.surfaces;
  const projectName = args.name || path.basename(target);
  // 渲染与 manifest 使用同一时间戳，避免 diff 把 {{installedAt}} 误判为模板更新。
  // 重跑/续装幂等：engine.json 已有 createdAt（{{installedAt}} 的渲染产物）时复用既有值。
  const installedAt = readInstalledAt(target) || new Date().toISOString();
  let hostSet = [...new Set([...(previous?.hosts || []), ...hosts])];
  const trackHosts = flag(args, 'track-hosts');
  // 档位：CLI > --hardened（=enterprise）> 既有 manifest > standard。
  // 档位只影响交付面（CI / 加固），不削弱引擎门禁。
  const tier = normalizeTier(
    args.tier || (flag(args, 'hardened') ? 'enterprise' : null) || previous?.tier || 'standard',
    t,
  );
  const hardened = flag(args, 'hardened') || tier === 'enterprise' || Boolean(previous?.hardened && !args.tier);
  // 条目 38（ADR capability-guarantee-tiered-blocking，accepted·进·窄化）：enterprise 档承诺 hardened
  // 接线，宿主 `hardening.level === 'none'` 无法满足——拒装该宿主（阈值与 doctor 体检期 fail 一致；
  // hooks 级放行，其缺口仍走 gaps advisory）。判定单源读 registry 能力字段，禁按宿主名分支。
  // 全部被拒 → 硬失败；部分被拒 → 剔除后照装其余并输出列明（不静默降级）。
  if (hardened) {
    const blocked = hostSet.filter((h) => (HOSTS[h]?.hardening?.level || 'none') === 'none');
    if (blocked.length === hostSet.length) {
      const err = new Error(t('error.enterpriseHostBlocked', { hosts: blocked.join(', ') }));
      err.code = 'ENTERPRISE_HOST_BLOCKED';
      throw err;
    }
    if (blocked.length) {
      const blockedSet = new Set(blocked);
      hostSet = hostSet.filter((h) => !blockedSet.has(h));
      planHosts = planHosts.filter((h) => !blockedSet.has(h));
      emit(t('warn.enterpriseHostSkipped', { hosts: blocked.join(', ') }));
    }
  }
  // CI 交付面：显式 --ci 优先；其次重放 manifest。旧 manifest（≤2.10，无 ci 字段）按既有交付面
  // （manifest.files 里实际安装的 CI 文件）推导，不得按 origin 重新探测而搁浅旧 CI 文件；从未装过 CI
  // （无文件）时按全新安装同款的 origin 探测择一（github / azure），认不出回 none——不回 both，避免
  // 给从未有 CI 的旧装凭空补发双份 CI 文件（enterprise 保持双发以满足策略承诺）。lean 仍不发。
  const legacyCiFromFiles = (m) => {
    if (!m?.files) return null;
    const hasGithub = '.github/workflows/ci.yml' in m.files;
    const hasAzure = 'azure-pipelines.yml' in m.files;
    const hasGitlab = '.gitlab-ci.yml' in m.files;
    if (hasGithub && hasAzure) return 'both';
    if (hasGithub) return 'github';
    if (hasAzure) return 'azure';
    if (hasGitlab) return 'gitlab';
    return null; // 都没有：无 CI（如 lean）
  };
  // 远端托管平台 → CI 交付面：GitHub / Azure / GitLab。
  const ciFromForge = (forge) => {
    if (forge === 'github' || forge === 'azure' || forge === 'gitlab') return forge;
    return null;
  };
  const ciChoice = args.ci !== undefined
    ? normalizeCi(args.ci, t)
    : previous
      ? (previous.ci !== undefined && previous.ci !== null
        ? previous.ci
        : (legacyCiFromFiles(previous)
          // 审查遗留批 2026-11-23：无既有 CI 文件时复用全新安装的 origin 探测，不再无条件回退 both。
          // lean 档与全新安装同口径：恒不发 CI（ci-select 回归）。
          || (tier === 'lean' ? null : (ciFromForge(forgeFromRemote(originUrl(target))) || (tier === 'enterprise' ? 'both' : 'none')))))
      : (tier === 'lean' ? null : (ciFromForge(forgeFromRemote(originUrl(target))) || (tier === 'enterprise' ? 'both' : 'none')));

  // 项目形态 / 端口 / 脚手架档位：显式参数 > manifest 重放 > 智能探测 > 缺省（web / 栈默认端口 / full）。
  const explicitProduct = args.product || previous?.product;
  const product = String(explicitProduct || detectProductMode(target) || 'web').toLowerCase();
  if (!PRODUCT_MODES.includes(product)) {
    const err = new Error(t('error.badProduct', { value: args.product || '', modes: PRODUCT_MODES.join(', ') }));
    err.code = 'BAD_PRODUCT';
    throw err;
  }
  const parsePort = (raw, flagName) => {
    if (raw === undefined) return undefined;
    const n = parsePortNumber(raw);
    if (n === null) {
      const err = new Error(t('error.badPort', { flag: flagName, value: String(raw) }));
      err.code = 'BAD_PORT';
      throw err;
    }
    return n;
  };
  const ports = {
    api: parsePort(args['api-port'], '--api-port') ?? previous?.ports?.api,
    web: parsePort(args['web-port'], '--web-port') ?? previous?.ports?.web,
  };
  const scaffoldMode = String(args.scaffold || previous?.scaffold || 'full').toLowerCase();
  if (!SCAFFOLD_MODES.includes(scaffoldMode)) {
    const err = new Error(t('error.badScaffold', { value: args.scaffold || '', modes: SCAFFOLD_MODES.join(', ') }));
    err.code = 'BAD_SCAFFOLD';
    throw err;
  }

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
  // --probe-models 非交互路径无法逐条确认：探测前把宿主声明的命令打到人类进度流（审计痕迹；--json 时走 stderr）。
  if (flag(args, 'probe-models') && shouldProbe && modelMode !== 'inherit') {
    for (const host of planHosts) {
      const commands = (HOSTS[host]?.modelProbe?.cli || [])
        .filter((c) => c?.command)
        .map((c) => [c.command, ...(c.args || [])].join(' '))
        .join('; ');
      if (commands) emit(t('install.probeCli', { host, commands }));
    }
  }
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

  // 开发容器（R3-8 沙箱面）随 manifest 走：--no-devcontainer 关闭、--devcontainer 重新开启；
  // 都没给时沿用既有选择（upgrade 重放 manifest，不静默改主意）。
  const devcontainerEnabled = flag(args, 'no-devcontainer')
    ? false
    : (flag(args, 'devcontainer') ? true : previous?.devcontainer !== false);

  const plan = buildPlan({
    target, hosts: planHosts, lang, stack, stacks, projectName, categories, models: models?.hosts, tier, hardened,
    mcp: mcpEnabled, surfaces,
    managedPermissions: previous?.managedPermissions || {},
    devcontainer: devcontainerEnabled,
    ci: ciChoice,
    scaffold: scaffoldMode,
    templatesRoot,
    localesRoot,
  });
  let done = 0;
  const total = plan.entries.length;
  const vars = buildVars({
    target,
    projectName,
    stack,
    stacks,
    language: lang,
    hosts: hostSet,
    kitVersion: KIT_VERSION,
    installedAt,
    trackHosts,
    ports,
    product,
  });

  // --baseline-only：只重建基线目录，不重装。基线（.agents/.kit/baseline）被 .gitignore 忽略，
  // fresh clone / git clean -fdx 后必然缺失而 manifest 仍声明 baseline=true；
  // 这里按 manifest 登记把基线补回来，不执行安装流程的任何其他动作。
  if (flag(args, 'baseline-only')) {
    if (!previous) {
      const err = new Error(t('error.noManifest'));
      err.code = 'NO_MANIFEST';
      throw err;
    }
    // 语言重放（与 upgrade 同口径）：en 装户不带 --lang 重跑时按 manifest 语言渲染，
    // 否则模板语言与磁盘不符会整盘 skipped。只影响本分支；主流程 lang 语义不变。
    const rebuildLang = args.lang || previous.language || lang;
    const rebuildPlan = buildPlan({
      target, hosts: planHosts, lang: rebuildLang, stack, stacks, projectName, categories, models: models?.hosts, tier, hardened,
      mcp: mcpEnabled, surfaces,
      managedPermissions: previous?.managedPermissions || {},
      devcontainer: devcontainerEnabled,
      ci: ciChoice,
      scaffold: scaffoldMode,
      templatesRoot,
      localesRoot,
    });
    const rebuildVars = buildVars({
      target,
      projectName,
      stack,
      stacks,
      language: rebuildLang,
      hosts: hostSet,
      kitVersion: KIT_VERSION,
      installedAt,
      trackHosts,
      ports,
      product,
    });
    const managed = previous.files || {};
    const rebuilt = [];
    const skipped = [];
    for (const entry of rebuildPlan.entries) {
      // 基线只收文本直写结果（与 applyPlan 同口径）；合并块 / 配置合并不走基线。
      if (entry.kind !== 'file' && entry.kind !== 'generated') continue;
      const rel = entry.targetRel;
      if (managed[rel] === undefined || isBinaryPath(rel)) continue;
      const text = readPlanEntry(entry, rebuildVars);
      if (text == null) continue;
      let onDisk = null;
      try {
        onDisk = fs.readFileSync(path.join(target, rel), 'utf8');
      } catch { /* 磁盘缺失按跳过处理 */ }
      if (onDisk == null) {
        skipped.push(rel);
        continue;
      }
      const diskHash = sha256Text(onDisk);
      // 磁盘与上次工具写入（manifest 哈希）或当前模板渲染一致才重建；
      // 否则用户改过或模板已升级，跳过并提示先 upgrade。
      if (diskHash === managed[rel] || diskHash === sha256Text(text)) {
        if (!dryRun) writeBaseline(target, rel, onDisk);
        rebuilt.push(rel);
      } else {
        skipped.push(rel);
      }
    }
    const skippedNote = skipped.length ? t('install.baselineOnlySkipped', { count: skipped.length }) : '';
    emit(t('install.baselineOnly', { count: rebuilt.length, skippedNote }));
    if (!dryRun) {
      writeManifest(target, { ...previous, baseline: true, baselineVersion: KIT_VERSION });
    }
    if (asJson) {
      console.log(JSON.stringify({
        command: commandLabel,
        baselineOnly: true,
        rebuilt,
        skipped,
        manifest: dryRun ? null : path.join(target, '.agents/install-manifest.json'),
      }, null, 2));
    }
    return 0;
  }

  const explainPolicy = flag(args, 'explain-policy');
  const policyDiff = explainPolicy ? explainPolicyDiff({ target, plan, vars }) : null;

  emit(t('install.start', { command: commandLabel, target }));
  emit(t('install.plan', { hosts: hostSet.join(', '), stack: stacks.join(', '), lang, count: plan.entries.length }));
  emit(t('install.tier', { tier, hardened: t(hardened ? 'tui.yes' : 'tui.no') }));
  emit(t('install.ci', { mode: ciModeFor({ tier, ci: ciChoice }) }));
  if (migration?.changed) {
    const steps = `${migration.applied.join(', ')}${migration.dryRun ? ' (dry-run)' : ''}`;
    emit(t('install.migration', { steps }));
  }
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
  const userHooks = [];
  let migrationCleanup = null;
  if (!dryRun) {
    const beforeDerived = { ...result.files };
    const derived = new Set(previous?.derived || []);
    generateDerivedArtifacts(target);
    // 生成器运行后重算派生工件的哈希并登记 derived（细节见 rehashDerivedArtifacts）
    rehashDerivedArtifacts({
      target,
      result,
      derived,
      beforeDerived,
      baselineEnabled,
      // 读失败告警走冲突通道：CLI 缺省 `! msg` 留行，TUI conflict 不被进度条吞掉
      warn: (msg) => logger('conflict', msg, done, total),
    });
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
      product,
      ...(scaffoldMode !== 'full' ? { scaffold: scaffoldMode } : {}),
      derived: [...derived].filter((rel) => result.files[rel]).sort(),
      tier,
      hardened,
      mcp: mcpEnabled,
      mcpServers: result.mcp || {},
      devcontainer: devcontainerEnabled,
      managedPermissions: result.managedPermissions || {},
      mergeOrigins: result.mergeOrigins || {},
      baseline: baselineEnabled,
      baselineVersion: baselineEnabled ? KIT_VERSION : null,
      files: result.files,
    };
    if (bundleHandle?.bundleInfo) {
      next.bundle = bundleHandle.bundleInfo;
    } else if (previous?.bundle) {
      next.bundle = previous.bundle;
    }
    // 新安装记下择一结果，upgrade 重放。lean 且未显式选择不写字段。
    if (ciChoice) next.ci = ciChoice;
    else delete next.ci;
    // 多栈序列只记显式/重放出的多栈；单栈安装不写 stacks 字段（manifest 字节与历史一致）。
    if (stacks.length > 1) next.stacks = stacks;
    else delete next.stacks;
    // 端口只记显式/重放的值；缺省端口继续跟随栈注册表（升级时不会被旧默认值钉死）。
    const portState = {};
    if (ports.api !== undefined) portState.api = ports.api;
    if (ports.web !== undefined) portState.web = ports.web;
    if (Object.keys(portState).length) next.ports = portState;
    else delete next.ports;
    enterprise = computeEnterprise({ target, hosts: hostSet, hardened, ci: ciChoice });
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

    // 用户级 hook 接线（issue #45）：hooks 配置在用户目录（如 ~/.codex/hooks.json），不在项目仓内。
    // 数据驱动遍历 hostSet 里带 userHooks 能力的宿主；编辑即失效条目信任哈希，输出必须带重信任提醒。
    for (const host of hostSet) {
      if (!HOSTS[host]?.userHooks) continue;
      const wired = wireUserHooks({ host, t });
      userHooks.push({ host, changed: wired.changed });
      emit(wired.changed
        ? t('install.userHooksChanged', { host: HOSTS[host].label || host, path: wired.file })
        : t('install.userHooksOk', { host: HOSTS[host].label || host, path: wired.file }));
    }

    // R5-1b + P2-4：迁移只摘 manifest；磁盘旧运行时文件在此按旧哈希安全删除。
    // 清理资格持久化在 manifest.pendingRemovals（迁移落盘时写入，见 migrations.mjs）：
    // 迁移落盘后、清理前任一环节失败（如 user-hooks fail-loud）时，重跑仍凭该字段完成
    // 清理，而不是一次性机会。被用户改过的文件按哈希守卫保留。
    const pendingRemovals = { ...manifest.pendingRemovals };
    if (Object.keys(pendingRemovals).length) {
      migrationCleanup = cleanupMigratedFiles({
        target,
        files: pendingRemovals,
        removals: Object.keys(pendingRemovals),
        dryRun: false,
      });
      if (migrationCleanup.removed.length) {
        emit(t('install.runtimeCleanup', { count: migrationCleanup.removed.length }));
      }
      // 清理资格一次性消费：删过（或守卫保留）即清空字段回写，避免滞留资格反复空转。
      delete next.pendingRemovals;
      writeManifest(target, next);
    }
    if (migration) migration.cleanup = migrationCleanup;

    const gitConfig = flag(args, 'git-config') || (!flag(args, 'no-git-config') && isGitRepo(target));
    if (gitConfig && isGitRepo(target)) {
      // configureGit 会覆盖旧值，必须先读；只记一次（清单已有该字段，含 null，就保留），
      // 否则升级/重装会把本工具自己的 .githooks 误记成「安装前的值」。
      if (!('prevHooksPath' in next)) {
        const prev = readLocalHooksPath(target);
        next.prevHooksPath = prev === HOOKS_PATH ? null : prev;
        writeManifest(target, next);
      }
      configureGit(target);
      gitConfigured = true;
      emit(t('install.gitConfig'));
    } else if (!gitConfig) {
      emit(t('install.gitSkip'));
    }
    emit(t('install.next'));
    // 门禁配置一览：未配置 = SKIP（规则在项目里，机制随包）。升级老装户时这条尤其重要——
    // 内置规则改读配置后，不补配置的项目门禁会从「执法」变成「静默跳过」。
    const gateSummary = scanGateConfigs(target);
    if (gateSummary.invalid.length) {
      emit(t('install.gateInvalid', { files: gateSummary.invalid.join(', ') }));
    }
    if (gateSummary.missing.length) {
      emit(t('install.gateMissing', {
        count: gateSummary.missing.length,
        files: gateSummary.missing.join(', '),
        doc: '.agents/notes/project-configs.md',
      }));
    } else {
      emit(t('install.gateConfigured'));
    }
  }

  if (asJson) {
    console.log(JSON.stringify({
      command: commandLabel,
      target,
      dryRun,
      language: lang,
      stack,
      stacks,
      surfaces,
      tier,
      hardened,
      ci: ciModeFor({ tier, ci: ciChoice }),
      ...(enterprise ? { enterprise } : {}),
      ...(policyDiff ? { policyDiff } : {}),
      // P2-4：migration 块在有实际迁移、或发生了持久资格清理（恢复路径）时输出；
      // removed 上报实际删除结果，keptLegacy 合并清理守卫保留的文件。
      ...(migration?.changed || migrationCleanup?.removed.length ? {
        migration: {
          from: migration?.from ?? manifest.schemaVersion,
          to: migration?.to ?? manifest.schemaVersion,
          changed: migration?.changed ?? false,
          dryRun: migration?.dryRun ?? false,
          applied: migration?.applied || [],
          notes: migration?.notes || [],
          removed: migrationCleanup?.removed || [],
          keptLegacy: [...new Set([...(migration?.keptLegacy || []), ...(migrationCleanup?.kept || [])])],
        },
      } : {}),
      hosts: hostSet,
      detectedHosts,
      mcp: mcpEnabled,
      devcontainer: devcontainerEnabled,
      baseline: baselineEnabled,
      ...(userHooks.length ? { userHooks } : {}),
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
  } finally {
    bundleHandle?.cleanup();
  }
}
