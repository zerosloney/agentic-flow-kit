import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readManifest } from '../install/manifest.mjs';
import { buildAttestation } from '../install/attest.mjs';
import { parseFrontmatter } from '../install/frontmatter.mjs';
import { readLocalModelRoles, readInjectedModels, ROLE_NAMES } from '../models/resolve.mjs';
import { readMcpServers } from '../install/mcp.mjs';
import { readToolPolicy } from '../install/tool-policy.mjs';
import { resolveInside } from '../install/path-guard.mjs';
import { HOSTS } from '../hosts/registry.mjs';
import { resolveTarget } from './install.mjs';
import { signPayload, verifySignature, readSignatureFile, writeSignatureFile, canonical, sha256 } from '../install/notary.mjs';

export const SBOM_SCHEMA = 'flow-kit-sbom/v1';

export const CYCLONEDX_SPEC = '1.5';
export const SPDX_SPEC = 'SPDX-2.3';

function readText(abs) {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}

function readJson(abs) {
  try {
    const text = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readJsonl(abs) {
  const rows = [];
  for (const line of readText(abs).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {}
  }
  return rows;
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

export function collectSkills(target) {
  const skillsDir = path.join(target, '.agents', 'skills');
  const skills = [];
  if (!fs.existsSync(skillsDir)) return skills;

  for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const rel = `.agents/skills/${ent.name}/SKILL.md`;
    const abs = path.join(target, rel);
    if (!fs.existsSync(abs)) continue;

    const raw = fs.readFileSync(abs);
    const text = raw.toString('utf8').replace(/\r\n/g, '\n');
    const fm = parseFrontmatter(text);
    skills.push({
      name: fm.name || ent.name,
      description: fm.description || ent.name,
      path: rel,
      hash: sha256(Buffer.from(text, 'utf8')),
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function collectTelemetry(target, days = 30) {
  const since = Date.now() - days * 86400000;

  // 1. Verifications
  const verRows = readJsonl(path.join(target, '.agents', 'verifications.jsonl'));
  const recentVers = verRows.filter((r) => {
    const t = Date.parse(r.ts);
    return Number.isFinite(t) && t >= since;
  });
  const totalVers = recentVers.length;
  const passedVers = recentVers.filter((r) => r.ok || r.status === 'ok').length;
  const verificationPassRate = totalVers ? Math.round((passedVers / totalVers) * 1000) / 10 : null;

  // 2. Confirmations
  const confRows = readJsonl(path.join(target, '.agents', 'confirmations.jsonl'));
  const recentConfs = confRows.filter((r) => {
    const t = Date.parse(r.ts);
    return Number.isFinite(t) && t >= since;
  });

  // 3. Evals
  const evalRows = readJsonl(path.join(target, '.agents', 'evals', 'results.jsonl'));
  const totalEvals = evalRows.length;
  const passedEvals = evalRows.filter((r) => r.ok || r.pass || r.status === 'pass').length;
  const evalPassRate = totalEvals ? Math.round((passedEvals / totalEvals) * 1000) / 10 : null;

  return {
    windowDays: days,
    verifications: {
      total: totalVers,
      passed: passedVers,
      passRate: verificationPassRate,
    },
    confirmations: {
      total: recentConfs.length,
    },
    evals: {
      total: totalEvals,
      passed: passedEvals,
      passRate: evalPassRate,
    },
  };
}

export function buildNativeSbom({ target, manifest, days = 30 }) {
  const projectName = manifest?.projectName || path.basename(target);
  const kitVersion = manifest?.version || manifest?.kitVersion || 'unknown';
  const hosts = [...(manifest?.hosts || [])].sort().map((hName) => {
    const reg = HOSTS[hName];
    return {
      name: hName,
      dir: reg?.dir || null,
      hardeningLevel: reg?.hardening?.level || 'standard',
      hooksFile: reg?.hooks?.file || null,
      permissionsFile: reg?.permissions?.file || null,
      mcpFile: reg?.mcp?.file || null,
      mcpFormat: reg?.mcp?.format || null,
    };
  });

  const skills = collectSkills(target);

  // Models
  const localModels = readLocalModelRoles(target);
  const injectedModels = readInjectedModels({ target, hosts: manifest?.hosts || [] });
  const modelRoles = {};
  if (localModels.exists && localModels.roles) {
    for (const role of ROLE_NAMES) {
      const val = localModels.roles[role];
      if (val) {
        modelRoles[role] = typeof val === 'string' ? val : val.model || null;
      }
    }
  }

  // MCP
  const mcpServers = readMcpServers(target);
  let toolPolicy = null;
  try {
    const pol = readToolPolicy(target);
    toolPolicy = pol.servers || null;
  } catch {}

  // Policy
  const policyFile = path.join(target, '.agents', 'config', 'policy.json');
  const policyObj = readJson(policyFile);
  const policy = policyObj
    ? {
        version: policyObj.version ?? 1,
        remote: policyObj.remote || null,
        enforce: policyObj.enforce || [],
        digest: sha256(canonical(policyObj)),
      }
    : null;

  // Proof Chain (Attestation)
  const attestation = buildAttestation(target);
  const proofChain = {
    valid: attestation.ok,
    root: attestation.chain?.root || null,
    manifestDigest: attestation.manifest?.digest || null,
    policyDigest: attestation.policy?.digest || null,
    problems: attestation.problems || [],
  };

  const telemetry = collectTelemetry(target, days);

  const createdAt = new Date().toISOString();
  const components = {
    metadata: {
      projectName,
      kitVersion,
      createdAt,
      language: manifest?.language || 'zh-CN',
      stack: manifest?.stack || null,
      stacks: manifest?.stacks || (manifest?.stack ? [manifest.stack] : []),
      surfaces: manifest?.surfaces || [],
      tier: manifest?.tier || 'standard',
      hardened: Boolean(manifest?.hardened),
      installedAt: manifest?.installedAt || null,
      bundle: manifest?.bundle || null,
    },
    hosts,
    skills,
    models: {
      roles: modelRoles,
      injected: injectedModels,
    },
    mcp: {
      servers: Object.keys(mcpServers).sort(),
      toolPolicy,
    },
    policy,
    proofChain,
    telemetry,
  };

  const digest = sha256(canonical(components));

  return {
    $schema: SBOM_SCHEMA,
    schema: SBOM_SCHEMA,
    format: 'native',
    bomFormat: 'FlowKit-A-SBOM',
    version: 1,
    kitVersion,
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    createdAt,
    ...components,
    digest,
  };
}

export function toCycloneDx(native) {
  const components = [
    {
      type: 'framework',
      name: 'agentic-flow-kit',
      version: native.metadata.kitVersion,
      description: 'AI-Native SDLC Workflow Engine & Governance Plane',
      hashes: native.proofChain.manifestDigest
        ? [{ alg: 'SHA-256', content: native.proofChain.manifestDigest }]
        : [],
    },
  ];

  for (const host of native.hosts) {
    components.push({
      type: 'platform',
      name: `ai-host-${host.name}`,
      version: native.metadata.kitVersion,
      properties: [
        { name: 'flow-kit:host:dir', value: host.dir || '' },
        { name: 'flow-kit:host:hardeningLevel', value: host.hardeningLevel },
      ],
    });
  }

  for (const skill of native.skills) {
    components.push({
      type: 'data',
      name: `ai-skill-${skill.name}`,
      description: skill.description,
      hashes: [{ alg: 'SHA-256', content: skill.hash }],
      properties: [
        { name: 'flow-kit:skill:path', value: skill.path },
      ],
    });
  }

  for (const [role, modelName] of Object.entries(native.models.roles)) {
    if (modelName) {
      components.push({
        type: 'machine-learning-model',
        name: `ai-model-${role}`,
        version: String(modelName),
      });
    }
  }

  if (native.policy) {
    components.push({
      type: 'policy',
      name: 'agent-governance-policy',
      version: String(native.policy.version),
      hashes: [{ alg: 'SHA-256', content: native.policy.digest }],
    });
  }

  return {
    bomFormat: 'CycloneDX',
    specVersion: CYCLONEDX_SPEC,
    serialNumber: native.serialNumber,
    version: 1,
    metadata: {
      timestamp: native.createdAt,
      tools: [
        {
          vendor: 'agentic-flow-kit',
          name: 'flow-kit',
          version: native.metadata.kitVersion,
        },
      ],
      component: {
        type: 'application',
        name: native.metadata.projectName,
        version: '1.0.0',
        properties: [
          { name: 'flow-kit:tier', value: native.metadata.tier },
          { name: 'flow-kit:hardened', value: String(native.metadata.hardened) },
          { name: 'flow-kit:proofRoot', value: native.proofChain.root || '' },
        ],
      },
    },
    properties: [
      { name: 'flow-kit:proofChainRoot', value: native.proofChain.root || '' },
      { name: 'flow-kit:policyDigest', value: native.proofChain.policyDigest || '' },
    ],
    components,
  };
}

export function toSpdx(native) {
  const packages = [
    {
      SPDXID: 'SPDXRef-Package-agentic-flow-kit',
      name: 'agentic-flow-kit',
      versionInfo: native.metadata.kitVersion,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      checksums: native.proofChain.manifestDigest
        ? [{ algorithm: 'SHA256', checksumValue: native.proofChain.manifestDigest }]
        : [],
    },
  ];

  const relationships = [
    {
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: 'SPDXRef-Package-agentic-flow-kit',
    },
  ];

  let idx = 1;
  for (const skill of native.skills) {
    const spdxId = `SPDXRef-Skill-${idx += 1}`;
    packages.push({
      SPDXID: spdxId,
      name: `ai-skill-${skill.name}`,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      summary: skill.description,
      checksums: [{ algorithm: 'SHA256', checksumValue: skill.hash }],
    });
    relationships.push({
      spdxElementId: 'SPDXRef-Package-agentic-flow-kit',
      relationshipType: 'CONTAINS',
      relatedSpdxElement: spdxId,
    });
  }

  return {
    spdxVersion: SPDX_SPEC,
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${native.metadata.projectName}-A-SBOM`,
    documentNamespace: `https://spdx.org/spdxdocs/${native.metadata.projectName}-${native.serialNumber}`,
    creationInfo: {
      creators: [`Tool: agentic-flow-kit-${native.metadata.kitVersion}`],
      created: native.createdAt,
    },
    packages,
    relationships,
  };
}

export function exportSbom({ target, out, format = 'native', days = 30, t }) {
  const manifest = readManifest(target);
  if (!manifest) {
    fail('NO_MANIFEST', t('error.noManifest'));
  }

  const native = buildNativeSbom({ target, manifest, days });
  let formattedData = native;
  if (format === 'cyclonedx') {
    formattedData = toCycloneDx(native);
  } else if (format === 'spdx') {
    formattedData = toSpdx(native);
  }

  const outFile = out || path.join(target, '.agents', 'sbom.json');
  const outAbs = path.resolve(outFile);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, `${JSON.stringify(formattedData, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    file: outAbs,
    format,
    digest: native.digest,
    componentsCount: 1 + native.hosts.length + native.skills.length + Object.keys(native.models.roles).length + (native.policy ? 1 : 0),
    proofRoot: native.proofChain.root,
    data: formattedData,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function detectSbomFormat(sbomData) {
  if (!isPlainObject(sbomData)) return null;
  if (sbomData.bomFormat === 'FlowKit-A-SBOM' || sbomData.$schema === SBOM_SCHEMA) return 'native';
  if (sbomData.bomFormat === 'CycloneDX') return 'cyclonedx';
  if (typeof sbomData.spdxVersion === 'string' && sbomData.spdxVersion.startsWith('SPDX-')) return 'spdx';
  return null;
}

function checkSkillHash({ target, skillName, expectedHash, problems, t }) {
  const skillPath = resolveInside(target, path.join('.agents', 'skills', skillName, 'SKILL.md'));
  if (!skillPath) {
    problems.push(t('error.sbomInvalid', { detail: `Skill path escapes project: ${skillName}` }));
    return;
  }
  if (!fs.existsSync(skillPath)) {
    problems.push(t('error.sbomTampered', { detail: `Missing skill ${skillName}` }));
    return;
  }
  const raw = fs.readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
  const hash = sha256(Buffer.from(raw, 'utf8'));
  if (hash !== expectedHash) {
    problems.push(t('error.sbomTampered', { detail: `Skill modified: ${skillName}` }));
  }
}

export function verifySbom({ target, sbomData, t }) {
  const problems = [];
  const format = detectSbomFormat(sbomData);

  if (!format) {
    problems.push(t('error.sbomInvalid', {
      detail: 'Unrecognized SBOM format (expected FlowKit-A-SBOM, CycloneDX, or SPDX)',
    }));
    return {
      ok: false,
      problems,
      summary: {
        verifiedAt: new Date().toISOString(),
        issuesCount: problems.length,
      },
    };
  }

  if (format === 'native') {
    // 1. Check proof chain (Attestation)
    let expectedRoot = null;
    if (!isPlainObject(sbomData.proofChain)) {
      problems.push(t('error.sbomInvalid', { detail: 'Missing proof chain section' }));
    } else if (typeof sbomData.proofChain.root !== 'string' || !sbomData.proofChain.root) {
      problems.push(t('error.sbomInvalid', { detail: 'Missing proof chain root' }));
    } else {
      expectedRoot = sbomData.proofChain.root;
    }

    const currentAttest = buildAttestation(target);
    if (!currentAttest.ok) {
      problems.push(t('error.sbomTampered', { detail: currentAttest.problems.join('; ') }));
    } else if (expectedRoot && currentAttest.chain?.root !== expectedRoot) {
      problems.push(t('error.sbomTampered', {
        detail: `Attestation root mismatch (expected ${expectedRoot}, got ${currentAttest.chain?.root})`,
      }));
    }

    // 2. Check skills
    if (!Array.isArray(sbomData.skills)) {
      problems.push(t('error.sbomInvalid', { detail: 'Missing skills section' }));
    } else {
      const currentSkills = collectSkills(target);
      const skillMap = new Map(currentSkills.map((s) => [s.name, s]));
      for (const expectedSkill of sbomData.skills) {
        if (!isPlainObject(expectedSkill) || typeof expectedSkill.name !== 'string') {
          problems.push(t('error.sbomInvalid', { detail: 'Malformed skill entry in skills section' }));
          continue;
        }
        const current = skillMap.get(expectedSkill.name);
        if (!current) {
          problems.push(t('error.sbomTampered', { detail: `Missing skill ${expectedSkill.name}` }));
        } else if (current.hash !== expectedSkill.hash) {
          problems.push(t('error.sbomTampered', { detail: `Skill modified: ${expectedSkill.name}` }));
        }
      }
    }

    // 3. Check policy
    if (!Object.prototype.hasOwnProperty.call(sbomData, 'policy')) {
      problems.push(t('error.sbomInvalid', { detail: 'Missing policy section' }));
    } else if (sbomData.policy !== null) {
      if (!isPlainObject(sbomData.policy) || typeof sbomData.policy.digest !== 'string') {
        problems.push(t('error.sbomInvalid', { detail: 'Malformed policy section' }));
      } else {
        const policyFile = path.join(target, '.agents', 'config', 'policy.json');
        const policyObj = readJson(policyFile);
        if (!policyObj) {
          problems.push(t('error.sbomTampered', { detail: 'Missing policy file .agents/config/policy.json' }));
        } else {
          const curDigest = sha256(canonical(policyObj));
          if (curDigest !== sbomData.policy.digest) {
            problems.push(t('error.sbomTampered', { detail: 'Policy configuration modified' }));
          }
        }
      }
    }
  } else if (format === 'cyclonedx') {
    if (typeof sbomData.specVersion !== 'string') {
      problems.push(t('error.sbomInvalid', { detail: 'CycloneDX document is missing specVersion' }));
    }
    if (!Array.isArray(sbomData.components)) {
      problems.push(t('error.sbomInvalid', { detail: 'CycloneDX document is missing its components section' }));
    } else {
      sbomData.components.forEach((comp, index) => {
        if (!isPlainObject(comp)) {
          problems.push(t('error.sbomInvalid', { detail: `Malformed CycloneDX component at index ${index}` }));
          return;
        }
        if (comp.type !== 'data') return;
        if (typeof comp.name !== 'string') {
          problems.push(t('error.sbomInvalid', { detail: `Malformed CycloneDX component at index ${index}: name is not a string` }));
          return;
        }
        if (!comp.name.startsWith('ai-skill-')) return;

        const skillName = comp.name.replace(/^ai-skill-/, '');
        if (comp.hashes !== undefined && !Array.isArray(comp.hashes)) {
          problems.push(t('error.sbomInvalid', { detail: `Malformed CycloneDX component ${comp.name}: hashes is not a list` }));
          return;
        }
        const expectedHash = (comp.hashes || [])
          .find((h) => isPlainObject(h) && h.alg === 'SHA-256')?.content;
        if (typeof expectedHash !== 'string') {
          problems.push(t('error.sbomInvalid', { detail: `Skill ${skillName} has no SHA-256 hash` }));
          return;
        }
        checkSkillHash({ target, skillName, expectedHash, problems, t });
      });
    }
  } else {
    // SPDX
    if (!Array.isArray(sbomData.packages)) {
      problems.push(t('error.sbomInvalid', { detail: 'SPDX document is missing its packages section' }));
    } else {
      sbomData.packages.forEach((pkg, index) => {
        if (!isPlainObject(pkg)) {
          problems.push(t('error.sbomInvalid', { detail: `Malformed SPDX package at index ${index}` }));
          return;
        }
        if (typeof pkg.name !== 'string') {
          problems.push(t('error.sbomInvalid', { detail: `Malformed SPDX package at index ${index}: name is not a string` }));
          return;
        }
        if (!pkg.name.startsWith('ai-skill-')) return;

        const skillName = pkg.name.replace(/^ai-skill-/, '');
        if (pkg.checksums !== undefined && !Array.isArray(pkg.checksums)) {
          problems.push(t('error.sbomInvalid', { detail: `Malformed SPDX package ${pkg.name}: checksums is not a list` }));
          return;
        }
        const expectedHash = (pkg.checksums || [])
          .find((c) => isPlainObject(c) && c.algorithm === 'SHA256')?.checksumValue;
        if (typeof expectedHash !== 'string') {
          problems.push(t('error.sbomInvalid', { detail: `Skill ${skillName} has no SHA256 checksum` }));
          return;
        }
        checkSkillHash({ target, skillName, expectedHash, problems, t });
      });
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    summary: {
      verifiedAt: new Date().toISOString(),
      issuesCount: problems.length,
    },
  };
}

export function sbomCommand({ args, t }) {
  const asJson = args.flags.has('json');
  const sub = args._[1] || 'export';
  const target = resolveTarget(args);

  if (sub === 'export') {
    const out = args.out || args._[2] || null;
    const format = String(args.format || 'native').toLowerCase();
    const days = Number(args.days || 30);
    const res = exportSbom({ target, out, format, days, t });

    if (args.sign || args.flags.has('sign')) {
      const keyPath = args.key ? path.resolve(args.key) : path.join(target, '.agents', 'keys', 'flow-kit-key.pem');
      if (!fs.existsSync(keyPath)) {
        fail('KEY_NOT_FOUND', t('error.keyNotFound', { path: keyPath }));
      }
      const privKey = fs.readFileSync(keyPath, 'utf8');
      const sbomContent = readJson(res.file);
      const sig = signPayload({
        payload: sbomContent,
        privateKeyPem: privKey,
        algorithm: args.algorithm || 'ed25519',
        target: 'sbom',
      });
      const sigFile = args.sig ? path.resolve(args.sig) : `${res.file}.sig`;
      writeSignatureFile(sigFile, sig);
      res.signatureFile = sigFile;
      res.fingerprint = sig.publicKeyFingerprint;
    }

    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(t('sbom.exported', {
        file: res.file,
        format: res.format,
        count: res.componentsCount,
        root: (res.proofRoot || '').slice(0, 16),
      }));
      if (res.signatureFile) {
        console.log(t('notary.signedOk', {
          target: 'sbom',
          file: res.signatureFile,
          fp: res.fingerprint,
        }));
      }
    }
    return 0;
  }

  if (sub === 'verify') {
    const sbomFile = args.sbom || args._[2];
    if (!sbomFile) {
      fail('MISSING_ARG', t('error.sbomUsage'));
    }
    const sbomAbs = path.resolve(sbomFile);
    if (!fs.existsSync(sbomAbs)) {
      fail('SBOM_NOT_FOUND', t('error.sbomNotFound', { path: sbomAbs }));
    }

    const sbomData = readJson(sbomAbs);
    if (!sbomData) {
      fail('INVALID_SBOM', t('error.sbomInvalid', { detail: 'Cannot parse JSON' }));
    }

    const res = verifySbom({ target, sbomData, t });

    if (args.key) {
      const pubKeyPath = path.resolve(args.key);
      if (!fs.existsSync(pubKeyPath)) {
        fail('KEY_NOT_FOUND', t('error.keyNotFound', { path: pubKeyPath }));
      }
      const pubKey = fs.readFileSync(pubKeyPath, 'utf8');
      const sigPath = args.sig ? path.resolve(args.sig) : `${sbomAbs}.sig`;
      if (!fs.existsSync(sigPath)) {
        res.ok = false;
        res.problems.push(t('error.sigNotFound', { path: sigPath }));
      } else {
        const sigObj = readSignatureFile(sigPath);
        const sigVerify = verifySignature({ payload: sbomData, signatureObject: sigObj, publicKeyPem: pubKey });
        if (!sigVerify.ok) {
          res.ok = false;
          res.problems.push(t('error.sigFailed', { detail: sigVerify.detail || sigVerify.error }));
        } else {
          res.signature = {
            ok: true,
            fingerprint: sigVerify.fingerprint,
            algorithm: sigVerify.algorithm,
          };
        }
      }
    }

    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else if (res.ok) {
      console.log(t('sbom.verified', { file: sbomAbs }));
      if (res.signature) {
        console.log(t('notary.verifiedOk', {
          target: 'sbom',
          file: args.sig ? path.resolve(args.sig) : `${sbomAbs}.sig`,
          fp: res.signature.fingerprint,
        }));
      }
    } else {
      console.error(res.problems.join('\n'));
    }
    return res.ok ? 0 : 1;
  }

  fail('BAD_COMMAND', t('error.sbomUsage'));
  return 2;
}
