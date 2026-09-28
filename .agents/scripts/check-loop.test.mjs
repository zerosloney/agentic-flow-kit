#!/usr/bin/env node
// check-loop.test.mjs — 闭环门禁 fixture 套件（2026-09-26 check-loop-node：自 check-loop.test.sh 全量移植）
// 方法：现场构造临时 workflow 根（含枚举单源内联件），spawn node check-loop.mjs（CHECK_LOOP_ROOT 注入，
//       git 模式场景改 cwd 注入），断言 exit code 与输出关键词——场景集与关键词断言沿 sh 版逐条移植。
// git 场景用 git init 现场建仓；rule-budget --staged 两场景直调 sh（rule-budget.sh 仍为 sh——
//       git 钩子环境保证；无 sh 环境打印 SKIP 不算失败）。
// 用法：node templates/_agents/scripts/check-loop.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeFingerprint } from './confirm-doc.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHECK_LOOP = path.join(SCRIPT_DIR, 'check-loop.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

// mkfix：空 fixture 根（四目录 + 枚举单源内联 8 键——fixture 自包含，测消费逻辑而非当前词表值）
const ENUMS_FIXTURE = [
  'doc.status.all=draft approved done superseded cancelled',
  'doc.status.confirmed=approved done superseded cancelled',
  'doc.status.active=draft approved',
  'doc.status.terminal=done superseded cancelled',
  'doc.status.abandoned=superseded cancelled',
  'incident.status.all=open fixed closed',
  'incident.status.active=open',
  'level.all=L0 L1 L2 L3',
].join('\n') + '\n';

const mkfix = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'check-loop-test-'));
  for (const s of ['intents', 'specs', 'plans', 'incidents']) {
    fs.mkdirSync(path.join(d, 'workflow', s), { recursive: true });
  }
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(d, '.agents', 'workflow-enums.txt'), ENUMS_FIXTURE);
  return d;
};
const w = (root, rel, content) => fs.writeFileSync(path.join(root, rel), content);

const INTENT = (name, fm, body = '') => `---\n${fm}\n---\n# INTENT — ${name}\n${body}`;
const PLAN = (name, fm, body = '') => `---\n${fm}\n---\n# PLAN — ${name}\n${body}`;
const SPEC = (name, fm, body = '') => `---\n${fm}\n---\n# SPEC — ${name}\n${body}`;
const 三件套 = (refs) => `## 复盘三件套（缺一不可）

1. 结构性修复
 - 修复 commit:abc1234
 - 影响环境:dev
 - 是否需要新 intent:
${refs ? '     - 是 → ../intents/2026-09-12-ghost.md\n' : ' - 否 → 理由:实现 bug 单点修复\n'}
2. 防复发验证
 - 回归清单条目在案

3. 规范条目
 - AGENTS.md 某节
`;

// run：默认 CHECK_LOOP_ROOT 注入（fixture 模式）；{git:true} 时 cwd 注入（真 git 模式，测 tracked 过滤）
const run = (root, opts = {}) => spawnSync(process.execPath, [CHECK_LOOP], {
  ...(opts.git ? { cwd: root } : { cwd: ROOT_CWD, env: { ...process.env, CHECK_LOOP_ROOT: root } }),
  encoding: 'utf8',
});
const ROOT_CWD = process.cwd();
const outOf = (r) => `${r.stdout || ''}${r.stderr || ''}`;
const expectHard = (desc, root, kw) => {
  const r = run(root);
  check(desc, r.status === 1 && outOf(r).includes(kw), `exit=${r.status}\n${outOf(r)}`);
};
const expectOk = (desc, root) => {
  const r = run(root);
  check(desc, r.status === 0, `exit=${r.status}\n${outOf(r)}`);
};
const gitInit = (root) => {
  spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', ['init', '-q'], { cwd: root });
};
const gitCommitAll = (root, msg) => {
  const G = process.platform === 'win32' ? 'git.exe' : 'git';
  spawnSync(G, ['add', '-A'], { cwd: root });
  spawnSync(G, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', msg], { cwd: root });
};
const rmfix = (root) => fs.rmSync(root, { recursive: true, force: true });
// writeLedger：fixture 台账辅助（检查 15 配对用；行 schema 同 confirm-doc.mjs appendLedger）
const writeLedger = (root, entries) => {
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'confirmations.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
};
// mkConfirmedDoc：落一份「带真实指纹 + 台账配对」的文档（复刻 confirm-doc 落态形态）
const mkConfirmedDoc = (root, rel, fmBody) => {
  const noFp = `---\n${fmBody}\n---\n# DOC\n`;
  const fp = computeFingerprint(noFp);
  fs.writeFileSync(path.join(root, rel), `---\n${fmBody}\n确认指纹: ${fp.slice(0, 16)}\n---\n# DOC\n`);
  return { rel: rel.replace(/\\/g, '/'), fp };
};

// ---- 场景 1:全合法闭环（intent+plan,L1,done 全勾验带证据）→ exit 0 ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-ok.md', INTENT('ok', '状态: done\n级别: L1\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 用例通过（证据:dotnet test 全绿）\n'));
  w(T, 'workflow/plans/2026-09-12-ok.md', PLAN('ok', '状态: done\n级别: L1'));
  expectOk('全合法闭环(L1 done 勾验带证据) → exit 0', T);
  rmfix(T);
}

// ---- 场景 2:intent 缺 plan → hard ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-a.md', INTENT('a', '状态: approved\n级别: L1\n日期: 2026-09-12'));
  expectHard('intent 缺 plan → hard 配对断裂', T, '配对断裂');
  rmfix(T);
}

// ---- 场景 3:L2 intent 缺 spec → hard ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-b.md', INTENT('b', '状态: approved\n级别: L2\n日期: 2026-09-12'));
  w(T, 'workflow/plans/2026-09-12-b.md', PLAN('b', '状态: approved\n级别: L2'));
  expectHard('L2 intent 缺 spec → hard 配对断裂', T, 'intent 缺 spec');
  rmfix(T);
}

// ---- 场景 4:L3 spec 缺确认三件 → hard ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-c.md', INTENT('c', '状态: approved\n级别: L3\n日期: 2026-09-12'));
  w(T, 'workflow/specs/2026-09-12-c.md', SPEC('c', '状态: approved\n级别: L3', '\n## 确认与复核\n'));
  w(T, 'workflow/plans/2026-09-12-c.md', PLAN('c', '状态: approved\n级别: L3'));
  expectHard('L3 spec 缺确认三件 → hard', T, 'L3 确认缺失');
  rmfix(T);
}

// ---- 场景 5:L3 spec 确认三件齐全 → exit 0 ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-d.md', INTENT('d', '状态: approved\n级别: L3\n日期: 2026-09-12'));
  w(T, 'workflow/specs/2026-09-12-d.md', SPEC('d', '状态: approved\n级别: L3\n确认结果: approved\n确认时间: 2026-09-12', '\n## 确认与复核\n- 独立复核：已由 independent-reviewer 新会话完成,结论 approved\n'));
  w(T, 'workflow/plans/2026-09-12-d.md', PLAN('d', '状态: approved\n级别: L3'));
  expectOk('L3 确认三件齐全(frontmatter 2 件+正文独立复核) → exit 0', T);
  rmfix(T);
}

// ---- 场景 6:新建 done intent 验收未勾验 → hard;带附注不影响判定（papercut #4 回归）----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-13-e.md', INTENT('e', '状态: done\n级别: L1\n日期: 2026-09-13\n备注: 回溯补档,原工作 2026-09-12 完成', '\n## 验收标准（可测试）\n- [ ] 用例通过\n'));
  w(T, 'workflow/plans/2026-09-13-e.md', PLAN('e', '状态: done\n级别: L1'));
  expectHard('新建 done 未勾验(附注在备注键) → hard 验收未对账', T, '验收未对账');
  rmfix(T);
}

// ---- 场景 7:存量(<2026-09-12) done 未勾验 → warning,exit 0 ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-01-f.md', INTENT('f', '状态: done\n级别: L1\n日期: 2026-09-01', '\n## 验收标准（可测试）\n- [ ] 用例通过\n'));
  w(T, 'workflow/plans/2026-09-01-f.md', PLAN('f', '状态: done\n级别: L1'));
  expectOk('存量 done 未勾验 → warning 不阻断', T);
  rmfix(T);
}

