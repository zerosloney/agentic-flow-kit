// 安装证明链（R3-3）：manifest 哈希 + 策略版本 + eval 凭证 + 可选 git 绑定。
// 设计约束：确定性输出（无时间戳/绝对路径/网络）、只读、篡改可检出。
// 信任模型：证明由本地生成，不含私钥签名；`git.commit` 把证明绑定到某次提交，
// 归档后重新生成即可比对 root；需要第三方签名时在归档侧对 JSON 签名即可。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readManifest } from './manifest.mjs';

export const ATTEST_SCHEMA = 'flow-kit-attest/v1';
const POLICY_REL = '.agents/config/policy.json';
const EVAL_RESULTS = '.agents/evals/results.jsonl';
const EVAL_LOG = '.agents/evals/eval-log.json';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readBuffer(abs) {
  try {
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

function readJson(abs) {
  const buffer = readBuffer(abs);
  if (!buffer) return null;
  try {
    return JSON.parse(buffer.toString('utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

function jsonDigest(abs) {
  const parsed = readJson(abs);
  if (parsed !== null) return sha256(canonical(parsed));
  const buffer = readBuffer(abs);
  return buffer ? sha256(buffer) : null;
}

function textDigest(abs) {
  const buffer = readBuffer(abs);
  if (!buffer) return null;
  return sha256(buffer.toString('utf8').replace(/\r\n/g, '\n'));
}

function countLines(abs) {
  const buffer = readBuffer(abs);
  if (!buffer) return 0;
  const text = buffer.toString('utf8');
  return text ? text.split(/\r?\n/).filter((line) => line.trim()).length : 0;
}

function gitInfo(target) {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: target, encoding: 'utf8', windowsHide: true });
  if (head.error || head.status !== 0) return null;
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: target, encoding: 'utf8', windowsHide: true });
  return {
    commit: String(head.stdout || '').trim(),
    dirty: Boolean(status.status === 0 && String(status.stdout || '').trim()),
  };
}

function manifestCore(manifest) {
  return {
    schemaVersion: manifest.schemaVersion ?? 0,
    version: manifest.version ?? null,
    kitVersion: manifest.kitVersion ?? null,
    language: manifest.language ?? null,
    hosts: [...(manifest.hosts || [])].sort(),
    stack: manifest.stack ?? null,
    surfaces: [...(manifest.surfaces || [])].sort(),
    tier: manifest.tier ?? null,
    hardened: Boolean(manifest.hardened),
    baselineVersion: manifest.baselineVersion ?? null,
    files: Object.fromEntries(Object.entries(manifest.files || {}).sort(([a], [b]) => a.localeCompare(b))),
  };
}

// 生成证明对象；不写盘。调用方决定输出路径。
export function buildAttestation(target) {
  const manifest = readManifest(target);
  if (!manifest) {
    return {
      schema: ATTEST_SCHEMA,
      algorithm: 'sha256-chain/v1',
      ok: false,
      problems: ['缺少 .agents/install-manifest.json'],
      policy: null,
      manifest: null,
      evals: null,
      git: null,
      chain: null,
    };
  }
  const problems = [];
  const files = manifest.files || {};
  for (const rel of Object.keys(files).sort()) {
    const buffer = readBuffer(path.join(target, rel));
    if (!buffer) {
      problems.push(`缺失托管文件: ${rel}`);
      continue;
    }
    const actual = sha256(buffer);
    if (actual !== files[rel]) problems.push(`哈希不匹配: ${rel}`);
  }

  const core = manifestCore(manifest);
  const manifestDigest = sha256(canonical(core));
  const filesDigest = sha256(canonical(core.files));

  const policyFile = path.join(target, POLICY_REL);
  const policy = readJson(policyFile);
  const policyDigest = jsonDigest(policyFile);
  const policyInfo = policyDigest
    ? { present: true, version: policy?.version ?? null, digest: policyDigest }
    : { present: false, version: null, digest: null };

  const resultsFile = path.join(target, EVAL_RESULTS);
  const resultsDigest = textDigest(resultsFile);
  const evalLogFile = path.join(target, EVAL_LOG);
  const evalLogDigest = jsonDigest(evalLogFile);
  const evalLog = readJson(evalLogFile);
  const evals = {
    results: {
      present: resultsDigest !== null,
      digest: resultsDigest,
      lines: countLines(resultsFile),
    },
    evalLog: {
      present: evalLogDigest !== null,
      digest: evalLogDigest,
      entries: Array.isArray(evalLog?.entries) ? evalLog.entries.length : 0,
    },
  };

  const git = gitInfo(target);
  const steps = {
    manifest: manifestDigest,
    files: filesDigest,
    policy: policyDigest,
    evals: sha256(canonical(evals)),
    git: git ? sha256(canonical(git)) : null,
  };
  const root = sha256(canonical(steps));

  return {
    schema: ATTEST_SCHEMA,
    algorithm: 'sha256-chain/v1',
    ok: problems.length === 0,
    problems,
    kitVersion: core.kitVersion,
    language: core.language,
    hosts: core.hosts,
    stack: core.stack,
    surfaces: core.surfaces,
    tier: core.tier,
    hardened: core.hardened,
    policy: policyInfo,
    manifest: {
      schemaVersion: core.schemaVersion,
      digest: manifestDigest,
      files: Object.keys(core.files).length,
      baselineVersion: core.baselineVersion,
    },
    evals,
    git,
    chain: { ...steps, root },
  };
}

// 写证明文件；内容按固定键序构造，便于跨机比对。返回绝对路径。
export function writeAttestation(file, attestation) {
  const out = path.resolve(file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');
  return out;
}
