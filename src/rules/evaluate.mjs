// evaluate — 规则求值器（v1 原语：content / require / absence / inventory / env / command）。
// 语义与旧门禁对拍：同一个配置投影后得到同一个判定（对拍测试见 tests/rules-check.test.mjs）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { globToRegExp, hasGlobMeta, staticPrefix } from './glob.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', 'coverage', 'tmp', '.agents/tmp', '.agents/cache']);

const posix = (p) => String(p).replace(/\\/g, '/');
const readLines = (abs) => fs.readFileSync(abs, 'utf8').split(/\r?\n/);

export class RulesTargetError extends Error {
  constructor(message) {
    super(message);
    this.code = 'RULES_TARGET';
  }
}

function listFilesIn(root, prefixRel) {
  const out = [];
  const walk = (abs, rel) => {
    let ents;
    try {
      ents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (SKIP_DIRS.has(ent.name)) continue;
      const absChild = path.join(abs, ent.name);
      const relChild = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(absChild, relChild);
      else out.push(relChild);
    }
  };
  if (prefixRel) {
    const abs = path.join(root, prefixRel);
    if (!fs.existsSync(abs)) return out;
    if (fs.statSync(abs).isFile()) out.push(posix(prefixRel));
    else walk(abs, prefixRel.replace(/\/$/, ''));
  } else {
    walk(root, '');
  }
  return out;
}

/** 解析 targets：glob → 按静态前缀收文件；目录 → 递归并按 ext 过滤；文件 → 原样。optional 缺失返回 null。 */
export function resolveTargets(root, targets, ext, optional = false) {
  const exts = Array.isArray(ext) ? ext : [];
  const files = new Set();
  const universe = () => listFilesIn(root, '');
  for (const target of targets) {
    const t = posix(target);
    if (hasGlobMeta(t)) {
      const prefix = staticPrefix(t);
      if (prefix && !fs.existsSync(path.join(root, prefix))) {
        if (optional) return null;
        throw new RulesTargetError(`目标路径不存在：${prefix}`);
      }
      const re = globToRegExp(t);
      for (const f of universe()) {
        if (re.test(f)) files.add(f);
      }
    } else if (fs.existsSync(path.join(root, t)) && fs.statSync(path.join(root, t)).isDirectory()) {
      for (const f of listFilesIn(root, t)) {
        if (!exts.length || exts.some((e) => f.endsWith(e))) files.add(f);
      }
    } else if (fs.existsSync(path.join(root, t))) {
      files.add(t);
    } else {
      if (optional) return null;
      throw new RulesTargetError(`目标路径不存在：${t}`);
    }
  }
  return [...files].sort();
}

function readPkg(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

// 与旧脚本同口径：路径按「.」切分并忽略空段（pkg:scripts..build 等价 pkg:scripts.build）。
const dotted = (obj, key) => key.split('.').filter(Boolean).reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);

/** when 谓词：pkg:<dotted> / env:KEY=VAL / 路径或 glob 存在性。数组为 OR（与旧 commit-check / product-gates 的 some 语义一致）。
 *  pkg: 读 pkgDir 下的 package.json（规则 cwd/folder；缺省仓库根）——与旧 commit-check(entry.cwd) / verify(gate.folder) 同口径。 */
export function whenSatisfied(items, root, pkgDir = null) {
  if (!Array.isArray(items) || items.length === 0) return true;
  const pkg = readPkg(pkgDir || root);
  return items.some((raw) => {
    const item = String(raw);
    if (item.startsWith('env:')) {
      const body = item.slice(4);
      const eq = body.indexOf('=');
      if (eq <= 0) return false;
      return process.env[body.slice(0, eq)] === body.slice(eq + 1);
    }
    if (item.startsWith('pkg:')) {
      // 旧语义：叶子必须是非空字符串（scripts.build 这类命令项）；对象 / 布尔 / 数字不算命中。
      const leaf = dotted(pkg, item.slice(4));
      return typeof leaf === 'string' && leaf.trim() !== '';
    }
    const p = posix(item);
    if (hasGlobMeta(p)) {
      const re = globToRegExp(p);
      const files = listFilesIn(root, staticPrefix(p).replace(/\/$/, ''));
      return files.some((f) => re.test(f));
    }
    return fs.existsSync(path.join(root, p));
  });
}

