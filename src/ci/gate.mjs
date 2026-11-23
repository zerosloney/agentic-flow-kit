import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkArchHealth } from '../install/arch-guard.mjs';
import { checkSkillsEvalHealth } from '../skills/eval-harness.mjs';
import { checkMcpGatewayHealth } from '../install/mcp-gateway.mjs';
import { checkSandboxHealth } from '../install/sandbox.mjs';
import { verifySignature, readSignatureFile, resolvePublicKeyPath } from '../install/notary.mjs';
import { listHandoffFiles, verifyHandoffEnvelope } from '../install/handoff.mjs';
import { computeAiDoraMetrics, checkMetricsThresholds } from '../install/metrics.mjs';

/**
 * 解析 Git 差异变更集文件列表（用于增量卡口 / PR 范围收敛）
 */
export function resolveChangedFiles(target, { since = null } = {}) {
  const files = new Set();
  let resolved = false;
  try {
    const diffArgs = since
      ? ['diff', '--name-only', `${since}...HEAD`]
      : ['diff', '--name-only', 'HEAD~1...HEAD'];
    let res = spawnSync('git', diffArgs, { encoding: 'utf8', cwd: target });
    if (res.status !== 0 && since) {
      res = spawnSync('git', ['diff', '--name-only', since], { encoding: 'utf8', cwd: target });
    }
    if (res.status === 0) {
      resolved = true;
      if (res.stdout) {
        for (const line of res.stdout.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) files.add(trimmed.replace(/\\/g, '/'));
        }
      }
    }

    // 兼顾工作区未暂存及已暂存的未提交改动
    const statRes = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: target });
    if (statRes.status === 0) {
      resolved = true;
      if (statRes.stdout) {
        for (const line of statRes.stdout.split(/\r?\n/)) {
          if (!line.trim()) continue;
          const filePath = line.slice(3).trim();
          const actual = filePath.includes('->') ? filePath.split('->').pop().trim() : filePath;
          if (actual) files.add(actual.replace(/\\/g, '/'));
        }
      }
    }
  } catch {
    return null;
  }
  // 所有 git 命令均失败（非 git 仓库 / 浅克隆 / git 不可用）时无法判定差异集
  if (!resolved) return null;
  return Array.from(files);
}

/**
 * 校验公证签名证明链与防篡改
 */
