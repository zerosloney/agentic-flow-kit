import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { TEMPLATES, LOCALES, RUNTIME_DIRS, RUNTIME_FILES } from '../install/plan.mjs';
import { readKitVersion } from '../install/version.mjs';
import { canonical, sha256 } from '../install/notary.mjs';

export const BUNDLE_SCHEMA = 'flow-kit-bundle/v1';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function walkDir(dir, prefix = '', out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '.git' || RUNTIME_DIRS.has(rel)) continue;
      walkDir(abs, rel, out);
    } else if (ent.isFile()) {
      if (RUNTIME_FILES.has(rel)) continue;
      out.push({ abs, rel: rel.replace(/\\/g, '/') });
    }
  }
  return out;
}

function isBinary(buffer) {
  const checkLen = Math.min(buffer.length, 1024);
  for (let i = 0; i < checkLen; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export function packBundle({
  out = null,
  gzip = false,
  templatesDir = TEMPLATES,
  localesDir = LOCALES,
  extraHostDirs = [],
} = {}) {
  const kitVersion = readKitVersion();
  const files = {};

  // 1. 扫描 templates
  for (const item of walkDir(templatesDir)) {
    const key = `templates/${item.rel}`;
    const buf = fs.readFileSync(item.abs);
    const bin = isBinary(buf);
    if (bin) {
      files[key] = {
        hash: sha256(buf),
        encoding: 'base64',
        content: buf.toString('base64'),
        size: buf.length,
      };
    } else {
      const text = buf.toString('utf8').replace(/\r\n/g, '\n');
      const normBuf = Buffer.from(text, 'utf8');
      files[key] = {
        hash: sha256(normBuf),
        encoding: 'utf8',
        content: text,
        size: normBuf.length,
      };
    }
  }

  // 2. 扫描 locales
  for (const item of walkDir(localesDir)) {
    const key = `locales/${item.rel}`;
    const buf = fs.readFileSync(item.abs);
    const bin = isBinary(buf);
    if (bin) {
      files[key] = {
        hash: sha256(buf),
        encoding: 'base64',
        content: buf.toString('base64'),
        size: buf.length,
      };
    } else {
      const text = buf.toString('utf8').replace(/\r\n/g, '\n');
      const normBuf = Buffer.from(text, 'utf8');
      files[key] = {
        hash: sha256(normBuf),
        encoding: 'utf8',
        content: text,
        size: normBuf.length,
      };
    }
  }

  // 3. 扫描外部宿主清单
  for (const dir of extraHostDirs) {
    for (const item of walkDir(dir)) {
      const key = `hosts/${item.rel}`;
      const buf = fs.readFileSync(item.abs);
      const text = buf.toString('utf8').replace(/\r\n/g, '\n');
      const normBuf = Buffer.from(text, 'utf8');
      files[key] = {
        hash: sha256(normBuf),
        encoding: 'utf8',
        content: text,
        size: normBuf.length,
      };
    }
  }

  const fileHashes = Object.fromEntries(
    Object.keys(files).sort().map((k) => [k, files[k].hash]),
  );
  const digest = sha256(canonical({ files: fileHashes }));

  // 统计元数据
  const hosts = [];
  const hostsDir = path.join(templatesDir, 'hosts');
  if (fs.existsSync(hostsDir)) {
    for (const ent of fs.readdirSync(hostsDir, { withFileTypes: true })) {
      if (ent.isDirectory()) hosts.push(ent.name);
    }
  }
  const stacks = [];
  const profilesDir = path.join(templatesDir, 'profiles');
  if (fs.existsSync(profilesDir)) {
    for (const ent of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (ent.isDirectory()) stacks.push(ent.name);
    }
  }
  const surfaces = [];
  const surfacesDir = path.join(templatesDir, 'surfaces');
  if (fs.existsSync(surfacesDir)) {
    for (const ent of fs.readdirSync(surfacesDir, { withFileTypes: true })) {
      if (ent.isDirectory()) surfaces.push(ent.name);
    }
  }

  const fileCount = Object.keys(files).length;
  const totalBytes = Object.values(files).reduce((sum, f) => sum + (f.size || 0), 0);
  const createdAt = new Date().toISOString();

  const bundle = {
    $schema: BUNDLE_SCHEMA,
    bundleVersion: 1,
    kitVersion,
    createdAt,
    digest,
    meta: {
      fileCount,
      totalBytes,
      hosts: hosts.sort(),
      stacks: stacks.sort(),
      surfaces: surfaces.sort(),
    },
    files,
  };

  const shouldGzip = Boolean(gzip || (out && out.endsWith('.gz')));
  const jsonText = JSON.stringify(bundle, null, 2);
  const outFile = out || `flow-kit-v${kitVersion}.bundle.json${shouldGzip ? '.gz' : ''}`;
  const outPath = path.resolve(outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (shouldGzip) {
    const gz = zlib.gzipSync(Buffer.from(jsonText, 'utf8'));
    fs.writeFileSync(outPath, gz);
  } else {
    fs.writeFileSync(outPath, `${jsonText}\n`, 'utf8');
  }

  return {
    ok: true,
    schema: BUNDLE_SCHEMA,
    file: outPath,
    digest,
    meta: bundle.meta,
    kitVersion,
    createdAt,
  };
}

export function readBundle(filePath, t = null) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    fail('BUNDLE_NOT_FOUND', t ? t('error.bundleNotFound', { path: filePath }) : `bundle not found: ${filePath}`);
  }
  if (fs.statSync(abs).isDirectory()) {
    const manifestPath = path.join(abs, 'bundle-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      fail('BUNDLE_INVALID', t ? t('error.bundleInvalid', { path: filePath, detail: 'missing bundle-manifest.json' }) : `not a bundle directory: missing bundle-manifest.json`);
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      fail('BUNDLE_INVALID', t ? t('error.bundleInvalid', { path: filePath, detail: e.message }) : `invalid bundle-manifest.json: ${e.message}`);
    }
    return { isDir: true, path: abs, manifest };
  }

  const buffer = fs.readFileSync(abs);
  let text;
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      text = zlib.gunzipSync(buffer).toString('utf8');
    } catch (e) {
      fail('BUNDLE_INVALID', t ? t('error.bundleInvalid', { path: filePath, detail: `gzip decompression failed: ${e.message}` }) : `gzip failed: ${e.message}`);
    }
  } else {
    text = buffer.toString('utf8');
  }

  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch (e) {
    fail('BUNDLE_INVALID', t ? t('error.bundleInvalid', { path: filePath, detail: e.message }) : `bundle JSON parse failed: ${e.message}`);
  }

  if (!bundle || bundle.$schema !== BUNDLE_SCHEMA) {
    fail('BUNDLE_INVALID', t ? t('error.bundleInvalid', { path: filePath, detail: `unsupported schema: ${bundle?.$schema}` }) : `unsupported schema: ${bundle?.$schema}`);
  }

  return { isDir: false, path: abs, bundle };
}

