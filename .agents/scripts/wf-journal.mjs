// wf-journal — 编排执行 run journal（2026-09-26 orchestration-journal-human，审查改进方向 4）
// 用途：宿主 AI 按 .agents/workflows/_TEMPLATE.md 纪律，每个 stage 每次尝试出结果（pass/fail/blocked）
//       记一行 JSONL；中止后重跑先看 status——已 pass 不重跑，从就绪层续（断点续跑与重试计量）。
// 存储：.agents/cache/orchestration-runs.jsonl（本地运行态缓存，已 gitignore，可丢弃——丢失仅失去
//       续跑记忆，不影响任何门禁；status 对空 journal 天然全量输出不误报）。
// 行 schema：{ ts, run, wf, stage, form?, status, attempt, note? }
//   run = <wf>@<YYYYMMDD-HHMM>；同 run 同 stage 多行按末次状态生效（重试后过 = pass），attempt 取最大。
// 语义口径（与 _TEMPLATE.md 四形态一致；stages 表解析复用 workflows-check.mjs 的 parseStages 单源）。
// 用法：
//   node .agents/scripts/wf-journal.mjs add --wf <编排名> --stage <id> --status <pass|fail|blocked>
//        [--form role|step|gate|human] [--attempt N] [--note <文本>] [--run <runId>] [--new-run]
//        [--journal <文件>]（默认 .agents/cache/orchestration-runs.jsonl，按 cwd）
//   node .agents/scripts/wf-journal.mjs status --wf <编排名> [--run <runId>] [--journal <文件>] [--wf-root <目录>]
// 测试：node templates/_agents/scripts/wf-journal.test.mjs（fixture + 真实仓库场景）
import fs from 'node:fs';
import path from 'node:path';
import { parseStages } from './workflows-check.mjs';

function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

const DEFAULT_JOURNAL = () => path.join(process.cwd(), '.agents', 'cache', 'orchestration-runs.jsonl');
const DEFAULT_WF_ROOT = () => path.join(process.cwd(), '.agents', 'workflows');
const STATUSES = ['pass', 'fail', 'blocked'];
const FORMS = ['role', 'step', 'gate', 'human'];

