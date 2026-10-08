// policy.mjs — check-loop 豁免锚的单源（policyVersion）
// 新豁免改 POLICIES 并升版本，不在 check-loop 里再写散落日期。
// kit.json 缺 policyVersion、或版本不在表内：回退版本 1（不启用版本 2 的 approved 锚）。
// audit 不在本表：缺省视为全量检查（已装仓库与无 kit 的测试夹具）；init 新装显式写 false。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
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
  // 版本 5 = 版本 2 的全部日期 + verifySince（测试绿机器凭证生效日，2026-10-07 verify-evidence）。
  // 基准：Anthropic AI-Native SDLC「make test before done」。三处消费：verify.mjs 绿行落账（无开关，
  // 纯事实记录）+ confirm-doc 置 done 门前置 advisory（24h 窗口）+ 检查 8 无 SHA 测试绿声明对账
  // （intent 首次加入 git ≥ verifySince 才判）。缺键（v1-v4）→ 两处判定整体跳过，存量零新增告警。
  // 注意本版本以 v2 为基线（本仓自用版本），不含 v3/v4 的装户后移锚——装户升 v5 视同同时接受
  // v2 基线的早期锚（装户已选 v3/v4 的，升 v5 前 doctor 会提示锚变化，逐键核对后再升）。
  5: {
    moduleSince: '2026-09-22',
    check14Since: '2026-09-26',
    confirmDocsEffective: '2026-09-27',
    confirmIncidentsEffective: '2026-09-28',
    bindingTs: '2026-09-28',
    check17UnclosedAfter: '0.8.0',
    stageGateSince: '2026-09-29',
    riskLevelSince: '2026-10-01',
    verifySince: '2026-10-07', // 测试绿机器凭证生效日（2026-10-07 verify-evidence）；v1-v4 无此键 → 前置与对账整体跳过
  },
  // 版本 6 = 版本 5 的全部键 + verifyDocSince（测试绿凭证与被证明对象的绑定日，2026-10-08 verify-doc-binding）。
  // 背景（2026-10-08 verify-doc-binding）：v5 的凭证行只记 {ts, exitCode, suite, passed, failed}，
  // **没有字段能承载「它是为哪一单落的」**，而两个消费方（confirm-doc 置 done 前置 / 检查 8 对账）
  // 都只问「全仓任意一份 24h 内绿行」→ 跑一次 verify 就能给全仓任意一单的「测试绿」声明背书，
  // 这是自证式验证的教科书形态（证据与被证明对象零绑定）。
  // 本版本只加一个开关键：**缺键（v1-v5）时两个消费方维持 v5 的全局行为逐字不变**（存量装户与存量
  // fixture 零变化、零新增告警）；本仓升 v6 后才按 doc 精确匹配。抄全键仍是铁律（见 v2 注释）。
  6: {
    moduleSince: '2026-09-22',
    check14Since: '2026-09-26',
    confirmDocsEffective: '2026-09-27',
    confirmIncidentsEffective: '2026-09-28',
    bindingTs: '2026-09-28',
    check17UnclosedAfter: '0.8.0',
    stageGateSince: '2026-09-29',
    riskLevelSince: '2026-10-01',
    verifySince: '2026-10-07',
    // 凭证按 doc 绑定的生效**时刻**（ISO 8601，含 T/Z）；v1-v5 无此键 → 两个消费方维持 v5 全局行为。
    // 2026-10-09 verifydoc-anchor：值从日期 '2026-10-08' 升级为时刻——本仓 v6 上线当日（本地 17:37 =
    // 09:37Z）之前 done 的单（selfmeasure 00:22Z / gate-roi-metrics 03:25Z）在日期粒度下被误纳入精确匹配、
    // 产 3 条不可消退 advisory（它们关单时 --doc 机制尚不存在，无从补证）；升级为时刻后按 done ts 精确比较，
    // 机制上线前的存量单退回 v5 全局布尔（不误报、不伪造），与检查 15/18 的生效日锚同构。
    // 消费方：检查 8 的 verifyDocInWindow（done ts ≥ 本值才启用精确匹配）。
    verifyDocSince: '2026-10-08T09:37:35Z',
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

// ---- 测试绿凭证判定（2026-10-07 verify-evidence；2026-10-08 verify-doc-binding 增 doc 绑定）----
// 单源（confirm-doc done 前置与 check-loop 检查 8 对账共用——防两处窗口字面量漂移，N3 教训）：
// hasFreshVerifyLine(lines, now, doc)：verifications.jsonl 的行数组里是否存在「ts 距 now ≤ 24h 且
// exitCode === 0」的绿行。坏行（非 JSON / 缺 ts）跳过不抛；窗口 24h = 覆盖「跑 verify → 跨会话/
// 隔夜 → 次日关单」节奏（spec 2026-10-07-verify-evidence 论证）。
//
// doc 绑定（2026-10-08 verify-doc-binding，第三参）：
//   doc 为空/缺省 → 逻辑与 2026-10-07 版**逐字相同**（全量行扫描）——v1-v5 装户走这条，零变化；
//   doc 非空     → 额外要求该行 `e.doc === doc`（**精确等值**，不做前缀/子串/形态匹配——
//                  沿 check8-digit-sha-misfire「文本启发式须可被实证兜底，禁以形态抢先分类」纪律）。
//   为什么必须精确：放宽成「包含即认」等于给跨单背书开后门，那正是本单要消灭的漏洞。
//   不带 doc 落账的行（CI 场景）**不给任何单背书**——doc 为 null 时 e.doc === doc 恒假。
export function hasFreshVerifyLine(lines, now = Date.now(), doc = null) {
  const byDoc = typeof doc === 'string' && doc !== '';
  for (const line of lines || []) {
    if (!line || !line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && e.exitCode === 0 && typeof e.ts === 'string') {
        if (byDoc && e.doc !== doc) continue;
        const t = Date.parse(e.ts);
        if (Number.isFinite(t) && now - t <= 24 * 60 * 60 * 1000) return true;
      }
    } catch { /* 坏行容忍跳过（confirmations.jsonl 同口径） */ }
  }
  return false;
}

// ---- 台账哈希链（2026-10-09 engine-quality-round2 D）----
// 单源（confirm-doc appendLedger 写入与 check-loop 检查 15 验链共用——判定零复刻）：
// ledgerChainHash(row, prevHash) = sha256(prevHash + JSON.stringify(row))。
//   row = 台账行**去掉 prevHash/hash 两字段**后的对象（键序 = 写入序，JSON.parse 保序 → 重算一致）；
//   prevHash = 上一行的 hash（上一行无 hash/文件首行 → ''——历史行零回填，链从首个带 hash 行起算）。
// 边界（诚实声明）：整文件重写可重建完整链，不可机器防——兜底 = 台账文件自身的 git 历史
//   （check-ledger-invariant 已扫 append-only 历史）；本链堵的是「就地改/删中间行」这一高频伪造面，
//   把主动伪造从静默可行抬到必留断链痕迹。
export function ledgerChainHash(row, prevHash) {
  return createHash('sha256').update((prevHash || '') + JSON.stringify(row)).digest('hex');
}
