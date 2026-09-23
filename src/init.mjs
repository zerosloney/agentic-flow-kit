// flow-kit init：无参数 → 交互确认环节；带参数 → 直接执行。
// 渲染模板树 + 宿主适配层 → 生成 owned 基线配置 → 挂 git 钩子 → 写 kit.json → 跑生成器与 doctor
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execSync, spawnSync } from 'node:child_process';
import { renderTree, sha256 } from './render.mjs';
import { HOSTS, STACKS, settingsJson, commitCheckConfig, pickStackVars, isOwned } from './profiles.mjs';
import { doctor } from './doctor.mjs';

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function runNode(target, script, args = []) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: target, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

// makePrompt：行队列式问答（比逐次 rl.question 稳——管道/EOF 提前关闭时不会抛错，安全回退默认值或取消）
// ask(question, def)：def 为默认值（空输入 / EOF 回退）；无 def 时空输入返回 ''（用于必须显式确认的问句）
function makePrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const lines = [];
  const waiters = [];
  let ended = false;
  rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l.trim()); else lines.push(l.trim()); });
  rl.on('close', () => { ended = true; while (waiters.length) waiters.shift()(''); });
  return {
    ask(question, def) {
      return new Promise((resolve) => {
        process.stdout.write(def ? `${question}（直接回车=${def}）：` : `${question}：`);
        const fin = (a) => resolve(a || def || '');
        const l = lines.shift();
        if (l !== undefined) fin(l);
        else if (ended) fin('');
        else waiters.push(fin);
      });
    },
    close() { rl.close(); },
  };
}

// 交互确认环节：宿主多选 → 看板端口 → 显式确认（EOF / 非 y 一律取消，不装）
async function interactive() {
  const p = makePrompt();
  console.log('▶ flow-kit init（交互模式——裸跑无参数时进入；带参数则直接执行，见 flow-kit --help）');
  console.log('  将在当前目录安装：.agents/ ｜ .githooks/ ｜ workflow/ ｜ wiki/ ｜ AGENTS.md（已存在的文件保守跳过）');
  try {
    const hosts = await p.ask('1/3 选择 agent 宿主（逗号分隔：zcode / opencode / trae / omp）', 'zcode');
    const stack = await p.ask('2/3 技术栈——决定编译检查与自检验命令初值（dotnet / node / python / go / none）', 'none');
    const boardPort = await p.ask('3/3 workflow 看板端口', '8933');
    const yes = await p.ask('确认安装到当前目录？(y/n)');
    if (!/^(y|yes)$/i.test(yes)) {
      console.log('已取消（未做任何改动）');
      process.exit(0);
    }
    return { hosts, stack, boardPort, dir: process.cwd(), force: false };
  } finally {
    p.close();
  }
}

