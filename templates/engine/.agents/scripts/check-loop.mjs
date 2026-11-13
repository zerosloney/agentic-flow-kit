// 用法:flow-kit run check-loop.mjs [--rev <sha>] [--all | --hygiene]
// 默认（现状，2026-11-11 起）：只跑 hard 6 段 = §1 §3x §8 §15 §23 §29（全部有阻断力）；
// §14 §17 §25 等历史段已退役或下沉（编号留疤不重排），演化史见下方日期注记。
// 2026-10-21 门禁极小化第 1 批：§17 退役删除；§1 配对/L3 三件、§3 配对/回路、§14 留痕降 WARN——
//   段仍在 hard 车道默认跑，但只报告不阻断（红线判低/L3 状态例外，保 hard 阻断）；hard 阻断面 =
//   红线判低(§1) + L3 状态(§1) + 回归证据(§3x) + 验收勾验(§8) + 确认指纹(§15) + 收敛对账(§23)。
// 2026-10-22 门禁收敛批 1：§3 三件套、§14 留痕、§25 路由预判三段由 hard 车道下沉 hygiene——
//   实测三段 blockers.push 均为 0（427 次 hard 运行产出 419 次 WARN、0 次阻断），占着默认关单/
//   pre-push 车道却从不拦任何东西；承载力已前移到动作时刻（§3 → closeout skill §0 第 2 项；
//   §14 → confirm-doc/stage-gates 落态前置门），下沉不丢校验，只改何时跑。
//   hard 车道现存 5 段 = §1 §3x §8 §15 §23（全部有阻断力）。
// 2026-10-22 门禁收敛批 4：§20 已退役（挂载条件为包源环境，本仓恒不触发）。编号留疤不重排。
// 2026-10-28 引擎测试面退役：§28 脚本覆盖对账随 `.agents/**/*.test.mjs` 与 run-tests 一并删除
//   （owner 决策：不再跑引擎面全量测试）。编号留疤不重排。
// 2026-10-28 引擎减重第一刀：hygiene 16 段（§2 §3 §4 §5 §9 §10 §14 §16 §18 §19 §21 §22 §24 §25
//   §26 §27）全部退役——实测一周 845 次运行 8028 条 WARN、0 条阻断；段体删除，编号留疤。
//   --hygiene / --all 从此等价，均只跑 hard 5 段。
// 2026-10-22 门禁收敛批 3：judgment-ledger 规则名归一（剥 WARN/NOTE 严重度前缀）——同一逻辑规则
//   因前缀写法不同被拆成两条 rule，污染 per-rule 计数与「连续 6 月 = 0」退役候选判据（实证 s27 的
//   「NOTE 回归清单临时脚本缺失」以带前缀的全名落账 114 次，与无前缀写法分裂）。
// 2026-10-22 门禁收敛批 2「信噪比」：advisory 告警（WARN/NOTE）按标签折叠输出（同类多行折为
//   「×N 条同类」单行，明细落 tmp/check-loop-warn.log）——**BLOCK 一律不折**；无标签条目逐条输出。
//   折叠只改呈现不改判据；实现见 warn-format.mjs（原锁折叠规则的 warn-format.test.mjs 已随引擎测试面退役 2026-10-28）。
// 2026-11-08 引擎减重档 2-G：三类高频纯 WARN（状态未确认 / L3 确认缺失 / 复核上下文缺失，近 30 天
//   台账 4185 条、纯检出不阻断）输出层默认静默——stderr 只留一行合计示意有量，judgments 落账与
//   折叠明细（tmp/check-loop-warn.log）完整保留；CHECK_LOOP_VERBOSE=1 恢复逐条（与折叠开关同门）。
// 2026-11-08 引擎减重档 3-U1：§23 登记式跳过退役（PREPUSH_SKIP_CONVERGENCE，2026-11-04 建，
//   仅首日一用、近 30 天零触发）——§23 恒跑；跨机证据不对称红改走人工立项处置。
// 2026-11-11 owner 拍板决策二：新增 §29 回归清单执法者配对（2026-11-10 审计 P1「168 条空执法者
//   长期无告警」的机器补位；锚 regrEnforcerSince=2026-11-12，锚前存量不追溯）。hard 阻断面新增
//   执法者配对(§29)；2026-10-22 gate-health「新增 hard 段须先退役一个」本次由 owner 显式拍板扩界（未退役段）。
// 现状（2026-10-28）：5 段全部 hard（§1 §3x §8 §15 §23）；2026-11-11 owner 拍板决策二新增 §29
//   回归清单执法者配对（审计 P1 168 条空执法者补位，扩界理由见 rule-budgets 同日注）→ 6 段全部 hard
//   （§1 §3x §8 §15 §23 §29）。
//   段数棘轮见 .agents/config/rule-budgets.txt（check-loop-sections 计数上限 6，退役一段同降一）。
// --hygiene / --all 等价（hygiene 段已全部退役，见上）。
// 扫描面（2026-10-28 减重第二刀）：s01/s15 默认只扫本轮 diff 触及的 workflow 文档（3s 级）；
//   CHECK_LOOP_FULL=1 全量（CI 兜底，见 azure-pipelines.yml）——本地只拦「本轮引入」。
import * as kit from './check-loop-kit.mjs';
import { formatWarnings, writeWarnLog, WARN_LOG_REL } from './warn-format.mjs';
import { recordRun } from './judgment-ledger.mjs';

