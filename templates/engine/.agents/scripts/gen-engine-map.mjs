#!/usr/bin/env node
// gen-engine-map.mjs — 生成式引擎地图（2026-10-21 门禁极小化第 3 批 W2）
// 用途：一页冷启动地图——引擎怎么执行、几个卡口、几道门、台账在哪、机制状态如何，
//       全部从单源**现场取数**渲染到 .agents/notes/engine-map.md。禁手写（手写地图自己会漂，
//       同 narrative-claims 哲学）；--check 防漂移：改引擎后须重生成随同提交。
// 单源：.githooks/ 文件清单｜verify.mjs GATES（spawn --list，即时不执行门）｜
//       check-loop.mjs SECTIONS（lane 计数）｜mechanism-registry.md（parseRegistry）｜
//       commands/skills/roles 目录清单。静态文字仅「执行模型/卡口职责/台账用途」三段说明性内容。
// 用法：flow-kit run gen-engine-map.mjs [--check] [--root <仓库根>]
// 测试面已随引擎减重退役（2026-10-28，owner 决策），本脚本现无测试兜底
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MECHANISM_STATUSES as STATUSES, parseMechanismRegistry as parseRegistry } from './policy.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : ''; };
const ROOT = path.resolve(argOf('--root') || process.env.FLOW_KIT_PROJECT_ROOT || path.join(SCRIPT_DIR, '..', '..'));
const SCRIPTS_DIR = process.env.FLOW_KIT_RUNTIME_SCRIPTS || path.join(ROOT, '.agents', 'scripts');
const MAP_REL = path.join('.agents', 'notes', 'engine-map.md');

// ---- 单源取数 ----
function readText(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}
const listDir = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readdirSync(p).sort() : [];
};
// 只列目录（2026-10-24 复核 P1）：技能面此前直接列全部条目，未跟踪的 tfs-pr.zip 被当成第 23 个技能
// 写进地图，干净检出上 --check 必红（生成物依赖工作区脏文件，不可复现）。只用于目录型载体。
const listSubdirs = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return [];
  return fs.readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
};

function verifyGateIds() {
  const verify = path.join(SCRIPT_DIR, 'verify.mjs');
  const r = spawnSync(process.execPath, [verify, '--list'], {
    encoding: 'utf8', env: { ...process.env, CHECK_LOOP_ROOT: ROOT, RUN_E2E: '' },
  });
  return String(r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('['));
}

function loopSections() {
  const text = readText(path.join(SCRIPTS_DIR, 'check-loop.mjs'));
  if (text === null) return null;
  const out = [];
  for (const m of text.matchAll(/\{\s*lane:\s*'(hard|hygiene)'\s*,\s*run:\s*(\w+)\s*\}/g)) out.push({ lane: m[1], id: m[2] });
  return out;
}

