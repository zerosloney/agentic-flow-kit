import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { buildPlan } from '../install/plan.mjs';
import { buildVars } from '../render/tokens.mjs';
import {
  GITATTR_BEGIN, GITATTR_END, GITIGNORE_BEGIN, GITIGNORE_END,
  readPlanEntry, renderMergeBlock, replaceMergeBlock, stripMergeBlock,
} from '../install/apply.mjs';
import { MANIFEST_REL, readManifest, sha256Text, writeManifest } from '../install/manifest.mjs';
import { HOSTS, HOST_NAMES } from '../hosts/registry.mjs';
import { readInjectedModels } from '../models/resolve.mjs';
import { makeT } from '../i18n.mjs';
import { readKitVersion, resolveTarget } from './install.mjs';
import { cleanEmptyDirs } from './prune.mjs';

const MERGE_KINDS = new Set(['merge-gitattributes', 'merge-gitignore']);

function mergeTargets(entry) {
  return entry.kind === 'merge-gitattributes'
    ? { begin: GITATTR_BEGIN, end: GITATTR_END }
    : { begin: GITIGNORE_BEGIN, end: GITIGNORE_END };
}

function resolveState(args, t) {
  const target = resolveTarget(args);
  const manifest = readManifest(target);
  if (!manifest) {
    const err = new Error(t('error.noManifest'));
    err.code = 'NO_MANIFEST';
    throw err;
  }
  const tt = args.lang ? t : makeT(manifest.language || 'zh-CN');
  return { target, manifest, tt, lang: manifest.language || 'zh-CN' };
}

function planFor({ target, manifest, hosts, categories, lang }) {
  return buildPlan({
    target,
    hosts,
    lang,
    stack: manifest.stack || 'empty',
    projectName: manifest.projectName || path.basename(target),
    categories,
    // 保持模型注入与已安装文本一致，避免收敛时误改剩余宿主的子代理。
    models: readInjectedModels({ target, hosts }),
    tier: manifest.tier || 'standard',
    hardened: Boolean(manifest.hardened),
  });
}

function varsFor({ target, manifest, hosts, lang }) {
  return buildVars({
    target,
    projectName: manifest.projectName || path.basename(target),
    stack: manifest.stack || 'empty',
    language: lang,
    hosts,
    kitVersion: manifest.version || readKitVersion(),
    installedAt: manifest.installedAt || new Date().toISOString(),
    trackHosts: Boolean(manifest.trackHosts),
  });
}

function hashOf(abs) {
  return sha256Text(fs.readFileSync(abs, 'utf8'));
}

function finish(ctx, result, strictFail) {
  const { asJson, tt, items } = ctx;
  if (asJson) {
    console.log(JSON.stringify({ ...result, items }, null, 2));
  } else {
    console.log(tt(result.summaryKey, result.summaryArgs || result));
  }
  return flag(ctx.args, 'strict') && strictFail ? 1 : 0;
}

