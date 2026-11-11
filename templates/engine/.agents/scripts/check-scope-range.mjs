#!/usr/bin/env node
// check-scope-range.mjs — 推送范围（old..new）级 plan 改动面对账（2026-11-09 建，check-scope 的推送执法版）
// 用途：pre-push 对一次推送的整段 commit 范围对账——收集范围内新增/修改的 workflow/plans/*.md，
//   并集提取各 plan 声明文件（extractDeclared 与 check-scope.mjs 单源复用），与范围 diff 对账。
// 语义与红线：只读裁决（判红绿，不改任何状态）。
//   - 只判越界方向（改了未声明）= hard；未落件（声明未改）仅 advisory 打印——多任务合推时声明先行、
//     代码后推是合法节奏，硬判未落件必误报。
//   - 范围内无 plan 新增/修改 → skip（exit 0）：该推送不携带新承诺，沿用提交时刻 check-confirm-order 执法。
//   - 盲面封堵（2026-11-10）：skip 前补 advisory——范围含产品面改动（判据单源复用 verify-scope.mjs
//     PRODUCT_FACES/classifyFace，再扣 AGENTS.md 引擎面：.agents/.zcode/.githooks/宿主适配/workflow/wiki/
//     根 package.json/azure-pipelines.yml）且无 intent/spec 立档变更 → 打警告，exit 码不变、--strict 不升硬。
//     事故线豁免（降级口径）：范围内有 incident 立档（非 INDEX 计数）变更 → 警告降级为提示——事故线合法无 plan。
//   - plan 在工作区不可读 → exit 2（fail-loud，不静默放行；推送范围内改过的 plan 应已在工作区）。
//   - old 全零（新分支首推）→ skip（exit 0）：范围判不出时不把整段历史误判越界。
//   - --strict 时越界件非空 exit 1；默认 advisory（exit 0 出报告）。
// 白名单与宽松匹配规则与 check-scope.mjs 单源（import 复用，不复制正则）。
// 用法：node .agents/scripts/check-scope-range.mjs <oldSha> <newSha> [--strict] [--root <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractDeclared, WHITELIST_RE, matches } from './check-scope.mjs';
import { classifyFace } from './verify-scope.mjs';

const args = process.argv.slice(2);
let oldSha = '', newSha = '', strict = false, rootArg = '';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--strict') strict = true;
  else if (a === '--root') rootArg = args[++i] || '';
  else if (!oldSha && !a.startsWith('--')) oldSha = a;
  else if (!newSha && !a.startsWith('--')) newSha = a;
}
const ROOT = path.resolve(rootArg || process.cwd());
if (!oldSha || !newSha) { console.error('用法: node .agents/scripts/check-scope-range.mjs <oldSha> <newSha> [--strict] [--root <dir>]'); process.exit(2); }

const norm = (p) => p.replace(/\\/g, '/');

if (/^0+$/.test(oldSha)) {
  console.log('▶ check-scope-range：old 全零（新分支首推），范围判不出——skip');
  process.exit(0);
}

// 2026-11-10 修（合并提交实证）：`git diff old..new` 把 merge 带进来的目标分支整批变更也算「本范围改了」——
// 那些文件由目标分支侧的 plan 声明，本地范围里没有对应 plan → 恒判越界，合并后永远推不上去
// （实证：合入 develop 后 8 个文件被判越界，全是 develop 侧的任务产物）。
// 改为逐提交取改动：普通提交取 diff-tree 全量；合并提交取 combined diff（`-c`，只出「与所有父都不同」的
// 冲突解决件），被合入分支带来的文件天然不入集；合并中手工解冲突的文件仍会被计入。
const gitOut = (args) => spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const revs = gitOut(['rev-list', '--first-parent', '--reverse', `${oldSha}..${newSha}`]);
if (revs.status !== 0) { console.error(`check-scope-range: git rev-list 失败: ${revs.stderr}`); process.exit(2); }
const changedSet = new Set();
for (const sha of revs.stdout.split(/\r?\n/).filter(Boolean)) {
  const parents = gitOut(['rev-list', '--parents', '-n', '1', sha]).stdout.trim().split(/\s+/).slice(1);
  const dt = parents.length > 1
    ? gitOut(['diff-tree', '-c', '--no-commit-id', '--name-only', '--no-renames', '-r', sha])
    : gitOut(['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', sha]);
  if (dt.status !== 0) { console.error(`check-scope-range: git diff-tree 失败（${sha}）: ${dt.stderr}`); process.exit(2); }
  for (const l of dt.stdout.split(/\r?\n/)) if (l.trim()) changedSet.add(norm(l.trim()));
}
const changed = [...changedSet];