function checkNotaryProofGuard(target, t) {
  const pubKeyPath = resolvePublicKeyPath(target);
  const pubKey = fs.existsSync(pubKeyPath) ? fs.readFileSync(pubKeyPath, 'utf8') : null;

  const attestationSigPath = path.join(target, '.agents', 'attestation.sig');
  const attestationPath = path.join(target, '.agents', 'attestation.json');
  const sbomSigPath = path.join(target, '.agents', 'sbom.sig');
  const sbomPath = path.join(target, '.agents', 'sbom.json');
  const handoffsDir = path.join(target, '.agents', 'handoffs');

  let checkedCount = 0;
  const violations = [];

  // 1. 检查 attestation 签名
  if (fs.existsSync(attestationSigPath)) {
    checkedCount += 1;
    if (!pubKey) {
      violations.push(t('gate.notaryMissingKey', { file: 'attestation.sig' }) || 'Missing notary public key for attestation.sig');
    } else if (!fs.existsSync(attestationPath)) {
      violations.push(t('gate.notaryMissingPayload', { file: 'attestation.json' }) || 'Missing attestation.json payload');
    } else {
      try {
        const sigObj = readSignatureFile(attestationSigPath);
        const payload = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
        const verifyRes = verifySignature({ payload, signatureObject: sigObj, publicKeyPem: pubKey });
        if (!verifyRes.ok) {
          violations.push(t('gate.notaryTampered', { file: 'attestation.json', error: verifyRes.detail || verifyRes.error }));
        }
      } catch (err) {
        violations.push(t('gate.notaryTampered', { file: 'attestation.json', error: err.message }));
      }
    }
  }

  // 2. 检查 sbom 签名
  if (fs.existsSync(sbomSigPath)) {
    checkedCount += 1;
    if (!pubKey) {
      violations.push(t('gate.notaryMissingKey', { file: 'sbom.sig' }) || 'Missing notary public key for sbom.sig');
    } else if (!fs.existsSync(sbomPath)) {
      violations.push(t('gate.notaryMissingPayload', { file: 'sbom.json' }) || 'Missing sbom.json payload');
    } else {
      try {
        const sigObj = readSignatureFile(sbomSigPath);
        const payload = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
        const verifyRes = verifySignature({ payload, signatureObject: sigObj, publicKeyPem: pubKey });
        if (!verifyRes.ok) {
          violations.push(t('gate.notaryTampered', { file: 'sbom.json', error: verifyRes.detail || verifyRes.error }));
        }
      } catch (err) {
        violations.push(t('gate.notaryTampered', { file: 'sbom.json', error: err.message }));
      }
    }
  }

  // 3. 检查多智能体交接信封
  if (fs.existsSync(handoffsDir)) {
    const handoffs = listHandoffFiles(target);
    for (const hItem of handoffs) {
      checkedCount += 1;
      const verifyRes = verifyHandoffEnvelope({
        target,
        envelope: hItem.envelope,
        publicKeyPem: pubKey,
      });
      if (!verifyRes.ok) {
        violations.push(t('gate.handoffTampered', { id: hItem.envelope?.id || hItem.file, error: verifyRes.reason }));
      }
    }
  }

  if (checkedCount === 0) {
    return {
      name: 'notary',
      title: t('gate.guardNotaryTitle') || 'Cryptographic Notary & Proof Integrity',
      status: 'skipped',
      reason: t('gate.notaryNoSignatures') || 'No signed attestations or handoffs found in project',
    };
  }

  if (violations.length > 0) {
    return {
      name: 'notary',
      title: t('gate.guardNotaryTitle') || 'Cryptographic Notary & Proof Integrity',
      status: 'failed',
      reason: violations.join('; '),
      hint: t('gate.notaryFixHint') || 'Run flow-kit sign or re-verify compromised signatures',
      details: { violations },
    };
  }

  return {
    name: 'notary',
    title: t('gate.guardNotaryTitle') || 'Cryptographic Notary & Proof Integrity',
    status: 'passed',
    reason: t('gate.notaryOk', { count: checkedCount }) || `All ${checkedCount} signed proofs verified intact`,
    details: { count: checkedCount },
  };
}

/**
 * 校验中央策略面合规
 */
function checkPolicyGuard(target, t) {
  const policyFile = path.join(target, '.agents', 'policy.json');
  if (!fs.existsSync(policyFile)) {
    return {
      name: 'policy',
      title: t('gate.guardPolicyTitle') || 'Central Enterprise Policy Alignment',
      status: 'skipped',
      reason: t('gate.policyNoConfig') || 'No .agents/policy.json defined',
    };
  }

  try {
    const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
    if (!policy || typeof policy !== 'object') {
      return {
        name: 'policy',
        title: t('gate.guardPolicyTitle') || 'Central Enterprise Policy Alignment',
        status: 'failed',
        reason: t('gate.policyInvalid') || 'Invalid policy.json format',
      };
    }

    if (policy.remotePolicyServer && !policy.lastSyncedAt) {
      return {
        name: 'policy',
        title: t('gate.guardPolicyTitle') || 'Central Enterprise Policy Alignment',
        status: 'warned',
        reason: t('gate.policyUnsynced') || 'Central policy server configured but not synced yet',
        hint: t('gate.policySyncHint') || 'Run flow-kit policy pull to synchronize with central baseline',
      };
    }

    return {
      name: 'policy',
      title: t('gate.guardPolicyTitle') || 'Central Enterprise Policy Alignment',
      status: 'passed',
      reason: t('gate.policyPass', { version: policy.version || '1.0' }) || `Policy configuration valid (version: ${policy.version || '1.0'})`,
      details: { version: policy.version },
    };
  } catch (err) {
    return {
      name: 'policy',
      title: t('gate.guardPolicyTitle') || 'Central Enterprise Policy Alignment',
      status: 'failed',
      reason: err.message,
    };
  }
}

/**
 * 执行全要素零信任合流门禁卡口检测
 */
