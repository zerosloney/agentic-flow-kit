#!/usr/bin/env node
// check-audit-fields: 审计字段红线门禁（机制内建、规则外置，与 check-architecture 同一改造口径）。
// 为什么外置：哪些字段算审计字段、由谁统一写入，是各目标项目自己的约定；脚本一旦写死某个项目的
// 字段清单/豁免路径，同一道门装进别的项目就会拦住无关提交（别的 C# 项目正常给 CreatedBy 赋值也会被拦）。
// 本脚本只实现「读规则 → 扫新增行 → 报违例」的机制，规则全部来自目标项目的
// .agents/hooks/audit-fields.json（相对 git 仓库根），未配置即跳过（不误伤未使用者）。
//
// 用法：由目标项目的门禁面（flow-kit hook / pre-commit）调用；默认扫【暂存区新增行】，
//       `--range <git-range>` 扫指定范围内新增行——存量违例不拦（渐进收口）。
//
// 配置格式（JSON 对象）：
//   fields      必填非空：受保护字段名，每项须是合法标识符（因此可直接拼进正则，无需转义）。
//   ext         可选，默认 ['.cs']：扫描的文件扩展名。
//   allowFiles  可选：路径含该子串即整文件豁免（统一写入器 / 种子 / 测试 / 迁移目录等）。
//   allowLines  可选：行内含该子串即豁免（显式桥接 setter 等单源写入行）。
//   判定口径与旧写死版逐字等价：新增行命中「字段名后接 ??= 或 =（不含 ==）」且不是
//   「= xxx.同名字段」的同名拷贝（DTO 映射是读不是补写）才计违例；
//   OperatorName 这类把字段名作前缀的标识符、`==` 比较、`{ get; set; }` 声明天然不匹配。
//
// 退出码：0 = 未配置（目标项目没有审计字段守卫，不应拦人）/ 已配置且干净 / 无改动文件；
//         1 = 存在违例；或不在 git 仓库内——fail-closed，不静默放行；
//         2 = 配置本身非法（读不了 / JSON 坏 / 顶层不是对象 / 未知顶层键 / fields 缺失或为空 /
//             字段名不是合法标识符 / 数组元素不是字符串），或参数错误 / git range 无效——
//             错配必须显式暴露，不能当「未配置」放过。
// 约定：违例 / SKIP / 配置错误只写 stderr；stdout 恒为空（上层 PreToolUse 钩子按 stdout 解析 JSON，多一个字符都污染协议）。
import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { t } from '../scripts/lang.mjs';

const CONFIG = '.agents/hooks/audit-fields.json';
const KEYS = ['fields', 'ext', 'allowFiles', 'allowLines'];
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const usage = () => console.error(t(`用法: ${process.argv[1].split(/[\\/]/).pop()} [--range <git-range>]`, `Usage: ${process.argv[1].split(/[\\/]/).pop()} [--range <git-range>]`));
const args = process.argv.slice(2);
let gitRange = '';
if (args.length === 2) {
  if (args[0] !== '--range' || args[1] === '' || args[1].startsWith('-')) { usage(); process.exit(2); }
  gitRange = args[1];
} else if (args.length !== 0) { usage(); process.exit(2); }