function fileFilterMatch(filter, changed) {
  // changed === null：本次没有「变更面」信息（--full），不做裁剪；changed 为空数组：没有任何变更文件，不触发。
  if (!filter || changed === null) return true;
  if (changed.length === 0) return false;
  const exts = Array.isArray(filter.ext) ? filter.ext : [];
  const prefixes = Array.isArray(filter.prefix) ? filter.prefix : [];
  const globs = Array.isArray(filter.glob) ? filter.glob.map(globToRegExp) : [];
  const excludes = Array.isArray(filter.exclude) ? filter.exclude : [];
  const considered = excludes.length
    ? changed.filter((f) => !excludes.some((p) => posix(f).startsWith(posix(p))))
    : changed;
  if (considered.length === 0) return false;
  if (!exts.length && !prefixes.length && !globs.length) return true;
  return considered.some((f) => {
    const p = posix(f);
    return (exts.length && exts.some((e) => p.endsWith(e)))
      || (prefixes.length && prefixes.some((pre) => p.startsWith(posix(pre))))
      || (globs.length && globs.some((re) => re.test(p)));
  });
}

/** git diff 的变更文件与新增行（供 diff 作用域规则）。 */
export function collectDiff(root, { staged = false, range = null } = {}) {
  const args = ['-c', 'core.quotepath=off', 'diff', '--name-only'];
  if (staged) args.push('--cached');
  if (range) args.push(range);
  const names = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (names.status !== 0) throw new RulesTargetError(`git diff 失败：${(names.stderr || '').trim()}`);
  const patchArgs = ['-c', 'core.quotepath=off', 'diff', '-U0'];
  if (staged) patchArgs.push('--cached');
  if (range) patchArgs.push(range);
  const patch = spawnSync('git', patchArgs, { cwd: root, encoding: 'utf8' });
  if (patch.status !== 0) throw new RulesTargetError(`git diff -U0 失败：${(patch.stderr || '').trim()}`);
  const added = new Map();
  let file = '';
  for (const line of patch.stdout.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    if (!/^\+[^+]/.test(line)) continue;
    const posixFile = posix(file);
    if (!added.has(posixFile)) added.set(posixFile, []);
    added.get(posixFile).push(line.slice(1));
  }
  return { files: names.stdout.split(/\r?\n/).map(posix).filter(Boolean), added };
}

function evalContentRepo(rule, ctx) {
  const a = rule.assert.args;
  const ext = a.ext === undefined ? ['.cs'] : a.ext;
  const targets = [...(a.targets || []), ...(a.files || [])].map(posix);
  const files = resolveTargets(ctx.root, targets, ext, a.optional === true);
  if (files === null) return { skipped: 'optional-target-missing' };
  const excludeRes = (a.exclude || []).map((g) => globToRegExp(g));
  const matchRes = [...(a.matches || []), ...(a.pattern ? [a.pattern] : [])].map((p) => new RegExp(p));
  const unlessRe = a.unless ? new RegExp(a.unless) : null;
  const allow = (a.allow || []).map((x) => ({ re: globToRegExp(x.glob), lineRe: x.pattern ? new RegExp(x.pattern) : null }));
  const violations = [];
  for (const rel of files) {
    if (ctx.restrict && ctx.restrict.length && !ctx.restrict.some((c) => posix(c) === rel)) continue;
    if (excludeRes.some((re) => re.test(rel))) continue;
    const lines = readLines(path.join(ctx.root, rel));
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (unlessRe && unlessRe.test(line)) continue;
      if (allow.some((x) => x.re.test(rel) && (!x.lineRe || x.lineRe.test(line)))) continue;
      const hit = (a.contains || []).some((s) => line.includes(s)) || matchRes.some((re) => re.test(line));
      if (!hit) continue;
      violations.push({ ruleId: rule.id, severity: rule.severity, message: rule.message, file: rel, line: i + 1, detail: line.trim() });
      if (a.once) break;
    }
    if (a.once && violations.length) break;
  }
  return { violations };
}

