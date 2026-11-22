#!/usr/bin/env node
// arena-run.mjs — 本地并发方案打擂执行器 (Local Arena Runner)
// 职责：
//   1. init: 基于 git worktree 为同一 brief 派生 N 个独立臂分支，物理隔离防代码踩踏
//   2. status: 检视当前打擂各臂的分支、物理路径、脏文件与代码变更规模
//   3. eval: 依次/并发进入各臂独立目录执行验证测试套件，自动采集测试通过率、耗时、Diff 行数
//   4. report: 生成对质矩阵表格（Markdown），沉淀机器实测客观证据至决策工单
//   5. adopt: 选定获胜臂（底座），自动生成 patch 应用回主工程
//   6. cleanup: 安全幂等清理所有 git worktree、打擂临时分支与临时目录
// 契约：
//   flow-kit run arena-run.mjs <init|status|eval|report|adopt|cleanup> [options]
//   node .agents/scripts/arena-run.mjs <command> [options]
// 零运行时依赖，纯 Node.js 内置模块（node:fs, node:path, node:child_process）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const GIT = process.env.CHECK_LOOP_GIT || (process.platform === 'win32' ? 'git.exe' : 'git');

export function resolveProjectRoot(explicitRoot) {
  if (explicitRoot) return path.resolve(explicitRoot);
  if (process.env.FLOW_KIT_PROJECT_ROOT) return path.resolve(process.env.FLOW_KIT_PROJECT_ROOT);
  let dir = path.resolve(process.cwd());
  while (true) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.agents'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd());
}

