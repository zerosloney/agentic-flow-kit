import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { listFiles, RUNTIME_DIRS, RUNTIME_FILES } from '../install/plan.mjs';
import { MANIFEST_REL, readManifest, sha256Text, writeManifest } from '../install/manifest.mjs';
import { extractMergeBlock, readPlanEntry, renderMergeBlock } from '../install/apply.mjs';
import { HOSTS } from '../hosts/registry.mjs';
import { detectHosts } from '../hosts/detect.mjs';
import { buildState } from './diff.mjs';
import { readKitVersion, resolveHosts, resolveStack, resolveTarget } from './install.mjs';

const MERGE_KINDS = new Set(['merge-gitattributes', 'merge-gitignore']);
// 生成脚本会按磁盘现状重写 workflow/INDEX.md，静态模板不可作为预期值；
// 接管时按现状收录并登记为 derived（与 install 的 manifest.derived 语义一致）。
const DERIVED_RELS = new Set(['workflow/INDEX.md']);
// 纯生成产物（不在静态计划里，也不进 manifest）在未识别报告中静默跳过。
const GENERATED_ONLY = new Set(['.agents/notes/engine-map.md']);
const norm = (text) => text.replace(/\r\n/g, '\n');

function readEngineInfo(target) {
  try {
    const engine = JSON.parse(fs.readFileSync(path.join(target, '.agents/config/engine.json'), 'utf8'));
    return {
      hosts: Array.isArray(engine.options?.hosts) ? engine.options.hosts : [],
      stack: engine.options?.stack || null,
      language: engine.options?.language || null,
      createdAt: engine.createdAt || null,
    };
  } catch {
    return null;
  }
}

function readProfileInfo(target) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(target, '.agents/config/profile.json'), 'utf8'));
    return { surfaces: Array.isArray(parsed.surfaces) ? parsed.surfaces.filter((s) => typeof s === 'string') : [] };
  } catch {
    return { surfaces: [] };
  }
}

function baseManifest({ target, existing, hosts, lang, stack, tier, hardened, projectName, trackHosts, installedAt, surfaces }) {
  return {
    ...(existing || {}),
    kit: 'agentic-flow-kit',
    version: readKitVersion(),
    installedAt,
    language: lang,
    hosts,
    stack,
    surfaces,
    projectName,
    trackHosts,
    tier,
    hardened,
    mcp: existing?.mcp !== false,
    mcpServers: existing?.mcpServers || {},
    derived: existing?.derived || [],
    files: existing?.files || {},
  };
}

// 只读比对：plan 条目逐一与磁盘比对，adopt 只认“与当前渲染完全一致”的文件。
// 合并块文件只比较托管块，块外用户内容不影响接管。
function scan({ target, plan, vars, hosts, existing }) {
  const adopted = [];
  const modified = [];
  const missing = [];
  const derived = new Set();
  const mcpServers = {};
  const planned = new Set();
  const adoptedSet = new Set();
  const adopt = (rel, entry) => {
    if (adoptedSet.has(rel)) return;
    adoptedSet.add(rel);
    adopted.push({ path: rel, hash: sha256Text(fs.readFileSync(path.join(target, rel), 'utf8')) });
    if (DERIVED_RELS.has(rel)) derived.add(rel);
    if (entry?.kind === 'merge-mcp' && entry.mcpNames) mcpServers[rel] = entry.mcpNames;
  };
  for (const entry of plan.entries) {
    const rel = entry.targetRel;
    planned.add(rel);
    const abs = path.join(target, rel);
    if (MERGE_KINDS.has(entry.kind)) {
      if (!fs.existsSync(abs)) {
        missing.push(rel);
        continue;
      }
      const { begin, end, block } = renderMergeBlock(entry, vars);
      const found = extractMergeBlock(fs.readFileSync(abs, 'utf8'), begin, end);
      if (!found) {
        modified.push({ path: rel, reason: 'merge-block-missing' });
      } else if (norm(found) === norm(block).replace(/\n$/, '')) {
        adopt(rel);
      } else {
        modified.push({ path: rel, reason: 'merge-block-differs' });
      }
      continue;
    }
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    if (DERIVED_RELS.has(rel)) {
      adopt(rel);
      continue;
    }
    const expected = readPlanEntry(entry, vars);
    if (expected == null) continue; // 二进制模板不参与接管
    const current = fs.readFileSync(abs, 'utf8');
    if (norm(current) === norm(expected)) {
      adopt(rel, entry);
    } else {
      modified.push({ path: rel, reason: 'content-differs' });
    }
  }

  // 未识别：已存在的文件但不在当前计划里；只报告，不纳入 manifest。
  const roots = ['.agents', ...hosts.map((name) => HOSTS[name]?.dir).filter(Boolean)];
  const unrecognized = [];
  for (const root of new Set(roots)) {
    for (const rel of listFiles(path.join(target, root))) {
      const targetRel = `${root}/${rel}`;
      if (targetRel === MANIFEST_REL || planned.has(targetRel) || rel.endsWith('.gitkeep')) continue;
      if (GENERATED_ONLY.has(targetRel)) continue;
      if (RUNTIME_FILES.has(targetRel)) continue;
      if ([...RUNTIME_DIRS].some((dir) => targetRel.startsWith(`${dir}/`))) continue;
      unrecognized.push(targetRel);
    }
  }
  // 已有 manifest 记录、但当前计划不再生成的文件：保留记录，计入未识别供报告。
  for (const rel of Object.keys(existing?.files || {})) {
    if (!planned.has(rel) && !unrecognized.includes(rel)) unrecognized.push(rel);
  }
  unrecognized.sort();
  return { adopted, modified, missing, unrecognized, derived, mcpServers };
}

