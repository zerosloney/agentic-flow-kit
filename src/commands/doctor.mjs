import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { flag } from '../cli/args.mjs';
import { readManifest } from '../install/manifest.mjs';
import { doctorGit } from '../git/config.mjs';
import { HOSTS, hostTargetRel, hostSource } from '../hosts/registry.mjs';
import { ciModeFor, ciTemplateRels, listFiles, readGatesSpecs, TEMPLATES } from '../install/plan.mjs';
import { readMcpServers, containerKey } from '../install/mcp.mjs';
import { readToolPolicy } from '../install/tool-policy.mjs';
import { checkDevcontainer } from '../install/devcontainer.mjs';
import { findHookDrift, inapplicableForUserHooks, inapplicableSpecs } from '../install/hooks.mjs';
import { inspectUserHookEntry } from '../install/user-hooks.mjs';
import { listBaselines } from '../install/baseline.mjs';
import { RULE_FAMILIES } from '../install/gate-summary.mjs';
import { buildAttestation, writeAttestation } from '../install/attest.mjs';
import { compilePermissions, permissionDrift } from '../install/permissions.mjs';
import { ROLE_NAMES, readInjectedModels, readLocalModelRoles } from '../models/resolve.mjs';
import { computeEnterprise, GIT_HOOKS, PROOF_CHAIN_FILES, resolveTarget } from './install.mjs';
import { verifySbom } from './sbom.mjs';
import { parseJsonc } from '../rules/jsonc.mjs';
import { splitWaivers } from '../rules/model.mjs';
import { loadModel } from '../rules/load.mjs';
import { readPluginStatus } from '../rules/plugin-status.mjs';
import { signPayload, writeSignatureFile } from '../install/notary.mjs';
import { runGovernanceProbes } from '../governance/probes.mjs';
import { RUNTIME_SCRIPTS, RUNTIME_HOOKS, KIT_ROOT } from './runtime.mjs';
import { buildDiff } from './diff.mjs';
import { WIKI_NAMES, WIKI_TOPIC_KEYS } from '../install/wiki-names.mjs';
import { loadFaces, isProductPath } from '../../templates/engine/.agents/scripts/faces.mjs';

const HOOK_FILES = ['pre-commit', 'commit-msg', 'post-commit', 'pre-merge-commit', 'pre-push'];

// inapplicableSpecs() 的原因码 -> 文案键：宿主能力面不含该条目时解释降级原因。
const HOOK_INAPPLICABLE_REASONS = {
  event: 'doctor.hooksEventUnsupported',
  tool: 'doctor.hooksToolUnsupported',
  matcher: 'doctor.hooksMatcherUnsupported',
};

// MCP 运行时工具面：来自包内 server 实现（wiki-mcp.mjs）。新增工具时同步更新。
// doctor 拿它和 toolPolicy.servers 声明做双向对账。
const MCP_RUNTIME_TOOLS = [{ name: 'wiki_search' }];
const allowedHas = (policy, server, tool) => Boolean(policy?.servers?.[server]?.has(tool));

// R5-1b：运行时实现应随包分发；目标项目里残留的旧脚本/hook 代码只作 advisory。
// 只对照包内确实存在的运行时文件，避免把项目自建的 hook 误报为遗留。
function listLegacyRuntime(target) {
  const out = [];
  const collect = (dir, relPrefix, filter = () => true) => {
    const walk = (abs, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(abs, entry.name), nextRel);
        else if (filter(entry.name) && fs.existsSync(path.join(target, relPrefix, nextRel))) {
          out.push(`${relPrefix}/${nextRel}`);
        }
      }
    };
    walk(dir, '');
  };
  collect(RUNTIME_SCRIPTS, '.agents/scripts', (name) => /\.(mjs|cjs)$/i.test(name));
  collect(RUNTIME_HOOKS, '.agents/hooks', (name) => /\.(mjs|cjs)$/i.test(name));
  collect(path.join(KIT_ROOT, 'templates/engine/.agents/tests'), '.agents/tests', (name) => /\.(mjs|cjs)$/i.test(name));
  return out.sort();
}

// PATH 上的 flow-kit 与安装清单各自演进，而钩子与 MCP 实际执行的是 PATH 上那个：
// 两侧各取第一段 x.y.z 比对。任一侧解析不出（如旧版输出任意文本）就返回 null，维持旧的仅探测可运行行为。
export function flowKitVersionDrift(cliOutput, manifestVersion) {
  const pick = (text) => (String(text || '').match(/\d+\.\d+\.\d+/) || [])[0] || null;
  const cli = pick(cliOutput);
  const manifest = pick(manifestVersion);
  if (!cli || !manifest || cli === manifest) return null;
  return { cli, manifest };
}

