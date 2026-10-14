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
  // 版本 7 = 版本 6 的全部键 + scopeSince（台账「机器派生改动面」的生效时刻，2026-10-09 审查 A1 干净版）。
  // 背景：委托代录的授权凭据是 `--delegated` 的**用户原话**——机器无法校验自由文本，AI 可无成本复用同一句
  // （本仓实测「可以」133 次、「确认」60 次），且台账 406 行里仅 6 行为 tty。整条授权链的源头不可核对，
  // 下游的哈希链/指纹对账/内容绑定全建得很好却是建在空地基上。
  // 干净版解法：**改动面改由机器派生，AI 无输入面**——confirm-doc 落账时自动记
  // `scope:{files:[…], sha256}`（被确认文档 + `git status --porcelain` 实测的未提交改动集，归一去重排序后
  // 取 sha256）。AI 无法伪造这个字段，因为它根本不参与输入；事后对质问的是「这 N 个文件」，而不是一句可复用的原话。
  // 本版本只加一个开关键：**缺键（v1-v6）时该子检查整体跳过**，存量 406 行零新增告警；抄全键仍是铁律。
  7: {
    moduleSince: '2026-09-22',
    check14Since: '2026-09-26',
    confirmDocsEffective: '2026-09-27',
    confirmIncidentsEffective: '2026-09-28',
    bindingTs: '2026-09-28',
    check17UnclosedAfter: '0.8.0',
    stageGateSince: '2026-09-29',
    riskLevelSince: '2026-10-01',
    verifySince: '2026-10-07',
    verifyDocSince: '2026-10-08T09:37:35Z',
    // 生效「时刻」（ISO 8601，UTC）而非日期：本日 04:29Z 已有一批旧口径台账行写入，日期粒度会把它们
    // 纳入受审范围产出不可消退告警——沿 v6 verifyDocSince 升级为时刻的同款教训。
    // 消费方：check-loop 检查 15 的 scope 子项（台账行 ts ≥ 本值才判）。
    scopeSince: '2026-10-09T11:24:43Z',
  },
  // 版本 8 = 版本 7 的全部键 + ledgerDocChainSince（台账哈希链的**链域**从「文件物理序」改为
  // 「按 doc 的逻辑序」，2026-10-12 ledger-doc-chain）。
  // 为什么改：原链 prevHash = 物理上一行的 hash，隐含「台账是单写者顺序追加」的前提。三种并发形态
  //   全部破坏它——① 两进程并发 append 读到同一末行 → 同 prevHash 分叉；② git merge 并集（见
  //   git-merge-jsonl.mjs）后 B 侧行被追加到 A 尾部之后 → A 侧链被劈开；③ 分片归并 compact 把分片行
  //   插进主台账中部 → 断链。且这三者都是**正常协作**,不是篡改——让正常协作长期撞 hard 门,门禁就会被
  //   绕过（--no-verify），治理失效。
  // 为什么按 doc 分域：台账行的天然主键是 doc（每行 = 某份文档的一次确认）。**同一 doc 内的先后有语义，
  //   doc 之间的先后没有语义**。把链的域对齐语义域是对既有判据的修正，不是削弱——就地改行、删行、
  //   插行三类篡改在 doc 链下一律仍被抓住（见 check-loop 检查 15）。
  // 本版本只加一个开关键：**缺键（v1-v7）时写入侧与校验侧都走旧物理链口径**，存量台账零变化、零新增告警。
  // 粒度取「时刻」而非日期（同 scopeSince / verifyDocSince 的教训）：本日已有一批旧口径行写入，
  //   日期粒度会把它们纳入新受审范围、产出不可消退告警。
  // 消费方：confirm-doc appendLedger（写入侧取前驱）+ check-loop 检查 15（校验侧按行分域）。
  8: {
    moduleSince: '2026-09-22',
    check14Since: '2026-09-26',
    confirmDocsEffective: '2026-09-27',
    confirmIncidentsEffective: '2026-09-28',
    bindingTs: '2026-09-28',
    check17UnclosedAfter: '0.8.0',
    stageGateSince: '2026-09-29',
    riskLevelSince: '2026-10-01',
    verifySince: '2026-10-07',
    verifyDocSince: '2026-10-08T09:37:35Z',
    scopeSince: '2026-10-09T11:24:43Z',
    ledgerDocChainSince: '2026-10-12T07:20:00Z',
  },
};

