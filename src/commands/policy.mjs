import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeAtomicSync } from '../install/atomic.mjs';
import { readManifest, writeManifest, sha256File, sha256Text } from '../install/manifest.mjs';
import { diffPolicyTexts, renderPolicyDiff, POLICY_REL } from '../install/policy-diff.mjs';
import { resolveInside } from '../install/path-guard.mjs';
import { resolveTarget } from '../install/target.mjs';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

export function readLocalPolicy(target) {
  const file = path.join(target, POLICY_REL);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail('BAD_POLICY', `invalid policy.json: ${err.message}`);
  }
}

export function writeLocalPolicy(target, policy) {
  const file = path.join(target, POLICY_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomicSync(file, `${JSON.stringify(policy, null, 2)}\n`);
}

function normalizeRemoteSource(url, target) {
  if (url.startsWith('file://')) {
    return { type: 'local', path: fileURLToPath(url) };
  }
  if (url.startsWith('git@') || url.endsWith('.git') || url.startsWith('ssh://') || url.includes('github.com/') || url.includes('gitlab.com/')) {
    return { type: 'git', url };
  }
  const resolved = path.resolve(target || process.cwd(), url);
  if (fs.existsSync(resolved)) {
    return { type: 'local', path: resolved };
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { type: 'git', url };
  }
  return { type: 'local', path: resolved };
}

export function resolveRemotePolicy({ url, ref, target, t }) {
  // url/ref 以 - 开头会被 git 当作选项解析（如 --upload-pack 可执行本地命令），必须在 spawn 前拒绝。
  for (const value of [url, ref]) {
    if (typeof value === 'string' && value.startsWith('-')) {
      fail('BAD_ARGS', t ? t('error.policyRemoteArg', { value }) : `remote policy url/ref must not start with '-': ${value}`);
    }
  }
  const source = normalizeRemoteSource(url, target);
  let cleanup = () => {};
  let rootDir = null;

  if (source.type === 'git') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-policy-'));
    cleanup = () => {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {}
    };
    const cloneArgs = ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), '--', source.url, tmp];
    const res = spawnSync('git', cloneArgs, { encoding: 'utf8', windowsHide: true });
    if (res.status !== 0) {
      cleanup();
      const detail = String(res.stderr || res.stdout || '').trim();
      fail('POLICY_FETCH_FAILED', t ? t('error.policyRemoteFetch', { error: detail }) : `git clone failed: ${detail}`);
    }
    rootDir = tmp;
  } else if (source.type === 'local') {
    if (!fs.existsSync(source.path)) {
      fail('POLICY_REMOTE_MISSING', t ? t('error.policyRemoteNotFound', { path: url }) : `remote policy not found: ${url}`);
    }
    rootDir = source.path;
  } else {
    fail('UNSUPPORTED_PROTOCOL', `remote policy protocol not supported: ${url}`);
  }

  // 发现 policy.json（优先 .agents/config/policy.json，其次根目录 policy.json）
  let policyFile = path.join(rootDir, POLICY_REL);
  let baseDir = rootDir;
  if (!fs.existsSync(policyFile)) {
    const alt = path.join(rootDir, 'policy.json');
    if (fs.existsSync(alt)) {
      policyFile = alt;
      baseDir = rootDir;
    } else {
      cleanup();
      fail('POLICY_REMOTE_MISSING', t ? t('error.policyNotFound', { path: url }) : `no policy.json found in remote: ${url}`);
    }
  }

  let remotePolicy;
  try {
    remotePolicy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  } catch (err) {
    cleanup();
    fail('BAD_POLICY', `invalid remote policy.json: ${err.message}`);
  }

  const digest = sha256File(policyFile);

  const readText = (rel) => {
    // 候选路径尝试：baseDir/rel，baseDir/.agents/config/basename，baseDir/.agents/hooks/basename，baseDir/basename
    const candidates = [
      path.join(baseDir, rel),
      path.join(baseDir, '.agents', 'config', path.basename(rel)),
      path.join(baseDir, '.agents', 'hooks', path.basename(rel)),
      path.join(baseDir, path.basename(rel)),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return fs.readFileSync(cand, 'utf8');
      }
    }
    return null;
  };

  return {
    policy: remotePolicy,
    digest,
    readText,
    cleanup,
  };
}

