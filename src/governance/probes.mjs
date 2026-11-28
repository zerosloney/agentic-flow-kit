import fs from 'node:fs';
import path from 'node:path';
import { ARCH_CONFIG_REL, evaluateArchitecture } from '../install/arch-guard.mjs';
import { EVAL_LOG_REL, findSkillDatasets, DEFAULT_EVAL_MAX_AGE_DAYS } from '../skills/eval-harness.mjs';
import { MCP_GATEWAY_CONFIG_REL, MCP_AUDIT_LOG_REL, queryMcpAudit } from '../install/mcp-gateway.mjs';
import { SANDBOX_CONFIG_REL, detectContainerEngine } from '../install/sandbox.mjs';
import { resolvePublicKeyPath, readSignatureFile, verifySignature } from '../install/notary.mjs';
import { listHandoffFiles, verifyHandoffEnvelope } from '../install/handoff.mjs';
import { computeAiDoraMetrics, checkMetricsThresholds } from '../install/metrics.mjs';
import { checkPolicyDriftSync } from '../commands/policy.mjs';

/**
 * 校验指定文件列表是否触碰公证签名与交接信封
 */
export function notaryTouches(files) {
  const list = Array.isArray(files) ? files : [];
  return list.some((f) =>
    f.startsWith('.agents/notary')
    || f.startsWith('.agents/keys/')
    || f.endsWith('.sig')
    || f.startsWith('.agents/handoffs/')
    || f.startsWith('.agents/attestation')
    || f.startsWith('.agents/sbom'),
  );
}

/**
 * 判断架构分层配置或层内源文件是否变更
 */
function archTouches(target, changedFiles) {
  if (!Array.isArray(changedFiles)) return true;
  if (changedFiles.some((f) => f.includes('architecture.json'))) return true;

  const archConfigPath = path.join(target, ARCH_CONFIG_REL);
  if (fs.existsSync(archConfigPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(archConfigPath, 'utf8'));
      if (cfg?.layers && typeof cfg.layers === 'object') {
        const layerPrefixes = Object.values(cfg.layers)
          .map((l) => (l?.path ? l.path.replace(/\/\*\*.*$/, '').replace(/\/\*.*$/, '') : ''))
          .filter(Boolean);
        if (layerPrefixes.length > 0) {
          return changedFiles.some((f) => layerPrefixes.some((p) => f.startsWith(p)));
        }
      }
    } catch {
      return true; // 配置损坏时触发全量评估以输出 fail
    }
  }
  return changedFiles.some((f) => f.startsWith('src/'));
}

const PROBE_ORDER = ['arch', 'skills', 'mcp', 'sandbox', 'notary', 'policy', 'metrics'];

/**
 * 内部探针描述符表 (Declarative Descriptors)
 */
