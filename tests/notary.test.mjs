import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import {
  generateKeyPair,
  computePublicKeyFingerprint,
  signPayload,
  verifySignature,
  readSignatureFile,
  writeSignatureFile,
  resolvePublicKeyPath,
  ALGORITHMS,
} from '../src/install/notary.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function run(args, cwd = process.cwd(), env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1', ...env },
  });
}

function initRepo() {
  const dir = makeTmp('notary-test-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

test('resolvePublicKeyPath prefers default path and falls back to legacy', () => {
  const defaultPath = (dir) => path.join(dir, '.agents', 'keys', 'flow-kit-key.pub.pem');
  const legacyPath = (dir) => path.join(dir, '.agents', 'notary', 'public.pem');

  // 1. 仅默认路径存在 → 返回默认
  const withDefault = makeTmp('notary-resolve-default-');
  fs.mkdirSync(path.dirname(defaultPath(withDefault)), { recursive: true });
  fs.writeFileSync(defaultPath(withDefault), 'PUBLIC', 'utf8');
  assert.equal(resolvePublicKeyPath(withDefault), defaultPath(withDefault));

  // 2. 仅 legacy 存在 → 返回 legacy
  const withLegacy = makeTmp('notary-resolve-legacy-');
  fs.mkdirSync(path.dirname(legacyPath(withLegacy)), { recursive: true });
  fs.writeFileSync(legacyPath(withLegacy), 'PUBLIC', 'utf8');
  assert.equal(resolvePublicKeyPath(withLegacy), legacyPath(withLegacy));

  // 3. 都不存在 → 返回默认路径字符串（尚不存在）
  const empty = makeTmp('notary-resolve-empty-');
  assert.equal(resolvePublicKeyPath(empty), defaultPath(empty));
  assert.equal(fs.existsSync(resolvePublicKeyPath(empty)), false);
});

test('generateKeyPair supports Ed25519, P-256, and RSA-SHA256 with consistent fingerprints', () => {
  for (const alg of ['ed25519', 'p256', 'rsa']) {
    const pair = generateKeyPair(alg);
    assert.ok(pair.publicKey.includes('BEGIN PUBLIC KEY'));
    assert.ok(pair.privateKey.includes('BEGIN PRIVATE KEY'));
    assert.match(pair.fingerprint, /^sha256:[a-f0-9]{32}$/);

    const recomputedFp = computePublicKeyFingerprint(pair.publicKey);
    assert.equal(recomputedFp, pair.fingerprint);
  }
});

test('signPayload and verifySignature work across all supported algorithms', () => {
  const payload = {
    project: 'test-app',
    version: '1.0.0',
    meta: { active: true, count: 42 },
  };

  for (const alg of ['ed25519', 'p256', 'rsa']) {
    const pair = generateKeyPair(alg);
    const sig = signPayload({
      payload,
      privateKeyPem: pair.privateKey,
      algorithm: alg,
      target: 'attestation',
    });

    assert.equal(sig.schema, 'flow-kit-signature/v1');
    assert.equal(sig.target, 'attestation');
    assert.equal(sig.publicKeyFingerprint, pair.fingerprint);
    assert.ok(sig.payloadDigest);
    assert.ok(sig.signature);

    const verifyOk = verifySignature({
      payload,
      signatureObject: sig,
      publicKeyPem: pair.publicKey,
    });
    assert.equal(verifyOk.ok, true);
    assert.equal(verifyOk.fingerprint, pair.fingerprint);
  }
});

test('verifySignature detects tampering, wrong keys, and invalid signature structures', () => {
  const pair1 = generateKeyPair('ed25519');
  const pair2 = generateKeyPair('ed25519');
  const payload = { hello: 'world' };

  const sig = signPayload({
    payload,
    privateKeyPem: pair1.privateKey,
    algorithm: 'ed25519',
  });

  // Tampered payload
  const tamperedPayload = { hello: 'world-tampered' };
  const resTampered = verifySignature({
    payload: tamperedPayload,
    signatureObject: sig,
    publicKeyPem: pair1.publicKey,
  });
  assert.equal(resTampered.ok, false);
  assert.equal(resTampered.error, 'PAYLOAD_TAMPERED');

  // Mismatched public key
  const resWrongKey = verifySignature({
    payload,
    signatureObject: sig,
    publicKeyPem: pair2.publicKey,
  });
  assert.equal(resWrongKey.ok, false);
  assert.equal(resWrongKey.error, 'FINGERPRINT_MISMATCH');

  // Signature data corrupted
  const corruptedSig = { ...sig, signature: Buffer.from('invalid-sig').toString('base64') };
  const resCorrupted = verifySignature({
    payload,
    signatureObject: corruptedSig,
    publicKeyPem: pair1.publicKey,
  });
  assert.equal(resCorrupted.ok, false);
  assert.equal(resCorrupted.error, 'SIGNATURE_INVALID');

  // Missing public key
  const resNoKey = verifySignature({
    payload,
    signatureObject: sig,
    publicKeyPem: null,
  });
  assert.equal(resNoKey.ok, false);
  assert.equal(resNoKey.error, 'MISSING_PUBLIC_KEY');
});

test('CLI keygen generates keypair in default and custom directories', () => {
  const dir = initRepo();

  // 1. Default generation in .agents/keys/
  const res1 = run(['keygen', '--type', 'ed25519', '--target', dir, '--json'], dir);
  assert.equal(res1.status, 0, res1.stderr);
  const data1 = JSON.parse(res1.stdout);
  assert.equal(data1.ok, true);
  assert.equal(data1.algorithm, 'ed25519');
  assert.ok(fs.existsSync(data1.privateKeyPath));
  assert.ok(fs.existsSync(data1.publicKeyPath));

  // 2. Prevent accidental overwrite without --force
  const res2 = run(['keygen', '--target', dir], dir);
  assert.notEqual(res2.status, 0);

  // 3. Overwrite with --force
  const res3 = run(['keygen', '--target', dir, '--force', '--json'], dir);
  assert.equal(res3.status, 0, res3.stderr);

  // 4. Custom directory and name
  const customDir = path.join(dir, 'my-keys');
  const res4 = run(['keygen', '--out', customDir, '--name', 'prod-notary', '--type', 'p256', '--json'], dir);
  assert.equal(res4.status, 0, res4.stderr);
  assert.ok(fs.existsSync(path.join(customDir, 'prod-notary.pem')));
  assert.ok(fs.existsSync(path.join(customDir, 'prod-notary.pub.pem')));
});

test('CLI sign and verify-sig end-to-end on attestation', () => {
  const dir = initRepo();
  const installRes = run(['install', '--agent', 'codex', '--stack', 'node', '--target', dir], dir);
  assert.equal(installRes.status, 0, installRes.stderr);

  // Generate keypair
  const keygenRes = run(['keygen', '--target', dir, '--json'], dir);
  assert.equal(keygenRes.status, 0, keygenRes.stderr);

  // Sign attestation
  const signRes = run(['sign', 'attestation', '--target', dir, '--json'], dir);
  assert.equal(signRes.status, 0, signRes.stderr);
  const signData = JSON.parse(signRes.stdout);
  assert.equal(signData.ok, true);
  assert.equal(signData.target, 'attestation');
  assert.ok(fs.existsSync(path.join(dir, '.agents', 'attestation.sig')));

  // Verify signature
  const verifyRes = run(['verify-sig', 'attestation', '--target', dir, '--json'], dir);
  assert.equal(verifyRes.status, 0, verifyRes.stderr);
  const verifyData = JSON.parse(verifyRes.stdout);
  assert.equal(verifyData.ok, true);
  assert.equal(verifyData.target, 'attestation');

  // Verify non-json human-readable output
  const verifyHuman = run(['verify-sig', 'attestation', '--target', dir], dir);
  assert.equal(verifyHuman.status, 0, verifyHuman.stderr);
  assert.match(verifyHuman.stdout, /验签通过/);

  // Tamper attestation.json and verify rejection
  const attestPath = path.join(dir, '.agents', 'attestation.json');
  fs.writeFileSync(attestPath, JSON.stringify({ tampered: true }), 'utf8');
  const verifyFail = run(['verify-sig', 'attestation', '--target', dir, '--json'], dir);
  assert.notEqual(verifyFail.status, 0);
  const failData = JSON.parse(verifyFail.stdout);
  assert.equal(failData.ok, false);
  assert.equal(failData.error, 'PAYLOAD_TAMPERED');
});

test('doctor integration: verifies signature and supports atomic --attest --sign', () => {
  const dir = initRepo();
  const installRes = run(['install', '--agent', 'codex', '--stack', 'node', '--target', dir], dir);
  assert.equal(installRes.status, 0, installRes.stderr);

  // Generate key
  run(['keygen', '--target', dir], dir);

  // Run doctor --attest --sign
  const attestSignRes = run(['doctor', '--attest', '--sign', '--target', dir], dir);
  assert.equal(attestSignRes.status, 0, attestSignRes.stderr);
  assert.match(attestSignRes.stdout, /证明链公证签名已生成/);
  assert.ok(fs.existsSync(path.join(dir, '.agents', 'attestation.sig')));

  // Run doctor normal check: should verify the signature
  const doctorRes = run(['doctor', '--target', dir], dir);
  assert.equal(doctorRes.status, 0, doctorRes.stderr);
  assert.match(doctorRes.stdout, /signature attestation/);

  // Tamper signature file: doctor should report failure
  const sigFile = path.join(dir, '.agents', 'attestation.sig');
  const sigObj = readSignatureFile(sigFile);
  sigObj.signature = Buffer.from('tampered').toString('base64');
  writeSignatureFile(sigFile, sigObj);

  const doctorCorrupted = run(['doctor', '--target', dir], dir);
  assert.notEqual(doctorCorrupted.status, 0);
  assert.match(doctorCorrupted.stdout, /证明链公证签名无效/);
});

test('sbom export --sign and sbom verify --key integrate end-to-end', () => {
  const dir = initRepo();
  const installRes = run(['install', '--agent', 'codex', '--stack', 'node', '--target', dir], dir);
  assert.equal(installRes.status, 0, installRes.stderr);

  // Generate keys
  run(['keygen', '--target', dir], dir);

  // Export SBOM with --sign
  const sbomFile = path.join(dir, 'sbom-export.json');
  const exportRes = run(['sbom', 'export', sbomFile, '--sign', '--target', dir], dir);
  assert.equal(exportRes.status, 0, exportRes.stderr);
  assert.ok(fs.existsSync(sbomFile));
  assert.ok(fs.existsSync(`${sbomFile}.sig`));

  // Verify SBOM with --key
  const pubKey = path.join(dir, '.agents', 'keys', 'flow-kit-key.pub.pem');
  const verifyRes = run(['sbom', 'verify', sbomFile, '--key', pubKey, '--target', dir], dir);
  assert.equal(verifyRes.status, 0, verifyRes.stderr);
  assert.match(verifyRes.stdout, /核验通过/);
  assert.match(verifyRes.stdout, /签名验签通过/);

  // Doctor automatically validates sbom.sig when present
  const defaultSbom = path.join(dir, '.agents', 'sbom.json');
  fs.copyFileSync(sbomFile, defaultSbom);
  fs.copyFileSync(`${sbomFile}.sig`, path.join(dir, '.agents', 'sbom.sig'));

  const doctorSbom = run(['doctor', '--target', dir], dir);
  assert.equal(doctorSbom.status, 0, doctorSbom.stderr);
  assert.match(doctorSbom.stdout, /signature sbom/);
});

test('i18n: notary commands respect --lang en', () => {
  const dir = initRepo();

  const keygenEn = run(['keygen', '--lang', 'en', '--target', dir], dir);
  assert.equal(keygenEn.status, 0, keygenEn.stderr);
  assert.match(keygenEn.stdout, /Keypair generated successfully/);
  assert.doesNotMatch(keygenEn.stdout, /公钥\/私钥对生成成功/);

  const signEn = run(['sign', 'attestation', '--lang', 'en', '--target', dir], dir);
  assert.equal(signEn.status, 0, signEn.stderr);
  assert.match(signEn.stdout, /Signed successfully/);

  const verifyEn = run(['verify-sig', 'attestation', '--lang', 'en', '--target', dir], dir);
  assert.equal(verifyEn.status, 0, verifyEn.stderr);
  assert.match(verifyEn.stdout, /Signature verified successfully/);
});