export function runGit(args, cwd) {
  return spawnSync(GIT, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

function assertGitRepo(root) {
  const r = runGit(['rev-parse', '--is-inside-work-tree'], root);
  if (r.error || r.status !== 0 || r.stdout.trim() !== 'true') {
    const err = new Error(`arena-run: 目标目录非 git 仓库或 git 不可用: ${root}`);
    err.code = 'NOT_GIT_REPO';
    throw err;
  }
}

export function getArenaDir(root, topic) {
  return path.join(root, '.agents', 'arena', topic);
}

export function getArenaJsonPath(root, topic) {
  return path.join(getArenaDir(root, topic), 'arena.json');
}

export function readArenaMeta(root, topic) {
  const jsonPath = getArenaJsonPath(root, topic);
  if (!fs.existsSync(jsonPath)) {
    const err = new Error(`arena-run: 未找到主题 "${topic}" 的打擂元数据: ${jsonPath}`);
    err.code = 'ARENA_NOT_FOUND';
    throw err;
  }
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

export function writeArenaMeta(root, topic, data) {
  const arenaDir = getArenaDir(root, topic);
  fs.mkdirSync(arenaDir, { recursive: true });
  fs.writeFileSync(getArenaJsonPath(root, topic), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// 1. init: 开擂派生
export function initArena({ root: explicitRoot, topic, arms = ['plan-a', 'plan-b'], base = 'HEAD', force = false } = {}) {
  const root = resolveProjectRoot(explicitRoot);
  assertGitRepo(root);

  if (!topic || !/^[a-zA-Z0-9_-]+$/.test(topic)) {
    throw new Error(`arena-run: --topic 必须为合法的英数字、下划线或连字符 (got "${topic || ''}")`);
  }

  const armList = Array.isArray(arms) ? arms : String(arms).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  if (armList.length < 2) {
    throw new Error('arena-run: 打擂至少需要 2 个候选臂 (例如 --arms plan-a,plan-b)');
  }
  for (const arm of armList) {
    if (!/^[a-zA-Z0-9_-]+$/.test(arm)) {
      throw new Error(`arena-run: 候选臂名称不合法 "${arm}"，必须匹配 /^[a-zA-Z0-9_-]+$/`);
    }
  }

  const baseRes = runGit(['rev-parse', base || 'HEAD'], root);
  if (baseRes.status !== 0) {
    throw new Error(`arena-run: 无法解析基准分支/提交 "${base}": ${baseRes.stderr || baseRes.stdout}`);
  }
  const baseSha = baseRes.stdout.trim();

  const arenaDir = getArenaDir(root, topic);
  const jsonPath = getArenaJsonPath(root, topic);

  if (fs.existsSync(jsonPath) && !force) {
    const existing = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (existing.status === 'open') {
      throw new Error(`arena-run: 主题 "${topic}" 正在进行中。请先 cleanup，或加 --force 强制覆盖。`);
    }
  }

  if (force && fs.existsSync(arenaDir)) {
    cleanupArena({ root, topic, force: true });
  }

  fs.mkdirSync(arenaDir, { recursive: true });

  const armsMeta = {};
  for (const arm of armList) {
    const branch = `arena/${topic}/${arm}`;
    const armDir = path.join(arenaDir, arm);

    // 分支存活检查与安全清理
    const branchCheck = runGit(['rev-parse', '--verify', branch], root);
    if (branchCheck.status === 0) {
      if (force) {
        runGit(['branch', '-D', branch], root);
      } else {
        throw new Error(`arena-run: 分支 "${branch}" 已存在，请使用 --force 或先 cleanup`);
      }
    }

    const wtAdd = runGit(['worktree', 'add', '-b', branch, armDir, baseSha], root);
    if (wtAdd.status !== 0) {
      throw new Error(`arena-run: 为候选臂 "${arm}" 创建 worktree 失败:\n${wtAdd.stderr || wtAdd.stdout}`);
    }

    // 复制不入库的项目级本地配置（确保 gate 规则与模型偏好可读）
    const localConfig = path.join(root, '.agents', 'config');
    if (fs.existsSync(localConfig)) {
      try {
        fs.cpSync(localConfig, path.join(armDir, '.agents', 'config'), { recursive: true, force: true });
      } catch {
        // 配置拷贝尽力而为
      }
    }

    armsMeta[arm] = {
      branch,
      dir: path.relative(root, armDir).replace(/\\/g, '/'),
      status: 'ready',
    };
  }

  const meta = {
    version: '1.0',
    topic,
    baseCommit: baseSha,
    createdAt: new Date().toISOString(),
    status: 'open',
    arms: armsMeta,
  };

  writeArenaMeta(root, topic, meta);
  return meta;
}

// 2. status: 状态查询
export function statusArena({ root: explicitRoot, topic } = {}) {
  const root = resolveProjectRoot(explicitRoot);
  assertGitRepo(root);

  if (topic) {
    const meta = readArenaMeta(root, topic);
    const armsStatus = {};
    for (const [arm, armInfo] of Object.entries(meta.arms || {})) {
      const armDir = path.join(root, armInfo.dir);
      if (!fs.existsSync(armDir)) {
        armsStatus[arm] = { ...armInfo, exists: false };
        continue;
      }
      const st = runGit(['status', '--short'], armDir);
      const diffStat = runGit(['diff', '--stat', meta.baseCommit], armDir);
      const log = runGit(['log', '-1', '--oneline'], armDir);
      armsStatus[arm] = {
        ...armInfo,
        exists: true,
        dirty: Boolean((st.stdout || '').trim()),
        statusShort: (st.stdout || '').trim(),
        diffStat: (diffStat.stdout || '').trim(),
        lastCommit: (log.stdout || '').trim(),
      };
    }
    return { ...meta, arms: armsStatus };
  }

  // 扫描所有主题
  const arenaBase = path.join(root, '.agents', 'arena');
  if (!fs.existsSync(arenaBase)) return { topics: [] };
  const entries = fs.readdirSync(arenaBase, { withFileTypes: true });
  const topics = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const jsonFile = path.join(arenaBase, entry.name, 'arena.json');
      if (fs.existsSync(jsonFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
          topics.push({ topic: entry.name, status: data.status, createdAt: data.createdAt, arms: Object.keys(data.arms || {}) });
        } catch {
          // ignore corrupted json
        }
      }
    }
  }
  return { topics };
}

// 3. eval: 跑分评测
export function evalArena({ root: explicitRoot, topic, testCmd, timeoutMs = 120000 } = {}) {
  const root = resolveProjectRoot(explicitRoot);
  assertGitRepo(root);

  if (!topic) throw new Error('arena-run: eval 必须指定 --topic');
  const meta = readArenaMeta(root, topic);

  for (const [arm, armInfo] of Object.entries(meta.arms || {})) {
    const armDir = path.join(root, armInfo.dir);
    if (!fs.existsSync(armDir)) {
      armInfo.evaluation = { testStatus: 'MISSING_WORKTREE', exitCode: -1 };
      continue;
    }

    let command = testCmd;
    if (!command) {
      if (fs.existsSync(path.join(armDir, 'package.json'))) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(armDir, 'package.json'), 'utf8'));
          if (pkg.scripts?.test) command = 'npm test';
        } catch {}
      } else if (fs.existsSync(path.join(armDir, 'Cargo.toml'))) {
        command = 'cargo test';
      } else if (fs.existsSync(path.join(armDir, 'pyproject.toml')) || fs.existsSync(path.join(armDir, 'pytest.ini'))) {
        command = 'pytest';
      } else if (fs.existsSync(path.join(armDir, 'go.mod'))) {
        command = 'go test ./...';
      } else if (fs.existsSync(path.join(armDir, 'CMakeLists.txt'))) {
        command = 'ctest --output-on-failure';
      } else if (fs.existsSync(path.join(armDir, 'Makefile'))) {
        command = 'make test';
      }
    }
    if (!command) command = 'node -e "process.exit(0)"';

    const shell = process.platform === 'win32' ? 'cmd.exe' : 'sh';
    const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];

    const start = Date.now();
    const execRes = spawnSync(shell, shellArgs, {
      cwd: armDir,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    const durationMs = Date.now() - start;

    // 代码变动度量（先 add -N 将未追踪文件纳入 diff 面）
    runGit(['add', '-N', '.'], armDir);
    const numstat = runGit(['diff', '--numstat', meta.baseCommit], armDir);
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    if (numstat.status === 0 && numstat.stdout) {
      const lines = numstat.stdout.trim().split(/\r?\n/).filter(Boolean);
      filesChanged = lines.length;
      for (const line of lines) {
        const [add, del] = line.split(/\s+/);
        if (add !== '-') insertions += parseInt(add, 10) || 0;
        if (del !== '-') deletions += parseInt(del, 10) || 0;
      }
    }

    const isPass = execRes.status === 0;
    armInfo.evaluation = {
      evaluatedAt: new Date().toISOString(),
      testCmd: command,
      testStatus: isPass ? 'PASS' : 'FAIL',
      exitCode: execRes.status ?? -1,
      durationMs,
      diff: {
        filesChanged,
        insertions,
        deletions,
      },
      stdoutExcerpt: (execRes.stdout || '').slice(-2000),
    };
  }

  writeArenaMeta(root, topic, meta);
  return meta;
}

