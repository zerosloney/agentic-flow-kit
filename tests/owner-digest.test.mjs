import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect, renderMarkdown } from '../templates/engine/.agents/scripts/owner-digest.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'owner-digest.mjs');

function tmp() {
  return makeTmp('owner-digest-');
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const now = new Date();
const iso = (d) => d.toISOString();

function git(root, args) {
  return spawnSync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
}

// 有数据夹具：judgments / delegations / commits / incidents / verifications / reviews / 预算各就位
function richFixture(root) {
  git(root, ['init', '-q']);
  git(root, ['commit', '--allow-empty', '-m', 'feat: owner visible feature']);
  git(root, ['commit', '--allow-empty', '-m', 'fix: rework patch']);
  write(root, '.agents/verifications.jsonl', [
    JSON.stringify({ ts: iso(now), exitCode: 0, suite: 'all' }),
    JSON.stringify({ ts: iso(now), exitCode: 1, suite: 'all' }),
  ].join('\n') + '\n');
  write(root, 'workflow/incidents/2026-11-01-outage.md', '---\n状态: open\n级别: L1\n---\n# outage\n');
  write(root, 'workflow/incidents/2026-11-02-noise.md', '---\n状态: closed\n---\n# noise\n');
  write(root, 'workflow/reviews.d/2026-11.md', [
    '| 日期 | 评审对象 | 复核人 | 意见数 | 采纳 | 拒绝 | 误报 | 备注 |',
    '|---|---|---|---|---|---|---|---|',
    '| 2026-11-10 | spec-x.md | rev | 3 | 2 | 1 | 0 |  |',
  ].join('\n') + '\n');
  write(root, '.agents/judgments.jsonl', JSON.stringify({
    ts: iso(now), mode: 'hard',
    rules: [{ rule: 'r1', level: 'BLOCK', count: 2 }, { rule: 'r2', level: 'WARN', count: 1 }],
  }) + '\n');
  write(root, 'workflow/delegations.md', [
    '# 委派台账',
    '',
    '## 委派结果',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 | 返工原因 |',
    '|------|----------------|------------|------|------|----------|',
    '| 2026-11-05 | coder | 交付报表导出 | 返工待修 | | |',
    '| 2026-11-06 | coder | 交付登录加固 | 一次通过 | | |',
    '',
    '## 自做任务结果',
    '',
    '| 日期 | 任务一句话 | 结果 | 备注 | 返工原因 |',
    '|------|------------|------|------|----------|',
    '| 2026-11-07 | 主智能体自查 | 一次通过 | | |',
  ].join('\n') + '\n');
  write(root, '.agents/config/dispatch.json', JSON.stringify({ reportBudgetChars: 50 }));
  // 分片：1 份委派报告（1 行），正文字数（去空白）远超 1×50 → 判超限月
  write(root, 'workflow/delegations.d/2026-11.md', [
    '## 委派结果',
    '',
    '| 日期 | 被委派方(模型) | 任务一句话 | 结果 | 备注 | 返工原因 |',
    '|------|----------------|------------|------|------|----------|',
    '| 2026-11-08 | coder | 分片任务 | 一次通过 | | |',
    '',
    '派发报告正文占位，超预算判定口径 = 分片去空白字符合计月对比报告数乘单报告预算。',
  ].join('\n') + '\n');
}

// 只读快照：rel|size|mtimeMs（跳过 .git——git 内部状态不是脚本的写面；脚本只调 git log 只读命令）
function snapshot(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (ent.name !== '.git') walk(path.join(dir, ent.name), r);
        continue;
      }
      const st = fs.statSync(path.join(dir, ent.name));
      out.push(`${r}|${st.size}|${st.mtimeMs}`);
    }
  };
  walk(root, '');
  return out;
}