// remove-host：只删除目标宿主 category:host 的文件；引擎/栈/其他宿主保持不动。
export function removeHostCommand({ args, t }) {
  const { target, manifest, tt, lang } = resolveState(args, t);
  const names = (args.agents && args.agents.length ? args.agents : args._.slice(1))
    .map((name) => String(name).trim().toLowerCase())
    .filter(Boolean);
  if (!names.length) {
    const err = new Error(tt('error.removeHostUsage', { hosts: HOST_NAMES.join(', ') }));
    err.code = 'MISSING_ARG';
    throw err;
  }
  const installed = Array.isArray(manifest.hosts) ? manifest.hosts : [];
  // 已从 hosts 移除、但仍有残留记录（用户改过的文件）的宿主，允许继续清理。
  const hasResidue = (name) => {
    const host = HOSTS[name];
    return Object.keys(manifest.files || {}).some((rel) =>
      rel === host.rootMemory || rel.startsWith(`${host.dir}/`));
  };
  for (const name of names) {
    if (!HOSTS[name]) {
      const err = new Error(tt('error.unknownHost', { name, hosts: HOST_NAMES.join(', ') }));
      err.code = 'UNKNOWN_HOST';
      throw err;
    }
    if (!installed.includes(name) && !hasResidue(name)) {
      const err = new Error(tt('error.hostNotInstalled', { host: name }));
      err.code = 'HOST_NOT_INSTALLED';
      throw err;
    }
  }

  const asJson = flag(args, 'json');
  const dryRun = flag(args, 'dry-run');
  const force = flag(args, 'force');
  const print = asJson ? () => {} : (...line) => console.log(...line);
  const items = [];
  const owned = new Set();
  for (const name of names) {
    const host = HOSTS[name];
    for (const entry of planFor({ target, manifest, hosts: [name], categories: ['host'], lang }).entries) {
      owned.add(entry.targetRel);
    }
    if (host.rootMemory) owned.add(host.rootMemory);
    // 模板已漂移的旧宿主文件：manifest 里仍属于该宿主目录的也算托管面。
    for (const rel of Object.keys(manifest.files || {})) {
      if (rel === host.rootMemory || rel.startsWith(`${host.dir}/`)) owned.add(rel);
    }
  }

  const nextFiles = { ...(manifest.files || {}) };
  const rootMemory = new Set(names.map((name) => HOSTS[name].rootMemory).filter(Boolean));
  let deleted = 0;
  let cleaned = 0;
  let skipped = 0;
  let kept = 0;

  print(tt('removeHost.title', { hosts: names.join(', '), target }));
  if (dryRun) print(tt('removeHost.dryRun'));
  for (const rel of Object.keys(manifest.files || {}).sort()) {
    if (!owned.has(rel)) continue;
    const abs = path.join(target, rel);
    const managedHash = manifest.files[rel];
    // 根记忆文件视作用户所有：默认保留并停止托管，--force 才删除。
    if (rootMemory.has(rel) && !force) {
      delete nextFiles[rel];
      kept += 1;
      items.push({ path: rel, action: 'keep' });
      print(tt('removeHost.keepRoot', { path: rel }));
      continue;
    }
    if (!fs.existsSync(abs)) {
      delete nextFiles[rel];
      cleaned += 1;
      items.push({ path: rel, action: 'clean' });
      print(tt('removeHost.clean', { path: rel }));
      continue;
    }
    if (managedHash && hashOf(abs) !== managedHash && !force) {
      skipped += 1;
      items.push({ path: rel, action: 'skip' });
      print(tt('removeHost.skip', { path: rel }));
      continue;
    }
    if (!dryRun) {
      fs.rmSync(abs, { force: true });
      cleanEmptyDirs(target, abs);
    }
    delete nextFiles[rel];
    deleted += 1;
    items.push({ path: rel, action: 'delete' });
    print(tt('removeHost.delete', { path: rel }));
  }

  const remaining = installed.filter((name) => !names.includes(name));
  // 宿主集合是渲染变量（engine.json / AGENTS.md / .gitignore）：移除后收敛其余托管文件。
  // 只改哈希仍等于 manifest 的文件；用户改过的保持原样，交给 diff / --force。
  const vars = varsFor({ target, manifest, hosts: remaining, lang });
  const derived = new Set(manifest.derived || []);
  let refreshed = 0;
  let blocks = 0;
  for (const entry of planFor({ target, manifest, hosts: remaining, categories: null, lang }).entries) {
    const rel = entry.targetRel;
    if (owned.has(rel) || derived.has(rel)) continue;
    const managedHash = nextFiles[rel];
    if (!managedHash) continue;
    const abs = path.join(target, rel);
    if (!fs.existsSync(abs)) continue;
    const existing = fs.readFileSync(abs, 'utf8');
    if (MERGE_KINDS.has(entry.kind)) {
      const { begin, end, block } = renderMergeBlock(entry, vars);
      const next = replaceMergeBlock(existing, block, begin, end);
      if (next === existing) continue;
      blocks += 1;
      if (!dryRun) fs.writeFileSync(abs, next, 'utf8');
      nextFiles[rel] = sha256Text(next);
      continue;
    }
    if (hashOf(abs) !== managedHash) continue; // 用户已修改
    const text = readPlanEntry(entry, vars);
    if (text == null) continue;
    const nextHash = sha256Text(text);
    if (nextHash === managedHash) continue;
    refreshed += 1;
    if (!dryRun) fs.writeFileSync(abs, text, 'utf8');
    nextFiles[rel] = nextHash;
  }
  if (blocks) print(tt('removeHost.blocks', { count: blocks }));
  if (refreshed) print(tt('removeHost.refreshed', { count: refreshed }));

  if (!dryRun) {
    writeManifest(target, {
      ...manifest,
      hosts: remaining,
      files: nextFiles,
      derived: (manifest.derived || []).filter((rel) => nextFiles[rel]),
    });
  }

  print(tt('removeHost.remaining', { hosts: remaining.join(', ') || tt('removeHost.none') }));
  const summary = { deleted, cleaned, skipped, kept, blocks, refreshed };
  return finish(
    { args, asJson, tt, items },
    { ...summary, hosts: names, remaining, dryRun, summaryKey: 'removeHost.summary' },
    skipped > 0,
  );
}

