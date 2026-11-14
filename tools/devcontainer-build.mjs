#!/usr/bin/env node
// tools/devcontainer-build.mjs —— 验证 kit 生成的开发容器**真能构建**（R3-8 验收：生成的容器可构建）。
// 两层证据，分开记账：
//   1) 静态层（不需要 docker，CI 必跑）：逐栈生成 .devcontainer/，用 src/install/devcontainer.mjs 的
//      checkDevcontainer 校验（镜像白名单 / 版本钉死 / 栈匹配 / 声明结构）。模板回归在 CI 里当场被拦。
//   2) 构建层（需要 docker）：对选定栈真跑 docker build + docker run，产出「容器可构建且可运行」的硬证据。
//      环境失守（docker 不在 PATH）→ 退出 2（fail-closed），绝不假装构建过。
// 用法：node tools/devcontainer-build.mjs [--stacks node,dotnet] [--json] [--dry-run] [--no-run]
//   --stacks  要真构建的栈（逗号分隔，默认 node；环境变量 FLOW_KIT_DC_STACKS 同效）。静态层恒覆盖全部 7 栈。
//   --dry-run 只生成 + 静态校验 + 打印将要执行的 docker 命令，不真构建。
//   --no-run  只 build，不跑起容器做冒烟。
// 退出码：0 全过；1 有静态违规或构建失败；2 环境失守（docker 缺失）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDevcontainer } from '../src/install/devcontainer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const ALL_STACKS = ['dotnet', 'node', 'typescript', 'rust', 'go', 'java', 'empty'];
const BUILD_TIMEOUT_MS = 25 * 60 * 1000;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const jsonOut = flag('json');
const dryRun = flag('dry-run');
const noRun = flag('no-run');
const stacksArg = value('stacks') || process.env.FLOW_KIT_DC_STACKS || 'node';
const buildStacks = stacksArg.split(',').map((s) => s.trim()).filter(Boolean).filter((s) => ALL_STACKS.includes(s));
if (!buildStacks.length) {
  console.error(`devcontainer-build: --stacks 取值非法（可选：${ALL_STACKS.join(' / ')}）`);
  process.exit(2);
}

function dockerAvailable() {
  const r = spawnSync('docker', ['--version'], { encoding: 'utf8', windowsHide: true });
  return !r.error && r.status === 0;
}

// 生成一个装好的项目（kit 自身即安装器），返回其临时目录。
function generate(stack) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `flow-kit-dc-${stack}-`));
  const r = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', stack, '--target', dir, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  if (r.status !== 0) {
    return { dir, error: `install 失败（exit ${r.status}）：${(r.stderr || '').trim().slice(0, 400)}` };
  }
  return { dir, error: null };
}

function readPinnedVersion(dir) {
  const abs = path.join(dir, '.devcontainer', 'Dockerfile');
  const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  const m = /^\s*ARG\s+FLOW_KIT_VERSION=(\S+)/im.exec(text);
  return m ? m[1] : null;
}

// 钉的版本若还没发布到 npm，build 必然 404 —— 先查一次，未发布就退回 latest 并记账。
function resolveBuildVersion(pinned) {
  if (!pinned) return { version: 'latest', note: 'Dockerfile 未钉版本' };
  const r = spawnSync('npm', ['view', `agentic-flow-kit@${pinned}`, 'version'], { encoding: 'utf8', timeout: 90_000, windowsHide: true });
  if (r.status === 0) return { version: pinned, note: null };
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (/E404|404 Not Found|is not in this registry/i.test(out)) {
    return { version: 'latest', note: `版本 ${pinned} 尚未发布到 npm，构建退回 latest` };
  }
  return { version: pinned, note: `npm 查询失败（${out.trim().slice(0, 120)}），按钉死版本构建` };
}

const results = [];
const emit = (line) => { if (!jsonOut) console.log(line); };

function record(entry) {
  results.push(entry);
  if (jsonOut) return;
  const tag = entry.ok ? '✅' : '❌';
  console.log(`${tag} [${entry.stack}] ${entry.stage}${entry.note ? ` — ${entry.note}` : ''}`);
  if (entry.detail) console.log(`   ${entry.detail}`);
}

// ---- 静态层：全部 7 栈，零 docker 依赖
for (const stack of ALL_STACKS) {
  const { dir, error } = generate(stack);
  if (error) {
    record({ stack, stage: 'static', ok: false, detail: error });
    fs.rmSync(dir, { recursive: true, force: true });
    continue;
  }
  const state = checkDevcontainer({ target: dir, stack });
  record({
    stack,
    stage: 'static',
    ok: state.ok,
    detail: state.ok ? `镜像 ${state.image}，flow-kit ${state.kitVersion}` : state.problems.join('; '),
  });
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- 构建层：选定栈，真 docker build（+ 冒烟 run）
const buildNeeded = !dryRun;
if (buildNeeded) {
  if (!dockerAvailable()) {
    console.error('devcontainer-build: docker 不在 PATH —— 无法验证「容器可构建」（fail-closed，不假装构建过）。');
    if (jsonOut) console.log(JSON.stringify({ ok: false, reason: 'docker-missing', results }, null, 2));
    process.exit(2);
  }
  for (const stack of buildStacks) {
    const { dir, error } = generate(stack);
    if (error) {
      record({ stack, stage: 'build', ok: false, detail: error });
      fs.rmSync(dir, { recursive: true, force: true });
      continue;
    }
    const pinned = readPinnedVersion(dir);
    const { version, note } = resolveBuildVersion(pinned);
    const tag = `flow-kit-dc:${stack}`;
    const args = ['build', '-f', '.devcontainer/Dockerfile', '-t', tag, '--build-arg', `FLOW_KIT_VERSION=${version}`, '.'];
    emit(`[${stack}] docker ${args.join(' ')}`);
    const r = spawnSync('docker', args, { cwd: dir, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS, windowsHide: true });
    if (r.error || r.status !== 0) {
      const tail = `${r.stdout || ''}${r.stderr || ''}`.split('\n').slice(-25).join('\n');
      record({ stack, stage: 'build', ok: false, note, detail: tail.trim().slice(0, 1200) });
      fs.rmSync(dir, { recursive: true, force: true });
      continue;
    }
    if (noRun) {
      record({ stack, stage: 'build', ok: true, note, detail: `镜像 ${tag} 构建成功` });
    } else {
      const rr = spawnSync('docker', ['run', '--rm', tag, 'flow-kit', '--version'], { encoding: 'utf8', timeout: 300_000, windowsHide: true });
      const ok = !rr.error && rr.status === 0;
      record({
        stack,
        stage: 'build+run',
        ok,
        note,
        detail: ok ? `镜像 ${tag} 构建成功且可运行（${(rr.stdout || '').trim().split('\n')[0]}）` : `docker run 失败：${(rr.stderr || '').trim().slice(0, 600)}`,
      });
    }
    // 构建完即删镜像，避免 CI runner 磁盘被镜像塞满。
    spawnSync('docker', ['image', 'rm', '-f', tag], { encoding: 'utf8', windowsHide: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const failed = results.filter((r) => !r.ok);
if (jsonOut) {
  console.log(JSON.stringify({ ok: failed.length === 0, stacks: ALL_STACKS, buildStacks, dryRun, results }, null, 2));
} else {
  console.log(`[devcontainer-build] ${results.filter((r) => r.ok).length}/${results.length} 项通过（构建栈：${buildStacks.join(', ') || '无'}${dryRun ? '，dry-run 未真构建' : ''}）`);
}
process.exit(failed.length ? 1 : 0);