function isUnsafeBundleRel(rel) {
  if (typeof rel !== 'string' || rel.length === 0) return true;
  if (path.isAbsolute(rel) || path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel)) return true;
  // owner 拍板 2026-11-23：startsWith('..') 误杀 ..data 等合法前缀名，收窄为段级穿越判定。
  return [path.posix.normalize(rel), path.win32.normalize(rel)].some((norm) => {
    return norm.split(/[\\/]/).includes('..');
  });
}

export function verifyBundle(bundleHandle, t = null) {
  if (bundleHandle.isDir) {
    const dir = bundleHandle.path;
    const manifest = bundleHandle.manifest;
    const corruptions = [];
    const fileHashes = {};

    const items = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) items.push(...walkDir(path.join(dir, ent.name)));
    }
    for (const item of items) {
      const rel = path.relative(dir, item.abs).replace(/\\/g, '/');
      const buf = fs.readFileSync(item.abs);
      const bin = isBinary(buf);
      const hash = bin
        ? sha256(buf)
        : sha256(Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));
      fileHashes[rel] = hash;
    }

    const digest = sha256(canonical({ files: fileHashes }));
    if (typeof manifest.digest !== 'string' || manifest.digest.length === 0) {
      corruptions.push('missing bundle digest in bundle-manifest.json');
    } else if (manifest.digest !== digest) {
      corruptions.push(`digest mismatch: expected ${manifest.digest}, computed ${digest}`);
    }

    if (corruptions.length > 0) {
      fail('BUNDLE_CORRUPTED', t ? t('error.bundleCorrupted', { file: bundleHandle.path, detail: corruptions.join('; ') }) : corruptions.join('; '));
    }

    return {
      ok: true,
      file: bundleHandle.path,
      digest: manifest.digest || digest,
      fileCount: Object.keys(fileHashes).length,
      kitVersion: manifest.kitVersion,
      createdAt: manifest.createdAt,
    };
  }

  const { bundle, path: bundlePath } = bundleHandle;
  const corruptions = [];
  const fileHashes = {};

  for (const [rel, entry] of Object.entries(bundle.files || {})) {
    if (isUnsafeBundleRel(rel)) {
      corruptions.push(`${rel} (unsafe path)`);
    }
    if (!entry || typeof entry !== 'object' || typeof entry.content !== 'string') {
      corruptions.push(`${rel} (invalid entry content)`);
      continue;
    }
    let buf;
    if (entry.encoding === 'base64') {
      buf = Buffer.from(entry.content, 'base64');
    } else {
      buf = Buffer.from(entry.content, 'utf8');
    }
    const actualHash = sha256(buf);
    if (actualHash !== entry.hash) {
      corruptions.push(`${rel} (hash mismatch)`);
    }
    fileHashes[rel] = entry.hash;
  }

  const computedDigest = sha256(canonical({ files: fileHashes }));
  if (computedDigest !== bundle.digest) {
    corruptions.push(`bundle digest mismatch (expected ${bundle.digest}, got ${computedDigest})`);
  }

  if (corruptions.length > 0) {
    fail('BUNDLE_CORRUPTED', t ? t('error.bundleCorrupted', { file: bundlePath, detail: corruptions.join('; ') }) : corruptions.join('; '));
  }

  return {
    ok: true,
    file: bundlePath,
    digest: bundle.digest,
    fileCount: Object.keys(bundle.files || {}).length,
    kitVersion: bundle.kitVersion,
    createdAt: bundle.createdAt,
    meta: bundle.meta,
  };
}

