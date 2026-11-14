import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { flag } from '../cli/args.mjs';
import { readManifest } from '../install/manifest.mjs';
import { doctorGit } from '../git/config.mjs';
import { HOSTS, hostTargetRel, hostSource } from '../hosts/registry.mjs';
import { listFiles, readGatesSpecs, TEMPLATES } from '../install/plan.mjs';
import { readMcpServers } from '../install/mcp.mjs';
import { readToolPolicy } from '../install/tool-policy.mjs';
import { findHookDrift } from '../install/hooks.mjs';
import { listBaselines } from '../install/baseline.mjs';
import { buildAttestation, writeAttestation } from '../install/attest.mjs';
import { compilePermissions, permissionDrift } from '../install/permissions.mjs';
import { ROLE_NAMES, readInjectedModels, readLocalModelRoles } from '../models/resolve.mjs';
import { computeEnterprise, GIT_HOOKS, PROOF_CHAIN_FILES, resolveTarget } from './install.mjs';
import { RUNTIME_SCRIPTS, RUNTIME_HOOKS, KIT_ROOT } from './runtime.mjs';
import { buildDiff } from './diff.mjs';

const HOOK_FILES = ['pre-commit', 'commit-msg', 'post-commit', 'pre-merge-commit', 'pre-push'];