function evalContentDiff(rule, ctx) {
  if (!ctx.diff) return { skipped: 'no-diff' };
  const a = rule.assert.args;
  const ext = a.ext === undefined ? ['.cs'] : a.ext;
  const re = new RegExp(a.pattern);
  const copyRe = a.copyPattern ? new RegExp(a.copyPattern) : null;
  const allowFiles = a.allowFiles || [];
  const allowLines = a.allowLines || [];
  const violations = [];
  for (const [file, lines] of ctx.diff.added) {
    if (!ext.some((e) => file.endsWith(e))) continue;
    if (allowFiles.some((s) => file.includes(s))) continue;
    for (const content of lines) {
      if (!re.test(content) || (copyRe && copyRe.test(content))) continue;
      if (allowLines.some((s) => content.includes(s))) continue;
      violations.push({ ruleId: rule.id, severity: rule.severity, message: rule.message, file, detail: content.trim() });
    }
  }
  return { violations };
}

function evalRequire(rule, ctx) {
  const a = rule.assert.args;
  // 目录目标按 ext 过滤（缺省 .cs，与旧架构门同口径；显式文件与 glob 不过滤）——非 .NET 项目配目录时声明 ext。
  const files = resolveTargets(ctx.root, a.files, a.ext === undefined ? ['.cs'] : a.ext, a.optional === true);
  if (files === null) return { skipped: 'optional-target-missing' };
  const excludeRes = (a.exclude || []).map((g) => globToRegExp(g));
  const trigger = String(a.trigger);
  const requireText = String(a.require);
  const violations = [];
  for (const rel of files) {
    if (ctx.restrict && ctx.restrict.length && !ctx.restrict.some((c) => posix(c) === rel)) continue;
    if (excludeRes.some((re) => re.test(rel))) continue;
    const lines = readLines(path.join(ctx.root, rel));
    let block = null;
    const close = () => {
      if (block && !block.ok) violations.push({ ruleId: rule.id, severity: rule.severity, message: rule.message, file: rel, line: block.start, detail: `缺少 ${requireText}` });
      block = null;
    };
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (block && line.trim().startsWith('catch (')) close();
      if (line.includes(trigger)) {
        close();
        block = { start: i + 1, ok: false };
        continue;
      }
      if (block && line.includes(requireText)) block.ok = true;
    }
    close();
  }
  return { violations };
}

function evalAbsence(rule, ctx) {
  const a = rule.assert.args;
  const re = globToRegExp(a.glob);
  const unless = (a.unless || []).map(globToRegExp);
  const hits = listFilesIn(ctx.root, '').filter((f) => re.test(f) && !unless.some((u) => u.test(f)));
  return { violations: hits.map((file) => ({ ruleId: rule.id, severity: rule.severity, message: rule.message, file, detail: '禁止存在的路径' })) };
}

function evalInventory(rule, ctx) {
  const a = rule.assert.args;
  const counts = new Map();
  for (const entry of a.scan) {
    const dir = posix(entry.dir);
    const abs = path.join(ctx.root, dir);
    if (!fs.existsSync(abs)) {
      if (entry.optional === true) continue;
      throw new RulesTargetError(`inventory 扫描目录不存在：${dir}`);
    }
    const ext = entry.ext === undefined ? ['.cs'] : entry.ext;
    const call = new RegExp(entry.call === undefined ? '\\.(Remove|RemoveRange)\\(' : entry.call);
    const ignore = new RegExp(entry.ignore === undefined ? '_cache\\.Remove\\(' : entry.ignore);
    const base = path.posix.basename(dir.replace(/\/$/, ''));
    for (const rel of listFilesIn(ctx.root, dir)) {
      if (!ext.some((e) => rel.endsWith(e))) continue;
      const lines = readLines(path.join(ctx.root, rel));
      let n = 0;
      for (const line of lines) if (call.test(line) && !ignore.test(line)) n += 1;
      if (n > 0) counts.set(`${base}/${rel.slice(dir.length).replace(/^\//, '')}`, n);
    }
  }
  const current = [...counts.entries()].map(([f, n]) => `${f} ${n}`).sort();
  const baselineAbs = path.join(ctx.root, a.baseline);
  if (!fs.existsSync(baselineAbs)) {
    return { violations: [{ ruleId: rule.id, severity: rule.severity, message: rule.message, detail: `豁免清单不存在：${a.baseline}` }] };
  }
  const expected = readLines(baselineAbs).map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '').sort();
  if (JSON.stringify(current) === JSON.stringify(expected)) return { violations: [] };
  const currentSet = new Set(current);
  const expectedSet = new Set(expected);
  const missing = expected.filter((l) => !currentSet.has(l));
  const extra = current.filter((l) => !expectedSet.has(l));
  const detail = [...missing.map((l) => `- ${l}`), ...extra.map((l) => `+ ${l}`)].join('\n');
  return { violations: [{ ruleId: rule.id, severity: rule.severity, message: rule.message, detail: detail || '调用点与清单不一致' }] };
}

