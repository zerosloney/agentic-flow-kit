// flow-kit gate-checklist：三处口径一致性检查（doctor ↔ check-loop）
// 目的：任何一处加新检查项，另一处不会自动同步——本工具给出对照表 + 缺点告警
// 算法：扫 src/doctor.mjs 的 add('PASS|WARN|FAIL') 调用上下文 + .agents/scripts/check-loop.sh 的 #N 注释行 + [hard-block]/[warning] 标记
//       按关键字重合判定匹配；不匹配 = 缺点
// 用法：node .agents/scripts/gate-checklist.mjs --diff
//       node .agents/scripts/gate-checklist.mjs --json
// 零依赖；不修改 doctor / check-loop 既有检查项；只报告不修复
import fs from 'node:fs';
import path from 'node:path';

function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

// parseDoctorChecks：扫 doctor.mjs 文本找所有 add('PASS|WARN|FAIL', ...) 调用
// 按"概念关键字（msg 前 8 字符去变量）"聚类——同一检查主题的不同 level 分支合并为一个
function parseDoctorChecks(doctorSrc) {
  // 1. 收集所有 add 调用（含行号）
  const hits = [];
  const re = /add\(\s*'(PASS|WARN|FAIL)'\s*,\s*[`']([^`'"]*?)[`'"]/g;
  let m;
  while ((m = re.exec(doctorSrc)) !== null) {
    const lineNum = doctorSrc.slice(0, m.index).split('\n').length;
    hits.push({ level: m[1], msg: m[2], line: lineNum });
  }
  // 2. 提取概念关键字（第一个稳定 token，去掉变量 + 括号内容）
  for (const h of hits) {
    const cleaned = h.msg
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/[（(][^）)]*[）)]/g, ' ')
      .replace(/[^一-龥a-zA-Z0-9_./]/g, ' ')
      .trim();
    const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2 && !/^\d+$/.test(t));
    h.concept = tokens[0] || h.msg.slice(0, 4);
  }
  // 3. 聚类：共享概念词 → 同一主题（行号仅作 hint，过宽时反而误合）
  const order = { PASS: 0, WARN: 1, FAIL: 2 };
  const groups = [];
  for (const h of hits) {
    let merged = false;
    for (const g of groups) {
      if (g.concepts.has(h.concept)) {
        g.items.push(h);
        g.concepts.add(h.concept);
        if (order[h.level] > order[g.rep.level]) g.rep = h;
        merged = true;
        break;
      }
    }
    if (!merged) {
      groups.push({ rep: h, items: [h], concepts: new Set([h.concept]) });
    }
  }
  // 4. 每组取代表
  return groups.map((g) => ({
    concept: g.rep.concept,
    level: g.rep.level,
    msg: g.rep.msg,
    line: g.rep.line,
    branchCount: g.items.length,
  }));
}

// parseCheckLoopChecks：扫 check-loop.sh 注释行（# 1. ... [hard-block]/[warning]）
function parseCheckLoopChecks(clSrc) {
  const checks = [];
  // 多行注释块或单行注释：^\s*#\s*\d+\.\s.*$
  const re = /^\s*#\s*(\d+)\.\s+(.+?)(?:\s*\[(hard-block|warning|advisory)\])?\s*$/gm;
  let m;
  while ((m = re.exec(clSrc)) !== null) {
    const id = m[1];
    const title = m[2].trim();
    const severity = m[3] || null;
    checks.push({ id, title, severity });
  }
  return checks;
}

// matchKeyword：判定 doctor 检查项与 check-loop 检查项是否匹配（关键字重合）
// 关键字表：常见语义重叠词（doctor 概念 → check-loop 标题子串）
const KEYWORD_ALIASES = [
  ['Node', 'Node'], ['目录布局', '目录布局'], ['hooksPath', 'hooksPath'],
  ['kit.json', 'kit.json'], ['占位符', '占位符'], ['INDEX', 'INDEX'],
  ['delegations', 'delegations'], ['delegations', 'agg-delegations'],
  ['owned', 'owned'], ['跨宿主薄适配', '跨宿主'], ['跨宿主', '跨宿主'],
  ['check-loop', 'check-loop'], ['managed', 'managed'],
  ['配对', '配对'], ['三件套', '三件套'], ['incidents', 'incidents'],
  ['引用', '引用'], ['状态', '状态'], ['Adapter', 'Adapter'], ['角色', '角色'],
  ['阶段', '阶段'], ['验收', '验收'], ['文件名', '文件名'], ['迁移', '迁移'],
  ['模块', '模块'], ['预算', '预算'], ['新增 owned', '新增 owned'],
];