// 4. report: 对质表生成
export function reportArena({ root: explicitRoot, topic, output } = {}) {
  const root = resolveProjectRoot(explicitRoot);
  if (!topic) throw new Error('arena-run: report 必须指定 --topic');
  const meta = readArenaMeta(root, topic);

  const arms = Object.entries(meta.arms || {});
  if (arms.length === 0) return '# 方案打擂对质报告 (无候选臂)\n';

  const rows = [];
  // 裁决推荐推导
  let bestPassArm = null;
  let minDuration = Infinity;

  for (const [arm, info] of arms) {
    const ev = info.evaluation;
    if (ev && ev.testStatus === 'PASS') {
      if (ev.durationMs < minDuration) {
        minDuration = ev.durationMs;
        bestPassArm = arm;
      }
    }
  }

  for (const [arm, info] of arms) {
    const ev = info.evaluation;
    if (!ev) {
      rows.push(`| **${arm}** | ⏳ 未评测 (PENDING) | — | — | 待执行 eval |`);
      continue;
    }
    const statusIcon = ev.testStatus === 'PASS' ? '✅ PASS' : '❌ FAIL';
    const dur = `${ev.durationMs.toLocaleString()} ms`;
    const diffStr = `+${ev.diff.insertions} / -${ev.diff.deletions} (${ev.diff.filesChanged} files)`;

    let verdict = '可选候选';
    if (ev.testStatus === 'FAIL') {
      verdict = '⚠️ 测试未通过 (需排障)';
    } else if (arm === bestPassArm) {
      verdict = '🌟 推荐底座 (通过且耗时最优)';
    } else {
      verdict = '✅ 可选底座 / 可嫁接';
    }

    rows.push(`| **${arm}** | ${statusIcon} (exit ${ev.exitCode}) | ${dur} | ${diffStr} | ${verdict} |`);
  }

  const lines = [
    `### 方案打擂实测对质矩阵 (Arena Evaluation Matrix) - ${meta.topic}`,
    `> 基线提交：\`${(meta.baseCommit || '').slice(0, 10)}\` | 状态：\`${meta.status}\` | 评测记录：${new Date().toISOString()}`,
    '',
    '| 候选臂 (Arm) | 验证状态 (Verify) | 执行耗时 (Duration) | 代码规模 (Diff) | 推荐判据 (Verdict) |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...rows,
    '',
  ];

  const markdown = lines.join('\n');

  if (output) {
    const outAbs = path.resolve(root, output);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, markdown, 'utf8');
  }

  return markdown;
}