export async function init(args, pkgRoot) {
  let opt;
  if (args.length === 0) {
    opt = await interactive();
  } else {
    opt = { hosts: 'zcode', stack: 'none', boardPort: '8933', dir: process.cwd(), force: false };
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const next = () => {
        const v = args[++i];
        if (v === undefined) fail(`选项 ${a} 缺少值`);
        return v;
      };
      if (a === '--hosts') opt.hosts = next();
      else if (a === '--stack') opt.stack = next();
      else if (a === '--board-port') opt.boardPort = next();
      else if (a === '--dir') opt.dir = next();
      else if (a === '--force') opt.force = true;
      else fail(`未知选项：${a}（flow-kit init --help 看全部）`);
    }
  }

  if (!STACKS[opt.stack]) fail(`未知技术栈：${opt.stack}（可选 dotnet | node | python | go | none——对应编译检查与自检验命令初值）`);
  const hosts = opt.hosts.split(',').map((s) => s.trim()).filter(Boolean);
  for (const h of hosts) {
    if (!HOSTS[h]) fail(`未知宿主：${h}（可选 ${Object.keys(HOSTS).join(' | ')}）`);
  }

  const target = path.resolve(opt.dir);
  if (!fs.existsSync(target)) fail(`目标目录不存在：${target}`);
  const kitPath = path.join(target, '.agents', 'kit.json');
  if (fs.existsSync(kitPath) && !opt.force) {
    fail(`${target} 已安装 agentic-flow-kit（.agents/kit.json 存在）。重装/修复用 --force；升级将由 flow-kit sync 提供。`);
  }

  const vars = { BOARD_PORT: String(opt.boardPort), ...pickStackVars(opt.stack) };

  console.log(`▶ flow-kit init → ${target}`);
  console.log(`  宿主：${hosts.join(', ')} ｜ 技术栈：${opt.stack} ｜ 看板端口：${opt.boardPort}`);

  // 1) 模板树（保守：已存在文件跳过，--force 覆盖）
  const t = renderTree(path.join(pkgRoot, 'templates'), target, vars, { force: opt.force });
  // 2) 宿主适配层
  const hostResults = {};
  for (const h of hosts) {
    hostResults[h] = renderTree(path.join(pkgRoot, 'modules', 'hosts', h), path.join(target, HOSTS[h].dir), vars, { force: opt.force });
  }

  // 3) 生成的 owned 基线配置（引擎按固定路径读取；存在则跳过，永不覆盖；技术栈命令由项目在文件内自填）
  const generated = {
    '.agents/settings.json': settingsJson(opt.stack),
    '.agents/hooks/commit-check.config.json': commitCheckConfig(opt.stack),
  };
  const ownedGenerated = [];
  for (const [rel, content] of Object.entries(generated)) {
    const p = path.join(target, rel);
    if (fs.existsSync(p)) { console.log(`  跳过（已存在）：${rel}`); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    ownedGenerated.push({ rel, sha256: sha256(Buffer.from(content, 'utf8')) });
  }

  // 4) .gitignore 追加（缺哪条补哪条）
  const giPath = path.join(target, '.gitignore');
  const giNeed = ['.agents/cache/', ...(hosts.filter((h) => HOSTS[h].localOnly).map((h) => `${HOSTS[h].dir}/`))];
  let giText = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
  const giAdd = giNeed.filter((l) => !giText.split(/\r?\n/).some((x) => x.trim() === l));
  if (giAdd.length) {
    giText = (giText.endsWith('\n') || giText === '' ? giText : giText + '\n') + '# agentic-flow-kit\n' + giAdd.join('\n') + '\n';
    fs.writeFileSync(giPath, giText);
    console.log(`  .gitignore 追加：${giAdd.join('、')}`);
  }

  // 5) git 钩子挂载
  try {
    execSync('git rev-parse --git-dir', { cwd: target, stdio: 'pipe' });
    execSync('git config core.hooksPath .githooks', { cwd: target, stdio: 'pipe' });
    console.log('  已挂载 git 钩子：core.hooksPath=.githooks（pre-commit / pre-push / commit-msg / post-commit / pre-merge-commit）');
    try {
      execSync('git config merge.ours.driver true', { cwd: target, stdio: 'pipe' });
      console.log('  已启用 merge.ours driver（.gitattributes 的 merge=ours 生效）');
    } catch { /* 可选配置，失败不阻断 */ }
  } catch {
    console.log('  ⚠️ 目标不是 git 仓库——钩子未挂载；git init 后手动执行：git config core.hooksPath .githooks');
  }

  // 6) kit.json：managed（模板/适配层，升级可覆盖）与 owned（基线配置+起步文档，升级不动）台账
  const managed = [
    ...t.written.filter((f) => !isOwned(f.rel)),
    // 宿主文件渲染时相对宿主根，入台账须还原为项目根相对路径
    ...hosts.flatMap((h) => hostResults[h].written.map((f) => ({ ...f, rel: `${HOSTS[h].dir}/${f.rel}` }))),
  ];
  const owned = [...t.written.filter((f) => isOwned(f.rel)), ...ownedGenerated];
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
  fs.mkdirSync(path.dirname(kitPath), { recursive: true });
  fs.writeFileSync(kitPath, `${JSON.stringify({
    kit: 'agentic-flow-kit',
    version: pkg.version,
    createdAt: new Date().toISOString(),
    options: { hosts, stack: opt.stack, boardPort: String(opt.boardPort) },
    managed,
    owned,
  }, null, 2)}\n`);
  console.log(`  kit.json 台账：managed ${managed.length} 份 ｜ owned ${owned.length} 份（版本 ${pkg.version}）`);

  // 7) 生成器首跑（幂等）：workflow/INDEX.md 活跃层索引 + wiki 速览计数与看板 DATA
  const genIndex = runNode(target, '.agents/scripts/gen-workflow-index.mjs');
  console.log(genIndex.ok ? '  已生成 workflow/INDEX.md（活跃层索引）' : `  ⚠️ gen-workflow-index 失败：${genIndex.out.split('\n')[0]}`);
  const genBoard = runNode(target, '.agents/scripts/gen-wiki-board.mjs');
  console.log(genBoard.ok ? '  已生成 wiki 速览计数与知识沉淀总览 DATA' : `  ⚠️ gen-wiki-board 失败：${genBoard.out.split('\n')[0]}`);

  // 8) 自检
  console.log('▶ flow-kit doctor');
  doctor(['--dir', target], pkgRoot);

  if (t.skipped.length) console.log(`  跳过（已存在，未覆盖）：${t.skipped.join('、')}`);
  for (const h of hosts) if (hostResults[h].skipped.length) console.log(`  跳过（${h} 已存在）：${hostResults[h].skipped.join('、')}`);
  console.log('\n✅ 安装完成。下一步：');
  if (opt.stack === 'none') {
    console.log('  1. 技术栈未配置（none）：填 AGENTS.md「项目适配区」构建/测试命令 + .agents/hooks/commit-check.config.json 的 builds（编译检查）+ settings.json allow（自检验命令权限）');
  } else {
    console.log('  1. 按需微调 AGENTS.md「项目适配区」与 .agents/hooks/commit-check.config.json（已按技术栈预填初值）');
  }
  console.log('  2. 按项目模块改 .agents/workflow-modules.txt 词表与 .agents/rule-budgets.txt 预算');
  console.log('  3. 第一个任务从 .agents/commands/new-task.md 流程发起（立 intent → 与用户确认）');
}
