import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTS, HOST_NAMES, modelRoleForAgent } from '../hosts/registry.mjs';
import { getField } from '../install/frontmatter.mjs';
import { probeModels } from './probe.mjs';
import { knownFor } from './known.mjs';

export const ROLE_NAMES = ['code', 'judgment', 'review'];
export const LOCAL_REL = '.agents/config/model-roles.local.json';
const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// --model 支持两种形式：code=sonnet（全局）、claude:code=sonnet（宿主级）。
export function parseModelFlags(values = []) {
  const out = { global: {}, hosts: {} };
  for (const raw of values) {
    const s = String(raw).trim();
    const eq = s.indexOf('=');
    if (eq <= 0) {
      const err = new Error(`invalid --model: ${raw}`);
      err.code = 'BAD_MODEL';
      err.value = raw;
      throw err;
    }
    const left = s.slice(0, eq).trim();
    const id = s.slice(eq + 1).trim();
    const [host, role] = left.includes(':') ? left.split(':', 2) : [null, left];
    if (!id || !ROLE_NAMES.includes(role)) {
      const err = new Error(`invalid --model: ${raw}`);
      err.code = 'BAD_MODEL';
      err.value = raw;
      throw err;
    }
    if (host) {
      const key = host.trim().toLowerCase();
      if (!HOSTS[key]) {
        const err = new Error(`unknown host in --model: ${host} (valid: ${HOST_NAMES.join(', ')})`);
        err.code = 'BAD_MODEL';
        err.value = raw;
        throw err;
      }
      out.hosts[key] = out.hosts[key] || {};
      out.hosts[key][role] = id;
    } else {
      out.global[role] = id;
    }
  }
  return out;
}

// 升级时本地模型配置可能因 gitignore 丢失；从已安装宿主子代理回收 model 字段，
// 避免把用户已配置的模型静默改写回 inherit。只在未重新探测时作为兜底。
export function readInjectedModels({ target, hosts = [] } = {}) {
  const out = {};
  // 宿主键归一口径与 parseModelFlags/resolveModels 同源：防御未来调用方传原样用户输入时静默丢宿主。
  for (const raw of hosts) {
    const host = String(raw).trim().toLowerCase();
    const h = HOSTS[host];
    if (!h?.agents?.modelField) continue;
    const dir = path.join(target, h.dir, h.agents.dir);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const values = {};
    for (const name of names) {
      if (!name.endsWith(h.agents.ext)) continue;
      let text;
      try {
        text = fs.readFileSync(path.join(dir, name), 'utf8');
      } catch {
        continue;
      }
      const value = getField(text, h.agents.modelField);
      // inherit 也是磁盘注入态：跳过会让「注入了 inherit」的壳被判成无注入，diff 误报模板更新。
      if (!value) continue;
      const role = modelRoleForAgent(name);
      if (!values[role]) values[role] = value;
    }
    if (Object.keys(values).length) out[host] = values;
  }
  return out;
}

export function loadRoleConfig(target) {
  for (const file of [
    path.join(target, '.agents/config/model-roles.json'),
    path.join(KIT_ROOT, 'templates/engine/.agents/config/model-roles.json'),
  ]) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* try next */
    }
  }
  return { roles: { review: { heterogeneous: true } } };
}

export function readLocalModelRoles(target) {
  const file = path.join(target, LOCAL_REL);
  if (!fs.existsSync(file)) return { exists: false, file, roles: {}, hosts: {} };
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { exists: true, file, roles: json.roles || {}, hosts: json.hosts || {}, raw: json };
  } catch {
    return { exists: true, file, error: true, roles: {}, hosts: {} };
  }
}

function roleValue(roles, role) {
  const entry = roles?.[role];
  if (typeof entry === 'string') return entry;
  return entry?.model || null;
}

function hostRoleValue(hosts, host, role) {
  const entry = hosts?.[host];
  if (!entry) return null;
  return typeof entry[role] === 'string' ? entry[role] : null;
}

// 词边界命中：'-' 是非词字符，o3-mini / pro-max / glm-5-air 这类合法族名仍命中；
// 而 minimax 不得误享 max/mini、…ocr1 不得误享 r1、…4o3 不得误享 o3。
const ROLE_HINTS = {
  code: [/\bhaiku\b/i, /\bflash\b/i, /\bmini\b/i, /\bsmall\b/i, /\bcoder\b/i, /\bsonnet\b/i, /\bqwen\b/i],
  judgment: [/\bopus\b/i, /\bo3\b/i, /\br1\b/i, /\breason\b/i, /\bthinking\b/i, /\bpro\b/i, /\bmax\b/i, /\bglm-5\b/i, /\bdeepseek\b/i],
  review: [/\bopus\b/i, /\bpro\b/i, /\bmax\b/i, /\br1\b/i, /\bthinking\b/i, /\bglm-5\b/i, /\bdeepseek\b/i],
};

