#!/usr/bin/env node
// check-local-gates.mjs — 门卫上岗自检（eli5 卡片 4，2026-10-08）
// 本机两条 clone 必做配置 + 钩子文件在位 + 工具链（node/dotnet）在位 + TEST_DB_CONN 专用测试库八项检测；--fix 自动修配置项（文件类缺失给恢复指引，不代修）。
// ⑥ 起工具链按「环境变量（仅浏览器 CHROME_PATH）→ 本机登记 runtime-env.local.md → 标准安装位置探测」解析并回显路径（机理 runtime-env.md §6.3，
// 2026-10-10 本机事实出库——绝对路径不再入库登记，新机按回显补登记即可）。
// 鸡生蛋约束：钩子没挂时任何钩子面检测不可达，故自检必须是独立脚本 + 显著入口（README 入门节 / AGENTS.md 头部）。
// 用法：node .agents/scripts/check-local-gates.mjs [--fix]
// 退出码：0 全过 / 1 有缺。零工作区副作用（只读 git config + 文件存在性检测）。
// 另有 PI 宿主接线 advisory（只读、允许缺省、不进八项判定与退出码；.pi/ 不随 clone 传播，硬查会让他机假红）。

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const fix = process.argv.includes('--fix');
// Stack profile（agentic-flow-kit）：dotnet / TEST_DB_CONN 检查仅 dotnet 栈适用。
const STACK = (() => {
  try { return JSON.parse(fs.readFileSync('.agents/config/engine.json', 'utf8')).options?.stack || 'dotnet'; }
  catch { return 'dotnet'; }
})();
const git = (args) => {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return ''; }
};

const results = [];
const check = (ok, name, detail, fixCmd) => results.push({ ok, name, detail, fixCmd });

// ① core.hooksPath → .githooks（五钩子的挂载点）
const hooksPath = git(['config', 'core.hooksPath']);
check(hooksPath === '.githooks', 'core.hooksPath → .githooks',
  hooksPath ? `当前值: ${hooksPath}` : '未配置', 'git config core.hooksPath .githooks');

// ② merge.ours.driver（appsettings.json 合并保护的本地开关）
const ours = git(['config', 'merge.ours.driver']);
check(ours === 'true', 'merge.ours.driver = true',
  ours ? `当前值: ${ours}` : '未配置', 'git config merge.ours.driver true');

// ②b merge.jsonl-union.driver（.agents/*.jsonl 台账并发去重合并驱动）
const jsonlDriver = git(['config', 'merge.jsonl-union.driver']);
const expectedJsonlDriver = 'node .agents/scripts/git-merge-jsonl.mjs %O %A %B';
check(jsonlDriver === expectedJsonlDriver, 'merge.jsonl-union.driver（台账并发并集合并驱动）',
  jsonlDriver ? `当前值: ${jsonlDriver}` : '未配置', `git config merge.jsonl-union.driver "${expectedJsonlDriver}"`);

// ③ .gitattributes 的 merge=ours 与 merge=jsonl-union 行（仓库侧声明，与 ②/②b 配对生效）
const gaText = fs.existsSync('.gitattributes') ? fs.readFileSync('.gitattributes', 'utf8').replace(/\r/g, '') : '';
const gaOursOk = /^(?:.*\/)?appsettings\.json\s+merge=ours$/m.test(gaText);
const gaJsonlOk = /^\.agents\/\*\.jsonl\s+merge=jsonl-union$/m.test(gaText);
check(gaOursOk && gaJsonlOk, '.gitattributes 含 appsettings merge=ours 与 jsonl merge=jsonl-union 行',
  (!gaOursOk ? 'appsettings 行缺失; ' : '') + (!gaJsonlOk ? '.agents/*.jsonl 行缺失' : ''), null);

