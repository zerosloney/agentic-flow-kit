// tty-scope.test.mjs — TTY 形态确认必须带机器 scope（2026-10-19 secret/scope 缺口补齐的回归）。
// 方法：临时 git 仓 + 真 confirm-doc.mjs 打 CONFIRM_DOC_TEST_TTY=1 + NODE_ENV=test，
//   stdin 管道喂「可以」走 TTY 分支，读回 ledger 断言 scope 在、且 ai-auto/delegated 形态同样在。
// 背景：confirm-doc 的注释声称三形态一律记 scope，但 TTY 写路径 :530-534 漏带——
//   而 TTY 是最常见形态（本仓 406 行里 400 行 tty），check 15 scope 段对它恒报「缺机器改动面」。
// 判据锚：policy.scopeSince（缺键则整体跳过，本测试因此不受版本演进影响——无锚即无受管行）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIRM = path.join(SCRIPT_DIR, 'confirm-doc.mjs');

let pass = 0, fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n       ${detail}` : ''}`); }
};
const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

// mkrepo：临时 git 仓 + workflow 骨架 + kit.json（policyVersion 12，带 scopeSince 锚）
const mkrepo = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tty-scope-test-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflow', 'intents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'kit.json'), JSON.stringify({
    kit: 'agentic-flow-kit', version: '0.0.0-test', policyVersion: 12, audit: false,
  }));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# agents\n');
  // check-loop 唯一 fail-loud 前置（:349-360）：枚举单源缺失即整轮退出 1，scope 段根本跑不到——
  // 不灌这个文件，S3 会是空转断言（早退 → 无告警 → 断言恒真）。
  fs.copyFileSync(path.join(SCRIPT_DIR, '..', 'workflow-enums.txt'),
    path.join(root, '.agents', 'workflow-enums.txt'));
  return root;
};

const confirm = (root, doc, extraArgs = []) => spawnSync(process.execPath, [CONFIRM, doc, ...extraArgs], {
  cwd: root, encoding: 'utf8', input: '可以\n', env: { ...process.env, CONFIRM_DOC_TEST_TTY: '1', NODE_ENV: 'test' },
});
const ledgerRows = (root) => ledgerView(root);
// check 15 是 **hard 泳道**（check-loop.mjs:1228 laneOn(15)，LANE_OF 表 1/3/3x/8/14/15/17/23/25），
// --hygiene 跑不到它——scope 段必须用 --all 才可达。这是本测试的核心口径：之前用 --hygiene 做 S3，
// 护栏恒假、断言恒真，整个 S3 是空转。
const runCheckLoop = (root) => {
  const r = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'check-loop.mjs'), '--all'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CHECK_LOOP_NO_LEDGER: '1' },
  });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
// check 15 的数据源是 ledger-loader 的主台账 + 分片合并视图（ledger-loader.mjs:31-45,:89-107），
// 而 S3 的 tamper 行是**脚本直接写盘**的——写分片才是真落账路径，写主台账同样进视图。此处按
// ledger-loader 的读序取，避免「写错文件导致护栏失效却看不出来」。
const ledgerView = (root) => {
  const p = path.join(root, '.agents', 'confirmations.jsonl');
  const shardDir = path.join(root, '.agents', 'confirmations.d');
  const files = fs.existsSync(p) ? [p] : [];
  if (fs.existsSync(shardDir) && fs.statSync(shardDir).isDirectory()) {
    files.push(...fs.readdirSync(shardDir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => path.join(shardDir, f)));
  }
  return files.flatMap((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)));
};