function scoreModel(id, role) {
  const s = String(id);
  return (ROLE_HINTS[role] || []).reduce((score, re) => score + (re.test(s) ? 1 : 0), 0);
}

// 同分保守破平：仅当双方尾缀新近标记同类可比时才给偏序（新近者胜），否则返回 false 维持池序。
// 刻意不做通用新近性推断：不发明匹配、不猜命名——标记缺失、异类（一日期戳一版本）一律不比。
function preferNewer(a, b) {
  const dateA = /-(\d{8})$/.exec(a); // Claude 快照惯例，如 claude-3-5-sonnet-20240620
  const dateB = /-(\d{8})$/.exec(b);
  if (dateA && dateB) return Number(dateA[1]) > Number(dateB[1]);
  const verA = /(\d+(?:[.-]\d+)+)$/.exec(a); // 至少两段：不把 minimax-text-01 的 -01 当版本
  const verB = /(\d+(?:[.-]\d+)+)$/.exec(b);
  if (verA && verB) {
    const segA = verA[1].split(/[.-]/).map(Number);
    const segB = verB[1].split(/[.-]/).map(Number);
    const len = Math.min(segA.length, segB.length);
    for (let i = 0; i < len; i += 1) {
      if (segA[i] !== segB[i]) return segA[i] > segB[i];
    }
  }
  return false;
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

// 按角色推荐：先探测值，再用已核实的内置别名兜底。
// sources 记录每个角色值的来源：探测池 → 'detected'；roleConfig 兜底 → 'configured'；无值不记录。
export function recommendRoles({ host, candidates = [], roleConfig = null } = {}) {
  const detected = candidates.map((c) => (typeof c === 'string' ? c : c.id));
  const out = {};
  const sources = {};
  for (const role of ROLE_NAMES) {
    const pool = unique([...detected, ...knownFor(host, role)]);
    let best = null;
    let bestScore = 0;
    for (const id of pool) {
      const score = scoreModel(id, role);
      // 正分并列时按保守新近偏序破平（preferNewer）；零分并列与不可比情形维持池序先者胜。
      if (score > bestScore || (score === bestScore && score > 0 && preferNewer(id, best))) {
        best = id;
        bestScore = score;
      }
    }
    out[role] = best || pool[0] || roleConfig?.roles?.[role]?.model || null;
    if (out[role]) sources[role] = best || pool[0] ? 'detected' : 'configured';
  }
  if (out.review && out.code && out.review === out.code) {
    out.review = unique([...detected, ...knownFor(host, 'review')]).find((id) => id !== out.code) || null;
    if (out.review) sources.review = 'detected';
    else delete sources.review;
  }
  out.sources = sources;
  return out;
}

export function resolveModels({
  hosts,
  target = process.cwd(),
  cli = { global: {}, hosts: {} },
  tui = {},
  previous = {},
  mode = 'recommend',
  probe = true,
  allowCli = false,
  home,
  env,
  exec,
  roleConfig = null,
} = {}) {
  const config = roleConfig || loadRoleConfig(target);
  const local = readLocalModelRoles(target);
  const warnings = [];
  const perHost = {};
  const candidates = {};
  const sources = new Set();
  // 宿主键口径与 parseModelFlags 同源：trim + lowercase 归一后再查 HOSTS 与各级配置表。
  const hostKeys = hosts.map((h) => String(h).trim().toLowerCase());

  for (const host of hostKeys) {
    const h = HOSTS[host];
    if (!h) continue;

    const found = probe && mode !== 'inherit'
      ? probeModels({ host, target, home, env, allowCli, exec })
      : [];
    candidates[host] = found;
    const recommended = recommendRoles({ host, candidates: found, roleConfig: config });
    const values = {};

    for (const role of ROLE_NAMES) {
      const chain = [];
      const cliHost = hostRoleValue(cli.hosts, host, role);
      const cliGlobal = cli.global?.[role] || null;
      const tuiValue = hostRoleValue(tui, host, role);
      if (tuiValue === '__none__') {
        values[role] = null;
        sources.add('tui');
        continue;
      }
      if (cliHost) chain.push([cliHost, 'cli']);
      if (cliGlobal) chain.push([cliGlobal, 'cli']);
      if (tuiValue) chain.push([tuiValue, 'tui']);
      if (mode !== 'inherit') {
        const localHost = hostRoleValue(local.hosts, host, role);
        const localGlobal = roleValue(local.roles, role);
        if (localHost) chain.push([localHost, 'local']);
        if (localGlobal) chain.push([localGlobal, 'local']);
        // 未重新探测时，保留已安装子代理的模型；显式探测/推荐优先。
        const previousHost = !probe ? hostRoleValue(previous, host, role) : null;
        if (previousHost) chain.push([previousHost, 'previous']);
        if (probe && recommended[role]) chain.push([recommended[role], recommended.sources[role]]);
      }
      if (chain.length) {
        values[role] = chain[0][0];
        sources.add(chain[0][1]);
      } else {
        values[role] = h.agents?.inheritValue || null;
        if (values[role]) sources.add('inherit');
      }
    }

    // 独立复核默认要求异构；显式指定不覆盖，只告警。
    // inherit / null 不是具体模型，不能拿来做异构比较（否则会把 inherit 改成推荐模型）。
    const concrete = (v) => typeof v === 'string' && v !== 'inherit';
    if (mode !== 'inherit'
      && concrete(values.review) && concrete(values.code) && values.review === values.code
      && config?.roles?.review?.heterogeneous !== false) {
      // CLI / TUI / 本地配置都是用户显式选择：同模型只告警，不擅自改写。
      const explicit = Boolean(
        hostRoleValue(cli.hosts, host, 'review') || cli.global?.review
        || hostRoleValue(tui, host, 'review')
        || hostRoleValue(local.hosts, host, 'review') || roleValue(local.roles, 'review'),
      );
      if (!explicit) {
        const alt = unique([...found.map((c) => c.id), ...knownFor(host, 'review')]).find((id) => id !== values.code);
        if (alt) {
          values.review = alt;
          sources.add('detected');
        } else if (h.agents?.inheritValue) {
          values.review = h.agents.inheritValue;
          warnings.push({ host, role: 'review', code: 'REVIEW_SAME_AS_CODE' });
        } else {
          values.review = null;
          warnings.push({ host, role: 'review', code: 'REVIEW_SAME_AS_CODE' });
        }
      } else {
        warnings.push({ host, role: 'review', code: 'REVIEW_SAME_AS_CODE' });
      }
    }

    perHost[host] = values;
  }

  const roles = {};
  for (const role of ROLE_NAMES) {
    // 角色摘要不依赖宿主顺序：取第一个真正解析出值的宿主。
    const hostValue = hostKeys.map((host) => perHost[host]?.[role]).find(Boolean) || null;
    const value = cli.global?.[role]
      || roleValue(local.roles, role)
      || hostValue
      || null;
    roles[role] = { model: value };
  }

  return {
    roles,
    hosts: perHost,
    source: [...sources].join('+') || 'inherit',
    warnings,
    candidates,
    local,
  };
}

export function summarizeModels(models) {
  if (!models?.hosts) return '-';
  // TUI 跳过角色写入 '__none__' 哨兵（resolveModels 已识别），展示面与空值一样视为 inherit。
  const shown = (v) => (v && v !== '__none__' ? v : 'inherit');
  return Object.entries(models.hosts)
    .map(([host, roles]) => `${host}: ${ROLE_NAMES.map((r) => `${r}=${shown(roles[r])}`).join(' ')}`)
    .join('; ');
}

export function writeLocalModelRoles(target, models, { overwrite = false } = {}) {
  if (!models) return { written: false, reason: 'no-models' };
  const file = path.join(target, LOCAL_REL);
  if (fs.existsSync(file) && !overwrite) return { written: false, file, reason: 'exists' };

  const roles = {};
  for (const role of ROLE_NAMES) roles[role] = { model: models.roles?.[role]?.model || null };
  if (!ROLE_NAMES.some((role) => roles[role].model)) {
    return { written: false, file, reason: 'empty' };
  }

  let existing = {};
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const data = {
    version: 1,
    ...existing,
    roles: { ...(existing.roles || {}), ...roles },
    hosts: { ...(existing.hosts || {}), ...(models.hosts || {}) },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return { written: true, file };
}