const git = (a) => {
  const r = spawnSync('git', a, { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, out: r.stdout || '' };
};
const root = git(['rev-parse', '--show-toplevel']);
if (!root.ok) { console.error(t('check-audit-fields: 不在 git 仓库内,门禁 fail-closed,不静默放行', 'check-audit-fields: not inside a git repository; gate fails closed instead of silently passing')); process.exit(1); }
process.chdir(root.out.trim());

const skip = () => {
  console.error(t(`check-audit-fields: SKIP 未配置审计字段守卫（${CONFIG} 不存在）`, `check-audit-fields: SKIP no audit field guard configured (${CONFIG} missing)`));
  process.exit(0);
};
const failConfig = (msg) => {
  console.error(t(`check-audit-fields: 配置错误：${msg}`, `check-audit-fields: config error: ${msg}`));
  process.exit(2);
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
  if (!KEYS.includes(key)) failConfig(t(`未知顶层键「${key}」（只允许 ${KEYS.join(' / ')}）`, `unknown top-level key "${key}" (allowed: ${KEYS.join(' / ')})`));
}
// 数组字段口径与 check-architecture 一致：元素须为非空字符串；fields 必填非空，ext/allow* 缺省为空
const strArray = (key) => {
  const v = config[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || s === '')) failConfig(t(`「${key}」必须是非空字符串数组`, `"${key}" must be an array of non-empty strings`));
  return v;
};
const fields = config.fields;
if (fields === undefined) failConfig(t('缺必填字段「fields」（非空字符串数组）', 'missing required field "fields" (non-empty array of strings)'));
if (!Array.isArray(fields) || fields.length === 0) failConfig(t('「fields」必须是非空字符串数组', '"fields" must be a non-empty array of strings'));
fields.forEach((f, i) => {
  if (typeof f !== 'string' || f === '') failConfig(t('「fields」必须是非空字符串数组', '"fields" must be a non-empty array of strings'));
  if (!ID_RE.test(f)) failConfig(t(`fields[${i}]「${f}」不是合法标识符`, `fields[${i}] "${f}" is not a valid identifier`));
});
const exts = config.ext === undefined ? ['.cs'] : strArray('ext');
const allowFiles = strArray('allowFiles');
const allowLines = strArray('allowLines');
if (exts.length === 0) process.exit(0); // 显式声明「无可扫扩展名」= 没有要守的东西

// ---------- 判定正则由 fields 现拼（已校验为合法标识符，无需转义）；与旧写死版唯一的差异是加了左侧标识符边界 ----------
const alt = fields.join('|');
// 左值判定：字段名作为独立标识符出现，后接 `??=` 或 `=`（`==` 比较、`{ get; set; }` 声明天然不匹配；
// 左边界防止 `SetOperator = 1` 这类把字段名当后缀的长标识符被误报）
const auditRe = new RegExp(`(?<![A-Za-z0-9_])(${alt})\\s*(\\?\\?=|=[^=])`);
// 右值豁免：同名属性拷贝（手写 DTO 映射 `Field = x.Field` 是读不是补写审计）
const copyRe = new RegExp(`(^|[^?])=\\s*[A-Za-z0-9_.]*\\.(${alt})\\s*([;,})]|$)`);

const pathspecs = exts.map((ext) => `*${ext}`);
const names = gitRange === '' ? git(['diff', '--cached', '--name-only', '--', ...pathspecs]) : git(['diff', '--name-only', gitRange, '--', ...pathspecs]);
if (!names.ok) { console.error(t(`无效 git range: ${gitRange}`, `invalid git range: ${gitRange}`)); usage(); process.exit(2); }
if (names.out.trim() === '') process.exit(0);

const patch = gitRange === '' ? git(['diff', '--cached', '-U0', '--', ...pathspecs]) : git(['diff', '-U0', gitRange, '--', ...pathspecs]);
const hits = [];
let file = '';
for (const line of patch.out.split('\n')) {
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
  if (!/^\+[^+]/.test(line)) continue;
  const content = line.slice(1);
  if (!auditRe.test(content) || copyRe.test(content)) continue;
  if (allowFiles.some((s) => file.includes(s))) continue;
  if (allowLines.some((s) => content.includes(s))) continue;
  hits.push(`${file}:${content}`);
}
if (hits.length > 0) {
  console.error(t(`审计字段红线违例（${CONFIG}）：目标 diff 新增行手工补写受保护审计字段，应由项目的统一写入路径赋值：`, `Audit field redline violation (${CONFIG}): added lines in the target diff hand-write protected audit fields; assign them via the project's unified writer path:`));
  console.error(hits.join('\n'));
  process.exit(1);
}
process.exit(0);