// 读 journal 原始行（文件不存在/空 → []；目录不存在自动可建由 add 处理）
export function readJournalLines(journalFile) {
  try {
    return fs.readFileSync(journalFile, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  } catch {
    return [];
  }
}

// replayRun：重放一个 run 的记录 → { state: {stage: {status, attempt, form, note, ts}}, total, bad }
//   末次状态生效；attempt 取出现过的最大值；坏行跳过（计数返回，调用方决定告警口径）
export function replayRun(rawLines, run) {
  const state = {};
  let total = 0;
  let bad = 0;
  for (const line of rawLines) {
    let j;
    try { j = JSON.parse(line); } catch { bad++; continue; }
    if (!j || typeof j !== 'object' || j.run !== run) continue;
    if (!j.stage || !STATUSES.includes(j.status)) { bad++; continue; }
    total++;
    const prev = state[j.stage];
    state[j.stage] = {
      status: j.status,
      attempt: Math.max(prev?.attempt ?? 0, Number(j.attempt) || 1),
      ...(j.form ? { form: j.form } : {}),
      ...(j.note ? { note: j.note } : {}),
      ts: j.ts,
    };
  }
  return { state, total, bad };
}

// latestRun：journal 中该 wf 最后一条的 run id（无记录 → null）
export function latestRun(rawLines, wf) {
  let run = null;
  for (const line of rawLines) {
    try {
      const j = JSON.parse(line);
      if (j && j.wf === wf && j.run) run = j.run;
    } catch { /* 坏行不参与 run 推断 */ }
  }
  return run;
}

// planStages：stages（parseStages 产物）× 状态 → { passed, ready, pending, blocked }
//   passed  = 末次 pass；ready = 依赖全 pass 且自身未 pass（末次 fail 标注重试就绪）；blocked = 自身末次 blocked；pending = 其余
export function planStages(stages, state) {
  const passed = [];
  const ready = [];
  const pending = [];
  const blocked = [];
  const passedSet = new Set(stages.filter((s) => state[s.id]?.status === 'pass').map((s) => s.id));
  for (const s of stages) {
    const st = state[s.id];
    if (st?.status === 'pass') { passed.push({ id: s.id }); continue; }
    if (st?.status === 'blocked') { blocked.push({ id: s.id, note: st.note || '' }); continue; }
    const deps = s.after ? s.after.split(/[,，、\s]+/).filter(Boolean) : [];
    if (deps.every((d) => passedSet.has(d))) {
      ready.push({ id: s.id, ...(st?.status === 'fail' ? { retry: st.attempt } : {}) });
    } else {
      pending.push({ id: s.id, ...(deps.some((d) => state[d] && state[d].status !== 'pass') && (state[deps.find((d) => state[d] && state[d].status !== 'pass')]?.status === 'blocked') ? { depBlocked: true } : {}) });
    }
  }
  return { passed, ready, pending, blocked };
}

const pad = (n) => String(n).padStart(2, '0');
const runIdOf = (wf, d = new Date()) =>
  `${wf}@${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

function parseArgs(argv) {
  const out = { cmd: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i] ?? true;
    else fail(`未知参数：${a}（用法见文件头注释）`);
  }
  return out;
}

const isMain = process.argv[1] && process.argv[1].endsWith('wf-journal.mjs');
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  const journalFile = a.journal || DEFAULT_JOURNAL();
  if (a.cmd === 'add') {
    if (!a.wf || !a.stage || !a.status) fail('add 必填：--wf / --stage / --status（pass|fail|blocked）');
    if (!STATUSES.includes(a.status)) fail(`--status 须为 ${STATUSES.join('|')}（现 ${a.status}）`);
    if (a.form && !FORMS.includes(a.form)) fail(`--form 须为 ${FORMS.join('|')}（现 ${a.form}）`);
    const lines = readJournalLines(journalFile);
    const run = a.run || (a['new-run'] ? runIdOf(a.wf) : latestRun(lines, a.wf) || runIdOf(a.wf));
    const attempt = a.attempt
      ? Number(a.attempt)
      : lines.filter((l) => { try { const j = JSON.parse(l); return j.run === run && j.stage === a.stage; } catch { return false; } }).length + 1;
    const row = {
      ts: new Date().toISOString(), run, wf: a.wf, stage: a.stage,
      status: a.status, attempt,
      ...(a.form ? { form: a.form } : {}), ...(a.note ? { note: a.note } : {}),
    };
    fs.mkdirSync(path.dirname(journalFile), { recursive: true });
    fs.appendFileSync(journalFile, JSON.stringify(row) + '\n');
    console.log(`✅ journal += ${a.wf}/${a.stage} ${a.status}（attempt ${attempt}，run ${run}）`);
    process.exit(0);
  }
  if (a.cmd === 'status') {
    if (!a.wf) fail('status 必填：--wf（编排名）');
    const wfRoot = a['wf-root'] || DEFAULT_WF_ROOT();
    const wfFile = path.join(wfRoot, `${a.wf}.md`);
    if (!fs.existsSync(wfFile)) fail(`找不到编排脚本：${wfFile}`);
    const stages = parseStages(fs.readFileSync(wfFile, 'utf8'));
    if (!stages) fail(`编排脚本缺 stages 表：${wfFile}`);
    const lines = readJournalLines(journalFile);
    const run = a.run || latestRun(lines, a.wf);
    console.log(`▶ wf-journal status — ${a.wf}${run ? ` @ ${run}` : '（无 journal 记录，按首轮输出）'}`);
    if (!run) {
      const { ready, pending } = planStages(stages, {});
      console.log(`  ▶ 就绪（第 0 层，${ready.length}）：${ready.map((s) => s.id).join('、') || '无'}`);
      console.log(`  ⏸ 待定（${pending.length}）：${pending.map((s) => s.id).join('、') || '无'}`);
      process.exit(0);
    }
    const { state, total, bad } = replayRun(lines, run);
    if (bad) console.error(`⚠️ journal 坏行 ${bad} 条已跳过（缓存可丢弃，不影响门禁）`);
    const plan = planStages(stages, state);
    console.log(`  （${total} 条记录）`);
    console.log(`  ✅ 已完成（${plan.passed.length}）：${plan.passed.map((s) => s.id).join('、') || '无'}`);
    console.log(`  ▶ 就绪（${plan.ready.length}）：${plan.ready.map((s) => (s.retry ? `${s.id}（重试就绪×${s.retry}）` : s.id)).join('、') || '无'}`);
    console.log(`  ⏸ 待定（${plan.pending.length}）：${plan.pending.map((s) => s.id + (s.depBlocked ? '（依赖中止）' : '')).join('、') || '无'}`);
    console.log(`  ⛔ 中止（${plan.blocked.length}）：${plan.blocked.map((s) => `${s.id}${s.note ? `（${s.note}）` : ''}`).join('、') || '无'}`);
    process.exit(0);
  }
  fail(`未知命令：${a.cmd ?? ''}（add | status，用法见文件头注释）`);
}
export default { replayRun, planStages, latestRun, readJournalLines };
