// 密码学公证与数字签名引擎（R4-1）
// 提供基于非对称密钥（Ed25519、ECDSA P-256、RSA）的签名生成与验签，
// 为安装证明链（Attestation）和 AI 软件物料清单（A-SBOM）赋予企业级可信度。
// 零外部依赖，使用 Node.js >= 22 原生 node:crypto。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const NOTARY_SCHEMA = 'flow-kit-signature/v1';

export const ALGORITHMS = {
  ED25519: 'ed25519',
  ECDSA_P256: 'ecdsa-p256',
  RSA_SHA256: 'rsa-sha256',
};

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computePublicKeyFingerprint(publicKeyPem) {
  const norm = String(publicKeyPem || '').trim().replace(/\r\n/g, '\n');
  return `sha256:${sha256(Buffer.from(norm, 'utf8')).slice(0, 32)}`;
}

export function normalizeAlgorithm(alg) {
  const lower = String(alg || 'ed25519').toLowerCase();
  if (lower === 'p256' || lower === 'ecdsa' || lower === 'ecdsa-p256') {
    return ALGORITHMS.ECDSA_P256;
  }
  if (lower === 'rsa' || lower === 'rsa-sha256') {
    return ALGORITHMS.RSA_SHA256;
  }
  return ALGORITHMS.ED25519;
}

export function generateKeyPair(type = 'ed25519') {
  const normalized = normalizeAlgorithm(type);
  let pair;

  if (normalized === ALGORITHMS.ECDSA_P256) {
    pair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  } else if (normalized === ALGORITHMS.RSA_SHA256) {
    pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  } else {
    pair = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  }

  const fingerprint = computePublicKeyFingerprint(pair.publicKey);

  return {
    algorithm: normalized,
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    fingerprint,
  };
}

export function getPayloadDigest(payload) {
  if (payload === null || payload === undefined) {
    throw new Error('Payload cannot be null or undefined');
  }
  if (typeof payload === 'object') {
    return sha256(Buffer.from(canonical(payload), 'utf8'));
  }
  if (typeof payload === 'string') {
    return sha256(Buffer.from(payload.replace(/\r\n/g, '\n'), 'utf8'));
  }
  if (Buffer.isBuffer(payload)) {
    return sha256(payload);
  }
  return sha256(Buffer.from(String(payload), 'utf8'));
}

export function signPayload({ payload, privateKeyPem, algorithm = 'ed25519', target = 'attestation' }) {
  if (!privateKeyPem) {
    throw new Error('Missing privateKeyPem for signing');
  }

  const normalizedAlg = normalizeAlgorithm(algorithm);
  const payloadDigest = getPayloadDigest(payload);
  const signData = Buffer.from(payloadDigest, 'utf8');

  let sig;
  if (normalizedAlg === ALGORITHMS.ECDSA_P256 || normalizedAlg === ALGORITHMS.RSA_SHA256) {
    sig = crypto.sign('SHA256', signData, privateKeyPem);
  } else {
    sig = crypto.sign(null, signData, privateKeyPem);
  }

  let publicKeyFingerprint = null;
  try {
    const pub = crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' });
    publicKeyFingerprint = computePublicKeyFingerprint(pub);
  } catch {}

  return {
    schema: NOTARY_SCHEMA,
    target,
    algorithm: normalizedAlg,
    publicKeyFingerprint,
    payloadDigest,
    signedAt: new Date().toISOString(),
    signature: sig.toString('base64'),
  };
}

export function verifySignature({ payload, signatureObject, publicKeyPem }) {
  if (!signatureObject || typeof signatureObject !== 'object') {
    return { ok: false, error: 'INVALID_SIGNATURE_OBJECT', detail: 'Missing or malformed signature object' };
  }
  if (signatureObject.schema !== NOTARY_SCHEMA) {
    return { ok: false, error: 'UNKNOWN_SCHEMA', detail: `Unsupported signature schema: ${signatureObject.schema}` };
  }
  if (!publicKeyPem) {
    return { ok: false, error: 'MISSING_PUBLIC_KEY', detail: 'Public key is required to verify signature' };
  }

  const currentDigest = getPayloadDigest(payload);
  if (currentDigest !== signatureObject.payloadDigest) {
    return {
      ok: false,
      error: 'PAYLOAD_TAMPERED',
      detail: `Payload digest mismatch: expected ${signatureObject.payloadDigest}, got ${currentDigest}`,
    };
  }

  const pubFingerprint = computePublicKeyFingerprint(publicKeyPem);
  if (signatureObject.publicKeyFingerprint && signatureObject.publicKeyFingerprint !== pubFingerprint) {
    return {
      ok: false,
      error: 'FINGERPRINT_MISMATCH',
      detail: `Public key fingerprint mismatch: signature signed by ${signatureObject.publicKeyFingerprint}, provided key is ${pubFingerprint}`,
    };
  }

  const normalizedAlg = normalizeAlgorithm(signatureObject.algorithm);
  const signData = Buffer.from(signatureObject.payloadDigest, 'utf8');
  const sigBuffer = Buffer.from(signatureObject.signature, 'base64');

  let verified = false;
  try {
    if (normalizedAlg === ALGORITHMS.ECDSA_P256 || normalizedAlg === ALGORITHMS.RSA_SHA256) {
      verified = crypto.verify('SHA256', signData, publicKeyPem, sigBuffer);
    } else {
      verified = crypto.verify(null, signData, publicKeyPem, sigBuffer);
    }
  } catch (err) {
    return { ok: false, error: 'VERIFY_ERROR', detail: err.message };
  }

  if (!verified) {
    return { ok: false, error: 'SIGNATURE_INVALID', detail: 'Cryptographic signature verification failed' };
  }

  return {
    ok: true,
    target: signatureObject.target,
    algorithm: normalizedAlg,
    signedAt: signatureObject.signedAt,
    fingerprint: pubFingerprint,
  };
}

export function readSignatureFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function writeSignatureFile(filePath, signatureObject) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(signatureObject, null, 2) + '\n', 'utf8');
}
