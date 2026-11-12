import fs from 'node:fs';
import path from 'node:path';
import { getField } from '../install/frontmatter.mjs';
import { readManifest, sha256Text } from '../install/manifest.mjs';
import { KIT_ROOT } from '../install/plan.mjs';
import { makeT } from '../i18n.mjs';
import { resolveTarget } from './install.mjs';
import { buildState, classifyEntry, KIND_META } from './diff.mjs';

function kitRel(abs) {
  const rel = path.relative(KIT_ROOT, abs);
  return rel && !rel.startsWith('..') ? rel.replace(/\\/g, '/') : abs;
}

// 接受目标内的相对路径或绝对路径；越界路径返回 null。
function normalizeTargetRel(target, input) {
  const abs = path.isAbsolute(input) ? path.resolve(input) : path.resolve(target, input);
  const rel = path.relative(path.resolve(target), abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.replace(/\\/g, '/');
}

function sourceOf(entry) {
  if (!entry) return { template: null, override: null, generated: false };
  const override = entry.localeOverride
    || (entry.templateAbs && entry.srcAbs !== entry.templateAbs ? entry.srcAbs : null);
  const template = entry.templateAbs || (!override && entry.srcAbs ? entry.srcAbs : null);
  return { template, override, generated: entry.kind === 'generated' };
}

export function explainCommand({ args, t }) {
  const target = resolveTarget(args);
  const manifest = readManifest(target);
  if (!manifest) {
    const err = new Error(t('error.noManifest'));
    err.code = 'NO_MANIFEST';
    throw err;
  }
  const tt = args.lang ? t : makeT(manifest.language || 'zh-CN');
  const input = args._[1];
  if (!input) {
    const err = new Error(tt('error.explainUsage'));
    err.code = 'MISSING_ARG';
    throw err;
  }
  const targetRel = normalizeTargetRel(target, input);
  const managed = manifest.files || {};
  const managedHash = targetRel ? (managed[targetRel] ?? null) : null;
  const { plan, vars } = buildState({ target, manifest });
  const entry = targetRel ? plan.entries.find((item) => item.targetRel === targetRel) || null : null;
  if (!entry && managedHash == null) {
    const err = new Error(tt('error.notManaged', { path: targetRel || input }));
    err.code = 'NOT_MANAGED';
    throw err;
  }

  const abs = path.join(target, targetRel);
  const exists = fs.existsSync(abs);
  const classified = entry
    ? classifyEntry({
      target,
      entry,
      vars,
      managedHash,
      derived: (manifest.derived || []).includes(targetRel),
    })
    : {
      kind: 'orphan',
      actualHash: exists ? sha256Text(fs.readFileSync(abs)) : null,
      expectedHash: null,
      kitChanged: false,
      derived: false,
    };
  if (!classified) {
    const err = new Error(tt('error.notManaged', { path: targetRel }));
    err.code = 'NOT_MANAGED';
    throw err;
  }

  const source = sourceOf(entry);
  console.log(tt('explain.title', { path: targetRel }));
  console.log(tt('explain.category', { category: entry?.category || tt('explain.none') }));
  console.log(tt('explain.kind', { kind: tt((KIND_META[classified.kind] || KIND_META.unchanged).key) }));
  console.log(tt('explain.template', {
    path: source.template
      ? kitRel(source.template)
      : (source.generated ? tt('explain.generated') : tt('explain.none')),
  }));
  console.log(tt('explain.override', { path: source.override ? kitRel(source.override) : tt('explain.none') }));
  if (entry?.modelField) {
    let installed = null;
    if (exists) {
      try {
        installed = getField(fs.readFileSync(abs, 'utf8'), entry.modelField);
      } catch {
        /* 文件不可读时按无值展示 */
      }
    }
    console.log(tt('explain.model', {
      field: entry.modelField,
      role: entry.modelRole || tt('explain.none'),
      planned: entry.modelValue == null ? tt('explain.none') : entry.modelValue,
      installed: installed || tt('explain.none'),
    }));
  } else {
    console.log(tt('explain.modelNone'));
  }
  console.log(tt('explain.managedHash', { hash: managedHash || tt('explain.none') }));
  console.log(tt('explain.actualHash', { hash: classified.actualHash || tt('explain.missing') }));
  if (classified.expectedHash) {
    console.log(tt('explain.expectedHash', { hash: classified.expectedHash }));
  }
  if (classified.derived) console.log(tt('explain.derived'));
  if (classified.kind === 'user-modified' && classified.kitChanged) {
    console.log(tt('explain.alsoKitChanged'));
  }
  return 0;
}
