// resolve-merge-conflicts.test.mjs — 端到端测试合并冲突自愈器的收窄行为（临时 git 仓库夹具；B9 自 Shipyard.Material 回灌）：
// UU（双方内容都在）走自动并集并 git add；删除/改删型（UD 等）不自动写入、不 git add，仅提示人工裁决。
// 夹具说明：git merge 对「双方都删」会静默自动解决（不产生 DD 未合并条目，已实测），
// 故删除型冲突用 modify/delete 构造（ours 修改 + theirs 删除 → UD），确定性复现未合并条目，
// 且正是旧 bug 的复活路径（:3: 读取失败 → 吞错为 '' → 误写回 ours 内容并 git add）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` —— ${detail}` : ''}`); }
};

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'resolve-merge-conflicts.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-conflicts-test-'));

const git = (...args) => spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
const porcelain = () => git('status', '--porcelain').stdout.split(/\r?\n/).filter(Boolean);

try {
  // 夹具：临时 git 仓库，基线含主台账 + 分片
  git('init');
  git('config', 'user.email', 'test@local');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  const ledger = path.join(tmp, '.agents', 'confirmations.jsonl');
  const shard = path.join(tmp, '.agents', 'confirmations.d', 'shard-x.jsonl');
  fs.mkdirSync(path.dirname(shard), { recursive: true });
  fs.writeFileSync(ledger, '{"id":1}\n');
  fs.writeFileSync(shard, '{"id":2}\n');
  git('add', '-A');
  git('commit', '-m', 'base');
  const defaultBranch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();

  // side：改主台账（追加 id:3）+ 删分片
  git('checkout', '-b', 'side');
  fs.writeFileSync(ledger, '{"id":1}\n{"id":3}\n');
  fs.rmSync(shard);
  git('add', '-A');
  git('commit', '-m', 'side');

  // main：改主台账（追加 id:4，与 side 不同行 → UU）+ 改分片（side 已删 → UD）
  git('checkout', defaultBranch);
  fs.writeFileSync(ledger, '{"id":1}\n{"id":4}\n');
  fs.writeFileSync(shard, '{"id":2}\n{"id":5}\n');
  git('add', '-A');
  git('commit', '-m', 'main');

  const merge = git('merge', 'side');
  const statusConflicted = porcelain();
  check('S1 夹具产生 UU+UD 冲突（merge 失败且两条未合并条目就位）',
    merge.status !== 0 &&
    statusConflicted.includes('UU .agents/confirmations.jsonl') &&
    statusConflicted.includes('UD .agents/confirmations.d/shard-x.jsonl'),
    `merge-exit=${merge.status} status=${statusConflicted.join(' | ')}`);

  const shardBefore = fs.readFileSync(shard, 'utf8');

  // 被测 CLI
  const proc = spawnSync(process.execPath, [scriptPath], { cwd: tmp, encoding: 'utf8' });

  check('S2 CLI exit 0（remaining 非零也 exit 0 的既有契约）', proc.status === 0, `status=${proc.status} stderr=${proc.stderr}`);

  const merged = fs.readFileSync(ledger, 'utf8');
  check('S3 UU 主台账=双方行并集', merged === '{"id":1}\n{"id":4}\n{"id":3}\n', merged);
  check('S4 UU 主台账无冲突标记', !merged.includes('<<<<<<<'), merged);
  const statusAfter = porcelain();
  const ledgerLine = statusAfter.find((l) => l.endsWith('.agents/confirmations.jsonl'));
  check('S5 UU 主台账已 git add（不再未合并）', !!ledgerLine && !/^(UU|AA|DD|AU|UD|UA|DU)/.test(ledgerLine), ledgerLine || '(不在 status 中)');

  check('S6 UD 分片未被 git add（仍处未合并态）',
    statusAfter.includes('UD .agents/confirmations.d/shard-x.jsonl'),
    statusAfter.join(' | '));
  check('S7 UD 分片内容未被自动改写', fs.readFileSync(shard, 'utf8') === shardBefore, fs.readFileSync(shard, 'utf8'));
  check('S8 stdout 提示分片删除/改删型冲突需人工裁决',
    proc.stdout.includes('.agents/confirmations.d/shard-x.jsonl') && proc.stdout.includes('删除/改删型冲突不自动处理'),
    proc.stdout);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
