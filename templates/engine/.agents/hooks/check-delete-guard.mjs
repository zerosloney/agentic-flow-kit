#!/usr/bin/env node
// 删除拦截门禁：声明目录内新增删除调用必须登记 allowlist 并配防复发用例。
// 为什么配置驱动：各技术栈的目录结构、源码后缀、删除 API 各不相同，包内写死任何具体路径
// 都会把单个项目的登记口径随包分发给所有安装方——改为项目级 .agents/hooks/delete-guard.json
// 声明扫描范围与命中口径（dir/ext/call/ignore），未声明的项目自动跳过（不误伤未使用者）。
// 背景：2026-09-11 评审发现 6 处删除拦截存量缺口（incident 2026-09-11-masterdata-delete-interception-gaps），
// 根因门禁缺位——本脚本做「新增删除路径须显式登记」的触发式审查；守卫正确性由防复发用例保证。
// 用法：check-delete-guard.mjs [--update]
// 自 check-delete-guard.sh 移植 node（2026-10-08 门禁去 sh 化第二批）——语义逐条对齐：
// 按文件聚合计数（行号漂移不误报）、一行命中 = call 匹配且 ignore 不匹配、posix 相对路径、字典序对齐 sh sort。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { t } from '../scripts/lang.mjs';

const SCRIPT_DIR = path.dirname(process.argv[1]);
const ROOT = path.resolve(process.env.FLOW_KIT_PROJECT_ROOT || path.join(SCRIPT_DIR, '..', '..'));
const CONFIG = path.join(ROOT, '.agents', 'hooks', 'delete-guard.json');
const ALLOWLIST = path.join(ROOT, '.agents', 'hooks', 'delete-guard-allowlist.txt');
const RULE_KEYS = new Set(['dir', 'ext', 'call', 'ignore']);
const DEFAULTS = { ext: ['.cs'], call: '\\.(Remove|RemoveRange)\\(', ignore: '_cache\\.Remove\\(' };

function configError(reason) {
  console.error(t(`❌ 删除拦截门禁：.agents/hooks/delete-guard.json 配置无效——${reason}`, `❌ Delete guard: invalid .agents/hooks/delete-guard.json config — ${reason}`, ROOT));
  process.exit(2);
}

function compileRegExp(pattern, field, dir) {
  try {
    return new RegExp(pattern);
  } catch (e) {
    configError(t(`「${dir}」的 ${field} 正则非法：${e.message}`, `invalid ${field} regex for "${dir}": ${e.message}`, ROOT));
  }
}

// 返回规范化规则数组；配置文件不存在返回 null（唯一视为「未配置」的情形，门禁跳过），
// 其余配置问题一律 fail-loud exit 2——配置写错静默放行等于门禁失守。
function loadRules() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    configError(t(`读取失败：${e.message}`, `read failed: ${e.message}`, ROOT));
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    configError(t(`不是合法 JSON：${e.message}`, `not valid JSON: ${e.message}`, ROOT));
  }
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) configError(t('顶层须为对象，含 scan 数组', 'top level must be an object containing a scan array', ROOT));
  const unknown = Object.keys(cfg).filter((k) => k !== 'scan');
  if (unknown.length > 0) configError(t(`未知键：${unknown.join('、')}（只认 scan）`, `unknown keys: ${unknown.join(', ')} (only "scan" is allowed)`, ROOT));
  if (!Array.isArray(cfg.scan) || cfg.scan.length === 0) configError(t('scan 缺失或为空数组：至少声明一条 { dir } 规则', 'scan missing or empty: declare at least one { dir } rule', ROOT));
  return cfg.scan.map((rule, i) => {
    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) configError(t(`scan[${i}] 须为对象`, `scan[${i}] must be an object`, ROOT));
    const unknownRule = Object.keys(rule).filter((k) => !RULE_KEYS.has(k));
    if (unknownRule.length > 0) configError(t(`scan[${i}] 含未知键：${unknownRule.join('、')}（只认 dir/ext/call/ignore）`, `scan[${i}] has unknown keys: ${unknownRule.join(', ')} (only dir/ext/call/ignore)`, ROOT));
    if (typeof rule.dir !== 'string' || rule.dir.trim() === '') configError(t(`scan[${i}] 缺 dir（必填，相对项目根）`, `scan[${i}]: missing dir (required, relative to project root)`, ROOT));
    const ext = rule.ext === undefined ? DEFAULTS.ext : rule.ext;
    if (!Array.isArray(ext) || ext.some((x) => typeof x !== 'string' || x === '')) configError(t(`「${rule.dir}」的 ext 须为非空字符串数组`, `"${rule.dir}": ext must be an array of non-empty strings`, ROOT));
    for (const f of ['call', 'ignore']) {
      if (rule[f] !== undefined && typeof rule[f] !== 'string') configError(t(`「${rule.dir}」的 ${f} 须为字符串`, `"${rule.dir}": ${f} must be a string`, ROOT));
    }
    return {
      declared: rule.dir,
      abs: path.resolve(ROOT, rule.dir),
      ext,
      call: compileRegExp(rule.call === undefined ? DEFAULTS.call : rule.call, 'call', rule.dir),
      ignore: compileRegExp(rule.ignore === undefined ? DEFAULTS.ignore : rule.ignore, 'ignore', rule.dir),
    };
  });
}

