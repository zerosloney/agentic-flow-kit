// load — 规则模型装配（rules CLI 与 doctor 共用的唯一入口）：
// legacy（旧配置投影）← stack.<栈名> ← preset（通过 extends 引入）← project（flow-rules.yml / project.json）← local（本机）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLayer, mergeLayers, validateRule } from './model.mjs';
import { RulesConfigError } from './errors.mjs';
import { adaptLegacy } from './adapters.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = path.resolve(HERE, '../..');
const RULES_DIR = '.agents/rules';

export const PROJECT_CANDIDATES = [
  'flow-rules.yml',
  'flow-rules.yaml',
  '.agents/rules.yml',
  '.agents/rules.yaml',
  `${RULES_DIR}/project.yml`,
  `${RULES_DIR}/project.yaml`,
  `${RULES_DIR}/project.json`,
];

export const LOCAL_CANDIDATES = [
  `${RULES_DIR}/local.yml`,
  `${RULES_DIR}/local.yaml`,
  `${RULES_DIR}/local.json`,
];

/** 栈层文件：stack.<栈名>.(json|ya?ml)（按文件名排序 = 叠加顺序；层名取文件名去掉扩展名）。 */
function stackLayerFiles(root) {
  let names = [];
  try {
    names = fs.readdirSync(path.join(root, RULES_DIR))
      .filter((f) => /^stack\.[A-Za-z0-9_-]+\.(json|ya?ml)$/i.test(f))
      .sort();
  } catch { /* 没有 rules 目录 = 无栈层 */ }
  return names.map((file) => [`${RULES_DIR}/${file}`, file.replace(/\.(json|ya?ml)$/i, '')]);
}

/** 探测项目层规则文件相对路径（若不存在返回 null） */
export function findProjectRulesFile(root) {
  for (const rel of PROJECT_CANDIDATES) {
    if (fs.existsSync(path.join(root, rel))) return rel;
  }
  return null;
}

/** 探测本地层规则文件相对路径（若不存在返回 null） */
export function findLocalRulesFile(root) {
  for (const rel of LOCAL_CANDIDATES) {
    if (fs.existsSync(path.join(root, rel))) return rel;
  }
  return null;
}

/** 从内置 templates 解析 extends 预设层（形如 preset:stack/node 或 stack/node） */
function resolvePresetLayer(preset, root) {
  const m = String(preset || '').match(/^(?:preset:)?(?:stack\/)?([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const stack = m[1];
  // 若目标项目本地已存在 stack.<stack>.*，则由 stackLayerFiles 负责装载，此处避免重复
  const localDir = path.join(root, RULES_DIR);
  try {
    if (fs.existsSync(localDir)) {
      const existing = fs.readdirSync(localDir).some((f) => new RegExp(`^stack\\.${stack}\\.(json|ya?ml)$`, 'i').test(f));
      if (existing) return null;
    }
  } catch { /* 忽略读取错误 */ }

  const presetFile = path.join(KIT_ROOT, 'templates', 'profiles', stack, '.agents', 'rules', `stack.${stack}.json`);
  if (fs.existsSync(presetFile)) {
    return loadLayer(KIT_ROOT, path.relative(KIT_ROOT, presetFile), `preset:stack/${stack}`);
  }
  return null;
}

/** 返回 { model, unsupported, layers }；layers = [{ name, rules, waivers, plugins }]（按叠加顺序，含 legacy）。 */
export function loadModel(root) {
  const { name, rules, waivers, faces, unsupported } = adaptLegacy(root);
  for (const rule of rules) validateRule(rule, `legacy:${rule.id}`);
  const layers = [{ name, rules, waivers, plugins: [], faces }];

  // 1. 本地存在的 stack.* 层
  for (const [rel, layerName] of stackLayerFiles(root)) {
    const layer = loadLayer(root, rel, layerName);
    if (layer) {
      if (layer.plugins.length > 0) {
        throw new RulesConfigError(`${rel}: plugins 只能在项目层声明（flow-rules.yml / project.json），当前层为 ${layerName}`);
      }
      layers.push(layer);
    }
  }

  // 2. 项目层（优先 flow-rules.yml，其次 project.json 等）
  const projectRel = findProjectRulesFile(root);
  let projectLayer = null;
  if (projectRel) {
    projectLayer = loadLayer(root, projectRel, 'project');
  }

  // 3. 项目层声明的 extends 预设层（插入在项目层之前）
  if (projectLayer && Array.isArray(projectLayer.extends)) {
    for (const preset of projectLayer.extends) {
      const presetLayer = resolvePresetLayer(preset, root);
      if (presetLayer) layers.push(presetLayer);
    }
  }

  if (projectLayer) {
    layers.push(projectLayer);
  }

  // 4. 本地机器层（local.yml / local.json）
  const localRel = findLocalRulesFile(root);
  if (localRel) {
    const localLayer = loadLayer(root, localRel, 'local');
    if (localLayer) {
      if (localLayer.plugins.length > 0) {
        throw new RulesConfigError(`${localRel}: plugins 只能在项目层声明（flow-rules.yml / project.json），当前层为 local`);
      }
      layers.push(localLayer);
    }
  }

  return { model: mergeLayers(layers), unsupported, layers };
}

/**
 * 从已解析的规则模型提取 verify 阶段的 command 门禁清单
 * 转换为 verify 编排器所需的 gate 对象数组
 */
export function getVerifyCommandGates(model) {
  if (!model || !Array.isArray(model.rules)) return [];
  const gates = [];
  const seenIds = new Set();
  for (const rule of model.rules) {
    if (!rule || rule.enabled === false) continue;
    const phase = rule.phase || 'verify';
    if (phase !== 'verify' && phase !== 'always') continue;
    if (rule.assert?.kind !== 'command') continue;
    const rawId = String(rule.id || '').trim();
    if (!rawId) continue;
    const gateId = rawId.startsWith('product.') ? rawId.slice(8) : rawId;
    if (seenIds.has(gateId)) continue;
    seenIds.add(gateId);
    const name = rule.name
      || (rule.message && typeof rule.message === 'object' ? (rule.message.zh || rule.message.en) : rule.message)
      || gateId;
    const runCmd = rule.assert?.args?.run;
    const folder = rule.assert?.args?.cwd || '.';
    const env = rule.assert?.args?.env;
    const deps = rule.assert?.args?.deps;
    const when = rule.when;
    const timeoutMs = rule.timeoutMs;
    const fullRuleId = rawId;
    gates.push({
      id: gateId,
      cohort: 'product',
      name: String(name),
      cmd: `flow-kit rules check --with-commands --prefix ${fullRuleId}`,
      rawCmd: runCmd,
      folder: typeof folder === 'string' && folder.trim() ? folder : '.',
      type: 'shell',
      when,
      timeoutMs: timeoutMs ?? null,
      ...(Array.isArray(deps) && deps.length ? { deps: deps.map((d) => (d.startsWith('product.') ? d.slice(8) : d)) } : {}),
      ...(env && typeof env === 'object' && !Array.isArray(env) ? { env: { ...env } } : {}),
    });
  }
  return gates;
}

