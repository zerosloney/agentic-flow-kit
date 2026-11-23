import fs from 'node:fs';
import path from 'node:path';
import {
  generateKeyPair,
  signPayload,
  verifySignature,
  readSignatureFile,
  writeSignatureFile,
  resolvePublicKeyPath,
} from '../install/notary.mjs';
import { buildAttestation } from '../install/attest.mjs';
import { resolveTarget } from './install.mjs';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function readJsonFile(abs) {
  try {
    const text = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function keygenCommand({ args, t }) {
  const asJson = args.flags.has('json');
  const type = String(args.type || 'ed25519');
  const target = resolveTarget(args);
  const outDir = args.out ? path.resolve(args.out) : path.join(target, '.agents', 'keys');
  const name = String(args.name || 'flow-kit-key');
  const force = args.flags.has('force');

  const privPath = path.join(outDir, `${name}.pem`);
  const pubPath = path.join(outDir, `${name}.pub.pem`);

  if (!force && (fs.existsSync(privPath) || fs.existsSync(pubPath))) {
    fail('KEY_EXISTS', t('error.keyExists', { path: privPath }));
  }

  const pair = generateKeyPair(type);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(privPath, pair.privateKey, 'utf8');
  fs.writeFileSync(pubPath, pair.publicKey, 'utf8');

  const result = {
    ok: true,
    algorithm: pair.algorithm,
    privateKeyPath: privPath,
    publicKeyPath: pubPath,
    fingerprint: pair.fingerprint,
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(t('notary.keygenOk', {
      alg: pair.algorithm,
      priv: privPath,
      pub: pubPath,
      fp: pair.fingerprint,
    }));
  }

  return 0;
}

export function signCommand({ args, t }) {
  const asJson = args.flags.has('json');
  const targetType = String(args._[1] || 'attestation').toLowerCase();
  const target = resolveTarget(args);

  const keyPath = args.key ? path.resolve(args.key) : path.join(target, '.agents', 'keys', 'flow-kit-key.pem');
  if (!fs.existsSync(keyPath)) {
    fail('KEY_NOT_FOUND', t('error.keyNotFound', { path: keyPath }));
  }
  const privateKeyPem = fs.readFileSync(keyPath, 'utf8');

  let payload = null;
  let defaultSigPath = null;
  let payloadPath = null;

  if (targetType === 'attestation') {
    payloadPath = args.file ? path.resolve(args.file) : path.join(target, '.agents', 'attestation.json');
    if (fs.existsSync(payloadPath)) {
      payload = readJsonFile(payloadPath);
    }
    if (!payload) {
      payload = buildAttestation(target);
    }
    defaultSigPath = path.join(target, '.agents', 'attestation.sig');
  } else if (targetType === 'sbom') {
    payloadPath = args.file ? path.resolve(args.file) : path.join(target, '.agents', 'sbom.json');
    if (!fs.existsSync(payloadPath)) {
      fail('FILE_NOT_FOUND', t('error.sbomNotFound', { path: payloadPath }));
    }
    payload = readJsonFile(payloadPath);
    if (!payload) {
      fail('INVALID_JSON', t('error.sbomInvalid', { detail: 'Cannot parse JSON file' }));
    }
    defaultSigPath = args.file ? `${payloadPath}.sig` : path.join(target, '.agents', 'sbom.sig');
  } else {
    fail('BAD_COMMAND', t('error.notaryUsage'));
  }

  const sigOut = args.out ? path.resolve(args.out) : defaultSigPath;
  const sig = signPayload({
    payload,
    privateKeyPem,
    algorithm: args.algorithm || 'ed25519',
    target: targetType,
  });

  writeSignatureFile(sigOut, sig);

  const result = {
    ok: true,
    target: targetType,
    signatureFile: sigOut,
    algorithm: sig.algorithm,
    fingerprint: sig.publicKeyFingerprint,
    payloadDigest: sig.payloadDigest,
    signedAt: sig.signedAt,
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(t('notary.signedOk', {
      target: targetType,
      file: sigOut,
      fp: sig.publicKeyFingerprint,
    }));
  }

  return 0;
}

export function verifySigCommand({ args, t }) {
  const asJson = args.flags.has('json');
  const targetType = String(args._[1] || 'attestation').toLowerCase();
  const target = resolveTarget(args);

  // 公钥路径单源：keygen 默认优先，legacy .agents/notary/public.pem 回退（PR #77 审查跟进）
  const keyPath = args.key ? path.resolve(args.key) : resolvePublicKeyPath(target);
  if (!fs.existsSync(keyPath)) {
    fail('KEY_NOT_FOUND', t('error.keyNotFound', { path: keyPath }));
  }
  const publicKeyPem = fs.readFileSync(keyPath, 'utf8');

  let payload = null;
  let sigPath = null;
  let payloadPath = null;

  if (targetType === 'attestation') {
    payloadPath = args.file ? path.resolve(args.file) : path.join(target, '.agents', 'attestation.json');
    if (fs.existsSync(payloadPath)) {
      payload = readJsonFile(payloadPath);
    }
    if (!payload) {
      payload = buildAttestation(target);
    }
    sigPath = args.sig ? path.resolve(args.sig) : path.join(target, '.agents', 'attestation.sig');
  } else if (targetType === 'sbom') {
    payloadPath = args.file ? path.resolve(args.file) : path.join(target, '.agents', 'sbom.json');
    if (!fs.existsSync(payloadPath)) {
      fail('FILE_NOT_FOUND', t('error.sbomNotFound', { path: payloadPath }));
    }
    payload = readJsonFile(payloadPath);
    sigPath = args.sig ? path.resolve(args.sig) : (args.file ? `${payloadPath}.sig` : path.join(target, '.agents', 'sbom.sig'));
  } else {
    fail('BAD_COMMAND', t('error.notaryUsage'));
  }

  if (!fs.existsSync(sigPath)) {
    fail('SIG_NOT_FOUND', t('error.sigNotFound', { path: sigPath }));
  }

  const sigObj = readSignatureFile(sigPath);
  const verifyRes = verifySignature({
    payload,
    signatureObject: sigObj,
    publicKeyPem,
  });

  if (asJson) {
    console.log(JSON.stringify(verifyRes, null, 2));
  } else if (verifyRes.ok) {
    console.log(t('notary.verifiedOk', {
      target: targetType,
      file: sigPath,
      fp: verifyRes.fingerprint,
    }));
  } else {
    console.error(t('error.sigFailed', { detail: verifyRes.detail || verifyRes.error }));
  }

  return verifyRes.ok ? 0 : 1;
}