// uninstall：删除全部托管文件；根记忆文件与用户改过的文件默认保留。
export function uninstallCommand({ args, t }) {
  const { target, manifest, tt, lang } = resolveState(args, t);
  const asJson = flag(args, 'json');
  const dryRun = flag(args, 'dry-run');
  const force = flag(args, 'force');
  const print = asJson ? () => {} : (...line) => console.log(...line);
  const items = [];

  const mergeEntries = planFor({
    target, manifest, hosts: manifest.hosts || [], categories: ['git'], lang,
  }).entries.filter((entry) => MERGE_KINDS.has(entry.kind));
  const mergeRels = new Set(mergeEntries.map((entry) => entry.targetRel));
  const rootMemory = new Set((manifest.hosts || []).map((name) => HOSTS[name]?.rootMemory).filter(Boolean));

  const nextFiles = {};
  let deleted = 0;
  let cleaned = 0;
  let skipped = 0;
  let kept = 0;

  print(tt('uninstall.title', { target }));
  if (dryRun) print(tt('uninstall.dryRun'));
  for (const rel of Object.keys(manifest.files || {}).sort()) {
    if (mergeRels.has(rel)) continue; // 合并块单独处理，避免误删用户内容
    const abs = path.join(target, rel);
    const managedHash = manifest.files[rel];
    if (rootMemory.has(rel) && !force) {
      kept += 1;
      items.push({ path: rel, action: 'keep' });
      print(tt('uninstall.keepRoot', { path: rel }));
      continue;
    }
    if (!fs.existsSync(abs)) {
      cleaned += 1;
      items.push({ path: rel, action: 'clean' });
      print(tt('uninstall.clean', { path: rel }));
      continue;
    }
    if (managedHash && hashOf(abs) !== managedHash && !force) {
      skipped += 1;
      nextFiles[rel] = managedHash;
      items.push({ path: rel, action: 'skip' });
      print(tt('uninstall.skip', { path: rel }));
      continue;
    }
    if (!dryRun) {
      fs.rmSync(abs, { force: true });
      cleanEmptyDirs(target, abs);
    }
    deleted += 1;
    items.push({ path: rel, action: 'delete' });
    print(tt('uninstall.delete', { path: rel }));
  }

  // 只移除带标记的合并块；块外用户内容原样保留，文件变空才删除。
  let blocks = 0;
  for (const entry of mergeEntries) {
    const abs = path.join(target, entry.targetRel);
    if (!fs.existsSync(abs)) continue;
    const { begin, end } = mergeTargets(entry);
    const existing = fs.readFileSync(abs, 'utf8');
    const next = stripMergeBlock(existing, begin, end);
    if (next === existing) continue;
    blocks += 1;
    if (next.trim() === '') {
      deleted += 1;
      items.push({ path: entry.targetRel, action: 'delete' });
      if (!dryRun) {
        fs.rmSync(abs, { force: true });
        cleanEmptyDirs(target, abs);
      }
      print(tt('uninstall.delete', { path: entry.targetRel }));
    } else if (!dryRun) {
      fs.writeFileSync(abs, next, 'utf8');
    }
  }
  if (blocks) print(tt('uninstall.blocks', { count: blocks }));

  let manifestRemoved = false;
  if (!dryRun) {
    if (skipped === 0) {
      const manifestAbs = path.join(target, MANIFEST_REL);
      fs.rmSync(manifestAbs, { force: true });
      cleanEmptyDirs(target, manifestAbs);
      manifestRemoved = true;
    } else {
      // 保留用户改过的文件与其记录，供再次 uninstall --force 继续清理。
      writeManifest(target, { ...manifest, hosts: [], files: nextFiles, derived: [] });
    }
  }
  print(tt(manifestRemoved ? 'uninstall.manifestRemoved' : 'uninstall.manifestKept'));

  const summary = { deleted, cleaned, skipped, kept, blocks };
  return finish(
    { args, asJson, tt, items },
    { ...summary, dryRun, manifestRemoved, summaryKey: 'uninstall.summary' },
    skipped > 0,
  );
}
