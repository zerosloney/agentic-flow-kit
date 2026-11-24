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
export function resolveTargets(root, targets, ext, optional = false, allFiles = null) {
  const exts = Array.isArray(ext) ? ext : [];
  const files = new Set();
  const universe = () => allFiles || listFilesIn(root, '');
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
      if (!fs.existsSync(path.join(root, t))) {
        if (optional) return null;
        throw new RulesTargetError(`目标目录不存在：${t}`);
      }
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

const dotted = (obj, key) => key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);

/** when 谓词：pkg:<dotted> / env:KEY=VAL / 路径或 glob 存在性。数组为 AND。 */
export function whenSatisfied(items, root, allFiles = null) {
  if (!Array.isArray(items) || items.length === 0) return true;
  const pkg = readPkg(root);
  return items.every((raw) => {
    const item = String(raw);
    if (item.startsWith('env:')) {
      const body = item.slice(4);
      const eq = body.indexOf('=');
      if (eq <= 0) return false;
      return process.env[body.slice(0, eq)] === body.slice(eq + 1);
    }
    if (item.startsWith('pkg:')) return Boolean(dotted(pkg, item.slice(4)));
    const p = posix(item);
    if (hasGlobMeta(p)) {
      const re = globToRegExp(p);
      const files = allFiles || listFilesIn(root, staticPrefix(p).replace(/\/$/, ''));
      return files.some((f) => re.test(f));
    }
    return fs.existsSync(path.join(root, p));
  });
}

function fileFilterMatch(filter, changed) {
  if (!filter || !changed || changed.length === 0) return true;
  const exts = Array.isArray(filter.ext) ? filter.ext : [];
  const prefixes = Array.isArray(filter.prefix) ? filter.prefix : [];
  const globs = Array.isArray(filter.glob) ? filter.glob.map(globToRegExp) : [];
  if (!exts.length && !prefixes.length && !globs.length) return true;
  return changed.some((f) => {
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
  const files = resolveTargets(ctx.root, targets, ext, a.optional === true, ctx.allFiles);
  if (files === null) return { skipped: 'optional-target-missing' };
  const excludeRes = (a.exclude || []).map((g) => globToRegExp(g));
  const matchRes = [...(a.matches || []), ...(a.pattern ? [a.pattern] : [])].map((p) => new RegExp(p));
  const unlessRe = a.unless ? new RegExp(a.unless) : null;
  const allow = (a.allow || []).map((x) => ({ re: globToRegExp(x.glob), lineRe: x.pattern ? new RegExp(x.pattern) : null }));
  const violations = [];
  for (const rel of files) {
    if (ctx.changed && ctx.changed.length && !ctx.changed.some((c) => posix(c) === rel)) continue;
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
  const files = resolveTargets(ctx.root, a.files, ['.cs'], a.optional === true, ctx.allFiles);
  if (files === null) return { skipped: 'optional-target-missing' };
  const excludeRes = (a.exclude || []).map((g) => globToRegExp(g));
  const trigger = String(a.trigger);
  const requireText = String(a.require);
  const violations = [];
  for (const rel of files) {
    if (ctx.changed && ctx.changed.length && !ctx.changed.some((c) => posix(c) === rel)) continue;
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
  const hits = (ctx.allFiles || listFilesIn(ctx.root, '')).filter((f) => re.test(f) && !unless.some((u) => u.test(f)));
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
    if (ctx.changed && ctx.changed.length && !ctx.changed.some((c) => posix(c) === rel)) continue;
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
  const r = spawnSync(run, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: rule.timeoutMs || a.timeoutMs || 30000,
    env: { ...process.env, ...(a.env || {}) },
  });
  if (r.status === 0) return { violations: [] };
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/).slice(-8).join('\n');
  return { violations: [{ ruleId: rule.id, severity: rule.severity, message: rule.message, detail: out || `exit ${r.status}` }] };
}

function waivedBy(waivers, violation) {
  return waivers.find((w) => w.rule === violation.ruleId
    && (!w.glob || (violation.file && globToRegExp(w.glob).test(posix(violation.file)))));
}

/** 求值入口。 */
export function evaluateModel(model, { root, changed = null, diff = null, withCommands = false, faces = null, phases = null, waivers = [], today = null, range = null }) {
  const allFiles = null;
  const ctx = { root, changed, diff, withCommands, allFiles, range };
  const violations = [];
  const waived = [];
  const skipped = [];
  const faceSet = faces && faces.length ? new Set(faces) : null;
  const phaseSet = phases && phases.length ? new Set(phases) : null;
  for (const rule of model.rules) {
    if (rule.enabled === false) continue;
    if (faceSet && rule.face !== 'any' && !faceSet.has(rule.face)) continue;
    if (phaseSet && rule.phase !== 'always' && !phaseSet.has(rule.phase)) continue;
    if (!whenSatisfied(rule.when, root, allFiles)) {
      skipped.push({ ruleId: rule.id, reason: 'when' });
      continue;
    }
    if (changed && rule.files && !fileFilterMatch(rule.files, changed)) {
      skipped.push({ ruleId: rule.id, reason: 'files' });
      continue;
    }
    let outcome;
    const kind = rule.assert.kind;
    if (kind === 'content') outcome = rule.scope === 'diff' ? evalContentDiff(rule, ctx) : evalContentRepo(rule, ctx);
    else if (kind === 'require') outcome = evalRequire(rule, ctx);
    else if (kind === 'absence') outcome = evalAbsence(rule, ctx);
    else if (kind === 'inventory') outcome = evalInventory(rule, ctx);
    else if (kind === 'navProperties') outcome = evalNavProperties(rule, ctx);
    else if (kind === 'env') outcome = evalEnv(rule);
    else if (kind === 'command') outcome = evalCommand(rule, ctx);
    else outcome = { violations: [{ ruleId: rule.id, severity: 'block', message: rule.message, detail: `未知原语 ${kind}` }] };
    if (outcome.skipped) {
      skipped.push({ ruleId: rule.id, reason: outcome.skipped });
      continue;
    }
    for (const violation of outcome.violations) {
      const waiver = waivedBy(waivers, violation);
      if (waiver) waived.push({ ...violation, waiver });
      else violations.push(violation);
    }
  }
  const expired = [];
  return { violations, waived, skipped, expired };
}
