#!/usr/bin/env node
// check-architecture: 通用架构红线门禁（机制内建、规则外置）。
// 为什么外置：红线内容是各目标项目自己的架构约定；脚本一旦写死某个项目的路径/类名，
// 同一道门装进别的项目就会拦住无关提交。本脚本只实现「读规则 → 扫目标 → 报违例」的机制，
// 规则全部来自目标项目的 .agents/hooks/architecture-redlines.json（相对 git 仓库根）。
//
// 用法：由目标项目的门禁面（flow-kit hook / pre-commit）调用；仓库根下放了配置文件才生效。
//
// 配置格式（JSON 对象，三个可选数组；某类缺省就跳过该类检查）：
//   forbidden[]               目标文件里禁止出现的内容：id/targets/message 必填；targets 支持 *（段内通配）
//                             与 **（跨零或多段目录段）；字面目录按 ext 递归收集（默认 .cs，跳过 bin/obj/node_modules/.git），
//                             字面文件单查；contains（字面子串）与 matches（正则）至少配一方，逐行判定；
//                             unless 正则豁免命中行；exclude glob 豁免整文件；optional=true 字面目标缺失跳过本条；
//                             once=true 只报第一条。
//   noNavigationProperties[]  实体目录禁导航属性：id/dir/message 必填；extraTypeNames 补充类型名；optional 同上。
//   catchRequires[]           指定文件的 catch 块体必须包含指定符号：id/files/catch/require/message 必填；
//                             exclude glob 豁免文件；optional 同上。
//
// 退出码：0 = 未配置（目标项目没有红线约定，不应拦人）或已配置且干净；
//         1 = 存在违例；或门禁目标缺失——fail-closed：声明的扫描目标不存在说明配置与代码已漂移，静默放行会让红线失效；
//             或不在 git 仓库内；
//         2 = 配置本身非法（读不了 / JSON 坏 / 顶层不是对象 / 未知顶层键 / 必填字段缺失 / 正则非法 / id 重复或格式不符），
//             错配必须显式暴露，不能当「未配置」放过。
// 约定：违例 / SKIP / 配置错误只写 stderr；stdout 恒为空（上层 PreToolUse 钩子按 stdout 解析 JSON，多一个字符都污染协议）。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { t } from '../scripts/lang.mjs';

const CONFIG = '.agents/hooks/architecture-redlines.json';
const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', '.git']);
const ID_RE = /^[a-z0-9-]+$/;
const SECTIONS = ['forbidden', 'noNavigationProperties', 'catchRequires'];

const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (gitRoot.error || gitRoot.status !== 0) {
  console.error(t('check-architecture: 不在 git 仓库内,门禁 fail-closed,不静默放行', 'check-architecture: not inside a git repository; gate fails closed instead of silently passing'));
  process.exit(1);
}
process.chdir(gitRoot.stdout.trim());

const skip = () => {
  console.error(t(`check-architecture: SKIP 未配置架构红线（${CONFIG} 不存在或无规则）`, `check-architecture: SKIP no architecture redlines configured (${CONFIG} missing or has no rules)`));
  process.exit(0);
};
const failConfig = (msg) => {
  console.error(t(`check-architecture: 配置错误：${msg}`, `check-architecture: config error: ${msg}`));
  process.exit(2);
};
const missingTarget = (p) => {
  console.error(t(`check-architecture: 门禁目标缺失（${p}）——fail-closed,不静默放行`, `check-architecture: gate target missing (${p}) — failing closed instead of silently passing`));
  process.exit(1);
};

// ---------- 扫描机制 ----------
const readLines = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
// 目录递归收集：跳过 bin/obj/node_modules/.git，输出 posix 相对路径
const walkFiles = (dir) => {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
      else out.push(p.replace(/\\/g, '/'));
    }
  };
  walk(dir);
  return out;
};
// glob 只支持 *（段内通配）与 **（跨零或多段目录段），其余字符原义转义。
// ** 段自带斜杠语义，不能再走 join('/')，否则会多出一条斜杠（a/**/b 零段时变成 a//b）
const hasGlobMeta = (p) => p.split('/').some((seg) => seg.includes('*'));
const globToRegex = (glob) => {
  const segs = glob.split('/');
  let re = '';
  segs.forEach((seg, i) => {
    if (seg === '**') {
      re += i === segs.length - 1 ? '(?:[^/]+/)*[^/]*' : '(?:[^/]+/)*';
    } else {
      re += seg.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*');
      if (i < segs.length - 1) re += '/';
    }
  });
  return new RegExp(`^${re}$`);
};
// glob 的静态前缀：第一个含通配的段之前的字面部分，用于存在性检查与扫描起点
const staticPrefix = (glob) => {
  const segs = [];
  for (const seg of glob.split('/')) {
    if (seg.includes('*')) break;
    segs.push(seg);
  }
  return segs.join('/');
};

