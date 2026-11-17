#!/usr/bin/env node
// agg-skill-usage — 技能复盘候选（2026-11-17，BACKLOG #19；对照 pstack reflect/correct 的「复盘回写技能」回路）
// 定位：把会话经验日志聚合成两类**候选**，交 dream-run 阶段 H2 报告。零写操作、退出码恒 0
//   （含无输入 / 数据不充分）；裁决与改正文由主智能体执行，本脚本不碰技能文件。
// 诚实边界：
//   - 源是 session-log 的**文本提及**（`.agents/cache/session-logs/*.jsonl`），不是宿主装载遥测——
//     引擎无 skill load/trigger 事件面（类型闭集 decision/failure/correction/refusal/note），
//     故「零提及」只是失用**候选**，不等于「未装载」。
//   - 失用候选须数据充分：窗口内有数据月 < --months（默认 3）不产失用候选（年轻遥测不得制造假候选，
//     口径同 agg-kb-usage / agg-judgments --retire-candidates）；关联候选是正信号，不受此限。
//   - 关联候选只做文本关联（correction/failure/refusal 行提及技能名），不判因果。
//   - **正文漂移不在此判定**：既有面 = dream B（gen-engine-map --check 技能清单）+ `flow-kit skills lint`
//     （lockfile 正文漂移 / 触发词冲突 / description 预算）+ kit 侧 lint:templates（stage-skills / render）。
// 用法：flow-kit run agg-skill-usage.mjs [--days 90] [--months 3]
// 纪律：候选不改技能正文；改正文须先按 .agents/skills/eval/SKILL.md 跑双臂（Δ / 翻转口径同
//   review-method/golden-set.md 的方差复跑），再 agent-eval record 落凭证才算入面。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvents } from './session-log.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOW_KIT_PROJECT_ROOT || process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const SKILLS_REL = path.join('.agents', 'skills');
// 关联候选只取「纠错/失败/拒绝」三类：decision/note 提及是正常装载痕迹，不构成修正信号。
const LINKED_TYPES = new Set(['correction', 'failure', 'refusal']);
const MAX_ROWS_PER_SKILL = 3;
const EXCERPT_CHARS = 80;

export function listSkills(root) {
  const dir = path.join(root, SKILLS_REL);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

// 整词边界：技能名是 kebab-case，避免 eval 命中 evaluate、tdd 命中 tddx。
function mentions(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9-])${escaped}($|[^a-z0-9-])`, 'i').test(text);
}

export function scanSkillCandidates(skills, events, { minMonths = 3 } = {}) {
  const dataMonths = new Set(events.map((row) => String(row.ts).slice(0, 7)));
  const sufficient = dataMonths.size >= minMonths;
  const hits = new Map(skills.map((name) => [name, []]));
  for (const row of events) {
    const text = [row.text, row.ref, row.tag].filter(Boolean).join(' ');
    for (const name of skills) {
      if (mentions(text, name)) hits.get(name).push(row);
    }
  }
  const idle = sufficient ? skills.filter((name) => hits.get(name).length === 0) : [];
  const linked = [];
  for (const name of skills) {
    const rows = hits.get(name).filter((row) => LINKED_TYPES.has(row.type));
    if (rows.length) linked.push({ skill: name, rows: rows.slice(-MAX_ROWS_PER_SKILL), total: rows.length });
  }
  return { dataMonths: dataMonths.size, sufficient, idle, linked };
}

const excerpt = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat;
};

function main() {
  const argv = process.argv.slice(2);
  let days = 90;
  let minMonths = 3;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--days') days = Number.parseInt(argv[++i] ?? '', 10);
    else if (arg === '--months') minMonths = Number.parseInt(argv[++i] ?? '', 10);
    else if (arg === '--help') {
      console.log(`用法: flow-kit run agg-skill-usage.mjs [--days N] [--months N]
  --days N      提及统计窗口（默认 90 天）
  --months N    有数据月下限（默认 3）——不足则不产失用候选（关联候选不受此限）`);
      return 0;
    } else {
      console.error(`未知选项: ${arg}`);
      return 2;
    }
  }
  if (!Number.isInteger(days) || days < 1) {
    console.error('--days 须为正整数');
    return 2;
  }
  if (!Number.isInteger(minMonths) || minMonths < 1) {
    console.error('--months 须为正整数');
    return 2;
  }

  const skills = listSkills(ROOT);
  const events = readEvents(ROOT, { days });
  console.log(`技能复盘候选（近 ${days} 天会话日志；只机械筛查，裁决走主智能体）：`);
  if (!skills.length) {
    console.log('  ℹ️ 无输入：项目侧无 .agents/skills/*/SKILL.md——不产候选');
    return 0;
  }
  if (!events.length) {
    console.log('  ℹ️ 无输入：窗口内无会话日志（.agents/cache/session-logs/）——不能把「没有经验」当成「没有错误」');
    console.log('  在关键节点执行：flow-kit run session-log.mjs append --type correction --text "…" [--ref path]');
    return 0;
  }

  const { dataMonths, sufficient, idle, linked } = scanSkillCandidates(skills, events, { minMonths });
  if (!sufficient) {
    console.log(`  失用候选：数据不充分（有数据月 ${dataMonths} < 下限 ${minMonths}）——不产候选，继续积累 session-log`);
  } else if (!idle.length) {
    console.log('  失用候选：无（每个技能窗口内都有提及）');
  } else {
    console.log('  失用候选（窗口内零提及；零提及 ≠ 未装载，先判是否真该装载）：');
    for (const name of idle) {
      console.log(`    ${name}  .agents/skills/${name}/SKILL.md  拟改落点：description 触发词 / new-task §1c 装载表`);
    }
  }
  if (!linked.length) {
    console.log('  关联候选：无（correction/failure/refusal 行未提及任何技能）');
  } else {
    console.log('  关联候选（纠错/失败/拒绝行提及技能名——文本关联，不判因果）：');
    for (const item of linked) {
      for (const row of item.rows) {
        const ref = row.ref ? `  ref=${row.ref}` : '';
        console.log(`    ${item.skill}  ${String(row.ts).slice(0, 10)} ${row.type}  「${excerpt(row.text)}」${ref}`);
      }
      if (item.total > item.rows.length) console.log(`    ${item.skill}  …另有 ${item.total - item.rows.length} 条（见原始日志）`);
      console.log(`    ${item.skill}  拟改落点：.agents/skills/${item.skill}/SKILL.md 正文（触发条件 / 步骤 / 红线）`);
    }
  }
  console.log('  正文漂移：不在此判定——既有面 dream B（gen-engine-map --check）+ flow-kit skills lint（lockfile / 触发词）');
  console.log('纪律：候选不改技能正文；改正文须先按 .agents/skills/eval/SKILL.md 跑双臂（Δ / 翻转口径同 golden-set 方差复跑），');
  console.log('      再 flow-kit run agent-eval.mjs record 落凭证才算入面（签名覆盖 .agents/skills/**）。');
  console.log(`（扫描 ${skills.length} 个技能 / ${events.length} 条日志，有数据月 ${dataMonths}；失用 ${idle.length} / 关联 ${linked.length}）`);
  return 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('agg-skill-usage.mjs');
if (isMain) process.exit(main());