// model — 规则包模型：JSONC 读取、schema 校验、分层合并（legacy ← stack ← project ← local）、豁免。
// 设计边界（rules v1）：原语闭集，不做表达式语言；超出闭集的能力走插件。
// schema 原则「写错必报错」：每个配置对象都按契约校验——未知字段、类型不符、必填缺失一律 RULES_CONFIG。
// 拼错的键等于规则悄悄变形，所以不静默忽略；报错用 JSON 路径定位，并列出允许的键。
// `_note`（字符串）是所有对象都认的注释键。
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonc } from './jsonc.mjs';

export const FACES = ['ui', 'code', 'tests', 'data', 'any'];
export const PHASES = ['pre-commit', 'pre-write', 'pre-push', 'verify', 'local', 'always'];
export const SEVERITIES = ['block', 'warn'];
export const SCOPES = ['repo', 'diff'];
export const ASSERT_KINDS = ['content', 'require', 'absence', 'inventory', 'env', 'command', 'navProperties', 'plugin'];

export class RulesConfigError extends Error {
  constructor(message) {
    super(message);
    this.code = 'RULES_CONFIG';
  }
}

const fail = (at, reason) => {
  throw new RulesConfigError(`${at} ${reason}`);
};
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isStrs = (v) => Array.isArray(v) && v.every(isStr);
const isPosInt = (v) => Number.isInteger(v) && v > 0;
const isExitCode = (v) => Number.isInteger(v) && v >= 0;
const regexError = (v) => {
  if (!isStr(v)) return null;
  try {
    new RegExp(v);
    return null;
  } catch (e) {
    return e.message;
  }
};
const isDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const time = new Date(`${v}T00:00:00Z`).getTime();
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === v;
};

// ── 字段契约 ──────────────────────────────────────────────────────────────
// 字段 = { ok, what, enumList?, required?, need?, why?, spec?, item? }：
//   ok 判类型；enumList 让枚举报「x 非法（…）」；required + need 给必填缺失文案；
//   why 给出比「必须是…」更具体的失败原因；spec 是对象的字段契约；item 是数组元素的类型。
const type = (what, ok, extra = {}) => ({ what, ok, ...extra });
const oneOf = (list) => type(list.join(' / '), (v) => list.includes(v), { enumList: true });
const listOf = (item, what, nonEmpty = false) => type(what, (v) => Array.isArray(v) && v.every(item.ok) && (!nonEmpty || v.length > 0), { item });
// mustBe 是「不是对象」时的整句文案（如「必须是 {zh,en}」）。
const shape = (spec, mustBe = '必须是对象') => type(mustBe, isObj, { spec, why: () => mustBe });
// 只要求是对象、不限键（调用方另行逐项校验，或键本就自由——如插件 config）。
const plainObj = type('对象', isObj, { why: () => '必须是对象' });
const req = (field, need) => ({ ...field, required: true, need });

