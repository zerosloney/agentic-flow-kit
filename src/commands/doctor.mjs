import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readManifest } from '../install/manifest.mjs';
import { doctorGit } from '../git/config.mjs';
import { HOSTS, hostTargetRel } from '../hosts/registry.mjs';
import { listFiles, TEMPLATES } from '../install/plan.mjs';
import { ROLE_NAMES, readInjectedModels, readLocalModelRoles } from '../models/resolve.mjs';
import { resolveTarget } from './install.mjs';

const HOOK_FILES = ['pre-commit', 'commit-msg', 'post-commit', 'pre-merge-commit', 'pre-push'];

export function doctorCommand({ args, t }) {
  const target = resolveTarget(args);
  const checks = [];
  const add = (ok, name, detail, fix, extra = {}) => checks.push({ ok, name, detail, fix, ...extra });
  const roleVal = (entry) => (typeof entry === 'string' ? entry : entry?.model || null);

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
      if (rel === 'settings.hardened.json') continue; // 替换源，不独立安装
      const targetRel = hostTargetRel(host, rel);
      if (!fs.existsSync(path.join(target, targetRel))) add(false, `host ${host}: ${targetRel}`, t('doctor.fileMissing'));
    }
    // 能力缺口：没有 hooks / modelField 的宿主，相关保证只能是 advisory。
    if (!h.hooks) add(true, `guarantee ${host}`, t('doctor.guaranteeGap', { host, capability: 'hooks' }), '', { warn: true });
    if (h.agents && !h.agents.modelField) add(true, `guarantee ${host}`, t('doctor.guaranteeGap', { host, capability: 'model injection' }), '', { warn: true });
  }

  // 安装档位与交付面：lean 允许没有 CI；standard/enterprise 应有可运行 CI。
  const tier = manifest?.tier || 'standard';
  add(true, 'tier', t('doctor.tier', { tier }));
  if (tier !== 'lean') {
    const ci = ['azure-pipelines.yml', '.github/workflows/ci.yml'].filter((rel) => fs.existsSync(path.join(target, rel)));
    if (ci.length) add(true, 'ci', ci.join(', '));
    else add(true, 'ci', t('doctor.ciMissing', { paths: 'azure-pipelines.yml / .github/workflows/ci.yml' }), '', { warn: true });
  }
  if (manifest?.hardened) add(true, 'hardened', t('doctor.hardenedHint'), '', { warn: true });

  // 模型配置是用户本地状态：存在则校验，缺失不失败（旧安装保持 doctor 全过）。
  const localModels = readLocalModelRoles(target);
  if (localModels.error) {
    add(false, 'model-roles.local', t('doctor.modelConfigInvalid'));
  } else if (localModels.exists) {
    add(true, 'model-roles.local', path.relative(target, localModels.file) || localModels.file);
    const value = (entry) => (typeof entry === 'string' ? entry : entry?.model);
    const code = value(localModels.roles.code);
    const review = value(localModels.roles.review);
    if (code && review && code === review) {
      add(true, 'models heterogeneous', t('doctor.reviewSameAsCode'));
    }
    for (const role of ROLE_NAMES) {
      if (value(localModels.roles[role]) == null) continue;
      add(true, `model ${role}`, String(value(localModels.roles[role])));
    }
    // 模型漂移：本地配置 vs 已安装子代理的 model 字段。升级前必须先评测（model-upgrade 技能）。
    const injected = readInjectedModels({ target, hosts: manifest?.hosts || [] });
    for (const host of manifest?.hosts || []) {
      for (const role of ROLE_NAMES) {
        const local = localModels.hosts?.[host]?.[role] ?? roleVal(localModels.roles[role]);
        const installed = injected[host]?.[role];
        if (local != null && installed != null && String(local) !== String(installed)) {
          add(true, `drift ${host}/${role}`, t('doctor.modelDrift', { host, role, installed, local }), '', { warn: true });
        }
      }
    }
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add(nodeMajor >= 22, 'node >= 22', process.version);

  let failed = 0;
  for (const c of checks) {
    if (c.ok) {
      const mark = c.warn ? '!' : '✓';
      console.log(`${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
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
