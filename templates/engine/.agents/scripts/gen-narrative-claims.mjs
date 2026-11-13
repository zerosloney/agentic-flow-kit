#!/usr/bin/env node
// gen-narrative-claims.mjs — 叙事承重计数：单源取数 + 声明形态表 + 改写（2026-10-11 C5 终局方案 A）
// 背景（用户裁定 2026-10-11）：总览 HTML / 调研快照是**实践指南手册**——随引擎变化、要实时性、不念旧。
// 手抄数字必漂移（当日实证：v11→v12 半日内锚数过期两次）；止血门（§9 对账）只让漂移必响，本生成器
// 消除同步税本身：改引擎后跑本脚本，叙事文档里的现态计数**写即对**。
// 机制：与 verify-wiki-consistency §9 **共用同一张声明形态表**（本模块 export）——门=必响，生成器=改写，
// 双消费者单源（沿 gen-effective-policy「生成 + --check」惯例）。形态表只认「现态声明形态」，
// 历史叙述请写成不含这些形态的措辞（如「段数历经 22→24」不匹配任何模式）。
// 单源（全部本地确定性、零网络）：
//   段数 = check-loop.mjs SECTIONS lane 计数；锚数 = workflow/effective-policy.md（受 --check 门钉死的
//   policy.mjs 已验证代理）；主题/文件数 = wiki/INDEX.md 合计行（同受三方一致门钉死）；
//   钩子数 = .githooks 文件数；verify 门数 = spawn verify.mjs --list（即时不执行门）；
//   命令/角色数 = .agents/commands|roles 目录 md 计数（2026-11-11 P0：总览图原手抄 9/3，实为 7/7）；
//   workflow 活跃/档案 = workflow/INDEX.md 头部两行（同受生成物漂移门钉死）。
// 用法：flow-kit run gen-narrative-claims.mjs [--root <dir>] [--check]
//   默认 = 改写所有命中声明为单源真值（打印逐处变更）；--check = 漂移 exit 1（供门禁/CI）。
// 测试面已随引擎减重退役（2026-10-28，owner 决策），本脚本现无测试兜底
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
};