// ---- 场景 8:incident 选「是」但 intent 不存在 → hard 回路断档 ----
{
  const T = mkfix();
  w(T, 'workflow/incidents/2026-09-12-g.md', `---\n状态: fixed\n级别: L2\n发现: 2026-09-12\n---\n# INCIDENT — g\n\n${三件套(true)}`);
  w(T, 'workflow/plans/2026-09-12-g.md', PLAN('g', '状态: done\n级别: L2'));
  w(T, 'workflow/specs/2026-09-12-g.md', SPEC('g', '状态: approved\n级别: L2'));
  expectHard('incident 回路引用不存在 intent → hard 回路断档', T, '回路断档');
  rmfix(T);
}

// ---- 场景 9:incident 流程 legacy → 豁免级别/配对检查,exit 0 ----
{
  const T = mkfix();
  w(T, 'workflow/incidents/2026-08-27-h.md', `---\n状态: closed\n流程: legacy\n发现: 2026-08-27\n---\n# INCIDENT — h（legacy 回填,无级别无配对）\n\n${三件套(false)}`);
  expectOk('incident legacy 豁免配对 → exit 0', T);
  rmfix(T);
}

// ---- 场景 10:无 frontmatter → 状态键缺失 warning,exit 0（非 L3） ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-i.md', '# INTENT — i（未迁移旧格式）\n\n状态：draft\n');
  w(T, 'workflow/plans/2026-09-12-i.md', PLAN('i', '状态: approved\n级别: L1'));
  const r = run(T);
  check('无 frontmatter → warning 提示状态键缺失', r.status === 0 && /WARN 状态未确认.*i\.md/.test(outOf(r)), outOf(r));
  rmfix(T);
}

// ---- 场景 11:frontmatter 状态值域外（自造值）→ warning 带当前值,exit 0 ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-j.md', INTENT('j', '状态: 进行中\n级别: L1\n日期: 2026-09-12'));
  w(T, 'workflow/plans/2026-09-12-j.md', PLAN('j', '状态: approved\n级别: L1'));
  const r = run(T);
  check('状态值域外 → warning 且带当前值提示', r.status === 0 && /WARN 状态未确认.*j\.md.*进行中/.test(outOf(r)), outOf(r));
  rmfix(T);
}

// ---- 场景 12:无 frontmatter 的旧格式 L3 声明 → warning 引导补 frontmatter（不回退读正文,双源防回归）----
{
  const T = mkfix();
  for (const s of ['intents', 'plans', 'specs']) {
    w(T, `workflow/${s}/2026-09-12-k.md`, `# ${s.toUpperCase().slice(0, -1)} — k\n\n级别：L3\n状态：approved\n`);
  }
  const r = run(T);
  check('无 frontmatter 旧格式 → warning 引导补 frontmatter(不回退读正文)',
    r.status === 0 && /WARN 状态未确认.*k\.md（frontmatter 状态键当前值:『缺失』）/.test(outOf(r)), outOf(r));
  rmfix(T);
}

// ---- 场景 13:git fixture——L1 intent 与迁移 SQL 同 commit → warning 疑似判低（检查 10）----
{
  const T = mkfix();
  gitInit(T);
  w(T, 'workflow/intents/2026-09-12-m.md', INTENT('m', '状态: done\n级别: L1\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 场景构造项（证据:fixture）\n'));
  w(T, 'workflow/plans/2026-09-12-m.md', PLAN('m', '状态: done\n级别: L1'));
  fs.mkdirSync(path.join(T, 'docs', 'scripts'), { recursive: true });
  w(T, 'docs/scripts/01-add-table.sql', 'CREATE TABLE t(id INT);\n');
  gitCommitAll(T, 'test');
  const r = run(T);
  check('L1 入口文档提交触及迁移 SQL → warning 疑似判低', r.status === 0 && /WARN 级别疑似判低.*m\.md/.test(outOf(r)), outOf(r));
  rmfix(T);
}

// ---- 场景 14:git fixture——L3 intent 与迁移 SQL 同 commit → 级别一致不告警 ----
{
  const T = mkfix();
  gitInit(T);
  w(T, 'workflow/intents/2026-09-12-n.md', INTENT('n', '状态: done\n级别: L3\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 场景构造项（证据:fixture）\n'));
  w(T, 'workflow/specs/2026-09-12-n.md', SPEC('n', '状态: done\n级别: L3\n确认结果: approved\n确认时间: 2026-09-12', '\n## 确认与复核\n- 独立复核：已由 independent-reviewer 新会话完成,结论 approved\n'));
  w(T, 'workflow/plans/2026-09-12-n.md', PLAN('n', '状态: done\n级别: L3'));
  fs.mkdirSync(path.join(T, 'docs', 'scripts'), { recursive: true });
  w(T, 'docs/scripts/01-add-table.sql', 'CREATE TABLE t(id INT);\n');
  gitCommitAll(T, 'test');
  const r = run(T);
  check('L3 入口文档提交触及迁移 SQL → 级别一致不告警', r.status === 0 && !outOf(r).includes('级别疑似判低'), outOf(r));
  rmfix(T);
}

// ---- 场景 15:ZCode Adapter 缺失不告警(本地配置不入 git),存在且断线仍告警 ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-o.md', INTENT('o', '状态: done\n级别: L1\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 用例通过（证据:全绿）\n'));
  w(T, 'workflow/plans/2026-09-12-o.md', PLAN('o', '状态: done\n级别: L1'));
  fs.mkdirSync(path.join(T, '.agents', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(T, '.zcode', 'agents'), { recursive: true });
  for (const r of ['implementer', 'independent-reviewer', 'ui-verifier']) w(T, `.agents/roles/${r}.md`, `# role ${r}\n`);
  w(T, '.zcode/agents/implementer.md', '---\nname: implementer\n---\n断线内容,无角色引用\n');
  const r = run(T);
  check('ZCode 缺失跳过/存在断线仍告警',
    r.status === 0 && outOf(r).includes('ZCode implementer 未引用公共角色') && !outOf(r).includes('ZCode 缺'), outOf(r));
  rmfix(T);
}

// ---- 场景 16:skills 引用仓库内与用户级均不存在 → 仍报引用断档 ----
{
  const T = mkfix();
  w(T, 'workflow/README.md', '# WF README\n\n技能见 .agents/skills/fake-skill（仓库内与用户级均不存在）\n');
  w(T, 'workflow/intents/2026-09-12-p.md', INTENT('p', '状态: done\n级别: L1\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 用例通过（证据:全绿）\n'));
  w(T, 'workflow/plans/2026-09-12-p.md', PLAN('p', '状态: done\n级别: L1'));
  const r = run(T);
  check('skills 引用仓库内与用户级均无 → 仍报引用断档', r.status === 0 && /引用断档.*fake-skill/.test(outOf(r)), outOf(r));
  rmfix(T);
}

// ---- 场景 17:存量 done 含「存量对账豁免」声明 → 出账,无验收对账 warning ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-01-q.md', INTENT('q', '状态: done\n级别: L1\n日期: 2026-09-01', '\n## 验收标准（可测试）\n> **存量对账豁免（2026-09-12，用户拍板不追溯）**：下方未勾项均为第二轮 UI/浏览器实测项。\n- [ ] 用例通过\n'));
  w(T, 'workflow/plans/2026-09-01-q.md', PLAN('q', '状态: done\n级别: L1'));
  const r = run(T);
  check('存量含豁免声明 → 出账不计未对账', r.status === 0 && !outOf(r).includes('验收对账存量'), outOf(r));
  rmfix(T);
}

// ---- 场景 18:新建 done intent 缺「## 验收标准」节 → hard（2026-09-16 补口回归）----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-13-r.md', INTENT('r', '状态: done\n级别: L1\n日期: 2026-09-13', '\n## 目标\n关单前未写验收标准节。\n'));
  w(T, 'workflow/plans/2026-09-13-r.md', PLAN('r', '状态: done\n级别: L1'));
  expectHard('新建 done 缺验收标准节 → hard 验收未对账', T, '缺「## 验收标准」节');
  rmfix(T);
}

