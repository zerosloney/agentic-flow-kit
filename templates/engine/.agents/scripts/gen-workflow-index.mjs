#!/usr/bin/env node
// workflow 活跃层索引生成器（2026-09-21，intent 2026-09-21-workflow-doc-retrieval）
// 用法：flow-kit run gen-workflow-index.mjs [--dry-run] [--check] [--help]
//   --dry-run  只打印差异预览，不写盘
//   --check    不写盘；与磁盘不一致时 exit 1 并打印差异（供 check-loop 漂移告警）
// 测试面已随引擎减重退役（2026-10-28，owner 决策）；2026-11-16 起 projectTasks 纯函数有
//   tests/project-tasks.test.mjs 兜底（CLI 生成面仍无）
// 口径：扫磁盘（对照 gen-wiki-board.mjs 与看板）；排除 _TEMPLATE.md。活跃 = draft / approved / open
//   逐行列出（在跑的工作）；其余状态折叠进「档案计数」——fixed 未 closed 的 incident 与 approved
//   孤儿 plan 属「待收口」，看板会告警；查档案用 kb-search（默认含全部状态）。
// 任务投影（2026-11-16 P3）：projectTasks(root) 聚合入口任务 × plan × spec 三件套 × 确认台账，
//   供 INDEX「任务投影」节与看板 /api/board tasks 消费（单源）；只做编译视图，不新增权威状态文件。
// 生成区：INDEX.md 的 GENERATED:BEGIN/END 锚点注释之间整段重写，锚点外内容原样保留。
import fs from 'node:fs';
import path from 'node:path';
import { ENUMS } from './workflow-enums.mjs';
import { loadAllConfirmations } from './ledger-loader.mjs';

const USAGE = `用法：flow-kit run gen-workflow-index.mjs [--dry-run] [--check] [--help]

事实源：workflow/{intents,specs,plans,incidents}/*.md 的 frontmatter（状态/级别/日期/发现/模块）
        + H1 标题 + 「## 验收标准」勾验统计；排除 _TEMPLATE.md。
生成物：workflow/INDEX.md —— 活跃层逐行（类型|级别|状态|日期|模块|标题|验收）+ 任务投影
        （活跃任务逐行：名称|级别|状态|验收|verify|确认|下一步；单源 projectTasks(root)，与看板
        /api/board tasks 同源。spec 齐缺看 specs/<名>/ 三件套包与同名 spec 文档，确认数取
        confirmations 台账按文档名匹配；下一步为 advisory 文案，非门禁）+ 档案计数（类型×模块）。
选项：
  --dry-run   只打印将生成内容的摘要与差异，不写盘
  --check     不写盘；INDEX 与磁盘不一致时 exit 1（供 check-loop 漂移告警）
  --help      打印本说明`;

const WORKFLOW = 'workflow';
const INDEX_P = path.join(WORKFLOW, 'INDEX.md');
const DOC_TYPES = ['intents', 'specs', 'plans', 'incidents'];
const TYPE_LABEL = { intents: 'INTENT', specs: 'SPEC', plans: 'PLAN', incidents: 'INCIDENT' };
// 活跃口径 = 单源 doc.status.active ∪ incident.status.active；其余状态折叠进档案计数
const ACTIVE_STATUS = [...ENUMS['doc.status.active'], ...ENUMS['incident.status.active']];

const BEGIN = '<!-- GENERATED:BEGIN — gen-workflow-index.mjs 整段重写，手工说明写在本行之前 -->';
const END = '<!-- GENERATED:END -->';
const HEADER = `# workflow 索引 — 活跃层与档案（生成物，勿手改）

> 生成器 \`flow-kit run gen-workflow-index.mjs\`（状态变更 / 新建文档后重跑；\`--check\` 校验漂移，check-loop 会告警）。
> 活跃 = ${ACTIVE_STATUS.join(' / ')}（在跑）；其余状态折叠进档案计数，检索用 \`flow-kit run kb-search.mjs "<词>"\`（默认含全部状态、活跃优先排序）。
> 模块词表见 \`.agents/config/workflow-modules.txt\`。
`;