// 5. adopt: 裁决采纳
export function adoptArena({ root: explicitRoot, topic, arm, clean = false } = {}) {
  const root = resolveProjectRoot(explicitRoot);
  assertGitRepo(root);

  if (!topic || !arm) throw new Error('arena-run: adopt 必须指定 --topic 和 --arm');
  const meta = readArenaMeta(root, topic);

  const armInfo = meta.arms?.[arm];
  if (!armInfo) {
    throw new Error(`arena-run: 未知候选臂 "${arm}"。可选臂: ${Object.keys(meta.arms || {}).join(', ')}`);
  }

  const armDir = path.join(root, armInfo.dir);
  if (!fs.existsSync(armDir)) {
    throw new Error(`arena-run: 候选臂工作树目录不存在: ${armDir}`);
  }

  // 确保所有新建文件与修改纳入 diff（git add -N 对新文件标 intent-to-add）
  runGit(['add', '-N', '.'], armDir);

  // 生成该臂相对 baseCommit 的 diff (支持二进制与全量改动)
  const diffRes = runGit(['diff', '--binary', meta.baseCommit], armDir);
  if (diffRes.status !== 0 || !diffRes.stdout.trim()) {
    throw new Error(`arena-run: 候选臂 "${arm}" 相对基线无代码变动，无需采纳`);
  }

  // 在主工程预检补丁应用
  const checkRes = spawnSync(GIT, ['apply', '--check', '--binary', '-'], {
    cwd: root,
    input: diffRes.stdout,
    encoding: 'utf8',
  });

  if (checkRes.status !== 0) {
    throw new Error(`arena-run: 无法干净应用候选臂 "${arm}" 的改动到主工作区 (存在冲突):\n${checkRes.stderr || checkRes.stdout}`);
  }

  // 实际应用补丁
  const applyRes = spawnSync(GIT, ['apply', '--binary', '-'], {
    cwd: root,
    input: diffRes.stdout,
    encoding: 'utf8',
  });

  if (applyRes.status !== 0) {
    throw new Error(`arena-run: 应用改动失败:\n${applyRes.stderr || applyRes.stdout}`);
  }

  meta.status = 'adopted';
  meta.adoptedArm = arm;
  meta.adoptedAt = new Date().toISOString();
  writeArenaMeta(root, topic, meta);

  if (clean) {
    cleanupArena({ root, topic, force: true });
  }

  return { ok: true, topic, adoptedArm: arm, cleaned: clean };
}

