#!/usr/bin/env node
/* faces — 项目产品面单源（`.agents/config/project-faces.json`）
 *
 * 形状：{ "ui": ["frontend/src/"], "code": ["backend/"], "tests": ["tests/"], "data": ["wiki/数据维护/"] }
 *   数组元素 = 仓库相对路径前缀（正斜杠；目录以 / 结尾；不要绝对路径）。
 * 语义：
 *   - 文件缺失或四个面全空 = 未配置 → 保守全触发（调用方把任何变更都当产品面，不误放行）。
 *   - 配置后：只有列出的前缀算产品面；未列出的路径（文档 / 工具链 / 引擎面）不触发。
 *   - 解析失败 / 形状错误 = fail-closed（throw / CLI exit 2），不得静默当成未配置。
 * 面含义：ui=界面代码；code=服务端/业务代码；tests=测试；data=schema/数据维护脚本。
 *
 * CLI（供 .githooks 等 shell 面使用）：
 *   flow-kit run faces.mjs --json                      打印解析结果
 *   flow-kit run faces.mjs --check <path...>           命中产品面（或未配置）→ 0；配置后未命中 → 1
 *   flow-kit run faces.mjs --check-staged [--keys k,l] 自查暂存文件（同上退出码）
 *   flow-kit run faces.mjs --face <path>               打印命中的面名（ui/code/tests/data/full/none）
 * 退出码：0 判定成功；1 配置后未命中；2 用法 / 配置错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.FLOW_KIT_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FACES_REL = path.join('.agents', 'config', 'project-faces.json');
export const PRODUCT_KEYS = ['ui', 'code', 'tests', 'data'];

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();

const hit = (prefix, p) => {
  if (!prefix) return false;
  if (p === prefix) return true;
  return p.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
};

/** 读取并校验项目面；文件缺失 = 未配置（configured:false），其余错误一律 throw。 */
export function loadFaces(root = ROOT) {
  const file = path.join(root, FACES_REL);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { configured: false, ui: [], code: [], tests: [], data: [] };
    throw new Error(`project-faces 读取失败：${file}（${e.message}）`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`project-faces JSON 解析失败：${file}（${e.message}）`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('project-faces：顶层必须是对象');
  }
  const out = { configured: false, ui: [], code: [], tests: [], data: [] };
  for (const key of PRODUCT_KEYS) {
    const value = parsed[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) throw new Error(`project-faces：${key} 必须是数组`);
    for (const item of value) {
      if (typeof item !== 'string' || !item.trim()) throw new Error(`project-faces：${key} 只能是非空字符串`);
      if (item.startsWith('/') || /^[A-Za-z]:/.test(item)) {
        throw new Error(`project-faces：${key} 必须是仓库相对前缀（不要绝对路径）：${item}`);
      }
      out[key].push(norm(item));
    }
    if (out[key].length) out.configured = true;
  }
  const unknown = Object.keys(parsed).filter((k) => !PRODUCT_KEYS.includes(k) && !k.startsWith('_'));
  if (unknown.length) {
    throw new Error(`project-faces：未知键 ${unknown.join(', ')}（可用：${PRODUCT_KEYS.join(' / ')}；说明字段用 _note）`);
  }
  return out;
}

/** 路径命中的面名；未命中返回 null。未配置的语义由 isProductPath 承担。 */
export function faceOf(faces, rel, keys = PRODUCT_KEYS) {
  const p = norm(rel);
  for (const key of keys) {
    if (faces[key].some((prefix) => hit(prefix, p))) return key;
  }
  return null;
}

/** 是否产品面：未配置 → 保守 true（全触发）；配置后 → 命中任一指定面。 */
export function isProductPath(faces, rel, keys = PRODUCT_KEYS) {
  if (!faces.configured) return true;
  return faceOf(faces, rel, keys) !== null;
}

function stagedFiles() {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', 'diff', '--cached', '--name-only', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
  if (r.status !== 0) return [];
  return r.stdout.split('\0').map(norm).filter(Boolean);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const argv = process.argv.slice(2);
  const flagValue = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const keysArg = flagValue('--keys');
  const keys = keysArg ? keysArg.split(',').map((k) => k.trim()).filter(Boolean) : PRODUCT_KEYS;
  const knownKeys = keys.every((k) => PRODUCT_KEYS.includes(k));
  let faces;
  try {
    if (!knownKeys) throw new Error(`--keys 只能取 ${PRODUCT_KEYS.join(' / ')}`);
    faces = loadFaces();
  } catch (e) {
    console.error(`faces: ${e.message}`);
    process.exit(2);
  }
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(faces, null, 2)}\n`);
    process.exit(0);
  }
  const checkIdx = argv.indexOf('--check');
  const faceIdx = argv.indexOf('--face');
  if (checkIdx < 0 && faceIdx < 0 && !argv.includes('--check-staged')) {
    console.error('用法：flow-kit run faces.mjs --json | --check <path...> | --check-staged [--keys k,l] | --face <path>');
    process.exit(2);
  }
  const files = argv.includes('--check-staged')
    ? stagedFiles()
    : argv.slice((checkIdx >= 0 ? checkIdx : faceIdx) + 1).map(norm).filter(Boolean);
  if (faceIdx >= 0) {
    const target = norm(argv[faceIdx + 1]);
    if (!target) {
      console.error('faces: --face 缺少路径');
      process.exit(2);
    }
    const face = faces.configured ? (faceOf(faces, target, keys) || 'none') : 'full';
    console.log(face);
    process.exit(0);
  }
  if (!faces.configured) {
    console.log('full');
    process.exit(0);
  }
  const hits = files.filter((f) => isProductPath(faces, f, keys));
  if (hits.length) {
    console.log(`hit ${hits[0]}${hits.length > 1 ? ` (+${hits.length - 1})` : ''}`);
    process.exit(0);
  }
  console.log('none');
  process.exit(1);
}
