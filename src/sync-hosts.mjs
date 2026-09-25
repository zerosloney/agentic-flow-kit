// flow-kit sync-hosts：跨宿主适配层正文段漂移检查 + 单向同步（B-b 方案，2026-09-25）
// 目的：改权威源（templates/_agents/{commands,roles}/*.md）正文要同步到 N 份薄适配
// （modules/hosts/<h>/{agents,commands}/*.md）的对应正文段；薄适配 frontmatter 保留宿主特化字段
// （trae commands 加 name: wf-X、opencode/zcode/omp 各自原描述），不在同步范围。
// B-b 语义：sha 比对与 apply 只动正文段，frontmatter 双方各自维护。
// 算法：diffHosts 抽为 pure function（authorityRoot + adaptersRoot 两个根）；
//       sync-hosts CLI 在 pkgRoot 跑（包源视角）；doctor §7.x 在 target 跑（装户视角）——同源逻辑。
import fs from 'node:fs';
import path from 'node:path';
import { HOSTS } from './profiles.mjs';
import { sha256 } from './render.mjs';

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

// 剥离 frontmatter 返回 { fm, body }；无 frontmatter 时 fm = ''，body = 整文件
// frontmatter 形如 "---\n...\n---\n"，位于文件首；其后（含分隔空行）为正文段。
function splitFm(text) {
  const m = String(text || '').match(/^---\r?\n([\s\S]*?\r?\n)---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: '', body: String(text || '') };
  // fm 还原为带分隔横线的形式；body 保留首部空行
  return { fm: `---\n${m[1]}---\n`, body: m[2] };
}

// bodySha：剥离 frontmatter 后的正文段 sha256（缺失返 null）
function bodySha(p) {
  try {
    const { body } = splitFm(fs.readFileSync(p, 'utf8'));
    return sha256(Buffer.from(body, 'utf8'));
  } catch {
    return null;
  }
}

// listMd：列目录下 .md 文件（同步当前层；不递归）
function listMd(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}

// pairsFor：权威源文件 → 薄适配 rel 列表（与 sync-hosts 早版同映射；trae commands 加 wf- 前缀）
function pairsFor(authRel) {
  const out = [];
  const norm = authRel.split(path.sep).join('/');
  if (norm.startsWith('commands/') && norm.endsWith('.md')) {
    const name = norm.slice('commands/'.length, -'.md'.length);
    out.push({ adapterRel: `opencode/commands/${name}.md` });
    out.push({ adapterRel: `trae/commands/wf-${name}.md` });
  } else if (norm.startsWith('roles/') && norm.endsWith('.md')) {
    const name = norm.slice('roles/'.length, -'.md'.length);
    for (const h of Object.keys(HOSTS)) out.push({ adapterRel: `${h}/agents/${name}.md` });
  }
  return out;
}

// diffHosts：权威源正文段 vs 薄适配正文段的漂移分析（B-b 语义；pure function）。
// authorityRoot：权威源根（含 commands/ + roles/）
// adaptersRoot：薄适配根（含 <h>/{agents,commands}/）
// 返回：{ drift, inSync, authorityMissing, adapterOrphans, note }
//   drift       = 正文段 sha 不一致（权威源改 / 薄适配手改 都计入；不区分方向）
//   inSync      = 正文段 sha 对齐的文件对数
//   authorityMissing = 权威源声明但薄适配文件不存在（apply 不自动创建——薄适配须经 add-host 接管）
//   adapterOrphans   = 薄适配存在但权威源无对应文件（apply 不删——可能是宿主特化或历史残留）
export function diffHosts({ authorityRoot, adaptersRoot }) {
  if (!fs.existsSync(authorityRoot)) return { drift: [], inSync: 0, authorityMissing: [], adapterOrphans: [], note: `权威源根不存在：${authorityRoot}` };

  const drift = [];
  let inSync = 0;
  const adapterSeen = new Set();
  const authorityMissing = [];

  // 扫权威源 commands/ + roles/
  for (const sub of ['commands', 'roles']) {
    const subAbs = path.join(authorityRoot, sub);
    for (const f of listMd(subAbs)) {
      const authRel = `${sub}/${f}`;
      const authAbs = path.join(authorityRoot, authRel);
      const authSha = bodySha(authAbs);
      const pairs = pairsFor(authRel);
      if (pairs.length === 0) continue;
      for (const { adapterRel } of pairs) {
        adapterSeen.add(adapterRel);
        const adapterAbs = path.join(adaptersRoot, adapterRel);
        const adapterSha = bodySha(adapterAbs);
        if (adapterSha === null) {
          authorityMissing.push({ authRel, adapterRel });
          continue;
        }
        if (authSha === adapterSha) { inSync++; continue; }
        drift.push({ authRel, adapterRel, authSha, adapterSha });
      }
    }
  }

  // 扫薄适配找孤儿（权威源无对应文件）
  const adapterOrphans = [];
  for (const h of Object.keys(HOSTS)) {
    for (const sub of ['agents', 'commands']) {
      const subAbs = path.join(adaptersRoot, h, sub);
      for (const f of listMd(subAbs)) {
        const adapterRel = `${h}/${sub}/${f}`;
        if (adapterSeen.has(adapterRel)) continue;
        let authGuess;
        if (h === 'trae' && sub === 'commands' && f.startsWith('wf-')) {
          authGuess = `commands/${f.slice('wf-'.length)}`;
        } else if (sub === 'agents') {
          authGuess = `roles/${f}`;
        } else {
          authGuess = `commands/${f}`;
        }
        adapterOrphans.push({ adapterRel, authGuess });
      }
    }
  }

  return { drift, inSync, authorityMissing, adapterOrphans };
}