function evalNavProperties(rule, ctx) {
  const a = rule.assert.args;
  const dir = posix(a.dir);
  const abs = path.join(ctx.root, dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    if (a.optional) return { skipped: 'optional-target-missing' };
    throw new RulesTargetError(`navProperties 目标目录不存在：${dir}`);
  }
  const files = listFilesIn(ctx.root, dir).filter((f) => f.endsWith('.cs')).sort();
  const names = new Set(a.extraTypeNames || []);
  const classRe = /public\s+(?:sealed\s+|abstract\s+|partial\s+)*(?:class|record)\s+(\w+)/g;
  for (const f of files) {
    for (const m of readLines(path.join(ctx.root, f)).join('\n').matchAll(classRe)) names.add(m[1]);
  }
  const violations = [];
  for (const rel of files) {
    if (ctx.restrict && ctx.restrict.length && !ctx.restrict.some((c) => posix(c) === rel)) continue;
    const lines = readLines(path.join(ctx.root, rel));
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^\s*public\s+(?:virtual\s+)?([\w<>,\s.?]+?)\s+(\w+)\s*\{/.exec(lines[i]);
      if (!m) continue;
      const typ = m[1].trim();
      const mm = /(?:ICollection|List|IEnumerable|IReadOnlyCollection|IReadOnlyList)<\s*(\w+)\s*>/.exec(typ);
      const core = mm ? mm[1] : (/^\w+\??$/.test(typ) ? typ.replace(/\?$/, '') : null);
      if (core && names.has(core)) {
        violations.push({ ruleId: rule.id, severity: rule.severity, message: rule.message, file: rel, line: i + 1, detail: `${m[2]} : ${typ}` });
      }
    }
  }
  return { violations };
}

function evalPlugin(rule, ctx) {
  const a = rule.assert.args;
  const modulePath = path.join(ctx.root, '.agents', 'rules', 'plugins', `${a.module}.mjs`);
  // anomaly = 插件自身没跑成（模块缺失 / 崩溃 / 超时 / 输出非法），区别于插件报出的违例——CLI 据此留痕给 doctor。
  const fail = (detail) => ({ violations: [{ ruleId: rule.id, severity: rule.severity, message: rule.message, detail, anomaly: true }] });
  if (!fs.existsSync(modulePath)) return fail(`插件不存在：.agents/rules/plugins/${a.module}.mjs`);
  const payload = JSON.stringify({ version: 1, root: ctx.root, files: ctx.changed || null, face: rule.face, faces: ctx.faces || {}, config: a.config || {} });
  const r = spawnSync(process.execPath, [modulePath], {
    cwd: ctx.root,
    input: payload,
    encoding: 'utf8',
    timeout: rule.timeoutMs ?? 10000,
  });
  if (r.error) return fail(`插件执行失败：${r.error.message}`);
  if (r.status !== 0) return fail(`插件退出码 ${r.status}：${String(r.stderr || '').trim().slice(-400)}`);
  let out;
  try {
    out = JSON.parse(r.stdout || '{}');
  } catch {
    return fail('插件输出不是 JSON');
  }
  const list = Array.isArray(out.violations) ? out.violations : [];
  return {
    violations: list.map((v) => ({
      ruleId: rule.id,
      severity: rule.severity,
      message: rule.message,
      file: v && v.file,
      line: v && v.line,
      detail: (v && (v.message || v.detail)) || '',
    })),
  };
}

function evalEnv(rule) {
  const a = rule.assert.args;
  const value = process.env[a.name];
  if (!value) return { violations: [{ ruleId: rule.id, severity: rule.severity, message: rule.message, detail: `${a.name} 未设置` }] };
  const forbidden = a.forbiddenValues || [];
  const dbName = (/(?:Database|Initial Catalog)\s*=\s*([^;]+)/i.exec(value) || [])[1]?.trim() || '';
  if (dbName && forbidden.some((f) => String(f).toUpperCase() === dbName.toUpperCase())) {
    return { violations: [{ ruleId: rule.id, severity: rule.severity, message: rule.message, detail: `${a.name} 指向禁用库 ${dbName}` }] };
  }
  return { violations: [] };
}