const rules = loadRules();
if (rules === null) {
  console.log(t('SKIP: 删除拦截门禁未配置扫描目录（.agents/hooks/delete-guard.json）', 'SKIP: delete guard has no scan directories configured (.agents/hooks/delete-guard.json)', ROOT));
  process.exit(0);
}

const counts = new Map();
for (const rule of rules) {
  if (!fs.existsSync(rule.abs) || !fs.statSync(rule.abs).isDirectory()) {
    console.error(t(`声明扫描目录不存在：${rule.declared}`, `declared scan directory not found: ${rule.declared}`, ROOT));
    continue;
  }
  const base = path.basename(rule.abs);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (rule.ext.some((x) => e.name.endsWith(x))) {
        let n = 0;
        for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
          if (rule.call.test(line) && !rule.ignore.test(line)) n++;
        }
        if (n > 0) counts.set(`${base}/${path.relative(rule.abs, p).replace(/\\/g, '/')}`, n);
      }
    }
  };
  walk(rule.abs);
}
const current = [...counts.entries()].map(([f, n]) => `${f} ${n}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

if (process.argv[2] === '--update') {
  fs.writeFileSync(ALLOWLIST, current.join('\n') + '\n');
  console.log(t(`删除拦截 allowlist 已更新：${ALLOWLIST}`, `Delete guard allowlist updated: ${ALLOWLIST}`, ROOT));
  process.exit(0);
}

if (!fs.existsSync(ALLOWLIST)) {
  console.error(t(`❌ 删除拦截门禁：缺少 ${ALLOWLIST}（首次请跑 check-delete-guard.mjs --update 生成并人工核对全部删除调用点已配守卫；扫描范围由 .agents/hooks/delete-guard.json 声明）`, `❌ Delete guard: missing ${ALLOWLIST} (first run check-delete-guard.mjs --update, then verify every delete call site has a guard; scan scope is declared by .agents/hooks/delete-guard.json)`, ROOT));
  process.exit(1);
}

const listed = fs.readFileSync(ALLOWLIST, 'utf8').replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
const same = current.length === listed.length && current.every((l, i) => l === listed[i]);
if (same) {
  console.log(t('删除拦截门禁通过：删除调用点与登记一致', 'Delete guard passed: delete call sites match the allowlist', ROOT));
  process.exit(0);
}
console.error(t('❌ 删除拦截门禁：删除调用点与 .agents/hooks/delete-guard-allowlist.txt 不一致（扫描范围由 .agents/hooks/delete-guard.json 声明）', '❌ Delete guard: delete call sites do not match .agents/hooks/delete-guard-allowlist.txt (scan scope is declared by .agents/hooks/delete-guard.json)', ROOT));
console.error(t('—— 新增删除路径必须：1) 删前查引用，被引用时拒绝删除并返回明确错误', '-- New delete paths must: 1) check references before deleting; refuse with an explicit error when still referenced', ROOT));
console.error(t('   2) 配防复发用例（删除被引用 → 断言被拒） 3) 确认无误后跑 check-delete-guard.mjs --update 更新登记', '   2) add a regression test (deleting a referenced target is rejected) 3) after confirming, run check-delete-guard.mjs --update to refresh the allowlist', ROOT));
for (const l of current) if (!listed.includes(l)) console.error(`< ${l}`);
for (const l of listed) if (!current.includes(l)) console.error(`> ${l}`);
process.exit(1);