// ---- frontmatter（受限子集：每行 `键: 值`）+ H1 标题（去「INTENT — 」前缀），对照 workflow/README.md 文档协议 ----
function parseDoc(text) {
  const meta = {};
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\S+):\s*(.*)$/);
      if (kv) meta[kv[1].trim()] = kv[2].trim();
    }
  }
  const h1 = text.match(/^# (.+)$/m);
  let title = h1 ? h1[1] : '';
  // 前缀分隔只认 em/en dash（任意间距）或带空格的 ASCII 连字符——裸连字符是 kebab-case 的一部分，不截断（2026-09-24）
  const dash = title.match(/\S+\s*(?:[—–]+|\s-\s)\s*(.+)$/);
  if (dash) title = dash[1];
  return { meta, title };
}

// ---- 验收勾验统计：仅「## 验收标准」节内（至下一个 ## 标题），无该节返回 null（对照看板口径）----
function parseAcceptance(text) {
  const h = text.match(/^## 验收标准.*$/m);
  if (!h) return null;
  const rest = text.slice(h.index + h[0].length);
  const next = rest.match(/^## /m);
  const section = next ? rest.slice(0, next.index) : rest;
  const total = (section.match(/^\s*[-*] \[[ xX]\]/gm) || []).length;
  if (!total) return null;
  const done = (section.match(/^\s*[-*] \[[xX]\]/gm) || []).length;
  return { done, total };
}

const esc = (s) => String(s).replace(/\|/g, '\\|'); // 表格单元格内管道转义

// ---- 任务投影（2026-11-16 P3）：文档 frontmatter + spec 三件套 + 确认台账 → 单一任务投影 ----
// 纯函数只扫磁盘（root 参数化），INDEX「任务投影」节与看板 /api/board tasks 共用此单源；只做编译视图，
// 不写任何状态文件——权威状态仍是各文档 frontmatter 与台账。口径（全部沿用既有解析，不发明新口径）：
//   入口 = intents/incidents/*.md；L1 plan 无同名入口时「L1 plan 即入口」（对照看板 detectAlerts 孤儿口径）；
//   spec 齐缺看两处：specs/<名>/ 三件套包（spec.md 英文键 status + tasks.md 勾验 + verify-report.md「结论:」，
//   对照 check-spec-packages）与同名 spec 文档（specs/<名>.md，中文键 状态，fill-spec/stages 口径）——
//   包缺席但文档在 = Design 已起步，tasks/verify 只存在于包；
//   确认数 = ledger-loader 单源（主台账 ∪ confirmations.d 分片，doc|stage|fingerprint 去重取末次）按文档
//   基名匹配——行内 doc 字段（workflow/<type>/<名>.md）缺失或基名不合即不计数；同族同名件共享一份计数；
//   nextHint 为 advisory 文案（产物齐缺决定推进），查表产出非门禁，不改任何状态。
const NEXT_HINTS = {
  dropped: '已放弃（留档）',
  closed: '已关单',
  draft: '待确认（draft）',
  noPlan: '待计划（缺 plan）',
  noSpec: '待 Design（缺 spec）',
  noVerify: '待验证（缺 verify-report）',
  fail: 'verify 结论 fail，待修复',
  partial: 'verify 结论 partial，待补验',
  ready: '齐备，待关单',
};

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// spec 投影：tasks/verify 只在三件套包里；包缺席时以同名 spec 文档补「Design 在场」与中文键状态
function readSpecProjection(wf, name) {
  const pkg = path.join(wf, 'specs', name);
  const pkgText = readText(path.join(pkg, 'spec.md'));
  const docText = readText(path.join(wf, 'specs', `${name}.md`));
  if (pkgText == null && docText == null) return null;
  const tasksText = readText(path.join(pkg, 'tasks.md'));
  const total = tasksText ? (tasksText.match(/^\s*[-*] \[[ xX]\]/gm) || []).length : 0;
  const checked = tasksText ? (tasksText.match(/^\s*[-*] \[[xX]\]/gm) || []).length : 0;
  const verifyText = readText(path.join(pkg, 'verify-report.md'));
  const vm = verifyText ? verifyText.match(/^\s*结论\s*[:：]\s*(pass|fail|partial)\b/im) : null; // 对照 check-spec-packages 口径
  const pkgStatus = pkgText != null ? parseDoc(pkgText).meta.status : '';
  const docStatus = docText != null ? parseDoc(docText).meta['状态'] : '';
  return {
    present: true,
    specStatus: pkgStatus || docStatus || '（未填）',
    tasksChecked: checked,
    tasksTotal: total,
    verifyConclusion: vm ? vm[1] : null,
  };
}

// advisory hint 查表：入口状态 × plan/spec/verify 齐缺 → NEXT_HINTS 键（首条命中即返回）。
// needsPlan 由调用方按入口文档实况算好（对照看板：intent 一律要 plan；incident 非 legacy 且 L1-L3
// 要 plan；plan 即入口自然自带）——投影载荷不携带 flow 字段，查表不读载荷外字段。
function nextHintKey(t, needsPlan) {
  if (ENUMS['doc.status.abandoned'].includes(t.status)) return 'dropped';
  if (t.status === 'closed' || ENUMS['doc.status.terminal'].includes(t.status)) return 'closed';
  if (t.status === 'draft') return 'draft';
  if (needsPlan && !t.plan) return 'noPlan';
  if (['L2', 'L3'].includes(t.level) && !t.spec) return 'noSpec'; // 对照看板：L0/L1 不建 spec
  if (t.spec && !t.spec.verifyConclusion) return 'noVerify';
  if (t.spec && t.spec.verifyConclusion !== 'pass') return t.spec.verifyConclusion; // fail / partial
  return 'ready';
}

// 目录直下文档清单（对照 scan()：排除 _TEMPLATE.md，中文键 frontmatter，日期兜底同口径；目录缺失 = 无任务）
function listEntryDocs(wf, type) {
  let files;
  try { files = fs.readdirSync(path.join(wf, type)); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
    const text = readText(path.join(wf, type, f));
    if (text == null) continue; // 读瞬间被写等瞬时态，跳过
    const { meta, title } = parseDoc(text);
    out.push({
      name: f.slice(0, -3),
      status: meta['状态'] || '（未填）',
      level: meta['级别'] || '—',
      date: meta['日期'] || meta['发现'] || f.slice(0, 10),
      module: meta['模块'] || '—',
      flow: meta['流程'] || '',
      title: title || f.slice(0, -3),
    });
  }
  return out;
}

// 任务投影：按入口文档聚合（每入口一任务），排序稳定（date, name）
export function projectTasks(root) {
  const wf = path.join(root, 'workflow');
  const entries = [];
  for (const [type, entryType] of [['intents', 'intent'], ['incidents', 'incident']]) {
    for (const d of listEntryDocs(wf, type)) entries.push({ ...d, entryType });
  }
  const plans = listEntryDocs(wf, 'plans');
  const planByName = new Map(plans.map((p) => [p.name, p]));
  for (const p of plans) {
    if (p.level === 'L1' && !entries.some((e) => e.name === p.name)) entries.push({ ...p, entryType: 'plan' });
  }
  const confirmByBase = new Map();
  for (const row of loadAllConfirmations(root)) {
    const base = String(row.doc || '').split(/[\\/]/).pop();
    if (base) confirmByBase.set(base, (confirmByBase.get(base) || 0) + 1);
  }
  const tasks = entries.map((e) => {
    const plan = planByName.has(e.name) ? { status: planByName.get(e.name).status } : null;
    // plan 配对要求（对照看板 detectAlerts「入口缺 plan」：intent 一律；incident 非 legacy 且 L1-L3）
    const needsPlan = e.entryType === 'intent'
      || (e.entryType === 'incident' && e.flow !== 'legacy' && ['L1', 'L2', 'L3'].includes(e.level));
    const t = {
      name: e.name,
      entryType: e.entryType,
      level: e.level,
      status: e.status,
      module: e.module,
      date: e.date,
      title: e.title,
      plan,
      spec: readSpecProjection(wf, e.name),
      confirmations: confirmByBase.get(`${e.name}.md`) || 0,
      nextHint: '',
    };
    t.nextHint = NEXT_HINTS[nextHintKey(t, needsPlan)] || NEXT_HINTS.ready;
    return t;
  });
  tasks.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return tasks;
}

function scan() {
  const docs = [];
  for (const type of DOC_TYPES) {
    const dir = path.join(WORKFLOW, type);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
      const name = f.slice(0, -3);
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const { meta, title } = parseDoc(text);
      docs.push({
        type,
        file: `${type}/${f}`,
        status: meta['状态'] || '（未填）',
        level: meta['级别'] || '—',
        date: meta['日期'] || meta['发现'] || name.slice(0, 10),
        module: meta['模块'] || '—',
        title: title || name,
        accept: parseAcceptance(text),
      });
    }
  }
  return docs;
}

function render(docs, tasks) {
  const active = docs.filter((d) => ACTIVE_STATUS.includes(d.status));
  active.sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type) || a.file.localeCompare(b.file));
  const arch = docs.filter((d) => !ACTIVE_STATUS.includes(d.status));

  const rows = active.map((d) =>
    `| ${TYPE_LABEL[d.type]} | ${esc(d.level)} | ${esc(d.status)} | ${esc(d.date)} | ${esc(d.module)} | ${esc(d.title)} | ${d.accept ? `☑${d.accept.done}/${d.accept.total}` : '—'} |`);

  // 任务投影：活跃任务逐行（projectTasks 已按 date,name 排序）；验收 = spec 包 tasks 勾验，非包任务为 —
  const activeTasks = tasks.filter((t) => ACTIVE_STATUS.includes(t.status));
  const taskRows = activeTasks.map((t) =>
    `| ${esc(t.name)} | ${esc(t.level)} | ${esc(t.status)} | ${t.spec ? `☑${t.spec.tasksChecked}/${t.spec.tasksTotal}` : '—'} | ${t.spec && t.spec.verifyConclusion ? esc(t.spec.verifyConclusion) : '—'} | ${t.confirmations} | ${esc(t.nextHint)} |`);

  const counts = new Map(); // `${type}|${module}` → 数量
  for (const d of arch) {
    const k = `${d.type}|${d.module}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const archRows = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => {
    const [type, module] = k.split('|');
    return `| ${TYPE_LABEL[type]} | ${esc(module)} | ${n} |`;
  });
  const byStatus = new Map();
  for (const d of arch) byStatus.set(d.status, (byStatus.get(d.status) || 0) + 1);
  const statusLine = [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · ');

  return [
    `## 活跃（${active.length}）`,
    '',
    '| 类型 | 级别 | 状态 | 日期 | 模块 | 标题 | 验收 |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `## 任务投影（${activeTasks.length}）`,
    '',
    '| 名称 | 级别 | 状态 | 验收 | verify | 确认 | 下一步 |',
    '|---|---|---|---|---|---|---|',
    ...taskRows,
    '',
    `## 档案计数（${arch.length}，不进表）`,
    '',
    '| 类型 | 模块 | 数量 |',
    '|---|---|---|',
    ...archRows,
    '',
    `终态构成：${statusLine}；查档案用 \`flow-kit run kb-search.mjs "<词>" --status all\`。`,
  ].join('\n');
}