test('rich fixture: three sections carry the expected entries', () => {
  const root = tmp();
  richFixture(root);

  const d = collect(root, { days: 30 });
  // 已完成
  assert.ok(Array.isArray(d.done.commits) && d.done.commits.includes('feat: owner visible feature'));
  assert.equal(d.done.commits.length, 2);
  assert.equal(d.done.verifications.count, 2);
  assert.equal(d.done.verifications.pass, 1);
  assert.equal(d.done.verifications.fail, 1);
  assert.equal(d.done.reviews.events, 1);
  assert.equal(d.done.reviews.adopted, 2);
  assert.equal(d.done.empty, false);
  // 等我拍板
  assert.deepEqual(d.decisions.judgments, [{ rule: 'r1', count: 2 }]);
  assert.equal(d.decisions.judgmentLatestMonth, '2026-11');
  assert.equal(d.decisions.judgmentWarn, 1);
  assert.equal(d.decisions.delegations.length, 1);
  assert.equal(d.decisions.delegations[0].task, '交付报表导出');
  assert.equal(d.decisions.delegations[0].kind, 'pending');
  assert.equal(d.decisions.empty, false);
  // 风险
  assert.equal(d.risks.incidents.open, 1);
  assert.equal(d.risks.incidents.total, 2);
  assert.deepEqual(d.risks.incidents.openFiles, ['2026-11-01-outage.md']);
  assert.equal(d.risks.rework.commits, 2);
  assert.equal(d.risks.rework.rework, 1);
  assert.equal(d.risks.rework.rate, 50);
  assert.equal(d.risks.budget.overCount, 1);
  assert.equal(d.risks.budget.overMonths.length, 1);
  assert.equal(d.risks.empty, false);

  const md = renderMarkdown(d);
  assert.match(md, /## 已完成/);
  assert.match(md, /## 等我拍板/);
  assert.match(md, /## 风险/);
  assert.match(md, /feat: owner visible feature/);
  assert.match(md, /交付报表导出（结果：返工待修）/);
  assert.match(md, /r1 BLOCK×2/);
  assert.match(md, /2026-11-01-outage\.md/);
  assert.match(md, /50%（1\/2/);
  assert.match(md, /超限月（advisory/);
});

test('empty target: explicit empty markers, zero fabrication, missing sources listed', () => {
  const root = tmp();
  const d = collect(root, { days: 7 });
  assert.equal(d.done.empty, true);
  assert.equal(d.decisions.empty, true);
  assert.equal(d.risks.empty, true);
  assert.equal(d.done.commits, null); // 非 git 目录显式报无 git
  assert.deepEqual(d.done.verifications, { count: 0, pass: 0, fail: 0 });
  assert.deepEqual(d.done.reviews, { events: 0, adopted: 0, rejected: 0, misreport: 0, months: [] });
  assert.deepEqual(d.decisions.judgments, []);
  assert.deepEqual(d.decisions.delegations, []);
  assert.deepEqual(d.risks.incidents.openFiles, []);
  assert.equal(d.risks.rework, null);
  for (const need of [
    '.agents/verifications.jsonl',
    'workflow/incidents/',
    'workflow/reviews.d/',
    'workflow/delegations.md',
    '.agents/judgments.jsonl ∪ workflow/gate-metrics.d/',
    'workflow/delegations.d/',
    '.agents/config/dispatch.json',
  ]) {
    assert.ok(d.missing.includes(need), `missing should include ${need}`);
  }
  assert.deepEqual(d.errors, []);

  const md = renderMarkdown(d);
  assert.match(md, /## 已完成/);
  assert.match(md, /## 等我拍板/);
  assert.match(md, /## 风险/);
  assert.match(md, /- 提交：—（无 git）/);
  assert.equal((md.match(/（无记录）/g) || []).length >= 4, true);
  assert.match(md, /## 数据源缺失/);
  // 零编造：夹具专属条目一个都不出现
  assert.ok(!md.includes('feat:'));
  assert.ok(!md.includes('r1'));
  assert.ok(!md.includes('返工待修（2026'));
  assert.ok(!md.includes('outage'));

  // 全空仍是成功（exit 0）
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.done.empty, true);
  assert.equal(j.decisions.empty, true);
  assert.equal(j.risks.empty, true);
});

test('--json parses and matches markdown wording', () => {
  const root = tmp();
  richFixture(root);
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  const d = collect(root, { days: 7 });
  assert.equal(j.days, 7);
  assert.ok(typeof j.since === 'string' && !Number.isNaN(Date.parse(j.since)));
  assert.deepEqual(j.done, d.done);
  assert.deepEqual(j.decisions, d.decisions);
  assert.deepEqual(j.risks, d.risks);
  assert.deepEqual(j.missing, d.missing);
  assert.deepEqual(j.errors, d.errors);

  const md = renderMarkdown(d);
  assert.match(md, new RegExp(`- 提交（git）：${j.done.commits.length} 条`));
  assert.match(md, new RegExp(`窗口内 ${j.done.verifications.count} 次`));
  assert.match(md, new RegExp(`事件 ${j.done.reviews.events} 起`));
  assert.match(md, new RegExp(`未关闭 incidents：${j.risks.incidents.open}/${j.risks.incidents.total}`));
  assert.match(md, new RegExp(`返工提交占比：${j.risks.rework.rate}%`));
  assert.match(md, new RegExp(`最近记录月 ${j.decisions.judgmentLatestMonth}`));
});

test('idempotent: two consecutive runs are byte-identical', () => {
  const root = tmp();
  richFixture(root);
  const r1 = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  const r2 = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(r1.stdout, r2.stdout);
});

test('read-only: no file added or modified in the target dir', () => {
  const root = tmp();
  richFixture(root);
  const before = snapshot(root);
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const rj = spawnSync(process.execPath, [SCRIPT, '--root', root, '--json'], { encoding: 'utf8' });
  assert.equal(rj.status, 0, rj.stderr);
  assert.deepEqual(snapshot(root), before);
});

test('CLI contract: --help exits 0, bad --days exits 2', () => {
  const root = tmp();
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /flow-kit run owner-digest/);
  const bad1 = spawnSync(process.execPath, [SCRIPT, '--root', root, '--days'], { encoding: 'utf8' });
  assert.equal(bad1.status, 2);
  const bad2 = spawnSync(process.execPath, [SCRIPT, '--root', root, '--days', 'x'], { encoding: 'utf8' });
  assert.equal(bad2.status, 2);
  const bad3 = spawnSync(process.execPath, [SCRIPT, '--root', root, '--days', '0'], { encoding: 'utf8' });
  assert.equal(bad3.status, 2);
  const ok = spawnSync(process.execPath, [SCRIPT, '--root', root, '--days', '14'], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /# Owner 摘要（近 14 天）/);
});