// ---- 场景 19:新建 done 勾选项缩进写法 → hard（口径放宽后仍拦）----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-13-s.md', INTENT('s', '状态: done\n级别: L1\n日期: 2026-09-13', '\n## 验收标准（可测试）\n  - [ ] 缩进未勾项（此前后静默通过）\n'));
  w(T, 'workflow/plans/2026-09-13-s.md', PLAN('s', '状态: done\n级别: L1'));
  expectHard('新建 done 勾选项缩进 → hard 验收未对账', T, '验收未对账');
  rmfix(T);
}

// ---- 场景 20:incident 状态值域外 → warning 带当前值 ----
{
  const T = mkfix();
  w(T, 'workflow/incidents/2026-09-13-t.md', `---\n状态: 已修复\n级别: L1\n发现: 2026-09-13\n---\n# INCIDENT — t\n\n${三件套(false)}`);
  w(T, 'workflow/plans/2026-09-13-t.md', PLAN('t', '状态: done\n级别: L1'));
  const r = run(T);
  check('incident 状态值域外 → warning 且带当前值', r.status === 0 && /WARN 状态非法.*t\.md.*已修复/.test(outOf(r)), outOf(r));
  rmfix(T);
}

// ---- 场景 21:incident 缺级别 → warning 明示配对检查已跳过 ----
{
  const T = mkfix();
  w(T, 'workflow/incidents/2026-09-13-u.md', `---\n状态: open\n发现: 2026-09-13\n---\n# INCIDENT — u\n\n${三件套(false)}`);
  const r = run(T);
  check('incident 缺级别 → warning 明示配对已跳过', r.status === 0 && /WARN 级别缺失.*u\.md.*配对检查已跳过/.test(outOf(r)), outOf(r));
  rmfix(T);
}

// ---- 场景 22:存量 done 缺验收标准节 → 聚合 warning 不 hard ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-01-v.md', INTENT('v', '状态: done\n级别: L1\n日期: 2026-09-01', '\n## 目标\n存量旧格式,缺验收标准节。\n'));
  w(T, 'workflow/plans/2026-09-01-v.md', PLAN('v', '状态: done\n级别: L1'));
  const r = run(T);
  check('存量 done 缺节 → 聚合 warning 不 hard', r.status === 0 && outOf(r).includes('验收对账存量'), outOf(r));
  rmfix(T);
}