// 差异预览：首尾对齐后取中段变更块（逐行），各方向最多 10 行
function previewDiff(before, after) {
  if (before === after) return;
  const b = before.split(/\r?\n/);
  const a = after.split(/\r?\n/);
  let head = 0;
  while (head < b.length && head < a.length && b[head] === a[head]) head++;
  let tailN = 0;
  while (tailN < b.length - head && tailN < a.length - head && b[b.length - 1 - tailN] === a[a.length - 1 - tailN]) tailN++;
  const removed = b.slice(head, b.length - tailN);
  const added = a.slice(head, a.length - tailN);
  console.log(`  第 ${head + 1} 行起变更：删 ${removed.length} 行 / 增 ${added.length} 行`);
  for (const l of removed.slice(0, 10)) console.log(`    - ${l.slice(0, 140)}`);
  if (removed.length > 10) console.log(`    - …（其余 ${removed.length - 10} 行略）`);
  for (const l of added.slice(0, 10)) console.log(`    + ${l.slice(0, 140)}`);
  if (added.length > 10) console.log(`    + …（其余 ${added.length - 10} 行略）`);
}

// 行尾归一比较（2026-09-30：fresh clone 检出 CRLF、生成段恒 LF——直接字符串相等会在克隆环境假阳性
// 「漂移」（doctor §6 与 check-loop 检查 11 均经 --check 判定）；仅内容差异才算漂移）
const normEol = (s) => String(s).replace(/\r\n/g, '\n');

