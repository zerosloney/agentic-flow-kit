// rules — 规则包 CLI（v1，实验性）：validate / explain / check。
// 旧配置由 adapters 投影；`.agents/rules/{stack.<栈名>,project,local}.json` 存在时按层覆盖（后者替换同 id）。
import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { splitWaivers } from '../rules/model.mjs';
import { loadModel } from '../rules/load.mjs';
import { recordPluginStatus } from '../rules/plugin-status.mjs';
import { collectDiff, evaluateModel } from '../rules/evaluate.mjs';
import { stringifyYaml } from '../rules/yaml.mjs';

const LEGACY_FILES = [
  '.agents/hooks/architecture-redlines.json',
  '.agents/hooks/delete-guard.config.json',
  '.agents/hooks/audit-fields.json',
  '.agents/hooks/commit-check.config.json',
  '.agents/config/product-gates.json',
  '.agents/config/notify-guard.json',
  '.agents/config/project-faces.json',
  '.agents/config/local-gates.json',
  '.agents/config/rule-budgets.json',
];

function findLegacyFiles(root) {
  const found = [];
  for (const rel of LEGACY_FILES) {
    if (fs.existsSync(path.join(root, rel))) found.push(rel);
  }
  const cfgDir = path.join(root, '.agents', 'config');
  try {
    if (fs.existsSync(cfgDir)) {
      const extraGates = fs.readdirSync(cfgDir).filter((f) => /^product-gates\..+\.json$/.test(f));
      for (const g of extraGates) {
        found.push(`.agents/config/${g}`);
      }
    }
  } catch {}
  return found;
}

function detectProjectMeta(root) {
  let name = path.basename(root);
  let stack = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name) name = pkg.name;
  } catch {}
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'manifest.json'), 'utf8'));
    if (manifest.stack) stack = manifest.stack;
  } catch {}
  return { name, stack };
}

function pickMessage(message, lang) {
  return lang === 'en' ? message.en : message.zh;
}

/** validate 的引用 / 语义检查（schema 已由 loadModel 把关）：只报「配置可读但永远不成立或指向不存在」的问题。
 *  同 id 跨层是合法覆盖机制，只有层内重复才算问题。 */
