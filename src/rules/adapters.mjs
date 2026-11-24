// adapters — 旧配置 → rules 模型投影（v1 兼容层）。
// 旧文件仍是权威：`rules check` 是唯一的执法路径（pre-commit / verify 都走它），旧脚本保留作手动复核。
// 口径：适配器只认旧脚本认的键。旧脚本的顶层校验是严格的（未知顶层键 exit 2），条目里拼错的键则被静默忽略；
// 这里一律点名报错——拼错的键等于规则悄悄变形。`_note`（字符串）是所有层级都认的注释键。
// 字段类型与正则合法性不在这里重复：投影出的规则必须过 model 的 validateRule（schema 单源）。
// 不投影（判定过的，不是缺口）：lane-surfaces.txt（L2 触达面正则清单，判定依赖 diff 范围与协伴入口文档，
// 由 check-lane-surface.mjs 消费 = verify 内置门 lane-surface-ci）、workflow-modules.txt（workflow 文档模块
// 词表，fill-intent / pipeline-run / gen-workflow-index / kb-search 共读）——与 test-impact-map 同类：
// 是选择器 / 词表而不是规则，各脚本继续读文本清单。
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonc } from './jsonc.mjs';
import { readRulesFile, RulesConfigError } from './model.mjs';

const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const msg = (zh) => ({ zh, en: zh });
const bad = (at, why) => {
  throw new RulesConfigError(`${at}: ${why}`);
};

/** 去掉 undefined 与空数组：schema 对「声明了就必须非空」的字段（targets / contains 等）当真，缺省就别声明。 */
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));

/** 旧配置对象校验（顶层 / 条目通用）：未知键点名；`_note` 放行；required 逐项要求非空字符串，requiredArrays 要求非空字符串数组。 */
function legacyKeys(obj, allowed, at, { required = [], requiredArrays = [], label = '' } = {}) {
  if (!isObj(obj)) bad(at, `${label}必须是对象`);
  if (obj._note !== undefined && typeof obj._note !== 'string') bad(at, '_note 必须是字符串（注释键）');
  const unknown = Object.keys(obj).filter((k) => k !== '_note' && !allowed.includes(k));
  if (unknown.length) bad(at, `${label}未知字段「${unknown.join('、')}」（只认 ${allowed.join(' / ')} / _note）`);
  for (const key of required) {
    if (!isStr(obj[key])) bad(at, `${label}缺必填字段「${key}」（非空字符串）`);
  }
  for (const key of requiredArrays) {
    const value = obj[key];
    if (!Array.isArray(value) || !value.length || value.some((s) => !isStr(s))) bad(at, `${label}「${key}」必须是非空字符串数组`);
  }
  return obj;
}

/** 项目面配置 → faces（与 faces.mjs 同口径；合法性由 faces.mjs 把关，这里只取值供插件 ctx 用）。 */
function adaptFaces(root) {
  const data = readRulesFile(root, '.agents/config/project-faces.json');
  if (!data) return {};
  return { ui: arr(data.ui), code: arr(data.code), tests: arr(data.tests), data: arr(data.data) };
}

const ARCH_FILE = '.agents/hooks/architecture-redlines.json';
// 与旧 check-architecture 同口径：id 全文件唯一、只含 [a-z0-9-]；三个分节各自的字段闭集。
const ARCH_ID_RE = /^[a-z0-9-]+$/;
const ARCH_SECTIONS = [
  { key: 'forbidden', prefix: 'arch', kind: 'content', keys: ['id', 'targets', 'message', 'contains', 'matches', 'unless', 'exclude', 'ext', 'optional', 'once'], required: ['message'], requiredArrays: ['targets'] },
  { key: 'noNavigationProperties', prefix: 'arch.nav', kind: 'navProperties', keys: ['id', 'dir', 'message', 'extraTypeNames', 'optional'], required: ['dir', 'message'] },
  { key: 'catchRequires', prefix: 'arch.catch', kind: 'require', keys: ['id', 'files', 'catch', 'require', 'message', 'exclude', 'optional'], required: ['catch', 'require', 'message'], requiredArrays: ['files'] },
];
const ARCH_ARGS = {
  content: (e) => ({ targets: e.targets, ext: e.ext, contains: e.contains, matches: e.matches, unless: e.unless, exclude: e.exclude, optional: e.optional, once: e.once }),
  navProperties: (e) => ({ dir: e.dir, extraTypeNames: e.extraTypeNames, optional: e.optional }),
  require: (e) => ({ files: e.files, trigger: e.catch, require: e.require, exclude: e.exclude, optional: e.optional }),
};

