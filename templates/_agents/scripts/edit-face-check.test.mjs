// edit-face-check.test.mjs — 编辑时快检（2026-10-09 engine-quality-round2 B2）
// 三面：纯函数（lfBytes/globToRe/budgetAdvisory）+ 端到端全绿面 + 破坏面（删阶段索引→WARN→exit 1、
// 预算超限→exit 1）。判定零复刻：端到端经 CHECK_LOOP_ROOT 消费真 check-loop，fixture 复制脚本集。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
};

const mod = await import(pathToFileURL(path.join(SRC, 'edit-face-check.mjs')).href);
const { lfBytes, globToRe, budgetAdvisory } = mod;

// ---- ① 纯函数 ----
check('lfBytes：CRLF 归一计 UTF-8 字节', lfBytes('a\r\nb中文') === Buffer.byteLength('a\nb中文', 'utf8'));
check('globToRe：精确路径', globToRe('AGENTS.md').test('AGENTS.md') && !globToRe('AGENTS.md').test('x/AGENTS.md'));
check('globToRe：段内通配', globToRe('.agents/commands/*.md').test('.agents/commands/plan.md') && !globToRe('.agents/commands/*.md').test('.agents/commands/x/plan.md'));
check('globToRe：目录前缀', globToRe('.agents/cache/').test('.agents/cache/a/b.json'));

{
  const files = new Map([
    ['AGENTS.md', 'x'.repeat(120)],
    ['.agents/commands/plan.md', 'y'.repeat(50)],
  ]);
  const budgets = '# 注释行\nAGENTS.md 100\n.agents/commands/*.md 200\n非法行\n';
  const r = budgetAdvisory(files, budgets);
  check('budgetAdvisory：超限单文件报、未超限不报、非法行跳过',
    r.length === 1 && r[0].rel === 'AGENTS.md' && r[0].limit === 100 && r[0].actual === 120, JSON.stringify(r));
  check('budgetAdvisory：表缺失 fail-open', budgetAdvisory(files, null).length === 0);
}

// ---- ② 端到端 fixture ----
const SCRIPTS = ['check-loop.mjs', 'policy.mjs', 'stage-gates.mjs', 'check-metric-claims.mjs', 'check-hygiene.mjs', 'check-stage-index.mjs', 'gate-seg.mjs', 'workflow-enums.mjs', 'edit-face-check.mjs'];
// 引用完整性哑文件（检查 4/6/7 的存在性判据——避免 fixture 结构性 WARN 淹没断言面）
const REF_COMMANDS = ['new-task', 'plan', 'design', 'build', 'test', 'deploy', 'maintain', 'review'];
const REF_ROLES = ['implementer', 'independent-reviewer', 'ui-verifier'];
function mkFixture({ breakStageIndex, overBudget }) {
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'efc-'));
  fs.mkdirSync(path.join(fx, '.agents', 'scripts'), { recursive: true });
  for (const f of SCRIPTS) fs.copyFileSync(path.join(SRC, f), path.join(fx, '.agents', 'scripts', f));
  for (const f of ['kit.json', 'workflow-modules.txt', 'workflow-enums.txt'])
    if (fs.existsSync(path.join(SRC, '..', f))) fs.copyFileSync(path.join(SRC, '..', f), path.join(fx, '.agents', f));
  fs.mkdirSync(path.join(fx, 'workflow', 'intents'), { recursive: true });
  for (const d of ['specs', 'plans', 'incidents']) fs.mkdirSync(path.join(fx, 'workflow', d), { recursive: true });
  for (const c of REF_COMMANDS) { fs.mkdirSync(path.join(fx, '.agents', 'commands'), { recursive: true }); fs.writeFileSync(path.join(fx, '.agents', 'commands', `${c}.md`), `# ${c}\n`); }
  for (const rname of REF_ROLES) { fs.mkdirSync(path.join(fx, '.agents', 'roles'), { recursive: true }); fs.writeFileSync(path.join(fx, '.agents', 'roles', `${rname}.md`), `# ${rname}\n`); }
  // 常驻面 AGENTS.md：阶段索引齐全（含 review）/ 破坏面删索引（破坏只在 AGENTS.md 侧——new-task
  //   哑文件写全索引，钉检查 7 的双向语义差异）
  const routes = '.agents/commands/plan.md → .agents/commands/design.md → .agents/commands/build.md → .agents/commands/test.md → .agents/commands/deploy.md → .agents/commands/maintain.md';
  const reviewLine = breakStageIndex ? '' : '\n**横切**：.agents/commands/review.md\n';
  const body = `# AGENTS\n\n## 阶段路由\n\n**入口**：.agents/commands/new-task.md\n**指令**：${breakStageIndex ? '（已删）' : routes}${reviewLine}\n`;
  fs.writeFileSync(path.join(fx, 'AGENTS.md'), overBudget ? body + 'x'.repeat(200) : body);
  fs.writeFileSync(path.join(fx, '.agents', 'commands', 'new-task.md'),
    `# new-task\n\n| Plan | ${routes} | Review |\n`);
  fs.writeFileSync(path.join(fx, '.agents', 'rule-budgets.txt'), `AGENTS.md ${overBudget ? 100 : 100000}\n`);
  return fx;
}