function evalCommand(rule, ctx) {
  if (!ctx.withCommands) return { skipped: 'commands-disabled' };
  const a = rule.assert.args;
  const cwd = a.cwd ? path.join(ctx.root, a.cwd) : ctx.root;
  const run = String(a.run)
    .replace(/\{old\}/g, ctx.range?.old ?? '')
    .replace(/\{new\}/g, ctx.range?.new ?? '');
  // 时限只认规则顶层的 timeoutMs：缺省 10 分钟（旧 commit-check 的 BUILD_TIMEOUT_MS 口径），null = 显式不限时（产品门缺省，旧 verify 同口径）。
  const timeout = rule.timeoutMs === undefined ? 600000 : rule.timeoutMs;
  // expectExit：声明的预期退出码（非负整数或其数组）；缺省只有 0 算通过。
  const expected = a.expectExit === undefined ? [0] : (Array.isArray(a.expectExit) ? a.expectExit : [a.expectExit]);
  const meta = { name: a.name, command: run };
  const r = spawnSync(run, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: timeout ?? undefined,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...(a.env || {}) },
  });
  if (r.error) {
    const timedOut = r.error.code === 'ETIMEDOUT';
    const detail = timedOut
      ? `[超时] 命令超过 ${timeout >= 1000 ? `${Math.round(timeout / 1000)}s` : `${timeout}ms`} 未结束，已终止：${run}\n${String((r.stdout || '') + (r.stderr || ''))}`
      : `[spawn 失败] ${r.error.code || r.error.message}\n${String((r.stdout || '') + (r.stderr || ''))}`;
    return { ...meta, violations: [{ ruleId: rule.id, severity: rule.severity, message: rule.message, detail }] };
  }
  if (r.status !== null && expected.includes(r.status)) return { ...meta, violations: [] };
  const raw = String((r.stdout || '') + (r.stderr || ''));
  // 缺省口径（未声明 expectExit）的失败详情保持原样（旧门禁输出对拍）；只要声明了 expectExit，不匹配就点明实际 / 期望退出码。
  let detail = a.expectExit === undefined
    ? raw.slice(-1500)
    : `[退出码] 实际 ${r.status}，期望 ${expected.join(' / ')}\n${raw.slice(-1500)}`;
  if (a.lockPattern) {
    try {
      const re = new RegExp(a.lockPattern);
      if (re.test(raw)) {
        detail = `${a.lockHint || '停掉占用进程后原路重试'}\n锁冲突行：\n${raw.split(/\r?\n/).filter((l) => re.test(l)).slice(0, 3).join('\n')}`;
      }
    } catch { /* 非法 lockPattern 按普通失败处理 */ }
  }
  return { ...meta, violations: [{ ruleId: rule.id, severity: rule.severity, message: rule.message, detail }] };
}

function waivedBy(waivers, violation) {
  return waivers.find((w) => w.rule === violation.ruleId
    && (!w.glob || (violation.file && globToRegExp(w.glob).test(posix(violation.file)))));
}

/** 命令规则的 deps 拓扑排序（依赖先跑；未在集合内的依赖忽略）。 */
function orderRules(rules) {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const out = [];
  const state = new Map();
  const visit = (rule) => {
    const st = state.get(rule.id);
    if (st === 2) return;
    if (st === 1) return; // 依赖环：保持原序，避免死循环
    state.set(rule.id, 1);
    const deps = rule.assert && rule.assert.kind === 'command' && Array.isArray(rule.assert.args.deps)
      ? rule.assert.args.deps
      : [];
    for (const dep of deps) {
      const target = byId.get(dep);
      if (target) visit(target);
    }
    state.set(rule.id, 2);
    out.push(rule);
  };
  for (const rule of rules) visit(rule);
  return out;
}

/** whenEnv 门槛（"VAR=value"）：与 when 是两道独立的门（旧 commit-check 语义）——不满足 = 规则不启用（配置意图）；
 *  畸形（缺「=」/变量名为空）同样不启用——推送门宁可少跑不误拦，但求值结果里记 invalid，让人看得见。 */
function whenEnvOk(value) {
  const eq = value.indexOf('=');
  return eq > 0 && process.env[value.slice(0, eq)] === value.slice(eq + 1);
}