/** 架构红线：forbidden → content；catchRequires → require；noNavigationProperties → navProperties。 */
function adaptArchitecture(root, rules) {
  const data = readRulesFile(root, ARCH_FILE);
  if (!data) return;
  legacyKeys(data, ARCH_SECTIONS.map((s) => s.key), ARCH_FILE, { label: '顶层' });
  const seen = new Set();
  for (const section of ARCH_SECTIONS) {
    const list = data[section.key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) bad(`${ARCH_FILE}: ${section.key}`, '必须是数组');
    list.forEach((entry, i) => {
      const at = `${ARCH_FILE}: ${section.key}[${i}]`;
      legacyKeys(entry, [...section.keys], at, { required: ['id', ...section.required], requiredArrays: section.requiredArrays });
      if (!ARCH_ID_RE.test(entry.id)) bad(at, '「id」缺失或不符合 [a-z0-9-]');
      // 漏写 / 重复的 id 会被投影成同一条规则并在合并时互相顶掉——必须在这里拦下。
      if (seen.has(entry.id)) bad(at, `「id」${entry.id} 重复（要求全文件唯一）`);
      seen.add(entry.id);
      rules.push({
        id: `${section.prefix}.${entry.id}`,
        face: 'code',
        phase: 'pre-commit',
        severity: 'block',
        scope: 'repo',
        assert: { kind: section.kind, args: compact(ARCH_ARGS[section.kind](entry)) },
        message: msg(entry.message),
      });
    });
  }
}

const DELETE_FILE = '.agents/hooks/delete-guard.json';

/** 删除守卫：scan[] + allowlist 精确比对 → inventory。 */
function adaptDeleteGuard(root, rules) {
  const data = readRulesFile(root, DELETE_FILE);
  if (!data) return;
  legacyKeys(data, ['scan'], DELETE_FILE, { label: '顶层' });
  // 旧脚本口径：文件在但 scan 缺失或为空 = 配置错误，不是「未配置」（未配置 = 没有这个文件）。
  if (!Array.isArray(data.scan) || !data.scan.length) bad(DELETE_FILE, 'scan 缺失或为空：至少声明一条 { dir }（不需要删除守卫请删除本文件）');
  data.scan.forEach((entry, i) => legacyKeys(entry, ['dir', 'ext', 'call', 'ignore'], `${DELETE_FILE}: scan[${i}]`, { required: ['dir'] }));
  rules.push({
    id: 'delete.call-sites',
    face: 'code',
    phase: 'pre-commit',
    severity: 'block',
    scope: 'repo',
    assert: { kind: 'inventory', args: { scan: data.scan, baseline: '.agents/hooks/delete-guard-allowlist.txt' } },
    message: msg('删除调用点与 .agents/hooks/delete-guard-allowlist.txt 不一致'),
  });
}

const AUDIT_FILE = '.agents/hooks/audit-fields.json';
const FIELD_ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 审计字段：diff 新增行手写受保护字段 → content(scope=diff)。 */
function adaptAuditFields(root, rules) {
  const data = readRulesFile(root, AUDIT_FILE);
  if (!data) return;
  legacyKeys(data, ['fields', 'ext', 'allowFiles', 'allowLines'], AUDIT_FILE, { label: '顶层' });
  if (!Array.isArray(data.fields) || !data.fields.length) bad(AUDIT_FILE, 'fields 缺失或为空（不需要审计字段守卫请删除本文件）');
  data.fields.forEach((field, i) => {
    // 字段名直接拼进正则：必须是标识符，否则守卫要么报错要么静默变形。
    if (typeof field !== 'string' || !FIELD_ID_RE.test(field)) bad(`${AUDIT_FILE}: fields[${i}]`, '必须是合法字段名（字母 / 数字 / 下划线，不以数字开头）');
  });
  const alt = data.fields.join('|');
  // ext / allowFiles / allowLines 原值透传：类型交给 schema（旧 check-audit-fields 的 strArray 同口径），不悄悄归零。
  const ext = data.ext === undefined ? ['.cs'] : data.ext;
  rules.push({
    id: 'audit.protected-fields',
    face: 'code',
    phase: 'pre-commit',
    severity: 'block',
    scope: 'diff',
    files: { ext },
    assert: {
      kind: 'content',
      args: compact({
        ext,
        pattern: `(?<![A-Za-z0-9_])(${alt})\\s*(\\?\\?=|=[^=])`,
        copyPattern: `(^|[^?])=\\s*[A-Za-z0-9_.]*\\.(${alt})\\s*([;,})]|$)`,
        allowFiles: data.allowFiles,
        allowLines: data.allowLines,
      }),
    },
    message: msg('审计字段红线：diff 新增行手工补写受保护审计字段，应走项目的统一写入路径'),
  });
}

const LOCAL_GATES_FILE = '.agents/config/local-gates.json';