// MCP 运行时工具面：来自包内 server 实现（wiki-mcp.mjs）。新增工具时同步更新。
// doctor 拿它和 toolPolicy.servers 声明做双向对账。
const MCP_RUNTIME_TOOLS = [{ name: 'wiki_search' }];
const allowedHas = (policy, server, tool) => Boolean(policy?.servers?.[server]?.has(tool));
let mcpPolicyCache;

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
  if (!manifest) {
    add(false, 'install-manifest', t('doctor.manifestMissing'));
  } else {
    add(true, 'install-manifest', `.agents/install-manifest.json (v${manifest.version || '?'})`);
    for (const rel of Object.keys(manifest.files || {})) {
      if (!fs.existsSync(path.join(target, rel))) add(false, `file ${rel}`, t('doctor.fileMissing'));
    }
    // 漂移是 advisory：用户改文件属正常，缺失已在上面按文件报错；明细交给 diff。
    const drift = buildDiff({ target, manifest }).summary;
    const drifting = drift.userModified + drift.kitUpdated + drift.orphan;
    if (drifting > 0) {
      add(true, 'manifest drift', t('doctor.drift', drift), t('doctor.driftHint'), { warn: true });
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
    add(true, 'flow-kit cli', String(kitProbe.stdout || '').trim() || 'flow-kit');
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

  for (const hook of HOOK_FILES) {
    add(fs.existsSync(path.join(target, '.githooks', hook)), `hook ${hook}`, '');
  }

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
    // 能力缺口：没有 hooks / modelField 的宿主，相关保证只能是 advisory。
    if (!h.hooks) add(true, `guarantee ${host}`, t('doctor.guaranteeGap', { host, capability: 'hooks' }), '', { warn: true });
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
      const container = h.mcp.format === 'opencode' ? root?.mcp : root?.mcpServers;
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
    if (h.hooks?.events) {
      const spec = gates.hooks;
      const rel = hostTargetRel(host, h.hooks.file);
      if (!spec) {
        add(false, `hooks ${host}`, t('doctor.hooksSpecInvalid', { path: '.agents/hooks/gates.json' }));
      } else if (!fs.existsSync(path.join(target, rel))) {
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

    // 权限编译：声明了但宿主没有 permissions 能力时给 advisory，不静默丢弃。
    if (permissionDeclared && !h.permissions) {
      add(true, `guarantee ${host}`, t('doctor.guaranteeGap', { host, capability: 'permissions' }), '', { warn: true });
    }
    if (h.permissions && permissionSpec) {
      const permRel = hostTargetRel(host, h.permissions.file || h.hooks?.file || 'settings.json');
      const compiled = compilePermissions(permissionSpec, h.permissions, {
        stack: manifest?.stack || 'empty',
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
  const surfaces = manifest?.surfaces || [];
  if (surfaces.length) {
    const rel = '.agents/config/profile.json';
    const abs = path.join(target, rel);
    if (!fs.existsSync(abs)) {
      add(false, 'profile composition', t('doctor.profileMissing', { path: rel }));
    } else {
      try {
        const profile = JSON.parse(fs.readFileSync(abs, 'utf8'));
        const same = profile.stack === (manifest.stack || 'empty')
          && JSON.stringify(profile.surfaces || []) === JSON.stringify(surfaces);
        if (same) add(true, 'profile composition', `${manifest.stack}+${surfaces.join('+')}`);
        else add(false, 'profile composition', t('doctor.profileMismatch', { path: rel }));
      } catch {
        add(false, 'profile composition', t('doctor.profileInvalid', { path: rel }));
      }
    }
  }

  // 安装档位与交付面：lean 允许没有 CI；standard/enterprise 应有可运行 CI。
  const tier = manifest?.tier || 'standard';
  add(true, 'tier', t('doctor.tier', { tier }));
  if (tier !== 'lean') {
    const ci = ['azure-pipelines.yml', '.github/workflows/ci.yml'].filter((rel) => fs.existsSync(path.join(target, rel)));
    if (ci.length) add(true, 'ci', ci.join(', '));
    else add(true, 'ci', t('doctor.ciMissing', { paths: 'azure-pipelines.yml / .github/workflows/ci.yml' }), '', { warn: true });
  }
  // enterprise：展示档位、实际加固姿态与缺口，并核对证明链 / 策略检查。
  const enterprise = manifest?.hardened
    ? computeEnterprise({ target, hosts: manifest.hosts || [], hardened: true })
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
    const missingProof = PROOF_CHAIN_FILES.filter((rel) => !fs.existsSync(path.join(target, rel)));
    if (missingProof.length) add(false, 'enterprise proof-chain', t('doctor.enterpriseProof', { list: missingProof.join(', ') }));
    else add(true, 'enterprise proof-chain', t('doctor.enterpriseProofOk'));
    const missingPolicy = [];
    if (!GIT_HOOKS.every((name) => fs.existsSync(path.join(target, '.githooks', name)))) missingPolicy.push('.githooks/*');
    if (!['azure-pipelines.yml', '.github/workflows/ci.yml'].some((rel) => fs.existsSync(path.join(target, rel)))) missingPolicy.push('CI');
    if (!enterprise.policyChecks.includes('permissions')) missingPolicy.push('permissions');
    if (missingPolicy.length) add(false, 'enterprise policy', t('doctor.enterprisePolicy', { list: missingPolicy.join(', ') }));
    else add(true, 'enterprise policy', t('doctor.enterprisePolicyOk', { list: enterprise.policyChecks.join(', ') }));
    if (manifest.enterprise && JSON.stringify(manifest.enterprise) !== JSON.stringify(enterprise)) {
      add(true, 'enterprise record', t('doctor.enterpriseStale'), '', { warn: true });
    }
  } else if (manifest?.hardened) {
    add(true, 'hardened', t('doctor.hardenedHint'), '', { warn: true });
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

  if (args.deep) {
    const gates = path.join(RUNTIME_SCRIPTS, 'check-local-gates.mjs');
    if (fs.existsSync(gates)) {
      const deepArgs = args.fix ? ['--fix'] : [];
      const deepEnv = { ...process.env, FLOW_KIT_PROJECT_ROOT: target };
      if (asJson) {
        const r = spawnSync(process.execPath, [gates, ...deepArgs], { cwd: target, encoding: 'utf8', env: deepEnv });
        deep = { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
        if (r.status !== 0) failed += 1;
      } else {
        console.log(`\n$ flow-kit run check-local-gates${args.fix ? ' --fix' : ''}`);
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