// printDiff：人类可读 diff 报告（B-b 语义：正文段比对 + frontmatter 双方不动）
function printDiff(result) {
  const { drift, inSync, authorityMissing, adapterOrphans, note } = result;
  if (note) console.log(`ℹ️  ${note}\n`);
  console.log(`  正文对齐：${inSync} 对`);
  if (authorityMissing.length) {
    console.log(`  权威源声明但薄适配缺失（${authorityMissing.length}，apply 不自动创建——薄适配须经 add-host 接管）：`);
    for (const { authRel, adapterRel } of authorityMissing) console.log(`    - ${authRel} → ${adapterRel}`);
  }
  if (drift.length) {
    console.log(`  正文段漂移（${drift.length}，权威源与薄适配正文 sha 不一致——可能是权威源改了或薄适配正文手改了；run with --apply to sync 正文段，frontmatter 不动）：`);
    for (const { authRel, adapterRel } of drift) console.log(`    - ${authRel} → ${adapterRel}`);
  } else if (!authorityMissing.length) {
    console.log('  无漂移 ✅');
  }
  if (adapterOrphans.length) {
    console.log(`  ⚠️  孤儿薄适配（${adapterOrphans.length}，权威源无对应文件，可能是历史残留或宿主特化；apply 不删）：`);
    for (const { adapterRel, authGuess } of adapterOrphans) console.log(`    - ${adapterRel}（推测权威源：${authGuess}）`);
  }
}

// applyForward：把权威源正文段同步到薄适配（保留薄适配原 frontmatter）
// 返回：{ synced: [{adapterRel}] }
function applyForward({ authorityRoot, adaptersRoot }, drift) {
  const synced = [];
  for (const { authRel, adapterRel } of drift) {
    const authAbs = path.join(authorityRoot, authRel);
    const adapterAbs = path.join(adaptersRoot, adapterRel);
    const authText = fs.readFileSync(authAbs, 'utf8');
    const adapterText = fs.readFileSync(adapterAbs, 'utf8');
    const { body } = splitFm(authText);
    const { fm } = splitFm(adapterText);
    // 拼接：薄适配 frontmatter + 权威源正文段
    fs.mkdirSync(path.dirname(adapterAbs), { recursive: true });
    fs.writeFileSync(adapterAbs, `${fm}${body}`);
    synced.push(adapterRel);
  }
  return { synced };
}

export function syncHosts(args, pkgRoot) {
  let apply = false;
  let json = false;
  for (const a of args) {
    if (a === '--diff') apply = false;
    else if (a === '--apply') apply = true;
    else if (a === '--json') json = true;
    else fail(`未知选项：${a}（flow-kit sync-hosts --help）`);
  }
  if (!pkgRoot) fail('sync-hosts 缺少 pkgRoot（开发模式入口）');

  const authorityRoot = path.join(pkgRoot, 'templates', '_agents');
  const adaptersRoot = path.join(pkgRoot, 'modules', 'hosts');
  const result = diffHosts({ authorityRoot, adaptersRoot });

  if (apply && result.drift.length > 0) {
    const { synced } = applyForward({ authorityRoot, adaptersRoot }, result.drift);
    console.log(`▶ flow-kit sync-hosts --apply → ${pkgRoot}`);
    console.log(`  按权威源正文覆盖薄适配正文段 ${synced.length} 份（薄适配 frontmatter 不动）：`);
    for (const rel of synced) console.log(`    - ${rel}`);
    const after = diffHosts({ authorityRoot, adaptersRoot });
    console.log(`  同步后正文对齐：${after.inSync} 对；权威源缺失：${after.authorityMissing.length}；正文漂移：${after.drift.length}`);
    return after.drift.length === 0 && after.authorityMissing.length === 0 ? 0 : 1;
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(`▶ flow-kit sync-hosts --diff → ${pkgRoot}`);
    printDiff(result);
  }
  return 0;
}