/** 上岗自检：testDb → env（phase=local：只在 rules check --phase local / 自检面执行，不进提交门）。 */
function adaptLocalGates(root, rules) {
  const data = readRulesFile(root, LOCAL_GATES_FILE);
  if (!data || data.testDb === undefined) return;
  // local-gates.json 还被 check-local-gates / verify 等脚本读：只校验投影进规则的 testDb 段，其余顶层键不归这里管。
  const testDb = legacyKeys(data.testDb, ['env', 'forbiddenDatabases'], `${LOCAL_GATES_FILE}: testDb`, { required: ['env'] });
  rules.push({
    id: 'local.test-db-env',
    face: 'any',
    phase: 'local',
    severity: 'block',
    scope: 'repo',
    assert: { kind: 'env', args: { name: testDb.env, forbiddenValues: testDb.forbiddenDatabases } },
    message: msg(`${testDb.env} 必须已设置且不指向禁用库`),
  });
}

/** 通知守卫：配置存在用配置，否则用与 check-notify-guard.mjs 一致的内建默认；坏配置 fail-closed（exit 2）。 */
export const NOTIFY_DEFAULTS = {
  targets: ['frontend/src'],
  ext: ['.vue', '.ts'],
  pattern: 'message\\.(error|warning|warn|info)\\s*\\(',
  allowFiles: ['frontend/src/utils/notify.ts'],
};
const NOTIFY_FILE = '.agents/hooks/notify-guard.json';

function adaptNotifyGuard(root, rules) {
  const data = readRulesFile(root, NOTIFY_FILE);
  const cfg = data && typeof data === 'object' ? data : {};
  const strict = (key) => {
    const v = cfg[key];
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || s === '')) bad(NOTIFY_FILE, `「${key}」必须是非空字符串数组`);
    return v;
  };
  if (data) {
    legacyKeys(data, ['targets', 'ext', 'pattern', 'allowFiles'], NOTIFY_FILE, { label: '顶层' });
    if (data.pattern !== undefined && !isStr(data.pattern)) bad(NOTIFY_FILE, '「pattern」必须是非空字符串');
  }
  const targets = strict('targets').length ? strict('targets') : NOTIFY_DEFAULTS.targets;
  const ext = strict('ext').length ? strict('ext') : NOTIFY_DEFAULTS.ext;
  const allowFiles = strict('allowFiles').length ? strict('allowFiles') : NOTIFY_DEFAULTS.allowFiles;
  const pattern = isStr(cfg.pattern) ? cfg.pattern : NOTIFY_DEFAULTS.pattern;
  try {
    new RegExp(pattern);
  } catch (e) {
    bad(NOTIFY_FILE, `「pattern」正则非法（${e.message}）`);
  }
  rules.push({
    id: 'notify.message-guard',
    face: 'ui',
    phase: 'pre-commit',
    severity: 'block',
    scope: 'repo',
    assert: {
      kind: 'content',
      args: { targets, ext, pattern, unless: '^\\s*(?://|\\*|/\\*)', allow: allowFiles.map((glob) => ({ glob })), optional: true },
    },
    message: msg('前端禁止直接调用 antd message.error/warning/info：一律经统一 notify.* 出口'),
  });
}

// when 与 whenEnv 是两道独立的门（旧 commit-check 语义）：when 数组内 OR；whenEnv 是 AND 门槛，
// 不满足时规则不启用（也不打印）；畸形 whenEnv（缺「=」）同样不启用——推送门宁可少跑不误拦。
// when 接受字符串或字符串数组（旧 whenSatisfied 同口径），这里统一成数组交给 schema。
const whenOf = (when) => (when === undefined ? undefined : (Array.isArray(when) ? [...when] : [when]));
const whenEnvOf = (value) => (value == null ? undefined : String(value));

const CC_FILE = '.agents/hooks/commit-check.config.json';
const CC_ENTRY_KEYS = ['name', 'command', 'ext', 'prefix', 'cwd', 'when', 'whenEnv', 'timeoutMs', 'lockPattern', 'lockHint'];
const CC_GROUPS = [
  { key: 'builds', phase: 'pre-commit', prefix: 'commit.build', exclude: ['.agents/', '.githooks/'] },
  { key: 'checks', phase: 'pre-commit', prefix: 'commit.check', exclude: ['.githooks/'] },
  { key: 'pushTests', phase: 'pre-push', prefix: 'commit.push', exclude: ['.agents/', '.githooks/'] },
];