function matchDoctorToCheckLoop(doctorTitle, clTitle) {
  // 兼容 concept 字段（doctor 项）— doctorTitle 是字符串
  const d = String(doctorTitle || '');
  const c = String(clTitle || '');
  for (const [dKey, cKey] of KEYWORD_ALIASES) {
    if (d.includes(dKey) && c.includes(cKey)) return dKey;
  }
  return null;
}

export function gateChecklist({ doctorSrc, checkLoopSrc }) {
  const doctor = parseDoctorChecks(doctorSrc);
  const checkLoop = parseCheckLoopChecks(checkLoopSrc);
  // 计算匹配：每个 doctor 项找最近的 cl 项；每个 cl 项找最近的 doctor 项
  const matched = []; // { doctor, cl, by }
  const usedCl = new Set();
  for (const d of doctor) {
    let best = null, bestKey = null;
    for (const c of checkLoop) {
      if (usedCl.has(c.id)) continue;
      const k = matchDoctorToCheckLoop(d.concept, c.title);
      if (k && (!best || d.msg.length > best.doctor.msg.length)) { best = c; bestKey = k; }
    }
    if (best) { matched.push({ doctor: d, cl: best, by: bestKey }); usedCl.add(best.id); }
  }
  const gaps = [];
  for (const d of doctor) if (!matched.find((m) => m.doctor === d)) gaps.push({ kind: 'doctor-only', item: d });
  for (const c of checkLoop) if (!matched.find((m) => m.cl === c)) gaps.push({ kind: 'cl-only', item: c });
  return { doctorCount: doctor.length, checkLoopCount: checkLoop.length, matched, gaps, doctor, checkLoop };
}

function printDiff(result) {
  console.log('▶ flow-kit gate-checklist --diff');
  console.log('  doctor §检查项: ' + result.doctorCount + '  |  check-loop §检查项: ' + result.checkLoopCount + '  |  匹配: ' + result.matched.length);
  console.log('  对照表:');
  for (const m of result.matched) {
    const dLabel = m.doctor.concept + ' (' + m.doctor.level + ')';
    const cLabel = '#' + m.cl.id + ' ' + m.cl.title;
    console.log('    ✓ ' + dLabel + '  ↔  ' + cLabel + '  [' + m.by + ']');
  }
  if (result.gaps.length) {
    console.log('  缺点（任一处有而另一边无）:');
    for (const g of result.gaps) {
      if (g.kind === 'doctor-only') console.log('    ⚠️  doctor 仅有: ' + g.item.level + ' ' + g.item.concept + '（' + g.item.msg.slice(0, 40) + '）');
      else console.log('    ⚠️  check-loop 仅有: #' + g.item.id + ' [' + (g.item.severity || '?') + '] ' + g.item.title);
    }
  } else {
    console.log('  无缺点 ✅');
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('gate-checklist.mjs');
if (isMain) {
  let jsonMode = false, diffMode = false;
  for (const a of process.argv.slice(2)) {
    if (a === '--json') jsonMode = true;
    else if (a === '--diff') diffMode = true;
    else fail('未知选项：' + a + '（flow-kit gate-checklist --diff / --json）');
  }
  const pkgRoot = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  const base = pkgRoot || process.cwd();
  const doctorPath = path.join(base, 'src', 'doctor.mjs');
  const clPath = path.join(base, '.agents', 'scripts', 'check-loop.sh');
  if (!fs.existsSync(doctorPath)) fail('找不到 doctor.mjs：' + doctorPath);
  if (!fs.existsSync(clPath)) fail('找不到 check-loop.sh：' + clPath);
  const doctorSrc = fs.readFileSync(doctorPath, 'utf8');
  const checkLoopSrc = fs.readFileSync(clPath, 'utf8');
  const result = gateChecklist({ doctorSrc, checkLoopSrc });
  if (jsonMode) {
    process.stdout.write(JSON.stringify({
      doctorCount: result.doctorCount,
      checkLoopCount: result.checkLoopCount,
      matched: result.matched.map((m) => ({ doctor: m.doctor.title, cl: '#' + m.cl.id + ' ' + m.cl.title, by: m.by })),
      gaps: result.gaps.map((g) => ({ kind: g.kind, item: g.kind === 'doctor-only' ? g.item.title : '#' + g.item.id + ' ' + g.item.title })),
    }, null, 2) + '\n');
  } else {
    printDiff(result);
  }
  // diff/json 模式总 exit 0；缺点存在不视作错误（人类阅读用）
  process.exit(0);
}
export default gateChecklist;