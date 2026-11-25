// gate-summary：安装/升级后的门禁配置一览（只读、行级、不抛错）。
// 目的：泛化版把门禁规则从脚本内改为项目级配置；未配置 = SKIP。安装器必须把「哪些门在空转」说出来，
// 不允许装完静默无言（升级路径尤其如此：老装户的门禁可能从「内置执法」变成「未配置」）。
// 完整字段/校验口径见 doctor 的 `gate` 段与 .agents/notes/project-configs.md。
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonc } from '../rules/jsonc.mjs';

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

/** 返回 { configured: [id], missing: [id], invalid: [id] }；读取/解析失败按各自类归档。 */
export function scanGateConfigs(target) {
  const configured = [];
  const missing = [];
  const invalid = [];
  for (const [rel, id] of GATE_CONFIGS) {
    let text;
    try {
      text = fs.readFileSync(path.join(target, rel), 'utf8');
    } catch {
      missing.push(id);
      continue;
    }
    try {
      parseJsonc(text, rel);
      configured.push(id);
    } catch {
      invalid.push(id);
    }
  }
  return { configured, missing, invalid };
}