// 基础设施解构铺平（4a）：段体自单文件时代逐字保留，名字由本解构供给——零漂移迁移
const {
  fs, os, path, spawnSync, createHash, createRequire, fileURLToPath,
  loadEnums, auditEnabled, loadKitPolicy, hasFreshVerifyLine, laneOfDoc, MARK_RE,
  SCRIPT_DIR, GIT, REV_ARG, REV, ROOT, ENUMS, inSet, stOkDoc,
  spawnGit, gitOut, linesOf, fmGet, WF, DOC_DIRS, blockers, warnings, kitPolicy, isTracked, docFiles,
  addedDateOf, warnEvidenceExempt, VERIFY_GREEN_RE, verifyEvidenceTruth,
  versionGreater, fmStatus, bindingSha256, readdirOrNull, isDirectoryOrNull,
} = kit;

import { run as s01_pairing } from './check-loop-sections/s01-pairing.mjs';
import { run as s03x_regr_evidence } from './check-loop-sections/s03x-regr-evidence.mjs';
import { run as s08_acceptance } from './check-loop-sections/s08-acceptance.mjs';
import { run as s15_fingerprint } from './check-loop-sections/s15-fingerprint.mjs';
import { run as s23_convergence_audit } from './check-loop-sections/s23-convergence-audit.mjs';
import { run as s29_regr_enforcer } from './check-loop-sections/s29-regr-enforcer.mjs';
// §2 §3 §4 §5 §9 §10 §14 §16 §18 §19 §21 §22 §24 §25 §26 §27 已退役（2026-10-28 引擎减重第一刀：
//   全部 hygiene 段为纯 WARN、零阻断；段体删除，编号留疤不重排）。

