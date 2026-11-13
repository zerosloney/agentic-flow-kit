import fs from 'node:fs';
import path from 'node:path';

// Hook 编译器：把 .agents/hooks/gates.json 里的中性 hook 规格编译成各宿主 schema，
// 并幂等合并进宿主 settings / hooks 文件。宿主 schema 差异由 registry 的
// hooks.events 描述（matcher 名、命令形式、超时、容器路径），这里不写宿主分支。
// 与 MCP 合并共用“只改托管条目、保留用户内容”的语义，供后续权限编译复用。
export const HOOKS_SPEC_REL = '.agents/hooks/gates.json';

const TOOLS = new Set(['write', 'shell']);
const FORMS = new Set(['env', 'relative', 'args', 'cli', 'cli-args']);

function hookIdOf(script) {
  const base = String(script || '').replace(/\\/g, '/').split('/').pop() || '';
  if (!/^\.agents\/hooks\//.test(String(script || '').replace(/\\/g, '/'))) return null;
  if (!/\.(cjs|mjs)$/i.test(base)) return null;
  return base.replace(/\.(cjs|mjs)$/i, '');
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeScript(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

// 解析中性规格。结构不合法时返回 null：调用方回退到静态宿主模板，不半途改配置。
export function parseHookSpec(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(root) || !Array.isArray(root.hooks)) return null;
  const spec = [];
  for (const item of root.hooks) {
    if (!isObject(item)) return null;
    if (typeof item.event !== 'string' || !item.event) return null;
    if (!TOOLS.has(item.tool)) return null;
    if (typeof item.script !== 'string' || !item.script) return null;
    spec.push({
      id: typeof item.id === 'string' && item.id ? item.id : item.tool,
      event: item.event,
      tool: item.tool,
      script: normalizeScript(item.script),
      timeout: Number.isFinite(item.timeout) ? item.timeout : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      statusMessage: typeof item.statusMessage === 'string' ? item.statusMessage : undefined,
    });
  }
  return spec;
}

export function readHookSpec(target) {
  try {
    return parseHookSpec(fs.readFileSync(path.join(target, HOOKS_SPEC_REL), 'utf8'));
  } catch {
    return null;
  }
}

function applicable(spec, cfg) {
  const tools = Array.isArray(cfg?.tools) ? cfg.tools : null;
  return spec.filter((item) => item.event === cfg?.event
    && (!tools || tools.includes(item.tool))
    && typeof cfg?.matchers?.[item.tool] === 'string');
}

// 中性条目 -> 宿主 hook 对象。form 决定命令形态：
// cli / cli-args 走包内入口（flow-kit hook <id>）；env/relative/args 保留旧模板兼容外部宿主。
function renderHook(item, cfg) {
  const form = cfg?.command?.form;
  if (!FORMS.has(form)) {
    const err = new Error(`invalid hook command form: ${form}`);
    err.code = 'HOOK_CONFIG';
    throw err;
  }
  const hookId = hookIdOf(item.script);
  const hook = { type: 'command' };
  if (form === 'cli' || form === 'cli-args') {
    if (!hookId) {
      const err = new Error(`hook script must be under .agents/hooks: ${item.script}`);
      err.code = 'HOOK_CONFIG';
      throw err;
    }
    if (form === 'cli-args') {
      hook.command = 'flow-kit';
      hook.args = ['hook', hookId];
    } else {
      const template = String(cfg.command.template || 'flow-kit hook {hook}');
      if (!template.includes('{hook}')) {
        const err = new Error('hook command template must contain {hook}');
        err.code = 'HOOK_CONFIG';
        throw err;
      }
      hook.command = template.split('{hook}').join(hookId);
    }
  } else {
    const template = String(cfg.command.template || '');
    if (!template.includes('{script}')) {
      const err = new Error('hook command template must contain {script}');
      err.code = 'HOOK_CONFIG';
      throw err;
    }
    const rendered = template.split('{script}').join(item.script);
    if (form === 'args') {
      hook.command = 'node';
      hook.args = [rendered];
    } else {
      hook.command = rendered;
    }
  }
  if (cfg.includeMeta) {
    hook.name = item.name || item.id;
    if (item.statusMessage) hook.statusMessage = item.statusMessage;
  }
  if (isObject(cfg.hookExtras)) Object.assign(hook, cfg.hookExtras);
  hook.timeout = cfg.timeouts?.[item.tool] ?? item.timeout;
  if (hook.timeout == null) delete hook.timeout;
  return hook;
}

export function compileHookGroups(spec, cfg) {
  const groups = new Map();
  for (const item of applicable(spec, cfg)) {
    const matcher = cfg.matchers[item.tool];
    const key = `${item.event}\u0000${matcher}`;
    if (!groups.has(key)) groups.set(key, { event: item.event, matcher, hooks: [] });
    groups.get(key).hooks.push(renderHook(item, cfg));
  }
  return [...groups.values()];
}

export function hookRefs(hook) {
  if (!isObject(hook)) return '';
  const refs = [];
  if (typeof hook.command === 'string') refs.push(hook.command);
  if (Array.isArray(hook.args)) refs.push(...hook.args.filter((arg) => typeof arg === 'string'));
  return refs.join('\n').replace(/\\/g, '/');
}

function scriptPattern(script) {
  const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9._-])${escaped}(?=$|[^A-Za-z0-9._-])`);
}

function managedScript(hook, scripts) {
  const text = hookRefs(hook).replace(/\s+/g, ' ');
  for (const script of scripts) {
    if (scriptPattern(script).test(text)) return script;
    const id = hookIdOf(script);
    if (id && scriptPattern(`flow-kit hook ${id}`).test(text)) return script;
  }
  return null;
}

function eventsOwner(root, cfg, create) {
  const segments = String(cfg?.container || 'hooks').split('.');
  let node = root;
  for (const key of segments) {
    if (!isObject(node[key])) {
      if (!create) return null;
      node[key] = {};
    }
    node = node[key];
  }
  if (create && isObject(cfg.rootDefaults)) {
    // rootDefaults 作用于容器第一段（ZCode: hooks.enabled）
    const owner = root[segments[0]];
    for (const [key, value] of Object.entries(cfg.rootDefaults)) {
      if (owner[key] === undefined) owner[key] = value;
    }
  }
  return node;
}

// 只替换指向托管脚本的 hook 条目；用户自建 hook、其它事件、其它顶层键原样保留。
export function mergeHooksIntoRoot(root, spec, cfg) {
  if (!isObject(root) || !Array.isArray(spec) || !spec.length) return false;
  const groups = compileHookGroups(spec, cfg);
  if (!groups.length) return false;
  const scripts = new Set(spec.map((item) => item.script));
  const matcherKey = cfg.matcherKey || 'matcher';
  const hooksKey = cfg.hooksKey || 'hooks';
  const events = eventsOwner(root, cfg, true);
  let changed = false;

  for (const event of new Set(groups.map((group) => group.event))) {
    const list = Array.isArray(events[event]) ? events[event] : [];
    const kept = [];
    for (const group of list) {
      if (!isObject(group) || !Array.isArray(group[hooksKey])) {
        kept.push(group);
        continue;
      }
      const hooks = group[hooksKey].filter((hook) => !managedScript(hook, scripts));
      if (hooks.length !== group[hooksKey].length) changed = true;
      if (hooks.length) kept.push(hooks.length === group[hooksKey].length ? group : { ...group, [hooksKey]: hooks });
    }
    const compiled = groups.filter((group) => group.event === event).map((group) => ({
      ...(isObject(cfg.groupExtras) ? cfg.groupExtras : {}),
      [matcherKey]: group.matcher,
      [hooksKey]: group.hooks,
    }));
    const next = [...kept, ...compiled];
    if (JSON.stringify(next) !== JSON.stringify(list)) changed = true;
    events[event] = next;
  }
  return changed;
}

// 移除指向托管脚本的 hook 条目（卸载 / remove-host 用）；用户自建 hook 保留。
export function stripHooksFromRoot(root, spec, cfg) {
  if (!isObject(root) || !Array.isArray(spec) || !spec.length) return false;
  const scripts = new Set(spec.map((item) => item.script));
  const hooksKey = cfg.hooksKey || 'hooks';
  const events = eventsOwner(root, cfg, false);
  if (!events) return false;
  let changed = false;
  for (const [event, list] of Object.entries(events)) {
    if (!Array.isArray(list)) continue;
    const kept = [];
    for (const group of list) {
      if (!isObject(group) || !Array.isArray(group[hooksKey])) {
        kept.push(group);
        continue;
      }
      const hooks = group[hooksKey].filter((hook) => !managedScript(hook, scripts));
      if (hooks.length !== group[hooksKey].length) changed = true;
      if (hooks.length) kept.push(hooks.length === group[hooksKey].length ? group : { ...group, [hooksKey]: hooks });
    }
    if (kept.length) {
      if (JSON.stringify(events[event]) !== JSON.stringify(kept)) changed = true;
      events[event] = kept;
    } else if (event in events) {
      delete events[event];
      changed = true;
    }
  }
  const segments = String(cfg.container || 'hooks').split('.');
  const containerNode = segments.reduce((node, key) => (isObject(node) ? node[key] : null), root);
  if (isObject(containerNode) && !Object.keys(containerNode).length) {
    const parent = segments.slice(0, -1).reduce((node, key) => node?.[key], root);
    if (isObject(parent)) delete parent[segments[segments.length - 1]];
    changed = true;
  }
  // ZCode 等带 rootDefaults 的容器：只剩默认键时整段移除。
  const head = root[segments[0]];
  if (isObject(head) && isObject(cfg.rootDefaults)) {
    const keys = Object.keys(head);
    if (keys.length && keys.every((key) => key in cfg.rootDefaults && head[key] === cfg.rootDefaults[key])) {
      delete root[segments[0]];
      changed = true;
    }
  }
  return changed;
}

// doctor 用：期望接线与文件实际接线按 event|matcher|script 对比。
export function findHookDrift(root, spec, cfg) {
  const scripts = new Set((spec || []).map((item) => item.script));
  const expected = new Set(applicable(spec || [], cfg)
    .map((item) => `${item.event}|${cfg.matchers[item.tool]}|${item.script}`));
  const actual = new Set();
  const events = isObject(root) ? eventsOwner(root, cfg, false) : null;
  if (events) {
    for (const [event, list] of Object.entries(events)) {
      if (!Array.isArray(list)) continue;
      for (const group of list) {
        if (!isObject(group) || !Array.isArray(group[cfg.hooksKey || 'hooks'])) continue;
        const matcher = String(group[cfg.matcherKey || 'matcher'] || '');
        for (const hook of group[cfg.hooksKey || 'hooks']) {
          const script = managedScript(hook, scripts);
          if (script) actual.add(`${event}|${matcher}|${script}`);
        }
      }
    }
  }
  return {
    missing: [...expected].filter((key) => !actual.has(key)),
    extra: [...actual].filter((key) => !expected.has(key)),
    expected: expected.size,
  };
}