export function unpackBundle(bundleHandle, outDir, t = null) {
  verifyBundle(bundleHandle, t);
  const targetDir = path.resolve(outDir);
  fs.mkdirSync(targetDir, { recursive: true });

  if (bundleHandle.isDir) {
    // 目录复制
    fs.cpSync(bundleHandle.path, targetDir, { recursive: true });
    return {
      ok: true,
      outDir: targetDir,
      fileCount: bundleHandle.manifest.meta?.fileCount || 0,
      digest: bundleHandle.manifest.digest,
    };
  }

  const bundle = bundleHandle.bundle;
  for (const [rel, entry] of Object.entries(bundle.files || {})) {
    const dest = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (entry.encoding === 'base64') {
      fs.writeFileSync(dest, Buffer.from(entry.content, 'base64'));
    } else {
      fs.writeFileSync(dest, entry.content, 'utf8');
    }
  }

  const manifest = {
    $schema: bundle.$schema,
    bundleVersion: bundle.bundleVersion,
    kitVersion: bundle.kitVersion,
    createdAt: bundle.createdAt,
    digest: bundle.digest,
    meta: bundle.meta,
  };
  fs.writeFileSync(path.join(targetDir, 'bundle-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    outDir: targetDir,
    fileCount: Object.keys(bundle.files || {}).length,
    digest: bundle.digest,
  };
}

export function prepareBundleForInstall(bundlePath, t = null) {
  const handle = readBundle(bundlePath, t);
  verifyBundle(handle, t);

  if (handle.isDir) {
    return {
      templatesRoot: path.join(handle.path, 'templates'),
      localesRoot: path.join(handle.path, 'locales'),
      bundleInfo: {
        file: path.basename(bundlePath),
        digest: handle.manifest.digest,
        version: handle.manifest.kitVersion,
      },
      cleanup: () => {},
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-bundle-'));
  unpackBundle(handle, tmpDir, t);

  return {
    templatesRoot: path.join(tmpDir, 'templates'),
    localesRoot: path.join(tmpDir, 'locales'),
    bundleInfo: {
      file: path.basename(bundlePath),
      digest: handle.bundle.digest,
      version: handle.bundle.kitVersion,
    },
    cleanup: () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

export function bundleCommand({ args, t }) {
  const asJson = args.flags.has('json');
  const sub = args._[1] || 'pack';

  if (sub === 'pack') {
    const gzip = args.flags.has('gzip');
    const out = args.out || args._[2] || null;
    const extraHosts = args.hostManifests || [];
    const res = packBundle({ out, gzip, extraHostDirs: extraHosts });
    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(t('bundle.packed', {
        file: res.file,
        count: res.meta.fileCount,
        size: formatBytes(res.meta.totalBytes),
        digest: res.digest.slice(0, 16),
      }));
    }
    return 0;
  }

  if (sub === 'inspect') {
    const file = args._[2] || args.file;
    if (!file) fail('MISSING_ARG', t('error.bundleUsage'));
    const handle = readBundle(file, t);
    const meta = handle.isDir ? handle.manifest.meta : handle.bundle.meta;
    const version = handle.isDir ? handle.manifest.kitVersion : handle.bundle.kitVersion;
    const createdAt = handle.isDir ? handle.manifest.createdAt : handle.bundle.createdAt;
    const digest = handle.isDir ? handle.manifest.digest : handle.bundle.digest;

    if (asJson) {
      console.log(JSON.stringify({ file, version, createdAt, digest, meta }, null, 2));
    } else {
      console.log(t('bundle.inspected', {
        file,
        version,
        createdAt,
        count: meta?.fileCount || 0,
        size: formatBytes(meta?.totalBytes || 0),
      }));
      if (meta?.hosts?.length) console.log(`  Hosts: ${meta.hosts.join(', ')}`);
      if (meta?.stacks?.length) console.log(`  Stacks: ${meta.stacks.join(', ')}`);
      if (meta?.surfaces?.length) console.log(`  Surfaces: ${meta.surfaces.join(', ')}`);
    }
    return 0;
  }

  if (sub === 'verify') {
    const file = args._[2] || args.file;
    if (!file) fail('MISSING_ARG', t('error.bundleUsage'));
    const handle = readBundle(file, t);
    const res = verifyBundle(handle, t);
    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(t('bundle.verified', {
        file,
        count: res.fileCount,
        digest: res.digest.slice(0, 16),
      }));
    }
    return 0;
  }

  if (sub === 'unpack') {
    const file = args._[2] || args.file;
    if (!file) fail('MISSING_ARG', t('error.bundleUsage'));
    const outDir = args.out || args._[3] || `flow-kit-bundle-${Date.now()}`;
    const handle = readBundle(file, t);
    const res = unpackBundle(handle, outDir, t);
    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(t('bundle.unpacked', {
        count: res.fileCount,
        dir: res.outDir,
      }));
    }
    return 0;
  }

  fail('BAD_COMMAND', t('error.bundleUsage'));
  return 2;
}