// ---- 场景 23/24:git 仓库模式——未跟踪并行半成品不拦 push;提交进 HEAD 后仍 hard ----
{
  const T = mkfix();
  gitInit(T);
  w(T, 'workflow/intents/2026-09-12-ok2.md', INTENT('ok2', '状态: done\n级别: L1\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 场景构造项（证据:fixture）\n'));
  w(T, 'workflow/plans/2026-09-12-ok2.md', PLAN('ok2', '状态: done\n级别: L1'));
  gitCommitAll(T, 'base');
  w(T, 'workflow/intents/2026-09-18-parallel-wip.md', INTENT('并行会话半成品', '状态: draft\n级别: L1\n日期: 2026-09-18'));
  let r = run(T, { git: true });
  check('仓库模式:未跟踪 draft intent(无 plan)不进扫描,不拦 push', r.status === 0 && !outOf(r).includes('parallel-wip'), `exit=${r.status}\n${outOf(r)}`);
  gitCommitAll(T, 'wip');
  r = run(T, { git: true });
  check('仓库模式:已提交的入口缺 plan 断档仍 hard-block', r.status === 1 && /缺 plan.*parallel-wip/.test(outOf(r)), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}

// ---- 场景 25:检索层——模块合法 + INDEX 一致 → exit 0 无新告警（拷真实生成器+读取器+词表测接线）----
{
  const T = mkfix();
  fs.mkdirSync(path.join(T, '.agents', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPT_DIR, 'gen-workflow-index.mjs'), path.join(T, '.agents', 'scripts', 'gen-workflow-index.mjs'));
  fs.copyFileSync(path.join(SCRIPT_DIR, 'workflow-enums.mjs'), path.join(T, '.agents', 'scripts', 'workflow-enums.mjs'));
  fs.copyFileSync(path.join(SCRIPT_DIR, '..', 'workflow-modules.txt'), path.join(T, '.agents', 'workflow-modules.txt'));
  w(T, 'workflow/intents/2026-09-22-mod-ok.md', INTENT('mod ok', '状态: approved\n级别: L1\n日期: 2026-09-22\n模块: pipeline', '\n## 验收标准（可测试）\n- [ ] 用例通过\n'));
  w(T, 'workflow/plans/2026-09-22-mod-ok.md', PLAN('mod ok', '状态: approved\n级别: L1\n模块: pipeline'));
  spawnSync(process.execPath, ['.agents/scripts/gen-workflow-index.mjs'], { cwd: T });
  const r = run(T);
  check('检索层:模块合法+INDEX 一致 → exit 0 无新告警',
    r.status === 0 && !outOf(r).includes('WARN 模块元数据') && !outOf(r).includes('WARN 索引漂移'), outOf(r));
  rmfix(T);
}

// ---- 场景 26:模块枚举非法 + 2026-09-22 起新建缺字段 → WARN 不阻断 ----
{
  const T = mkfix();
  fs.copyFileSync(path.join(SCRIPT_DIR, '..', 'workflow-modules.txt'), path.join(T, '.agents', 'workflow-modules.txt'));
  w(T, 'workflow/intents/2026-09-22-mod-bad.md', INTENT('mod bad', '状态: approved\n级别: L1\n日期: 2026-09-22\n模块: 不存在的模块'));
  w(T, 'workflow/plans/2026-09-22-mod-bad.md', PLAN('mod bad', '状态: approved\n级别: L1'));
  const r = run(T);
  const o = outOf(r);
  check('检索层:模块非法/缺字段 → WARN 且 exit 0',
    r.status === 0 && o.includes('WARN 模块元数据') && o.includes('不在词表') && o.includes('缺「模块:」字段'), o);
  rmfix(T);
}

// ---- 场景 27:INDEX 漂移 → WARN 索引漂移,exit 0（调生成器 --check 口径）----
{
  const T = mkfix();
  fs.mkdirSync(path.join(T, '.agents', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPT_DIR, 'gen-workflow-index.mjs'), path.join(T, '.agents', 'scripts', 'gen-workflow-index.mjs'));
  fs.copyFileSync(path.join(SCRIPT_DIR, 'workflow-enums.mjs'), path.join(T, '.agents', 'scripts', 'workflow-enums.mjs'));
  fs.copyFileSync(path.join(SCRIPT_DIR, '..', 'workflow-modules.txt'), path.join(T, '.agents', 'workflow-modules.txt'));
  w(T, 'workflow/intents/2026-09-22-drift.md', INTENT('drift', '状态: approved\n级别: L1\n日期: 2026-09-22\n模块: pipeline'));
  w(T, 'workflow/plans/2026-09-22-drift.md', PLAN('drift', '状态: approved\n级别: L1\n模块: pipeline'));
  spawnSync(process.execPath, ['.agents/scripts/gen-workflow-index.mjs'], { cwd: T });
  w(T, 'workflow/plans/2026-09-22-drift.md', PLAN('drift', '状态: done\n级别: L1\n模块: pipeline')); // 生成后改状态 → 漂移
  const r = run(T);
  check('检索层:INDEX 漂移 → WARN 且 exit 0', r.status === 0 && outOf(r).includes('WARN 索引漂移'), outOf(r));
  rmfix(T);
}

// ---- 场景 28/29:常驻面预算——合规无告警;AGENTS.md 超限 → WARN 含一进一出 ----
{
  const T = mkfix();
  fs.mkdirSync(path.join(T, '.agents', 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(SCRIPT_DIR, 'rule-budget.sh'), path.join(T, '.agents', 'scripts', 'rule-budget.sh'));
  fs.copyFileSync(path.join(SCRIPT_DIR, '..', 'rule-budgets.txt'), path.join(T, '.agents', 'rule-budgets.txt'));
  w(T, 'AGENTS.md', '# AGENTS 小体积 fixture\n');
  fs.mkdirSync(path.join(T, '.agents', 'commands'), { recursive: true });
  w(T, '.agents/commands/plan.md', '# 小命令\n');
  w(T, 'workflow/intents/2026-09-22-budget-ok.md', INTENT('budget ok', '状态: approved\n级别: L1\n日期: 2026-09-22\n模块: pipeline'));
  w(T, 'workflow/plans/2026-09-22-budget-ok.md', PLAN('budget ok', '状态: approved\n级别: L1\n模块: pipeline'));
  let r = run(T);
  check('常驻面预算:合规 → 无超限告警且 exit 0', r.status === 0 && !outOf(r).includes('WARN 常驻面超限'), outOf(r));
  w(T, 'AGENTS.md', 'x'.repeat(8000));
  w(T, 'workflow/intents/2026-09-22-budget-bad.md', INTENT('budget bad', '状态: approved\n级别: L1\n日期: 2026-09-22\n模块: pipeline'));
  w(T, 'workflow/plans/2026-09-22-budget-bad.md', PLAN('budget bad', '状态: approved\n级别: L1\n模块: pipeline'));
  r = run(T);
  const o = outOf(r);
  check('常驻面预算:超限 → WARN(含一进一出提示) 且 exit 0', r.status === 0 && o.includes('WARN 常驻面超限') && o.includes('一进一出'), o);
  rmfix(T);
}

// ---- 场景 30:rule-budget --staged 硬拦路径（rule-budget.sh 仍为 sh——无 sh 环境打印 SKIP）----
{
  const probe = spawnSync('sh', ['-c', 'true']);
  if (probe.error) {
    console.log('SKIP  rule-budget --staged 两场景（环境无 sh——rule-budget.sh 属 git 钩子 sh 环境面）');
  } else {
    const T = mkfix();
    fs.mkdirSync(path.join(T, '.agents', 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(SCRIPT_DIR, 'rule-budget.sh'), path.join(T, '.agents', 'scripts', 'rule-budget.sh'));
    fs.copyFileSync(path.join(SCRIPT_DIR, '..', 'rule-budgets.txt'), path.join(T, '.agents', 'rule-budgets.txt'));
    gitInit(T);
    w(T, 'AGENTS.md', 'x'.repeat(8000));
    spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', ['add', 'AGENTS.md'], { cwd: T });
    let r = spawnSync('sh', ['.agents/scripts/rule-budget.sh', '--staged'], { cwd: T, encoding: 'utf8' });
    check('rule-budget --staged:暂存超限 → exit 1（硬拦路径）',
      r.status === 1 && `${r.stdout}${r.stderr}`.includes('常驻面超限：AGENTS.md'), `${r.stdout}${r.stderr}`);
    w(T, 'AGENTS.md', '# 小体积\n');
    spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', ['add', 'AGENTS.md'], { cwd: T });
    r = spawnSync('sh', ['.agents/scripts/rule-budget.sh', '--staged'], { cwd: T, encoding: 'utf8' });
    check('rule-budget --staged:合规 → exit 0（不误拦）', r.status === 0, `${r.stdout}${r.stderr}`);
    rmfix(T);
  }
}

// ---- 场景 31/32/33:确认态留痕（检查 14）——无 approved 历史 WARN;先 approved 后 done 无 WARN;非 git 跳过 ----
{
  const T = mkfix();
  gitInit(T);
  w(T, 'workflow/incidents/2026-09-23-confirm-gate.md', `---\n状态: closed\n级别: L1\n发现: 2026-09-23\n模块: material\n---\n# INCIDENT — confirm gate\n\n${三件套(false)}`);
  w(T, 'workflow/plans/2026-09-23-confirm-gate.md', PLAN('confirm gate', '状态: done\n级别: L1\n模块: material'));
  gitCommitAll(T, 'test');
  let r = run(T);
  check('新 done 无 approved 历史 → WARN 确认态缺失 且 exit 0',
    r.status === 0 && /WARN 确认态缺失.*2026-09-23-confirm-gate\.md/.test(outOf(r)), outOf(r));
  rmfix(T);
}
{
  const T = mkfix();
  gitInit(T);
  w(T, 'workflow/incidents/2026-09-23-confirm-ok.md', `---\n状态: closed\n级别: L1\n发现: 2026-09-23\n模块: material\n---\n# INCIDENT — confirm ok\n\n${三件套(false)}`);
  w(T, 'workflow/plans/2026-09-23-confirm-ok.md', PLAN('confirm ok', '状态: approved\n级别: L1\n模块: material'));
  gitCommitAll(T, 'approved');
  w(T, 'workflow/plans/2026-09-23-confirm-ok.md', PLAN('confirm ok', '状态: done\n级别: L1\n模块: material'));
  gitCommitAll(T, 'done');
  const r = run(T);
  check('approved → done 留痕 → 无确认态缺失告警', r.status === 0 && !outOf(r).includes('WARN 确认态缺失'), outOf(r));
  rmfix(T);
}
{
  const T = mkfix();
  w(T, 'workflow/incidents/2026-09-23-confirm-nogit.md', `---\n状态: closed\n级别: L1\n发现: 2026-09-23\n模块: material\n---\n# INCIDENT — confirm nogit\n\n${三件套(false)}`);
  w(T, 'workflow/plans/2026-09-23-confirm-nogit.md', PLAN('confirm nogit', '状态: done\n级别: L1\n模块: material'));
  const r = run(T);
  check('非 git fixture → 检查项 14 跳过,不误报', r.status === 0 && !outOf(r).includes('WARN 确认态缺失'), outOf(r));
  rmfix(T);
}

// ---- 场景 34/35/36:枚举单源——缺文件 fail-loud;缺键 fail-loud;CRLF 容忍 ----
{
  const T = mkfix();
  fs.rmSync(path.join(T, '.agents', 'workflow-enums.txt'));
  w(T, 'workflow/intents/2026-09-12-ok.md', INTENT('ok', '状态: done\n级别: L1\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 用例通过（证据:全绿）\n'));
  expectHard('枚举单源文件缺失 → exit 1 fail-loud(不静默退化)', T, '枚举单源');
  rmfix(T);
}
{
  const T = mkfix();
  const f = path.join(T, '.agents', 'workflow-enums.txt');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^doc\.status\.confirmed=.*\n/m, ''));
  expectHard('枚举单源缺键 → exit 1 fail-loud', T, '缺键');
  rmfix(T);
}
{
  const T = mkfix();
  fs.writeFileSync(path.join(T, '.agents', 'workflow-enums.txt'), ENUMS_FIXTURE.replace(/\n/g, '\r\n'));
  w(T, 'workflow/intents/2026-09-12-ok.md', INTENT('ok', '状态: approved\n级别: L1\n日期: 2026-09-12'));
  w(T, 'workflow/plans/2026-09-12-ok.md', PLAN('ok', '状态: approved\n级别: L1'));
  const r = run(T);
  check('枚举单源 CRLF 行尾 → approved/done 判定不受 \\r 影响', r.status === 0 && !outOf(r).includes('状态未确认'), outOf(r));
  rmfix(T);
}

// ---- 场景 37/38/39/40:检查 15 确认指纹对账——无指纹拦 / 配对齐过 / 指纹不符拦 / 生效日前豁免 ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-27-cg.md', INTENT('cg', '状态: approved\n级别: L1\n日期: 2026-09-27'));
  w(T, 'workflow/plans/2026-09-27-cg.md', PLAN('cg', '状态: draft\n级别: L1'));
  expectHard('检查15:生效日起新档 approved 无指纹无台账 → hard 确认未对账', T, '确认未对账');
  rmfix(T);
}
{
  const T = mkfix();
  const i1 = mkConfirmedDoc(T, 'workflow/intents/2026-09-27-ok15.md', '状态: approved\n级别: L1\n日期: 2026-09-27');
  const p1 = mkConfirmedDoc(T, 'workflow/plans/2026-09-27-ok15.md', '状态: approved\n级别: L1');
  writeLedger(T, [
    { ts: 'T', doc: i1.rel, stage: 'approved', fingerprint: i1.fp, prev: 'draft' },
    { ts: 'T', doc: p1.rel, stage: 'approved', fingerprint: p1.fp, prev: 'draft' },
  ]);
  expectOk('检查15:指纹+台账配对齐 → exit 0', T);
  rmfix(T);
}
{
  const T = mkfix();
  const i1 = mkConfirmedDoc(T, 'workflow/intents/2026-09-27-bad15.md', '状态: approved\n级别: L1\n日期: 2026-09-27');
  w(T, 'workflow/plans/2026-09-27-bad15.md', PLAN('bad15', '状态: draft\n级别: L1'));
  writeLedger(T, [{ ts: 'T', doc: i1.rel, stage: 'approved', fingerprint: 'e'.repeat(64), prev: 'draft' }]); // 指纹不符
  expectHard('检查15:指纹与台账不配对 → hard 确认未对账', T, '确认未对账');
  rmfix(T);
}
{
  const T = mkfix();
  // 豁免理由（2026-09-28 锚改台账 ts 后）：**台账无行** ⇒ 存量未受管，与文档自报日期无关。
  // 本场景构造的正是「日期早 + 无台账」——换锚前后结论一致，但理由已从「日期早于生效日」变为「无台账行」。
  w(T, 'workflow/intents/2026-09-26-old15.md', INTENT('old15', '状态: approved\n级别: L1\n日期: 2026-09-26'));
  w(T, 'workflow/plans/2026-09-26-old15.md', PLAN('old15', '状态: draft\n级别: L1'));
  expectOk('检查15:存量 approved 无台账行 → 豁免 exit 0', T);
  rmfix(T);
}

