import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readManifest } from '../install/manifest.mjs';
import { buildAttestation } from '../install/attest.mjs';
import { parseFrontmatter } from '../install/frontmatter.mjs';
import { readLocalModelRoles, readInjectedModels, ROLE_NAMES } from '../models/resolve.mjs';
import { readMcpServers } from '../install/mcp.mjs';
import { readToolPolicy } from '../install/tool-policy.mjs';
import { HOSTS } from '../hosts/registry.mjs';
import { resolveTarget } from './install.mjs';

export const SBOM_SCHEMA = 'flow-kit-sbom/v1';
export const CYCLONEDX_SPEC = '1.5';
export const SPDX_SPEC = 'SPDX-2.3';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

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

export function verifySbom({ target, sbomData, t }) {
  const problems = [];

  // Determine if it is native or CycloneDX/SPDX
  const isNative = sbomData.bomFormat === 'FlowKit-A-SBOM' || sbomData.$schema === SBOM_SCHEMA;

  if (isNative) {
    // 1. Check proof chain (Attestation)
    const currentAttest = buildAttestation(target);
    if (!currentAttest.ok) {
      problems.push(t('error.sbomTampered', { detail: currentAttest.problems.join('; ') }));
    } else if (sbomData.proofChain?.root && currentAttest.chain?.root !== sbomData.proofChain.root) {
      problems.push(t('error.sbomTampered', {
        detail: `Attestation root mismatch (expected ${sbomData.proofChain.root}, got ${currentAttest.chain?.root})`,
      }));
    }

    // 2. Check skills
    const currentSkills = collectSkills(target);
    const skillMap = new Map(currentSkills.map((s) => [s.name, s]));
    for (const expectedSkill of sbomData.skills || []) {
      const current = skillMap.get(expectedSkill.name);
      if (!current) {
        problems.push(t('error.sbomTampered', { detail: `Missing skill ${expectedSkill.name}` }));
      } else if (current.hash !== expectedSkill.hash) {
        problems.push(t('error.sbomTampered', { detail: `Skill modified: ${expectedSkill.name}` }));
      }
    }

    // 3. Check policy
    if (sbomData.policy) {
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
  } else if (sbomData.bomFormat === 'CycloneDX') {
    // CycloneDX verification
    for (const comp of sbomData.components || []) {
      if (comp.type === 'data' && comp.name.startsWith('ai-skill-')) {
        const skillName = comp.name.replace(/^ai-skill-/, '');
        const skillPath = path.join(target, '.agents', 'skills', skillName, 'SKILL.md');
        if (!fs.existsSync(skillPath)) {
          problems.push(t('error.sbomTampered', { detail: `Missing skill ${skillName}` }));
        } else {
          const raw = fs.readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
          const hash = sha256(Buffer.from(raw, 'utf8'));
          const expHash = comp.hashes?.find((h) => h.alg === 'SHA-256')?.content;
          if (expHash && hash !== expHash) {
            problems.push(t('error.sbomTampered', { detail: `Skill modified: ${skillName}` }));
          }
        }
      }
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

    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(t('sbom.exported', {
        file: res.file,
        format: res.format,
        count: res.componentsCount,
        root: (res.proofRoot || '').slice(0, 16),
      }));
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
    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else if (res.ok) {
      console.log(t('sbom.verified', { file: sbomAbs }));
    } else {
      console.error(res.problems.join('\n'));
    }
    return res.ok ? 0 : 1;
  }

  fail('BAD_COMMAND', t('error.sbomUsage'));
  return 2;
}
