import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOSTS } from '../hosts/registry.mjs';
import { writeAtomicSync } from './atomic.mjs';
import { acquireLock, userHooksLockFile } from './lock.mjs';

// 用户级 hook 接线（issue #45 A 档）：部分宿主的 hooks 不在项目仓内，而在用户目录
// （如 Codex 的 ~/.codex/hooks.json，Claude 风格 schema）。适配脚本随包分发、经
// `flow-kit hook <id>` 调起，不在用户目录复制任何文件；这里只做条目级的幂等合并 / 摘除。
// 条目信任按条目哈希（Codex config.toml hooks.state.trusted_hash）判定：编辑即失效，
// 接线变更后须在交互式宿主会话重新信任一次（提示由调用方输出）。
// 纪律：只动本工具接线的条目，其余条目原样保留；配置读解析失败一律 fail-loud，不覆盖用户文件。

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// registry 的 userHooks 规格（宿主行为数据驱动；无该能力的宿主返回 null）。
export function userHookSpec(host) {
  return HOSTS[host]?.userHooks || null;
}

// 规格里的 `~` 前缀解析到用户 HOME；其余按项目外绝对路径处理。
export function userHooksFile(spec, home = os.homedir()) {
  const raw = String(spec.config);
  if (raw === '~') return home;
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(home, raw.slice(2));
  return path.resolve(raw);
}

// 读用户级 hooks 配置。文件缺失返回 null（由调用方决定初始化）；
// JSON 解析失败或根不是对象 → 抛 USER_HOOKS_CONFIG（宁可失败也不覆盖用户文件）。
export function readUserHooksConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let root;
  try {
    root = JSON.parse(text);
  } catch (err) {
    const wrapped = new Error(`invalid user hooks config: ${file} (${err.message})`);
    wrapped.code = 'USER_HOOKS_CONFIG';
    throw wrapped;
  }
  if (!isObject(root)) {
    const err = new Error(`invalid user hooks config: ${file} (root must be an object)`);
    err.code = 'USER_HOOKS_CONFIG';
    throw err;
  }
  return root;
}