const PROBE_DEFS = {
  arch: {
    titleKey: 'gate.guardArchTitle',
    defaultTitle: 'Architecture Layering & Boundary Guard',
    diffTouches: (target, changedFiles) => archTouches(target, changedFiles),
    diffSkipReason: (count, t) => t('gate.diffArchNoChanges', { count })
      || `0 architecture layer files modified in diff scope (${count} files changed)`,
    evaluate(target, { t }) {
      const configFile = path.join(target, ARCH_CONFIG_REL);
      if (!fs.existsSync(configFile)) {
        return {
          status: 'skipped',
          reason: t('arch.noConfig') || 'No architecture layering config found (optional)',
          doctorChecks: [],
        };
      }

      try {
        const res = evaluateArchitecture(target);
        if (res.ok) {
          const detail = t('doctor.archOk', { files: res.totalFiles });
          return {
            status: 'passed',
            reason: detail,
            doctorChecks: [{ ok: true, name: 'architecture guard', detail }],
          };
        }

        const totalViolations = (res.cycles?.length || 0) + (res.boundaryViolations?.length || 0) + (res.privateViolations?.length || 0);
        const detail = t('doctor.archViolations', { count: totalViolations });
        const fix = t('doctor.archFixHint') || '';
        return {
          status: 'failed',
          reason: detail,
          hint: fix,
          details: {
            violations: totalViolations,
            cycles: res.cycles,
            layerViolations: res.boundaryViolations,
            privateViolations: res.privateViolations,
          },
          doctorChecks: [{
            ok: false,
            name: 'architecture guard',
            detail,
            fix,
            warn: false,
            violations: totalViolations,
            cycles: res.cycles,
            layerViolations: res.boundaryViolations,
            privateViolations: res.privateViolations,
          }],
        };
      } catch (err) {
        const detail = t('doctor.archError', { detail: err.message });
        return {
          status: 'failed',
          reason: detail,
          doctorChecks: [{ ok: false, name: 'architecture guard', detail, warn: true }],
        };
      }
    },
  },

  skills: {
    titleKey: 'gate.guardSkillsTitle',
    defaultTitle: 'Skills Regression Eval Guard',
    diffTouches: (_target, changedFiles) => changedFiles.some(
      (f) => f.startsWith('.agents/skills/') || f.startsWith('.agents/evals/'),
    ),
    diffSkipReason: (count, t) => t('gate.diffSkillsNoChanges', { count })
      || `0 skill assets modified in diff scope (${count} files changed)`,
    evaluate(target, { t }) {
      const skillsDir = path.join(target, '.agents', 'skills');
      if (!fs.existsSync(skillsDir)) {
        return {
          status: 'skipped',
          reason: t('gate.guardSkillsNoSkills') || 'No custom skills installed',
          doctorChecks: [],
        };
      }

      let skillDirs = [];
      try {
        skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        return {
          status: 'skipped',
          reason: t('gate.guardSkillsNoSkills') || 'No custom skills installed',
          doctorChecks: [],
        };
      }

      if (!skillDirs.length) {
        return {
          status: 'skipped',
          reason: t('gate.guardSkillsNoSkills') || 'No custom skills installed',
          doctorChecks: [],
        };
      }

      const logFile = path.join(target, EVAL_LOG_REL);
      let evalEntries = [];
      if (fs.existsSync(logFile)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(logFile, 'utf8'));
          if (Array.isArray(parsed?.entries)) {
            evalEntries = parsed.entries;
          }
        } catch {
          const detail = t('doctor.skillsEvalLogInvalid') || 'Invalid eval-log.json';
          return {
            status: 'failed',
            reason: detail,
            doctorChecks: [{ ok: false, name: 'skills eval', detail }],
          };
        }
      }

      const datasets = findSkillDatasets(target);
      if (!datasets.length) {
        if (evalEntries.length) {
          const detail = t('doctor.skillsEvalOk', { count: evalEntries.length });
          return {
            status: 'passed',
            reason: detail,
            details: { count: evalEntries.length },
            doctorChecks: [{ ok: true, name: 'skills eval', detail }],
          };
        }
        const detail = t('doctor.skillsEvalNoDatasets', { count: skillDirs.length });
        const fix = t('doctor.skillsEvalHint') || '';
        return {
          status: 'warned',
          reason: detail,
          hint: fix,
          doctorChecks: [{ ok: true, name: 'skills eval', detail, warn: true, fix }],
        };
      }

      const problems = [];
      let hasFailing = false;
      const now = Date.now();
      const maxAgeMs = DEFAULT_EVAL_MAX_AGE_DAYS * 24 * 3600 * 1000;

      for (const ds of datasets) {
        const entries = evalEntries.filter((e) => e.skill === ds.skill);
        if (!entries.length) {
          problems.push(t('doctor.skillsEvalMissing', { skill: ds.skill }));
          continue;
        }
        const latest = entries.reduce((best, e) => (
          !best || Date.parse(e.ts) >= Date.parse(best.ts) ? e : best
        ), null);
        if (latest.outcome !== 'pass') {
          hasFailing = true;
          problems.push(t('doctor.skillsEvalFailed', {
            skill: ds.skill,
            passRate: `${(latest.passRate * 100).toFixed(0)}%`,
            threshold: `${(latest.threshold * 100).toFixed(0)}%`,
          }));
          continue;
        }
        const age = now - Date.parse(latest.ts);
        if (age > maxAgeMs) {
          problems.push(t('doctor.skillsEvalStale', { skill: ds.skill, days: Math.floor(age / (24 * 3600 * 1000)) }));
        }
      }

      if (problems.length) {
        const detail = problems.join('; ');
        const fix = t('doctor.skillsEvalFixHint') || '';
        const ok = !hasFailing;
        return {
          status: hasFailing ? 'failed' : 'warned',
          reason: detail,
          hint: fix,
          doctorChecks: [{ ok, name: 'skills eval', detail, fix, warn: !hasFailing }],
        };
      }

      const detail = t('doctor.skillsEvalOk', { count: datasets.length });
      return {
        status: 'passed',
        reason: detail,
        details: { count: datasets.length },
        doctorChecks: [{ ok: true, name: 'skills eval', detail }],
      };
    },
  },

  mcp: {
    titleKey: 'gate.guardMcpTitle',
    defaultTitle: 'MCP Gateway & RBAC Audit Guard',
    diffTouches: (_target, changedFiles) => changedFiles.some(
      (f) => f.startsWith('.agents/mcp') || f.includes('mcp.json') || f.includes('mcp-gateway.json'),
    ),
    diffSkipReason: (count, t) => t('gate.diffMcpNoChanges', { count })
      || `0 MCP configurations modified in diff scope (${count} files changed)`,
    evaluate(target, { t }) {
      const configFile = path.join(target, MCP_GATEWAY_CONFIG_REL);
      if (fs.existsSync(configFile)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
          if (!cfg || typeof cfg !== 'object') {
            const detail = t('doctor.mcpConfigInvalid', { path: MCP_GATEWAY_CONFIG_REL }) || 'Invalid mcp-gateway.json';
            return {
              status: 'failed',
              reason: detail,
              doctorChecks: [{ ok: false, name: 'mcp-gateway config', detail }],
            };
          }
        } catch {
          const detail = t('doctor.mcpConfigInvalid', { path: MCP_GATEWAY_CONFIG_REL }) || 'Invalid mcp-gateway.json';
          return {
            status: 'failed',
            reason: detail,
            doctorChecks: [{ ok: false, name: 'mcp-gateway config', detail }],
          };
        }
      }

      const auditFile = path.join(target, MCP_AUDIT_LOG_REL);
      if (!fs.existsSync(auditFile)) {
        if (!fs.existsSync(configFile)) {
          return {
            status: 'skipped',
            reason: t('gate.guardMcpPass') || 'No MCP gateway config defined (optional)',
            doctorChecks: [],
          };
        }
        return {
          status: 'passed',
          reason: t('gate.guardMcpPass') || '0 unauthorized or blocked privilege escalations',
          doctorChecks: [],
        };
      }

      const { summary } = queryMcpAudit(target, { days: 1 });
      if (summary.deniedCalls > 5) {
        const detail = t('doctor.mcpAuditAnomalies', { denied: summary.deniedCalls, total: summary.totalCalls });
        const fix = t('doctor.mcpAuditHint') || '';
        return {
          status: 'warned',
          reason: detail,
          hint: fix,
          details: { deniedCalls: summary.deniedCalls, totalCalls: summary.totalCalls },
          doctorChecks: [{ ok: false, warn: true, name: 'mcp-audit anomalies', detail, fix }],
        };
      }

      const detail = t('doctor.mcpAuditOk', { total: summary.totalCalls, denied: summary.deniedCalls });
      return {
        status: 'passed',
        reason: detail,
        details: { deniedCalls: summary.deniedCalls, totalCalls: summary.totalCalls },
        doctorChecks: [{ ok: true, name: 'mcp-audit', detail }],
      };
    },
  },

  sandbox: {
    titleKey: 'gate.guardSandboxTitle',
    defaultTitle: 'Container Sandbox Isolation Guard',
    diffTouches: (_target, changedFiles) => changedFiles.some(
      (f) => f.includes('sandbox.json') || f.includes('Dockerfile') || f.includes('devcontainer'),
    ),
    diffSkipReason: (count, t) => t('gate.diffSandboxNoChanges', { count })
      || `0 sandbox configurations modified in diff scope (${count} files changed)`,
    evaluate(target, { t }) {
      const configFile = path.join(target, SANDBOX_CONFIG_REL);
      if (!fs.existsSync(configFile)) {
        return {
          status: 'skipped',
          reason: t('sandbox.noConfig') || 'No sandbox config found (optional)',
          doctorChecks: [],
        };
      }

      let cfg;
      try {
        cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        if (!cfg || typeof cfg !== 'object') {
          throw new Error('Not an object');
        }
      } catch {
        const detail = t('doctor.sandboxConfigInvalid') || 'Invalid sandbox.json configuration';
        return {
          status: 'failed',
          reason: detail,
          doctorChecks: [{ ok: false, name: 'sandbox isolation', detail }],
        };
      }

      const engine = detectContainerEngine(cfg.engine || 'auto');
      const mode = cfg.mode || 'auto';
      const network = cfg.network || 'bridge';

      if (mode === 'strict' || mode === 'always') {
        if (!engine.available) {
          const detail = t('doctor.sandboxEngineMissing', { mode }) || `Strict sandbox mode requires container engine (${mode})`;
          const fix = t('doctor.sandboxEngineFix') || '';
          return {
            status: 'failed',
            reason: detail,
            hint: fix,
            doctorChecks: [{ ok: false, name: 'sandbox isolation', detail, fix }],
          };
        }
        const detail = t('doctor.sandboxOk', {
          engine: `${engine.engine} (${engine.version || 'detected'})`,
          mode,
          network,
        });
        return {
          status: 'passed',
          reason: detail,
          doctorChecks: [{ ok: true, name: 'sandbox isolation', detail }],
        };
      }

      if (mode === 'auto') {
        if (!engine.available) {
          const detail = t('doctor.sandboxDegraded', { mode: 'auto' }) || 'No container engine found; degraded to local isolation';
          const fix = t('doctor.sandboxEngineFix') || '';
          return {
            status: 'warned',
            reason: detail,
            hint: fix,
            doctorChecks: [{ ok: true, name: 'sandbox isolation', detail, warn: true, fix }],
          };
        }
        const detail = t('doctor.sandboxOk', {
          engine: `${engine.engine} (${engine.version || 'detected'})`,
          mode,
          network,
        });
        return {
          status: 'passed',
          reason: detail,
          doctorChecks: [{ ok: true, name: 'sandbox isolation', detail }],
        };
      }

      const detail = t('doctor.sandboxOk', {
        engine: engine.available ? `${engine.engine} (${engine.version || 'detected'})` : 'disabled',
        mode,
        network,
      });
      return {
        status: 'passed',
        reason: detail,
        doctorChecks: [{ ok: true, name: 'sandbox isolation', detail }],
      };
    },
  },

  notary: {
    titleKey: 'gate.guardNotaryTitle',
    defaultTitle: 'Cryptographic Notary & Proof Integrity',
    diffTouches: (_target, changedFiles) => notaryTouches(changedFiles),
    diffSkipReason: (count, t) => t('gate.diffNotaryNoChanges', { count })
      || `0 signed proofs or handoffs modified in diff scope (${count} files changed)`,
    evaluate(target, { notary = {}, t }) {
      let pubKeyPath = notary.pubkey ? path.resolve(notary.pubkey) : null;
      if (!pubKeyPath && notary.key) {
        const candidatePub = String(notary.key).endsWith('.pub.pem')
          ? path.resolve(notary.key)
          : path.resolve(notary.key).replace(/\.pem$/, '.pub.pem');
        if (fs.existsSync(candidatePub)) pubKeyPath = candidatePub;
      }
      if (!pubKeyPath) pubKeyPath = resolvePublicKeyPath(target);
      const pubKey = pubKeyPath && fs.existsSync(pubKeyPath) ? fs.readFileSync(pubKeyPath, 'utf8') : null;

      const attestationSigPath = path.join(target, '.agents', 'attestation.sig');
      const attestationPath = path.join(target, '.agents', 'attestation.json');
      const sbomSigPath = path.join(target, '.agents', 'sbom.sig');
      const sbomPath = notary.sbom ? path.resolve(notary.sbom) : path.join(target, '.agents', 'sbom.json');
      const handoffsDir = path.join(target, '.agents', 'handoffs');

      let checkedCount = 0;
      const violations = [];
      const doctorChecks = [];

      const handoffStats = {
        total: 0,
        pending: 0,
        accepted: 0,
        completed: 0,
        rejected: 0,
        tampered: 0,
        warned: 0,
        warnings: [],
        clean: true,
        files: [],
      };

      // 1. Attestation signature
      if (fs.existsSync(attestationSigPath)) {
        checkedCount += 1;
        if (!pubKey) {
          violations.push(t('gate.notaryMissingKey', { file: 'attestation.sig' }) || 'Missing notary public key for attestation.sig');
          doctorChecks.push({ ok: false, name: 'signature attestation', detail: t('doctor.sigMissingKey') });
        } else if (!fs.existsSync(attestationPath)) {
          violations.push(t('gate.notaryMissingPayload', { file: 'attestation.json' }) || 'Missing attestation.json payload');
          doctorChecks.push({ ok: false, name: 'signature attestation', detail: t('gate.notaryMissingPayload', { file: 'attestation.json' }) || 'Missing attestation.json payload' });
        } else {
          try {
            const sigObj = readSignatureFile(attestationSigPath);
            const payload = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
            const verifyRes = verifySignature({ payload, signatureObject: sigObj, publicKeyPem: pubKey });
            if (verifyRes.ok) {
              doctorChecks.push({ ok: true, name: 'signature attestation', detail: t('doctor.sigAttestationOk', { fp: verifyRes.fingerprint }) });
            } else {
              violations.push(t('gate.notaryTampered', { file: 'attestation.json', error: verifyRes.detail || verifyRes.error }));
              doctorChecks.push({ ok: false, name: 'signature attestation', detail: t('doctor.sigAttestationFailed', { detail: verifyRes.detail || verifyRes.error }) });
            }
          } catch (err) {
            violations.push(t('gate.notaryTampered', { file: 'attestation.json', error: err.message }));
            doctorChecks.push({ ok: false, name: 'signature attestation', detail: t('doctor.sigAttestationFailed', { detail: err.message }) });
          }
        }
      }

      // 2. SBOM signature
      if (fs.existsSync(sbomSigPath)) {
        checkedCount += 1;
        if (!pubKey) {
          violations.push(t('gate.notaryMissingKey', { file: 'sbom.sig' }) || 'Missing notary public key for sbom.sig');
          doctorChecks.push({ ok: false, name: 'signature sbom', detail: t('doctor.sigMissingKey') });
        } else if (!fs.existsSync(sbomPath)) {
          violations.push(t('gate.notaryMissingPayload', { file: 'sbom.json' }) || 'Missing sbom.json payload');
          doctorChecks.push({ ok: false, name: 'signature sbom', detail: t('doctor.sigMissingSbom') });
        } else {
          try {
            const sigObj = readSignatureFile(sbomSigPath);
            const payload = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
            const verifyRes = verifySignature({ payload, signatureObject: sigObj, publicKeyPem: pubKey });
            if (verifyRes.ok) {
              doctorChecks.push({ ok: true, name: 'signature sbom', detail: t('doctor.sigSbomOk', { fp: verifyRes.fingerprint }) });
            } else {
              violations.push(t('gate.notaryTampered', { file: 'sbom.json', error: verifyRes.detail || verifyRes.error }));
              doctorChecks.push({ ok: false, name: 'signature sbom', detail: t('doctor.sigSbomFailed', { detail: verifyRes.detail || verifyRes.error }) });
            }
          } catch (err) {
            violations.push(t('gate.notaryTampered', { file: 'sbom.json', error: err.message }));
            doctorChecks.push({ ok: false, name: 'signature sbom', detail: t('doctor.sigSbomFailed', { detail: err.message }) });
          }
        }
      }

      // 3. Multi-agent Handoff Envelopes
      if (fs.existsSync(handoffsDir)) {
        const handoffs = listHandoffFiles(target, { includeInvalid: true });
        handoffStats.total = handoffs.length;
        for (const hItem of handoffs) {
          checkedCount += 1;
          handoffStats.files.push(hItem);

          if (!hItem.envelope) {
            handoffStats.tampered += 1;
            const problems = hItem.invalidReason || 'Invalid handoff file';
            violations.push(t('gate.handoffTampered', { id: hItem.name, error: problems }));
            doctorChecks.push({
              ok: false,
              name: `handoff ${hItem.name}`,
              detail: t('doctor.handoffDrift', { id: hItem.name, problems }),
            });
            continue;
          }

          const st = hItem.envelope.status;
          if (st === 'pending') handoffStats.pending += 1;
          else if (st === 'accepted') handoffStats.accepted += 1;
          else if (st === 'completed') handoffStats.completed += 1;
          else if (st === 'rejected') handoffStats.rejected += 1;

          const verifyRes = verifyHandoffEnvelope({
            target,
            envelope: hItem.envelope,
            publicKeyPem: pubKey,
          });

          if (verifyRes.ok) {
            if (verifyRes.warnings?.length) {
              handoffStats.warned += 1;
              for (const w of verifyRes.warnings) {
                if (handoffStats.warnings.length < 5) handoffStats.warnings.push(w);
              }
            }
            doctorChecks.push({
              ok: true,
              name: `handoff ${hItem.envelope.id}`,
              detail: t('doctor.handoffOk', {
                id: hItem.envelope.id,
                from: hItem.envelope.fromRole,
                to: hItem.envelope.toRole,
              }),
            });
          } else {
            handoffStats.tampered += 1;
            const problems = (verifyRes.problems || []).join('; ') || 'tampered';
            violations.push(t('gate.handoffTampered', {
              id: hItem.envelope?.id || hItem.file,
              error: problems,
            }));
            doctorChecks.push({
              ok: false,
              name: `handoff ${hItem.envelope?.id || hItem.name}`,
              detail: t('doctor.handoffDrift', { id: hItem.envelope?.id || hItem.name, problems }),
            });
          }
        }
        handoffStats.clean = handoffStats.tampered === 0;
      }

      if (checkedCount === 0) {
        return {
          status: 'skipped',
          reason: t('gate.notaryNoSignatures') || 'No signed attestations or handoffs found in project',
          doctorChecks: [],
          handoffStats,
        };
      }

      if (violations.length > 0) {
        return {
          status: 'failed',
          reason: violations.join('; '),
          hint: t('gate.notaryFixHint') || 'Run flow-kit sign or re-verify compromised signatures',
          details: { violations, count: checkedCount },
          doctorChecks,
          handoffStats,
        };
      }

      return {
        status: 'passed',
        reason: t('gate.notaryOk', { count: checkedCount }) || `All ${checkedCount} signed proofs verified intact`,
        details: { count: checkedCount },
        doctorChecks,
        handoffStats,
      };
    },
  },

  policy: {
    titleKey: 'gate.guardPolicyTitle',
    defaultTitle: 'Central Enterprise Policy Alignment',
    diffTouches: (_target, changedFiles) => changedFiles.some((f) => f.includes('policy.json')),
    diffSkipReason: (count, t) => t('gate.diffPolicyNoChanges', { count })
      || `0 policy definitions modified in diff scope (${count} files changed)`,
    evaluate(target, { policy: policyOpt = {}, t }) {
      const canonicalPolicy = path.join(target, '.agents', 'config', 'policy.json');
      const legacyPolicy = path.join(target, '.agents', 'policy.json');
      const policyFile = fs.existsSync(canonicalPolicy)
        ? canonicalPolicy
        : (fs.existsSync(legacyPolicy) ? legacyPolicy : null);

      if (!policyFile) {
        return {
          status: 'skipped',
          reason: t('gate.policyNoConfig') || 'No .agents/config/policy.json defined',
          doctorChecks: [],
        };
      }

      let policy;
      try {
        policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
        if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
          throw new Error('Invalid policy shape');
        }
      } catch {
        const detail = t('gate.policyInvalid') || 'Invalid policy.json format';
        return {
          status: 'failed',
          reason: detail,
          doctorChecks: [{ ok: false, name: 'policy', detail }],
        };
      }

      const doctorChecks = [];

      // 检查远程基线对账
      if (policy.remote?.url && (policyOpt.remote || policyOpt.sync !== false)) {
        const check = checkPolicyDriftSync(target, policy, null, t);
        if (!check.ok) {
          const detail = t('doctor.policyRemoteError', { error: check.error });
          doctorChecks.push({ ok: true, name: 'policy-remote unreachable', detail, warn: true });
          return { status: 'warned', reason: detail, doctorChecks };
        }
        if (!check.synced) {
          const detail = t('doctor.policyRemoteDrift', { count: check.changes.length, url: policy.remote.url });
          const hint = t('doctor.policyRemoteHint') || '';
          doctorChecks.push({ ok: true, name: 'policy-remote drift', detail, fix: hint, warn: true });
          return { status: 'warned', reason: detail, hint, doctorChecks };
        }
        const detail = t('doctor.policyRemoteOk', { url: policy.remote.url, ref: check.ref });
        doctorChecks.push({ ok: true, name: 'policy-remote', detail });
      }

      if (policy.remotePolicyServer && !policy.lastSyncedAt) {
        const detail = t('gate.policyUnsynced') || 'Central policy server configured but not synced yet';
        const hint = t('gate.policySyncHint') || 'Run flow-kit policy pull to synchronize with central baseline';
        return {
          status: 'warned',
          reason: detail,
          hint,
          doctorChecks,
        };
      }

      const version = String(policy.version ?? '1.0');
      return {
        status: 'passed',
        reason: t('gate.policyPass', { version }) || `Policy configuration valid (version: ${version})`,
        details: { version: policy.version },
        doctorChecks,
      };
    },
  },

  metrics: {
    titleKey: 'gate.guardMetricsTitle',
    defaultTitle: 'AI-DORA Quality Baseline Guard',
    diffTouches: () => true, // 效能遥测始终参与评估
    diffSkipReason: () => '',
    evaluate(target, { thresholds = {}, t }) {
      try {
        const metrics = computeAiDoraMetrics(target, { days: 30 });
        const { violations } = checkMetricsThresholds(metrics, thresholds);
        const doraTier = metrics.doraTier ?? metrics.dora?.tier;

        if (violations.length > 0) {
          return {
            status: 'failed',
            reason: violations.join('; '),
            details: { tier: doraTier, violations },
            doctorChecks: [],
          };
        }

        const tierDesc = doraTier ? `AI-DORA tier: ${doraTier}` : 'No recent failures';
        return {
          status: 'passed',
          reason: t('gate.metricsPass', { tier: doraTier || 'N/A' }) || `${tierDesc}, all metrics within baseline`,
          details: { tier: doraTier },
          doctorChecks: [],
        };
      } catch (err) {
        return {
          status: 'failed',
          reason: err.message,
          doctorChecks: [],
        };
      }
    },
  },
};