export function checkPolicyDriftSync(target, localPolicy, remoteOverride = null, t = null) {
  const url = remoteOverride?.url || localPolicy?.remote?.url;
  const ref = remoteOverride?.ref || localPolicy?.remote?.ref || 'main';
  const enforce = localPolicy?.remote?.enforce || null;

  if (!url) {
    return { ok: false, error: 'NO_REMOTE' };
  }

  let remoteHandle;
  try {
    remoteHandle = resolveRemotePolicy({ url, ref, target, t });
  } catch (err) {
    return { ok: false, error: err.message, url, ref, code: err.code };
  }

  try {
    const surfaces = remoteHandle.policy.surfaces || localPolicy?.surfaces || {};
    let keys = Object.keys(surfaces);
    if (Array.isArray(enforce) && enforce.length > 0) {
      keys = keys.filter((k) => enforce.includes(k));
    }

    const changes = [];
    for (const key of keys) {
      const rel = surfaces[key];
      if (!rel) continue;
      const localPath = resolveInside(target, rel);
      if (!localPath) {
        return {
          ok: false,
          error: t ? t('error.policySurfaceOutside', { path: rel }) : `policy surface path escapes target: ${rel}`,
          url,
          ref,
          code: 'BAD_POLICY',
        };
      }
      const localText = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : '';
      const remoteText = remoteHandle.readText(rel) ?? '';
      const surfaceDiffs = diffPolicyTexts(rel, localText, remoteText);
      changes.push(...surfaceDiffs);
    }

    const localFile = path.join(target, POLICY_REL);
    const localDigest = fs.existsSync(localFile) ? sha256File(localFile) : null;

    return {
      ok: true,
      synced: changes.length === 0,
      changes,
      url,
      ref,
      remoteDigest: remoteHandle.digest,
      localDigest,
      surfaces: keys,
      remotePolicy: remoteHandle.policy,
      readRemoteText: remoteHandle.readText,
    };
  } finally {
    remoteHandle.cleanup();
  }
}

function linkCommand({ args, t, target, asJson }) {
  const url = args._[2] || args.remote;
  if (!url) fail('MISSING_ARG', t('error.policyUsage'));

  let policy = readLocalPolicy(target);
  if (!policy) {
    policy = {
      $schema: 'policy/config@1',
      version: 1,
      surfaces: {
        gates: '.agents/hooks/gates.json',
        gateBudgets: '.agents/config/gate-budgets.json',
        ruleBudgets: '.agents/config/rule-budgets.txt',
        workflowEnums: '.agents/config/workflow-enums.txt',
        pipeline: '.agents/config/pipeline.json',
      },
    };
  }

  const enforce = args.enforce
    ? String(args.enforce).split(',').map((s) => s.trim()).filter(Boolean)
    : policy.remote?.enforce || [];

  policy.remote = {
    url,
    ref: args.ref || policy.remote?.ref || 'main',
    enforce,
  };

  writeLocalPolicy(target, policy);

  const manifest = readManifest(target);
  if (manifest?.files && POLICY_REL in manifest.files) {
    // 与 manifest 其余条目同口径（文本哈希 CRLF→LF 归一，issue #87）：sha256File 原始字节会在 CRLF 检出下产生假阳性。
    manifest.files[POLICY_REL] = sha256Text(fs.readFileSync(path.join(target, POLICY_REL), 'utf8'));
    writeManifest(target, manifest);
  }

  if (asJson) {
    console.log(JSON.stringify({ command: 'policy link', target, remote: policy.remote }, null, 2));
  } else {
    console.log(t('policy.linked', { url: policy.remote.url, ref: policy.remote.ref }));
  }
  return 0;
}

function checkCommand({ args, t, target, asJson }) {
  const policy = readLocalPolicy(target);
  const urlOverride = args._[2] || args.remote;
  const remoteOverride = urlOverride ? { url: urlOverride, ref: args.ref || 'main' } : null;

  if (!remoteOverride && !policy?.remote?.url) {
    fail('NO_REMOTE', t('error.policyNoRemote'));
  }

  const result = checkPolicyDriftSync(target, policy, remoteOverride, t);
  if (!result.ok) {
    if (result.code === 'BAD_ARGS' || result.code === 'BAD_POLICY') fail(result.code, result.error);
    fail('POLICY_FETCH_FAILED', t('error.policyRemoteFetch', { error: result.error }));
  }

  if (asJson) {
    console.log(JSON.stringify({
      command: 'policy check',
      target,
      ok: result.ok,
      synced: result.synced,
      url: result.url,
      ref: result.ref,
      driftCount: result.changes.length,
      changes: result.changes,
    }, null, 2));
  } else if (result.synced) {
    console.log(t('policy.synced', { url: result.url }));
  } else {
    console.log(t('policy.driftTitle', { count: result.changes.length }));
    const lines = renderPolicyDiff(result.changes, t);
    for (const line of lines.slice(1)) {
      console.log(line);
    }
  }

  if (args.flags.has('strict') && !result.synced) return 1;
  return 0;
}