// ---- 单源取数：collectSources(root) → { ... } | 抛错（缺单源文件 = fail-loud，门与生成器同口径）----
export function collectSources(root, scriptsDir = process.env.FLOW_KIT_RUNTIME_SCRIPTS || path.join(root, '.agents', 'scripts')) {
  const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const cl = fs.readFileSync(path.join(scriptsDir, 'check-loop.mjs'), 'utf8');
  const lanes = [...cl.matchAll(/lane:\s*'(hard|hygiene)'/g)];
  const ep = rd(path.join('workflow', 'effective-policy.md'));
  const vm = ep.match(/policyVersion (\d+)/);
  let anchors = 0, epHard = 0, epAdvisory = 0;
  for (const row of ep.matchAll(/^\| `[A-Za-z][\w.]*` \|[^|]*\|[^|]*\|[^|]*\| (hard|advisory) \|/gm)) {
    anchors += 1;
    if (row[1] === 'hard') epHard += 1; else epAdvisory += 1;
  }
  const idx = rd(path.join('wiki', 'INDEX.md'));
  const tm = idx.match(/合计：\*\*(\d+) 份\*\*知识文档，\*\*(\d+) 个主题\*\*/);
  // workflow 索引两行（2026-11-11 P0 补）：总览 s8「现状数字」原手抄 活跃 10 / 档案 833，
  // 实测 INDEX 头部为 活跃 111 / 档案 707——同类手抄漂移，改为现场取数。
  const wfIdx = rd(path.join('workflow', 'INDEX.md'));
  const wfActive = wfIdx.match(/^## 活跃（(\d+)）/m);
  const wfArchive = wfIdx.match(/^## 档案计数（(\d+)/m);
  let hooks = 0;
  const gh = path.join(root, '.githooks');
  if (fs.existsSync(gh)) hooks = fs.readdirSync(gh).filter((f) => fs.statSync(path.join(gh, f)).isFile()).length;
  // 模型侧载体计数（2026-11-11 P0）：总览图里的「commands/ N 个阶段指令」「roles/ N 个角色契约」
  // 原为手抄，实测 9/3 对现况 7/7 全错。取数口径与 gen-engine-map.mjs「模型侧载体」段一致。
  const countMd = (dir) => (fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && fs.statSync(path.join(dir, f)).isFile()).length
    : null);
  // verify 门数：--list 即时返回不执行门（wiki 门在 verify.mjs 内被本模块的检查消费方调用时，
  // 本 spawn 只跑 --list 分支即退——无递归执行门）
  const gateCount = (extra) => {
    const r = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'verify.mjs'), '--list', ...extra], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    return (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).length;
  };
  // 门数缓存（2026-11-06 P1）：两次 spawn `node verify.mjs --list` 实测 ~500ms，占 wiki-consistency
  // 门一半。门数只取决于 verify.mjs 的 GATES 数组 → 按内容哈希缓存（改 verify.mjs 即重算）；
  // 缓存缺失/哈希不匹配/写失败一律回落逐次 spawn（原语义，不 fail-open 也不新增失败面）。
  let gc = null;
  try {
    const cacheFile = path.join(root, '.agents', 'cache', 'gate-counts.json');
    const h = createHash('sha256').update(fs.readFileSync(path.join(SCRIPT_DIR, 'verify.mjs'))).digest('hex');
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (c && c.v === 1 && c.root === path.resolve(root) && c.verifyHash === h && Number.isInteger(c.all) && Number.isInteger(c.engine)) gc = c;
    } catch { /* 无缓存 */ }
    if (!gc) {
      const all = gateCount([]), engine = gateCount(['--engine']);
      if (all === null || engine === null) throw new Error('gate list failed');
      gc = { v: 1, root: path.resolve(root), verifyHash: h, all, engine };
      try {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        const tmp = `${cacheFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(gc));
        fs.renameSync(tmp, cacheFile);
      } catch { /* 写失败不影响 */ }
    }
  } catch { gc = null; }
  return {
    sections: lanes.length,
    hardSections: lanes.filter((x) => x[1] === 'hard').length,
    epVersion: vm ? Number(vm[1]) : null,
    anchors, epHard, epAdvisory,
    wikiFiles: tm ? Number(tm[1]) : null,
    wikiTopics: tm ? Number(tm[2]) : null,
    commands: countMd(path.join(root, '.agents', 'commands')),
    roles: countMd(path.join(root, '.agents', 'roles')),
    workflowActive: wfActive ? Number(wfActive[1]) : null,
    workflowArchived: wfArchive ? Number(wfArchive[1]) : null,
    hooks,
    gatesAll: gc ? gc.all : gateCount([]),
    gatesEngine: gc ? gc.engine : gateCount(['--engine']),
  };
}

// ---- 声明形态表（单源；门=verify-wiki-consistency §9 / 生成器=本脚本 main 共用）----
// 每类：re（全局）/ want(S, m) → {ok, label} / render(S, m) → 改写串（形态固定，按已知短语重建）。
// want 中任一单源为 null（取不到）→ 该类跳过（claims 计 0），不产生不可判定噪声。
export function buildClaimClasses(S) {
  const c = [];
  const num = (v) => (typeof v === 'number' && Number.isFinite(v));
  c.push({
    id: 'sections',
    re: /(?:双车道|check-loop|闭环门禁)\s*(\d+)\s*段/g,
    want: (m) => ({ ok: num(S.sections) && Number(m[1]) === S.sections, label: `段数 ${m[1]}（单源 ${S.sections}）` }),
    render: (m) => m[0].replace(/\d+/, String(S.sections)),
  });
  c.push({
    id: 'hard-sections',
    re: /硬门\s*(\d+)\s*段/g,
    want: (m) => ({ ok: num(S.hardSections) && Number(m[1]) === S.hardSections, label: `硬门 ${m[1]} 段（单源 ${S.hardSections}）` }),
    render: (m) => `硬门 ${S.hardSections} 段`,
  });
  c.push({
    id: 'anchors-full',
    re: /policy v(\d+)\s*[=＝]?\s*(\d+)\s*锚（\s*hard\s*(\d+)\s*·\s*advisory\s*(\d+)/g,
    want: (m) => ({ ok: num(S.anchors) && Number(m[1]) === S.epVersion && Number(m[2]) === S.anchors && Number(m[3]) === S.epHard && Number(m[4]) === S.epAdvisory, label: `policy v${m[1]} = ${m[2]} 锚（hard ${m[3]} · advisory ${m[4]}）（单源 v${S.epVersion} = ${S.anchors} 锚（hard ${S.epHard} · advisory ${S.epAdvisory}））` }),
    render: () => `policy v${S.epVersion} = ${S.anchors} 锚（hard ${S.epHard} · advisory ${S.epAdvisory}`,
  });
  c.push({
    id: 'anchors-bare',
    re: /policy v(\d+)\s*[=＝]?\s*(\d+)\s*锚(?!\s*（\s*hard)/g, // 负向先行：完整形态由 anchors-full 处理，防双计
    want: (m) => ({ ok: num(S.anchors) && Number(m[1]) === S.epVersion && Number(m[2]) === S.anchors, label: `policy v${m[1]} = ${m[2]} 锚（单源 v${S.epVersion} = ${S.anchors} 锚）` }),
    render: (m) => m[0].replace(/v\d+/, `v${S.epVersion}`).replace(/\d+\s*锚/, `${S.anchors} 锚`),
  });
  c.push({
    id: 'topics-docs',
    re: /(\d+)\s*个主题、\s*(\d+)\s*份/g,
    want: (m) => ({ ok: num(S.wikiFiles) && Number(m[1]) === S.wikiTopics && Number(m[2]) === S.wikiFiles, label: `${m[1]} 个主题、${m[2]} 份（单源 ${S.wikiTopics} 主题 ${S.wikiFiles} 份）` }),
    render: () => `${S.wikiTopics} 个主题、${S.wikiFiles} 份`,
  });
  c.push({
    id: 'docs-topics',
    re: /(\d+)\s*份\s*\/\s*(\d+)\s*主题/g,
    want: (m) => ({ ok: num(S.wikiFiles) && Number(m[1]) === S.wikiFiles && Number(m[2]) === S.wikiTopics, label: `${m[1]} 份 / ${m[2]} 主题（单源 ${S.wikiFiles} 份 / ${S.wikiTopics} 主题）` }),
    render: () => `${S.wikiFiles} 份 / ${S.wikiTopics} 主题`,
  });
  c.push({
    id: 'git-hooks',
    re: /(\d+)\s*个\s*git\s*原生钩子/g,
    want: (m) => ({ ok: Number(m[1]) === S.hooks, label: `${m[1]} 个 git 原生钩子（.githooks 实有 ${S.hooks}）` }),
    render: () => `${S.hooks} 个 git 原生钩子`,
  });
  c.push({
    id: 'gates-full',
    re: /全量\s*(\d+)\s*门/g,
    want: (m) => ({ ok: num(S.gatesAll) && Number(m[1]) === S.gatesAll, label: `全量 ${m[1]} 门（单源 ${S.gatesAll}）` }),
    render: (m) => m[0].replace(/\d+/, String(S.gatesAll)),
  });
  c.push({
    id: 'gates-full-rev',
    re: /(\d+)\s*门全量/g,
    want: (m) => ({ ok: num(S.gatesAll) && Number(m[1]) === S.gatesAll, label: `${m[1]} 门全量（单源 ${S.gatesAll}）` }),
    render: (m) => m[0].replace(/\d+/, String(S.gatesAll)),
  });
  c.push({
    id: 'gates-engine',
    re: /增量门\s*(\d+)\s*门/g,
    want: (m) => ({ ok: num(S.gatesEngine) && Number(m[1]) === S.gatesEngine, label: `增量门 ${m[1]} 门（单源 ${S.gatesEngine}）` }),
    render: (m) => m[0].replace(/\d+/, String(S.gatesEngine)),
  });
  c.push({
    id: 'commands',
    re: /commands\/\s*(\d+)\s*个阶段指令/g,
    want: (m) => ({ ok: num(S.commands) && Number(m[1]) === S.commands, label: `commands ${m[1]} 个阶段指令（单源 .agents/commands 实有 ${S.commands} 篇）` }),
    render: (m) => m[0].replace(/\d+/, String(S.commands)),
  });
  c.push({
    id: 'roles',
    re: /roles\/\s*(\d+)\s*个角色契约/g,
    want: (m) => ({ ok: num(S.roles) && Number(m[1]) === S.roles, label: `roles ${m[1]} 个角色契约（单源 .agents/roles 实有 ${S.roles} 篇）` }),
    render: (m) => m[0].replace(/\d+/, String(S.roles)),
  });
  c.push({
    id: 'workflow-active',
    re: /workflow 活跃<\/td><td>(\d+)<\/td>/g,
    want: (m) => ({ ok: num(S.workflowActive) && Number(m[1]) === S.workflowActive, label: `workflow 活跃 ${m[1]}（单源 workflow/INDEX.md 头部 ${S.workflowActive}）` }),
    render: () => `workflow 活跃</td><td>${S.workflowActive}</td>`,
  });
  c.push({
    id: 'workflow-archived',
    re: /workflow 档案<\/td><td>(\d+)<\/td>/g,
    want: (m) => ({ ok: num(S.workflowArchived) && Number(m[1]) === S.workflowArchived, label: `workflow 档案 ${m[1]}（单源 workflow/INDEX.md 头部 ${S.workflowArchived}）` }),
    render: () => `workflow 档案</td><td>${S.workflowArchived}</td>`,
  });
  return c;
}

// ---- 扫描面：wiki/ 活跃知识文档（排除 drafts-archive 与 *.visual-check.*，与 gen-wiki-board 口径一致）----
function knowledgeDocs(root) {
  const out = [];
  const wikiDir = path.join(root, 'wiki');
  if (!fs.existsSync(wikiDir)) return out;
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      const r = rel ? `${rel}/${e}` : e;
      if (fs.statSync(p).isDirectory()) walk(p, r);
      else if (/\.(md|html)$/i.test(e) && !/\.visual-check\./i.test(e)) out.push({ rel: `wiki/${r}`, abs: p });
    }
  };
  for (const e of fs.readdirSync(wikiDir)) {
    if (e === 'drafts-archive') continue;
    const p = path.join(wikiDir, e);
    if (fs.statSync(p).isDirectory()) walk(p, e);
    else if (/\.(md|html)$/i.test(e) && !/\.visual-check\./i.test(e)) out.push({ rel: `wiki/${e}`, abs: p });
  }
  return out;
}

// checkNarrativeClaims(root) → { claims, mismatches: [{file, label}] }（门消费方 API）
export function checkNarrativeClaims(root) {
  const S = collectSources(root);
  const classes = buildClaimClasses(S);
  const claims = [];
  const mismatches = [];
  for (const doc of knowledgeDocs(root)) {
    const text = fs.readFileSync(doc.abs, 'utf8');
    for (const cls of classes) {
      for (const m of text.matchAll(cls.re)) {
        const { ok, label } = cls.want(m);
        claims.push(1);
        if (!ok) mismatches.push({ file: doc.rel, label, cls: cls.id });
      }
    }
  }
  return { claims: claims.length, mismatches, sources: S };
}

// ---- CLI ----
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const ROOT = path.resolve(argOf('--root') || process.env.FLOW_KIT_PROJECT_ROOT || path.join(SCRIPT_DIR, '..', '..'));
  if (argv.includes('--check')) {
    const { claims, mismatches } = checkNarrativeClaims(ROOT);
    if (mismatches.length) {
      console.error(`❌ 叙事承重计数漂移 ${mismatches.length}/${claims} 项：`);
      for (const mm of mismatches) console.error(`  - ${mm.file}「${mm.label}」`);
      console.error('  修法：flow-kit run gen-narrative-claims.mjs（改写为单源真值）或改写为非现态措辞');
      process.exit(1);
    }
    console.log(`[narrative-claims] ✅ ${claims} 项现态声明对单源一致`);
    process.exit(0);
  }
  // 默认 = 改写
  const S = collectSources(ROOT);
  const classes = buildClaimClasses(S);
  let changed = 0;
  for (const doc of knowledgeDocs(ROOT)) {
    let text = fs.readFileSync(doc.abs, 'utf8');
    const before = text;
    for (const cls of classes) {
      // replace 回调签名 (matchStr, p1..pN, offset, full)——末两参非捕获组，重建伪 match 供 want/render
      text = text.replace(cls.re, (matchStr, ...rest) => {
        const m = [matchStr, ...rest.slice(0, rest.length - 2)];
        const { ok } = cls.want(m);
        if (ok) return matchStr;
        changed += 1;
        console.log(`  ✏️  ${doc.rel}：${matchStr} → ${cls.render(m)}`);
        return cls.render(m);
      });
    }
    if (text !== before) fs.writeFileSync(doc.abs, text, 'utf8');
  }
  console.log(changed ? `✅ 已改写 ${changed} 处承重计数为单源真值` : '✅ 无漂移（全部承重计数与单源一致）');
}