function registrySummary() {
  const text = readText(path.join('.agents', 'config', 'mechanism-registry.md'));
  if (text === null) return null;
  const rows = parseRegistry(text);
  const by = (s) => rows.filter((r) => r.status === s);
  const revisits = rows.filter((r) => /复评\s*\d{4}-\d{2}-\d{2}/.test(r.deadline))
    .map((r) => ({ name: r.name, date: String(r.deadline).match(/复评\s*(\d{4}-\d{2}-\d{2})/)[1] }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const [ACTIVE, PENDING, RETIRED] = STATUSES;
  return {
    total: rows.length, active: by(ACTIVE).length, retired: by(RETIRED).length, pending: by(PENDING).length,
    retiredNames: by(RETIRED).map((r) => r.name), revisits,
  };
}

// ciSummary：CI 触发面与各分支实跑面（2026-10-27 修「漂移门恒真」；2026-10-29 支持 PR 条件）
// 动机：本页此前的 CI 行是**硬编码字符串**，与 azure-pipelines.yml 无任何取数关系——yml 改了
// （2026-10-26 恢复 develop 触发）而「engine-map --check」仍恒绿，漂移门对真漂移完全无感。
// 改为现场解析 yml：trigger 分支列表 + 各 step 的 condition（Build.SourceBranch 直推 /
// System.PullRequest.TargetBranch PR 目标分支）+ 实际命令。
// PR 独占变量：直推构建里为空，出现它们才是「PR validation 才跑」的判据（TargetBranch 不算——
// 双向门 or(直推, PR) 里它只是 PR 侧的臂）。
const PR_EXCLUSIVE_RE = /System\.PullRequest\.(?:PullRequestId|SourceCommitId)/;
function ciSummary() {
  const text = readText('azure-pipelines.yml');
  if (text === null) return null;
  const branches = [];
  const tIdx = text.indexOf('trigger:');
  if (tIdx >= 0) {
    const inc = text.indexOf('include:', tIdx);
    if (inc >= 0) {
      for (const line of text.slice(inc + 'include:'.length).split(/\r?\n/)) {
        const m = line.match(/^\s*-\s*([A-Za-z0-9_./-]+)\s*$/);
        if (m) { branches.push(m[1]); continue; }
        if (line.trim() && !/^\s*-/.test(line)) break;
      }
    }
  }
  // 条件谓词：eq(variables['Build.SourceBranch'],'refs/heads/X') = X 直推；
  //           eq(variables['System.PullRequest.TargetBranch'],'refs/heads/X') = PR→X。
  const PRED_RE = /eq\(variables\['(Build\.SourceBranch|System\.PullRequest\.TargetBranch)'\],\s*'refs\/heads\/([^']+)'\)/g;
  const steps = [];
  for (const chunk of text.split(/^\s*-\s*(?:task|checkout):/m).slice(1)) {
    const name = (chunk.match(/displayName:\s*(.+)/) || [])[1];
    const args = (chunk.match(/arguments:\s*(.+)/) || [])[1];
    const cmd = (args || name || '').trim();
    if (!cmd) continue;
    const push = new Set();
    const pr = new Set();
    const condLine = ((chunk.match(/condition:\s*(.+)/) || [])[1] || '').trim();
    for (const m of condLine.matchAll(PRED_RE)) {
      (m[1] === 'Build.SourceBranch' ? push : pr).add(m[2]);
    }
    // PR 独占判定（2026-11-11 P0 修正）：原实现只要 condition 或命令里出现任何 System.PullRequest.*
    // 就判 prOnly（TargetBranch 与命令参数都算），把 or(main 直推, PR→main) 的双向门误标成
    // 「仅 PR validation 生效——直推构建 skipped」，main 直推列因此漏掉 verify --full
    // （accuracy eval 2026-11-11 P2 以 azure-pipelines.yml:100-105 原始条件证伪）。
    // 新判据只看字面：condition 含 PR 独占变量（PullRequestId / SourceCommitId——直推构建里为空），
    // 且**无任何直推臂**，才算 PR 独占；TargetBranch 只是 PR 侧的臂，不是独占证据。
    const prOnly = condLine !== '' && PR_EXCLUSIVE_RE.test(condLine) && push.size === 0;
    steps.push({ cmd, condLine, push: [...push], pr: [...pr], prOnly });
  }
  if (!branches.length) return null;
  const cmdOf = (list) => (list.length ? list.join(' + ') : '（无）');
  // 三种作用面：无 condition = 直推与 PR 全跑；有条件 = 只按谓词列出的分支；PR 独占 = 只进 PR 列。
  const runsPush = (s, b) => (s.condLine === '' ? true : !s.prOnly && s.push.includes(b));
  const runsPr = (s, b) => (s.condLine === '' ? true : s.pr.includes(b) || (s.prOnly && s.pr.length === 0));
  const rows = new Map(branches.map((b) => [b, {
    push: steps.filter((s) => runsPush(s, b)).map((s) => s.cmd),
    pr: steps.filter((s) => runsPr(s, b)).map((s) => (s.prOnly ? `${s.cmd}（仅 PR validation 生效——直推构建 skipped）` : s.cmd)),
  }]));
  assertCiGrounding(steps, rows, branches);
  const row = (b) => {
    const r = rows.get(b);
    return `${b} 直推 = ${cmdOf(r.push)}｜PR→${b} = ${r.pr.length ? cmdOf(r.pr) : '（无 CI 步——分支策略未启用 Build validation）'}`;
  };
  return `trigger = ${branches.join(' + ')}；${branches.map(row).join('；')}（本页现场取数 azure-pipelines.yml；三档口径登记 runtime-env §6.5）`;
}

// 接地断言（2026-11-11 P0）：渲染出的每一列都必须由 yml 里的**字面谓词**支撑，不靠启发式。
// 两条不变量各对着一类已发生的真实漂移：
//   ① 「仅 PR validation 生效」标注的步，condition 不得同时含 Build.SourceBranch 直推臂，且必须含
//      PR 独占变量——2026-11-11 实测重档门禁被误标，main 直推漏列 verify --full；
//   ② condition 字面写明 eq(Build.SourceBranch,'refs/heads/<b>') 的步，<b> 直推列必须列出它——
//      防「解析口径变了、渲染没变」的静默漏列（本函数在渲染后跑，对 rows 断言而非对中间集合）。
function assertCiGrounding(steps, rows, branches) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const s of steps) {
    if (!s.prOnly) continue;
    if (/Build\.SourceBranch/.test(s.condLine)) {
      throw new Error(`ciSummary 接地失败①：${s.cmd} 被标「仅 PR 生效」，但 condition 含直推臂 → ${s.condLine}`);
    }
    if (!PR_EXCLUSIVE_RE.test(s.condLine)) {
      throw new Error(`ciSummary 接地失败①：${s.cmd} 被标「仅 PR 生效」，但 condition 无 PR 独占变量 → ${s.condLine || '(无 condition)'}`);
    }
  }
  for (const b of branches) {
    const push = rows.get(b).push;
    for (const s of steps) {
      const litPush = new RegExp(`eq\\(variables\\['Build\\.SourceBranch'\\]\\s*,\\s*'refs/heads/${esc(b)}'\\)`).test(s.condLine);
      if (litPush && !push.includes(s.cmd)) {
        throw new Error(`ciSummary 接地失败②：${b} 直推列漏列 ${s.cmd}——yml condition 字面含 refs/heads/${b}`);
      }
    }
  }
}

