// policy.mjs — check-loop 豁免锚的单源（policyVersion）
// 新豁免改 POLICIES 并升版本，不在 check-loop 里再写散落日期。
// kit.json 缺 policyVersion、或版本不在表内：回退版本 1（不启用版本 2 的 approved 锚）。
// audit 不在本表：缺省视为全量检查（已装仓库与无 kit 的测试夹具）；init 新装显式写 false。
import fs from 'node:fs';
import path from 'node:path';

export const POLICIES = {
  1: {
    moduleSince: '2026-09-22',
    check14Since: '2026-09-23',
    confirmDocsEffective: '2026-09-27',
    confirmIncidentsEffective: '2026-09-28',
    bindingTs: '2026-09-28',
  },
  // 版本 2 = 版本 1 的五个日期 + 检查 17 的 approved 锚 + 检查 19 的 stageGateSince + check14Since 前移至确认门实际上线日。
  // 漏抄日期键会改动其他检查的生效日。
  2: {
    moduleSince: '2026-09-22',
    check14Since: '2026-09-26',
    confirmDocsEffective: '2026-09-27',
    confirmIncidentsEffective: '2026-09-28',
    bindingTs: '2026-09-28',
    check17UnclosedAfter: '0.8.0',
    stageGateSince: '2026-09-29', // 检查 19 逐阶段审计的生效日（2026-09-30 stage-gate-machine）；锚 = 台账 ts 的 UTC 日期（复核 P2-3：本批 ts 2026-09-29T17:33Z 落在受审范围，顺序合规故静默）；v1 无此键 → 该检查整体跳过
  },
};

export function loadKitPolicy(root) {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'kit.json'), 'utf8'));
  } catch { /* 无 kit 或不可解析 */ }
  const requested = raw && Number.isInteger(raw.policyVersion) ? raw.policyVersion : 1;
  const policyVersion = Object.prototype.hasOwnProperty.call(POLICIES, requested) ? requested : 1;
  return {
    ...POLICIES[policyVersion],
    policyVersion,
    requestedVersion: requested,
    audit: raw && typeof raw.audit === 'boolean' ? raw.audit : undefined,
  };
}

export function auditEnabled(policy) {
  return policy.audit !== false;
}
