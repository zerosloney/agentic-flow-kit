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
  w(T, 'workflow/intents/2026-09-26-old15.md', INTENT('old15', '状态: approved\n级别: L1\n日期: 2026-09-26'));
  w(T, 'workflow/plans/2026-09-26-old15.md', PLAN('old15', '状态: draft\n级别: L1'));
  expectOk('检查15:生效日前存量 approved 无指纹 → 豁免 exit 0', T);
  rmfix(T);
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
