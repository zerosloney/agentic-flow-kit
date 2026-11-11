#!/usr/bin/env node
// CI 提交信息卫生检出（2026-11-05 复盘 P0 机器执法）：把「commit-msg 钩子未挂 / 被 --no-verify 跳过」
// 变成 CI 可见失败——对推送区间内每个新提交（--no-merges，TFS PR 合并提交不校验）的 message 按
// .githooks/commit-msg 同一份规则校验（枚举/正则单源 .agents/config/commit-msg-rules.json，禁双源）。
// 检出边界：覆盖「钩子未挂 / --no-verify 且消息违规」；不覆盖「--no-verify 但消息恰好合法」（合法即无可报违规）。
// 区间传递：三层基准
//   ① --base 显式指定（本地复跑）；
//   ② PR 构建（SYSTEM_PULLREQUEST_TARGETBRANCH 在场且 HEAD 是合并提交）：取合并提交的第一父（= 目标分支尖端）
//      作基准，只判本 PR 引入的提交。原因（2026-11-05 实测 build 29054 假红）：PR 构建的 CI_PUSH_BEFORE 来自
//      changes API「最老一笔的第一父」，该区间会拉入目标分支侧历史（main 上的「还原…」存量提交），
//      把规则生效前的旧提交判红——规则只约束新提交，存量不该拦发布 PR。
//   ③ 推送构建：CI_PUSH_BEFORE；取不到 advisory 退回 HEAD~1（同泳道门退回口径）。
// 本地测试可 --base <revision> 显式指定。违规 exit 1 并逐条列出（hash + message + 违规原因）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RULES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config', 'commit-msg-rules.json');

const fail = (msg) => { console.error(`ci-commit-hygiene: ${msg}`); process.exit(1); };

let types = [];
let exemptRe = null;
let typeRe = null;
try {
  const rules = JSON.parse(fs.readFileSync(RULES, 'utf8'));
  types = rules.types;
  exemptRe = new RegExp(rules.exemptPrefix);
  typeRe = new RegExp('^(' + rules.types.join('|') + ')' + rules.typeSuffix);
} catch (e) { fail(`规则单源 ${RULES} 读取失败：${e.message}`); }

const argOf = (k) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : '';
};

const gitOut = (args) => {
  // maxBuffer 抬到 64MB：spawnSync 缺省 1MB——区间覆盖整支历史（如 develop→main 同步直推）时
  // %B 全量输出实测超 1MB 即 ENOBUFS（2026-11-05 实测假红）。64MB ≈ 本仓全历史输出的 50 倍余量。
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fail(`git ${args.join(' ')} 失败：${String(r.stderr || r.error || '').trim()}`);
  return String(r.stdout || '');
};

let base = argOf('--base');
let baseSource = '--base';
if (!base) {
  const isPrBuild = Boolean((process.env.SYSTEM_PULLREQUEST_TARGETBRANCH || '').trim());
  const parents = gitOut(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/).slice(1);
  if (isPrBuild && parents.length > 1) {
    base = parents[0];
    baseSource = 'PR 目标侧第一父';
  }
}
if (!base) {
  base = (process.env.CI_PUSH_BEFORE || '').trim();
  baseSource = 'CI_PUSH_BEFORE';
}
if (!base) {
  base = 'HEAD~1';
  baseSource = 'HEAD~1 回落';
  console.error('ci-commit-hygiene: advisory: 无 --base / PR 合并检出 / CI_PUSH_BEFORE——退回 HEAD~1（同泳道门口径，多提交直推仅核末笔）');
}
base = gitOut(['rev-parse', base]).trim(); // 解析为 40 位 sha，顺带验证区间起点在本仓存在（不合法 loud fail）
const head = gitOut(['rev-parse', 'HEAD']).trim();

const log = gitOut(['log', '--no-merges', '--format=%H%x1f%B%x1e', `${base}..${head}`]);
const violations = [];
let total = 0;
for (const rec of log.split('\u001e')) {
  if (!rec.trim()) continue;
  const [hash, body = ''] = rec.split('\u001f');
  const first = body.split(/\r?\n/)[0] || '';
  total++;
  if (exemptRe.test(first) || typeRe.test(first)) continue;
  violations.push({ hash, first });
}

const span = `${base.slice(0, 12)}..${head.slice(0, 12)}`;
if (violations.length) {
  console.error(`ci-commit-hygiene: 区间 ${span}（基准=${baseSource}）共 ${total} 笔（不含合并提交），${violations.length} 笔消息违规：`);
  for (const v of violations) console.error(`  ${v.hash}  首行：${v.first || '（空首行）'}\n    原因：提交类型须为 ${types.join('/')}（AGENTS.md「git提交」）`);
  process.exit(1);
}
console.log(`ci-commit-hygiene: 区间 ${span}（基准=${baseSource}）共 ${total} 笔（不含合并提交），0 违规`);
