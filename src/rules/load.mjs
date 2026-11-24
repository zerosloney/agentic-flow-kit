// load — 规则模型装配（rules CLI 与 doctor 共用的唯一入口）：
// legacy（旧配置投影）← stack.<栈名>.json（kit 管理；多栈各带各的规则包，按文件名序叠加）← project.json（项目所有）← local.json（本机）。
import fs from 'node:fs';
import path from 'node:path';
import { loadLayer, mergeLayers, validateRule } from './model.mjs';
import { adaptLegacy } from './adapters.mjs';

const RULES_DIR = '.agents/rules';

/** 栈层文件：stack.<栈名>.json（按文件名排序 = 叠加顺序；层名取文件名去掉 .json）。 */
function stackLayerFiles(root) {
  let names = [];
  try {
    names = fs.readdirSync(path.join(root, RULES_DIR)).filter((f) => /^stack\.[A-Za-z0-9_-]+\.json$/.test(f)).sort();
  } catch { /* 没有 rules 目录 = 无栈层 */ }
  return names.map((file) => [`${RULES_DIR}/${file}`, file.slice(0, -'.json'.length)]);
}

/** 返回 { model, unsupported, layers }；layers = [{ name, rules, waivers, plugins }]（按叠加顺序，含 legacy）。 */
export function loadModel(root) {
  const { name, rules, waivers, faces, unsupported } = adaptLegacy(root);
  for (const rule of rules) validateRule(rule, `legacy:${rule.id}`);
  const layers = [{ name, rules, waivers, plugins: [], faces }];
  for (const [rel, layerName] of [
    ...stackLayerFiles(root),
    [`${RULES_DIR}/project.json`, 'project'],
    [`${RULES_DIR}/local.json`, 'local'],
  ]) {
    const layer = loadLayer(root, rel, layerName);
    if (layer) layers.push(layer);
  }
  return { model: mergeLayers(layers), unsupported, layers };
}