/** 求值入口。changed = 变更面（暂存 / 范围 / 待写文件），只驱动 files 过滤与插件输入；
 *  restrict = 仓库面扫描收窄到的文件集——只有写前门 `--files` 传入；暂存 / 范围模式必须为 null（全仓扫描，与旧门禁一致）。 */
export function evaluateModel(model, { root, changed = null, diff = null, withCommands = false, faces = null, phases = null, waivers = [], range = null, restrict = null }) {
  const ctx = { root, changed, diff, withCommands, faces: model.faces || {}, range, restrict };
  const violations = [];
  const waived = [];
  const skipped = [];
  const passed = [];
  const failedIds = new Set();
  const faceSet = faces && faces.length ? new Set(faces) : null;
  const phaseSet = phases && phases.length ? new Set(phases) : null;
  for (const rule of orderRules(model.rules)) {
    if (rule.enabled === false) continue;
    if (faceSet && rule.face !== 'any' && !faceSet.has(rule.face)) continue;
    if (phaseSet && rule.phase !== 'always' && !phaseSet.has(rule.phase)) continue;
    if (rule.assert.kind === 'command' && Array.isArray(rule.assert.args.deps)) {
      const failedDep = rule.assert.args.deps.find((d) => failedIds.has(d));
      if (failedDep) {
        skipped.push({ ruleId: rule.id, reason: 'dep', deps: [failedDep] });
        continue;
      }
    }
    // 门序与旧 commit-check 一致：文件面裁剪 → whenEnv → when（决定「没命中」与「未配置」各自打哪种 SKIP）。
    if (changed && rule.files && !fileFilterMatch(rule.files, changed)) {
      skipped.push({ ruleId: rule.id, reason: 'files' });
      continue;
    }
    if (rule.whenEnv !== undefined) {
      const value = String(rule.whenEnv);
      if (!whenEnvOk(value)) {
        skipped.push({ ruleId: rule.id, reason: 'whenEnv', whenEnv: value, invalid: value.indexOf('=') <= 0 });
        continue;
      }
    }
    // pkg: 谓词读规则 cwd 下的 package.json（与 evalCommand 同一解析；缺省仓库根）——旧 commit-check(entry.cwd) / verify(gate.folder) 口径。
    const pkgDir = rule.assert.args && rule.assert.args.cwd ? path.join(root, rule.assert.args.cwd) : root;
    if (!whenSatisfied(rule.when, root, pkgDir)) {
      skipped.push({ ruleId: rule.id, reason: 'when', when: rule.when || [] });
      continue;
    }
    let outcome;
    const kind = rule.assert.kind;
    if (kind === 'content') outcome = rule.scope === 'diff' ? evalContentDiff(rule, ctx) : evalContentRepo(rule, ctx);
    else if (kind === 'require') outcome = evalRequire(rule, ctx);
    else if (kind === 'absence') outcome = evalAbsence(rule, ctx);
    else if (kind === 'inventory') outcome = evalInventory(rule, ctx);
    else if (kind === 'navProperties') outcome = evalNavProperties(rule, ctx);
    else if (kind === 'plugin') outcome = evalPlugin(rule, ctx);
    else if (kind === 'env') outcome = evalEnv(rule);
    else if (kind === 'command') outcome = evalCommand(rule, ctx);
    else outcome = { violations: [{ ruleId: rule.id, severity: 'block', message: rule.message, detail: `未知原语 ${kind}` }] };
    if (outcome.skipped) {
      skipped.push({ ruleId: rule.id, reason: outcome.skipped });
      continue;
    }
    for (const violation of outcome.violations) {
      const waiver = waivedBy(waivers, violation);
      const enriched = { ...violation, ...(outcome.name ? { name: outcome.name } : {}), ...(outcome.command ? { command: outcome.command } : {}) };
      if (waiver) waived.push({ ...enriched, waiver });
      else {
        violations.push(enriched);
        failedIds.add(rule.id);
      }
    }
    if (outcome.violations.length === 0) {
      passed.push({ ruleId: rule.id, ...(outcome.name ? { name: outcome.name } : {}), ...(outcome.command ? { command: outcome.command } : {}) });
    }
  }
  const expired = [];
  return { violations, waived, skipped, passed, expired };
}
