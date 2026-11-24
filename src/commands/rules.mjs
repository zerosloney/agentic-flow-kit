// rules — 规则包 CLI（v1，实验性）：validate / explain / check。
// 旧配置由 adapters 投影；`.agents/rules/{stack,project,local}.json` 存在时按层覆盖（后者替换同 id）。
import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { loadLayer, mergeLayers, splitWaivers, validateRule } from '../rules/model.mjs';
import { adaptLegacy } from '../rules/adapters.mjs';
import { collectDiff, evaluateModel } from '../rules/evaluate.mjs';

const RULE_FILES = [
  ['.agents/rules/stack.json', 'stack'],
  ['.agents/rules/project.json', 'project'],
  ['.agents/rules/local.json', 'local'],
];

function loadModel(root) {
  const legacy = adaptLegacy(root);
  for (const rule of legacy.rules) validateRule(rule, `legacy:${rule.id}`);
  const layers = [legacy];
  for (const [rel, name] of RULE_FILES) {
    const layer = loadLayer(root, rel, name);
    if (layer) layers.push(layer);
  }
  const unsupported = layers.flatMap((layer) => layer.unsupported || []);
  return { model: mergeLayers(layers), unsupported, layers: layers.map((l) => l.name) };
}

function pickMessage(message, lang) {
  return lang === 'en' ? message.en : message.zh;
}

export function rulesCommand({ args, t, lang }) {
  const sub = args._[1] || 'check';
  const root = path.resolve(args.target || '.');
  let loaded;
  let model;
  let active;
  let expired;
  try {
    loaded = loadModel(root);
    model = loaded.model;
    ({ active, expired } = splitWaivers(model.waivers));
  } catch (e) {
    console.error(t('rules.configError', { message: e.message }));
    return 2;
  }

  if (sub === 'init') {
    const rel = '.agents/rules/project.json';
    const abs = path.join(root, rel);
    if (fs.existsSync(abs) && !flag(args, 'force')) {
      console.error(t('rules.initExists', { rel }));
      return 1;
    }
    const legacy = adaptLegacy(root);
    for (const rule of legacy.rules) validateRule(rule, `legacy:${rule.id}`);
    const body = {
      version: 1,
      faces: legacy.faces,
      rules: legacy.rules.map(({ source, ...rest }) => rest),
      waivers: [],
    };
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `// 由 \`flow-kit rules init\` 从旧配置生成（${new Date().toISOString().slice(0, 10)}）。
// 本文件是项目规则层：同 id 覆盖 legacy/stack 层；删除某条即回退到下层。手改后跑 \`flow-kit rules validate\`。
${JSON.stringify(body, null, 2)}\n`);
    console.log(t('rules.initWritten', { count: body.rules.length, rel }));
    return 0;
  }

  if (sub === 'validate' || sub === 'explain') {
    if (sub === 'explain') {
      const id = args._[2];
      const rule = model.rules.find((r) => r.id === id);
      if (!rule) {
        console.error(t('rules.explainMissing', { id: id || '' }));
        return 2;
      }
      console.log(JSON.stringify({ id: rule.id, source: rule.source, enabled: rule.enabled !== false, face: rule.face, phase: rule.phase, severity: rule.severity, scope: rule.scope || 'repo', when: rule.when || [], files: rule.files || null, assert: rule.assert, message: rule.message ? pickMessage(rule.message, lang) : null, waivers: active.filter((w) => w.rule === rule.id) }, null, 2));
      return 0;
    }
    console.log(t('rules.validated', {
      rules: model.rules.length,
      layers: loaded.layers.join(' ← '),
      waivers: active.length,
      expired: expired.length,
    }));
    if (loaded.layers.includes('legacy')) console.log(t('rules.legacyHint'));
    if (loaded.unsupported.length) {
      console.log(t('rules.unsupported', { items: loaded.unsupported.map((u) => `${u.group}(${u.count})`).join(', ') }));
    }
    if (expired.length) console.log(t('rules.expiredWaivers', { count: expired.length }));
    return 0;
  }

  if (sub !== 'check') {
    console.error(t('rules.usage'));
    return 2;
  }

  const staged = flag(args, 'staged');
  const range = typeof args.range === 'string' ? args.range : null;
  const filesArg = typeof args.files === 'string' ? args.files.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const faceArg = typeof args.face === 'string' ? args.face.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const phaseArg = typeof args.phase === 'string' ? args.phase.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const prefixArg = typeof args.prefix === 'string' ? args.prefix.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const scoped = prefixArg
    ? { ...model, rules: model.rules.filter((rule) => prefixArg.some((p) => rule.id.startsWith(p))) }
    : model;
  const rangeParts = typeof args['range-old'] === 'string' && typeof args['range-new'] === 'string'
    ? { old: args['range-old'], new: args['range-new'] }
    : (range && range.includes('..') ? { old: range.split('..')[0], new: range.split('..')[1] } : null);

  let diff = null;
  let changed = filesArg;
  try {
    if (staged || range) {
      diff = collectDiff(root, { staged, range });
      changed = diff.files;
    }
    const result = evaluateModel(scoped, {
      root,
      changed,
      diff,
      withCommands: flag(args, 'with-commands'),
      faces: faceArg,
      phases: phaseArg,
      waivers: active,
      range: rangeParts,
    });
    const block = result.violations.filter((v) => v.severity === 'block');
    const warn = result.violations.filter((v) => v.severity === 'warn');
    if (flag(args, 'json')) {
      process.stdout.write(`${JSON.stringify({ ok: block.length === 0, violations: result.violations, waived: result.waived, passed: result.passed, skipped: result.skipped, expired, unsupported: loaded.unsupported }, null, 2)}\n`);
      return block.length ? 1 : 0;
    }
    console.log(t('rules.checkSummary', {
      total: model.rules.length,
      fail: block.length,
      warn: warn.length,
      waived: result.waived.length,
      skipped: result.skipped.length,
    }));
    for (const v of result.violations) {
      const where = v.file ? `${v.file}${v.line ? `:${v.line}` : ''}` : '-';
      console.log(`${v.severity === 'block' ? '✗' : '⚠'} [${v.severity}] ${v.ruleId} ${where} ${pickMessage(v.message, lang)}`);
      if (v.detail) console.log(`   ${v.detail.split('\n').join('\n   ')}`);
    }
    if (result.waived.length) console.log(t('rules.waivedLine', { count: result.waived.length }));
    if (expired.length) console.log(t('rules.expiredWaivers', { count: expired.length }));
    if (loaded.unsupported.length) {
      console.log(t('rules.unsupported', { items: loaded.unsupported.map((u) => `${u.group}(${u.count})`).join(', ') }));
    }
    return block.length ? 1 : 0;
  } catch (e) {
    console.error(t('rules.configError', { message: e.message }));
    return e.code === 'RULES_TARGET' ? 1 : 2;
  }
}