export function runGateChecks({
  target,
  strict = false,
  rules = null,
  thresholds = {},
  diff = false,
  since = null,
  t,
}) {
  const selectedRules = rules && rules.length ? new Set(rules.map((r) => r.trim().toLowerCase())) : null;
  const isEnabled = (name) => !selectedRules || selectedRules.has(name);

  const startMs = Date.now();
  const guards = [];

  // 计算增量 PR 差异集文件
  let changedFiles = null;
  let diffScoping = null;
  if (diff || since) {
    changedFiles = resolveChangedFiles(target, { since });
    if (changedFiles) {
      diffScoping = {
        active: true,
        since: since || 'HEAD~1',
        changedCount: changedFiles.length,
        files: changedFiles,
      };
    } else {
      // 无法解析差异集时回退全量检查（fail-closed），而不是把空集当作有效范围跳过守卫
      process.stderr.write(
        `${t('gate.diffScopeFailed') || 'Failed to resolve diff scope, falling back to full checks'}\n`,
      );
    }
  }

  // 1. Architecture Layering & Boundary Guard
  if (isEnabled('arch')) {
    const archStart = Date.now();
    try {
      const archConfigPath = path.join(target, '.agents', 'config', 'architecture.json');
      const hasArchConfig = fs.existsSync(archConfigPath);
      const touchesArch = !diffScoping || (hasArchConfig && changedFiles.some(
        (f) => f.startsWith('src/') || f.includes('architecture.json'),
      ));

      if (diffScoping && hasArchConfig && !touchesArch) {
        guards.push({
          name: 'arch',
          title: t('gate.guardArchTitle') || 'Architecture Layering & Boundary Guard',
          status: 'passed',
          reason: t('gate.diffArchNoChanges', { count: changedFiles.length })
            || `0 architecture layer files modified in diff scope (${changedFiles.length} files changed)`,
          durationMs: Date.now() - archStart,
        });
      } else {
        const res = checkArchHealth(target, t);
        if (!res) {
          guards.push({
            name: 'arch',
            title: t('gate.guardArchTitle') || 'Architecture Layering & Boundary Guard',
            status: 'skipped',
            reason: t('arch.noConfig') || 'No architecture layering config found (optional)',
            durationMs: Date.now() - archStart,
          });
        } else if (!res.ok) {
          guards.push({
            name: 'arch',
            title: t('gate.guardArchTitle') || 'Architecture Layering & Boundary Guard',
            status: 'failed',
            reason: res.detail || res.reason,
            hint: res.fix || res.hint || t('doctor.archFixHint'),
            details: { violations: res.violations, cycles: res.cycles, layerViolations: res.layerViolations, privateViolations: res.privateViolations },
            durationMs: Date.now() - archStart,
          });
        } else {
          guards.push({
            name: 'arch',
            title: t('gate.guardArchTitle') || 'Architecture Layering & Boundary Guard',
            status: 'passed',
            reason: res.detail || res.reason || t('arch.checkPass') || 'No circular dependencies or boundary violations',
            durationMs: Date.now() - archStart,
          });
        }
      }
    } catch (e) {
      guards.push({
        name: 'arch',
        title: t('gate.guardArchTitle') || 'Architecture Layering & Boundary Guard',
        status: 'failed',
        reason: e.message,
        durationMs: Date.now() - archStart,
      });
    }
  }

  // 2. Skills Regression Eval Guard
  if (isEnabled('skills')) {
    const skillStart = Date.now();
    try {
      const touchesSkills = !diffScoping || changedFiles.some(
        (f) => f.startsWith('.agents/skills/') || f.startsWith('.agents/evals/'),
      );

      if (diffScoping && !touchesSkills) {
        guards.push({
          name: 'skills',
          title: t('gate.guardSkillsTitle') || 'Skills Regression Eval Guard',
          status: 'passed',
          reason: t('gate.diffSkillsNoChanges', { count: changedFiles.length })
            || `0 skill assets modified in diff scope (${changedFiles.length} files changed)`,
          durationMs: Date.now() - skillStart,
        });
      } else {
        const res = checkSkillsEvalHealth(target, t);
        if (!res) {
          guards.push({
            name: 'skills',
            title: t('gate.guardSkillsTitle') || 'Skills Regression Eval Guard',
            status: 'skipped',
            reason: t('gate.guardSkillsNoSkills') || 'No custom skills installed',
            durationMs: Date.now() - skillStart,
          });
        } else if (!res.ok) {
          guards.push({
            name: 'skills',
            title: t('gate.guardSkillsTitle') || 'Skills Regression Eval Guard',
            status: res.warn && !strict ? 'warned' : 'failed',
            reason: res.detail,
            hint: res.fix || res.hint,
            durationMs: Date.now() - skillStart,
          });
        } else {
          guards.push({
            name: 'skills',
            title: t('gate.guardSkillsTitle') || 'Skills Regression Eval Guard',
            status: 'passed',
            reason: res.detail || t('doctor.skillsEvalOk', { count: res.count }),
            durationMs: Date.now() - skillStart,
          });
        }
      }
    } catch (e) {
      guards.push({
        name: 'skills',
        title: t('gate.guardSkillsTitle') || 'Skills Regression Eval Guard',
        status: 'failed',
        reason: e.message,
        durationMs: Date.now() - skillStart,
      });
    }
  }

  // 3. MCP RBAC & Tool Gateway Guard
  if (isEnabled('mcp')) {
    const mcpStart = Date.now();
    try {
      const touchesMcp = !diffScoping || changedFiles.some(
        (f) => f.startsWith('.agents/mcp') || f.includes('mcp.json'),
      );

      if (diffScoping && !touchesMcp) {
        guards.push({
          name: 'mcp',
          title: t('gate.guardMcpTitle') || 'MCP Gateway & RBAC Audit Guard',
          status: 'passed',
          reason: t('gate.diffMcpNoChanges', { count: changedFiles.length })
            || `0 MCP configurations modified in diff scope (${changedFiles.length} files changed)`,
          durationMs: Date.now() - mcpStart,
        });
      } else {
        const res = checkMcpGatewayHealth(target, t);
        if (!res) {
          guards.push({
            name: 'mcp',
            title: t('gate.guardMcpTitle') || 'MCP Gateway & RBAC Audit Guard',
            status: 'skipped',
            reason: t('gate.guardMcpPass') || 'No MCP gateway config defined (optional)',
            durationMs: Date.now() - mcpStart,
          });
        } else if (!res.ok) {
          guards.push({
            name: 'mcp',
            title: t('gate.guardMcpTitle') || 'MCP Gateway & RBAC Audit Guard',
            status: res.warn && !strict ? 'warned' : 'failed',
            reason: res.detail || res.reason,
            hint: res.fix || res.hint,
            durationMs: Date.now() - mcpStart,
          });
        } else {
          guards.push({
            name: 'mcp',
            title: t('gate.guardMcpTitle') || 'MCP Gateway & RBAC Audit Guard',
            status: 'passed',
            reason: res.detail || t('gate.guardMcpPass') || '0 unauthorized or blocked privilege escalations',
            durationMs: Date.now() - mcpStart,
          });
        }
      }
    } catch (e) {
      guards.push({
        name: 'mcp',
        title: t('gate.guardMcpTitle') || 'MCP Gateway & RBAC Audit Guard',
        status: 'failed',
        reason: e.message,
        durationMs: Date.now() - mcpStart,
      });
    }
  }

  // 4. Execution Sandbox Route Guard
  if (isEnabled('sandbox')) {
    const sbStart = Date.now();
    try {
      const touchesSandbox = !diffScoping || changedFiles.some(
        (f) => f.includes('sandbox.json') || f.includes('Dockerfile') || f.includes('devcontainer'),
      );

      if (diffScoping && !touchesSandbox) {
        guards.push({
          name: 'sandbox',
          title: t('gate.guardSandboxTitle') || 'Container Sandbox Isolation Guard',
          status: 'passed',
          reason: t('gate.diffSandboxNoChanges', { count: changedFiles.length })
            || `0 sandbox configurations modified in diff scope (${changedFiles.length} files changed)`,
          durationMs: Date.now() - sbStart,
        });
      } else {
        const res = checkSandboxHealth(target, t);
        if (!res) {
          guards.push({
            name: 'sandbox',
            title: t('gate.guardSandboxTitle') || 'Container Sandbox Isolation Guard',
            status: 'skipped',
            reason: t('sandbox.noConfig') || 'No sandbox config found (optional)',
            durationMs: Date.now() - sbStart,
          });
        } else if (!res.ok) {
          guards.push({
            name: 'sandbox',
            title: t('gate.guardSandboxTitle') || 'Container Sandbox Isolation Guard',
            status: res.warn && !strict ? 'warned' : 'failed',
            reason: res.detail || res.reason,
            hint: res.fix || res.hint,
            durationMs: Date.now() - sbStart,
          });
        } else {
          guards.push({
            name: 'sandbox',
            title: t('gate.guardSandboxTitle') || 'Container Sandbox Isolation Guard',
            status: 'passed',
            reason: res.detail || 'Container sandbox ready',
            durationMs: Date.now() - sbStart,
          });
        }
      }
    } catch (e) {
      guards.push({
        name: 'sandbox',
        title: t('gate.guardSandboxTitle') || 'Container Sandbox Isolation Guard',
        status: 'failed',
        reason: e.message,
        durationMs: Date.now() - sbStart,
      });
    }
  }

  // 5. Cryptographic Notary & Proof Guard
  if (isEnabled('notary')) {
    const notaryStart = Date.now();
    try {
      const touchesNotary = !diffScoping || changedFiles.some(
        (f) => f.startsWith('.agents/notary') || f.endsWith('.sig') || f.startsWith('.agents/handoffs/'),
      );

      if (diffScoping && !touchesNotary) {
        guards.push({
          name: 'notary',
          title: t('gate.guardNotaryTitle') || 'Cryptographic Notary & Proof Integrity',
          status: 'passed',
          reason: t('gate.diffNotaryNoChanges', { count: changedFiles.length })
            || `0 signed proofs or handoffs modified in diff scope (${changedFiles.length} files changed)`,
          durationMs: Date.now() - notaryStart,
        });
      } else {
        const res = checkNotaryProofGuard(target, t);
        res.durationMs = Date.now() - notaryStart;
        guards.push(res);
      }
    } catch (e) {
      guards.push({
        name: 'notary',
        title: t('gate.guardNotaryTitle') || 'Cryptographic Notary & Proof Integrity',
        status: 'failed',
        reason: e.message,
        durationMs: Date.now() - notaryStart,
      });
    }
  }

  // 6. Central Enterprise Policy Alignment
  if (isEnabled('policy')) {
    const policyStart = Date.now();
    try {
      const touchesPolicy = !diffScoping || changedFiles.some((f) => f.includes('policy.json'));
      if (diffScoping && !touchesPolicy) {
        guards.push({
          name: 'policy',
          title: t('gate.guardPolicyTitle') || 'Central Enterprise Policy Alignment',
          status: 'passed',
          reason: t('gate.diffPolicyNoChanges', { count: changedFiles.length })
            || `0 policy definitions modified in diff scope (${changedFiles.length} files changed)`,
          durationMs: Date.now() - policyStart,
        });
      } else {
        const res = checkPolicyGuard(target, t);
        res.durationMs = Date.now() - policyStart;
        guards.push(res);
      }
    } catch (e) {
      guards.push({
        name: 'policy',
        title: t('gate.guardPolicyTitle') || 'Central Enterprise Policy Alignment',
        status: 'failed',
        reason: e.message,
        durationMs: Date.now() - policyStart,
      });
    }
  }

  // 7. AI-DORA Quality Baseline Guard
  if (isEnabled('metrics')) {
    const metricsStart = Date.now();
    try {
      const metrics = computeAiDoraMetrics(target, { days: 30 });
      const violations = checkMetricsThresholds(metrics, thresholds);
      if (violations.length > 0) {
        guards.push({
          name: 'metrics',
          title: t('gate.guardMetricsTitle') || 'AI-DORA Quality Baseline Guard',
          status: 'failed',
          reason: violations.map((v) => `${v.metric}: ${v.actual} (limit: ${v.limit})`).join('; '),
          details: { tier: metrics.dora.tier, violations },
          durationMs: Date.now() - metricsStart,
        });
      } else {
        const tierDesc = metrics.dora.tier ? `AI-DORA tier: ${metrics.dora.tier}` : 'No recent failures';
        guards.push({
          name: 'metrics',
          title: t('gate.guardMetricsTitle') || 'AI-DORA Quality Baseline Guard',
          status: 'passed',
          reason: t('gate.metricsPass', { tier: metrics.dora.tier || 'N/A' }) || `${tierDesc}, all metrics within baseline`,
          details: { tier: metrics.dora.tier },
          durationMs: Date.now() - metricsStart,
        });
      }
    } catch (e) {
      guards.push({
        name: 'metrics',
        title: t('gate.guardMetricsTitle') || 'AI-DORA Quality Baseline Guard',
        status: 'failed',
        reason: e.message,
        durationMs: Date.now() - metricsStart,
      });
    }
  }

  const passedCount = guards.filter((g) => g.status === 'passed').length;
  const failedCount = guards.filter((g) => g.status === 'failed').length;
  const warnedCount = guards.filter((g) => g.status === 'warned').length;
  const skippedCount = guards.filter((g) => g.status === 'skipped').length;

  const passed = failedCount === 0 && (!strict || warnedCount === 0);
  const verdict = passed ? 'APPROVED' : 'REJECTED';

  return {
    verdict,
    passed,
    strict,
    target,
    diffScoping,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    summary: {
      total: guards.length,
      passed: passedCount,
      failed: failedCount,
      warned: warnedCount,
      skipped: skippedCount,
    },
    guards,
  };
}