// ---------- 配置加载（缺失 = 未配置 → SKIP；存在但读不了 / JSON 坏 = 错配 → exit 2） ----------
if (!fs.existsSync(CONFIG)) skip();
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
} catch (err) {
  failConfig(t(`${CONFIG} 不是合法 JSON（${err.message}）`, `${CONFIG} is not valid JSON (${err.message})`));
}
if (typeof config !== 'object' || config === null || Array.isArray(config)) failConfig(t('顶层必须是 JSON 对象', 'top level must be a JSON object'));
for (const key of Object.keys(config)) {
  if (!SECTIONS.includes(key)) failConfig(t(`未知顶层键「${key}」（只允许 ${SECTIONS.join(' / ')}）`, `unknown top-level key "${key}" (allowed: ${SECTIONS.join(' / ')})`));
}
const section = (key) => {
  if (config[key] === undefined) return [];
  if (!Array.isArray(config[key])) failConfig(t(`顶层键「${key}」必须是数组`, `top-level key "${key}" must be an array`));
  return config[key];
};
const raw = { forbidden: section('forbidden'), noNavigationProperties: section('noNavigationProperties'), catchRequires: section('catchRequires') };
if (SECTIONS.every((key) => raw[key].length === 0)) skip();

// ---------- 配置校验：错配在扫描前整体暴露 ----------
const seenIds = new Set();
const checkId = (rule, at) => {
  if (typeof rule.id !== 'string' || !ID_RE.test(rule.id)) failConfig(t(`${at} 的「id」缺失或不符合 [a-z0-9-]`, `${at}: "id" missing or not matching [a-z0-9-]`));
  if (seenIds.has(rule.id)) failConfig(t(`「id」${rule.id} 重复（要求全文件唯一）`, `duplicate "id" ${rule.id} (must be unique across the file)`));
  seenIds.add(rule.id);
};
const reqStr = (rule, key, at) => {
  if (typeof rule[key] !== 'string' || rule[key] === '') failConfig(t(`${at} 缺必填字段「${key}」（非空字符串）`, `${at}: missing required field "${key}" (non-empty string)`));
  return rule[key];
};
const needStrArray = (rule, key, at) => {
  const v = rule[key];
  if (!Array.isArray(v) || v.length === 0 || v.some((s) => typeof s !== 'string' || s === '')) failConfig(t(`${at} 的「${key}」必须是非空字符串数组`, `${at}: "${key}" must be a non-empty array of non-empty strings`));
  return v;
};
const strArray = (rule, key, at) => {
  const v = rule[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || s === '')) failConfig(t(`${at} 的「${key}」必须是非空字符串数组`, `${at}: "${key}" must be an array of non-empty strings`));
  return v;
};
const boolOpt = (rule, key, at) => {
  const v = rule[key];
  if (v === undefined) return false;
  if (typeof v !== 'boolean') failConfig(t(`${at} 的「${key}」必须是布尔值`, `${at}: "${key}" must be a boolean`));
  return v;
};
const compileRegex = (pattern, at) => {
  try {
    return new RegExp(pattern);
  } catch (err) {
    failConfig(t(`${at} 正则非法（${String(pattern)}）：${err.message}`, `${at}: invalid regex (${String(pattern)}): ${err.message}`));
  }
};
const unlessRegex = (rule, at) => {
  if (rule.unless === undefined) return null;
  if (typeof rule.unless !== 'string') failConfig(t(`${at} 的「unless」必须是正则字符串`, `${at}: "unless" must be a regex string`));
  return compileRegex(rule.unless, t(`${at} 的「unless」`, `${at}: "unless"`));
};

const forbiddenRules = raw.forbidden.map((rule, i) => {
  const at = `forbidden[${i}]`;
  checkId(rule, at);
  reqStr(rule, 'message', at);
  const contains = strArray(rule, 'contains', at);
  const matches = strArray(rule, 'matches', at);
  if (contains.length === 0 && matches.length === 0) failConfig(t(`${at}（${rule.id}）的「contains」与「matches」至少要配置一方`, `${at} (${rule.id}): at least one of "contains" / "matches" is required`));
  return {
    targets: needStrArray(rule, 'targets', at),
    contains,
    matchRes: matches.map((p) => compileRegex(p, t(`${at} 的「matches」`, `${at}: "matches"`))),
    unlessRe: unlessRegex(rule, at),
    excludeRes: strArray(rule, 'exclude', at).map(globToRegex),
    exts: rule.ext === undefined ? ['.cs'] : strArray(rule, 'ext', at),
    optional: boolOpt(rule, 'optional', at),
    once: boolOpt(rule, 'once', at),
    message: rule.message,
  };
});

const navRules = raw.noNavigationProperties.map((rule, i) => {
  const at = `noNavigationProperties[${i}]`;
  checkId(rule, at);
  return {
    dir: reqStr(rule, 'dir', at),
    extraTypeNames: strArray(rule, 'extraTypeNames', at),
    optional: boolOpt(rule, 'optional', at),
    message: reqStr(rule, 'message', at),
  };
});

