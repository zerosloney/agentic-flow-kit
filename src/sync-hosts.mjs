// flow-kit sync-hosts：跨宿主适配层正文段漂移检查 + 单向同步（B-b 方案，2026-09-25）
// 目的：改权威源（templates/_agents/{commands,roles}/*.md）正文要同步到 N 份薄适配
// （modules/hosts/<h>/{agents,commands}/*.md）的对应正文段；薄适配 frontmatter 保留宿主特化字段
// （commands 层 trae 侧另有 name: wf-X，opencode/zcode/omp 各自原描述），不在同步范围。
// B-b 语义：sha 比对与 apply 只动正文段，frontmatter 双方各自维护。
// 映射单源在 profiles.mjs#HOSTS.commandPrefix（命令层薄适配文件名前缀；2026-09-28 opencode 对齐 trae 的 wf- 前缀）。
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

// bodySha：剥离 frontmatter 后的正文段 sha256（缺失返 null）；正文 LF 归一（2026-09-27 closing-coverage：
// CRLF/LF 盘面同值——权威源与薄适配行尾不一致不再误报漂移）。
// 单源 export（2026-10-11 bodysha-single-source）：doctor §6.7 checkAdapterDrift 复用——此前 doctor
// 内联第二份实现靠注释约束同口径，收敛为单源 import 消灭漂移面。
export function bodySha(p) {
  try {
    const { body } = splitFm(fs.readFileSync(p, 'utf8'));
    return sha256(Buffer.from(body.replace(/\r\n/g, '\n'), 'utf8'));
  } catch {
    return null;
  }
}

// listMd：列目录下 .md 文件（同步当前层；不递归）
function listMd(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}

// pairsFor：权威源文件 → 薄适配 rel 列表（映射单源见 profiles.mjs#HOSTS.commandPrefix）
//   commands 权威源 → 带 commandPrefix 的宿主各一份（<dir>/commands/<prefix><name>.md）
//   roles    权威源 → 全部宿主 agents 各一份
// hostDirOf：宿主 → 适配目录名。包源调用传入 (h) => h，配对落在 modules/hosts/<宿主键>/。
// hostFilter：宿主级过滤。调用方只扫实际存在的宿主目录时传入。
function pairsFor(authRel, hostDirOf = (h) => h, hostFilter = null) {
  const out = [];
  const norm = authRel.split(path.sep).join('/');
  // 条目带 h（宿主键）——faces 计数用「实际生成配对 > 0 的宿主数」（复核 P2-2：存在但空的宿主点
  // 目录此前被计入「N 宿主」，对账面自描述轻微夸大）
  if (norm.startsWith('commands/') && norm.endsWith('.md')) {
    const name = norm.slice('commands/'.length, -'.md'.length);
    for (const [h, v] of Object.entries(HOSTS)) {
      if (hostFilter && !hostFilter(h)) continue;
      if (v.commandPrefix) out.push({ h, adapterRel: `${hostDirOf(h)}/commands/${v.commandPrefix}${name}.md` });
    }
  } else if (norm.startsWith('roles/') && norm.endsWith('.md')) {
    const name = norm.slice('roles/'.length, -'.md'.length);
    for (const h of Object.keys(HOSTS)) {
      if (hostFilter && !hostFilter(h)) continue;
      out.push({ h, adapterRel: `${hostDirOf(h)}/agents/${name}.md` });
    }
  }
  return out;
}

