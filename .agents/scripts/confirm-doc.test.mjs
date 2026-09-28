#!/usr/bin/env node
// confirm-doc.test.mjs — 用户确认门测试（2026-09-26 confirm-gate-machine；2026-09-27 confirm-gate-delegated 补委托场景）
// 判据：① 指纹算法（CRLF 归一 / 剔指纹行防自引用 / 内容敏感） ② 跳转唯一合法性 ③ 落态只动两行
//       ④ 台账追加 schema ⑤ 核心——非 TTY spawn（模拟 AI 调用路径）无 --delegated 必须被拒
//       ⑥ 委托代录（--delegated）：免 TTY 落态 + 台账如实记 source/quote；空原话拒跑
// 用法：node templates/_agents/scripts/confirm-doc.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeFingerprint, nextStage, applyTransition, appendLedger, resolveTransition } from './confirm-doc.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(SCRIPT_DIR, 'confirm-doc.mjs');

// ---- S1 指纹：CRLF 归一（同内容不同行尾同指纹）----
{
  const lf = '---\n状态: draft\n---\n正文';
  const crlf = lf.replace(/\n/g, '\r\n');
  check('S1 CRLF 归一——同内容不同行尾指纹相同', computeFingerprint(lf) === computeFingerprint(crlf));
}

// ---- S2 指纹：剔「确认指纹:」行（防自引用——加指纹行不改指纹）----
{
  const a = '---\n状态: draft\n---\n正文';
  const b = '---\n状态: draft\n确认指纹: abc123\n---\n正文';
  check('S2 指纹行不参与指纹计算（防自引用）', computeFingerprint(a) === computeFingerprint(b));
}

// ---- S3 指纹：内容敏感（一字之差指纹不同；64 位 hex）----
{
  const fp1 = computeFingerprint('---\n状态: draft\n---\n正文A');
  const fp2 = computeFingerprint('---\n状态: draft\n---\n正文B');
  check('S3 内容敏感且为 64 位 hex', fp1 !== fp2 && /^[0-9a-f]{64}$/.test(fp1));
}

// ---- S4 nextStage：合法前向跳转（docs 两跳 + incidents 两跳，2026-09-27 gate-coverage）----
{
  check('S4 跳转表：draft→approved、approved→done、done/空/自造值→null',
    nextStage('draft') === 'approved' && nextStage('approved') === 'done'
      && nextStage('done') === null && nextStage('') === null && nextStage('进行中') === null);
  check('S4 incidents 跳转表：open→fixed、fixed→closed、closed→null（无 open→closed 单跳）',
    nextStage('open') === 'fixed' && nextStage('fixed') === 'closed'
      && nextStage('closed') === null && nextStage('open') !== 'closed');
  // --to 放弃态跳转表（2026-09-27 closing-coverage）：cancelled 自未确认/进行态；superseded 自已确认态
  const cancelOk = ['draft', 'approved', 'open', 'fixed'].every((s) => resolveTransition(s, 'cancelled') === 'cancelled');
  const supersedeOk = ['approved', 'done', 'fixed', 'closed'].every((s) => resolveTransition(s, 'superseded') === 'superseded');
  check('S4 --to 合法表：cancelled×{draft,approved,open,fixed} / superseded×{approved,done,fixed,closed} 全通',
    cancelOk && supersedeOk);
  check('S4 --to 非法表：draft→superseded / open→superseded / done→cancelled / cancelled→cancelled / 非法目标值 全拒',
    resolveTransition('draft', 'superseded') === null && resolveTransition('open', 'superseded') === null
      && resolveTransition('done', 'cancelled') === null && resolveTransition('cancelled', 'cancelled') === null
      && resolveTransition('approved', 'deleted') === null && resolveTransition('approved', null) === 'done');
}

// ---- S5 applyTransition：只动状态行 + 增指纹行，正文逐字节原样 ----
{
  const src = '---\n状态: draft\n级别: L2\n---\n\n# PLAN — x\n\n正文含 状态: 假行 不受影响';
  const out = applyTransition(src, 'approved', 'a3f9000000000000');
  check('S5 落态：状态行改值、指纹行追加、级别行与正文原样',
    out.startsWith('---\n状态: approved\n级别: L2\n确认指纹: a3f9000000000000\n---\n\n# PLAN — x\n\n正文含 状态: 假行 不受影响'),
    JSON.stringify(out));
}