export function adoptCommand({ args, t }) {
  const target = resolveTarget(args);
  const existing = readManifest(target);
  const detectedHosts = detectHosts(target);
  // engine.json 是上一次安装的机器可读凭证：优先用它还原宿主顺序与栈，避免误判。
  const engineInfo = readEngineInfo(target);
  const profileInfo = readProfileInfo(target);
  const surfaces = existing?.surfaces?.length ? existing.surfaces : profileInfo.surfaces;
  const fallbackHosts = existing?.hosts?.length
    ? existing.hosts
    : (engineInfo?.hosts?.length ? engineInfo.hosts : detectedHosts);
  const hosts = resolveHosts(args, t, fallbackHosts);
  const stack = args.stack || args.profile
    ? resolveStack(args, target)
    : (existing?.stack || engineInfo?.stack || resolveStack(args, target));
  const tier = ['lean', 'standard', 'enterprise'].includes(args.tier) ? args.tier : (existing?.tier || 'standard');
  const hardened = flag(args, 'hardened') || tier === 'enterprise' || Boolean(existing?.hardened && !args.tier);
  const projectName = args.name || existing?.projectName || path.basename(target);
  const installedAt = existing?.installedAt || engineInfo?.createdAt || new Date().toISOString();
  const trackHosts = Boolean(existing?.trackHosts || flag(args, 'track-hosts'));
  const dryRun = flag(args, 'dry-run');
  const asJson = flag(args, 'json');

  // 语言推断：显式、既有 manifest、engine.json 优先；否则用候选语言各渲染一次，取匹配最多者。
  const candidates = [...new Set([args.lang, existing?.language, engineInfo?.language, 'zh-CN', 'en'].filter(Boolean))];
  let best = null;
  for (const language of candidates) {
    const manifest = baseManifest({
      target, existing, hosts, lang: language, stack, surfaces, tier, hardened, projectName, trackHosts, installedAt,
    });
    const { plan, vars } = buildState({ target, manifest });
    const result = scan({ target, plan, vars, hosts, existing });
    if (!best || result.adopted.length > best.result.adopted.length) best = { language, manifest, result };
  }

  const { language, result } = best;
  const files = { ...(existing?.files || {}) };
  for (const item of result.adopted) files[item.path] = item.hash;
  const derived = [...new Set([...(existing?.derived || []), ...result.derived])].filter((rel) => files[rel]);
  const manifestPath = path.join(target, MANIFEST_REL);
  const willWrite = result.adopted.length > 0 || Boolean(existing);
  if (!dryRun && willWrite) {
    const next = baseManifest({
      target, existing, hosts, lang: language, stack, surfaces, tier, hardened, projectName, trackHosts, installedAt,
    });
    next.files = files;
    next.derived = derived;
    next.mcpServers = { ...(existing?.mcpServers || {}), ...result.mcpServers };
    writeManifest(target, next);
  }

  const summary = {
    command: 'adopt',
    target,
    dryRun,
    language,
    stack,
    surfaces,
    tier,
    hardened,
    hosts,
    detectedHosts,
    adopted: result.adopted.map((item) => item.path),
    derived,
    modified: result.modified,
    missing: result.missing,
    unrecognized: result.unrecognized,
    manifest: willWrite && !dryRun ? manifestPath : null,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(t('adopt.title', { target }));
    console.log(t('adopt.detected', { hosts: detectedHosts.join(', ') || t('adopt.none') }));
    console.log(t('adopt.summary', {
      adopted: summary.adopted.length,
      modified: summary.modified.length,
      missing: summary.missing.length,
      unrecognized: summary.unrecognized.length,
    }));
    if (dryRun) console.log(t('adopt.dryRun'));
    for (const rel of summary.adopted) console.log(`+ ${rel}`);
    for (const item of summary.modified) console.log(`! ${item.path} (${item.reason})`);
    for (const rel of summary.missing.slice(0, 20)) console.log(`? ${rel}`);
    if (summary.missing.length > 20) console.log(t('adopt.more', { count: summary.missing.length - 20 }));
    for (const rel of summary.unrecognized.slice(0, 20)) console.log(`- ${rel}`);
    if (summary.unrecognized.length > 20) console.log(t('adopt.more', { count: summary.unrecognized.length - 20 }));
    if (summary.manifest) {
      console.log(t('adopt.manifest', { path: summary.manifest }));
      console.log(t('adopt.next'));
    } else if (!willWrite) {
      console.log(t('adopt.nothing'));
    }
  }

  if (!willWrite) return 1;
  return 0;
}