const T = {
  str: type('非空字符串', isStr),
  strs: type('字符串数组', isStrs),
  strs1: type('非空字符串数组', (v) => isStrs(v) && v.length > 0),
  bool: type('布尔值', (v) => typeof v === 'boolean'),
  regex: type('合法的正则字符串', (v) => isStr(v) && regexError(v) === null, {
    why: (v) => (isStr(v) ? `正则非法（${regexError(v)}）` : '必须是合法的正则字符串'),
  }),
  id: type('规则 id（小写字母 / 数字 / . _ -）', (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(v)),
  module: type('插件模块名（字母 / 数字 / . _ -）', (v) => typeof v === 'string' && /^[A-Za-z0-9._-]+$/.test(v)),
  date: type('日期字符串（YYYY-MM-DD）', isDate),
  env: type('对象（值为字符串 / 数字 / 布尔）', (v) => isObj(v) && Object.values(v).every((x) => ['string', 'number', 'boolean'].includes(typeof x))),
  expectExit: type('非负整数或非空的非负整数数组', (v) => isExitCode(v) || (Array.isArray(v) && v.length > 0 && v.every(isExitCode))),
  // null = 显式不限时（缺省则用原语自己的默认上限）。
  timeout: type('正整数（毫秒）或 null（不限时）', (v) => v === null || isPosInt(v)),
};

const MESSAGE_SPEC = { zh: req(T.str, '必须是 {zh,en}'), en: req(T.str, '必须是 {zh,en}') };
const FILES_SPEC = { ext: T.strs, prefix: T.strs1, glob: T.strs1, exclude: T.strs };
const ASSERT_SPEC = {
  kind: req({ ...oneOf(ASSERT_KINDS) }, '必须是 {kind,args}'),
  // args 的键随原语不同，由 validateArgs 按 ARGS_SPEC 逐项校验。
  args: req(plainObj),
};
const RULE_SPEC = {
  id: req(T.id, '缺失或不合规（[a-z0-9._-]）'),
  face: req(oneOf(FACES)),
  phase: req(oneOf(PHASES)),
  severity: req(oneOf(SEVERITIES)),
  scope: oneOf(SCOPES),
  // when 必须非空：空数组在旧脚本里是「永不启用」，语义含糊——要么写条件，要么别声明。
  when: T.strs1,
  whenEnv: T.str,
  files: shape(FILES_SPEC),
  assert: req(shape(ASSERT_SPEC, '必须是 {kind,args}')),
  message: req(shape(MESSAGE_SPEC, '必须是 {zh,en}')),
  enabled: T.bool,
  timeoutMs: T.timeout,
};
const ALLOW_SPEC = { glob: req(T.str), pattern: T.regex };
const SCAN_SPEC = { dir: req(T.str), ext: T.strs, call: T.regex, ignore: T.regex, optional: T.bool };
const WAIVER_SPEC = {
  rule: req(T.id),
  glob: T.str,
  // 豁免带到期与审计：没有到期日 / 理由的豁免就是永久且不可追溯的放行。
  expires: req(T.date),
  reason: req(T.str),
};
const PLUGIN_SPEC = {
  id: req(T.id, '缺失或不合规'),
  module: req(T.module, '缺失或不合规'),
  face: req(oneOf(FACES)),
  phase: req(oneOf(PHASES)),
  severity: oneOf(SEVERITIES),
  // 插件跑在提交路径上，必须有时限：只收正整数。
  timeoutMs: type('正整数（毫秒）', isPosInt),
  // config 是插件自己的契约，键不限。
  config: plainObj,
  message: shape(MESSAGE_SPEC, '必须是 {zh,en}'),
};
const LAYER_SPEC = {
  version: type('1', (v) => v === 1, { why: (v) => `不支持的 version ${v}（v1 只认 1）` }),
  faces: shape({ ui: T.strs, code: T.strs, tests: T.strs, data: T.strs }),
  // 三个数组的元素随后逐条校验（rules / waivers / plugins），这里只验形状。
  rules: listOf(plainObj, '对象数组'),
  waivers: listOf(plainObj, '对象数组'),
  plugins: listOf(plainObj, '对象数组'),
};

// 各原语的 args 契约（闭集；未列出的键一律报错）。与 .agents/notes/project-configs.md「原语参考」一节对应，
// tests/rules-parity-static.test.mjs 对拍两边（改这里忘了改文档会红）。
const ARGS_SPEC = {
  content: {
    targets: T.strs1, files: T.strs1, ext: T.strs, contains: T.strs1, matches: listOf(T.regex, '正则字符串数组'),
    pattern: T.regex, unless: T.regex, exclude: T.strs,
    allow: listOf(shape(ALLOW_SPEC, '对象'), '对象数组'),
    allowFiles: T.strs, allowLines: T.strs, copyPattern: T.regex, optional: T.bool, once: T.bool,
  },
  require: {
    files: req(T.strs1, '缺少必填字段「files」（精确路径或 glob 数组）'),
    ext: T.strs,
    trigger: req(T.str),
    require: req(T.str),
    exclude: T.strs,
    optional: T.bool,
  },
  absence: { glob: req(T.str), unless: T.strs },
  inventory: {
    scan: req(listOf(shape(SCAN_SPEC, '必须是对象'), '非空的对象数组', true), '缺少必填字段「scan」'),
    baseline: req(T.str, '缺少必填字段「baseline」（豁免清单路径）'),
  },
  env: { name: req(T.str), forbiddenValues: T.strs },
  navProperties: { dir: req(T.str), extraTypeNames: T.strs, optional: T.bool },
  command: {
    run: req(T.str), cwd: T.str, env: T.env, lockPattern: T.regex, lockHint: T.str, name: T.str,
    deps: T.strs1, expectExit: T.expectExit,
  },
  plugin: { module: req(T.module, '缺失或不合规（.agents/rules/plugins/<module>.mjs）'), config: plainObj },
};
/** 文档对拍用：各原语的 args 键，以及数组元素对象的键（schema 加了键而文档没跟上会红）。 */
export const ARG_KEYS = Object.fromEntries(Object.entries(ARGS_SPEC).map(([kind, spec]) => [kind, Object.keys(spec)]));
export const ARG_ITEM_KEYS = { 'inventory.scan': Object.keys(SCAN_SPEC), 'content.allow': Object.keys(ALLOW_SPEC) };
// content 的两种作用域各读各的键：写了另一作用域才读的键，规则不会按作者设想生效——报错而不是静默忽略。
const CONTENT_REPO_ONLY = ['targets', 'files', 'contains', 'matches', 'unless', 'exclude', 'allow', 'optional', 'once'];
const CONTENT_DIFF_ONLY = ['copyPattern', 'allowFiles', 'allowLines'];

/** 按契约校验一个对象；at = 该对象的 JSON 路径（报错定位用）。 */
function checkObject(obj, spec, at) {
  if (!isObj(obj)) fail(at, '必须是对象');
  const allowed = Object.keys(spec);
  for (const key of Object.keys(obj)) {
    if (key === '_note') {
      if (typeof obj[key] !== 'string') fail(`${at}._note`, '必须是字符串（注释键）');
    } else if (!allowed.includes(key)) {
      fail(at, `未知字段「${key}」（允许：${allowed.join(' / ')} / _note）`);
    }
  }
  for (const [key, field] of Object.entries(spec)) {
    const value = obj[key];
    if (value === undefined) {
      if (field.required) fail(at, field.need || `缺少必填字段「${key}」`);
      continue;
    }
    const where = `${at}.${key}`;
    if (!field.ok(value)) {
      const index = field.item && Array.isArray(value) ? value.findIndex((x) => !field.item.ok(x)) : -1;
      if (index >= 0) {
        const item = field.item;
        fail(`${where}[${index}]`, item.why ? item.why(value[index]) : `必须是${item.what}`);
      }
      fail(where, field.why ? field.why(value) : field.enumList ? `非法（${field.what}）` : `必须是${field.what}`);
    }
    if (field.spec) checkObject(value, field.spec, where);
    if (field.item && field.item.spec) value.forEach((entry, i) => checkObject(entry, field.item.spec, `${where}[${i}]`));
  }
}

function validateArgs(kind, args, at, rule) {
  const spec = ARGS_SPEC[kind];
  if (!spec) fail(`${at}.assert.kind`, `非法（${ASSERT_KINDS.join(' / ')}）`);
  const where = `${at}.assert.args`;
  checkObject(args, spec, where);
  if (kind !== 'content') return;
  const scope = rule.scope || 'repo';
  const stray = (scope === 'diff' ? CONTENT_REPO_ONLY : CONTENT_DIFF_ONLY).filter((key) => args[key] !== undefined);
  if (stray.length) {
    fail(where, `「${stray.join('、')}」只在 ${scope === 'diff' ? 'repo' : 'diff'} 作用域生效（本规则 scope 为 ${scope}）`);
  }
  const hasTargets = args.targets !== undefined || args.files !== undefined;
  if (scope === 'diff' && args.pattern === undefined) fail(where, 'diff 作用域的 content 必须配 pattern');
  if (scope === 'repo') {
    if (!hasTargets) fail(where, 'repo 作用域的 content 必须配 targets 或 files（只配 pattern 的 diff 模式请把 scope 设为 diff）');
    if (args.contains === undefined && args.matches === undefined && args.pattern === undefined) {
      fail(where, '缺少 pattern / contains / matches 之一');
    }
  }
}

export function validateRule(rule, at) {
  if (!isObj(rule)) fail(at, '规则必须是对象');
  // 只读禁用条目：{ id, enabled: false } 即可，无需复制整条规则（覆盖层最常见的用法）。
  if (rule.enabled === false) {
    const extra = Object.keys(rule).filter((k) => !['id', 'enabled', '_note'].includes(k));
    if (extra.length) fail(at, `禁用条目只允许 id/enabled，其他字段请删掉（多余：${extra.join(', ')}）`);
    checkObject(rule, { id: RULE_SPEC.id, enabled: T.bool }, at);
    return rule;
  }
  checkObject(rule, RULE_SPEC, at);
  const kind = rule.assert.kind;
  if (rule.scope === 'diff' && kind !== 'content') fail(`${at}.scope`, 'diff 作用域只对 content 有意义（其余原语不读它）');
  if (rule.timeoutMs !== undefined) {
    if (kind !== 'command' && kind !== 'plugin') fail(`${at}.timeoutMs`, '仅适用于 command / plugin 规则');
    if (kind === 'plugin' && rule.timeoutMs === null) fail(`${at}.timeoutMs`, '插件必须有时限：只能是正整数（null 仅 command 可用）');
  }
  validateArgs(kind, rule.assert.args, at, rule);
  return rule;
}

export function readRulesFile(root, rel) {
  const abs = path.join(root, rel);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new RulesConfigError(`${rel}: 读取失败（${e.message}）`);
  }
  const data = parseJsonc(text, rel);
  if (!isObj(data)) throw new RulesConfigError(`${rel}: 顶层必须是对象`);
  return data;
}

