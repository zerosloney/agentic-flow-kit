#!/usr/bin/env node
// verify.mjs 的 fixture 测试（--test-cmd 注入假命令 + CHECK_LOOP_ROOT 注入夹具根，不触真实 npm test 与 workflow）
// 断言：①绿路径（假过 + 空夹具闭环）exit 0；②步骤假败 exit 1 且失败行留痕（suite=test）；
// ③步骤 2 配对断裂夹具 exit 1（verify 自身标记断言）；④凭证落账（绿行 + 计数捕获）；
// ④b fixture 绿不产 committed 摘要；⑤check-loop 红失败行留痕、无绿行；
// ⑥无汇总行省略计数键；⑦装户仓（cwd 无 package.json）跳过测试门、不落凭证、其余门全过 → exit 0；
// ⑧--doc 绑定五态；⑨⑩嵌套套件同形汇总行不得被误取；⑪--list 七门序；⑫--list 与 --test-cmd 互斥；
// ⑬生产模式中段红 → fail-fast + 未执行门清单 + 失败行留痕；
// ⑭生产模式全绿端到端（七门 + 凭证含门数/headShort/套件计数 + 绿凭证摘要生成）。
// 生产模式夹具经 fixture-scripts.mjs#copyScriptClosure 把门脚本依赖闭包拷进临时根（并种子
// workflow/effective-policy.md——生效规则视图门对缺文件判漂移，与 init 生成器首跑同款）。
// 用法：node templates/_agents/scripts/verify.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyScriptClosure } from './fixture-scripts.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VERIFY = path.join(SCRIPT_DIR, 'verify.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

// 空闭环夹具（四目录齐全、无文档 → check-loop 无断档；枚举单源随 fixture 内联——check-loop 启动段 fail-loud 要求）
const mkfix = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-fix-'));
  for (const s of ['intents', 'specs', 'plans', 'incidents']) fs.mkdirSync(path.join(d, 'workflow', s), { recursive: true });
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'workflow-enums.txt'), [
    'doc.status.all=draft approved done superseded cancelled',
    'doc.status.confirmed=approved done superseded cancelled',
    'doc.status.active=draft approved',
    'doc.status.terminal=done superseded cancelled',
    'doc.status.abandoned=superseded cancelled',
    'incident.status.all=open fixed closed',
    'incident.status.active=open',
    'level.all=L1 L2 L3',
    '',
  ].join('\n'), 'utf8');
  return d;
};
// 配对断裂夹具（L1 intent 无同名 plan → hard-block）
const mkBroken = () => {
  const d = mkfix();
  fs.writeFileSync(path.join(d, 'workflow', 'intents', '2026-09-12-lonely.md'), [
    '---', '状态: done', '级别: L1', '日期: 2026-09-12', '---', '# INTENT — lonely', '',
    '## 验收标准（可测试）', '- [x] 用例通过（证据:dotnet test 全绿）', '',
  ].join('\n'), 'utf8');
  return d;
};
// 假命令（绝对路径直调，不依赖 PATH，跨平台无引号问题）；out 可选输出汇总行
const mkCmd = (code, out = '') => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cmd-')), `exit${code}.mjs`);
  fs.writeFileSync(f, `process.stdout.write(${JSON.stringify(out)});process.exit(${code});`, 'utf8');
  return f;
};
const run = (argv, opts = {}) => spawnSync(process.execPath, [VERIFY, ...argv], { encoding: 'utf8', ...opts });