export function writeUserHooksConfig(file, config) {
  writeAtomicSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

// 本工具接线条目的识别判据：command 全等，或 command 含 'flow-kit'（接管旧版/漂移接线）。
function isManagedEntry(item, spec) {
  return isObject(item) && Array.isArray(item.hooks)
    && item.hooks.some((hook) => isObject(hook)
      && (hook.command === spec.command || String(hook.command || '').includes('flow-kit')));
}

export function findUserHookEntry(config, spec) {
  if (!isObject(config) || !isObject(config.hooks)) return null;
  const list = config.hooks[spec.event];
  if (!Array.isArray(list)) return null;
  return list.find((item) => isManagedEntry(item, spec)) || null;
}

// 幂等合并：在 hooks[spec.event] 里找本工具条目——命中则更新 matcher/timeout 并规范 command；
// 没有则在数组头部插入（头部让本门先于 context-mode 等既有 hook 执行）。
// 不动其他任何条目。返回 { changed, created }（created = 事件数组为新建）。
export function mergeUserHookEntry(config, spec) {
  if (!isObject(config)) {
    const err = new Error('user hooks config must be an object');
    err.code = 'USER_HOOKS_CONFIG';
    throw err;
  }
  if (!isObject(config.hooks)) config.hooks = {};
  const list = Array.isArray(config.hooks[spec.event]) ? config.hooks[spec.event] : null;
  const entry = {
    matcher: spec.matcher,
    hooks: [{ type: 'command', command: spec.command, timeout: spec.timeout }],
  };
  if (!list) {
    config.hooks[spec.event] = [entry];
    return { changed: true, created: true };
  }
  const index = list.findIndex((item) => isManagedEntry(item, spec));
  if (index === -1) {
    config.hooks[spec.event] = [entry, ...list];
    return { changed: true, created: false };
  }
  const existing = list[index];
  const next = {
    ...existing,
    matcher: spec.matcher,
    hooks: existing.hooks.map((hook) => (isObject(hook)
      && (hook.command === spec.command || String(hook.command || '').includes('flow-kit'))
      ? { ...hook, type: 'command', command: spec.command, timeout: spec.timeout }
      : hook)),
  };
  if (JSON.stringify(next) !== JSON.stringify(existing)) {
    list[index] = next;
    return { changed: true, created: false };
  }
  return { changed: false, created: false };
}

// 摘除本工具条目（整个条目移除，其余条目不动）；hooks[event] 空则删键，hooks 空则整键移除。
// 返回是否发生变更。
export function removeUserHookEntry(config, spec) {
  if (!isObject(config) || !isObject(config.hooks)) return false;
  const list = config.hooks[spec.event];
  if (!Array.isArray(list)) return false;
  const kept = list.filter((item) => !isManagedEntry(item, spec));
  if (kept.length === list.length) return false;
  if (kept.length) config.hooks[spec.event] = kept;
  else delete config.hooks[spec.event];
  if (!Object.keys(config.hooks).length) delete config.hooks;
  return true;
}

// 配置无效（USER_HOOKS_CONFIG）时换上本地化消息再抛：fail-loud，绝不覆盖用户文件。
function reraiseLocalized(err, file, t) {
  if (err?.code !== 'USER_HOOKS_CONFIG') throw err;
  const wrapped = new Error(t ? t('error.userHooksConfig', { path: file }) : err.message);
  wrapped.code = 'USER_HOOKS_CONFIG';
  throw wrapped;
}

// 全局 hooks 配置的读改写互斥：两个项目并发安装时串行化（锁冲突 fail-loud，见 lock.mjs）。
const USER_HOOKS_LOCK_OPTS = { label: 'user-hooks', errorCode: 'USER_HOOKS_LOCKED' };

// 接线一个宿主的用户级 hooks（install/upgrade/add-host 用）。文件不存在时初始化 {hooks:{}}；
// 未变更时不重写文件（字节稳定，条目信任哈希不被无谓刷新）。返回 { host, file, changed, created }。
export function wireUserHooks({ host, t }) {
  const spec = userHookSpec(host);
  if (!spec) {
    const err = new Error(`host has no user hooks capability: ${host}`);
    err.code = 'HOST_NOT_INSTALLED';
    throw err;
  }
  const file = userHooksFile(spec);
  const releaseLock = acquireLock(userHooksLockFile(file), { ...USER_HOOKS_LOCK_OPTS, t });
  try {
    const existed = fs.existsSync(file);
    const config = existed ? readUserHooksConfig(file) : { hooks: {} };
    const result = mergeUserHookEntry(config, spec);
    if (result.changed || !existed) writeUserHooksConfig(file, config);
    return { host, file, changed: Boolean(result.changed), created: !existed };
  } catch (err) {
    reraiseLocalized(err, file, t);
  } finally {
    releaseLock();
  }
}

// 摘除一个宿主的用户级接线条目（remove-host / uninstall 用）。文件缺失 = no-op。
export function unwireUserHooks({ host, t }) {
  const spec = userHookSpec(host);
  if (!spec) return { host, removed: false, file: null };
  const file = userHooksFile(spec);
  const releaseLock = acquireLock(userHooksLockFile(file), { ...USER_HOOKS_LOCK_OPTS, t });
  try {
    if (!fs.existsSync(file)) return { host, file, removed: false };
    const config = readUserHooksConfig(file);
    const removed = removeUserHookEntry(config, spec);
    if (removed) writeUserHooksConfig(file, config);
    return { host, file, removed };
  } catch (err) {
    reraiseLocalized(err, file, t);
  } finally {
    releaseLock();
  }
}

// 只读校验（doctor 用）：条目在位且 matcher 与 registry 一致 → ok；
// matcher 过期（如旧版 ^(Bash)$，会形成静默绕过）→ stale；条目 / 文件缺失 → missing；
// 配置解析失败 → invalid。
export function inspectUserHookEntry({ host }) {
  const spec = userHookSpec(host);
  if (!spec) return null;
  const file = userHooksFile(spec);
  let config;
  try {
    config = readUserHooksConfig(file);
  } catch {
    return { state: 'invalid', file, expected: spec.matcher, matcher: null };
  }
  const entry = config ? findUserHookEntry(config, spec) : null;
  if (!entry) return { state: 'missing', file, expected: spec.matcher, matcher: null };
  return {
    state: entry.matcher === spec.matcher ? 'ok' : 'stale',
    file,
    expected: spec.matcher,
    matcher: typeof entry.matcher === 'string' ? entry.matcher : null,
  };
}
