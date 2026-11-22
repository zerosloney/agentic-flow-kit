// 多智能体接力协同契约与上下文防污染协议引擎（R4-2）
// 定义结构化跨角色交接信封（flow-kit-handoff/v1），
// 提供工件指纹锁定、上下文防污染/敏感凭据扫描、密码学公证联动以及防篡改核验。
// 零外部依赖，使用 Node.js >= 22 原生 node:crypto、node:fs、node:path。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { signPayload, verifySignature } from './notary.mjs';

export const HANDOFF_SCHEMA = 'flow-kit-handoff/v1';

// 敏感凭证与污染检测规则集
const SECRET_PATTERNS = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private Key Block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: 'Generic API Key', regex: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'Bearer Token', regex: /bearer\s+[A-Za-z0-9._~+/-]{24,}/i },
];

const SUSPICIOUS_DIRECTIVES = [
  { name: 'Instruction Override', regex: /ignore\s+(all\s+)?previous\s+instructions/i },
  { name: 'Gate Bypass', regex: /bypass\s+(all\s+)?(review|gates|checks)/i },
  { name: 'System Prompt Injection', regex: /<\|system\|>|<system_prompt>|<\/user_guidance>/i },
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function scanTaint(content) {
  const text = String(content || '');
  const findings = [];

  for (const { name, regex } of SECRET_PATTERNS) {
    if (regex.test(text)) {
      findings.push({ type: 'SECRET_LEAK', name });
    }
  }

  for (const { name, regex } of SUSPICIOUS_DIRECTIVES) {
    if (regex.test(text)) {
      findings.push({ type: 'SUSPICIOUS_DIRECTIVE', name });
    }
  }

  return {
    clean: findings.length === 0,
    findings,
  };
}

export function computeArtifactHash(target, relPath) {
  const abs = path.resolve(target, relPath);
  if (!fs.existsSync(abs)) {
    return null;
  }
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    return null;
  }
  const content = fs.readFileSync(abs);
  return {
    path: relPath.replace(/\\/g, '/'),
    size: stat.size,
    hash: `sha256:${sha256(content)}`,
  };
}

export function generateHandoffId() {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(3).toString('hex');
  return `handoff-${ts}-${rand}`;
}

export function createHandoffEnvelope({
  target,
  fromRole,
  toRole,
  task = 'general',
  summary = '',
  artifacts = [],
  assumptions = [],
  verifications = [],
  signWithKey = null,
  algorithm = 'ed25519',
}) {
  if (!fromRole || !toRole) {
    throw new Error('Handoff requires both fromRole and toRole');
  }
  if (fromRole.toLowerCase() === toRole.toLowerCase()) {
    throw new Error('fromRole and toRole cannot be identical');
  }

  const id = generateHandoffId();
  const createdAt = new Date().toISOString();

  // 1. 扫描元数据与假设防污染
  const summaryTaint = scanTaint(summary);
  const assumptionsTaint = scanTaint(assumptions.join('\n'));
  const allFindings = [...summaryTaint.findings, ...assumptionsTaint.findings];

  // 2. 收集与校验工件
  const artifactEntries = [];
  for (const rel of artifacts) {
    const normRel = String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
    if (normRel.startsWith('.env') || normRel.includes('/.env')) {
      allFindings.push({ type: 'SECRET_FILE', name: normRel });
    }
    const info = computeArtifactHash(target, normRel);
    if (!info) {
      throw new Error(`Artifact not found or invalid: ${normRel}`);
    }

    // 检查文本工件内容中的凭证泄漏
    try {
      const textSample = fs.readFileSync(path.resolve(target, normRel), 'utf8');
      const artTaint = scanTaint(textSample);
      for (const f of artTaint.findings) {
        if (f.type === 'SECRET_LEAK') {
          allFindings.push({ type: 'ARTIFACT_SECRET', name: `${normRel} contains ${f.name}` });
        }
      }
    } catch {}

    artifactEntries.push(info);
  }

  if (allFindings.some((f) => f.type === 'SECRET_LEAK' || f.type === 'SECRET_FILE' || f.type === 'ARTIFACT_SECRET')) {
    const details = allFindings.map((f) => `${f.type}: ${f.name}`).join('; ');
    const err = new Error(`Context contamination detected: ${details}`);
    err.code = 'CONTEXT_TAINTED';
    err.findings = allFindings;
    throw err;
  }

  const envelope = {
    schema: HANDOFF_SCHEMA,
    id,
    createdAt,
    fromRole: String(fromRole).toLowerCase(),
    toRole: String(toRole).toLowerCase(),
    task: String(task),
    summary: String(summary),
    artifacts: artifactEntries,
    assumptions: Array.isArray(assumptions) ? assumptions.map(String) : [],
    verifications: Array.isArray(verifications) ? verifications : [],
    contextIsolation: {
      clean: allFindings.length === 0,
      warnings: allFindings.map((f) => `${f.type}: ${f.name}`),
    },
    signature: null,
  };

  // 3. 可选密码学公证签名
  if (signWithKey) {
    const envelopeToSign = { ...envelope };
    delete envelopeToSign.signature;
    const sig = signPayload({
      payload: envelopeToSign,
      privateKeyPem: signWithKey,
      algorithm,
      target: 'handoff',
    });
    envelope.signature = sig;
  }

  return envelope;
}