// --- S1：TTY 形态（CONFIRM_DOC_TEST_TTY + stdin 管道）落账必须带 scope ---
{
  const root = mkrepo();
  const rel = 'workflow/intents/2026-10-19-tty-scope.md';
  fs.writeFileSync(path.join(root, rel), `---\n状态: draft\n日期: 2026-10-19\n---\n\n# 测试意图\n\n## 验收标准\n\n- [ ] 做完了\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  const r = confirm(root, rel);
  check('S1 TTY 确认退出 0', r.status === 0, `${r.stdout || ''}${r.stderr || ''}`);
  const rows = ledgerRows(root);
  check('S1b 台账只 1 行', rows.length === 1, `实际 ${rows.length} 行`);
  check('S1c source=tty（确认走的是 TTY 分支）', rows[0] && rows[0].source === 'tty', JSON.stringify(rows[0]));
  check('S1d TTY 行带 scope', !!rows[0] && !!rows[0].scope, `缺 scope：${JSON.stringify(rows[0])}`);
  check('S1e scope.files 含被确认文档', Array.isArray(rows[0] && rows[0].scope && rows[0].scope.files)
    && rows[0].scope.files.includes(rel), JSON.stringify(rows[0] && rows[0].scope));
  check('S1f scope.sha256 为 64 位十六进制', !!rows[0] && !!rows[0].scope
    && /^[0-9a-f]{64}$/.test(rows[0].scope.sha256), String(rows[0] && rows[0].scope && rows[0].scope.sha256));
  fs.rmSync(root, { recursive: true, force: true });
}

// --- S2：委托代录形态仍带 scope（防止 S1 的修复把别的形态改坏） ---
{
  const root = mkrepo();
  const rel = 'workflow/intents/2026-10-19-delegated-scope.md';
  fs.writeFileSync(path.join(root, rel), `---\n状态: draft\n日期: 2026-10-19\n---\n\n# 测试意图\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  const r = confirm(root, rel, ['--delegated', '用户已确认']);
  check('S2 委托代录退出 0', r.status === 0, `${r.stdout || ''}${r.stderr || ''}`);
  const rows = ledgerRows(root);
  check('S2b source=chat-delegated', rows[0] && rows[0].source === 'chat-delegated', JSON.stringify(rows[0]));
  check('S2c 委托代录行仍带 scope', !!rows[0] && !!rows[0].scope, `缺 scope：${JSON.stringify(rows[0])}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// --- S3：check 15 scope 段真实可达，且对 TTY 形态的干净落账不报「缺机器改动面」 ---
// 注意口径：check 15 属 hard 泳道，须用 --all 才可达（用 --hygiene 会让护栏恒假、断言恒真）。
{
  // 护栏：先造一条 scope.sha256 与被 files 重算不符的受管行。它能触发 [台账 scope 失配]，
  // 即证明 scope 段这一轮真的跑了——否则 S3b 会是空转断言（段没跑到 → 无告警 → 断言恒真）。
  // 行须满足受管准入：ts ≥ scopeSince（POLICIES v7 的时刻锚）。指纹故意写成全 a——它同时会触发
  // [确认内容漂移]，但本护栏只断言 scope 失配这一项，别的 blocker 不影响 scope 段是否可达。
  const g = mkrepo();
  const rel = 'workflow/intents/2026-10-19-tamper.md';
  fs.writeFileSync(path.join(g, rel), `---\n状态: approved\n日期: 2026-10-19\n---\n\n# 测试意图\n`);
  git(g, ['add', '-A']);
  git(g, ['commit', '-q', '-m', 'seed']);
  const badSha = crypto.createHash('sha256').update('not-the-files', 'utf8').digest('hex');
  fs.writeFileSync(path.join(g, '.agents', 'confirmations.jsonl'), `${JSON.stringify({
    ts: new Date().toISOString(), doc: rel, stage: 'approved', fingerprint: 'a'.repeat(64),
    prev: 'draft', source: 'tty',
    // files 故意与 sha256 不符：scopeDigest([rel]) 的摘要 ≠ 这个值——正是「改了 files 没同步摘要」
    scope: { files: [rel], sha256: badSha },
  })}\n`);
  const pre = runCheckLoop(g);
  check('S3a 护栏：scope 段真实可达（篡改行触发失配）', pre.out.includes('台账 scope 失配'), pre.out);
  fs.rmSync(g, { recursive: true, force: true });

  const root = mkrepo();
  const rel2 = 'workflow/intents/2026-10-19-loop-scope.md';
  fs.writeFileSync(path.join(root, rel2), `---\n状态: draft\n日期: 2026-10-19\n---\n\n# 测试意图\n`);
  // 同名的 plan 在场：否则 check 1 配对断裂会先 hard，把本测试要断言的 scope 项淹掉。
  // 本测试只关心 scope 段，配对是另一条判据，不该在这里被牵制。
  fs.mkdirSync(path.join(root, 'workflow', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workflow', 'plans', '2026-10-19-loop-scope.md'),
    `---\n状态: draft\n日期: 2026-10-19\n---\n\n# 测试计划\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
  confirm(root, rel2);
  const r = runCheckLoop(root);
  const out = r.out;
  check('S3 check-loop 退出 0（无 hard-block）', r.status === 0, out);
  check('S3b 确认后不报「缺机器改动面」', !out.includes('缺机器改动面'), out);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