/** 提交 / 推送门 → command 规则（命令、触发面、时限原样保留）。 */
function adaptCommitCheck(root, rules) {
  const cc = readRulesFile(root, CC_FILE);
  if (!cc) return;
  legacyKeys(cc, CC_GROUPS.map((g) => g.key), CC_FILE, { label: '顶层' });
  for (const group of CC_GROUPS) {
    const list = cc[group.key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) bad(`${CC_FILE}: ${group.key}`, '必须是数组');
    list.forEach((entry, i) => {
      const at = `${CC_FILE}: ${group.key}[${i}]`;
      legacyKeys(entry, CC_ENTRY_KEYS, at, { required: ['command'] });
      // 触发面：ext 只认非空字符串数组（字符串形式旧脚本同样是忽略的，这里点名而不是静默全量触发）；prefix 字符串或字符串数组。
      if (entry.ext !== undefined && (!Array.isArray(entry.ext) || !entry.ext.length || entry.ext.some((s) => !isStr(s)))) bad(at, '「ext」必须是非空字符串数组');
      const prefixes = entry.prefix === undefined ? [] : (Array.isArray(entry.prefix) ? entry.prefix : [entry.prefix]);
      if (entry.prefix !== undefined && (!prefixes.length || prefixes.some((s) => !isStr(s)))) bad(at, '「prefix」必须是字符串或非空字符串数组');
      const name = isStr(entry.name) ? entry.name : `item${i}`;
      rules.push({
        id: `${group.prefix}.${i}`,
        face: 'any',
        phase: group.phase,
        severity: 'block',
        scope: 'repo',
        when: whenOf(entry.when),
        whenEnv: whenEnvOf(entry.whenEnv),
        // 旧 sh() 的缺省时限 10 分钟由 command 原语自己提供（timeoutMs 缺省）；显式 null = 不限时（旧脚本同口径）。
        ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
        files: compact({ ext: entry.ext, prefix: prefixes, exclude: group.exclude }),
        assert: { kind: 'command', args: compact({ run: entry.command, cwd: entry.cwd, lockPattern: entry.lockPattern, lockHint: entry.lockHint, name }) },
        message: msg(`${name} 未通过`),
      });
    });
  }
}

const GATE_KEYS = ['id', 'name', 'cmd', 'folder', 'type', 'deps', 'when', 'env', 'timeoutMs'];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

/** 项目产品门 → command 规则（phase=verify）：与 verify 同口径枚举 product-gates.json / product-gates.<名称>.json（按文件名排序）。 */
function adaptProductGates(root, rules) {
  const cfgDir = path.join(root, '.agents', 'config');
  let gateFiles = [];
  try {
    gateFiles = fs.readdirSync(cfgDir).filter((f) => f === 'product-gates.json' || /^product-gates\..+\.json$/.test(f)).sort();
  } catch { /* 未配置产品门 */ }
  const seen = new Map();
  for (const file of gateFiles) {
    const at = `.agents/config/${file}`;
    const pg = parseJsonc(fs.readFileSync(path.join(cfgDir, file), 'utf8'), at);
    if (isObj(pg)) legacyKeys(pg, ['gates'], at, { label: '顶层' });
    const gates = Array.isArray(pg) ? pg : (isObj(pg) && Array.isArray(pg.gates) ? pg.gates : null);
    if (!gates) bad(at, '顶层须为数组或 { "gates": [...] }');
    gates.forEach((gate, i) => {
      const where = `${at}: gates[${i}]`;
      legacyKeys(gate, GATE_KEYS, where, { required: ['id', 'name', 'cmd'] });
      if (gate.deps !== undefined && (!Array.isArray(gate.deps) || gate.deps.some((d) => !isStr(d)))) bad(where, '「deps」须为 id 数组');
      const id = `product.${slug(gate.id)}`;
      if (seen.has(id)) bad(where, `id 归一后与 ${seen.get(id)} 里的门相同（规则 id ${id} 撞车，后者会顶掉前者）`);
      seen.set(id, file);
      const folder = isStr(gate.folder) ? gate.folder : undefined;
      rules.push({
        id,
        face: 'any',
        phase: 'verify',
        severity: 'block',
        scope: 'repo',
        when: whenOf(gate.when),
        // 旧 verify 对产品门不设时限：缺省 timeoutMs: null（不限时），声明正整数才封顶。
        timeoutMs: gate.timeoutMs ?? null,
        assert: {
          kind: 'command',
          args: compact({ run: gate.cmd, cwd: folder, env: gate.env, name: gate.name, deps: gate.deps === undefined ? undefined : gate.deps.map((d) => `product.${slug(d)}`) }),
        },
        message: msg(gate.name),
      });
    });
  }
}

/** 兼容层入口：返回 {name:'legacy', rules, waivers, faces, unsupported, warnings}。 */
export function adaptLegacy(root) {
  const rules = [];
  const faces = adaptFaces(root);
  adaptArchitecture(root, rules);
  adaptDeleteGuard(root, rules);
  adaptAuditFields(root, rules);
  adaptLocalGates(root, rules);
  adaptNotifyGuard(root, rules);
  adaptCommitCheck(root, rules);
  adaptProductGates(root, rules);
  return { name: 'legacy', rules, waivers: [], faces, unsupported: [], warnings: [] };
}