function collectFindings(root, layers, model) {
  const findings = [];
  const ruleIds = new Set(model.rules.map((r) => r.id));
  for (const layer of layers) {
    const seen = new Set();
    layer.rules.forEach((rule, i) => {
      if (seen.has(rule.id)) findings.push(`${layer.name}: rules[${i}] id「${rule.id}」在本层重复`);
      seen.add(rule.id);
      for (const item of rule.when || []) {
        // pkg: 空路径 / env: 缺「=」= 永不成立；pkg: 路径里的空段与旧脚本一样被忽略，不算问题。
        const never = item.startsWith('pkg:')
          ? !item.slice(4).trim()
          : item.startsWith('env:') && item.slice(4).indexOf('=') <= 0;
        if (never) findings.push(`${layer.name}: rules[${i}] when 谓词永不成立：「${item}」`);
      }
      if (typeof rule.whenEnv === 'string' && rule.whenEnv.indexOf('=') <= 0) {
        findings.push(`${layer.name}: rules[${i}] whenEnv 写法有误（应为 KEY=VAL）：「${rule.whenEnv}」`);
      }
    });
    layer.waivers.forEach((w, i) => {
      if (!ruleIds.has(w.rule)) findings.push(`${layer.name}: waivers[${i}] 指向不存在的规则「${w.rule}」`);
    });
    (layer.plugins || []).forEach((p, i) => {
      if (!fs.existsSync(path.join(root, '.agents', 'rules', 'plugins', `${p.module}.mjs`))) {
        findings.push(`${layer.name}: plugins[${i}] 插件模块不存在：.agents/rules/plugins/${p.module}.mjs`);
      }
    });
  }
  return findings;
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
      return 2;
    }
    const legacy = loaded.layers[0];
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
    if (flag(args, 'json')) process.stdout.write(`${JSON.stringify({ written: rel, count: body.rules.length })}\n`);
    else console.log(t('rules.initWritten', { count: body.rules.length, rel }));
    return 0;
  }

  if (sub === 'export') {
    const outRel = typeof args.out === 'string' ? args.out : 'flow-rules.yml';
    const outAbs = path.resolve(root, outRel);
    if (fs.existsSync(outAbs) && !flag(args, 'force')) {
      console.error(t('rules.exportExists', { rel: outRel }));
      return 2;
    }
    const legacyFiles = findLegacyFiles(root);
    const { name, stack } = detectProjectMeta(root);

    const legacy = loaded.layers.find((l) => l.name === 'legacy') || { rules: [], waivers: [], faces: {} };
    const projectLayer = loaded.layers.find((l) => l.name === 'project');

    const faces = {
      ...(legacy.faces || {}),
      ...(projectLayer?.faces || {}),
    };

    const rulesMap = new Map();
    for (const r of legacy.rules || []) {
      const { source, ...rest } = r;
      rulesMap.set(rest.id, rest);
    }
    if (projectLayer) {
      for (const r of projectLayer.rules || []) {
        const { source, ...rest } = r;
        rulesMap.set(rest.id, rest);
      }
    }

    const waivers = [
      ...(legacy.waivers || []),
      ...(projectLayer?.waivers || []),
    ];

    const body = {
      version: 1,
      name,
      ...(stack ? { extends: [`preset:stack/${stack}`] } : {}),
      faces,
      rules: [...rulesMap.values()],
      waivers,
    };

    const header = `# 由 \`flow-kit rules export\` 自动合拢生成（${new Date().toISOString().slice(0, 10)}）。\n` +
      `# 本文件为统一声明式规则中心（已合拢 ${legacyFiles.length} 个碎片配置文件）。\n` +
      `# 规则校验：flow-kit rules validate\n` +
      `# 门禁执行：flow-kit rules check\n`;

    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, header + stringifyYaml(body), 'utf8');

    if (flag(args, 'json')) {
      process.stdout.write(`${JSON.stringify({
        written: outRel,
        rulesCount: body.rules.length,
        waiversCount: body.waivers.length,
        legacyFiles,
      }, null, 2)}\n`);
    } else {
      console.log(t('rules.exportWritten', {
        rel: outRel,
        rulesCount: body.rules.length,
        filesCount: legacyFiles.length,
      }));
    }
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
      // timeoutMs 原值输出：缺省（键不出现）= 原语默认上限，null = 不限时，数字 = 上限（毫秒）。
      console.log(JSON.stringify({ id: rule.id, source: rule.source, enabled: rule.enabled !== false, face: rule.face, phase: rule.phase, severity: rule.severity, timeoutMs: rule.timeoutMs, scope: rule.scope || 'repo', when: rule.when || [], whenEnv: rule.whenEnv || null, files: rule.files || null, assert: rule.assert, message: rule.message ? pickMessage(rule.message, lang) : null, waivers: active.filter((w) => w.rule === rule.id) }, null, 2));
      return 0;
    }
    const findings = collectFindings(root, loaded.layers, model);
    if (flag(args, 'json')) {
      process.stdout.write(`${JSON.stringify({ ok: findings.length === 0, findings, rules: model.rules.length, layers: loaded.layers.map((l) => l.name), waivers: active.length, expired: expired.length, unsupported: loaded.unsupported }, null, 2)}\n`);
      return findings.length ? 2 : 0;
    }
    console.log(t('rules.validated', {
      rules: model.rules.length,
      layers: loaded.layers.map((l) => l.name).join(' ← '),
      waivers: active.length,
      expired: expired.length,
    }));
    if (loaded.layers.some((l) => l.name === 'legacy')) console.log(t('rules.legacyHint'));
    if (loaded.unsupported.length) {
      console.log(t('rules.unsupported', { items: loaded.unsupported.map((u) => `${u.group}(${u.count})`).join(', ') }));
    }
    if (expired.length) console.log(t('rules.expiredWaivers', { count: expired.length }));
    for (const finding of findings) console.log(t('rules.validateFinding', { finding }));
    if (findings.length) {
      console.log(t('rules.validateFailed', { count: findings.length }));
      return 2;
    }
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
  // --prefix 按 id 段边界匹配：`arch.` 选中 arch.*；`product.api` 只选中 product.api 本身，不吞 product.api-tests。
  const scoped = prefixArg
    ? { ...model, rules: model.rules.filter((rule) => prefixArg.some((p) => rule.id === p || rule.id.startsWith(p.endsWith('.') ? p : `${p}.`))) }
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
      // 只有写前门 `--files` 把扫描收窄到待写文件；暂存 / 范围模式全仓扫描（旧门禁口径）。
      restrict: staged || range ? null : filesArg,
    });
    // 插件运行期异常留痕（.agents/cache/rules-plugins.json）→ doctor 告警；同一条插件再次正常求值即清除。
    // 只读禁用条目（{ id, enabled: false }）没有 assert，与求值器同口径先判存在。
    const pluginIds = new Set(scoped.rules.filter((rule) => rule.assert?.kind === 'plugin').map((rule) => rule.id));
    recordPluginStatus(root, [...result.passed, ...result.violations, ...result.waived]
      .filter((item) => pluginIds.has(item.ruleId))
      .map(({ ruleId, anomaly, detail }) => ({ ruleId, anomaly: anomaly === true, detail })));
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
    // whenEnv 不满足 = 配置意图不提示；写法畸形 = 该规则永远不会启用，必须让人看见。
    const badEnv = result.skipped.filter((s) => s.reason === 'whenEnv' && s.invalid);
    if (badEnv.length) console.log(t('rules.whenEnvInvalid', { items: badEnv.map((s) => `${s.ruleId}（${s.whenEnv}）`).join('、') }));
    if (expired.length) console.log(t('rules.expiredWaivers', { count: expired.length }));
    if (loaded.unsupported.length) {
      console.log(t('rules.unsupported', { items: loaded.unsupported.map((u) => `${u.group}(${u.count})`).join(', ') }));
    }
    return block.length ? 1 : 0;
  } catch (e) {
    console.error(t('rules.configError', { message: e.message }));
    return 2;
  }
}