/**
 * 生成 Shields.io 徽章 / SVG / JSON 状态徽章
 */
export function generateGateBadge(result, { format = 'markdown' } = {}) {
  const isApproved = result.passed;
  let verdict = 'APPROVED';
  let color = '2ea44f'; // brightgreen
  const label = 'AI Gate';

  if (!isApproved) {
    if (result.summary.failed === 0 && result.summary.warned > 0) {
      verdict = 'WARNED';
      color = 'dfb317'; // yellow
    } else {
      verdict = 'REJECTED';
      color = 'd73a49'; // red
    }
  }

  const fmt = String(format || 'markdown').toLowerCase();
  if (fmt === 'svg') {
    const textW = verdict.length * 9 + 20;
    const totalW = 60 + textW;
    const textMid = 60 + textW / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${label}: ${verdict}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalW}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="60" height="20" fill="#555"/>
    <rect x="60" width="${textW}" height="20" fill="#${color}"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="310" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="480">${label}</text>
    <text x="310" y="140" transform="scale(.1)" fill="#fff" textLength="480">${label}</text>
    <text aria-hidden="true" x="${textMid * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${verdict}</text>
    <text x="${textMid * 10}" y="140" transform="scale(.1)" fill="#fff">${verdict}</text>
  </g>
</svg>`;
  }

  if (fmt === 'json') {
    return JSON.stringify({
      schemaVersion: 1,
      label,
      message: verdict,
      color,
      isError: !isApproved,
    }, null, 2);
  }

  // markdown / shields.io
  const badgeUrl = `https://img.shields.io/badge/AI--Gate-${encodeURIComponent(verdict)}-${color}?logo=shield`;
  return `[![AI Gate: ${verdict}](${badgeUrl})](https://github.com/agentic-flow-kit)`;
}