// isMain 守卫（2026-11-16 P3）：projectTasks 被看板 import 复用，import 不得触发生成/写盘
const isMain = process.argv[1] && process.argv[1].endsWith('gen-workflow-index.mjs');
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
  const unknown = args.filter((a) => !['--dry-run', '--check'].includes(a));
  if (unknown.length) { console.error(`❌ 未知参数：${unknown.join(' ')}\n\n${USAGE}`); process.exit(1); }
  const DRY = args.includes('--dry-run');
  const CHECK = args.includes('--check');

  // ---- 组装：锚点内整段重写，锚点外（含首次创建时的 HEADER）原样保留 ----
  const docs = scan();
  const tasks = projectTasks(process.cwd());
  const existing = fs.existsSync(INDEX_P) ? fs.readFileSync(INDEX_P, 'utf8') : '';
  const inner = `${BEGIN}\n\n${render(docs, tasks)}\n\n${END}`;
  let out;
  if (existing.includes(BEGIN) && existing.includes(END) && existing.indexOf(BEGIN) < existing.indexOf(END)) {
    out = existing.slice(0, existing.indexOf(BEGIN)) + inner + existing.slice(existing.indexOf(END) + END.length);
  } else if (existing.includes(BEGIN) || existing.includes(END)) {
    // 锚点残缺（END 被手工截断 / 顺序颠倒）：fail-loud 不写盘——曾走 append 分支产生双 GENERATED 区，旧区永不清理（2026-09-24）
    console.error('❌ workflow/INDEX.md 生成锚点不完整（GENERATED:BEGIN/END 须成对且 BEGIN 在前）——手工修复锚点后重跑，未写盘');
    process.exit(1);
  } else {
    out = (existing ? existing.replace(/\s*$/, '') + '\n\n' : HEADER) + inner + '\n';
  }

  const nActive = docs.filter((d) => ACTIVE_STATUS.includes(d.status)).length;
  const nArch = docs.length - nActive;
  const summary = `活跃 ${nActive} 行 / 任务 ${tasks.length} / 档案 ${nArch} 篇 / ${Buffer.byteLength(out, 'utf8')} B`;

  if (CHECK) {
    if (normEol(out) === normEol(existing)) {
      console.log(`✅ workflow/INDEX.md 与磁盘一致（${summary}）`);
      process.exit(0);
    }
    console.error(`❌ workflow/INDEX.md 与磁盘不一致（${summary}）——跑 flow-kit run gen-workflow-index.mjs 重新生成`);
    previewDiff(existing, out);
    process.exit(1);
  }

  if (DRY) {
    console.log(`🔎 --dry-run：未写盘（${summary}）`);
    if (normEol(out) === normEol(existing)) console.log('• workflow/INDEX.md：无变化');
    else previewDiff(existing, out);
  } else {
    fs.writeFileSync(INDEX_P, out, 'utf8');
    console.log(`✅ 已生成 workflow/INDEX.md：${summary}`);
  }
}

if (isMain) main();