// 生产模式夹具：门脚本依赖闭包拷贝 + .agents/hooks 目录（语法门 fail-closed 要求）+
// workflow/effective-policy.md 种子（生效规则视图门对缺文件判漂移——与 init §6 生成器首跑同款）
const provision = (root) => {
  fs.mkdirSync(path.join(root, '.agents', 'hooks'), { recursive: true });
  copyScriptClosure(path.join(root, '.agents', 'scripts'), [
    'check-scripts-syntax.mjs', 'workflows-check.mjs', 'rule-budget.mjs',
    'gen-effective-policy.mjs', 'check-ledger-invariant.mjs', 'check-loop.mjs',
  ]);
  const gen = spawnSync(process.execPath, [path.join(root, '.agents', 'scripts', 'gen-effective-policy.mjs'), '--root', root], { encoding: 'utf8' });
  if (gen.status !== 0) throw new Error(`夹具种子生成失败：${gen.stdout}${gen.stderr}`);
  return root;
};
// 生产夹具变 git 仓（台账不变量门在非 git 根会 fail-closed；commit 供凭证 headShort 钉 SHA）
const gitify = (root) => {
  const g = (a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  g(['init']);
  g(['-c', 'user.email=fixture@test', '-c', 'user.name=fixture', 'add', '-A']);
  const c = g(['-c', 'user.email=fixture@test', '-c', 'user.name=fixture', 'commit', '-m', 'fixture init', '--no-gpg-sign', '-q']);
  if (c.status !== 0) throw new Error(`夹具 git commit 失败：${c.stderr}`);
  return g(['rev-parse', '--short', 'HEAD']).stdout.trim();
};
const readLedger = (root) => {
  const p = path.join(root, '.agents', 'verifications.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
};

// ---- 场景 1：绿路径——假过 + 空夹具闭环 → exit 0 ----
{
  const root = mkfix();
  const r = run(['--test-cmd', `node ${mkCmd(0)}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('场景 1：exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  check('场景 1：两步全过且输出全绿', r.stdout.includes('✅ 1/2') && r.stdout.includes('✅ 2/2') && r.stdout.includes('全绿'), r.stdout);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：红路径测试门——假败 → exit 1、fail-fast 不出全绿；失败行留痕 ----
{
  const root = mkfix();
  const r = run(['--test-cmd', `node ${mkCmd(3)}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('场景 2：exit 1', r.status === 1, `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  check('场景 2：步骤失败标记在 stderr，且不输出全绿', r.stderr.includes('❌ 1/2') && !r.stdout.includes('全绿'), `${r.stdout}\n${r.stderr}`);
  const lines = readLedger(root);
  check('场景 2：测试门红 → 失败行留痕（exitCode 3 + suite=test）',
    lines.length === 1 && lines[0].exitCode === 3 && lines[0].suite === 'test' && typeof lines[0].ts === 'string',
    `lines=${JSON.stringify(lines)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：红路径步骤 2——配对断裂夹具 → exit 1 ----
{
  const root = mkBroken();
  const r = run(['--test-cmd', `node ${mkCmd(0)}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('场景 3：exit 1', r.status === 1, `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  check('场景 3：步骤 2 失败标记在 stderr，且不输出全绿', r.stderr.includes('❌ 2/2') && !r.stdout.includes('全绿'), `${r.stdout}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4：绿路径凭证落账——全绿后 fixture 台账出合法绿行（计数捕获 + testCmd 注入输出口径） ----
{
  const root = mkfix();
  const r = run(['--test-cmd', `node ${mkCmd(0, '[run-tests] 合计: SUITES 3 / FAILED 0\n')}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  const line = readLedger(root)[0] || null;
  check('场景 4：全绿 → verifications.jsonl 落绿行（exitCode 0 + 计数捕获 + 门数）',
    r.status === 0 && line !== null && line.exitCode === 0 && line.passed === 3 && line.failed === 0
      && line.gates === 2 && typeof line.ts === 'string' && line.suite === 'npm test' && r.stdout.includes('凭证已落账'),
    `exit=${r.status} line=${JSON.stringify(line)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4b：fixture 全绿不得触发摘要生成（假门凭证只进本地台账，不产 committed 摘要） ----
{
  const root = mkfix();
  const r = run(['--test-cmd', `node ${mkCmd(0, '[run-tests] 合计: SUITES 3 / FAILED 0\n')}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  const ev = path.join(root, 'workflow', 'verify-evidence.md');
  check('场景 4b：fixture 绿 → 不生成 workflow/verify-evidence.md、输出无摘要生成标记',
    r.status === 0 && !fs.existsSync(ev) && !r.stdout.includes('已生成'),
    `exit=${r.status} exists=${fs.existsSync(ev)}\n${r.stdout}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 5：check-loop 红 → 失败行留痕、无绿行（失败也留痕；绿行语义 = verify 全绿不变） ----
{
  const root = mkBroken();
  const r = run(['--test-cmd', `node ${mkCmd(0)}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  const lines = readLedger(root);
  check('场景 5：测试门绿但 check-loop 红 → 仅失败行（suite=check-loop），无绿行',
    r.status === 1 && lines.length === 1 && lines[0].exitCode !== 0 && lines[0].suite === 'check-loop'
      && !lines.some((l) => l.exitCode === 0),
    `exit=${r.status} lines=${JSON.stringify(lines)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 6：输出无汇总行 → 计数键省略（exitCode 才是硬事实） ----
{
  const root = mkfix();
  const r = run(['--test-cmd', `node ${mkCmd(0, 'ok\n')}`], { env: { ...process.env, CHECK_LOOP_ROOT: root } });
  const line = readLedger(root)[0] || null;
  check('场景 6：无汇总输出 → 绿行落盘但计数键省略',
    r.status === 0 && line !== null && line.exitCode === 0 && !('passed' in line) && !('failed' in line),
    `line=${JSON.stringify(line)}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 7：装户仓（cwd 无 package.json）且未给 --test-cmd → 跳过测试门、不落凭证、其余门全过 → exit 0 ----
{
  const root = provision(mkfix());
  gitify(root);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-bare-'));
  const r = run([], { cwd: bare, env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('场景 7：exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  check('场景 7：测试门显式跳过（⏭ 2/7）、末门通过且全绿', r.stdout.includes('⏭ 2/7') && r.stdout.includes('✅ 7/7') && r.stdout.includes('全绿'), r.stdout);
  check('场景 7：跳过时不落测试绿凭证（防假绿）且不生成摘要',
    readLedger(root).length === 0 && !fs.existsSync(path.join(root, 'workflow', 'verify-evidence.md')) && r.stdout.includes('不落测试绿凭证'),
    r.stdout);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
}

// ---- 场景 8：--doc 凭证绑定 ----
// ① 带 --doc → 末行含 doc 且为规范化 posix 相对路径；② 不带 → 末行**无 doc 键**（不是 null）；
// ③ win32 反斜杠 / posix / 绝对路径三种写法落同一值（归一是本单的地基，错一处=凭证永远匹配不上）；
// ④ 缺值 → exit 1 用法错误；⑤ 跳过测试门时即便带 --doc 仍不落账（防假绿语义不得被 --doc 破坏）。
{
  const readLast = (root) => {
    const lines = readLedger(root);
    return lines.length ? lines[lines.length - 1] : null;
  };

  const rootA = mkfix();
  const rel = 'workflow/intents/2026-10-08-demo.md';
  const rA = run(['--test-cmd', `node ${mkCmd(0, '[run-tests] 合计: SUITES 3 / FAILED 0\n')}`, '--doc', rel],
    { env: { ...process.env, CHECK_LOOP_ROOT: rootA } });
  const eA = readLast(rootA);
  check('场景 8①：带 --doc → 末行含 doc 且为 posix 相对路径',
    rA.status === 0 && eA && eA.doc === rel && rA.stdout.includes('绑定本单'), `exit=${rA.status} entry=${JSON.stringify(eA)}`);

  const rootB = mkfix();
  run(['--test-cmd', `node ${mkCmd(0)}`], { env: { ...process.env, CHECK_LOOP_ROOT: rootB } });
  const eB = readLast(rootB);
  check('场景 8②：不带 --doc → 仍落行但**无 doc 键**（CI 路径不退化；此行不给任何单背书）',
    eB && eB.exitCode === 0 && !('doc' in eB) && eB.suite === 'npm test', JSON.stringify(eB));

  // 归一：cwd 设为仓库根时，win32 反斜杠 / posix / 绝对路径三种写法须落同一值
  const rootC = mkfix();
  const abs = path.join(rootC, rel);
  const winStyle = rel.split('/').join(path.sep);
  run(['--test-cmd', `node ${mkCmd(0)}`, '--doc', winStyle], { cwd: rootC, env: { ...process.env, CHECK_LOOP_ROOT: rootC } });
  const eC1 = readLast(rootC);
  run(['--test-cmd', `node ${mkCmd(0)}`, '--doc', abs], { cwd: rootC, env: { ...process.env, CHECK_LOOP_ROOT: rootC } });
  const eC2 = readLast(rootC);
  check('场景 8③：反斜杠 / posix / 绝对路径三种写法落同一 doc 值（归一是地基）',
    eC1 && eC1.doc === rel && eC2 && eC2.doc === rel, `win=${JSON.stringify(eC1 && eC1.doc)} abs=${JSON.stringify(eC2 && eC2.doc)}`);

  const rootD = mkfix();
  const rD = run(['--test-cmd', `node ${mkCmd(0)}`, '--doc'], { env: { ...process.env, CHECK_LOOP_ROOT: rootD } });
  check('场景 8④：--doc 缺值 → exit 1 + 用法提示',
    rD.status === 1 && /--doc 缺值/.test(rD.stderr), `exit=${rD.status} ${rD.stderr}`);

  const rootE = provision(mkfix());
  gitify(rootE);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-bare-doc-'));
  const rE = run(['--doc', rel], { cwd: bare, env: { ...process.env, CHECK_LOOP_ROOT: rootE } });
  check('场景 8⑤：测试门跳过时即便带 --doc 仍不落账（防假绿语义不被 --doc 破坏）',
    rE.status === 0 && readLedger(rootE).length === 0 && rE.stdout.includes('不落测试绿凭证'),
    `exit=${rE.status} ${rE.stdout}`);

  for (const r of [rootA, rootB, rootC, rootD, rootE]) fs.rmSync(r, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
}

// ---- 场景 9 / 10：嵌套套件同形汇总行不得被误取（计数口径=编排器权威套件数，回归锁） ----
// 缺陷复现：旧判据 pop 通配「合计: PASS n / FAIL n」，而全套件每个都打印自己那行同形文本，
// 取到的是字母序最后一个套件的场景数，落进凭证 passed。
// ⑨ 权威行与同形行并存 → 取权威套件数；⑩ 仅有同形行 → 省略计数键（宁缺勿错，不回退到错的事实）。
{
  const root9 = mkfix();
  const r9 = run(['--test-cmd', `node ${mkCmd(0, '合计: PASS 15 / FAIL 0\n[run-tests] 合计: SUITES 45 / FAILED 0\n')}`],
    { env: { ...process.env, CHECK_LOOP_ROOT: root9 } });
  const l9 = readLedger(root9)[0] || null;
  check('场景 9：嵌套套件同形行不被误取，计数取编排器权威套件数',
    r9.status === 0 && l9 !== null && l9.passed === 45 && l9.failed === 0,
    `line=${JSON.stringify(l9)}`);
  fs.rmSync(root9, { recursive: true, force: true });

  const root10 = mkfix();
  const r10 = run(['--test-cmd', `node ${mkCmd(0, '合计: PASS 15 / FAIL 0\n')}`],
    { env: { ...process.env, CHECK_LOOP_ROOT: root10 } });
  const l10 = readLedger(root10)[0] || null;
  check('场景 10：仅有嵌套同形行 → 绿行落盘但省略计数键（不回退到错的事实）',
    r10.status === 0 && l10 !== null && l10.exitCode === 0 && !('passed' in l10) && !('failed' in l10),
    `line=${JSON.stringify(l10)}`);
  fs.rmSync(root10, { recursive: true, force: true });
}

// ---- 场景 12：--stub-gate 走生产尾段（落凭证；2026-10-16 自源仓 13f67ef7 回灌）----
// 单门夹具但按生产路径落绿行（不打 testCmd 标记）；必须配 CHECK_LOOP_ROOT。
{
  const root = mkfix();
  fs.mkdirSync(path.join(root, 'workflow'), { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(root, 'README.md'), 'stub\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'base']);
  const r = run(['--stub-gate', `node ${mkCmd(0)}`], { env: { ...process.env, CHECK_LOOP_ROOT: root, RUN_E2E: '' } });
  const l = readLedger(root)[0] || null;
  check('场景 12：stub 单门 exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  check('场景 12：落绿行（suite=npm test）且无 testCmd 标记',
    l !== null && l.suite === 'npm test' && l.exitCode === 0 && !('testCmd' in l), JSON.stringify(l));
  fs.rmSync(root, { recursive: true, force: true });
}
// 场景 12b：无 CHECK_LOOP_ROOT → exit 2，不跑门（信任边界：夹具单门不得当真实凭证）
{
  const env = { ...process.env, RUN_E2E: '' };
  delete env.CHECK_LOOP_ROOT;
  const r = run(['--stub-gate', 'node -e "process.exit(0)"'], { env });
  check('场景 12b：--stub-gate 无 CHECK_LOOP_ROOT → exit 2 且不跑门',
    r.status === 2 && String(r.stderr).includes('CHECK_LOOP_ROOT') && !String(r.stdout).includes('全绿'),
    `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
}

// ---- 场景 11：--list 锁定 engine cohort 七门序，不执行门 ----
{
  const expect = ['scripts-syntax', 'engine-tests', 'workflows-check', 'rule-budget', 'effective-policy', 'check-loop', 'ledger-invariant'];
  const r = run(['--list'], {});
  const ids = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  check('场景 11：--list exit 0 且恰七门、序不变、不执行',
    r.status === 0 && ids.length === expect.length && expect.every((id, i) => ids[i] === id)
      && !String(r.stdout).includes('开始静态门'),
    `exit=${r.status}\n${r.stdout}`);
}

// ---- 场景 12：--list 与 --test-cmd 互斥 ----
{
  const r = run(['--list', '--test-cmd', 'node nothing.mjs'], {});
  check('场景 12：--list + --test-cmd → exit 1', r.status === 1 && /互斥/.test(r.stderr), `exit=${r.status} ${r.stderr}`);
}

// ---- 场景 13：生产模式中段红 → fail-fast + 未执行门清单 + 失败行留痕 ----
// 编排脚本检查门注入一份缺 frontmatter 的坏编排（E1 error）→ 第 3 门红，后四门状态未知须点名
{
  const root = provision(mkfix());
  fs.mkdirSync(path.join(root, '.agents', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'workflows', 'bad.md'), '没有 frontmatter 的坏编排\n', 'utf8');
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-bare-ff-'));
  const r = run([], { cwd: bare, env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('场景 13：exit 1 且不出全绿', r.status === 1 && !r.stdout.includes('全绿'), `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  check('场景 13：fail-fast 点名未执行门（rule-budget、effective-policy、check-loop、ledger-invariant）',
    r.stderr.includes('未执行门') && ['rule-budget', 'effective-policy', 'check-loop', 'ledger-invariant'].every((id) => r.stderr.includes(id)),
    r.stderr);
  const lines = readLedger(root);
  check('场景 13：失败行留痕（suite=workflows-check）且无绿行',
    lines.length === 1 && lines[0].suite === 'workflows-check' && lines[0].exitCode !== 0,
    `lines=${JSON.stringify(lines)}`);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
}

// ---- 场景 14：生产模式全绿端到端——七门按序全过、凭证钉门数/headShort/套件计数、摘要生成 ----
{
  const root = provision(mkfix());
  // 根 package.json（装户带根 package.json 的形态）：测试命令打印编排器权威汇总行
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'verify-e2e-fixture',
    private: true,
    scripts: { test: 'node .agents/probe-test.mjs' },
  }, null, 2));
  fs.writeFileSync(path.join(root, '.agents', 'probe-test.mjs'), "console.log('[run-tests] 合计: SUITES 3 / FAILED 0');\n", 'utf8');
  const headShort = gitify(root);
  const r = run([], { cwd: root, env: { ...process.env, CHECK_LOOP_ROOT: root } });
  check('场景 14：exit 0 且七门逐门输出 + 全绿',
    r.status === 0 && ['✅ 1/7', '✅ 2/7', '✅ 3/7', '✅ 4/7', '✅ 5/7', '✅ 6/7', '✅ 7/7'].every((s) => r.stdout.includes(s)) && r.stdout.includes('全绿'),
    `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  const line = readLedger(root)[0] || null;
  check('场景 14：绿凭证钉门数 7 + headShort + 套件计数',
    line !== null && line.exitCode === 0 && line.gates === 7 && line.headShort === headShort && line.passed === 3 && line.failed === 0,
    `headShort=${line && line.headShort} expect=${headShort} line=${JSON.stringify(line)}`);
  const ev = path.join(root, 'workflow', 'verify-evidence.md');
  const evText = fs.existsSync(ev) ? fs.readFileSync(ev, 'utf8') : '';
  check('场景 14：绿凭证摘要已生成且含本 SHA 一行（自动重生成接线）',
    fs.existsSync(ev) && evText.includes(`\`${headShort}\``) && evText.includes('| 7 | PASS 3 / FAIL 0 |'),
    evText);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log('\n用法：node templates/_agents/scripts/verify.test.mjs');
  process.exit(1);
}
process.exit(0);
