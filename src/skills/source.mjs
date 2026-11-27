// 技能来源解析（R3-4）：local / git / npm。
// 默认离线：git 与 npm 必须显式 --allow-network；local 永不联网。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseFrontmatter } from '../install/frontmatter.mjs';
import { SKILL_NAME_RE } from './lint.mjs';

const NETWORK_TYPES = new Set(['git', 'npm']);

function usageError(message, code = 'SKILL_SOURCE') {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function classifySkillSource(spec) {
  const s = String(spec || '').trim();
  if (!s) throw usageError('add-skill 缺少来源（本地路径 / git URL / npm 包名）', 'MISSING_ARG');
  // 本地路径先于 .git 判型：C:\repos\my.git 存在时按目录复制，不能当远端 URL 去 clone。
  if (fs.existsSync(s) || s.startsWith('.') || s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s)) return 'local';
  if (/^(git\+)?(https?|ssh|git):\/\//.test(s) || /^git@/.test(s) || s.endsWith('.git')) return 'git';
  return 'npm';
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...opts,
  });
}

// cmd.exe 把 ^ 当转义符，npm.cmd 的 %* 还会再解析一层：裸写 ^^ 会被吃掉两次。
// 含 ^ 的参数加双引号，^ 在引号内始终是字面量，npm 收到的仍是 pkg@^1.2.3。
function cmdLiteralArg(arg) {
  return process.platform === 'win32' && arg.includes('^') ? `"${arg}"` : arg;
}

function requireNetwork(type, allowNetwork) {
  if (NETWORK_TYPES.has(type) && !allowNetwork) {
    throw usageError(
      `来源类型 ${type} 需要联网：加 --allow-network 显式放行（默认离线）`,
      'NETWORK_REQUIRED',
    );
  }
}

function splitGitSpec(spec) {
  const s = spec.replace(/^git\+/, '');
  const hash = s.indexOf('#');
  if (hash < 0) return { url: s, ref: null };
  return { url: s.slice(0, hash), ref: s.slice(hash + 1) };
}

// win32 下 run() 走 cmd.exe，参数只按空格拼接、不做转义：来源里的 & | ^ % 等会成为
// 命令行语法。因此在任何 spawn 之前按来源类型过字符白名单，只放行不含 shell 元字符的形态。
const GIT_TARGET_RE =
  /^(?:(?:git\+)?(?:https?|ssh|git):\/\/[A-Za-z0-9._~:/@+\\-]+|git@[A-Za-z0-9._-]+:[A-Za-z0-9._~/@+\\-]+|[A-Za-z0-9._~/\\][A-Za-z0-9._~:/@+\\-]*\.git)$/;
const GIT_REF_RE = /^[A-Za-z0-9._/-]+$/;
const NPM_SPEC_RE = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:@[A-Za-z0-9.~^][A-Za-z0-9._+~^-]*)?$/;

function assertGitTarget(url) {
  if (!GIT_TARGET_RE.test(url)) {
    throw usageError(`git 来源含不安全字符或格式不受支持：${url}`);
  }
}

function assertGitRef(ref) {
  if (!GIT_REF_RE.test(ref) || ref.startsWith('-')) {
    throw usageError(`git ref 含不安全字符或格式不受支持：${ref}`);
  }
}

function assertNpmSpec(spec) {
  if (spec.includes('>=')) {
    throw usageError(`npm 来源不支持 >= 版本范围，请改用 ^ 或 ~：${spec}`);
  }
  if (!NPM_SPEC_RE.test(spec)) {
    throw usageError(`npm 来源含不安全字符或格式不受支持：${spec}`);
  }
}

function readMetaName(dir) {
  try {
    const meta = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
    return meta.name || '';
  } catch {
    return '';
  }
}

export function skillNameOf(dir, explicitName) {
  const name = explicitName || readMetaName(dir) || path.basename(dir);
  if (!SKILL_NAME_RE.test(name)) {
    throw usageError(`技能名须为 kebab-case：${name}（可用 --name 覆盖）`, 'SKILL_NAME');
  }
  return name;
}

export function resolveSkillSource(spec, {
  allowNetwork = false, subdir = null, ref: refFlag = null, name: explicitName = null,
} = {}) {
  const type = classifySkillSource(spec);
  requireNetwork(type, allowNetwork);
  let cleanup = () => {};
  let root;
  let version;
  let resolved;

  if (type === 'local') {
    root = path.resolve(spec);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw usageError(`本地技能目录不存在：${spec}`);
    }
    version = 'local';
    resolved = root;
  } else if (type === 'git') {
    const { url, ref } = splitGitSpec(spec);
    assertGitTarget(url);
    const branch = refFlag || ref;
    if (branch) assertGitRef(branch);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-skill-git-'));
    cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
    const args = ['clone', '--depth', '1'];
    if (branch) args.push('--branch', branch);
    args.push(url, tmp);
    const r = run('git', args);
    if (r.status !== 0) {
      cleanup();
      throw usageError(`git clone 失败：${(r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(-2).join(' | ')}`);
    }
    const sha = run('git', ['-C', tmp, 'rev-parse', '--short', 'HEAD']);
    version = sha.status === 0 && sha.stdout.trim() ? sha.stdout.trim() : (branch || 'git');
    fs.rmSync(path.join(tmp, '.git'), { recursive: true, force: true });
    root = tmp;
    resolved = url + (branch ? `#${branch}` : '');
  } else {
    assertNpmSpec(spec);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-skill-npm-'));
    cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
    const r = run('npm', ['install', '--prefix', tmp, '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', cmdLiteralArg(spec)]);
    if (r.status !== 0) {
      cleanup();
      throw usageError(`npm install 失败：${(r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(-2).join(' | ')}`);
    }
    const at = String(spec).lastIndexOf('@');
    const pkgName = at > 0 ? String(spec).slice(0, at) : String(spec);
    const pkgDir = path.join(tmp, 'node_modules', ...pkgName.split('/'));
    if (!fs.existsSync(pkgDir)) {
      cleanup();
      throw usageError(`npm 包目录不存在：${pkgName}`);
    }
    let pkgVersion = 'npm';
    try {
      pkgVersion = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version || pkgVersion;
    } catch { /* 无 package.json 时保留 npm */ }
    version = pkgVersion;
    root = pkgDir;
    resolved = `${pkgName}@${pkgVersion}`;
  }

  const dir = subdir ? path.join(root, subdir) : root;
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
    cleanup();
    throw usageError(`来源目录缺少 SKILL.md：${subdir || '.'}`);
  }
  return { type, dir, version, resolved, spec, name: skillNameOf(dir, explicitName), cleanup };
}

export function copySkillDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== 'node_modules' && base !== '.git';
    },
  });
}