export function verifyHandoffEnvelope({
  target,
  envelope,
  publicKeyPem = null,
  allowedRoles = null,
}) {
  const problems = [];

  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, problems: ['Envelope is missing or not an object'] };
  }
  if (envelope.schema !== HANDOFF_SCHEMA) {
    return { ok: false, problems: [`Unsupported handoff schema: ${envelope.schema}`] };
  }

  // 角色合法性核验
  if (allowedRoles && Array.isArray(allowedRoles)) {
    if (!allowedRoles.includes(envelope.fromRole)) {
      problems.push(`fromRole '${envelope.fromRole}' is not an authorized role`);
    }
    if (!allowedRoles.includes(envelope.toRole)) {
      problems.push(`toRole '${envelope.toRole}' is not an authorized role`);
    }
  }

  // 工件完整性与篡改核验
  for (const art of envelope.artifacts || []) {
    const current = computeArtifactHash(target, art.path);
    if (!current) {
      problems.push(`Missing artifact: ${art.path}`);
    } else if (current.hash !== art.hash) {
      problems.push(`Artifact modified: ${art.path} (expected ${art.hash.slice(0, 16)}, got ${current.hash.slice(0, 16)})`);
    }
  }

  // 防污染重新复核
  const taint = scanTaint(envelope.summary + '\n' + (envelope.assumptions || []).join('\n'));
  if (!taint.clean) {
    for (const f of taint.findings) {
      problems.push(`Context taint: ${f.type} (${f.name})`);
    }
  }

  // 密码学公证验签（如果信封包含签名且提供了公钥）
  let signatureVerified = null;
  if (envelope.signature) {
    if (!publicKeyPem) {
      problems.push('Envelope is signed, but no public key was provided for verification');
    } else {
      const envelopeToVerify = { ...envelope };
      delete envelopeToVerify.signature;
      const sigRes = verifySignature({
        payload: envelopeToVerify,
        signatureObject: envelope.signature,
        publicKeyPem,
      });
      if (!sigRes.ok) {
        problems.push(`Cryptographic signature invalid: ${sigRes.detail || sigRes.error}`);
      } else {
        signatureVerified = {
          algorithm: sigRes.algorithm,
          fingerprint: sigRes.fingerprint,
        };
      }
    }
  }

  return {
    ok: problems.length === 0,
    id: envelope.id,
    fromRole: envelope.fromRole,
    toRole: envelope.toRole,
    task: envelope.task,
    artifactsCount: (envelope.artifacts || []).length,
    signatureVerified,
    problems,
  };
}

export function readHandoffFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function writeHandoffFile(filePath, envelope) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  return path.resolve(filePath);
}

export function listHandoffFiles(target) {
  const dir = path.join(target, '.agents', 'handoffs');
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith('.json')) {
      const abs = path.join(dir, ent.name);
      const envelope = readHandoffFile(abs);
      if (envelope && envelope.schema === HANDOFF_SCHEMA) {
        files.push({
          file: abs,
          name: ent.name,
          envelope,
        });
      }
    }
  }
  return files.sort((a, b) => (b.envelope?.createdAt || '').localeCompare(a.envelope?.createdAt || ''));
}