// diffHosts：权威源正文段 vs 薄适配正文段的漂移分析（B-b 语义；pure function）。
// authorityRoot：权威源根（含 commands/ + roles/）
// adapterRoots = [{root, hostDirOf, hostFilter?, label?}]。只扫 modules/hosts。
// 向后兼容：旧单根入参 adaptersRoot/hostDirOf 归一为单元素数组。
// hostDirOf：宿主 → 适配目录名（默认宿主键）
// 返回：{ drift, inSync, authorityMissing, adapterOrphans, faces }
// drift 条目自带 root（applyForward 按它定位适配文件）；faces = 对账面自描述行（防不可解释的「N 对」）
export function diffHosts(opts) {
  const authorityRoot = opts.authorityRoot;
  const roots = opts.adapterRoots || [{ root: opts.adaptersRoot, hostDirOf: opts.hostDirOf || ((h) => h), label: null }];
  if (!fs.existsSync(authorityRoot)) return { drift: [], inSync: 0, authorityMissing: [], adapterOrphans: [], faces: [], note: `权威源根不存在：${authorityRoot}` };

  const drift = [];
  const adapterOrphans = [];
  let inSync = 0;
  const adapterSeen = new Set();
  const authorityMissing = [];
  const faces = [];

  for (const spec of roots) {
    const { root, hostDirOf, hostFilter, label } = spec;
    const rootHosts = new Set(); // 该根实际生成配对 > 0 的宿主（faces 计数口径，复核 P2-2）
    // 扫权威源 commands/ + roles/
    for (const sub of ['commands', 'roles']) {
      const subAbs = path.join(authorityRoot, sub);
      for (const f of listMd(subAbs)) {
        const authRel = `${sub}/${f}`;
        const authAbs = path.join(authorityRoot, authRel);
        const authSha = bodySha(authAbs);
        const pairs = pairsFor(authRel, hostDirOf, hostFilter);
        if (pairs.length === 0) continue;
        for (const { h, adapterRel } of pairs) {
          rootHosts.add(h);
          adapterSeen.add(adapterRel);
          const adapterAbs = path.join(root, adapterRel);
          const adapterSha = bodySha(adapterAbs);
          if (adapterSha === null) {
            // 未安装的宿主不算「缺失」——那是没装，不是漂移（2026-10-07：装户只装部分宿主时，
            // 旧行为会把未装宿主的全部适配文件列成 authorityMissing，装户 --apply 恒 exit 1 且刷屏）
            if (fs.existsSync(path.dirname(adapterAbs))) authorityMissing.push({ authRel, adapterRel });
            continue;
          }
          if (authSha === adapterSha) { inSync++; continue; }
          drift.push({ authRel, adapterRel, authSha, adapterSha, root });
        }
      }
    }

    faces.push(label ? `${label}（${rootHosts.size} 宿主）` : `${root}（${rootHosts.size} 宿主）`);
    // 扫薄适配找孤儿（权威源无对应文件）
    for (const h of Object.keys(HOSTS)) {
      if (hostFilter && !hostFilter(h)) continue;
      for (const sub of ['agents', 'commands']) {
        const subAbs = path.join(root, hostDirOf(h), sub);
        for (const f of listMd(subAbs)) {
          const adapterRel = `${hostDirOf(h)}/${sub}/${f}`;
          if (adapterSeen.has(adapterRel)) continue;
          let authGuess;
          const prefix = HOSTS[h] && HOSTS[h].commandPrefix;
          if (sub === 'commands' && prefix && f.startsWith(prefix)) {
            // 命令层薄适配带宿主 commandPrefix（2026-09-28：opencode 对齐 trae 后两宿主同口径）
            authGuess = `commands/${f.slice(prefix.length)}`;
          } else if (sub === 'agents') {
            authGuess = `roles/${f}`;
          } else {
            authGuess = `commands/${f}`;
          }
          adapterOrphans.push({ adapterRel, authGuess });
        }
      }
    }
  }

  return { drift, inSync, authorityMissing, adapterOrphans, faces };
}