/** 读取一层规则文件：{version, faces?, rules?, waivers?, plugins?}。 */
export function loadLayer(root, rel, name) {
  const data = readRulesFile(root, rel);
  if (!data) return null;
  checkObject(data, LAYER_SPEC, rel);
  const rules = data.rules || [];
  const waivers = data.waivers || [];
  const plugins = data.plugins || [];
  rules.forEach((rule, i) => validateRule(rule, `${rel}: rules[${i}]`));
  waivers.forEach((w, i) => checkObject(w, WAIVER_SPEC, `${rel}: waivers[${i}]`));
  plugins.forEach((p, i) => checkObject(p, PLUGIN_SPEC, `${rel}: plugins[${i}]`));
  return { name, rules, waivers, faces: isObj(data.faces) ? data.faces : {}, plugins };
}

/** 分层合并：同 id 后者整条替换；faces 按键替换；waivers 追加（同 rule+glob 后者覆盖）。 */
export function mergeLayers(layers) {
  const byId = new Map();
  const faces = {};
  const waivers = new Map();
  const provenance = new Map();
  for (const layer of layers || []) {
    if (!layer) continue;
    for (const [key, list] of Object.entries(layer.faces || {})) faces[key] = [...list];
    for (const rule of layer.rules) {
      byId.set(rule.id, rule);
      provenance.set(rule.id, layer.name);
    }
    // 插件条目（可选）折算成 plugin 规则：列表是「显式白名单」，不自动加载目录。
    for (const p of layer.plugins || []) {
      byId.set(p.id, {
        id: p.id,
        face: p.face,
        phase: p.phase,
        severity: p.severity || 'warn',
        scope: 'repo',
        assert: { kind: 'plugin', args: { module: p.module, ...(p.config !== undefined ? { config: p.config } : {}) } },
        message: p.message || { zh: p.id, en: p.id },
        ...(p.timeoutMs !== undefined ? { timeoutMs: p.timeoutMs } : {}),
      });
      provenance.set(p.id, layer.name);
    }
    for (const w of layer.waivers) {
      waivers.set(`${w.rule}::${w.glob || '*'}`, w);
    }
  }
  const rules = [...byId.values()].map((rule) => ({ ...rule, source: provenance.get(rule.id) }));
  return { faces, rules, waivers: [...waivers.values()] };
}

/** 过滤过期豁免；返回 { active, expired }。 */
export function splitWaivers(waivers, today = new Date()) {
  const iso = today.toISOString().slice(0, 10);
  const active = [];
  const expired = [];
  for (const w of waivers) {
    if (w.expires && w.expires < iso) expired.push(w);
    else active.push(w);
  }
  return { active, expired };
}