/**
 * 运行治理探针深模块 (Governance Probe Core Runner)
 */
export function runGovernanceProbes({
  target = process.cwd(),
  probes = null,
  rules = null,
  diffScoping = null,
  changedFiles = null,
  thresholds = {},
  notary = {},
  policy = {},
  t = (k) => k,
} = {}) {
  const absTarget = path.resolve(target);

  // 严格校验数值型阈值
  for (const [key, val] of Object.entries(thresholds || {})) {
    if (val !== undefined && val !== null && (typeof val !== 'number' || !Number.isFinite(val))) {
      const err = new Error(`Invalid numeric threshold for ${key}: ${val}`);
      err.code = 'BAD_GATE_USAGE';
      throw err;
    }
  }

  const rawProbes = probes ?? rules;
  let selectedSet = null;
  if (rawProbes != null) {
    const normalized = (Array.isArray(rawProbes) ? rawProbes : [rawProbes])
      .map((r) => String(r).trim().toLowerCase())
      .filter(Boolean);
    if (!normalized.length) {
      const err = new Error('`probes` or `rules` must contain at least one non-empty probe name');
      err.code = 'BAD_GATE_USAGE';
      throw err;
    }
    selectedSet = new Set(normalized);
  }
  const activeProbeIds = PROBE_ORDER.filter((id) => !selectedSet || selectedSet.has(id));

  const startMs = Date.now();
  const results = [];
  const byId = {};
  let collectedHandoffs = null;

  for (const id of activeProbeIds) {
    const def = PROBE_DEFS[id];
    if (!def) continue;

    const probeStart = Date.now();
    let res;

    const touches = !changedFiles || def.diffTouches(absTarget, changedFiles);
    if (changedFiles && !touches) {
      res = {
        status: 'passed',
        reason: def.diffSkipReason(changedFiles.length, t),
        doctorChecks: [],
      };
    } else {
      res = def.evaluate(absTarget, { thresholds, notary, policy, t });
    }

    if (res.handoffStats) {
      collectedHandoffs = res.handoffStats;
    }

    const durationMs = Date.now() - probeStart;
    const probeResult = {
      id,
      name: id,
      title: t(def.titleKey) || def.defaultTitle,
      status: res.status,
      reason: res.reason,
      hint: res.hint,
      details: res.details,
      durationMs,
      doctorChecks: res.doctorChecks || [],
    };

    results.push(probeResult);
    byId[id] = probeResult;
  }

  const passedCount = results.filter((p) => p.status === 'passed').length;
  const failedCount = results.filter((p) => p.status === 'failed').length;
  const warnedCount = results.filter((p) => p.status === 'warned').length;
  const skippedCount = results.filter((p) => p.status === 'skipped').length;

  return {
    target: absTarget,
    durationMs: Date.now() - startMs,
    summary: {
      total: results.length,
      passed: passedCount,
      failed: failedCount,
      warned: warnedCount,
      skipped: skippedCount,
    },
    byId,
    probes: results,
    checks: results.flatMap((p) => p.doctorChecks),
    handoffs: collectedHandoffs || {
      total: 0,
      pending: 0,
      accepted: 0,
      completed: 0,
      rejected: 0,
      tampered: 0,
      warned: 0,
      warnings: [],
      clean: true,
      files: [],
    },
  };
}