function syncCommand({ args, t, target, asJson }) {
  let policy = readLocalPolicy(target);
  const urlOverride = args._[2] || args.remote;
  const remoteOverride = urlOverride ? { url: urlOverride, ref: args.ref || 'main' } : null;

  if (!remoteOverride && !policy?.remote?.url) {
    fail('NO_REMOTE', t('error.policyNoRemote'));
  }

  const url = remoteOverride?.url || policy?.remote?.url;
  const ref = remoteOverride?.ref || policy?.remote?.ref || 'main';

  const remoteHandle = resolveRemotePolicy({ url, ref, target, t });
  const updatedFiles = [];
  const conflicts = [];

  try {
    const remotePolicy = remoteHandle.policy;
    if (!policy) {
      policy = {
        $schema: 'policy/config@1',
        version: 1,
        surfaces: {},
        remote: { url, ref, enforce: [] },
      };
    }
    const surfaces = remotePolicy.surfaces || policy.surfaces || {};
    const enforce = policy.remote?.enforce;
    let keys = Object.keys(surfaces);
    if (Array.isArray(enforce) && enforce.length > 0) {
      keys = keys.filter((k) => enforce.includes(k));
    }

    const manifest = readManifest(target);

    for (const key of keys) {
      const rel = surfaces[key];
      if (!rel) continue;
      const localPath = resolveInside(target, rel);
      if (!localPath) fail('BAD_POLICY', t('error.policySurfaceOutside', { path: rel }));
      const remoteText = remoteHandle.readText(rel);
      if (typeof remoteText === 'string') {
        const normalized = remoteText.replace(/\r\n/g, '\n');
        const remoteHash = sha256Text(normalized);
        const managedHash = manifest?.files && rel in manifest.files ? manifest.files[rel] : null;

        // 用户改过的托管策略面不静默覆盖：与 manifest 对账后跳过，交由用户解决。
        if (managedHash && fs.existsSync(localPath)) {
          // 与 manifest 同口径（文本哈希 CRLF→LF 归一）：CRLF 检出不算用户修改（issue #87）。
          const localHash = sha256Text(fs.readFileSync(localPath, 'utf8'));
          if (localHash !== managedHash) {
            conflicts.push({
              surface: key,
              rel,
              local: localHash.slice(0, 12),
              remote: remoteHash.slice(0, 12),
            });
            continue;
          }
        }

        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        writeAtomicSync(localPath, normalized);
        updatedFiles.push(rel);

        if (manifest?.files && rel in manifest.files) {
          manifest.files[rel] = remoteHash;
        }
      }
    }

    // 局部更新 local policy.json 核心规则段
    policy.version = remotePolicy.version ?? policy.version;
    policy.surfaces = { ...(policy.surfaces || {}), ...(remotePolicy.surfaces || {}) };
    if (remotePolicy.budgets) policy.budgets = remotePolicy.budgets;
    if (remotePolicy.enums) policy.enums = remotePolicy.enums;
    if (remotePolicy.mechanisms) policy.mechanisms = remotePolicy.mechanisms;
    writeLocalPolicy(target, policy);

    if (manifest?.files) {
      // 与 manifest 其余条目同口径（文本哈希 CRLF→LF 归一，issue #87）：sha256File 原始字节会在 CRLF 检出下产生假阳性。
      manifest.files[POLICY_REL] = sha256Text(fs.readFileSync(path.join(target, POLICY_REL), 'utf8'));
      writeManifest(target, manifest);
    }

    if (asJson) {
      console.log(JSON.stringify({
        command: 'policy sync',
        target,
        url,
        ref,
        updatedCount: updatedFiles.length,
        updatedFiles,
        conflicts,
      }, null, 2));
    } else {
      console.log(t('policy.syncComplete', { count: updatedFiles.length }));
      for (const rel of updatedFiles) {
        console.log(`  ✓ ${rel}`);
      }
      if (conflicts.length > 0) {
        console.log(t('policy.syncConflictTitle', { count: conflicts.length }));
        for (const conflict of conflicts) {
          console.log(t('policy.syncConflictLine', { surface: conflict.surface, rel: conflict.rel }));
        }
        console.log(t('policy.syncConflictHint'));
      }
    }
    if (args.flags.has('strict') && conflicts.length > 0) return 1;
    return 0;
  } finally {
    remoteHandle.cleanup();
  }
}

export function policyCommand({ args, t }) {
  const target = resolveTarget(args);
  const asJson = args.flags.has('json');
  const sub = args._[1] || 'check';

  if (sub === 'link') return linkCommand({ args, t, target, asJson });
  if (sub === 'check') return checkCommand({ args, t, target, asJson });
  if (sub === 'sync') return syncCommand({ args, t, target, asJson });

  fail('BAD_COMMAND', t('error.policyUsage'));
  return 2;
}