// ④ 五钩子文件在位（防「配了 hooksPath 但文件缺」的假上岗）
const hooks = ['pre-commit', 'pre-merge-commit', 'commit-msg', 'pre-push', 'post-commit'];
const missing = hooks.filter((h) => !fs.existsSync(path.join('.githooks', h)));
check(missing.length === 0, `.githooks/ 五钩子文件在位（${hooks.join(' / ')}）`,
  missing.length ? `缺失: ${missing.join('、')} —— git checkout -- .githooks 恢复后重跑` : '', null);

// ⑤ node 在位且主版本 ≥ 22（CI 已验证锚 22.17.0 / 本机 24.21.0，runtime-env §6.2）——pre-commit /
// pre-push 的门禁面几乎全依赖 node，缺失即整体瘫痪（pre-push 已 fail-closed 阻断推送；本项把暴露提前到上岗自检）。版本下限 = CI 验证锚；无法自动安装，不代修。
const nodeVer = (() => { try { return execFileSync('node', ['--version'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
const nodeMajor = Number((/^v(\d+)/.exec(nodeVer) || [])[1]);
check(nodeMajor >= 22, 'Node.js 在位且主版本 ≥ 22（CI 锚 22.17 / 本机 24.21）',
  nodeVer ? `当前: ${nodeVer}（低于 22，请升级）` : '未找到 node（六门中除 commit-msg 外全依赖 node）',
  null);

// ⑥ 工具链解析回显（跨机自适应，runtime-env.md §6.3）：解析顺序 = 环境变量（仅浏览器 CHROME_PATH）→ 本机登记 runtime-env.local.md → 标准安装位置。
// dotnet 缺失计入缺失（静态门 build/test 依赖）；浏览器缺失仅提示（仅 UI 实测需要，不拦上岗）。
const localTool = (name) => {
  try {
    const md = fs.readFileSync('.agents/notes/runtime-env.local.md', 'utf8');
    const row = md.split(/\r?\n/).find((l) => new RegExp(`^\\|\\s*${name}\\s*\\|`).test(l));
    if (!row) return null;
    const m = /^\|\s*[^|]+?\s*\|\s*([^|]+?)\s*\|/.exec(row);
    return m && m[1] ? m[1] : null;
  } catch { return null; } // 未登记（新机正常形态，走探测）
};
const resolveOnDisk = (name, probes, envVar) => {
  const envVal = envVar ? process.env[envVar] || null : null; // 与 browser-resolve.mjs 同语义：env 原始值入候选，存在性随下方统一过滤（失效即落空走下一级）
  const reg = localTool(name);
  return [envVal, reg, ...probes].filter(Boolean).find((p) => fs.existsSync(p)) ?? null;
};
const dotnetPath = STACK === 'dotnet' ? resolveOnDisk('dotnet', ['C:/Program Files/dotnet/dotnet.exe']) : '';
const dotnetVer = dotnetPath ? (() => { try { return execFileSync(dotnetPath, ['--version'], { encoding: 'utf8' }).trim(); } catch { return ''; } })() : '';
if (STACK === 'dotnet') {
  check(dotnetVer !== '', 'dotnet 在位且可执行（静态门 build/test 依赖；标准位置无则登记 runtime-env.local.md）',
    dotnetPath ? `路径 ${dotnetPath} 无法执行 --version` : '未找到：标准位置与 runtime-env.local.md 登记均无（模板 runtime-env.local.example.md）',
    null);
}
const browserPath = resolveOnDisk('browser', [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
], 'CHROME_PATH');

// ⑦ TEST_DB_CONN 专用测试库（写用例 fail-loud 守卫的前置供给，2026-10-29；机理 runtime-env.md §6.5 / TestDbWriteGuard）：
// 未设或指向共享 dev 库（DEVE_CSS_YZGY）时，串行直跑的写用例会被守卫拦截——本项把暴露提前到上岗自检。
// 分区机制已退役（2026-10-30）：本项为集成测试唯一库供给（必设）。含口令不代修——按 runtime-env §6.5
// 口径以 appsettings 同源凭据拼装后 setx（连接串不入库）。
if (STACK === 'dotnet') {
  const tdc = process.env.TEST_DB_CONN || '';
  const tdcDb = (/(?:Database|Initial Catalog)\s*=\s*([^;]+)/i.exec(tdc) || [])[1]?.trim() || '';
  check(!!tdcDb && tdcDb.toUpperCase() !== 'DEVE_CSS_YZGY', 'TEST_DB_CONN 专用测试库已设且不指向共享 dev 库',
    !tdc ? '未设置：串行直跑写用例将被 TestDbWriteGuard fail-loud 拦截（setx TEST_DB_CONN "<Server 同 appsettings;Database=Deve_CSS_SuHao;...>"，见 runtime-env §6.5）'
         : `指向共享 dev 库（Database=${tdcDb}）：写用例将被拦截`, null);
}

let fail = 0;
for (const r of results) {
  if (r.ok) { console.log(`  [OK] ${r.name}`); continue; }
  fail++;
  console.log(`  [缺失] ${r.name}${r.detail ? ` —— ${r.detail}` : ''}`);
  if (fix && r.fixCmd) {
    try {
      execSync(r.fixCmd, { stdio: 'inherit' });
      console.log(`  [已修复] ${r.fixCmd}`);
    } catch (e) {
      console.log(`  [修复失败] ${e.message}`);
    }
  } else if (r.fixCmd) {
    console.log(`         修复: ${r.fixCmd}`);
  }
}
// 工具链路径回显（⑥ 探测结果，信息面——新机 clone 后据此补 runtime-env.local.md 登记，模板 runtime-env.local.example.md）
console.log(`  [echo] node → ${nodeVer || '?'}（PATH 解析）`);
console.log(`  [echo] git → ${(git(['--version']) || '?').replace(/^git version /, '')}（PATH 解析）`);
console.log(dotnetVer !== '' ? `  [echo] dotnet → ${dotnetVer}（${dotnetPath}）` : '  [echo] dotnet → 未解析到');
console.log(browserPath
  ? `  [echo] UI 浏览器 → ${browserPath}`
  : '  [echo] UI 浏览器 → 未解析到（env CHROME_PATH / runtime-env.local.md browser 行 / 标准位置均未命中有效路径；UI 实测前设其一）');
// ⑧-advisory PI 宿主接线（本机私有）：只读对账，不进八项判定、不改退出码。
// 为何 advisory：.pi/ 不入 git、不随 clone 传播；列为硬检查会让他机恒红
// （同 .agents/scripts/check-hook-wiring.mjs:20-21 的入库宿主白名单口径）。
const piWiringFiles = [
  '.pi/extensions/shipyard-gates.ts',
  '.pi/extensions/lib/gates-core.cjs',
  '.agents/hooks/pre-shell-check.cjs',
  '.agents/hooks/pre-write-check.cjs',
];
const piMissing = piWiringFiles.filter((f) => !fs.existsSync(f));
const piHostAbsent = piWiringFiles.slice(0, 2).every((f) => !fs.existsSync(f));
if (piHostAbsent) {
  console.log('  [info] PI 宿主接线：本机未启用（.pi/ 为 gitignore 的本机私有目录，clone 不传播；启用见 runtime-env.md §6.4 / runtime-env.local.md）');
} else if (piMissing.length) {
  console.log(`  [WARN] PI 宿主接线不完整，缺：${piMissing.join('、')}（session_start 自检也可能随之失效，门禁静默失效；机理 runtime-env.md §6.4）`);
} else {
  let piTrusted = false;
  try {
    const trust = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.pi', 'agent', 'trust.json'), 'utf8'));
    piTrusted = Object.keys(trust).some((k) => trust[k] === true && path.resolve(k) === path.resolve(process.cwd()));
  } catch { /* 无 trust 文件 = 未确认 */ }
  console.log(piTrusted
    ? '  [OK] PI 宿主接线齐备（project trust 已开；tool_call 命令门/写前门生效）'
    : '  [WARN] PI 宿主接线齐备但 project trust 未检出（.pi/extensions 加载需项目 trust；pi 会话可能无门禁）');
}

// ⑧-advisory Cline 宿主适配（本机私有）：只读对账，不进八项判定、不改退出码。
// 为何 advisory：.cline/ 不入 git、不随 clone 传播（同 .pi/ 口径，见 check-hook-wiring.mjs:20-21）。
// 对账内容：7+7 指针壳齐备性 + 两门 hook 在位（PreToolUse.cjs 协议适配层）。
// 权威源在 .agents/，本目录不入库不损失契约；缺失只影响本机 cline 宿主的阶段路由 / 角色委派 / 命令门 / 写前门。
const clineWorkflows = [
  'wf-new-task', 'wf-stages', 'wf-review', 'wf-deploy', 'wf-maintain', 'wf-pipeline-run', 'wf-pr-review',
];
const clineAgents = [
  'implementer', 'independent-reviewer', 'ui-verifier',
  'pr-finder', 'pr-verifier', 'pr-adjudicator', 'wiki-compiler',
];
const clineFiles = [
  ...clineWorkflows.map((n) => `.cline/workflows/${n}.md`),
  ...clineAgents.map((n) => `.cline/agents/${n}.yml`),
  '.cline/hooks/PreToolUse.cjs',
];
const clineMissing = clineFiles.filter((f) => !fs.existsSync(f));
const clineAbsent = !fs.existsSync('.cline');
if (clineAbsent) {
  console.log('  [info] Cline 宿主适配：本机未启用（.cline/ 为 gitignore 的本机私有目录，clone 不传播；启用见 runtime-env.md §6.4 / runtime-env.local.md）');
} else if (clineMissing.length) {
  console.log(`  [WARN] Cline 宿主适配不完整，缺：${clineMissing.join('、')}（阶段路由 / 角色委派 / 命令门 / 写前门在 cline 宿主下静默缺失；权威源在 .agents/，本机重建即可）`);
} else {
  console.log('  [OK] Cline 宿主适配齐备（7 工作流指针壳 + 7 角色定义 + 命令门/写前门 hook；权威源零改动）');
}

// ⑨-advisory Command Code 宿主接线（本机私有，`.commandcode/` gitignore）：只读对账，不进八项判定、不改退出码。
// 判据 = 接线宣称 ↔ 实态：PreToolUse 的 matcher 须各自指向 .agents/hooks 两门（matcher 目标是
// tool_display_name：WRITE|EDIT 与 SHELL），否则该宿主下门禁静默失效。
const CC_SETTINGS = '.commandcode/settings.json';
if (!fs.existsSync('.commandcode')) {
  console.log('  [info] Command Code 宿主接线：本机未启用（.commandcode/ 为 gitignore 的本机私有目录，clone 不传播；启用见 runtime-env.md §6.4 / runtime-env.local.md）');
} else if (![CC_SETTINGS, '.agents/hooks/pre-shell-check.cjs', '.agents/hooks/pre-write-check.cjs'].every((f) => fs.existsSync(f))) {
  console.log(`  [WARN] Command Code 宿主接线不完整：缺 ${CC_SETTINGS} 或 .agents/hooks 两门文件（宿主钩子会静默失效）`);
} else {
  let cc = null;
  try { cc = JSON.parse(fs.readFileSync(CC_SETTINGS, 'utf8')); } catch { /* 解析失败按失配处理 */ }
  const groups = cc && cc.hooks && Array.isArray(cc.hooks.PreToolUse) ? cc.hooks.PreToolUse : [];
  const wired = (matcherRe, gateFile) => groups.some((g) => g && typeof g.matcher === 'string' && matcherRe.test(g.matcher)
    && Array.isArray(g.hooks) && g.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(gateFile)));
  const ccMiss = [];
  if (!wired(/write|edit/i, 'pre-write-check.cjs')) ccMiss.push('写前门（matcher 需含 WRITE/EDIT）');
  if (!wired(/shell/i, 'pre-shell-check.cjs')) ccMiss.push('命令门（matcher 需含 SHELL）');
  console.log(ccMiss.length
    ? `  [WARN] Command Code 宿主接线缺：${ccMiss.join('、')}（该宿主下对应门禁静默失效；机理 runtime-env.md §6.4）`
    : '  [OK] Command Code 宿主接线齐备（PreToolUse 写前门 + 命令门）');
}

// ⑩-advisory Claude Code 宿主接线（本机私有，`.claude/` 与根 CLAUDE.md gitignore）：只读对账，
// 不进八项判定、不改退出码。判据 = settings 两门接线 + 7 命令 / 7 角色指针壳齐备。
// 机理 runtime-env.md §6.4；权威源仍在 .agents/commands/ 与 .agents/roles/。
const CLAUDE_SETTINGS = '.claude/settings.json';
const claudeCommands = [
  'wf-new-task', 'wf-stages', 'wf-review', 'wf-deploy', 'wf-maintain', 'wf-pipeline-run', 'wf-pr-review',
];
const claudeAgents = [
  'implementer', 'independent-reviewer', 'ui-verifier',
  'pr-finder', 'pr-verifier', 'pr-adjudicator', 'wiki-compiler',
];
const claudeFiles = [
  CLAUDE_SETTINGS,
  '.agents/hooks/pre-shell-check.cjs',
  '.agents/hooks/pre-write-check.cjs',
  ...claudeCommands.map((n) => `.claude/commands/${n}.md`),
  ...claudeAgents.map((n) => `.claude/agents/${n}.md`),
];
const claudeMissing = claudeFiles.filter((f) => !fs.existsSync(f));
if (!fs.existsSync('.claude')) {
  console.log('  [info] Claude Code 宿主接线：本机未启用（.claude/ 与 CLAUDE.md 为 gitignore 的本机私有面，clone 不传播；启用见 runtime-env.md §6.4）');
} else if (claudeMissing.length) {
  console.log(`  [WARN] Claude Code 宿主接线不完整，缺：${claudeMissing.join('、')}（写前门 / 命令门 / 阶段路由 / 角色委派在 Claude 会话下静默缺失；权威源在 .agents/，本机重建即可）`);
} else {
  let cs = null;
  try { cs = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')); } catch { /* 解析失败按失配处理 */ }
  const groups = cs && cs.hooks && Array.isArray(cs.hooks.PreToolUse) ? cs.hooks.PreToolUse : [];
  const wired = (matcherRe, gateFile) => groups.some((g) => g && typeof g.matcher === 'string' && matcherRe.test(g.matcher)
    && Array.isArray(g.hooks) && g.hooks.some((h) => h && typeof h.command === 'string' && h.command.includes(gateFile)));
  const claudeMiss = [];
  if (!wired(/write|edit/i, 'pre-write-check.cjs')) claudeMiss.push('写前门（matcher 需含 WRITE/EDIT）');
  if (!wired(/bash|shell/i, 'pre-shell-check.cjs')) claudeMiss.push('命令门（matcher 需含 BASH/SHELL）');
  console.log(claudeMiss.length
    ? `  [WARN] Claude Code 宿主接线缺：${claudeMiss.join('、')}（该宿主下对应门禁静默失效；机理 runtime-env.md §6.4）`
    : '  [OK] Claude Code 宿主接线齐备（PreToolUse 写前门 + 命令门；7 命令 + 7 角色指针壳）');
}

if (fail > 0) {
  console.log(fix
    ? '\n门卫未全上岗：配置类已尝试自动修复（文件类缺失须按指引手动恢复）；修复后重跑本脚本确认全绿。'
    : '\n门卫未全上岗——逐条执行上方修复命令，或一键: node .agents/scripts/check-local-gates.mjs --fix');
  process.exit(1);
}
console.log('\n[PASS] 八项全过——门卫已上岗（pre-commit 硬拦 / 整树强制编译 pre-merge-commit / 闭环扫描 pre-push / evict+积压提醒 post-commit / 台账并集合并；机理详见 .agents/notes/runtime-env.md §7）。');