// ---- 版本 9–12（2026-10-13 B6b-1，自源仓 policy v9–v12 对齐回灌）----
// 构造式沿源仓 2026-10-10 收敛系列 6 的 merge 链（基线 + 显式差异）：kit v1–v8 键史原样保留不动，
// 新版本在 kit v8 之上做超集追加，消除「全量手抄日期键、漏抄即静默改语义」的脆弱点（v2 注释自警同源）。
// 键名与源仓逐字一致；kit 无源仓 v6–v8 的 check14HardSince / verifyHardSince——那两个键的消费段
// （检查 14 hard 档 / 凭证 hard 档）kit 仍为恒 advisory 面，未落地不引入。incidentRegrSince 随 B6b-2
//（§21–26 同批）落地并激活其消费段 §3x 防复发证据门。各锚日期 = kit 落地日口径：
//   发布当日（2026-10-13）= specVerifSince / attributionSince / convergenceSince（advisory 档沿源仓
//     convergenceSince「发布当日」先例——当日起、存量不追溯）；
//   发布次日（2026-10-14）= convergenceHardSince / reviewerSince / incidentRegrSince（沿源仓
//     check14HardSince「发布次日」先例——当日在途件不追溯、维持 advisory 留痕，锚起新违例才升格）。
// 缺键（v1–v8）→ 对应消费段整体跳过（存量零噪声）。抄全键仍是铁律。
const merge = (base, over) => ({ ...base, ...over });
const V9 = merge(POLICIES[8], {
  incidentRegrSince: '2026-10-14', // 检查 3x incident 防复发验证证据门生效锚（B6b-2 §3x 消费，hard 档「发布次日」口径——在途 fixed 件不追溯）；v1–v8 无此键 → 该段整体跳过
  specVerifSince: '2026-10-13',   // 检查 21 spec 验证落地核查生效锚（B6b-2 §21 消费；kit 落地 2026-10-13）；v1–v8 无此键 → 该检查整体跳过
  attributionSince: '2026-10-13', // 检查 24 incident 归因字段生效锚（B6b-2 §24 消费；kit 落地 2026-10-13）；v1–v8 无此键 → 该检查整体跳过
});
const V10 = merge(V9, {
  convergenceSince: '2026-10-13', // 检查 23 判据级收敛对账生效锚（B6b-2 §23 advisory 档消费；kit 落地 2026-10-13）；v1–v9 无此键 → 该检查整体跳过
});
const V11 = merge(V10, {
  convergenceHardSince: '2026-10-14', // 检查 23 证据无效 hard 锚（B6b-2 §23 hard 档消费；kit 落地 2026-10-14）；v1–v10 无此键 → 维持 warning
});
const V12 = merge(V11, {
  reviewerSince: '2026-10-14',    // 检查 1 独立复核上下文标识生效锚（B6b-2 检查 1 扩展消费；kit 落地 2026-10-14）；v1–v11 无此键 → 该子检查整体跳过
});
Object.assign(POLICIES, { 9: V9, 10: V10, 11: V11, 12: V12 });

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

// ---- 台账 doc 链前驱（2026-10-12 ledger-doc-chain）----
// 单源：confirm-doc appendLedger（写入侧取前驱）与 check-loop 检查 15（校验侧判接续）共用同一语义。
//   ledgerDocChainActive(policy)：锚存在且为合法 ISO 时刻 → 新口径生效；缺键（v1-v7）→ 旧物理链。
//   ledgerDocChainPrev(rows, doc)：rows 为物理序的已解析台账行，返回该 doc **最后一个带 hash 行**的
//   hash，无则 ''（链段重启）。取不到带 hash 的行时返回 ''，与旧口径「末行无 hash → ''」同向。
// 为什么不做去重/合并：去重是**口径变更**（会改漏斗计数），属分片功能同批生效，不在本步。
export function ledgerDocChainActive(policy) {
  const s = policy && policy.ledgerDocChainSince;
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s);
}

export function ledgerDocChainPrev(rows, doc) {
  for (let i = (rows && rows.length ? rows.length : 0) - 1; i >= 0; i--) {
    const r = rows[i];
    if (r && r.doc === doc && typeof r.hash === 'string') return r.hash;
  }
  return '';
}

// ---- 台账 scope（机器派生改动面，2026-10-09 审查 A1 干净版）----
// scopeDigest(files) = {files, sha256}：files 归一（反斜杠→posix）、去重、排序；sha256 = files.join('\n') 的摘要。
// **单源**（confirm-doc 落账侧构造与 check-loop 检查 15 校验侧重算共用——防两处归一/排序口径漂移，
//   N3 教训同款）：任一侧改了口径而另一侧没改，台账会整体判失效。
// 边界（诚实声明）：scope 是**机器实测**的「确认时刻工作树处于改动态的文件集合」，不是「本次任务应改什么」
// 的语义判定——它能证明「你放行时盘面上就是这些文件在动」，不能证明「这些改动就是你要的」。
// 语义正确性仍由指纹（文档内容）+ commit diff（事后对质）承担。
export function scopeDigest(files) {
  const norm = [...new Set((Array.isArray(files) ? files : [])
    .map((f) => String(f).replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean))]
    .sort();
  return { files: norm, sha256: createHash('sha256').update(norm.join('\n'), 'utf8').digest('hex') };
}

// scopeMatches(row)：台账行自带的 scope 是否与按其 files 重算的结果逐字一致。
// 用于检出「行里改了 files 却没同步 sha256」的手改形态（哈希链能兜住就地改，但整文件重写可重建链——
//   同一信任边界内的第二道，见 ledgerChainHash 边界声明）。
export function scopeMatches(row) {
  if (!row || typeof row !== 'object' || !row.scope) return false;
  const s = row.scope;
  if (!Array.isArray(s.files) || typeof s.sha256 !== 'string') return false;
  return scopeDigest(s.files).sha256 === s.sha256;
}