// ---- 场景 40:检查 8——证据写在 [x] 续行（仓库通写法「（证据：…）」另起一行）→ 不报缺证据 ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-ev1.md', INTENT('ev1', '状态: done\n级别: L1\n日期: 2026-09-12',
    '\n## 验收标准（可测试）\n- [x] 用例通过\n（证据：commit fixture；套件全绿）\n- [x] 文档补齐\n（证据：AGENTS.md 第 1 行）\n'));
  w(T, 'workflow/plans/2026-09-12-ev1.md', PLAN('ev1', '状态: done\n级别: L1'));
  const r = run(T);
  check('证据在续行（全角冒号）→ 不报验收缺证据',
    r.status === 0 && !outOf(r).includes('验收缺证据'), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}
// ---- 场景 41:检查 8——[x] 无证据且续行也无 → 报验收缺证据（回归：不可把豁免放大成漏检）----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-ev2.md', INTENT('ev2', '状态: done\n级别: L1\n日期: 2026-09-12',
    '\n## 验收标准（可测试）\n- [x] 用例通过\n- [x] 文档补齐\n（说明：无证据行）\n'));
  w(T, 'workflow/plans/2026-09-12-ev2.md', PLAN('ev2', '状态: done\n级别: L1'));
  const r = run(T);
  check('[x] 续行仍无证据 → 报验收缺证据',
    r.status === 0 && outOf(r).includes('验收缺证据'), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}
// ---- 场景 42:检查 4——fill-{intent,spec,plan}.mjs 花括号展开，三路皆存在 → 不报引用断档 ----
{
  const T = mkfix();
  w(T, 'AGENTS.md', '# AGENTS\n\n起草先跑 `node .agents/scripts/fill-{intent,spec,plan}.mjs` 拿结构化草稿。\n');
  fs.mkdirSync(path.join(T, '.agents', 'scripts'), { recursive: true });
  for (const n of ['fill-intent', 'fill-spec', 'fill-plan']) w(T, `.agents/scripts/${n}.mjs`, '// stub\n');
  w(T, 'workflow/intents/2026-09-12-br1.md', INTENT('br1', '状态: done\n级别: L1\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 用例通过（证据:fixture）\n'));
  w(T, 'workflow/plans/2026-09-12-br1.md', PLAN('br1', '状态: done\n级别: L1'));
  const r = run(T);
  check('花括号展开三路存在 → 不报引用断档',
    r.status === 0 && !outOf(r).includes('引用断档'), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}
// ---- 场景 43:检查 4——花括号展开三路皆不存在 → 仍报引用断档（带完整展开式文案）----
{
  const T = mkfix();
  w(T, 'AGENTS.md', '# AGENTS\n\n起草先跑 `node .agents/scripts/fill-{alpha,beta,gamma}.mjs` 拿结构化草稿。\n');
  w(T, 'workflow/intents/2026-09-12-br2.md', INTENT('br2', '状态: done\n级别: L1\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 用例通过（证据:fixture）\n'));
  w(T, 'workflow/plans/2026-09-12-br2.md', PLAN('br2', '状态: done\n级别: L1'));
  const r = run(T);
  check('花括号展开三路皆无 → 仍报引用断档',
    r.status === 0 && /引用断档.*fill-\{alpha,beta,gamma\}\.mjs/.test(outOf(r)), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}
// ---- 场景 44:检查 2——<主题> 与 .md 同行 = 命名约定描述 → 不报模板未填 ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-01-nm1.md', INTENT('nm1', '状态: done\n级别: L1\n日期: 2026-09-01',
    '\n编排脚本（`.agents/workflows/<主题>.md`）：frontmatter + stages 表。\n复制本模板为 YYYY-MM-DD-<主题>.md 后填写。\n'));
  w(T, 'workflow/plans/2026-09-01-nm1.md', PLAN('nm1', '状态: done\n级别: L1'));
  const r = run(T);
  check('<主题>+.md 命名约定行 → 不报模板未填',
    r.status === 0 && !outOf(r).includes('模板未填'), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}
// ---- 场景 45:检查 2——真未填占位（标题 <主题>，无 .md）→ 仍报模板未填 ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-01-nm2.md', INTENT('<主题>', '状态: done\n级别: L1\n日期: 2026-09-01', '\n正文无占位。\n'));
  w(T, 'workflow/plans/2026-09-01-nm2.md', PLAN('nm2', '状态: done\n级别: L1'));
  const r = run(T);
  check('标题 <主题>（无 .md）→ 仍报模板未填',
    r.status === 0 && outOf(r).includes('模板未填'), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}