{
  // 全绿面：空 workflow + 引用齐全 + 预算内 → hard/预算两道过（exit 0）。
  //   注：不要求零 WARN——check-loop 全扫对极简 fixture 有结构性 advisory（引用/角色形态），明细
  //   承载给编辑者对照；exit 语义只钉 hard 与预算两道（绝对 WARN 计数会让存量仓库恒非零）。
  const fx = mkFixture({});
  const driver = path.join(fx, 'driver.mjs');
  fs.writeFileSync(driver, `import { main } from ${JSON.stringify('file:///' + path.join(fx, '.agents', 'scripts', 'edit-face-check.mjs').replace(/\\/g, '/'))};\nprocess.exit(main(${JSON.stringify(fx)}, ${JSON.stringify(path.join(fx, '.agents', 'scripts'))}));\n`);
  const r = spawnSync(process.execPath, [driver], { encoding: 'utf8' });
  check('E2E 全绿面：exit 0（hard/预算两道过）且 AGENTS.md 侧无索引漂移', r.status === 0 && !/AGENTS\.md 缺 .* 指令索引/.test(r.stdout || ''), `status=${r.status}\n${(r.stdout || '') + (r.stderr || '')}`.slice(0, 600));
}

{
  // 破坏面：删阶段索引 → 检查 7 WARN 点名（明细承载编辑破坏——破坏面 vs 全绿面的差异就在输出；
  //   hard 不误触：阶段索引是 warning 级，exit≠2）
  const fx = mkFixture({ breakStageIndex: true });
  const driver = path.join(fx, 'driver.mjs');
  fs.writeFileSync(driver, `import { main } from ${JSON.stringify('file:///' + path.join(fx, '.agents', 'scripts', 'edit-face-check.mjs').replace(/\\/g, '/'))};\nprocess.exit(main(${JSON.stringify(fx)}, ${JSON.stringify(path.join(fx, '.agents', 'scripts'))}));\n`);
  const r = spawnSync(process.execPath, [driver], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  check('E2E 破坏面（删阶段索引）：WARN 点名 AGENTS.md 侧索引漂移且 hard 不误触', r.status !== 2 && /AGENTS\.md 缺 plan 指令索引/.test(out), `status=${r.status}\n${out.slice(0, 600)}`);
}

{
  // 预算超限面：AGENTS.md 超上限 → exit 1（advisory 面单独可达——workflow 全绿）
  const fx = mkFixture({ overBudget: true });
  const driver = path.join(fx, 'driver.mjs');
  fs.writeFileSync(driver, `import { main } from ${JSON.stringify('file:///' + path.join(fx, '.agents', 'scripts', 'edit-face-check.mjs').replace(/\\/g, '/'))};\nprocess.exit(main(${JSON.stringify(fx)}, ${JSON.stringify(path.join(fx, '.agents', 'scripts'))}));\n`);
  const r = spawnSync(process.execPath, [driver], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  check('E2E 预算超限面：exit 1 且 advisory 点名', r.status === 1 && /预算 advisory/.test(out), `status=${r.status}\n${out.slice(0, 500)}`);
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
