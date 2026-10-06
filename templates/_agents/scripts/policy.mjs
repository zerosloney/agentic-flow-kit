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
  // 版本 2 = 版本 1 的五个日期 + 检查 17 的 approved 锚 + 检查 19 的 stageGateSince + check14Since 后移至确认门实际上线日（2026-09-23 → 2026-09-26）。
  // 漏抄日期键会改动其他检查的生效日。
  2: {
    moduleSince: '2026-09-22',
    check14Since: '2026-09-26',
    confirmDocsEffective: '2026-09-27',
    confirmIncidentsEffective: '2026-09-28',
    bindingTs: '2026-09-28',
    check17UnclosedAfter: '0.8.0',
    stageGateSince: '2026-09-29', // 检查 19 逐阶段审计的生效日（2026-09-30 stage-gate-machine）；锚 = 台账 ts 的 UTC 日期（复核 P2-3：本批 ts 2026-09-29T17:33Z 落在受审范围，顺序合规故静默）；v1 无此键 → 该检查整体跳过
    riskLevelSince: '2026-10-01', // intent risk_level 双字段协议生效日（2026-10-01 hybrid-governance 落地 fill-intent 双写；2026-10-02 caliber-convergence 方案 C 引入消费）——此日前建档的 intent 无该字段不判 suspect；v1 无此键 → 双字段协议视为从未生效（单字段判）
  },
  // 版本 3 = 版本 1 的五个日期，仅确认门两锚后移至装户确认纪律全量执行日（2026-10-06）。
  // 背景（2026-10-06-v114-backflow-batch）：装户确认台账机制 09-27 上线但长期未运转——10-05 首次使用（demand-remain 链路），
  // 同日后半夜的 pml 批次仍未过账，纪律全量执行实始于 10-06；故锚定 10-06（首用日 10-05 作废：同日边界拦不干净，装户实测）。
  // 存量（< 2026-10-06）整体落入既有「存量豁免」，新档照常受管。以 v1 为基线、不夹带 v2 键激活；
  // 装户经 kit.json policyVersion: 3 选入，kit 仓自身维持 v1。
  3: {
    moduleSince: '2026-09-22',
    check14Since: '2026-09-23',
    confirmDocsEffective: '2026-10-06',
    confirmIncidentsEffective: '2026-10-06',
    bindingTs: '2026-09-28',
  },
  // 版本 4 = 版本 3 的五个日期 + 检查 18 的 delegationSince（委派台账对账生效日）。
  // 背景（2026-10-06 loop-audit-remediation）：delegations.md 台账记法自始为「任务一句话」（全表 0 行含
  // workflow 文件名），检查 18 匹配口径要求行含文件名且无生效日豁免——8 月底起的 L2/L3 存量在现口径下
  // 永远无法满足，产出 113 条不可消退 advisory，违反「无判定依据的行不产出不可消除噪声」红线。
  // 补锚后：日期 < delegationSince 的文档存量豁免；≥ 生效日的 L2/L3 done/fixed/closed 须在台账
  // （记法约定同步补「任务一句话含文件名」，见 delegations.md 头部）。缺键（v1-v3）→ 检查 18 维持
  // 原全量对账行为（向后兼容不放松）。装户经 kit.json policyVersion: 4 选入。
  4: {
    moduleSince: '2026-09-22',
    check14Since: '2026-09-23',
    confirmDocsEffective: '2026-10-06',
    confirmIncidentsEffective: '2026-10-06',
    bindingTs: '2026-09-28',
    delegationSince: '2026-10-06', // 检查 18 委派台账对账生效日（2026-10-06 loop-audit-remediation）；v1-v3 无此键 → 原全量对账行为
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
