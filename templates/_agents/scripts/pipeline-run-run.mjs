// pipeline-run-run.mjs — run 存储层（2026-10-08 engine-quality-batch，L2 自 pipeline-run.mjs 拆出）
// ctxEnv / moduleList / runFileOf / loadRun / saveRun / emit / latestRunId / newRunId + 时间工具（nowIso/today/pad）——
// run 文件（.agents/cache/pipeline-runs/<id>.json）原子读写与事件流；run schema 零变化。
// 测试注入契约原样：PIPELINE_RUN_ROOT / PIPELINE_RUN_BIN / PIPELINE_RUN_GIT_BIN（ctxEnv）与
// PIPELINE_RUN_TODAY（today——时钟依赖消除锚，spec §测试注入契约）。
import fs from 'node:fs';
import path from 'node:path';

export const nowIso = () => new Date().toISOString();
export const today = () => process.env.PIPELINE_RUN_TODAY || nowIso().slice(0, 10);
export const pad = (n) => String(n).padStart(2, '0');

// ── 环境解析（测试注入点） ─────────────────────────────────────────────
export function ctxEnv(overrideRoot) {
  const root = path.resolve(overrideRoot || process.env.PIPELINE_RUN_ROOT || process.cwd());
  const bin = path.resolve(process.env.PIPELINE_RUN_BIN || path.join(root, '.agents', 'scripts'));
  const gitPrefix = (process.env.PIPELINE_RUN_GIT_BIN || 'git').split(/\s+/).filter(Boolean);
  return { root, bin, gitPrefix, runsDir: path.join(root, '.agents', 'cache', 'pipeline-runs') };
}

export function moduleList(ctx) {
  try {
    return fs.readFileSync(path.join(ctx.root, '.agents', 'workflow-modules.txt'), 'utf8')
      .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch { return ['backend', 'frontend', 'ui', 'infra', 'integration', 'pipeline', 'wiki']; } // 夹具缺表时的回退默认（warning 由调用方打）
}

// ── run 文件（原子写；事件 append-only） ──────────────────────────────
export function runFileOf(ctx, runId) { return path.join(ctx.runsDir, `${runId}.json`); }

export function loadRun(ctx, runId) {
  const f = runFileOf(ctx, runId);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

export function saveRun(ctx, run) {
  fs.mkdirSync(ctx.runsDir, { recursive: true });
  run.updatedAt = nowIso();
  const f = runFileOf(ctx, run.runId);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n');
  fs.renameSync(tmp, f);
}

export function emit(run, ev) { run.events.push({ t: nowIso(), ...ev }); }

export function latestRunId(ctx) {
  if (!fs.existsSync(ctx.runsDir)) return null;
  const ids = fs.readdirSync(ctx.runsDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  for (let i = ids.length - 1; i >= 0; i--) {
    const r = loadRun(ctx, ids[i]);
    if (r && !['done', 'aborted'].includes(r.stopType)) return ids[i];
  }
  return ids[ids.length - 1] || null;
}

export function newRunId(requirement) {
  const d = new Date();
  const ascii = (requirement.toLowerCase().match(/[a-z0-9]{2,}/g) || []).slice(0, 3).join('-') || 'task';
  const rand = Math.random().toString(36).slice(2, 6);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${ascii}-${rand}`;
}