export function doctorCommand({ args, t }) {
  const target = resolveTarget(args);
  const asJson = flag(args, 'json');
  const checks = [];
  const add = (ok, name, detail, fix, extra = {}) => checks.push({ ok, name, detail, fix, ...extra });
  const roleVal = (entry) => (typeof entry === 'string' ? entry : entry?.model || null);

  const manifest = readManifest(target);
  const gates = manifest ? readGatesSpecs(manifest.language || 'zh-CN') : { hooks: null, permissions: null };
  const permissionSpec = gates.permissions;
  const permissionDeclared = Boolean(permissionSpec
    && (permissionSpec.allow.length || permissionSpec.deny.length || permissionSpec.ask.length));
  let diffResult = null;
  if (!manifest) {
    add(false, 'install-manifest', t('doctor.manifestMissing'));
  } else {
    add(true, 'install-manifest', `.agents/install-manifest.json (v${manifest.version || '?'})`);
    for (const rel of Object.keys(manifest.files || {})) {
      if (!fs.existsSync(path.join(target, rel))) add(false, `file ${rel}`, t('doctor.fileMissing'));
    }
    // 漂移是 advisory：用户改文件属正常，缺失已在上面按文件报错；明细交给 diff。
    const drift = (diffResult = buildDiff({ target, manifest })).summary;
    const drifting = drift.userModified + drift.kitUpdated + drift.orphan;
    if (drifting > 0) {
      add(true, 'manifest drift', t('doctor.drift', drift), t('doctor.driftHint'), { warn: true });
    }
    // issue #86：锚点外原文疑似被旧版安装覆盖（哈希可能一致，diff 默认不显示）——单独 advisory。
    const overwritten = (diffResult.items || []).filter((item) => item.overwritten).map((item) => item.targetRel);
    if (overwritten.length) {
      add(true, 'derived overwritten', t('doctor.derivedOverwritten', { files: overwritten.join(', ') }), t('doctor.derivedOverwrittenHint'), { warn: true });
    }
  }

  // R5-1b：运行时能力随包分发，目标项目不再需要脚本/hook 实现。
  const legacyRuntime = listLegacyRuntime(target);
  if (legacyRuntime.length) {
    add(true, 'runtime legacy', t('doctor.runtimeLegacy', { count: legacyRuntime.length }), t('doctor.runtimeLegacyHint'), { warn: true });
  }

  // 门禁与 MCP 以 `flow-kit` 命令为运行时入口：不在 PATH 时全部静默失效，必须显式告警。
  const winShell = process.platform === 'win32';
  const kitProbe = spawnSync(winShell ? 'flow-kit --version' : 'flow-kit', winShell ? [] : ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: winShell,
  });
  if (kitProbe.status === 0) {
    const drift = flowKitVersionDrift(String(kitProbe.stdout || ''), manifest?.version || '');
    if (drift) {
      // 版本不一致只提示不判红：旧版 CLI 仍可用，钩子与 MCP 的失效风险交给 hint 说明。
      add(true, 'flow-kit cli', t('doctor.flowKitVersionMismatch', drift), t('doctor.flowKitVersionMismatchHint'), { warn: true });
    } else {
      add(true, 'flow-kit cli', String(kitProbe.stdout || '').trim() || 'flow-kit');
    }
  } else {
    add(true, 'flow-kit cli', t('doctor.flowKitMissing'), t('doctor.flowKitMissingHint'), { warn: true });
  }

  checks.push(...doctorGit(target));

  // 基线是升级三方合并的底稿：缺失属 advisory（旧安装仍可哈希跳过）。
  if (manifest && (manifest.baseline === true || typeof manifest.baselineVersion === 'string')) {
    const baselines = listBaselines(target);
    if (!baselines.length) {
      add(true, 'baseline', t('doctor.baselineMissing'), '', { warn: true });
    } else {
      add(true, 'baseline', t('doctor.baseline', { count: baselines.length, version: manifest.baselineVersion || '?' }));
      const managed = new Set(Object.keys(manifest.files || {}));
      const orphans = baselines.filter((rel) => !managed.has(rel));
      if (orphans.length) {
        add(true, 'baseline orphans', t('doctor.baselineOrphans', { count: orphans.length }), '', { warn: true });
      }
    }
  }

  const attrPath = path.join(target, '.gitattributes');
  let attr = '';
  try {
    attr = fs.readFileSync(attrPath, 'utf8');
  } catch {
    /* missing handled below */
  }
  add(/merge=jsonl-union/.test(attr), '.gitattributes jsonl-union', attr ? '' : t('doctor.fileMissing'));
  add(/merge=ours/.test(attr), '.gitattributes ours', attr ? '' : t('doctor.fileMissing'));

  // 台账历史基线声明（issue #69 advisory）：已有确认台账而未声明基线时，check-ledger-invariant
  // 按全史扫描并把基线外历史违规照常上报（装户首跑易假红）；文件或 env 任一声明的即视为已声明。
  const hasLedger = fs.existsSync(path.join(target, '.agents', 'confirmations.jsonl'))
    || fs.existsSync(path.join(target, '.agents', 'confirmations.d'));
  if (manifest && hasLedger
    && !fs.existsSync(path.join(target, '.agents', 'notes', 'ledger-history-baseline.md'))
    && !process.env.LEDGER_HISTORY_BASELINE) {
    add(true, 'ledger baseline', t('doctor.ledgerBaselineMissing'), t('doctor.ledgerBaselineHint'), { warn: true });
  }

  for (const hook of HOOK_FILES) {
    add(fs.existsSync(path.join(target, '.githooks', hook)), `hook ${hook}`, '');
  }

  let mcpPolicyCache;
  for (const host of manifest?.hosts || []) {
    const h = HOSTS[host];
    if (!h) {
      add(false, `host ${host}`, t('doctor.unknownHost'));
      continue;
    }
    const source = hostSource(host);
    add(true, `host ${host} source`, t('doctor.hostSource', { host, source }));
    for (const rel of listFiles(h.templates || path.join(TEMPLATES, 'hosts', host))) {
      if (h.hardening?.settings && rel === h.hardening.settings) continue; // 替换源，不独立安装
      const targetRel = hostTargetRel(host, rel);
      if (!fs.existsSync(path.join(target, targetRel))) add(false, `host ${host}: ${targetRel}`, t('doctor.fileMissing'));
    }
    // 能力缺口：没有 hooks（项目级或用户级） / modelField 的宿主，相关保证只能是 advisory。
    if (!h.hooks && !h.userHooks) add(true, `guarantee ${host}`, t('doctor.guaranteeGap', { host, capability: 'hooks' }), '', { warn: true });
    if (h.agents && !h.agents.modelField) add(true, `guarantee ${host}`, t('doctor.guaranteeGap', { host, capability: 'model injection' }), '', { warn: true });

    // MCP 工具权限策略与运行时工具面对账（R3-8）：声明了白名单的 server 必须覆盖运行时工具。
    // 声明一次，所有宿主共享；声明无效时每个 MCP 宿主都要报告，不能只报第一个。
    let mcpPolicy = mcpPolicyCache;
    if (h.mcp && manifest?.mcp === true && mcpPolicy === undefined) {
      try {
        mcpPolicy = readToolPolicy(target);
      } catch (err) {
        mcpPolicy = { error: err };
      }
      mcpPolicyCache = mcpPolicy;
    }
    if (mcpPolicy?.error) {
      add(false, `mcp policy ${host}`, t('doctor.mcpPolicyInvalid', { detail: mcpPolicy.error.message }));
    }

    if (h.mcp && manifest?.mcp === true) {
      if (mcpPolicy?.error) continue;
      let servers = {};
      try {
        servers = readMcpServers(target);
      } catch (err) {
        add(false, `mcp ${host}`, t('doctor.mcpDeclarationInvalid', { detail: err.message }));
        continue;
      }
      const names = Object.keys(servers);
      if (!names.length) continue;
      const abs = path.join(target, h.mcp.file);
      if (!fs.existsSync(abs)) {
        add(false, `mcp ${host}`, t('doctor.mcpMissing', { path: h.mcp.file }));
        continue;
      }
      let root;
      try {
        root = JSON.parse(fs.readFileSync(abs, 'utf8'));
      } catch {
        add(false, `mcp ${host}`, t('doctor.mcpInvalid', { path: h.mcp.file }));
        continue;
      }
      let key;
      try {
        key = containerKey(h.mcp.format);
      } catch {
        key = null;
      }
      const container = key ? root?.[key] : null;
      if (!container || typeof container !== 'object') {
        add(false, `mcp ${host}`, t('doctor.mcpContainer', { path: h.mcp.file }));
        continue;
      }
      const missing = names.filter((name) => !(name in container));
      if (missing.length) add(false, `mcp ${host}`, t('doctor.mcpServersMissing', { servers: missing.join(', ') }));
      else add(true, `mcp ${host}`, `${h.mcp.file}: ${names.join(', ')}`);
      if (mcpPolicy) {
        const runtimeNames = new Set(MCP_RUNTIME_TOOLS.map((tool) => tool.name));
        const over = names.filter((name) => {
          const allowed = mcpPolicy.servers[name];
          return allowed && [...allowed].some((tool) => !runtimeNames.has(tool));
        });
        const under = names.filter((name) => {
          const allowed = mcpPolicy.servers[name];
          return allowed && [...runtimeNames].some((tool) => !allowed.has(tool));
        });
        if (over.length) {
          const detail = over.map((name) => `${name}: ${[...mcpPolicy.servers[name]].filter((tool) => !runtimeNames.has(tool)).join(', ')}`).join('; ');
          add(false, `mcp policy ${host}`, t('doctor.mcpPolicyUnknownTool', { detail }));
        }
        if (under.length) {
          const detail = under.map((name) => `${name}: ${[...runtimeNames].filter((tool) => !allowedHas(mcpPolicy, name, tool)).join(', ')}`).join('; ');
          add(false, `mcp policy ${host}`, t('doctor.mcpPolicyMissingTool', { detail }));
        }
        if (!over.length && !under.length) {
          add(true, `mcp policy ${host}`, t('doctor.mcpPolicyOk', { servers: names.join(', ') }));
        }
      }
    }

    // Hook 接线：以 .agents/hooks/gates.json 为期望值，比对宿主配置里的托管条目。
    // 降级对账 advisory（项目级 hooks.events 与用户级 userHooks 两分支共用，见各自分支注释）。
    const addInapplicable = (host, list) => {
      for (const { item, reason } of list) {
        add(true, `guarantee ${host}`, t('doctor.hooksInapplicable', {
          id: item.id, event: item.event, tool: item.tool, reason: t(HOOK_INAPPLICABLE_REASONS[reason]),
        }), '', { warn: true });
      }
    };
    if (h.hooks?.events) {
      const spec = gates.hooks;
      const rel = hostTargetRel(host, h.hooks.file);
      if (!spec) {
        add(false, `hooks ${host}`, t('doctor.hooksSpecInvalid', { path: '.agents/hooks/gates.json' }));
      } else {
        // 降级对账：gates.json 声明但宿主 hooks.events 不支持的条目，编译时被 applicable()
        // 静默过滤。与权限 unsupported 同口径给 guarantee advisory，不做静默。
        addInapplicable(host, inapplicableSpecs(h.hooks.events, spec));
        if (!fs.existsSync(path.join(target, rel))) {
          add(false, `hooks ${host}`, t('doctor.hooksFileMissing', { path: rel }));
        } else {
          try {
            const root = JSON.parse(fs.readFileSync(path.join(target, rel), 'utf8'));
            const drift = findHookDrift(root, spec, h.hooks.events);
            if (drift.missing.length) {
              add(false, `hooks ${host}`, t('doctor.hooksMissing', { path: rel, list: drift.missing.join(', ') }));
            } else if (drift.extra.length) {
              add(false, `hooks ${host}`, t('doctor.hooksExtra', { path: rel, list: drift.extra.join(', ') }));
            } else {
              add(true, `hooks ${host}`, `${rel}: ${drift.expected}`);
            }
          } catch {
            add(false, `hooks ${host}`, t('doctor.hooksInvalid', { path: rel }));
          }
        }
      }
    }

    // 用户级 hook 接线（issue #45）：hooks 配置在用户目录而非项目仓，按 registry userHooks 字段校验。
    // matcher 过期（如旧版 ^(Bash)$）会形成静默绕过，与条目缺失一样按 fail 报；
    // 条目信任哈希编辑即失效，重新接线 / 修改后须在交互式宿主会话重新信任一次。
    if (h.userHooks) {
      // 降级对账：userHooks 宿主（如 codex）只有单一 event，gates.json 中 event 不符的条目
      // 不接线且没有项目级 hooks 对账兜底，与上方 h.hooks 分支同口径给 guarantee advisory。
      addInapplicable(host, inapplicableForUserHooks(h.userHooks, gates.hooks));
      const status = inspectUserHookEntry({ host });
      if (status.state === 'ok') {
        add(true, `hooks ${host} (user)`, t('doctor.userHooksOk', { path: status.file, matcher: status.matcher, host }));
      } else if (status.state === 'stale') {
        add(false, `hooks ${host} (user)`, t('doctor.userHooksStale', { path: status.file, matcher: status.matcher, expected: status.expected, host }));
      } else if (status.state === 'invalid') {
        add(false, `hooks ${host} (user)`, t('doctor.hooksInvalid', { path: status.file }));
      } else {
        add(false, `hooks ${host} (user)`, t('doctor.userHooksMissing', { path: status.file, host }));
      }
    }

    // 权限编译：声明了但宿主没有 permissions 能力时给 advisory，不静默丢弃。
    if (permissionDeclared && !h.permissions) {
      add(true, `guarantee ${host}`, t('doctor.guaranteeGap', { host, capability: 'permissions' }), '', { warn: true });
    }
    if (h.permissions && permissionSpec) {
      const permRel = hostTargetRel(host, h.permissions.file || h.hooks?.file || 'settings.json');
      const compiled = compilePermissions(permissionSpec, h.permissions, {
        stack: manifest?.stack || 'empty',
        stacks: manifest?.stacks || null,
        hardened: Boolean(manifest?.hardened),
      });
      if (compiled.unsupported.length) {
        const list = compiled.unsupported.map((item) => `${item.tool}:${item.pat}`).join(', ');
        add(true, `permissions ${host} unsupported`, t('doctor.permissionsUnsupported', { host, list }), '', { warn: true });
      }
      if (!fs.existsSync(path.join(target, permRel))) {
        add(false, `permissions ${host}`, t('doctor.hooksFileMissing', { path: permRel }));
      } else {
        try {
          const root = JSON.parse(fs.readFileSync(path.join(target, permRel), 'utf8'));
          const drift = permissionDrift(root, compiled, h.permissions, manifest?.managedPermissions?.[permRel]);
          if (drift.missing.length || drift.stale.length) {
            const parts = [];
            if (drift.missing.length) parts.push(`missing ${drift.missing.join(', ')}`);
            if (drift.stale.length) parts.push(`stale ${drift.stale.join(', ')}`);
            add(false, `permissions ${host}`, t('doctor.permissionsDrift', { path: permRel, detail: parts.join('; ') }));
          } else {
            add(true, `permissions ${host}`, `${permRel}: ${compiled.allow.length}/${compiled.deny.length}/${compiled.ask.length}`);
          }
        } catch {
          add(false, `permissions ${host}`, t('doctor.hooksInvalid', { path: permRel }));
        }
      }
    }
  }

  // 组合式 profile：profile.json 是机器可读的组合凭证，必须与 manifest 一致。
  // 旧 profile.json 无 stacks 字段时按 [profile.stack] 归一，单栈安装照常对上。
  const surfaces = manifest?.surfaces || [];
  const stacksList = manifest?.stacks?.length ? manifest.stacks : [manifest?.stack || 'empty'];
  if (surfaces.length || stacksList.length > 1) {
    const rel = '.agents/config/profile.json';
    const abs = path.join(target, rel);
    if (!fs.existsSync(abs)) {
      add(false, 'profile composition', t('doctor.profileMissing', { path: rel }));
    } else {
      try {
        const profile = JSON.parse(fs.readFileSync(abs, 'utf8'));
        const same = JSON.stringify(profile.stacks || [profile.stack]) === JSON.stringify(stacksList)
          && JSON.stringify(profile.surfaces || []) === JSON.stringify(surfaces);
        if (same) add(true, 'profile composition', `${stacksList.join('+')}${surfaces.length ? `+${surfaces.join('+')}` : ''}`);
        else add(false, 'profile composition', t('doctor.profileMismatch', { path: rel }));
      } catch {
        add(false, 'profile composition', t('doctor.profileInvalid', { path: rel }));
      }
    }
  }

  // 安装档位与交付面：CI 按 manifest 选择比对；--ci none（含 lean 缺省）只是没有这个交付面，advisory 呈现。
  const tier = manifest?.tier || 'standard';
  add(true, 'tier', t('doctor.tier', { tier }));
  const ciMode = ciModeFor({ tier, ci: manifest?.ci || null });
  const ciRels = ciTemplateRels(ciMode);
  if (ciRels.length) {
    const found = ciRels.filter((rel) => fs.existsSync(path.join(target, rel)));
    if (found.length) add(true, 'ci', found.join(', '));
    else add(true, 'ci', t('doctor.ciMissing', { paths: ciRels.join(' / ') }), '', { warn: true });
  } else {
    add(true, 'ci', t('doctor.ciDisabled'), '', { warn: true });
  }
  // 开发容器（R3-8 沙箱面）：manifest 声明启用时，容器声明必须在位且合规。
  // manifest 未声明该字段 = 旧安装（升级后才有），此时不判红也不假装有容器。
  if (manifest?.devcontainer === true) {
    const dc = checkDevcontainer({ target, stack: manifest.stack || null });
    if (dc.ok) add(true, 'devcontainer', t('doctor.devcontainerOk', { image: dc.image }));
    else add(false, 'devcontainer', t('doctor.devcontainerProblems', { problems: dc.problems.join('; ') }));
  } else if (manifest?.devcontainer === false) {
    add(true, 'devcontainer', t('doctor.devcontainerDisabled'), '', { warn: true });
  }
  // enterprise：展示档位、实际加固姿态与缺口，并核对证明链 / 策略检查。
  const enterprise = manifest?.hardened
    ? computeEnterprise({ target, hosts: manifest.hosts || [], hardened: true, ci: manifest?.ci || null })
    : null;
  if (enterprise) {
    const matrix = Object.entries(enterprise.hosts).map(([name, level]) => `${name}:${level}`).join(', ');
    add(true, 'enterprise', t('doctor.enterprise', {
      tier,
      posture: enterprise.posture,
      hosts: matrix,
      gaps: enterprise.gaps.length ? enterprise.gaps.join(', ') : '-',
    }));
    if (enterprise.gaps.length) {
      add(true, 'enterprise gaps', t('doctor.enterpriseGaps', { gaps: enterprise.gaps.join(', ') }), '', { warn: true });
    }
    // 条目 38：体检期阻断——enterprise 承诺未兑现（宿主 hardening.level === 'none'，如 enterprise
    // 装户经 add-host 引入）fail；阈值与安装期拒装一致，hooks 级仍走 gaps advisory（不升级为 fail）。
    const blockedHosts = Object.entries(enterprise.hosts)
      .filter(([, level]) => level === 'none')
      .map(([name]) => name);
    if (blockedHosts.length) {
      add(false, 'enterprise blocked hosts', t('doctor.enterpriseBlocked', { hosts: blockedHosts.join(', ') }));
    }
    const missingProof = PROOF_CHAIN_FILES.filter((rel) => !fs.existsSync(path.join(target, rel)));
    if (missingProof.length) add(false, 'enterprise proof-chain', t('doctor.enterpriseProof', { list: missingProof.join(', ') }));
    else add(true, 'enterprise proof-chain', t('doctor.enterpriseProofOk'));
    const missingPolicy = [];
    const enterpriseCiRels = ciTemplateRels(ciModeFor({ tier: 'enterprise', ci: manifest?.ci || null }));
    if (!GIT_HOOKS.every((name) => fs.existsSync(path.join(target, '.githooks', name)))) missingPolicy.push('.githooks/*');
    if (enterpriseCiRels.length && !enterpriseCiRels.some((rel) => fs.existsSync(path.join(target, rel)))) missingPolicy.push('CI');
    if (!enterprise.policyChecks.includes('permissions')) missingPolicy.push('permissions');
    if (missingPolicy.length) add(false, 'enterprise policy', t('doctor.enterprisePolicy', { list: missingPolicy.join(', ') }));
    else add(true, 'enterprise policy', t('doctor.enterprisePolicyOk', { list: enterprise.policyChecks.join(', ') }));
    if (manifest.enterprise && JSON.stringify(manifest.enterprise) !== JSON.stringify(enterprise)) {
      add(true, 'enterprise record', t('doctor.enterpriseStale'), '', { warn: true });
    }
  } else if (manifest?.hardened) {
    add(true, 'hardened', t('doctor.hardenedHint'), '', { warn: true });
  }

  // 远程中央策略基线对账：存在 policy.json 且声明了 remote 时，核对与中央基线的漂移状态
  const policyProbe = runGovernanceProbes({ target, probes: ['policy'], policy: { remote: true }, t }).byId.policy;
  for (const c of policyProbe?.doctorChecks || []) {
    add(c.ok, c.name, c.detail, c.fix || '', c.warn ? { warn: true } : {});
  }

  // 项目级门禁配置覆盖率（gate coverage，advisory）：逐项报告已配置 / 未配置（SKIP）/ 配置错误。
  // 只做「可解析 + 顶层形状」体检，语义级校验归各门脚本；未配置一律不升 fail，配置错误才红。
  const gateFile = (rel) => {
    const abs = path.join(target, rel);
    if (!fs.existsSync(abs)) return { state: 'skip' };
    try {
      return { state: 'ok', data: parseJsonc(fs.readFileSync(abs, 'utf8'), rel) };
    } catch (e) {
      return { state: 'error', error: e.message };
    }
  };
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const reportGate = (name, state, detail) => {
    if (state === 'error') add(false, `gate ${name}`, t('doctor.gateError', { error: detail }));
    else if (state === 'skip') add(true, `gate ${name}`, detail || t('doctor.gateSkipped'));
    else add(true, `gate ${name}`, detail || t('doctor.gateConfigured'));
  };
  const runGate = (name, rel, validate = () => ({})) => {
    const r = gateFile(rel);
    if (r.state !== 'ok') return reportGate(name, r.state, r.error);
    let verdict = {};
    try { verdict = validate(r.data) || {}; } catch (e) { verdict = { state: 'error', error: e.message }; }
    return reportGate(name, verdict.state || 'ok', verdict.detail || verdict.error);
  };
  const shape = (data, fn) => (!isObj(data) ? { state: 'error', error: t('doctor.gateNotObject') } : fn(data));

  runGate('architecture-redlines', '.agents/hooks/architecture-redlines.json', (d) => shape(d, () => {
    const known = ['forbidden', 'noNavigationProperties', 'catchRequires'];
    const unknown = Object.keys(d).filter((k) => !known.includes(k));
    if (unknown.length) return { state: 'error', error: t('doctor.gateUnknownKeys', { keys: unknown.join(', ') }) };
    const bad = known.find((k) => d[k] !== undefined && !Array.isArray(d[k]));
    if (bad) return { state: 'error', error: t('doctor.gateArrayField', { field: bad }) };
    return known.every((k) => (d[k] || []).length === 0) ? { state: 'skip' } : {};
  }));

  runGate('delete-guard', '.agents/hooks/delete-guard.json', (d) => shape(d, () => {
    const unknown = Object.keys(d).filter((k) => k !== 'scan');
    if (unknown.length) return { state: 'error', error: t('doctor.gateUnknownKeys', { keys: unknown.join(', ') }) };
    if (!Array.isArray(d.scan)) return { state: 'error', error: t('doctor.gateArrayField', { field: 'scan' }) };
    return d.scan.length ? {} : { state: 'error', error: t('doctor.gateEmptyField', { field: 'scan' }) };
  }));

  runGate('audit-fields', '.agents/hooks/audit-fields.json', (d) => shape(d, () => {
    const known = ['fields', 'ext', 'allowFiles', 'allowLines'];
    const unknown = Object.keys(d).filter((k) => !known.includes(k));
    if (unknown.length) return { state: 'error', error: t('doctor.gateUnknownKeys', { keys: unknown.join(', ') }) };
    if (!Array.isArray(d.fields)) return { state: 'error', error: t('doctor.gateArrayField', { field: 'fields' }) };
    return d.fields.length ? {} : { state: 'error', error: t('doctor.gateEmptyField', { field: 'fields' }) };
  }));

  runGate('commit-check.config', '.agents/hooks/commit-check.config.json', (d) => shape(d, () => {
    const keys = ['builds', 'checks', 'pushTests'];
    const bad = keys.find((k) => d[k] !== undefined && !Array.isArray(d[k]));
    if (bad) return { state: 'error', error: t('doctor.gateArrayField', { field: bad }) };
    return keys.some((k) => (d[k] || []).length) ? {} : { detail: t('doctor.gateCommitEmpty') };
  }));

  // product-gates*.json 按 verify.mjs 口径枚举（product-gates.json / product-gates.<名称>.json）。
  {
    let files = [];
    try {
      files = fs.readdirSync(path.join(target, '.agents', 'config'))
        .filter((f) => f === 'product-gates.json' || /^product-gates\..+\.json$/.test(f))
        .sort();
    } catch { /* 未配置 */ }
    if (!files.length) {
      // 规则中心单源感知：物理配置不存在时，若规则层（stack 或 project）已配置生效的 product.* 命令规则，则视作已配置
      let hasProductRule = false;
      try {
        const { model } = loadModel(target);
        hasProductRule = model.rules.some((r) => r.enabled !== false && String(r.id).startsWith('product.'));
      } catch {}
      if (hasProductRule) {
        reportGate('product-gates', 'ok');
      } else {
        reportGate('product-gates', 'skip');
      }
    } else {
      let verdict = {};
      for (const f of files) {
        const r = gateFile(`.agents/config/${f}`);
        if (r.state !== 'ok') { verdict = { state: 'error', error: `${f}: ${r.error || 'missing'}` }; break; }
        if (!isObj(r.data)) { verdict = { state: 'error', error: `${f}: ${t('doctor.gateNotObject')}` }; break; }
        if (!Array.isArray(r.data.gates)) { verdict = { state: 'error', error: `${f}: ${t('doctor.gateArrayField', { field: 'gates' })}` }; break; }
        const idx = r.data.gates.findIndex((g) => !isObj(g) || typeof g.id !== 'string' || !g.id || typeof g.name !== 'string' || typeof g.cmd !== 'string');
        if (idx >= 0) { verdict = { state: 'error', error: `${f}: ${t('doctor.gateBadGateEntry', { index: idx })}` }; break; }
      }
      reportGate('product-gates', verdict.state || 'ok', verdict.error);
    }
  }

  runGate('test-impact-map', '.agents/config/test-impact-map.json', (d) => shape(d, () => {
    // 骨架态口径与 check-test-impact-map.mjs 一致：namespace/areas/paths 均空 = 未启用选测。
    const skeleton = !String(d.namespace || '').trim()
      && (!d.areas || (isObj(d.areas) && Object.keys(d.areas).length === 0))
      && (!d.paths || (Array.isArray(d.paths) && d.paths.length === 0));
    return skeleton ? { detail: t('doctor.gateTestImpactSkeleton') } : {};
  }));

  runGate('local-gates', '.agents/config/local-gates.json', (d) => shape(d, () => (
    isObj(d.testDb) ? {} : { state: 'skip' }
  )));

  // project-faces：用 faces.mjs 的单源加载器判定；已配置时顺带体检触发面是否命中跟踪文件。
  try {
    const faces = loadFaces(target);
    reportGate('project-faces', faces.configured ? 'ok' : 'skip');
    if (!faces.configured) {
      add(true, 'faces coverage', t('doctor.gateFacesUnconfigured'));
    } else {
      const ls = spawnSync('git', ['-c', 'core.quotepath=off', 'ls-files'], { cwd: target, encoding: 'utf8' });
      if (ls.status !== 0) {
        add(true, 'faces coverage', t('doctor.gateFacesNoGit'), '', { warn: true });
      } else {
        const count = (ls.stdout || '').split('\n').filter(Boolean).filter((rel) => isProductPath(faces, rel)).length;
        if (count === 0) add(true, 'faces coverage', t('doctor.gateFacesEmpty'), '', { warn: true });
        else add(true, 'faces coverage', t('doctor.gateFacesCoverage', { count }));
      }
    }
  } catch (e) {
    reportGate('project-faces', 'error', e.message);
  }

  // rules 规则包汇总：启用数 / 严重级 / 层来源 / 插件 / 豁免（含过期）——旧配置迁移可见性。
  try {
    const { model, layers } = loadModel(target);
    const { active, expired } = splitWaivers(model.waivers);
    const enabledRules = model.rules.filter((r) => r.enabled !== false);
    const plugins = model.rules.filter((r) => r.assert && r.assert.kind === 'plugin').length;
    add(true, 'rules', t('doctor.rulesSummary', {
      enabled: enabledRules.length,
      total: model.rules.length,
      block: enabledRules.filter((r) => r.severity === 'block').length,
      warn: enabledRules.filter((r) => r.severity === 'warn').length,
      layers: layers.map((l) => l.name).join(' ← '),
      plugins,
      waived: active.length,
      expired: expired.length,
    }));
    if (layers.some((l) => l.name === 'legacy') && !layers.some((l) => l.name === 'project')) {
      add(true, 'rules migration', t('doctor.rulesMigrationHint'), '', { warn: true });
    }

    // 门禁覆盖率（gate coverage，advisory）：按规则 id 前缀归族，只统计生效规则——配了才算覆盖。
    if (!enabledRules.length) {
      add(true, 'gate coverage', t('doctor.gateCoverageEmpty'), '', { warn: true });
    } else {
      const counts = Object.entries(RULE_FAMILIES).map(([name, prefix]) => ({
        name,
        count: enabledRules.filter((r) => String(r.id).startsWith(prefix)).length,
      }));
      const configured = counts.filter((c) => c.count > 0).map((c) => c.name);
      const missing = counts.filter((c) => c.count === 0).map((c) => c.name);
      const other = enabledRules.length - counts.reduce((sum, c) => sum + c.count, 0);
      add(true, 'gate coverage', t('doctor.gateCoverage', {
        configured: configured.length ? configured.join(', ') : '-',
        missing: missing.length ? missing.join(', ') : '-',
        other,
      }));
    }

    // 规则插件：白名单条目对应的模块文件必须存在（静态检查，不加载、不执行）。
    const pluginEntries = new Map();
    for (const layer of layers) for (const p of layer.plugins || []) pluginEntries.set(p.id, p);
    const missingPlugins = [...pluginEntries.values()]
      .filter((p) => !fs.existsSync(path.join(target, '.agents/rules/plugins', `${p.module}.mjs`)))
      .map((p) => p.id);
    if (missingPlugins.length) {
      add(true, 'rules plugins', t('doctor.rulesPluginsMissing', { plugins: missingPlugins.join(', ') }), '', { warn: true });
    }
  } catch (e) {
    add(false, 'rules', t('doctor.rulesError', { message: e.message }));
  }

  // 插件运行期异常（advisory）：rules check 把没跑成的插件（崩溃 / 超时 / 输出非法）留痕在本机缓存——
  // warn 档的异常不能只在提交那一刻闪过。只读留痕，不执行插件。
  const pluginAnomalies = Object.entries(readPluginStatus(target));
  if (pluginAnomalies.length) {
    add(true, 'rules plugin runtime', t('doctor.rulesPluginRuntime', {
      items: pluginAnomalies.map(([id, a]) => `${id}（${String(a?.at || '').slice(0, 19).replace('T', ' ')} ${String(a?.detail || '').split('\n')[0]}）`).join('、'),
    }), '', { warn: true });
  }

  // 栈层漂移（advisory）：stack.*.json 由 kit 管理，本地改动会在升级时漂移（被跳过或合并出冲突）——自定义写 project.json。
  const stackDrift = (diffResult?.items || [])
    .filter((i) => i.kind === 'user-modified' && /^\.agents\/rules\/stack\.[^/]+\.json$/.test(i.targetRel))
    .map((i) => i.targetRel);
  if (stackDrift.length) {
    add(true, 'rules stack drift', t('doctor.rulesStackDrift', { files: stackDrift.join(', ') }), '', { warn: true });
  }

  // wiki 目录名与安装语言不一致（advisory）：语言切换 / 旧版英文安装留下旧命名目录；kit 不搬用户内容，只提示残留。
  if (manifest) {
    const current = manifest.language === 'en' ? 'en' : 'zh-CN';
    const other = current === 'en' ? 'zh-CN' : 'en';
    const leftovers = WIKI_TOPIC_KEYS
      .map((key) => WIKI_NAMES[key][other])
      .filter((name) => fs.existsSync(path.join(target, 'wiki', name)))
      .map((name) => `wiki/${name}/`);
    if (leftovers.length) {
      add(true, 'wiki dir names', t('doctor.wikiDirNames', { dirs: leftovers.join(', ') }), '', { warn: true });
    }
  }

  // 离线安装包溯源体检
  if (manifest?.bundle) {
    add(true, 'bundle', t('doctor.bundleOk', {
      file: manifest.bundle.file,
      digest: String(manifest.bundle.digest || '').slice(0, 12),
      version: manifest.bundle.version || 'unknown',
    }));
  }

  // SBOM 完整性体检（如果存在 .agents/sbom.json 或显式 --sbom）
  const sbomPath = args.sbom || (fs.existsSync(path.join(target, '.agents', 'sbom.json')) ? path.join(target, '.agents', 'sbom.json') : null);
  if (sbomPath && fs.existsSync(sbomPath)) {
    try {
      const sbomData = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
      const verifyRes = verifySbom({ target, sbomData, t });
      if (verifyRes.ok) {
        add(true, 'sbom', t('doctor.sbomOk', { file: path.basename(sbomPath) }));
      } else {
        add(false, 'sbom', t('doctor.sbomDrift', { problems: verifyRes.problems.join('; ') }));
      }
    } catch (e) {
      add(false, 'sbom', t('doctor.sbomDrift', { problems: e.message }));
    }
  }

  // 运行治理探针检测公证证明链、网关、架构、沙箱、技能回归
  const govProbes = runGovernanceProbes({
    target,
    probes: ['notary', 'mcp', 'arch', 'sandbox', 'skills'],
    notary: { pubkey: args.pubkey, key: args.key, sbom: sbomPath },
    t,
  });
  for (const c of govProbes.byId.notary?.doctorChecks || []) {
    add(c.ok, c.name, c.detail, c.fix || '', c.warn ? { warn: true } : {});
  }
  for (const c of govProbes.byId.mcp?.doctorChecks || []) {
    add(c.ok, c.name, c.detail, c.fix || '', c.warn ? { warn: true } : {});
  }
  for (const c of govProbes.byId.arch?.doctorChecks || []) {
    const extra = c.warn ? { warn: true } : {};
    if (c.violations !== undefined) extra.violations = c.violations;
    if (c.cycles !== undefined) extra.cycles = c.cycles;
    if (c.layerViolations !== undefined) extra.layerViolations = c.layerViolations;
    if (c.privateViolations !== undefined) extra.privateViolations = c.privateViolations;
    add(c.ok, c.name, c.detail, c.fix || '', extra);
  }
  for (const c of govProbes.byId.sandbox?.doctorChecks || []) {
    add(c.ok, c.name, c.detail, c.fix || '', c.warn ? { warn: true } : {});
  }
  for (const c of govProbes.byId.skills?.doctorChecks || []) {
    add(c.ok, c.name, c.detail, c.fix || '', c.warn ? { warn: true } : {});
  }

  // 模型配置是用户本地状态：存在则校验，缺失不失败（旧安装保持 doctor 全过）。
  const localModels = readLocalModelRoles(target);
  if (localModels.error) {
    add(false, 'model-roles.local', t('doctor.modelConfigInvalid'));
  } else if (localModels.exists) {
    add(true, 'model-roles.local', path.relative(target, localModels.file) || localModels.file);
    const value = (entry) => (typeof entry === 'string' ? entry : entry?.model);
    const code = value(localModels.roles.code);
    const review = value(localModels.roles.review);
    if (code && review && code === review) {
      add(true, 'models heterogeneous', t('doctor.reviewSameAsCode'));
    }
    for (const role of ROLE_NAMES) {
      if (value(localModels.roles[role]) == null) continue;
      add(true, `model ${role}`, String(value(localModels.roles[role])));
    }
    // 模型漂移：本地配置 vs 已安装子代理的 model 字段。升级前必须先评测（model-upgrade 技能）。
    const injected = readInjectedModels({ target, hosts: manifest?.hosts || [] });
    for (const host of manifest?.hosts || []) {
      for (const role of ROLE_NAMES) {
        const local = localModels.hosts?.[host]?.[role] ?? roleVal(localModels.roles[role]);
        const installed = injected[host]?.[role];
        if (local != null && installed != null && String(local) !== String(installed)) {
          add(true, `drift ${host}/${role}`, t('doctor.modelDrift', { host, role, installed, local }), '', { warn: true });
        }
      }
    }
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add(nodeMajor >= 22, 'node >= 22', process.version);

  let attestation = null;
  if (flag(args, 'attest')) {
    attestation = buildAttestation(target);
    add(
      attestation.ok,
      'attestation',
      attestation.ok
        ? t('doctor.attestation', { root: attestation.chain.root })
        : t('doctor.attestationFailed', { problems: attestation.problems.join('; ') }),
    );
    if (args.out) {
      try {
        const written = writeAttestation(args.out, attestation);
        add(true, 'attestation-output', t('doctor.attestationWritten', { path: written }));
      } catch (error) {
        add(false, 'attestation-output', error.message);
      }
    }
    if (flag(args, 'sign')) {
      const keyPath = args.key ? path.resolve(args.key) : path.join(target, '.agents', 'keys', 'flow-kit-key.pem');
      if (!fs.existsSync(keyPath)) {
        add(false, 'attestation-signature', t('error.keyNotFound', { path: keyPath }));
      } else {
        try {
          const privKey = fs.readFileSync(keyPath, 'utf8');
          if (!args.out) {
            writeAttestation(path.join(target, '.agents', 'attestation.json'), attestation);
          }
          const sig = signPayload({
            payload: attestation,
            privateKeyPem: privKey,
            algorithm: args.algorithm || 'ed25519',
            target: 'attestation',
          });
          const sigOut = args.out ? `${path.resolve(args.out)}.sig` : path.join(target, '.agents', 'attestation.sig');
          writeSignatureFile(sigOut, sig);
          add(true, 'attestation-signature', t('doctor.attestationSigned', { path: sigOut, fp: sig.publicKeyFingerprint }));
        } catch (error) {
          add(false, 'attestation-signature', error.message);
        }
      }
    }
  }

  let failed = 0;
  let deep = null;
  for (const c of checks) {
    if (c.ok) {
      if (!asJson) {
        const mark = c.warn ? '!' : '✓';
        console.log(`${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
      }
    } else {
      failed += 1;
      if (!asJson) {
        console.log(`✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
        if (c.fix) console.log(`  → ${c.fix}`);
      }
    }
  }
  if (!asJson) {
    console.log(failed ? t('doctor.fail', { failed, total: checks.length }) : t('doctor.ok', { total: checks.length }));
  }

  if (flag(args, 'deep')) {
    const gates = path.join(RUNTIME_SCRIPTS, 'check-local-gates.mjs');
    if (fs.existsSync(gates)) {
      const deepArgs = flag(args, 'fix') ? ['--fix'] : [];
      const deepEnv = { ...process.env, FLOW_KIT_PROJECT_ROOT: target };
      if (asJson) {
        const r = spawnSync(process.execPath, [gates, ...deepArgs], { cwd: target, encoding: 'utf8', env: deepEnv });
        deep = { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
        if (r.status !== 0) failed += 1;
      } else {
        console.log(`\n$ flow-kit run check-local-gates${flag(args, 'fix') ? ' --fix' : ''}`);
        const r = spawnSync(process.execPath, [gates, ...deepArgs], { cwd: target, stdio: 'inherit', env: deepEnv });
        if (r.status !== 0) failed += 1;
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify({
      target,
      ok: failed === 0,
      summary: {
        total: checks.length,
        failed,
        warnings: checks.filter((c) => c.warn).length,
      },
      checks: checks.map((c) => ({
        ok: c.ok,
        name: c.name,
        detail: c.detail || '',
        fix: c.fix || '',
        warn: Boolean(c.warn),
      })),
      ...(attestation ? { attestation } : {}),
      deep,
    }, null, 2));
  }
  return failed ? 1 : 0;
}
