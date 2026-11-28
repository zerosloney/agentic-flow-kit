// tests/ledger-baseline.test.mjs — issue #69：历史基线声明来源三级化
// env LEDGER_HISTORY_BASELINE（测试覆盖口）> 仓库声明文件 .agents/notes/ledger-history-baseline.md
// > 内置基线（只对 kit 本仓有效）。锁定五件事：无声明时 loud 全史提示且历史违规照常抓、
// 仓库声明文件豁免基线前提交、env 与文件不同值时 env 优先；#90 起追加两条——声明已提交且此后仅追加
// 叙述仍生效（旧判据在此必红），PR 分支自造基线（不在 trunk 历史内）被拒并 loud 回落。
// 夹具行须过检查器行级校验五项：ts ISO 非降序 / fingerprint 64 位 hex /
// doc ∈ workflow 四目录且树内存在 / stage 合法（取 approved）。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'check-ledger-invariant.mjs');

const T = (n) => `2026-11-20T00:00:${String(n).padStart(2, '0')}.000Z`;
let fpSeq = 0;
const hex = (n) => n.toString(16).padStart(64, '0');
const mkRow = (ts, doc) =>
  JSON.stringify({ ts, doc: `workflow/specs/${doc}.md`, stage: 'approved', fingerprint: hex(++fpSeq) });

// 继承环境必须剥掉 LEDGER_HISTORY_BASELINE：宿主 shell 的残留值会颠倒「无声明」与「文件声明」场景
const cleanEnv = () => {
  const env = { ...process.env };
  delete env.LEDGER_HISTORY_BASELINE;
  return env;
};

function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  return r;
}

function runChecker(dir, env = cleanEnv()) {
  return spawnSync(process.execPath, [CHECKER, '--root', dir], { cwd: dir, encoding: 'utf8', env });
}

function headSha(dir) {
  return git(dir, ['rev-parse', 'HEAD']).stdout.trim();
}

function makeRepo() {
  const dir = makeTmp('flow-kit-ledger-baseline-');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'tester']);
  fs.mkdirSync(path.join(dir, 'workflow', 'specs'), { recursive: true });
  for (const d of ['d1', 'd2']) fs.writeFileSync(path.join(dir, 'workflow', 'specs', `${d}.md`), `# ${d}\n`);
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  return dir;
}

test('ledger history baseline: 无声明 → 全史扫描 loud 提示且改写被抓；文件声明豁免（含已提交声明 #90）；env 覆盖文件；分支自造基线被拒', () => {
  const dir = makeRepo();

  // c1：合法台账行落账
  fs.writeFileSync(path.join(dir, '.agents', 'confirmations.jsonl'), mkRow(T(1), 'd1') + '\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'c1: ledger row 1']);
  const c1 = headSha(dir);
  // 固定 trunk 名：trunk 判据（issue #90）依赖可解析的长命分支，不随宿主 init.defaultBranch 漂移
  if (git(dir, ['branch', '--show-current']).stdout.trim() !== 'main') git(dir, ['branch', '-M', 'main']);

  // c2：改写主台账删掉该行（前缀破坏，无修剪凭据）
  fs.writeFileSync(path.join(dir, '.agents', 'confirmations.jsonl'), mkRow(T(2), 'd2') + '\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'c2: rewrite ledger (prefix break)']);
  const c2 = headSha(dir);

  // 场景 1：无任何声明 → 非零（c2 前缀破坏被全史扫描抓住）+ stderr 含 fail-loud 全史提示
  const r1 = runChecker(dir);
  assert.notEqual(r1.status, 0, `无声明应非零退出: ${r1.stdout}\n${r1.stderr}`);
  assert.ok(r1.stderr.includes('全史扫描'), `stderr 应含全史扫描提示: ${r1.stderr}`);
  assert.ok(r1.stderr.includes('未声明历史基线'), `stderr 应含未声明提示: ${r1.stderr}`);

  // 场景 2：仓库声明文件（owner 声明基线 = c2）→ exit 0（c2 豁免，终树行级校验通过）
  const notes = path.join(dir, '.agents', 'notes');
  fs.mkdirSync(notes, { recursive: true });
  fs.writeFileSync(path.join(notes, 'ledger-history-baseline.md'), `LEDGER_HISTORY_BASELINE=${c2}\n`);
  const r2 = runChecker(dir);
  assert.equal(r2.status, 0, `文件声明后应绿: ${r2.stdout}\n${r2.stderr}`);
  assert.ok(r2.stderr.includes('个前基线提交按 HISTORY_BASELINE 声明豁免'), `stderr 应含豁免 info: ${r2.stderr}`);

  // 场景 3：env 与文件声明不同值（指向 c1）→ env 优先，c2 重回扫描面 → 非零
  const r3 = runChecker(dir, { ...cleanEnv(), LEDGER_HISTORY_BASELINE: c1 });
  assert.notEqual(r3.status, 0, `env 覆盖应非零退出: ${r3.stdout}\n${r3.stderr}`);
  assert.ok(r3.stderr.includes('覆盖生效'), `stderr 应含 env 覆盖生效提示: ${r3.stderr}`);

  // 场景 4（issue #90 回归）：声明**已提交**，此后仅追加叙述（不改声明值）→ 仍 exit 0。
  // 旧判据在这里必红：写声明的那次提交落在 <sha>..HEAD 内，声明被自己的写入提交判成「自我豁免」。
  // 远端 trunk 是 #90 判据的信任锚：模拟「基线已在干线发布」（origin/main 指向 c2）。
  git(dir, ['update-ref', 'refs/remotes/origin/main', c2]);
  const notePath = path.join(notes, 'ledger-history-baseline.md');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'c3: declare baseline (committed)']);
  fs.appendFileSync(notePath, '\n## 后续说明\n\nowner 追加的叙述文字（不改声明值）。\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'c4: append narrative to baseline note']);
  const r4 = runChecker(dir);
  assert.equal(r4.status, 0, `声明已提交且后续仅追加叙述时应绿: ${r4.stdout}\n${r4.stderr}`);
  assert.ok(!r4.stderr.includes('在声明区间内仍被提交改动'), `不应再出现旧判据告警: ${r4.stderr}`);

  // 场景 5（issue #90）：PR 分支自造基线——声明值只在特性分支历史里、不在 trunk → 不采用 + loud 告警；
  // 回落无基线 → c2 的前缀破坏重新进扫描面 → 非零。
  git(dir, ['checkout', '-q', '-b', 'feature/self-exempt']);
  fs.writeFileSync(path.join(dir, '.agents', 'confirmations.jsonl'), mkRow(T(3), 'd2') + '\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'c5: feature commit']);
  const c5 = headSha(dir);
  fs.writeFileSync(notePath, `LEDGER_HISTORY_BASELINE=${c5}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'c6: declare self as baseline']);
  const r5 = runChecker(dir);
  assert.notEqual(r5.status, 0, `PR 分支自造基线应被拒: ${r5.stdout}\n${r5.stderr}`);
  assert.ok(r5.stderr.includes('不在 trunk'), `stderr 应含 trunk 告警: ${r5.stderr}`);
});