// 顺序 = 原单文件段序。仅 hard 车道（6 段，全部有阻断力）；hygiene 段已于 2026-10-28 全部退役。
// 编号是承重引用（2026-10-11 D3 定案）：§N 被 policy 锚名（check14Since）、机制台账「门禁位置」列、
// wiki 车道表、judgments rule 串跨文件引用——§7 空缺与 §3x 插号为历史疤，永不重编号（重编号=打断引用图）。
const SECTIONS = [
  { lane: 'hard', run: s01_pairing },
  { lane: 'hard', run: s03x_regr_evidence },
  { lane: 'hard', run: s08_acceptance },
  { lane: 'hard', run: s15_fingerprint },
  { lane: 'hard', run: s23_convergence_audit },
  { lane: 'hard', run: s29_regr_enforcer },
];
// hygiene 车道已全部退役（2026-10-28 引擎减重第一刀）：--hygiene 与 --all 等价，均只跑 hard 6 段。
if (kit.LOOP_MODE === 'hygiene') {
  console.error('check-loop: hygiene 段已全部退役（2026-10-28）——本次只跑 hard 6 段');
}
// §23 收敛对账登记式跳过已退役（2026-11-08 减重档 3-U1，头注有记）——§23 恒跑，无环境变量开关。
for (const section of SECTIONS) {
  section.run();
}
// --- 判定流水落账（judgment-ledger，灰度消费端数据底座）---
// 每次真实运行追加一行 per-rule 判定计数到 .agents/judgments.jsonl（本地 gitignore；fixture 经
// CHECK_LOOP_ROOT 守卫自动跳过）——mechanism-registry 月度对账与 advisory→hard 升格判定的数据源
// 由「人工 grep 输出」升级为 agg-judgments.mjs 查账。fail-open：落账失败不改变门禁裁决与输出契约。
recordRun({ root: ROOT, mode: kit.LOOP_MODE, blockers, warnings });
// --- 输出（banner 沿 sh 版格式 = 稳定输出契约：banner 后空行、条目 '- ' 前缀；文件名自称用 check-loop.mjs）---
// 告警聚合（2026-10-22 门禁收敛批 2「信噪比」）：**折 advisory（WARN / NOTE），一律不折 BLOCK**。
// 动机（实测）：一次 --all 跑出 17 条 WARN + 19 条 NOTE，其中同类多行 + 多行告警把 actionable 项淹掉——
// 告警不精确比告警多更伤，输出一旦不可读，门禁即退化形式。折叠后逐条明细仍完整落
// tmp/check-loop-warn.log（供排障与事后对质），不丢信息、不降判据。
// 开关口径：只在「真引擎自跑」时折叠——判据取 ROOT 下是否有脚本本体（.agents/scripts/check-loop.mjs），
// 夹具/临时仓从不落引擎副本（场景 91 用真 git 仓但无脚本本体），断言面因此零变化；
// CHECK_LOOP_VERBOSE=1 强制逐条（排障用）。worktree 检出同样带脚本，正常折叠。
// 实现落位：.agents/scripts/warn-format.mjs——本文件无 isMain 守卫（被 import 即全量执行并 exit），
// 聚合逻辑不可在此直接单测；抽成无副作用模块 warn-format.mjs（原锁折叠规则的 warn-format.test.mjs 已随引擎测试面退役 2026-10-28）。
const WARN_LOG = path.join(ROOT, 'tmp', 'check-loop-warn.log');
// R5-1b：脚本实体随包分发；优先包内 runtime 目录，夹具/旧布局回退项目内路径。
const SCRIPTS_DIR = process.env.FLOW_KIT_RUNTIME_SCRIPTS || path.join(ROOT, '.agents', 'scripts');
const selfRun = fs.existsSync(path.join(SCRIPTS_DIR, 'check-loop.mjs'));
const compactOn = selfRun && process.env.CHECK_LOOP_VERBOSE !== '1';
// 三类高频纯 WARN 默认静默（2026-11-08 档 2-G，与头注同源）：仅折叠门（compactOn）开启时静默——
//   夹具/VERBOSE=1 口径逐条输出不变。只滤 stderr 呈现：judgments 落账（recordRun 用全量 warnings）
//   与明细日志（writeWarnLog 写全量清单）不受影响，非这三类标签的 WARN 行为不变。
const QUIET_WARN_TAGS = ['WARN 状态未确认', 'WARN L3 确认缺失', 'WARN 复核上下文缺失'];
const isQuietWarn = (line) => QUIET_WARN_TAGS.some((t) => line.startsWith(`- [${t}]`));
const renderWarnings = (list) => {
  if (!compactOn) return formatWarnings(list, { enabled: false });
  writeWarnLog(list, WARN_LOG); // 完整明细照旧落盘（含静默三类）——静默只作用于 stderr
  const quiet = list.filter(isQuietWarn);
  const rest = list.filter((line) => !isQuietWarn(line));
  const out = [];
  if (rest.length) out.push(formatWarnings(rest, { enabled: true, logNote: WARN_LOG_REL }));
  if (quiet.length) out.push(`- ${quiet.length} 条高频 WARN 已静默（状态未确认/L3 确认缺失/复核上下文缺失；明细 CHECK_LOOP_VERBOSE=1）`);
  return out.join('\n');
};
if (blockers.length) {
  process.stderr.write(`闭环骨架断档（check-loop.mjs）— HARD-BLOCK:\n\n${blockers.join('\n')}\n\n`);
  if (warnings.length) process.stderr.write(`WARN（advisory,不阻断）:\n\n${renderWarnings(warnings)}\n`);
  process.exit(1);
}
if (warnings.length) {
  process.stderr.write(`check-loop.mjs WARN（advisory,不阻断）:\n\n${renderWarnings(warnings)}\n`);
}
// C1（2026-10-28）：FULL 手动审计末尾跑合并语义对拍探针——P0-A 修复（first-parent diff）被退化回
// git show 时立红。仅本地 FULL（无 --rev/worktree、无夹具根）自动跑；探针可独立手动直跑。
if (kit.FULL_SCAN && !kit.REV && !process.env.CHECK_LOOP_ROOT) {
  const probe = kit.spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'check-loop-rev-semantics.mjs')], { stdio: 'inherit' });
  if (probe.status !== 0) {
    process.stderr.write('闭环骨架断档（check-loop.mjs）— 合并语义对拍探针未过（check-loop-rev-semantics.mjs）——REV 面实现疑似退化。HARD-BLOCK\n');
    process.exit(1);
  }
}
process.exit(0);