/**
 * 将探针批次映射为门禁裁决结构 (Gate Verdict Projection)
 */
export function toGateVerdict(probeBatch, { strict = false, diffScoping = null, durationMs } = {}) {
  const guards = (probeBatch.probes || []).map((p) => {
    let status = p.status;
    if (strict && status === 'warned') {
      status = 'failed';
    }
    return {
      name: p.name || p.id,
      title: p.title,
      status,
      reason: p.reason,
      hint: p.hint,
      details: p.details,
      durationMs: p.durationMs,
    };
  });

  const passedCount = guards.filter((g) => g.status === 'passed').length;
  const failedCount = guards.filter((g) => g.status === 'failed').length;
  const warnedCount = guards.filter((g) => g.status === 'warned').length;
  const skippedCount = guards.filter((g) => g.status === 'skipped').length;

  const passed = failedCount === 0 && (!strict || warnedCount === 0);
  const verdict = passed ? 'APPROVED' : 'REJECTED';

  return {
    verdict,
    passed,
    strict: Boolean(strict),
    target: probeBatch.target,
    diffScoping,
    createdAt: new Date().toISOString(),
    durationMs: durationMs ?? probeBatch.durationMs,
    guards,
    summary: {
      total: guards.length,
      passed: passedCount,
      failed: failedCount,
      warned: warnedCount,
      skipped: skippedCount,
    },
  };
}