// ---- S6 applyTransition：已有指纹行则覆盖（done 跳换新指纹）----
{
  const src = '---\n状态: approved\n确认指纹: old\n---\nX';
  const out = applyTransition(src, 'done', 'new1234567890abcd');
  check('S6 已有指纹行覆盖为新值', out.includes('状态: done') && out.includes('确认指纹: new1234567890abcd') && !out.includes('old'));
}

// ---- S7 applyTransition：无 frontmatter → null 不写 ----
{
  check('S7 无 frontmatter 返回 null', applyTransition('# 无 fm\n状态: draft', 'approved', 'x') === null);
}

// ---- S8 appendLedger：追加行 schema（ts/doc/stage/fingerprint/prev）----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-led-'));
  appendLedger(root, { ts: 'T', doc: 'workflow/plans/a.md', stage: 'approved', fingerprint: 'f'.repeat(64), prev: 'draft' });
  const lines = fs.readFileSync(path.join(root, '.agents', 'confirmations.jsonl'), 'utf8').trim().split('\n');
  const j = JSON.parse(lines[0]);
  check('S8 台账追加且 schema 齐', lines.length === 1 && j.doc === 'workflow/plans/a.md' && j.stage === 'approved' && j.fingerprint.length === 64 && j.prev === 'draft');
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S9【核心】非 TTY spawn（AI 调用路径）必须被拒 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-tty-'));
  const docP = path.join(root, 'workflow', 'plans');
  fs.mkdirSync(docP, { recursive: true });
  fs.writeFileSync(path.join(docP, '2026-09-27-x.md'), '---\n状态: draft\n---\n# P');
  // spawnSync 无 TTY（管道 stdin）——模拟 AI 会话内调用；即使参数完全合法也必须拒绝
  const r = spawnSync(process.execPath, [CLI, 'workflow/plans/2026-09-27-x.md'], { cwd: root, encoding: 'utf8', input: '可以\n' });
  const after = fs.readFileSync(path.join(docP, '2026-09-27-x.md'), 'utf8');
  check('S9 非 TTY 调用被拒：exit 1 + 提示 + 文档未被改动（AI 无法代确认）',
    r.status === 1 && /不可代确认/.test(r.stderr) && after === '---\n状态: draft\n---\n# P',
    JSON.stringify({ status: r.status, stderr: r.stderr, after }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S10 非 TTY 拒绝先于参数校验（无参数同拒）----
{
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  check('S10 TTY 门最先（无参数也是拒绝而非用法提示）', r.status === 1 && /不可代确认/.test(r.stderr));
}

// ---- S11 委托代录：非 TTY spawn + --delegated → 免 TTY 落态 + 台账如实记 source/quote ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-del-'));
  const docP = path.join(root, 'workflow', 'plans');
  fs.mkdirSync(docP, { recursive: true });
  fs.writeFileSync(path.join(docP, '2026-09-27-d.md'), '---\n状态: draft\n级别: L2\n---\n# P\n');
  const before = fs.readFileSync(path.join(docP, '2026-09-27-d.md'), 'utf8');
  const fpExpect = computeFingerprint(before);
  // spawnSync 无 TTY（管道 stdin）——模拟 AI 会话内委托代录调用
  const r = spawnSync(process.execPath, [CLI, 'workflow/plans/2026-09-27-d.md', '--delegated', '2选2'], { cwd: root, encoding: 'utf8' });
  const after = fs.readFileSync(path.join(docP, '2026-09-27-d.md'), 'utf8');
  const led = fs.readFileSync(path.join(root, '.agents', 'confirmations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const j = led[led.length - 1];
  check('S11 委托代录：exit 0 + draft→approved + 指纹行 + 台账 source=chat-delegated / quote=原话 / 指纹全量与 frontmatter 前 16 位配对',
    r.status === 0 && after.includes('状态: approved') && after.includes(`确认指纹: ${fpExpect.slice(0, 16)}`)
      && j.source === 'chat-delegated' && j.quote === '2选2' && j.stage === 'approved' && j.prev === 'draft'
      && j.fingerprint === fpExpect,
    JSON.stringify({ status: r.status, stderr: r.stderr, ledger: led }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S12 委托代录第二跳：approved→done 换新指纹（台账行仍如实记来源）----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-del2-'));
  const docP = path.join(root, 'workflow', 'intents');
  fs.mkdirSync(docP, { recursive: true });
  const fp1 = computeFingerprint('---\n状态: draft\n---\n# I\n');
  fs.writeFileSync(path.join(docP, '2026-09-27-e.md'), `---\n状态: approved\n确认指纹: ${fp1.slice(0, 16)}\n---\n# I\n`);
  const before = fs.readFileSync(path.join(docP, '2026-09-27-e.md'), 'utf8');
  const fp2 = computeFingerprint(before);
  const r = spawnSync(process.execPath, [CLI, 'workflow/intents/2026-09-27-e.md', '--delegated', '可以'], { cwd: root, encoding: 'utf8' });
  const after = fs.readFileSync(path.join(docP, '2026-09-27-e.md'), 'utf8');
  const led = fs.readFileSync(path.join(root, '.agents', 'confirmations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  check('S12 委托第二跳：approved→done + 指纹行换新值 + 台账 stage=done / source 如实',
    r.status === 0 && after.includes('状态: done') && after.includes(`确认指纹: ${fp2.slice(0, 16)}`) && !after.includes(fp1.slice(0, 16))
      && led[led.length - 1].stage === 'done' && led[led.length - 1].source === 'chat-delegated',
    JSON.stringify({ status: r.status, after }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S13 委托代录：--delegated 空原话 → exit 1 用法提示，零文件改动 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-del3-'));
  const docP = path.join(root, 'workflow', 'plans');
  fs.mkdirSync(docP, { recursive: true });
  fs.writeFileSync(path.join(docP, '2026-09-27-f.md'), '---\n状态: draft\n---\n# P\n');
  const r = spawnSync(process.execPath, [CLI, 'workflow/plans/2026-09-27-f.md', '--delegated', '  '], { cwd: root, encoding: 'utf8' });
  const after = fs.readFileSync(path.join(docP, '2026-09-27-f.md'), 'utf8');
  const noLedger = !fs.existsSync(path.join(root, '.agents', 'confirmations.jsonl'));
  check('S13 空原话拒跑：exit 1 + 用法提示 + 文档未动 + 无台账',
    r.status === 1 && /--delegated 须带用户对话原话/.test(r.stderr) && after === '---\n状态: draft\n---\n# P\n' && noLedger,
    JSON.stringify({ status: r.status, stderr: r.stderr }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S15 incidents 委托代录（2026-09-27 gate-coverage）：open→fixed 落态 + 台账 stage=fixed ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-inc-'));
  const docP = path.join(root, 'workflow', 'incidents');
  fs.mkdirSync(docP, { recursive: true });
  fs.writeFileSync(path.join(docP, '2026-09-28-i.md'), '---\n状态: open\n级别: L1\n---\n# I\n');
  const before = fs.readFileSync(path.join(docP, '2026-09-28-i.md'), 'utf8');
  const fpExpect = computeFingerprint(before);
  const r = spawnSync(process.execPath, [CLI, 'workflow/incidents/2026-09-28-i.md', '--delegated', '修好了'], { cwd: root, encoding: 'utf8' });
  const after = fs.readFileSync(path.join(docP, '2026-09-28-i.md'), 'utf8');
  const led = fs.readFileSync(path.join(root, '.agents', 'confirmations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const j = led[led.length - 1];
  check('S15 incidents 委托代录：exit 0 + open→fixed + 指纹行 + 台账 stage=fixed / prev=open',
    r.status === 0 && after.includes('状态: fixed') && after.includes(`确认指纹: ${fpExpect.slice(0, 16)}`)
      && j.source === 'chat-delegated' && j.quote === '修好了' && j.stage === 'fixed' && j.prev === 'open'
      && j.fingerprint === fpExpect,
    JSON.stringify({ status: r.status, stderr: r.stderr, ledger: led }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S16 放弃态 --to（2026-09-27 closing-coverage）：draft --to cancelled 委托代录落态 + 台账 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-to-'));
  const docP = path.join(root, 'workflow', 'intents');
  fs.mkdirSync(docP, { recursive: true });
  fs.writeFileSync(path.join(docP, '2026-09-28-c.md'), '---\n状态: draft\n级别: L1\n---\n# I\n');
  const before = fs.readFileSync(path.join(docP, '2026-09-28-c.md'), 'utf8');
  const fpExpect = computeFingerprint(before);
  const r = spawnSync(process.execPath, [CLI, 'workflow/intents/2026-09-28-c.md', '--to', 'cancelled', '--delegated', '不做了'], { cwd: root, encoding: 'utf8' });
  const after = fs.readFileSync(path.join(docP, '2026-09-28-c.md'), 'utf8');
  const led = fs.readFileSync(path.join(root, '.agents', 'confirmations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const j = led[led.length - 1];
  check('S16 --to cancelled 委托代录：exit 0 + draft→cancelled + 台账 stage=cancelled / prev=draft',
    r.status === 0 && after.includes('状态: cancelled') && after.includes(`确认指纹: ${fpExpect.slice(0, 16)}`)
      && j.stage === 'cancelled' && j.prev === 'draft' && j.quote === '不做了' && j.fingerprint === fpExpect,
    JSON.stringify({ status: r.status, stderr: r.stderr, ledger: led }));
  // 调用事实（2026-09-28 batch-ledger-audit）：委托单份 → of=1、seq=1、batch 为非空字符串
  // （check-loop 检查 15 的并录审计据此判「是否一次调用落多份」——不再从 quote/ts 反推）
  check('S16b 台账行含调用事实 batch/seq/of 且单份 = of=1 / seq=1',
    typeof j.batch === 'string' && j.batch.length > 0 && j.seq === 1 && j.of === 1,
    JSON.stringify({ batch: j.batch, seq: j.seq, of: j.of }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S17 --to 非法组合拒跑：done --to cancelled → 跳过且不落台账 ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-to2-'));
  const docP = path.join(root, 'workflow', 'plans');
  fs.mkdirSync(docP, { recursive: true });
  fs.writeFileSync(path.join(docP, '2026-09-28-d.md'), '---\n状态: done\n级别: L1\n---\n# P\n');
  const r = spawnSync(process.execPath, [CLI, 'workflow/plans/2026-09-28-d.md', '--to', 'cancelled', '--delegated', '试试'], { cwd: root, encoding: 'utf8' });
  const after = fs.readFileSync(path.join(docP, '2026-09-28-d.md'), 'utf8');
  const noLedger = !fs.existsSync(path.join(root, '.agents', 'confirmations.jsonl'));
  check('S17 --to 非法组合（done→cancelled）：跳过不落态 + 无台账 + 文档未动',
    /无合法跳转/.test(r.stderr || '') && after.includes('状态: done') && noLedger,
    JSON.stringify({ stderr: r.stderr }));
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- S18 delegated 单文档强制（2026-09-27 confirm-gate-one-per-call）----
//     多文档并录曾系统性塌掉三道阶段门（build.md「逐件确认不得并作一次」）——机器层收口
{
  const mk2docs = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-single-'));
    for (const sub of ['intents', 'plans']) {
      fs.mkdirSync(path.join(root, 'workflow', sub), { recursive: true });
      fs.writeFileSync(path.join(root, 'workflow', sub, '2026-09-27-s.md'), `---\n状态: draft\n级别: L1\n---\n# ${sub === 'intents' ? 'I' : 'P'}\n`);
    }
    return root;
  };
  {
    const root = mk2docs();
    const before1 = fs.readFileSync(path.join(root, 'workflow', 'intents', '2026-09-27-s.md'), 'utf8');
    const before2 = fs.readFileSync(path.join(root, 'workflow', 'plans', '2026-09-27-s.md'), 'utf8');
    const r = spawnSync(process.execPath, [CLI, 'workflow/intents/2026-09-27-s.md', 'workflow/plans/2026-09-27-s.md', '--delegated', '两份一起'], { cwd: root, encoding: 'utf8' });
    const noLedger = !fs.existsSync(path.join(root, '.agents', 'confirmations.jsonl'));
    const after1 = fs.readFileSync(path.join(root, 'workflow', 'intents', '2026-09-27-s.md'), 'utf8');
    const after2 = fs.readFileSync(path.join(root, 'workflow', 'plans', '2026-09-27-s.md'), 'utf8');
    check('S18 delegated 双文档 → exit 1 拒绝 + 逐件口径提示 + 零台账 + 文档零改动',
      r.status === 1 && /一次仅接受一份文档/.test(r.stderr) && /逐件/.test(r.stderr)
        && noLedger && after1 === before1 && after2 === before2,
      JSON.stringify({ status: r.status, stderr: r.stderr }));
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    const root = mk2docs();
    const r1 = spawnSync(process.execPath, [CLI, 'workflow/intents/2026-09-27-s.md', '--delegated', '第一份可以'], { cwd: root, encoding: 'utf8' });
    const r2 = spawnSync(process.execPath, [CLI, 'workflow/plans/2026-09-27-s.md', '--delegated', '第一份可以'], { cwd: root, encoding: 'utf8' });
    check('S18 delegated 单文档逐次调用照常（两次各落态各记账）',
      r1.status === 0 && r2.status === 0
        && fs.readFileSync(path.join(root, 'workflow', 'intents', '2026-09-27-s.md'), 'utf8').includes('状态: approved')
        && fs.readFileSync(path.join(root, 'workflow', 'plans', '2026-09-27-s.md'), 'utf8').includes('状态: approved'),
      JSON.stringify({ r1: r1.status, r2: r2.status, stderr: r2.stderr }));
    // 调用事实（2026-09-28 batch-ledger-audit）：每次进程调用 **一个** batch；两次独立调用 batch **不同**，
    // 各自 seq=1 / of=1——这是并录审计「逐件 vs 并录」的判别基础（复核 P2-2：plan 要求覆盖此面）
    const led2 = fs.readFileSync(path.join(root, '.agents', 'confirmations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const [e1, e2] = led2.slice(-2);
    check('S18b 两次独立调用各生成独立 batch（不同批、各自 seq=1/of=1）',
      e1.batch !== e2.batch && e1.seq === 1 && e2.seq === 1 && e1.of === 1 && e2.of === 1,
      JSON.stringify(led2.slice(-2)));
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    // 【复核 P2-2】单次调用落 N 份 → batch 相同 / seq 递增 1,2 / of=2 —— **端到端**验证 TTY 多文档路径。
    // 该路径仅 TTY 可达（delegated 已被入口限为 1 份），故注入两个**仅测试用**逃生门：
    //   CONFIRM_DOC_TEST_TTY=1      —— 放行 isTTY 判定（本环境无 TTY）
    //   CONFIRM_DOC_TEST_ANSWERS    —— 按序注入问答应答（见下「为什么不能用管道 stdin」）
    //   NODE_ENV=test               —— TTY 逃生门双条件的第二键（2026-09-28 check16-inline-debt：
    //                                 单变量可被生产会话顺手设置绕过 TTY 门，收紧为双条件）
    // 三者均不改动任何落态/记账语义。
    //
    // **为什么不能用 spawnSync 的 input 管道（2026-09-28 更正）**：此前本用例用 `input:'可以\n可以\n'`
    // 并断言「首份」了事，注释把根因误记为「readline 对第二份提问会 unsettled / 管道输入不被逐次消费」。
    // 经复现，真实机制是：spawnSync 的管道**一次性写完即关闭写端**，readline 在第一个 question 注册前
    // 就已把第二行读入并丢弃，且 stdin 随即 EOF —— 第二个 question 永远等不到输入。**与「有无 TTY」无关**，
    // 是「管道 EOF + 跨 await 边界的 question 注册时序」所致（嵌套回调版同样两问两答可用，加 await 即挂）。
    const root = mk2docs();
    const r = spawnSync(process.execPath, [CLI, 'workflow/intents/2026-09-27-s.md', 'workflow/plans/2026-09-27-s.md'], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, CONFIRM_DOC_TEST_TTY: '1', CONFIRM_DOC_TEST_ANSWERS: '可以,可以', NODE_ENV: 'test' },
    });
    const ledN = fs.readFileSync(path.join(root, '.agents', 'confirmations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const stI = fs.readFileSync(path.join(root, 'workflow', 'intents', '2026-09-27-s.md'), 'utf8');
    const stP = fs.readFileSync(path.join(root, 'workflow', 'plans', '2026-09-27-s.md'), 'utf8');
    check('S18c 单次调用落 2 份（TTY 多文档）端到端 → batch 相同 / seq 1,2 / of 均=2 / 两份都落态',
      r.status === 0 && ledN.length === 2
        && ledN[0].batch === ledN[1].batch && typeof ledN[0].batch === 'string' && ledN[0].batch.length > 0
        && ledN[0].seq === 1 && ledN[1].seq === 2
        && ledN[0].of === 2 && ledN[1].of === 2
        && ledN[0].source === 'tty' && ledN[1].source === 'tty'
        && stI.includes('状态: approved') && stP.includes('状态: approved'),
      JSON.stringify({ status: r.status, stderr: String(r.stderr).slice(0, 300), ledger: ledN }));
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    // 【复核 P2-2】注入应答不足时，剩余文档按「未确认」跳过（不落态、不记账）——钉住注入语义的边界，
    // 避免测试逃生门被误用成「无条件放行」。
    const root = mk2docs();
    const r = spawnSync(process.execPath, [CLI, 'workflow/intents/2026-09-27-s.md', 'workflow/plans/2026-09-27-s.md'], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, CONFIRM_DOC_TEST_TTY: '1', CONFIRM_DOC_TEST_ANSWERS: '可以', NODE_ENV: 'test' }, // 只给一份应答
    });
    const led1 = fs.readFileSync(path.join(root, '.agents', 'confirmations.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const stP1 = fs.readFileSync(path.join(root, 'workflow', 'plans', '2026-09-27-s.md'), 'utf8');
    check('S18d 注入应答不足 → 仅首份落态，次份按跳过处理（不落态不记账）',
      led1.length === 1 && led1[0].seq === 1 && led1[0].of === 2 && stP1.includes('状态: draft'),
      JSON.stringify({ status: r.status, ledger: led1 }));
    fs.rmSync(root, { recursive: true, force: true });
  }
  {
    // 【T3 双条件】仅设 CONFIRM_DOC_TEST_TTY=1 而未设 NODE_ENV=test → 逃生门不生效，仍按非 TTY 拒绝
    // （2026-09-28 check16-inline-debt：单变量可被生产会话顺手设置绕过 TTY 门，收紧为双条件——
    //   本用例钉住「缺第二键即不放行」，与 S18c/S18d 的「双键齐 → 放行」构成双向覆盖）
    const root = mk2docs();
    const env1 = { ...process.env, CONFIRM_DOC_TEST_TTY: '1', CONFIRM_DOC_TEST_ANSWERS: '可以' };
    delete env1.NODE_ENV; // 显式剔除——防宿主环境恰好携带 NODE_ENV 时用例失真
    const r = spawnSync(process.execPath, [CLI, 'workflow/intents/2026-09-27-s.md'], {
      cwd: root, encoding: 'utf8', env: env1,
    });
    const noLedger = !fs.existsSync(path.join(root, '.agents', 'confirmations.jsonl'));
    const afterI = fs.readFileSync(path.join(root, 'workflow', 'intents', '2026-09-27-s.md'), 'utf8');
    check('S18e 仅 CONFIRM_DOC_TEST_TTY=1 无 NODE_ENV=test → 仍非 TTY 拒绝（exit 1 + 零台账 + 文档未动）',
      r.status === 1 && /不可代确认/.test(r.stderr) && noLedger && afterI.includes('状态: draft'),
      JSON.stringify({ status: r.status, stderr: String(r.stderr).slice(0, 200) }));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