// 盲面封堵（2026-11-10）辅助判定（只服务下方 skip 路径的 advisory，不改越界对账）：
//   - 引擎面 = AGENTS.md 引擎面豁免清单 + wiki 豁免：其变更不算产品面，纯引擎面推送不触警告。
//     PRODUCT_FACES 的后缀兜底（.cs/.sql 等）会把 wiki/数据维护 SQL 判进 backend 面——引擎面剔除优先，防纯 wiki 推送误警。
//   - intent/spec 立档：workflow/{intents,specs} 下的 .md（INDEX 计数不算——目录索引维护不构成「有计划」）。
//   - incident 立档：workflow/incidents 下的 .md（INDEX 计数不算——防搭车豁免）。
const ENGINE_FACE_RE = /^(?:\.agents|\.zcode|\.githooks|\.opencode|\.trae|\.codebuddy|\.qwen|wiki|workflow)\//i;
const ENGINE_FILE_RE = /^(?:azure-pipelines\.yml|package\.json)$/i;
const isIntentSpecDoc = (f) => /^workflow\/(?:intents|specs)\/.+\.md$/i.test(f) && !f.endsWith('/INDEX.md');
const isIncidentDoc = (f) => /^workflow\/incidents\/.+\.md$/i.test(f) && !f.endsWith('/INDEX.md');

// 范围内新增/修改的 plan（删除的 plan 不构成承诺来源；plans 目录外不看）
const plansInRange = changed.filter((f) => /^workflow\/plans\/.+\.md$/i.test(f) && !f.endsWith('/INDEX.md'));
if (!plansInRange.length) {
  console.log('▶ check-scope-range：推送范围无 plan 新增/修改——skip（提交时刻顺序门已执法）');
  // 盲面封堵：范围零 plan 变更 ≠ 范围无事——多提交无 plan 合推可整段夹带产品面改动（提交时刻
  // check-confirm-order 只看单条提交，原样静默 skip 即漏过）。只补 advisory：打印不拦截，exit 码不变，
  // --strict 不升硬（与既有「未落件仅 advisory」同级）。产品面判据单源复用 verify-scope.mjs
  // PRODUCT_FACES（backend/frontend 面 match，含 tests/、scripts/verify/backend/ 与后缀兜底）。
  const productFace = classifyFace(changed).matched.filter((f) => !ENGINE_FACE_RE.test(f) && !ENGINE_FILE_RE.test(f));
  if (productFace.length && !changed.some(isIntentSpecDoc)) {
    if (changed.some(isIncidentDoc)) {
      // 事故线豁免（降级口径）：有 incident 立档 → 产品改动按事故线处理（合法无 plan），不要求回填
      // plan；降级为提示而非完全静默——立档与产品改动无关的搭车推送仍留观察面。
      console.log('⚠（降级）推送含产品面改动且范围内无 plan 变更——范围内有 incident 立档，按事故线豁免；advisory 不拦截');
    } else {
      console.log('⚠ 推送含产品面改动但范围内无 plan 变更——若属计划外改动请先回填 plan（事故线 incident 除外）；本警告 advisory，不拦截');
    }
    console.log(`  产品面件 ${productFace.length}：${productFace.join('、')}`);
  }
  process.exit(0);
}

const declared = [];
for (const rel of plansInRange) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.error(`check-scope-range: plan 不可读: ${rel}`); process.exit(2); }
  declared.push(...extractDeclared(abs));
}

const outOfScope = changed.filter((f) => !WHITELIST_RE.test(f) && !declared.some((df) => matches(f, df)));
const notLanded = declared.filter((df) => !changed.some((f) => matches(f, df)));

console.log(`▶ check-scope-range（推送范围 plan 改动面对账）: ${oldSha.slice(0, 8)}..${newSha.slice(0, 8)}`);
console.log(`  范围 plan ${plansInRange.length} 份（${plansInRange.join('、')}）｜ 声明 ${declared.length} ｜ 变更 ${changed.length}`);
if (outOfScope.length) {
  console.log('  越界件（推送改了但范围内 plan 未声明）:');
  outOfScope.forEach((f) => console.log(`    - ${f}`));
}
if (notLanded.length) {
  console.log('  未落件（声明未变更，advisory——多任务合推不硬判）:');
  notLanded.forEach((f) => console.log(`    - ${f}`));
}
if (!outOfScope.length && !notLanded.length) console.log('  双向对齐 ✅');
else if (!outOfScope.length) console.log('  越界方向干净 ✅（未落件仅 advisory）');
else if (!strict) console.log('  （advisory 报告——--strict 时越界件即 fail）');

if (strict && outOfScope.length) process.exit(1);
process.exit(0);