// ---- 场景 46:检查 6——薄适配正文含 .agents/roles/<role>.md 引用 → 不报 Adapter 断线 ----
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-12-ad1.md', INTENT('ad1', '状态: done\n级别: L1\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 用例通过（证据:fixture）\n'));
  w(T, 'workflow/plans/2026-09-12-ad1.md', PLAN('ad1', '状态: done\n级别: L1'));
  fs.mkdirSync(path.join(T, '.agents', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(T, '.zcode', 'agents'), { recursive: true });
  w(T, '.agents/roles/implementer.md', '# role implementer\n');
  w(T, '.zcode/agents/implementer.md', '---\nname: implementer\n---\n> 契约见 `.agents/roles/implementer.md`。\n');
  const r = run(T);
  check('薄适配含角色引用 → 不报 Adapter 断线',
    r.status === 0 && !outOf(r).includes('Adapter 断线'), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}
// ---- 场景 47:检查 4——fill-*.mjs 星号通配，目录内有匹配文件 → 不报引用断档；无匹配 → 仍报 ----
{
  const T = mkfix();
  w(T, 'AGENTS.md', '# AGENTS\n\n起草先跑 `node .agents/scripts/fill-*.mjs`；孤儿引用 `.agents/scripts/ghost-*.mjs`。\n');
  fs.mkdirSync(path.join(T, '.agents', 'scripts'), { recursive: true });
  for (const n of ['fill-intent', 'fill-spec', 'fill-plan']) w(T, `.agents/scripts/${n}.mjs`, '// stub\n');
  w(T, 'workflow/intents/2026-09-12-gb1.md', INTENT('gb1', '状态: done\n级别: L1\n日期: 2026-09-12', '\n## 验收标准（可测试）\n- [x] 用例通过（证据:fixture）\n'));
  w(T, 'workflow/plans/2026-09-12-gb1.md', PLAN('gb1', '状态: done\n级别: L1'));
  const r = run(T);
  check('星号通配有匹配 → 不报；无匹配 → 仍报引用断档',
    r.status === 0 && !/引用断档.*fill-\*/.test(outOf(r)) && /引用断档.*ghost-\*\.mjs/.test(outOf(r)), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}
// ---- 场景 48:检查 15——委托代录台账行（source/quote 额外字段）照常配对放行（两形态口径，2026-09-27 confirm-gate-delegated）----
{
  const T = mkfix();
  const i1 = mkConfirmedDoc(T, 'workflow/intents/2026-09-27-del15.md', '状态: approved\n级别: L1\n日期: 2026-09-27');
  const p1 = mkConfirmedDoc(T, 'workflow/plans/2026-09-27-del15.md', '状态: approved\n级别: L1');
  writeLedger(T, [
    { ts: 'T', doc: i1.rel, stage: 'approved', fingerprint: i1.fp, prev: 'draft', source: 'chat-delegated', quote: '2选2' },
    { ts: 'T', doc: p1.rel, stage: 'approved', fingerprint: p1.fp, prev: 'draft', source: 'tty' },
  ]);
  expectOk('检查15:委托代录台账行（source+quote）照常配对 → exit 0', T);
  rmfix(T);
}

// ---- 场景 49-54:检查 15 done 内容绑定（2026-09-27 audit-gate-hardening；同日 p2-batch 改锚台账 ts + 保分隔符复原）----
//     done 形态复刻真实时序：approved 内容（含 approved 指纹）→ done 指纹在其上计算 → 落 done 文档 + 台账 done 行
//     opt.ts：台账 done 行 ts（默认 2026-09-28T02:00Z——生效锚后）；opt.sep：状态行键值分隔符（默认单空格，
//     '  ' 复刻两跳间手工改成双空格的非规范格式）
{
  const mkDoneFixture = (T, date, tamper, opt = {}) => {
    const sep = opt.sep || ' ';
    const ts = opt.ts || '2026-09-28T02:00:00.000Z';
    const body = `\n## 验收标准（可测试）\n- [x] 用例通过（证据:fixture）\n`;
    const pre = `---\n状态:${sep}approved\n级别: L1\n日期: ${date}\n确认指纹: ${'a'.repeat(16)}\n---\n# INTENT — bind\n${body}`;
    const fpDone = computeFingerprint(pre);
    // tamper 只污染 done 落盘文本（不进指纹底稿）——复刻「done 确认后篡改正文」
    const doneText = `---\n状态:${sep}done\n级别: L1\n日期: ${date}\n确认指纹: ${fpDone.slice(0, 16)}\n---\n# INTENT — bind\n${body}${tamper || ''}`;
    w(T, 'workflow/intents/' + date + '-bind.md', doneText);
    w(T, 'workflow/plans/' + date + '-bind.md', PLAN('bind', '状态: draft\n级别: L1'));
    return { rel: 'workflow/intents/' + date + '-bind.md', fp: fpDone, ts };
  };
  {
    const T = mkfix();
    const d1 = mkDoneFixture(T, '2026-09-28');
    writeLedger(T, [{ ts: d1.ts, doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'tty' }]);
    expectOk('检查15:done 内容与台账一致（复原重算=台账指纹）→ exit 0', T);
    rmfix(T);
  }
  {
    const T = mkfix();
    const d1 = mkDoneFixture(T, '2026-09-28', '确认后被篡改的正文行\n');
    writeLedger(T, [{ ts: d1.ts, doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'tty' }]);
    expectHard('检查15:done 后正文被篡改 → hard 确认内容漂移', T, '确认内容漂移');
    rmfix(T);
  }
  {
    const T = mkfix();
    // 生效锚 = 台账 ts：文档日期晚、但确认发生在锚前（旧关单顺序时代）→ 豁免绑定
    const d1 = mkDoneFixture(T, '2026-09-28', '锚前确认的文档即便日后改了也不绑\n', { ts: '2026-09-27T10:00:00.000Z' });
    writeLedger(T, [{ ts: d1.ts, doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'tty' }]);
    expectOk('检查15:台账 ts 早于生效锚（2026-09-28）→ 豁免内容绑定', T);
    rmfix(T);
  }
  {
    const T = mkfix();
    // 锚后确认 + 文档日期早（旧日期文档晚关单）+ 篡改 → 绑定照拦（p2-batch 改锚的核心收益）
    const d1 = mkDoneFixture(T, '2026-09-27', '确认后被篡改的正文行\n');
    writeLedger(T, [{ ts: d1.ts, doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'tty' }]);
    expectHard('检查15:文档日期早但台账 ts 锚后 + 篡改 → hard 确认内容漂移', T, '确认内容漂移');
    rmfix(T);
  }
  {
    const T = mkfix();
    const d1 = mkDoneFixture(T, '2026-09-28');
    writeLedger(T, [{ ts: d1.ts, doc: d1.rel, stage: 'done', fingerprint: d1.fp }]); // 无 prev（schema 演进前行）
    const r = run(T);
    check('检查15:台账 done 行缺 prev → 降级 WARN 绑定跳过（exit 0 不拦）',
      r.status === 0 && outOf(r).includes('绑定降级'), `exit=${r.status}\n${outOf(r)}`);
    rmfix(T);
  }
  {
    const T = mkfix();
    // 两跳间状态行被手工改成双空格（非规范分隔符）——保分隔符复原不误伤（p2-batch P2-1）
    const d1 = mkDoneFixture(T, '2026-09-28', '', { sep: '  ' });
    writeLedger(T, [{ ts: d1.ts, doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'tty' }]);
    expectOk('检查15:状态行双空格（非规范分隔符）绑定仍过——保分隔符复原不误伤', T);
    rmfix(T);
  }
}

// ---- 场景 55-56:检查 4 引用扫描收窄活跃态（2026-09-27 audit-gate-hardening）----
{
  const T = mkfix();
  // 日期取生效日前（2026-09-26）：superseded 现入 15 配对集（closing-coverage），无台账行 ⇒ 免配对
  // （2026-09-28 锚改台账 ts 后，豁免理由 = 无台账行），场景焦点保持在「终态退出引用扫描」本身
  w(T, 'workflow/intents/2026-09-26-refterm.md', INTENT('refterm', '状态: superseded\n级别: L1\n日期: 2026-09-26', '\n引用 .agents/scripts/ghost-gone.mjs\n'));
  w(T, 'workflow/plans/2026-09-26-refterm.md', PLAN('refterm', '状态: superseded\n级别: L1'));
  const r = run(T);
  check('检查4:终态文档引用断链不再报（历史叙述退出扫描）',
    r.status === 0 && !outOf(r).includes('引用断档'), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}
{
  const T = mkfix();
  w(T, 'workflow/intents/2026-09-26-reflive.md', INTENT('reflive', '状态: approved\n级别: L1\n日期: 2026-09-26', '\n引用 .agents/scripts/ghost-gone.mjs\n'));
  w(T, 'workflow/plans/2026-09-26-reflive.md', PLAN('reflive', '状态: draft\n级别: L1'));
  const r = run(T);
  check('检查4:活跃文档引用断链仍报（收窄只放终态）',
    r.status === 0 && outOf(r).includes('引用断档') && outOf(r).includes('ghost-gone.mjs'), `exit=${r.status}\n${outOf(r)}`);
  rmfix(T);
}

// ---- 场景 57-60:检查 15 incidents 确认门（2026-09-27 gate-coverage，配对自 2026-09-28 起）----
//     fixed/closed 须指纹+台账配对；closed 与 done 同口径内容绑定（ts 锚 + 保分隔符）；open 起草态不加门
{
  const mkIncFixture = (T, st, tamper, opt = {}) => {
    const ts = opt.ts || '2026-09-28T02:00:00.000Z';
    const body = 三件套(false);
    const pre = `---\n状态: fixed\n级别: L1\n发现: 2026-09-28\n确认指纹: ${'a'.repeat(16)}\n---\n# INCIDENT — inc\n${body}`;
    const fpClosed = computeFingerprint(pre);
    // tamper 只污染 closed 落盘文本（不进指纹底稿）——复刻「closed 确认后篡改正文」
    const closedText = `---\n状态: ${st}\n级别: L1\n发现: 2026-09-28\n确认指纹: ${fpClosed.slice(0, 16)}\n---\n# INCIDENT — inc\n${body}${tamper || ''}`;
    w(T, 'workflow/incidents/2026-09-28-inc.md', closedText);
    w(T, 'workflow/plans/2026-09-28-inc.md', PLAN('inc', '状态: draft\n级别: L1'));
    return { rel: 'workflow/incidents/2026-09-28-inc.md', fp: fpClosed, ts };
  };
  {
    // incident closed（生效日起）无指纹无台账 → hard 确认未对账
    const T = mkfix();
    w(T, 'workflow/incidents/2026-09-28-inc15.md', `---\n状态: closed\n级别: L1\n发现: 2026-09-28\n---\n# INCIDENT — inc15\n${三件套(false)}`);
    w(T, 'workflow/plans/2026-09-28-inc15.md', PLAN('inc15', '状态: draft\n级别: L1'));
    expectHard('检查15:incident closed（生效日起）无指纹无台账 → hard 确认未对账', T, '确认未对账');
    rmfix(T);
  }
  {
    const T = mkfix();
    const i1 = mkIncFixture(T, 'closed');
    writeLedger(T, [{ ts: i1.ts, doc: i1.rel, stage: 'closed', fingerprint: i1.fp, prev: 'fixed', source: 'tty' }]);
    expectOk('检查15:incident closed 配对+内容绑定一致 → exit 0', T);
    rmfix(T);
  }
  {
    const T = mkfix();
    const i1 = mkIncFixture(T, 'closed', 'closed 确认后被篡改的正文行\n');
    writeLedger(T, [{ ts: i1.ts, doc: i1.rel, stage: 'closed', fingerprint: i1.fp, prev: 'fixed', source: 'tty' }]);
    expectHard('检查15:incident closed 后正文被篡改 → hard 确认内容漂移', T, '确认内容漂移');
    rmfix(T);
  }
  {
    // open 起草态不加门（无指纹无台账 → 不报确认未对账）
    const T = mkfix();
    w(T, 'workflow/incidents/2026-09-28-incopen.md', `---\n状态: open\n级别: L1\n发现: 2026-09-28\n---\n# INCIDENT — incopen\n${三件套(false)}`);
    w(T, 'workflow/plans/2026-09-28-incopen.md', PLAN('incopen', '状态: draft\n级别: L1'));
    const r = run(T);
    check('检查15:incident open（起草态）不进确认门 → 不报确认未对账',
      r.status === 0 && !outOf(r).includes('确认未对账'), `exit=${r.status}\n${outOf(r)}`);
    rmfix(T);
  }
}

// ---- 场景 61-63:检查 15 放弃态覆盖（2026-09-27 closing-coverage：superseded/cancelled 配对 + 四终态绑定）----
{
  const mkAbandonFixture = (T, st, tamper) => {
    const ts = '2026-09-28T02:00:00.000Z';
    const body = '\n正文行\n';
    const pre = `---\n状态: approved\n级别: L1\n日期: 2026-09-28\n确认指纹: ${'a'.repeat(16)}\n---\n# INTENT — ab\n${body}`;
    const fp = computeFingerprint(pre);
    const after = `---\n状态: ${st}\n级别: L1\n日期: 2026-09-28\n确认指纹: ${fp.slice(0, 16)}\n---\n# INTENT — ab\n${body}${tamper || ''}`;
    w(T, 'workflow/intents/2026-09-28-ab.md', after);
    w(T, 'workflow/plans/2026-09-28-ab.md', PLAN('ab', '状态: draft\n级别: L1'));
    return { rel: 'workflow/intents/2026-09-28-ab.md', fp, ts };
  };
  {
    // superseded（生效日起）无指纹无台账 → hard 确认未对账（手改出账的口子收死）
    const T = mkfix();
    w(T, 'workflow/intents/2026-09-28-ab1.md', `---\n状态: superseded\n级别: L1\n日期: 2026-09-28\n---\n# INTENT — ab1\n`);
    w(T, 'workflow/plans/2026-09-28-ab1.md', PLAN('ab1', '状态: draft\n级别: L1'));
    expectHard('检查15:superseded（生效日起）无指纹无台账 → hard 确认未对账', T, '确认未对账');
    rmfix(T);
  }
  {
    // superseded + 配对 + 终态绑定：篡改 → hard 确认内容漂移
    const T = mkfix();
    const a1 = mkAbandonFixture(T, 'superseded', 'superseded 确认后被篡改的正文行\n');
    writeLedger(T, [{ ts: a1.ts, doc: a1.rel, stage: 'superseded', fingerprint: a1.fp, prev: 'approved', source: 'tty' }]);
    expectHard('检查15:superseded 后正文被篡改 → hard 确认内容漂移（四终态绑定）', T, '确认内容漂移');
    rmfix(T);
  }
  {
    // cancelled + 配对 + 绑定一致 → 过
    const T = mkfix();
    const a1 = mkAbandonFixture(T, 'cancelled');
    writeLedger(T, [{ ts: a1.ts, doc: a1.rel, stage: 'cancelled', fingerprint: a1.fp, prev: 'approved', source: 'chat-delegated', quote: '不做了' }]);
    expectOk('检查15:cancelled 配对+绑定一致 → exit 0', T);
    rmfix(T);
  }
}

// ---- 场景 64-66:检查 15 并录批次审计（2026-09-27 confirm-gate-one-per-call）----
//     delegated 合法跳转行按「quote 相同 + 相邻 ts 差 < 2s」聚组，组 > 1 → warning「确认并录」（存量可见性，不阻断）
{
  const mk2LedgerDocs = (T) => {
    // 两份全配对绑定的 done 文档（复用 mkDoneFixture 的构造口径）
    const mkOne = (slug, date) => {
      const body = `\n## 验收标准（可测试）\n- [x] 用例通过（证据:fixture）\n`;
      const pre = `---\n状态: approved\n级别: L1\n日期: ${date}\n确认指纹: ${'a'.repeat(16)}\n---\n# INTENT — ${slug}\n${body}`;
      const fp = computeFingerprint(pre);
      w(T, `workflow/intents/${date}-${slug}.md`, `---\n状态: done\n级别: L1\n日期: ${date}\n确认指纹: ${fp.slice(0, 16)}\n---\n# INTENT — ${slug}\n${body}`);
      w(T, `workflow/plans/${date}-${slug}.md`, PLAN(slug, '状态: draft\n级别: L1'));
      return { rel: `workflow/intents/${date}-${slug}.md`, fp };
    };
    return [mkOne('ab1', '2026-09-28'), mkOne('ab2', '2026-09-28')];
  };
  {
    // 同 quote 双份 1.5s 内 → warning 可见（exit 0 不阻断）
    const T = mkfix();
    const [d1, d2] = mk2LedgerDocs(T);
    writeLedger(T, [
      { ts: '2026-09-28T02:00:00.000Z', doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'chat-delegated', quote: '两份一起' },
      { ts: '2026-09-28T02:00:01.500Z', doc: d2.rel, stage: 'done', fingerprint: d2.fp, prev: 'approved', source: 'chat-delegated', quote: '两份一起' },
    ]);
    const r = run(T);
    check('检查15:同 quote 双份 2s 内 → WARN 确认并录（exit 0 审计可见性）',
      r.status === 0 && outOf(r).includes('确认并录') && outOf(r).includes('2 份'),
      `exit=${r.status}\n${outOf(r)}`);
    rmfix(T);
  }
  {
    // 异 quote / 间隔 > 2s / TTY 行 → 均不聚组
    const T = mkfix();
    const [d1, d2] = mk2LedgerDocs(T);
    writeLedger(T, [
      { ts: '2026-09-28T02:00:00.000Z', doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'chat-delegated', quote: '第一份' },
      { ts: '2026-09-28T02:00:01.000Z', doc: d2.rel, stage: 'done', fingerprint: d2.fp, prev: 'approved', source: 'chat-delegated', quote: '第二份' },
      { ts: '2026-09-28T03:00:00.000Z', doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'tty' },
      { ts: '2026-09-28T03:00:01.000Z', doc: d2.rel, stage: 'done', fingerprint: d2.fp, prev: 'approved', source: 'tty' },
    ]);
    const r = run(T);
    check('检查15:异 quote 分次 + TTY 多文档 → 不报确认并录',
      r.status === 0 && !outOf(r).includes('确认并录'),
      `exit=${r.status}\n${outOf(r)}`);
    // 同 quote 间隔 > 2s → 不聚组（P2-1：2s 阈值钉住）
    writeLedger(T, [
      { ts: '2026-09-28T04:00:00.000Z', doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'chat-delegated', quote: '同一句' },
      { ts: '2026-09-28T04:00:03.000Z', doc: d2.rel, stage: 'done', fingerprint: d2.fp, prev: 'approved', source: 'chat-delegated', quote: '同一句' },
    ]);
    const r3 = run(T);
    check('检查15:同 quote 间隔 > 2s → 不聚组（2s 阈值钉住，P2-1）',
      r3.status === 0 && !outOf(r3).includes('确认并录'),
      `exit=${r3.status}\n${outOf(r3)}`);
    rmfix(T);
  }
  {
    // revert-draft 注记行（stage 非法跳转）→ 不参与聚组不报
    const T = mkfix();
    const [d1, d2] = mk2LedgerDocs(T);
    writeLedger(T, [
      { ts: '2026-09-28T02:00:00.000Z', doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'chat-delegated', quote: 'x' },
      { ts: '2026-09-28T02:00:00.400Z', doc: d2.rel, stage: 'done', fingerprint: d2.fp, prev: 'approved', source: 'chat-delegated', quote: 'x' },
      { ts: '2026-09-28T02:00:00.900Z', doc: 'workflow/plans/2026-09-28-ghost.md', stage: 'revert-draft', fingerprint: 'n/a', prev: 'approved', source: 'chat-delegated', quote: 'x' },
    ]);
    const r = run(T);
    check('检查15:revert-draft 注记行不参与批次聚组（双 done 同 quote 若聚组应报 2 份——加注记行后仍恰 2 份）',
      r.status === 0 && (outOf(r).match(/确认并录/g) || []).length === 1 && outOf(r).includes('2 份') && !outOf(r).includes('ghost'),
      `exit=${r.status}\n${outOf(r)}`);
    rmfix(T);
  }
}

// ---- 场景 67-71:检查 15 受管准入两条件取或（2026-09-28 incident confirm-gate-effective-date-anchor）----
// 换锚前：受管准入仅「自报日期 ≥ 生效日」——新档把日期写早即整段跳过判定（确认门静默不开）。
// 换锚后：受管 = ①台账有合法跳转行 ∨ ②自报日期 ≥ 生效日；两者皆不满足才豁免（存量）。
// ①独立于自报日期成立 → 堵死「确认过却写早日期逃掉对账」；②保留 → 兜住「新档完全没跑 confirm-doc」。
// 本块自包含构造（不复用他块作用域内的 mkDoneFixture，避免跨块引用）。
{
  const mkAnchorFixture = (T, date, tamper, opt = {}) => {
    const ts = opt.ts || '2026-09-28T02:00:00.000Z';
    const body = `\n## 验收标准（可测试）\n- [x] 用例通过（证据:fixture）\n`;
    const pre = `---\n状态: approved\n级别: L1\n日期: ${date}\n确认指纹: ${'a'.repeat(16)}\n---\n# INTENT — anchor\n${body}`;
    const fp = computeFingerprint(pre);
    // tamper 只污染 done 落盘文本（不进指纹底稿）——复刻「done 确认后篡改正文」
    w(T, `workflow/intents/${date}-anchor.md`,
      `---\n状态: done\n级别: L1\n日期: ${date}\n确认指纹: ${fp.slice(0, 16)}\n---\n# INTENT — anchor\n${body}${tamper || ''}`);
    w(T, `workflow/plans/${date}-anchor.md`, PLAN('anchor', '状态: draft\n级别: L1'));
    return { rel: `workflow/intents/${date}-anchor.md`, fp, ts };
  };

  {
    // 核心回归（本 incident 的触发条件）：自报日期早于生效日，但台账 ts 在生效日之后 → 仍须 hard 拦。
    // 换锚前此场景被 `d < eff` 跳过判定（静默放行）；换锚后按台账事实纳入受管。
    const T = mkfix();
    const d1 = mkAnchorFixture(T, '2026-09-20'); // 自报日期 2026-09-20（早于任何生效日）
    writeLedger(T, [{ ts: d1.ts, doc: d1.rel, stage: 'done', fingerprint: 'e'.repeat(64), prev: 'approved', source: 'tty' }]); // 指纹不符
    expectHard('检查15:自报日期早但台账 ts 锚后 + 指纹不符 → hard 确认未对账（换锚前被静默跳过）', T, '确认未对账');
    rmfix(T);
  }
  {
    // 存量豁免须**两条件皆不满足**：日期早（2026-09-26 < 生效日）且台账无行 → 免配对。
    // 注意「日期新但无台账」**不**豁免（那是新档漏走确认门，见上一条核心回归的反面）——
    // 两条件取或的语义即：任一条命中即受管，故豁免档必须两条都不命中。
    const T = mkfix();
    w(T, 'workflow/intents/2026-09-26-noledge.md', INTENT('noledge', '状态: approved\n级别: L1\n日期: 2026-09-26'));
    w(T, 'workflow/plans/2026-09-26-noledge.md', PLAN('noledge', '状态: draft\n级别: L1'));
    expectOk('检查15:日期早于生效日且台账无行 → 存量豁免（两条件皆不满足）', T);
    rmfix(T);
  }
  {
    // 条件①的**独立判别力**（复核 P2-2 更正）：日期早（条件②不命中，本会被日期条件豁免）
    // + 台账有行但**指纹不匹配** → 条件①独立成立 ⇒ 受管 ⇒ 配对失败 ⇒ hard 拦。
    // 断言必须用 expectHard 而非 expectOk：旧单条件下该 doc 因日期早被整段跳过（exit 0），
    // 用 expectOk 会「新旧门都通过」而无法证伪条件①被移除（上一版即此缺陷，属无效测试）。
    // 现版本在忠实变异（还原旧单条件）下会变红——与核心回归场景同向锁定条件①的独立成立。
    const T = mkfix();
    const d1 = mkAnchorFixture(T, '2026-09-20');
    writeLedger(T, [{ ts: '2026-09-28T02:00:00.000Z', doc: d1.rel, stage: 'done', fingerprint: 'e'.repeat(64), prev: 'approved', source: 'tty' }]); // 指纹不符
    expectHard('检查15:日期早但台账有行（指纹不匹配）→ 受管并 hard 拦（条件①独立于日期成立）', T, '确认未对账');
    rmfix(T);
  }
  {
    // 重确认：同一 doc+stage 台账多行 → 取末次 ts 判锚（append-only 末次生效；不能因首行早于锚而误豁免）
    const T = mkfix();
    const d1 = mkAnchorFixture(T, '2026-09-28', '确认后被篡改的正文行\n');
    writeLedger(T, [
      { ts: '2026-09-27T10:00:00.000Z', doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'tty' }, // 早期行（锚前）
      { ts: '2026-09-28T02:00:00.000Z', doc: d1.rel, stage: 'done', fingerprint: d1.fp, prev: 'approved', source: 'tty' }, // 末次行（锚后）
    ]);
    expectHard('检查15:同 doc+stage 台账多行取末次 ts → 篡改仍 hard 确认内容漂移（重确认场景）', T, '确认内容漂移');
    rmfix(T);
  }
  {
    // 非合法跳转行（revert-open / revert-draft 类回退注记）**不构成本 incident 的核心命题**——
    // 为把该属性与日期条件隔离，此处取日期早于生效日（条件②不命中），使受管准入**只**取决于台账条件：
    //   · 若注记行被判为「合法跳转行」→ 台账条件命中 → 受管 → 无指纹 → hard 拦（期望：不拦，故失败）
    //   · 期望：注记行被 VALID_STAGES 过滤 → 台账条件不命中 → 两条件皆不满足 → 存量豁免
    // 注记行不是「确认确实发生过」的证据，不能被当成台账行把文档拖进受管面
    // （否则回退操作反而制造 hard 拦——本 incident 自己就吃过这个亏，见 incident 备注「落态注记」）。
    const T = mkfix();
    const d1 = mkAnchorFixture(T, '2026-09-26');
    writeLedger(T, [
      { ts: '2026-09-28T02:00:00.000Z', doc: d1.rel, stage: 'revert-open', fingerprint: 'n/a', prev: 'approved', source: 'chat-delegated', quote: '回退注记' },
    ]);
    expectOk('检查15:仅 revert-open 注记行（非合法跳转 stage）→ 不构成台账条件，日期早 → 存量豁免 exit 0', T);
    rmfix(T);
  }
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