// 卡口职责说明（键 = .githooks 文件名；未登记者按通用行渲染——钩子清单仍来自单源）
const HOOK_DESC = {
  'pre-commit': '硬拦：台账不变量（触及才跑）+ 先确认后改代码（暂存产品路径才跑）+ 四业务守卫（并行 ~0.3s）+ commit-check（常规 --no-build，~0.2s；合并/squash 提交探 MERGE_HEAD/SQUASH_MSG 走 --full 整树编译）；常驻面体积预算 2026-10-28 退出钩子（verify 保留）',
  'pre-merge-commit': '合并提交转发 pre-commit（显式 --full --merge：整树编译 + 泳道检查 A 跳过）',
  'pre-push': 'check-loop hard 6 段（~3.4s，按推送范围）+ commit-check --range 范围条件构建（后端 13s / 前端 build 15s）',
  'commit-msg': '提交信息规范（Conventional Commits）',
  'post-commit': '领先 upstream 提示（勤推小步）',
};

function buildMap() {
  const hooks = listDir(path.join('.githooks'));
  const gates = verifyGateIds();
  const secs = loopSections();
  const reg = registrySummary();
  const ci = ciSummary();
  const cmds = listDir(path.join('.agents', 'commands')).filter((f) => f.endsWith('.md'));
  const skills = listSubdirs(path.join('.agents', 'skills'));
  const roles = listDir(path.join('.agents', 'roles')).filter((f) => f.endsWith('.md'));

  const L = [];
  L.push('# 引擎地图（生成物，勿手改）');
  L.push('');
  L.push('> 生成器 `flow-kit run gen-engine-map.mjs`（单源现场取数；`--check` 防漂移——改引擎后重生成随同提交）。');
  L.push('> 一页冷启动地图：接手会话/新协作者读本页替代全仓考古；明细按 §维护 的单源指针下钻。');
  L.push('');
  L.push('## 执行模型（一段）');
  L.push('');
  L.push('本引擎无常驻进程：**文档即状态机**（`workflow/` 四目录，frontmatter `状态: draft→approved→done` 由 confirm-doc 迁移）+ **git 钩子即执法点** + **脚本即确定性验证器** + **AI 即执行体**（读命令/技能/角色契约行动）。质量分工：确定性脚本管事实（确认过没有/验证过没有/红线判低），模型管判断（定级/根因/设计/复核）。');
  L.push('');
  L.push('## 执法卡口');
  L.push('');
  L.push(`git 钩子 ${hooks.length} 个：`);
  L.push('');
  L.push('| 钩子 | 跑什么 |');
  L.push('|---|---|');
  for (const h of hooks) L.push(`| ${h} | ${HOOK_DESC[h] || '（见钩子头注——本地图未登记职责说明）'} |`);
  L.push(`| CI（azure-pipelines） | ${ci || '（未找到 azure-pipelines.yml——CI 触发面未知）'} |`);
  L.push('');
  L.push(`## verify 门表（${gates.length} 门，单源 verify.mjs GATES；--scope 按 diff 面裁剪）`);
  L.push('');
  L.push(gates.map((g) => `\`${g}\``).join(' · '));
  L.push('');
  if (secs) {
    const hard = secs.filter((s) => s.lane === 'hard');
    const hyg = secs.filter((s) => s.lane === 'hygiene');
    L.push(`## check-loop 段（${secs.length} 段 = hard ${hard.length} + hygiene ${hyg.length}；单源 check-loop.mjs SECTIONS）`);
    L.push('');
    L.push(`- **hard 车道**（默认关单/pre-push 扫）：${hard.map((s) => s.id).join('、')}`);
    L.push(`- **hygiene 车道**（--hygiene/--all 才扫）：${hyg.length} 段（索引/宿主/词表/指标/委派等 WARN——月检道）`);
    L.push('');
  }
  if (reg) {
    L.push(`## 机制台账状态（${reg.total} 行，单源 mechanism-registry.md）`);
    L.push('');
    L.push(`现役 ${reg.active} / 已退役 ${reg.retired} / 待退役 ${reg.pending}${reg.retiredNames.length ? `；已退役：${reg.retiredNames.join('、')}` : ''}`);
    if (reg.revisits.length) {
      L.push('');
      L.push(`owner-fiat 复评挂号称 ${reg.revisits.length}（复评到期逐条列出，交人工月判）：${reg.revisits.map((r) => `${r.name}(${r.date})`).join('、')}`);
    }
    L.push('');
  }
  L.push('## 模型侧载体');
  L.push('');
  L.push(`- **命令** ${cmds.length} 篇（.agents/commands/，常驻指令面）：${cmds.join('、')}`);
  L.push(`- **技能** ${skills.length} 个（.agents/skills/，按需加载）：${skills.join('、')}`);
  L.push(`- **角色** ${roles.length} 个（.agents/roles/，子代理契约）：${roles.map((r) => r.replace(/\.md$/, '')).join('、')}`);
  L.push('');
  L.push('## 数据与台账面');
  L.push('');
  L.push('| 台账 | 用途 |');
  L.push('|---|---|');
  L.push('| `.agents/verifications.jsonl` | verify 绿凭证（钉 headShort + 24h 窗；--scope 行带面与基线） |');
  L.push('| `.agents/judgments.jsonl` | check-loop 每次运行 per-rule WARN/BLOCK 落账（agg-judgments 供数） |');
  L.push('| `.agents/usage.jsonl` | 角色 / 模型调用凭据（usage-log 写入，observability 供数；本机） |');
  L.push('| `.agents/cache/pipeline-runs/*.json` | pipeline-run 事件流（按 run 的耗时与停止类型；本机） |');
  L.push('| `.agents/confirmations.jsonl` + `confirmations.d/` | 确认链（append-only，指纹 sha256，提交时刻增量执法） |');
  L.push('| `.agents/trust-mode-audit.jsonl` | 自治授权升降级（prev-sha256 链；trust-mode 升降级时按需生成，新克隆暂缺） |');
  L.push('| `workflow/reviews.d/` | 复核事件级台账（采纳/拒绝/误报） |');
  L.push('| `workflow/papercuts.d/` | 摩擦与消债台账 |');
  L.push('| `workflow/delegations.md` | 委派/自做结果 + 月度聚合快照（扩容门供数） |');
  L.push('| `workflow/metrics.md` | 月度指标（incident/门禁成本/复核效果——GENERATED 区） |');
  L.push('');
  L.push('## 维护');
  L.push('');
  L.push('- 改任何单源（钩子/GATES/SECTIONS/台账/目录）后：`flow-kit run gen-engine-map.mjs` 重生成随同提交；CI/hygiene 可跑 `--check` 防漂移。');
  L.push('- 环境事实单源 `.agents/notes/runtime-env.md` §6；机制明细与退役阈值单源 `.agents/config/mechanism-registry.md`；门禁成本 `workflow/metrics.md`。');
  L.push('');
  return L.join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const out = buildMap();
  const mapPath = path.join(ROOT, MAP_REL);
  if (argv.includes('--check')) {
    const cur = fs.existsSync(mapPath) ? fs.readFileSync(mapPath, 'utf8').replace(/\r/g, '') : null;
    if (cur === out.replace(/\r/g, '')) {
      console.log('[engine-map] ✅ 与单源一致');
      process.exit(0);
    }
    console.error('❌ engine-map.md 与单源漂移——重生成：flow-kit run gen-engine-map.mjs');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(mapPath), { recursive: true });
  fs.writeFileSync(mapPath, out);
  console.log(`[engine-map] ✅ 已生成 ${MAP_REL}（钩子/门/段/机制行现场取数）`);
}