// printDiff：人类可读 diff 报告（B-b 语义：正文段比对 + frontmatter 双方不动）
function printDiff(result) {
  const { drift, inSync, authorityMissing, adapterOrphans, note, faces } = result;
  if (note) console.log(`ℹ️  ${note}\n`);
  if (faces && faces.length) console.log(`  对账面：${faces.join(' + ')}`);
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
// 漂移条目自带 root（多根对账，2026-10-09 sync-hosts-root-coverage）——按它定位适配文件。
// 返回：{ synced: [{adapterRel}] }
function applyForward({ authorityRoot }, drift) {
  const synced = [];
  for (const { authRel, adapterRel, root } of drift) {
    const authAbs = path.join(authorityRoot, authRel);
    const adapterAbs = path.join(root, adapterRel);
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
  let strict = false;
  let dir = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--diff') apply = false;
    else if (a === '--apply') apply = true;
    else if (a === '--json') json = true;
    else if (a === '--strict') strict = true;
    else if (a === '--dir') { dir = args[++i]; if (!dir) fail('--dir 缺少参数（目标项目根）'); }
    else fail(`未知选项：${a}（flow-kit sync-hosts --help）`);
  }
  if (!pkgRoot) fail('sync-hosts 缺少 pkgRoot（开发模式入口）');

  // 目标根：--dir > cwd > pkgRoot。只认包源仓（templates/_agents + modules/hosts）。
  // 装户仓的宿主文件由 init / add-host 写入，不在这里把 .agents 再当成第二份权威源。
  const target = path.resolve(dir || process.cwd() || pkgRoot);
  const authorityRoot = path.join(target, 'templates', '_agents');
  const hostsRoot = path.join(target, 'modules', 'hosts');
  if (!fs.existsSync(authorityRoot) || !fs.existsSync(hostsRoot)) {
    fail(`sync-hosts 只在包源仓运行（需要 templates/_agents 与 modules/hosts）。目标根 ${target} 不是包源仓。装户的宿主文件由 init / add-host 写入。`);
  }
  const adapterRoots = [
    { root: hostsRoot, hostDirOf: (h) => h, label: 'modules/hosts' },
  ];
  const result = diffHosts({ authorityRoot, adapterRoots });

  if (apply && result.drift.length > 0) {
    const { synced } = applyForward({ authorityRoot }, result.drift);
    console.log(`▶ flow-kit sync-hosts --apply → ${target}（包源）`);
    console.log(`  对账面：${result.faces.join(' + ')}`);
    console.log(`  按权威源正文覆盖薄适配正文段 ${synced.length} 份（薄适配 frontmatter 不动）：`);
    for (const rel of synced) console.log(`    - ${rel}`);
    const after = diffHosts({ authorityRoot, adapterRoots });
    console.log(`  同步后正文对齐：${after.inSync} 对；权威源缺失：${after.authorityMissing.length}；正文漂移：${after.drift.length}`);
    return after.drift.length === 0 && after.authorityMissing.length === 0 ? 0 : 1;
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(`▶ flow-kit sync-hosts --diff → ${target}（包源）`);
    printDiff(result);
  }
  // --strict（B4，2026-10-13）：漂移**报告器**变机器门。
  // 背景：source-sync-check 删除后，跨宿主正文漂移只剩人工跑一次 --diff，CI 里无任何调用点——
  //   而改权威源要同步 N 份薄适配，人工 grep 易漏（本次评审前 10 份薄适配就带着漂移）。
  //   默认仍返回 0（保持「报告器」语义，人工跑不因漂移而失败）；CI 用 --strict 把漂移变成红。
  // 口径：**只判「跑一次 --apply 就能归零」的两项**（正文漂移 + 权威源缺失）。
  //   孤儿薄适配不判红——--apply 按设计不删它（可能是宿主特化/历史残留），
  //   把它算红就是一条机器无法自愈的假红，按本仓「假阳性即噪声」纪律不能设成门（仍照常报告）。
  if (strict) {
    const fixable = result.drift.length + result.authorityMissing.length;
    if (fixable > 0) {
      console.error(`[跨宿主漂移 strict] 正文漂移 ${result.drift.length} · 权威源缺失 ${result.authorityMissing.length}`
        + `${result.adapterOrphans.length ? `（另有孤儿薄适配 ${result.adapterOrphans.length} 份，按设计不判红）` : ''}`
        + '——须先 flow-kit sync-hosts --apply 再提交');
      return 1;
    }
    if (result.adapterOrphans.length) {
      console.log(`  ℹ️ 孤儿薄适配 ${result.adapterOrphans.length} 份（--apply 按设计不删，故 strict 不判红；确为残留请手工删）`);
    }
  }
  return 0;
}