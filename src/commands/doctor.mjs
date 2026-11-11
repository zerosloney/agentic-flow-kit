import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readManifest } from '../install/manifest.mjs';
import { doctorGit } from '../git/config.mjs';
import { HOSTS } from '../hosts/registry.mjs';
import { listFiles, TEMPLATES } from '../install/plan.mjs';
import { resolveTarget } from './install.mjs';

const HOOK_FILES = ['pre-commit', 'commit-msg', 'post-commit', 'pre-merge-commit', 'pre-push'];

export function doctorCommand({ args, t }) {
  const target = resolveTarget(args);
  const checks = [];
  const add = (ok, name, detail, fix) => checks.push({ ok, name, detail, fix });

  const manifest = readManifest(target);
  if (!manifest) {
    add(false, 'install-manifest', t('doctor.manifestMissing'));
  } else {
    add(true, 'install-manifest', `.agents/install-manifest.json (v${manifest.version || '?'})`);
    for (const rel of Object.keys(manifest.files || {})) {
      if (!fs.existsSync(path.join(target, rel))) add(false, `file ${rel}`, t('doctor.fileMissing'));
    }
  }

  checks.push(...doctorGit(target));

  const attrPath = path.join(target, '.gitattributes');
  let attr = '';
  try {
    attr = fs.readFileSync(attrPath, 'utf8');
  } catch {
    /* missing handled below */
  }
  add(/merge=jsonl-union/.test(attr), '.gitattributes jsonl-union', attr ? '' : t('doctor.fileMissing'));
  add(/merge=ours/.test(attr), '.gitattributes ours', attr ? '' : t('doctor.fileMissing'));

  for (const hook of HOOK_FILES) {
    add(fs.existsSync(path.join(target, '.githooks', hook)), `hook ${hook}`, '');
  }

  for (const host of manifest?.hosts || []) {
    const h = HOSTS[host];
    if (!h) {
      add(false, `host ${host}`, t('doctor.unknownHost'));
      continue;
    }
    for (const rel of listFiles(path.join(TEMPLATES, 'hosts', host))) {
      const targetRel = host === 'claude' && rel === 'CLAUDE.md' ? 'CLAUDE.md' : `${h.dir}/${rel}`;
      if (!fs.existsSync(path.join(target, targetRel))) add(false, `host ${host}: ${targetRel}`, t('doctor.fileMissing'));
    }
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add(nodeMajor >= 22, 'node >= 22', process.version);

  let failed = 0;
  for (const c of checks) {
    if (c.ok) {
      console.log(`✓ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    } else {
      failed += 1;
      console.log(`✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
      if (c.fix) console.log(`  → ${c.fix}`);
    }
  }
  console.log(failed ? t('doctor.fail', { failed, total: checks.length }) : t('doctor.ok', { total: checks.length }));

  if (args.deep) {
    const gates = path.join(target, '.agents/scripts/check-local-gates.mjs');
    if (fs.existsSync(gates)) {
      console.log(`\n$ node ${gates}`);
      const r = spawnSync(process.execPath, [gates, ...(args.fix ? ['--fix'] : [])], { cwd: target, stdio: 'inherit' });
      if (r.status !== 0) failed += 1;
    }
  }

  return failed ? 1 : 0;
}