/**
 * 渲染终端高可读性 ANSI 纯文本报告
 */
export function renderGateText(result, t) {
  const isApproved = result.passed;
  const badge = isApproved ? '🛡️  [APPROVED]' : '❌ [REJECTED]';
  const lines = [
    `\n${badge} ${t('gate.title') || 'AI-Native Zero-Trust Quality Gate'}: ${result.verdict}`,
    `----------------------------------------------------------------------`,
  ];

  if (result.diffScoping?.active) {
    lines.push(`🔍 ${t('gate.diffScopingScope', { since: result.diffScoping.since, count: result.diffScoping.changedCount }) || `Scope: Incremental PR Diff (since: ${result.diffScoping.since}, ${result.diffScoping.changedCount} files modified)`}`);
    lines.push(`----------------------------------------------------------------------`);
  }

  for (const g of result.guards) {
    let icon = '✔';
    let tag = '[PASS]';
    if (g.status === 'failed') {
      icon = '✖';
      tag = '[FAIL]';
    } else if (g.status === 'warned') {
      icon = '⚠';
      tag = '[WARN]';
    } else if (g.status === 'skipped') {
      icon = '○';
      tag = '[SKIP]';
    }
    const titlePadded = g.title.padEnd(36, ' ');
    lines.push(`${icon} ${tag} ${titlePadded} : ${g.reason || ''}`);
    if (g.hint) {
      lines.push(`     └─ Hint: ${g.hint}`);
    }
  }

  lines.push(`----------------------------------------------------------------------`);
  lines.push(`${t('gate.summaryLine', {
    total: result.summary.total,
    passed: result.summary.passed,
    failed: result.summary.failed,
    warned: result.summary.warned,
    skipped: result.summary.skipped,
    ms: result.durationMs,
  }) || `Summary: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.warned} warned, ${result.summary.skipped} skipped (${result.durationMs}ms)`}`);

  if (!isApproved) {
    lines.push(`\n🚨 ${t('gate.rejectedVerdict') || 'Verdict: REJECTED - Code changes violate AI safety/quality baselines.'}\n`);
  } else {
    lines.push(`\n✨ ${t('gate.approvedVerdict') || 'Verdict: APPROVED - All gate checks satisfied. Ready for merge.'}\n`);
  }

  return lines.join('\n');
}

