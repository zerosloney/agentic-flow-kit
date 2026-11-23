import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  createHandoffEnvelope,
  verifyHandoffEnvelope,
  readHandoffFile,
  writeHandoffFile,
  listHandoffFiles,
} from '../install/handoff.mjs';
import { resolvePublicKeyPath } from '../install/notary.mjs';
import { resolveTarget } from './install.mjs';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function collectGitChangedFiles(target) {
  try {
    const stdout = execFileSync('git', ['-C', target, 'status', '--porcelain', '-uall'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = [];
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const fileRel = line.slice(3).trim().replace(/^"|"$/g, '');
      if (fileRel && !fileRel.startsWith('.agents/handoffs/') && !fileRel.startsWith('.agents/keys/')) {
        files.push(fileRel);
      }
    }
    return files;
  } catch {
    return [];
  }
}

export function handoffCommand({ args, t }) {
  const asJson = args.flags.has('json');
  const sub = String(args._[1] || 'list').toLowerCase();
  const target = resolveTarget(args);

  if (sub === 'create') {
    const fromRole = args.from;
    const toRole = args.to;
    if (!fromRole || !toRole) {
      fail('MISSING_ROLE', t('error.handoffUsage'));
    }

    let artifacts = [];
    if (args.artifacts) {
      artifacts = String(args.artifacts).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (args._.length > 2) {
      artifacts = args._.slice(2).map((s) => s.trim()).filter(Boolean);
    } else {
      artifacts = collectGitChangedFiles(target);
    }

    const assumptions = args.assumptions
      ? String(args.assumptions).split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      : [];

    let signWithKey = null;
    if (args.sign || args.flags.has('sign')) {
      const keyPath = args.key ? path.resolve(args.key) : path.join(target, '.agents', 'keys', 'flow-kit-key.pem');
      if (!fs.existsSync(keyPath)) {
        fail('KEY_NOT_FOUND', t('error.keyNotFound', { path: keyPath }));
      }
      signWithKey = fs.readFileSync(keyPath, 'utf8');
    }

    let envelope;
    try {
      envelope = createHandoffEnvelope({
        target,
        fromRole,
        toRole,
        task: args.task || 'general',
        summary: args.summary || '',
        artifacts,
        assumptions,
        signWithKey,
        algorithm: args.algorithm || 'ed25519',
      });
    } catch (err) {
      if (err.code === 'CONTEXT_TAINTED') {
        fail('CONTEXT_TAINTED', t('error.handoffTainted', { detail: err.message }));
      }
      fail('HANDOFF_ERROR', err.message);
    }

    const outPath = args.out
      ? path.resolve(args.out)
      : path.join(target, '.agents', 'handoffs', `${envelope.id}.json`);

    writeHandoffFile(outPath, envelope);

    const result = {
      ok: true,
      id: envelope.id,
      file: outPath,
      fromRole: envelope.fromRole,
      toRole: envelope.toRole,
      task: envelope.task,
      artifactsCount: envelope.artifacts.length,
      signed: Boolean(envelope.signature),
      fingerprint: envelope.signature?.publicKeyFingerprint || null,
    };

    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(t('handoff.created', {
        id: envelope.id,
        from: envelope.fromRole,
        to: envelope.toRole,
        count: envelope.artifacts.length,
        file: outPath,
      }));
    }
    return 0;
  }

  if (sub === 'verify') {
    const fileArg = args.file || args._[2];
    if (!fileArg) {
      fail('MISSING_ARG', t('error.handoffUsage'));
    }
    const absPath = path.resolve(fileArg);
    if (!fs.existsSync(absPath)) {
      fail('FILE_NOT_FOUND', t('error.handoffNotFound', { path: absPath }));
    }

    const envelope = readHandoffFile(absPath);
    if (!envelope) {
      fail('INVALID_JSON', t('error.handoffInvalid', { detail: 'Cannot parse JSON file' }));
    }

    let publicKeyPem = null;
    // 公钥路径单源：keygen 默认优先，legacy .agents/notary/public.pem 回退（PR #77 审查跟进）
    const pubKeyCandidate = args.key ? path.resolve(args.key) : resolvePublicKeyPath(target);
    if (fs.existsSync(pubKeyCandidate)) {
      publicKeyPem = fs.readFileSync(pubKeyCandidate, 'utf8');
    }

    const res = verifyHandoffEnvelope({
      target,
      envelope,
      publicKeyPem,
    });

    if (asJson) {
      console.log(JSON.stringify(res, null, 2));
    } else if (res.ok) {
      console.log(t('handoff.verified', {
        id: res.id,
        from: res.fromRole,
        to: res.toRole,
        count: res.artifactsCount,
      }));
      if (res.signatureVerified) {
        console.log(t('notary.verifiedOk', {
          target: 'handoff',
          file: absPath,
          fp: res.signatureVerified.fingerprint,
        }));
      }
    } else {
      console.error(res.problems.join('\n'));
    }

    return res.ok ? 0 : 1;
  }

  if (sub === 'list') {
    const list = listHandoffFiles(target);
    if (asJson) {
      console.log(JSON.stringify({
        target,
        total: list.length,
        handoffs: list.map((item) => ({
          file: item.file,
          name: item.name,
          id: item.envelope.id,
          createdAt: item.envelope.createdAt,
          fromRole: item.envelope.fromRole,
          toRole: item.envelope.toRole,
          task: item.envelope.task,
          artifactsCount: (item.envelope.artifacts || []).length,
          signed: Boolean(item.envelope.signature),
        })),
      }, null, 2));
    } else if (list.length === 0) {
      console.log(t('handoff.none'));
    } else {
      console.log(t('handoff.listTitle', { count: list.length }));
      for (const item of list) {
        const env = item.envelope;
        const sigMark = env.signature ? ' [signed]' : '';
        console.log(`  - ${env.id}: ${env.fromRole} → ${env.toRole} (${(env.artifacts || []).length} artifacts, task: ${env.task})${sigMark}`);
      }
    }
    return 0;
  }

  fail('BAD_COMMAND', t('error.handoffUsage'));
  return 2;
}
