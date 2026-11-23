import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { packBundle, readBundle, unpackBundle, verifyBundle } from '../src/commands/bundle.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

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

function runCli(dir, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function json(r) {
  assert.equal(r.stdout.trim().startsWith('{'), true, `expected JSON, got: ${r.stdout.slice(0, 300)}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('bundle pack produces valid json and gzip bundles', () => {
  const tmp = makeTmp('flow-kit-bundle-test-');
  const bundlePath = path.join(tmp, 'test.bundle.json');

  // 1. Pack uncompressed bundle
  const r1 = runCli(tmp, ['bundle', 'pack', '--out', bundlePath, '--json']);
  assert.equal(r1.status, 0, r1.stderr);
  const out1 = json(r1);
  assert.equal(out1.schema, 'flow-kit-bundle/v1');
  assert.ok(out1.digest && out1.digest.length === 64);
  assert.ok(out1.meta.fileCount > 50);
  assert.ok(out1.meta.hosts.includes('claude'));
  assert.ok(out1.meta.stacks.includes('node'));
  assert.ok(fs.existsSync(bundlePath));

  // 2. Pack gzipped bundle
  const gzPath = path.join(tmp, 'test.bundle.json.gz');
  const r2 = runCli(tmp, ['bundle', 'pack', '--out', gzPath, '--gzip', '--json']);
  assert.equal(r2.status, 0, r2.stderr);
  const out2 = json(r2);
  assert.equal(out2.schema, 'flow-kit-bundle/v1');
  assert.equal(out2.digest, out1.digest, 'digest of canonical bundle should be identical regardless of gzip');
  assert.ok(fs.existsSync(gzPath));
  assert.ok(fs.statSync(gzPath).size < fs.statSync(bundlePath).size);
});

test('bundle inspect reports bundle metadata accurately', () => {
  const tmp = makeTmp('flow-kit-bundle-inspect-');
  const bundlePath = path.join(tmp, 'my.bundle.json');
  runCli(tmp, ['bundle', 'pack', '--out', bundlePath, '--json']);

  const r = runCli(tmp, ['bundle', 'inspect', bundlePath, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const info = json(r);
  assert.equal(info.file, bundlePath);
  assert.ok(info.version);
  assert.ok(info.digest);
  assert.ok(info.meta.fileCount > 50);
  assert.ok(info.meta.hosts.includes('claude'));
});

test('bundle verify passes for valid bundle and catches tampering', () => {
  const tmp = makeTmp('flow-kit-bundle-verify-');
  const bundlePath = path.join(tmp, 'secure.bundle.json');
  runCli(tmp, ['bundle', 'pack', '--out', bundlePath, '--json']);

  // Untampered bundle passes verification
  const rOk = runCli(tmp, ['bundle', 'verify', bundlePath, '--json']);
  assert.equal(rOk.status, 0, rOk.stderr);
  const resOk = json(rOk);
  assert.equal(resOk.ok, true);
  assert.ok(resOk.fileCount > 50);

  // Tamper: modify content of one file inside the bundle JSON
  const raw = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const firstKey = Object.keys(raw.files)[0];
  raw.files[firstKey].content += '\n// TAMPERED';
  const tamperedPath = path.join(tmp, 'tampered.bundle.json');
  fs.writeFileSync(tamperedPath, JSON.stringify(raw), 'utf8');

  // Tampered bundle fails verification
  const rBad = runCli(tmp, ['bundle', 'verify', tamperedPath, '--json']);
  assert.notEqual(rBad.status, 0, 'verify must fail when file content is tampered');
  assert.match(rBad.stderr, /CORRUPTED|完整性校验失败|integrity/i);
});

test('bundle unpack extracts bundle to disk with bundle-manifest.json', () => {
  const tmp = makeTmp('flow-kit-bundle-unpack-');
  const bundlePath = path.join(tmp, 'dist.bundle.json.gz');
  runCli(tmp, ['bundle', 'pack', '--out', bundlePath, '--gzip', '--json']);

  const unpackDir = path.join(tmp, 'unpacked');
  const r = runCli(tmp, ['bundle', 'unpack', bundlePath, '--out', unpackDir, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const res = json(r);
  assert.equal(res.outDir, unpackDir);
  assert.ok(res.fileCount > 50);

  // Check unpacked files
  assert.ok(fs.existsSync(path.join(unpackDir, 'bundle-manifest.json')));
  assert.ok(fs.existsSync(path.join(unpackDir, 'templates', 'engine')));
  assert.ok(fs.existsSync(path.join(unpackDir, 'locales', 'zh-CN')));
});

test('install --bundle installs from offline bundle and records provenance', () => {
  const tmp = makeTmp('flow-kit-install-bundle-');
  const bundlePath = path.join(tmp, 'dist.bundle.json.gz');
  runCli(tmp, ['bundle', 'pack', '--out', bundlePath, '--gzip', '--json']);

  // Target repo
  const target = path.join(tmp, 'target');
  fs.mkdirSync(target, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: target }).status, 0);

  // Install using --bundle
  const r = runCli(target, [
    'install',
    '--agent', 'claude',
    '--stack', 'node',
    '--bundle', bundlePath,
    '--target', '.',
    '--json',
  ]);
  assert.equal(r.status, 0, r.stderr);

  // Check manifest contains bundle info
  const manifest = JSON.parse(fs.readFileSync(path.join(target, '.agents', 'install-manifest.json'), 'utf8'));
  assert.ok(manifest.bundle);
  assert.equal(manifest.bundle.file, path.basename(bundlePath));
  assert.ok(manifest.bundle.digest);
  assert.ok(manifest.bundle.version);

  // Doctor check
  const rDoctor = runCli(target, ['doctor', '--target', '.', '--json']);
  assert.equal(rDoctor.status, 0, rDoctor.stderr);
  const doc = json(rDoctor);
  const bundleCheck = doc.checks.find((c) => c.name === 'bundle');
  assert.ok(bundleCheck, 'doctor should have a bundle check');
  assert.equal(bundleCheck.ok, true);

  // Doctor --attest check
  const rAttest = runCli(target, ['doctor', '--target', '.', '--attest', '--json']);
  assert.equal(rAttest.status, 0, rAttest.stderr);
  const docAttest = json(rAttest);
  const attestCheck = docAttest.checks.find((c) => c.name === 'attestation');
  assert.ok(attestCheck);
  assert.equal(attestCheck.ok, true);
  assert.ok(docAttest.attestation);
  assert.ok(docAttest.attestation.bundle);
  assert.equal(docAttest.attestation.bundle.file, path.basename(bundlePath));
  assert.equal(docAttest.attestation.bundle.digest, manifest.bundle.digest);
});

test('install --bundle installs from unpacked bundle directory', () => {
  const tmp = makeTmp('flow-kit-install-dir-bundle-');
  const bundlePath = path.join(tmp, 'dist.bundle.json');
  runCli(tmp, ['bundle', 'pack', '--out', bundlePath, '--json']);

  const unpackDir = path.join(tmp, 'unpacked');
  runCli(tmp, ['bundle', 'unpack', bundlePath, '--out', unpackDir, '--json']);

  const target = path.join(tmp, 'target');
  fs.mkdirSync(target, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: target }).status, 0);

  const r = runCli(target, [
    'install',
    '--agent', 'claude',
    '--stack', 'node',
    '--bundle', unpackDir,
    '--target', '.',
    '--json',
  ]);
  assert.equal(r.status, 0, r.stderr);

  const manifest = JSON.parse(fs.readFileSync(path.join(target, '.agents', 'install-manifest.json'), 'utf8'));
  assert.ok(manifest.bundle);
  assert.equal(manifest.bundle.file, path.basename(unpackDir));
  assert.ok(manifest.bundle.digest);

  const rDoctor = runCli(target, ['doctor', '--target', '.', '--json']);
  assert.equal(rDoctor.status, 0, rDoctor.stderr);
  const doc = json(rDoctor);
  assert.equal(doc.checks.find((c) => c.name === 'bundle')?.ok, true);
});

test('bundle commands print localized English text with --lang en', () => {
  const tmp = makeTmp('flow-kit-bundle-en-');
  const bundlePath = path.join(tmp, 'en.bundle.json');

  const rPack = runCli(tmp, ['bundle', 'pack', '--out', bundlePath, '--lang', 'en']);
  assert.equal(rPack.status, 0, rPack.stderr);
  assert.match(rPack.stdout, /Offline bundle packed:/);

  const rInspect = runCli(tmp, ['bundle', 'inspect', bundlePath, '--lang', 'en']);
  assert.equal(rInspect.status, 0, rInspect.stderr);
  assert.match(rInspect.stdout, /Offline bundle overview:/);

  const rVerify = runCli(tmp, ['bundle', 'verify', bundlePath, '--lang', 'en']);
  assert.equal(rVerify.status, 0, rVerify.stderr);
  assert.match(rVerify.stdout, /Offline bundle integrity verified:/);

  const unpackDir = path.join(tmp, 'unpacked');
  const rUnpack = runCli(tmp, ['bundle', 'unpack', bundlePath, '--out', unpackDir, '--lang', 'en']);
  assert.equal(rUnpack.status, 0, rUnpack.stderr);
  assert.match(rUnpack.stdout, /Offline bundle unpacked successfully/);
});

test('bundle unpack rejects path traversal rels before writing', () => {
  const tmp = makeTmp('flow-kit-bundle-traversal-');
  const content = 'pwned';
  const maliciousRels = ['../evil.txt', '..\\evil.txt', '/tmp/x', 'a/../../etc/passwd'];
  const files = {};
  for (const rel of maliciousRels) {
    files[rel] = { encoding: 'utf8', content, hash: sha256(Buffer.from(content, 'utf8')) };
  }
  const fileHashes = Object.fromEntries(Object.entries(files).map(([rel, entry]) => [rel, entry.hash]));
  const digest = sha256(canonical({ files: fileHashes }));
  const handle = {
    isDir: false,
    path: path.join(tmp, 'evil.bundle.json'),
    bundle: { $schema: 'flow-kit-bundle/v1', bundleVersion: 1, digest, meta: {}, files },
  };

  const outDir = path.join(tmp, 'out');
  assert.throws(
    () => unpackBundle(handle, outDir),
    (err) => err.code === 'BUNDLE_CORRUPTED'
      && maliciousRels.every((rel) => err.message.includes(rel)),
  );

  assert.equal(fs.existsSync(outDir), false, 'unpack must not create the output directory');
  assert.equal(fs.existsSync(path.join(tmp, 'evil.txt')), false, 'must not write outside the target directory');
  assert.deepEqual(fs.readdirSync(tmp), [], 'unpack must not write any file');
});

test('bundle unpack allows rels whose segments merely start with dots', () => {
  const tmp = makeTmp('flow-kit-bundle-dotdata-');
  const content = 'ok';
  const rel = '..data/x.md';
  const files = { [rel]: { encoding: 'utf8', content, hash: sha256(Buffer.from(content, 'utf8')) } };
  const fileHashes = Object.fromEntries(Object.entries(files).map(([r, entry]) => [r, entry.hash]));
  const digest = sha256(canonical({ files: fileHashes }));
  const handle = {
    isDir: false,
    path: path.join(tmp, 'dotdata.bundle.json'),
    bundle: { $schema: 'flow-kit-bundle/v1', bundleVersion: 1, digest, meta: {}, files },
  };

  const outDir = path.join(tmp, 'out');
  const result = unpackBundle(handle, outDir);
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(path.join(outDir, '..data', 'x.md'), 'utf8'), content);
});

test('bundle directory verify covers extra hosts/ entries and detects tampering', () => {
  const tmp = makeTmp('flow-kit-bundle-dir-hosts-');
  const hostDir = path.join(tmp, 'external-host');
  fs.mkdirSync(path.join(hostDir, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(hostDir, 'host.json'), '{"name":"demo"}\n', 'utf8');
  fs.writeFileSync(path.join(hostDir, 'commands', 'run.md'), '---\nname: run\n---\nrun\n', 'utf8');

  const bundlePath = path.join(tmp, 'hosts.bundle.json');
  packBundle({ out: bundlePath, extraHostDirs: [hostDir] });
  const packed = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  assert.ok(packed.files['hosts/host.json'], 'bundle should contain hosts/host.json');
  assert.ok(packed.files['hosts/commands/run.md'], 'bundle should contain nested hosts file');

  const unpackDir = path.join(tmp, 'unpacked');
  unpackBundle(readBundle(bundlePath), unpackDir);

  const verified = verifyBundle(readBundle(unpackDir));
  assert.equal(verified.ok, true);
  assert.equal(verified.fileCount, Object.keys(packed.files).length);

  fs.writeFileSync(path.join(unpackDir, 'hosts', 'host.json'), '{"name":"tampered"}\n', 'utf8');
  assert.throws(
    () => verifyBundle(readBundle(unpackDir)),
    (err) => err.code === 'BUNDLE_CORRUPTED' && /digest mismatch/.test(err.message),
  );
});

test('bundle directory verify passes for plain bundle without hosts/', () => {
  const tmp = makeTmp('flow-kit-bundle-dir-plain-');
  const bundlePath = path.join(tmp, 'plain.bundle.json');
  packBundle({ out: bundlePath });

  const unpackDir = path.join(tmp, 'unpacked');
  unpackBundle(readBundle(bundlePath), unpackDir);

  const verified = verifyBundle(readBundle(unpackDir));
  assert.equal(verified.ok, true);
  assert.ok(verified.fileCount > 0);
});