/**
 * 渲染标准 GitHub / GitLab Markdown 报告
 */
export function renderGateMarkdown(result, t) {
  const isApproved = result.passed;
  const badge = isApproved ? '🟢 **APPROVED**' : '🔴 **REJECTED**';

  const lines = [
    `# 🛡️ AI-Native Zero-Trust Quality Gate: ${badge}`,
    '',
    `> **Target:** \`${result.target}\` | **Mode:** \`${result.strict ? 'Strict' : 'Standard'}\` | **Duration:** ${result.durationMs}ms`,
  ];

  if (result.diffScoping?.active) {
    lines.push(`> **Diff Scoping:** \`${result.diffScoping.since}...HEAD\` (${result.diffScoping.changedCount} files modified)`);
  }

  lines.push('');
  lines.push(`| Status | Guardian | Verdict / Diagnosis | Remediation |`);
  lines.push(`| :---: | :--- | :--- | :--- |`);

  for (const g of result.guards) {
    let statusIcon = '✅ Pass';
    if (g.status === 'failed') statusIcon = '❌ Fail';
    else if (g.status === 'warned') statusIcon = '⚠️ Warn';
    else if (g.status === 'skipped') statusIcon = '⚪ Skip';

    const cleanReason = (g.reason || '').replace(/\|/g, '\\|');
    const cleanHint = (g.hint || '-').replace(/\|/g, '\\|');
    lines.push(`| ${statusIcon} | **${g.title}** | ${cleanReason} | ${cleanHint} |`);
  }

  lines.push('');
  lines.push(`### 📊 Summary`);
  lines.push(`- **Total Guards:** ${result.summary.total}`);
  lines.push(`- **Passed:** ${result.summary.passed}`);
  lines.push(`- **Failed:** ${result.summary.failed}`);
  lines.push(`- **Warnings:** ${result.summary.warned}`);
  lines.push(`- **Skipped:** ${result.summary.skipped}`);
  lines.push('');

  if (!isApproved) {
    lines.push(`> [!CAUTION]`);
    lines.push(`> **Pull Request Merge Blocked**: Please resolve the failing guardian checks listed above before requesting merge.`);
  } else {
    lines.push(`> [!NOTE]`);
    lines.push(`> **All Checks Passed**: The AI-Native workflow integrity and quality baselines are verified.`);
  }

  return lines.join('\n');
}

