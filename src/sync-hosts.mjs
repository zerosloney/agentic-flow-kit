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
// CRLF/LF 盘面同值——权威源与薄适配行尾不一致不再误报漂移，与 doctor §6.7 同口径）
function bodySha(p) {
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
// hostDirOf：宿主 → 适配目录名。包源布局 = 宿主键（modules/hosts/opencode/…）；装户布局 = HOSTS[h].dir
// （项目根下 .opencode/…，带点）——2026-10-07 sync-hosts-target-fix 加装户支持时引入。
// hostFilter（2026-10-09 sync-hosts-root-coverage）：宿主级过滤（多根模式下「项目根宿主点」根只扫
//   实际存在 dir 的宿主——不存在=没装该宿主点，不算缺失不算漂移）。
function pairsFor(authRel, hostDirOf = (h) => h, hostFilter = null) {
  const out = [];
  const norm = authRel.split(path.sep).join('/');
  if (norm.startsWith('commands/') && norm.endsWith('.md')) {
    const name = norm.slice('commands/'.length, -'.md'.length);
    for (const [h, v] of Object.entries(HOSTS)) {
      if (hostFilter && !hostFilter(h)) continue;
      if (v.commandPrefix) out.push({ adapterRel: `${hostDirOf(h)}/commands/${v.commandPrefix}${name}.md` });
    }
  } else if (norm.startsWith('roles/') && norm.endsWith('.md')) {
    const name = norm.slice('roles/'.length, -'.md'.length);
    for (const h of Object.keys(HOSTS)) {
      if (hostFilter && !hostFilter(h)) continue;
      out.push({ adapterRel: `${hostDirOf(h)}/agents/${name}.md` });
    }
  }
  return out;
}

// diffHosts：权威源正文段 vs 薄适配正文段的漂移分析（B-b 语义；pure function）。
// authorityRoot：权威源根（含 commands/ + roles/）
// 多根对账（2026-10-09 sync-hosts-root-coverage）：adapterRoots = [{root, hostDirOf, hostFilter?, label?}]——
//   包源布局传两根（modules/hosts 宿主键形态 + 项目根 HOSTS.dir 形态宿主点）；装户布局单根。
//   向后兼容：旧单根入参 adaptersRoot/hostDirOf 归一为单元素数组。
//   根因教训（engine-quality-round2 B1）：包源布局此前只扫 modules/hosts，项目根宿主点（本仓 .zcode/）
//   完全不在扫描面——bb69e19「81 对全对齐」声明漏掉 .zcode 三份（独立复核 P2-3 实证）。
// hostDirOf：宿主 → 适配目录名（默认宿主键 = 包源布局；装户布局传 (h) => HOSTS[h].dir）
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
    const hostCount = Object.keys(HOSTS).filter((h) => !hostFilter || hostFilter(h)).length;
    faces.push(label ? `${label}（${hostCount} 宿主）` : `${root}（${hostCount} 宿主）`);
    // 扫权威源 commands/ + roles/
    for (const sub of ['commands', 'roles']) {
      const subAbs = path.join(authorityRoot, sub);
      for (const f of listMd(subAbs)) {
        const authRel = `${sub}/${f}`;
        const authAbs = path.join(authorityRoot, authRel);
        const authSha = bodySha(authAbs);
        const pairs = pairsFor(authRel, hostDirOf, hostFilter);
        if (pairs.length === 0) continue;
        for (const { adapterRel } of pairs) {
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
  let dir = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--diff') apply = false;
    else if (a === '--apply') apply = true;
    else if (a === '--json') json = true;
    else if (a === '--dir') { dir = args[++i]; if (!dir) fail('--dir 缺少参数（目标项目根）'); }
    else fail(`未知选项：${a}（flow-kit sync-hosts --help）`);
  }
  if (!pkgRoot) fail('sync-hosts 缺少 pkgRoot（开发模式入口）');

  // 目标根：--dir > cwd > pkgRoot（兜底）。
  // 2026-10-07 sync-hosts-target-fix：此前恒用 pkgRoot——装户里跑 `flow-kit sync-hosts` 时 pkgRoot
  // 解析为**包安装目录**，于是 doctor §7.x 报漂移、照提示跑 `--apply` 会去改包源仓（装户自己的适配层纹丝不动）。
  const target = path.resolve(dir || process.cwd() || pkgRoot);
  // 布局判定（与 doctor.checkAdapterDrift 同口径）：
  //   包源（templates/_agents 与 modules/hosts 同时存在）→ 权威源 = <target>/templates/_agents
  //     薄适配根（2026-10-09 sync-hosts-root-coverage 多根）= ① modules/hosts（宿主键形态，全宿主）
  //     + ② 项目根 HOSTS.dir 实际存在的宿主点（如本仓 .zcode/——此前不在扫描面，bb69e19「81 对全对齐」
  //     漏掉其三份，独立复核 P2-3 实证）；不存在 = 没装该宿主点，不算缺失。
  //   装户（其余）→ 权威源 = <target>/.agents，薄适配根 = <target>（宿主目录 .opencode/.trae/… 直接位于项目根）
  const isSourceRepo = fs.existsSync(path.join(target, 'templates', '_agents'))
    && fs.existsSync(path.join(target, 'modules', 'hosts'));
  const authorityRoot = isSourceRepo ? path.join(target, 'templates', '_agents') : path.join(target, '.agents');
  const adapterRoots = isSourceRepo
    ? [
        { root: path.join(target, 'modules', 'hosts'), hostDirOf: (h) => h, label: 'modules/hosts' },
        {
          root: target,
          hostDirOf: (h) => (HOSTS[h] && HOSTS[h].dir) || h,
          hostFilter: (h) => HOSTS[h] && fs.existsSync(path.join(target, HOSTS[h].dir)),
          label: '项目根宿主点',
        },
      ]
    : [{
        root: target,
        hostDirOf: (h) => (HOSTS[h] && HOSTS[h].dir) || h,
        hostFilter: (h) => HOSTS[h] && fs.existsSync(path.join(target, HOSTS[h].dir)),
        label: '项目根宿主点',
      }];
  if (!fs.existsSync(authorityRoot)) {
    fail(`未找到权威源目录：${authorityRoot}——目标根 ${target} 既非包源（无 templates/_agents）也非装户（无 .agents）；用 --dir <项目根> 指定`);
  }
  const layout = isSourceRepo ? '包源' : '装户';
  const result = diffHosts({ authorityRoot, adapterRoots });

  if (apply && result.drift.length > 0) {
    const { synced } = applyForward({ authorityRoot }, result.drift);
    console.log(`▶ flow-kit sync-hosts --apply → ${target}（${layout}布局）`);
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
    console.log(`▶ flow-kit sync-hosts --diff → ${target}（${layout}布局）`);
    printDiff(result);
  }
  return 0;
}