const catchRules = raw.catchRequires.map((rule, i) => {
  const at = `catchRequires[${i}]`;
  checkId(rule, at);
  return {
    files: needStrArray(rule, 'files', at),
    catchMarker: reqStr(rule, 'catch', at),
    require: reqStr(rule, 'require', at),
    excludeRes: strArray(rule, 'exclude', at).map(globToRegex),
    optional: boolOpt(rule, 'optional', at),
    message: reqStr(rule, 'message', at),
  };
});

// ---------- 规则执行 ----------
// 目标解析：先整体做存在性检查（缺失 fail-closed，optional 则整条跳过），再收集文件清单
const resolveTargets = (targets, exts, optional) => {
  for (const t of targets) {
    if (hasGlobMeta(t)) {
      const prefix = staticPrefix(t);
      if (prefix !== '' && !isDir(prefix)) {
        if (optional) return null;
        missingTarget(prefix);
      }
    } else if (!fs.existsSync(t)) {
      if (optional) return null;
      missingTarget(t);
    }
  }
  const files = new Set();
  for (const t of targets) {
    if (hasGlobMeta(t)) {
      const re = globToRegex(t);
      const prefix = staticPrefix(t);
      for (const f of walkFiles(prefix === '' ? '.' : prefix)) {
        if (re.test(f)) files.add(f);
      }
    } else if (isDir(t)) {
      for (const f of walkFiles(t)) {
        if (exts.some((ext) => f.endsWith(ext))) files.add(f);
      }
    } else {
      files.add(t.replace(/\\/g, '/'));
    }
  }
  return [...files].sort();
};

const groups = [];

// forbidden：逐行判 contains 子串 / matches 正则，unless 豁免命中行，exclude 豁免整文件
for (const rule of forbiddenRules) {
  const files = resolveTargets(rule.targets, rule.exts, rule.optional);
  if (files === null) continue;
  const findings = [];
  for (const f of files) {
    if (rule.excludeRes.some((re) => re.test(f))) continue;
    const lines = readLines(f);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hit = rule.contains.some((s) => line.includes(s)) || rule.matchRes.some((re) => re.test(line));
      if (!hit || (rule.unlessRe && rule.unlessRe.test(line))) continue;
      findings.push(`${f}:${i + 1}:${line}`);
    }
  }
  if (rule.once && findings.length > 1) findings.length = 1;
  if (findings.length > 0) groups.push({ message: rule.message, findings });
}

// noNavigationProperties：类名集合 = 目录内 class/record 声明 ∪ extraTypeNames；
// 公有属性类型（集合泛型的元素类型，或裸类型名）指向集合内类型即导航属性违例
for (const rule of navRules) {
  if (!isDir(rule.dir)) {
    if (rule.optional) continue;
    missingTarget(rule.dir);
  }
  const files = walkFiles(rule.dir).filter((f) => f.endsWith('.cs')).sort();
  const names = new Set(rule.extraTypeNames);
  for (const f of files) {
    for (const m of readLines(f).join('\n').matchAll(/public\s+(?:sealed\s+|abstract\s+|partial\s+)*(?:class|record)\s+(\w+)/g)) names.add(m[1]);
  }
  const findings = [];
  for (const f of files) {
    const lines = readLines(f);
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*public\s+(?:virtual\s+)?([\w<>,\s.?]+?)\s+(\w+)\s*\{/.exec(lines[i]);
      if (!m) continue;
      const typ = m[1].trim();
      const mm = /(?:ICollection|List|IEnumerable|IReadOnlyCollection|IReadOnlyList)<\s*(\w+)\s*>/.exec(typ);
      const core = mm ? mm[1] : (/^\w+\??$/.test(typ) ? typ.replace(/\?$/, '') : null);
      if (core && names.has(core)) findings.push(`${path.basename(f)}:${i + 1} ${m[2]} : ${typ}`);
    }
  }
  if (findings.length > 0) groups.push({ message: rule.message, findings });
}

// catchRequires：catch 行往后、下一 catch 行之前的块体必须包含 require 子串
for (const rule of catchRules) {
  const missing = rule.files.filter((f) => !fs.existsSync(f));
  if (missing.length > 0) {
    if (rule.optional) continue;
    missingTarget(missing[0]);
  }
  const findings = [];
  for (const f of [...rule.files].sort()) {
    if (rule.excludeRes.some((re) => re.test(f))) continue;
    const lines = readLines(f);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(rule.catchMarker)) continue;
      let end = i + 1;
      while (end < lines.length && !lines[end].trim().startsWith('catch (')) end++;
      const body = lines.slice(i + 1, end).join('\n');
      if (!body.includes(rule.require)) findings.push(`${f}:${i + 1}:${lines[i].trim()}`);
    }
  }
  if (findings.length > 0) groups.push({ message: rule.message, findings });
}

if (groups.length > 0) {
  const report = groups.map((g) => `- ${g.message}：\n${g.findings.join('\n')}`).join('\n\n');
  console.error(t(`架构红线违例（${CONFIG}）：\n${report}\n`, `Architecture redline violations (${CONFIG}):\n${report}\n`));
  process.exit(1);
}
process.exit(0);