/**
 * 生成 CI 自动化工作流配置
 */
export function generateCiWorkflow({ provider = 'github', target, t }) {
  const normProvider = String(provider).toLowerCase();
  if (normProvider === 'gitlab') {
    const gitlabPath = path.join(target, '.gitlab-ci.yml');
    const content = `# AI-Native Zero-Trust Quality Gate
ai-gate:
  stage: test
  image: node:22-alpine
  script:
    - npx --yes agentic-flow-kit gate --strict --markdown --out gate-summary.md
  artifacts:
    paths:
      - gate-summary.md
    when: always
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
`;
    fs.writeFileSync(gitlabPath, content, 'utf8');
    return { path: gitlabPath, content, created: true };
  }

  // GitHub Actions (默认)
  const ghDir = path.join(target, '.github', 'workflows');
  fs.mkdirSync(ghDir, { recursive: true });
  const ghPath = path.join(ghDir, 'ai-gate.yml');
  const content = `name: AI-Native Zero-Trust Quality Gate

on:
  pull_request:
    branches: [main, master, develop]
  push:
    branches: [main, master]

jobs:
  ai-gate:
    name: Agentic Flow Quality Gate
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js (>=22)
        uses: actions/setup-node@v4
        with:
          node-version: '>=22'

      - name: Run AI-Native Quality Gatekeeper
        run: |
          npx --yes agentic-flow-kit gate --strict --markdown --out gate-summary.md

      - name: Attach Gate Summary to GitHub Step Summary
        if: always()
        run: |
          if [ -f gate-summary.md ]; then
            cat gate-summary.md >> $GITHUB_STEP_SUMMARY
          fi
`;
  fs.writeFileSync(ghPath, content, 'utf8');
  return { path: ghPath, content, created: true };
}
