// gate-summary：安装/升级后的门禁配置一览（只读、行级、不抛错）。
// 目的：泛化版把门禁规则从脚本内改为项目级配置；未配置 = SKIP。安装器必须把「哪些门在空转」说出来，
// 不允许装完静默无言（升级路径尤其如此：老装户的门禁可能从「内置执法」变成「未配置」）。
// 完整字段/校验口径见 doctor 的 `gate` 段与 .agents/notes/project-configs.md。
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonc } from '../rules/jsonc.mjs';
import { loadModel } from '../rules/load.mjs';

export const GATE_CONFIGS = [
  ['.agents/hooks/architecture-redlines.json', 'architecture-redlines'],
  ['.agents/hooks/delete-guard.json', 'delete-guard'],
  ['.agents/hooks/audit-fields.json', 'audit-fields'],
  ['.agents/hooks/commit-check.config.json', 'commit-check'],
  ['.agents/config/product-gates.json', 'product-gates'],
  ['.agents/config/test-impact-map.json', 'test-impact-map'],
  ['.agents/config/local-gates.json', 'local-gates'],
  ['.agents/config/project-faces.json', 'project-faces'],
];

// 规则族门：与 doctor 的 `gate coverage` 完全同口径——只看合并后的规则模型里有没有启用的该前缀规则，
// 不看物理配置文件（随装带的空清单 commit-check.config.json 不算「已配置」）。
// 其余两项（test-impact-map / project-faces）是选择器 / 面配置，不是规则族，仍按文件存在性判定。
export const RULE_FAMILIES = {
  'architecture-redlines': 'arch.',
  'delete-guard': 'delete.',
  'audit-fields': 'audit.',
  'notify-guard': 'notify.',
  'commit-check': 'commit.',
  'product-gates': 'product.',
  'local-gates': 'local.',
};

/** 返回 { configured: [id], missing: [id], invalid: [id] }；读取/解析失败按各自类归档。 */
export function scanGateConfigs(target) {
  const states = new Map();
  for (const [rel, id] of GATE_CONFIGS) {
    let text;
    try {
      text = fs.readFileSync(path.join(target, rel), 'utf8');
    } catch {
      states.set(id, 'missing');
      continue;
    }
    try {
      parseJsonc(text, rel);
      states.set(id, 'configured');
    } catch {
      states.set(id, 'invalid');
    }
  }
  // 规则族门按规则层重算；解析失败的文件保持 invalid（优先级最高），不参与重算。
  try {
    const { model } = loadModel(target);
    const enabled = model.rules.filter((r) => r.enabled !== false);
    for (const [id, prefix] of Object.entries(RULE_FAMILIES)) {
      if (states.get(id) === 'invalid') continue;
      states.set(id, enabled.some((r) => String(r.id).startsWith(prefix)) ? 'configured' : 'missing');
    }
  } catch { /* 规则层自身读不了：保持文件存在性的结果，由 doctor 的 rules 行报告 */ }

  const result = { configured: [], missing: [], invalid: [] };
  for (const [, id] of GATE_CONFIGS) result[states.get(id)].push(id);
  return result;
}
