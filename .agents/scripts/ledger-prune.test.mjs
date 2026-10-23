#!/usr/bin/env node
// ledger-prune.test.mjs — 台账特许修剪通道 fixture 套件（2026-10-12 ledger-prune-manifest）
// 覆盖：四条判据逐条（哈希命中数 / 内容对账 / docs 清单 / manifest 缺失）+ 链段重启凭据 +
//       --staged 真 git 端到端（放行与拦截）+ 无 manifest 时 append-only 红线不变。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const { matchPrune, sha256line, PRUNE_REL } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'ledger-prune.mjs')).href);
// 夹具闭包（2026-10-12 fixture-closure-rootfix）：check-ledger-invariant 及其传递依赖（ledger-loader /
// policy 等）整闭包拷入。此前手写枚举漏拷 ledger-loader.mjs → 该脚本 import 失败 → 门禁静默不跑 →
// 假绿；现在闭包自动跟随，且拷完 assertFixtureScripts 会在建夹具当场炸出全量缺失清单。
const { copyScriptClosure } = await import(pathToFileURL(path.join(SCRIPT_DIR, 'fixture-scripts.mjs')).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const L = (...xs) => xs.filter(Boolean).join('\n') + '\n';
const rowA = L('{"ts":"2026-10-01T00:00:00Z","doc":"workflow/intents/2026-10-01-a.md","stage":"approved","fingerprint":"' + 'a'.repeat(64) + '"}');
const rowB = L('{"ts":"2026-10-02T00:00:00Z","doc":"workflow/plans/2026-10-01-a.md","stage":"approved","fingerprint":"' + 'b'.repeat(64) + '"}');
const rowC = L('{"ts":"2026-10-03T00:00:00Z","doc":"workflow/intents/2026-10-01-z.md","stage":"approved","fingerprint":"' + 'c'.repeat(64) + '"}');
const HEAD = rowA + rowB + rowC;

// ============ 场景 1：四条判据逐条 ============
{
  const mk = (over = {}) => ({
    ts: '2026-10-12T00:00:00Z', authority: '仓库所有者', reason: '归档下架一批单',
    removes: [sha256line(rowB.trim())], docs: ['2026-10-01-a'], ...over,
  });
  // ① manifest 缺失 / removes 空
  check('S1① manifest 缺失 → err', !!(matchPrune(HEAD, rowA + rowC, null) || {}).err);
  check('S1① removes 为空 → err', !!(matchPrune(HEAD, rowA + rowC, mk({ removes: [] })).err));
  // ② 哈希不存在
  check('S1② 哈希不存在 → err（命中数不符）',
    !!(matchPrune(HEAD, rowA + rowC, mk({ removes: ['0'.repeat(64)] })).err));
  // ② 哈希声明重复（两行内容相同 → 一个哈希命中 2 行）
  const dup = L('{"ts":"1","doc":"workflow/intents/d.md","stage":"approved"}', '{"ts":"1","doc":"workflow/intents/d.md","stage":"approved"}');
  check('S1② 重复行声明单哈希 → err（命中数 ≠ 声明数）',
    !!(matchPrune(dup, '', mk({ removes: [sha256line(dup.split('\n')[0])] })).err));
  // ③ 存在 manifest 之外的改动
  check('S1③ 多删一行（manifest 外） → err',
    !!(matchPrune(HEAD, rowA, mk()).err));
  check('S1③ 改写保留行内容 → err',
    !!(matchPrune(HEAD, rowA + rowC.replace('approved', 'done'), mk()).err));
  check('S1③ 插入新行 → err',
    !!(matchPrune(HEAD, rowA + rowC + rowB, mk()).err));
  // ④ doc 不在清单
  check('S1④ 被删行 doc 不在 manifest.docs → err',
    !!(matchPrune(HEAD, rowA + rowC, mk({ docs: ['some-other'] })).err));
  check('S1④ docs 为空数组 = 不约束 → 放行',
    !(matchPrune(HEAD, rowA + rowC, mk({ docs: [] })).err));
  // 全对
  const ok = matchPrune(HEAD, rowA + rowC, mk());
  check('S1 全部判据通过 → 放行且计数正确',
    !ok.err && ok.removed === 1 && ok.docs[0] === '2026-10-01-a', JSON.stringify(ok));
  check('S1 返回被删哈希供链校验复用', Array.isArray(ok.hashes) && ok.hashes[0] === sha256line(rowB.trim()));
}

// ============ 场景 2：--staged 真 git 端到端 ============
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-e2e-'));
  const git = (args, cwd = d) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  git(['init', '-q', '.']);
  git(['config', 'user.email', 't@t.io']); git(['config', 'user.name', 't']);
  git(['config', 'core.autocrlf', 'false']);
  const mkfix = () => {
    fs.mkdirSync(path.join(d, '.agents', 'scripts'), { recursive: true });
    copyScriptClosure(path.join(d, '.agents', 'scripts'), ['check-ledger-invariant.mjs']);
    for (const p of ['workflow/intents/2026-10-01-a.md', 'workflow/plans/2026-10-01-a.md', 'workflow/intents/2026-10-01-z.md']) {
      fs.mkdirSync(path.join(d, path.dirname(p)), { recursive: true });
      fs.writeFileSync(path.join(d, p), '---\n状态: approved\n---\n# doc\n', 'utf8');
    }
    fs.writeFileSync(path.join(d, '.agents', 'confirmations.jsonl'), HEAD, 'utf8');
    git(['add', '-A']); git(['commit', '-qm', 'base']);
  };
  const runGate = () => spawnSync(process.execPath, ['.agents/scripts/check-ledger-invariant.mjs', '--staged'],
    { cwd: d, encoding: 'utf8' });

  // ① 无 manifest 直接删行 → 仍 hard-block（append-only 红线不变）
  mkfix();
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.jsonl'), rowA + rowC, 'utf8');
  git(['add', '-A']);
  let r = runGate();
  check('S2① 无 manifest 删行 → exit 1（红线不变）', r.status === 1, `exit=${r.status} ${r.stderr}`);
  check('S2① 报文含「特许修剪对账失败」', /台账重写/.test(r.stderr), r.stderr);

  // ② 带 manifest 同笔暂存 → 放行
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.jsonl'), rowA + rowC, 'utf8');
  fs.writeFileSync(path.join(d, PRUNE_REL), JSON.stringify({
    ts: '2026-10-12T00:00:00Z', authority: '仓库所有者指令', reason: '下架 a 家族',
    removes: [sha256line(rowB.trim())], docs: ['2026-10-01-a'],
  }, null, 2), 'utf8');
  git(['add', '-A']);
  r = runGate();
  check('S2② 带合法 manifest → exit 0 放行', r.status === 0, `exit=${r.status} ${r.stderr}`);
  check('S2② 放行报文点名凭据与行数', /特许修剪通过/.test(r.stdout) && /移除 1 行/.test(r.stdout), r.stdout);

  // ③ manifest 只写一半（另删一行未申报） → 仍拦
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.jsonl'), rowA, 'utf8');
  git(['add', '-A']);
  r = runGate();
  check('S2③ manifest 外的额外删行 → exit 1', r.status === 1, `exit=${r.status}`);
  check('S2③ 报文说明内容 ≠ 旧 − manifest', /旧内容 − manifest/.test(r.stderr), r.stderr);

  // ④ 提交后跑历史全扫 → 认领修剪、不报前缀破坏
  fs.writeFileSync(path.join(d, '.agents', 'confirmations.jsonl'), rowA + rowC, 'utf8');
  git(['add', '-A']); git(['commit', '-qm', 'prune with manifest']);
  r = spawnSync(process.execPath, ['.agents/scripts/check-ledger-invariant.mjs'], { cwd: d, encoding: 'utf8' });
  check('S2④ 历史全扫认领修剪 → exit 0', r.status === 0, `exit=${r.status} ${r.stderr}`);
  check('S2④ 全扫输出含修剪认领记录', /特许修剪 1 行/.test(r.stderr + r.stdout), (r.stderr + r.stdout).slice(0, 300));
}

console.log(`\n[ledger-prune.test] PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);