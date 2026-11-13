// 运行时能力入口（R5-1a）：脚本与 hook 适配器随包分发，项目侧只保留声明式接线。
// 契约：
//   flow-kit run <script> [--root <dir>] [-- <args...>]
//   flow-kit hook <hook>  [--root <dir>] [-- <args...>]
// - 目标根解析顺序：--root > FLOW_KIT_PROJECT_ROOT > 从 cwd 向上找 .agents > cwd。
// - 子进程 cwd 固定为目标根，并注入 FLOW_KIT_PROJECT_ROOT / FLOW_KIT_RUNTIME_*，
//   脚本据此定位项目配置；脚本自身仍可被直接 node 执行（回退到包内相对路径）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeT, LANGUAGES } from '../i18n.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(HERE, '..', '..');
// 运行时源暂与引擎模板同源：包安装后即可执行，R5-1b 再收缩安装面。
export const RUNTIME_ROOT = path.join(KIT_ROOT, 'templates', 'engine', '.agents');
export const RUNTIME_SCRIPTS = path.join(RUNTIME_ROOT, 'scripts');
export const RUNTIME_HOOKS = path.join(RUNTIME_ROOT, 'hooks');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function usageError(message, key) {
  const err = new Error(message);
  err.code = key;
  return err;
}

export function resolveRuntimeRoot({ root, cwd = process.cwd(), env = process.env } = {}) {
  const explicit = root || env.FLOW_KIT_PROJECT_ROOT;
  if (explicit) {
    const abs = path.resolve(explicit);
    if (!fs.existsSync(abs)) {
      const err = new Error(`runtime root not found: ${abs}`);
      err.code = 'TARGET_MISSING';
      throw err;
    }
    return abs;
  }
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, '.agents'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(cwd);
}

export function resolveRuntimeScript(name, dir = RUNTIME_SCRIPTS) {
  const base = String(name || '').replace(/\.mjs$/, '');
  if (!NAME_RE.test(base)) {
    const err = new Error(`invalid runtime script: ${name}`);
    err.code = 'UNKNOWN_SCRIPT';
    throw err;
  }
  const file = path.join(dir, `${base}.mjs`);
  if (!fs.existsSync(file)) {
    const err = new Error(`unknown runtime script: ${base}`);
    err.code = 'UNKNOWN_SCRIPT';
    throw err;
  }
  return file;
}

export function resolveRuntimeHook(name, dir = RUNTIME_HOOKS) {
  const raw = String(name || '');
  const base = raw.replace(/\.(cjs|mjs)$/, '');
  if (!NAME_RE.test(base)) {
    const err = new Error(`invalid runtime hook: ${name}`);
    err.code = 'UNKNOWN_HOOK';
    throw err;
  }
  const candidates = raw.endsWith('.cjs') || raw.endsWith('.mjs')
    ? [path.join(dir, raw)]
    : [path.join(dir, `${base}.cjs`), path.join(dir, `${base}.mjs`)];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) {
    const err = new Error(`unknown runtime hook: ${base}`);
    err.code = 'UNKNOWN_HOOK';
    throw err;
  }
  return file;
}

function listRuntime(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(ext) && !entry.name.endsWith('.test.mjs'))
    .map((entry) => entry.name.slice(0, -ext.length))
    .sort();
}

function parseLang(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--lang' && argv[i + 1]) return String(argv[i + 1]);
    if (arg.startsWith('--lang=')) return arg.slice('--lang='.length);
  }
  return 'zh-CN';
}

// 只解析入口自己的选项；--root 允许出现在脚本名之后（等价于入口注入项目根），
// 其余位置参数与旗标原样交给脚本。
export function parseRuntimeArgs(argv) {
  const out = { name: null, root: null, list: false, help: false, rest: [], lang: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      const rest = argv.slice(i + 1);
      if (out.name) out.rest.push(...rest);
      else if (rest.length) {
        out.name = rest[0];
        out.rest.push(...rest.slice(1));
      }
      break;
    }
    if (arg === '--root' && argv[i + 1]) { out.root = argv[++i]; continue; }
    if (arg.startsWith('--root=')) { out.root = arg.slice('--root='.length); continue; }
    if (!out.name) {
      if (arg === '--list') { out.list = true; continue; }
      if (arg === '--help' || arg === '-h') { out.help = true; continue; }
      if (arg === '--lang' && argv[i + 1]) { out.lang = argv[++i]; continue; }
      if (arg.startsWith('--lang=')) { out.lang = arg.slice('--lang='.length); continue; }
      if (arg.startsWith('-')) {
        const err = new Error(`unknown option: ${arg}`);
        err.code = 'MISSING_ARG';
        throw err;
      }
      out.name = arg;
      continue;
    }
    out.rest.push(arg);
  }
  return out;
}

function runChild({ file, target, args }) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: target,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      FLOW_KIT_PROJECT_ROOT: target,
      FLOW_KIT_RUNTIME_ROOT: RUNTIME_ROOT,
      FLOW_KIT_RUNTIME_SCRIPTS: RUNTIME_SCRIPTS,
      FLOW_KIT_RUNTIME_HOOKS: RUNTIME_HOOKS,
    },
  });
  if (result.error) {
    const err = new Error(`runtime command failed: ${result.error.message}`);
    err.code = 'IO';
    throw err;
  }
  return typeof result.status === 'number' ? result.status : 1;
}

export function runtimeCommand(kind, argv) {
  const requestedLang = parseLang(argv);
  const lang = LANGUAGES.includes(requestedLang) ? requestedLang : 'zh-CN';
  const t = makeT(lang);
  const opts = parseRuntimeArgs(argv);

  if (opts.help) {
    console.log(t(kind === 'run' ? 'runtime.runUsage' : 'runtime.hookUsage'));
    return 0;
  }

  if (opts.list) {
    const names = listRuntime(kind === 'run' ? RUNTIME_SCRIPTS : RUNTIME_HOOKS, kind === 'run' ? '.mjs' : '.cjs');
    const extra = kind === 'hook' ? listRuntime(RUNTIME_HOOKS, '.mjs') : [];
    for (const name of [...new Set([...names, ...extra])].sort()) console.log(name);
    return 0;
  }

  if (!opts.name) throw usageError(t('runtime.missingName'), 'MISSING_ARG');

  const target = resolveRuntimeRoot({ root: opts.root });
  const file = kind === 'run'
    ? resolveRuntimeScript(opts.name)
    : resolveRuntimeHook(opts.name);
  return runChild({ file, target, args: opts.rest });
}