// 6. cleanup: 安全收擂
export function cleanupArena({ root: explicitRoot, topic, force = false } = {}) {
  const root = resolveProjectRoot(explicitRoot);
  assertGitRepo(root);

  if (!topic) throw new Error('arena-run: cleanup 必须指定 --topic');
  const arenaDir = getArenaDir(root, topic);
  if (!fs.existsSync(arenaDir)) {
    return { ok: true, topic, cleaned: false, reason: 'directory not found' };
  }

  let arms = [];
  try {
    const meta = readArenaMeta(root, topic);
    arms = Object.keys(meta.arms || {});
  } catch {
    // 目录存在但无有效元数据时，按目录子项清理
    arms = fs.readdirSync(arenaDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }

  for (const arm of arms) {
    const armDir = path.join(arenaDir, arm);
    const branch = `arena/${topic}/${arm}`;

    // 移除 worktree
    runGit(['worktree', 'remove', '--force', armDir], root);

    // 删除打擂临时分支
    runGit(['branch', '-D', branch], root);
  }

  runGit(['worktree', 'prune'], root);

  // 清除元数据与物理目录
  try {
    fs.rmSync(arenaDir, { recursive: true, force: true });
  } catch (err) {
    if (!force) throw err;
  }

  return { ok: true, topic, cleaned: true };
}

// CLI 参数解析与分发
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[++i];
      } else {
        args[key] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function printHelp() {
  console.log(`arena-run.mjs — 本地并发方案打擂执行器 (Local Arena Runner)

用法：
  flow-kit run arena-run.mjs <command> [options]
  node .agents/scripts/arena-run.mjs <command> [options]

命令：
  init     创建工作树隔离沙盒与候选臂分支
           --topic <name> [--arms plan-a,plan-b] [--base HEAD] [--force]
  status   检视打擂进行态、代码脏污与 diff 规模
           [--topic <name>] [--json]
  eval     在各臂沙盒中独立跑测，采集耗时与度量
           --topic <name> [--test-cmd "npm test"]
  report   输出决策对质矩阵表格 (Markdown)
           --topic <name> [--output <path.md>]
  adopt    采纳指定获胜臂，应用改动至主工作区
           --topic <name> --arm <arm-name> [--clean]
  cleanup  幂等清理临时 worktree 与打擂分支
           --topic <name> [--force]

选项：
  --root <path>  指定项目根目录 (默认自动探测)
  --json         以 JSON 格式输出结果
  -h, --help     显示本帮助信息
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || args.help || args.h) {
    printHelp();
    process.exit(0);
  }

  const root = resolveProjectRoot(args.root);

  try {
    switch (cmd) {
      case 'init': {
        const meta = initArena({
          root,
          topic: args.topic,
          arms: args.arms,
          base: args.base,
          force: Boolean(args.force),
        });
        if (args.json) {
          console.log(JSON.stringify(meta, null, 2));
        } else {
          console.log(`[arena-run] 已成功为主题 "${meta.topic}" 初始化打擂环境 (基准提交: ${meta.baseCommit.slice(0, 10)})：`);
          for (const [arm, info] of Object.entries(meta.arms)) {
            console.log(`  - ${arm}: ${info.dir} (分支: ${info.branch})`);
          }
          console.log('\n请在各候选臂目录中独立实现方案，完成后执行: flow-kit run arena-run.mjs eval --topic ' + meta.topic);
        }
        break;
      }
      case 'status': {
        const st = statusArena({ root, topic: args.topic });
        if (args.json) {
          console.log(JSON.stringify(st, null, 2));
        } else if (args.topic) {
          console.log(`[arena-run] 打擂主题 "${args.topic}" 状态: ${st.status}`);
          for (const [arm, info] of Object.entries(st.arms || {})) {
            console.log(`\n候选臂 [${arm}]:`);
            console.log(`  路径: ${info.dir}`);
            console.log(`  脏工作区: ${info.dirty ? '是 (未提交改动)' : '否 (干净)'}`);
            if (info.diffStat) console.log(`  改动规模:\n    ${info.diffStat.replace(/\n/g, '\n    ')}`);
          }
        } else {
          console.log('[arena-run] 活跃打擂主题列表:');
          if (!st.topics?.length) {
            console.log('  (暂无活跃打擂)');
          } else {
            for (const t of st.topics) {
              console.log(`  - ${t.topic} [${t.status}] (${t.arms.join(', ')})`);
            }
          }
        }
        break;
      }
      case 'eval': {
        const ev = evalArena({
          root,
          topic: args.topic,
          testCmd: args['test-cmd'],
        });
        if (args.json) {
          console.log(JSON.stringify(ev, null, 2));
        } else {
          console.log(`[arena-run] 主题 "${ev.topic}" 评测完成！`);
          console.log('\n' + reportArena({ root, topic: ev.topic }));
          console.log('如需采纳优胜底座，请执行: flow-kit run arena-run.mjs adopt --topic ' + ev.topic + ' --arm <winner> --clean');
        }
        break;
      }
      case 'report': {
        const report = reportArena({
          root,
          topic: args.topic,
          output: args.output,
        });
        if (args.json) {
          const meta = readArenaMeta(root, args.topic);
          console.log(JSON.stringify(meta, null, 2));
        } else {
          console.log(report);
          if (args.output) {
            console.log(`[arena-run] 报告已输出至: ${args.output}`);
          }
        }
        break;
      }
      case 'adopt': {
        const res = adoptArena({
          root,
          topic: args.topic,
          arm: args.arm,
          clean: Boolean(args.clean),
        });
        if (args.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`[arena-run] 成功采纳候选臂 "${res.adoptedArm}"！改动已应用至当前主工程。`);
          if (res.cleaned) console.log('[arena-run] 已自动清理临时打擂沙盒与分支。');
        }
        break;
      }
      case 'cleanup': {
        const res = cleanupArena({
          root,
          topic: args.topic,
          force: Boolean(args.force),
        });
        if (args.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`[arena-run] 主题 "${args.topic}" 沙盒与分支已清理完毕。`);
        }
        break;
      }
      default:
        console.error(`arena-run: 未知命令 "${cmd}"。可用命令: init, status, eval, report, adopt, cleanup`);
        process.exit(1);
    }
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
