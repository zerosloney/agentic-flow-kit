#!/usr/bin/env node
// check-loop: AI-Native 闭环骨架断档扫描（agentic-flow-kit 通用版；2026-09-26 check-loop-node 自 POSIX sh 全量迁移 node）
// 扫描 workflow/ 目录,输出 intent/spec/plan 配对、模板字段占位符、incidents 复盘三件套、新 intent 回路等断档。
// 迁移背景:sh 版为规避 MSYS fork 开销引入 awk 预扫临时文件 + fd 3/4 与 glob 序逐行对齐的隐式契约
//   （重排循环/加 continue 即静默错位）、四处临时文件无 trap 清理——node 为 kit 硬依赖,双语言实现面纯负担。
// 判定语义/消息文案/exit 语义与 sh 版逐条对齐（check-loop.test.mjs 37+ 场景为对齐安全网）；
//   输出 banner 保留「check-loop.sh」字样为稳定输出契约（doctor 按 WARN 行计数、pre-push 按 exit 码判定）。
// 旧入口 check-loop.sh 为 4 行兼容 shim（exec node 本文件）——.githooks/pre-push 与文档引用零改动继续有效。
//
// 严重性分级（沿用）:
//   - hard-block(阻断 push / CI):配对断裂 + 回路断档（影响三件套可追溯性与闭环电路）
//   - warning(打印提示,exit 0):其余卫生项（状态未确认 / 模板占位残留 / 引用漂移 / Adapter 一致性等）
// 违例输出到 stderr 并 exit 1；只剩警告时 exit 0。
//
// 检查项清单（编号/标题/severity 逐条沿 sh 版头部；编号承重——被引侧按 id 消费，不得增删改号）:
// 分道 lane 表（2026-10-13 B6b-1/B6b-2，源仓 SECTIONS 同款语义；机读单源 = LANE_OF 表，判据零变化只归属运行面）:
//   hard（默认关单/pre-push 面）: 1 配对（清单 5 状态/L3 复核在同遍循环实现，随 1 同道）、3 复盘三件套+回路、
//     3x 防复发验证证据门、8 验收对账、14 确认留痕、15 指纹链、17 发版收口、
//     23 判据级收敛对账（hard 档随 convergenceHardSince）、25 路由预判一致性（内容纯 WARN 不阻断）
//   hygiene（--hygiene / --all 的 WARN 面）: 2 模板占位、4 引用、6 角色契约与 Adapter（段 id '5'）、
//     7 阶段索引（段 id '6'）、9 kebab、10 迁移、11 生成物漂移、12 模块词表、13 体积预算、16 指标签名、
//     18 委派、19 逐阶段、20 引擎脚本测试覆盖、21 spec 验证落地 / 22 机制台账 / 24 归因 / 26 漏斗协议前
//     （21–26 六段检查 2026-10-13 B6b-2 落地，见下方清单与 LANE_OF）
//   1. 入口文档/spec/plan 同名配对(plan 配对全级别强制(2026-10-13 L0 退役——
//      原 L0 协作道豁免随级别退役删除);L2/L3 必须有 spec;
//      L1 plan 可即入口(级别恰为 L1 的 plan 无同名 intent/incident 不拦;级别缺失/L2/L3 落单照拦,
//      2026-10-13 B6b-2);L1 勾触达红线 → 「红线判低」hard——协作道不受理 STOP 级改动,
//      就高不就低,2026-09-30 hybrid-governance-risk-lanes)                            [hard-block]
//   2. 模板字段占位符残留(YYYY-MM-DD / <主题> 等未替换;<主题> 与 .md 同行 = 命名约定描述,豁免)  [warning]
//   3. incidents 复盘三件套完整性 + 状态严格枚举 + 新 intent 回路(回路断档=hard,其他=warning)
//   4. 引用有效性(文档/指令中引用的 .agents/ 路径必须存在;支持 fill-{a,b,c}.mjs 花括号展开与 fill-*.mjs 通配;
//      workflow 文档仅扫活跃态——终态件的引用是历史叙述,不扫,2026-09-27 audit-gate-hardening)  [warning]
//   5. intent/spec/plan 状态字段 + L3 独立复核                                       [warning]
//   6. 子智能体角色契约 + OpenCode/Trae/ZCode Adapter 一致性(含旧委派残留/钉死模型)  [warning]
//   7. 阶段索引同步(AGENTS.md 与 new-task.md 须双向索引全部阶段指令)                [warning]
//   8. intent 验收标准对账(新建:done 未勾验/缺节=hard,勾选缺证据=warning;存量聚合 warning,含「存量对账豁免」声明者出账)
//      + 场景覆盖子判据(2026-10-10 scenario-coverage,灰度 warning):同名 spec 有「验收场景」节时,
//        done intent 验收标准须逐场景 ID 引用(场景:S1…),缺引用=warning;spec 无该节则不适用(零变化)
//        + THEN 断言子判据(2026-10-11 then-assertion,灰度 warning):声明场景缺「- THEN」行=空壳场景,
//          聚合一条「场景无断言」warning(THEN 是机器对账锚;节不存在=零变化)
//        + 引用断链子判据(2026-10-11 dangling-ref,灰度 warning):验收标准引用 spec 未声明的场景 ID
//          (含 spec 无场景节)=「场景引用断链」warning——场景未覆盖的反向对账,共用同一次解析
//      **生效日锚=git 首次加入日期(2026-09-28 改;此前取文件名前 10 字符——命名规范强制的字段、
//      写早零成本,一条 hard 门可被平凡绕过;incident 2026-09-28-check8-git-anchor 实证)**:
//      非 git / 查不到加入记录 → 不可判定 → 走存量口径(不误报 hard)
//      证据可写在 [x] 行的续行（仓库通写法「（证据：…）」另起一行；全/半角冒号皆认）
//   9. 文件名英文 kebab-case(非 ASCII 文件名=warning,2026-09-11 规则)
//  10. 级别 vs 迁移文件一致性(L1/L2 入口文档加入提交触及迁移 SQL/Migrations=疑似判低,warning)
//  11. 生成物漂移：workflow/INDEX.md(2026-09-21 检索层) + workflow/DASHBOARD.md(2026-10-08 扩覆盖面)=warning;
//      wiki 侧（wiki/INDEX.md + 看板 DATA）由 doctor §6b 经 gen-wiki-board --check 校验，不在此重复
//      （2026-10-10：wiki 生成区此前零机器校验，现与 workflow 侧对称为 doctor 单路）；
//  12. frontmatter「模块:」合法性(枚举非法 / 2026-09-22 起新建缺字段=warning;词表单源 .agents/workflow-modules.txt)
//  13. 常驻面体积预算(超限=warning;判定单源 rule-budget.mjs——node 直跑,恒可跑)
//  14. 新 done 的 spec/plan 须在 git 历史里出现过 `状态: approved`(确认环节留痕,2026-09-22;恒 advisory 永不升级 hard)
//  15. 确认指纹对账(2026-09-27 起:approved/done 须 confirm-doc.mjs 确认指纹+台账配对,缺=hard-block;
//      两形态——TTY 亲手 / --delegated 对话委托代录,台账 source 如实区分,配对判据与 source 无关)
//      **受管准入 = 两条件取或(2026-09-28 改锚;此前仅「自报日期 ≥ 生效日」单条件——
//      新档只要把日期写早即整段跳过判定,incident 2026-09-28-confirm-gate-effective-date-anchor 实证)**:
//      ① 该 doc 在台账中有合法跳转行(stage∈approved/done/fixed/closed/superseded/cancelled,append-only
//         取末次)——「确认确实发生过」的机器事实,作者**不可顺手填**(经 confirm-doc 走确认门才产生);
//         **诚实边界**:台账是本地可写文件、本检查不验签,刻意手改台账仍可伪造——与「伪造 git 时间戳」
//         同属本地信任边界内不可机器防,事后对质靠 git 历史与台账(2026-09-28-claim-exceeds-fix 口径统一);
//      ② 自报日期(日期/发现/文件名兜底)≥ 生效日——覆盖「新档完全没跑 confirm-doc」的漏网面
//         (此类文档无台账行,仅靠 ① 会误判为存量豁免)。
//      两条件皆不满足 = 存量豁免(生效日前既有、从未走过确认门,不追溯)。
//      改锚收益:把「确认过却把日期写早以逃掉对账」这条攻破路径堵死(条件 ① 独立于自报日期成立)。
//      **注意条件②的日期阈值仍分档、且不等价**:docs 2026-09-27 / incidents 2026-09-28——本仓现役
//      incident 的「发现」均 ≤2026-09-27,故该档差异当前不显;新 incident 若把「发现」写成 09-27 且
//      无台账行,会因 incidents 阈值(09-28)被豁免,而同日期文档在 docs 档则受管。
//      (复核 P2-1 更正:此前本注释误称「incidents 常量退役 / 两档等价」,与代码 :eff 实际保留分档不符;
//       台账锚两档共用为真,条件②阈值分档亦为真,二者不是一回事——README 遣词为准确口径)
//      + incidents 覆盖(2026-09-27 gate-coverage:fixed/closed 须配对;open=起草态不加门;
//      不支持 open→closed 单跳——confirm-doc 状态机强制经 fixed)
//      + 放弃态覆盖(2026-09-27 closing-coverage:superseded/cancelled 入配对集,confirm-doc --to 唯一通道)
//      + 四终态内容绑定(2026-09-27 audit-gate-hardening;生效锚=台账行 ts≥2026-09-28——同日 p2-batch
//      自文档自报日期改锚:旧日期文档晚关单也绑定,3 份失配存量 ts 均 09-27 天然豁免):
//      按 prev 复原跳转前文本重算 sha256 与台账全量比对,不符=hard「确认内容漂移」;状态行保分隔符换值
//      (非规范格式不误伤);台账行缺 prev 降级 warning;关单编辑顺序新约定:勾验/回填先于关单确认,
//      confirm-doc 是最后一次写入)
//      + scope 子项(2026-10-09 审查 A1 干净版):受管行(ts≥policy.scopeSince,**时刻**锚,缺键 v1-v6 整体跳过
//      →存量 406 行零新增告警)须带机器派生的改动面 scope{files,sha256}——写入侧 confirm-doc.machineScope
//      自动派生(被确认文档 + `git status --porcelain` 未提交改动集),**AI 无输入面**,分辨力从
//      「一句可复用的用户原话」换成「机器实测的这 N 个文件」。判据:缺 scope→warning(灰度第一档);
//      scope.files 重算 sha256 不符→hard(「改了 files 没改摘要」= 同一信任边界内手改痕迹,兜住整文件
//      重写重建链后的二次篡改)。**边界**:scope 证「放行时盘面上哪些文件在动」,不证「这些改动语义正确」
//      ——后者由 fingerprint(文档内容绑定)+ commit diff(事后对质)承担,不越界宣称
//      + 并录批次审计子检查(2026-09-28 batch-ledger-audit 改判据;**读调用事实,不猜时间戳模式**):
//      判据 = 台账行按 batch 分组、组内 of>1(delegated 行) → warning「确认并录」;batch/seq/of 由
//      confirm-doc 写入时记录(那才是"本次调用落几份"确定已知的时刻)。旧判据「同 quote + 相邻 ts<2s」
//      整段退役——已实证四类失效:假阳性(合规逐件复用同句必然误报)/假阴性(换 quote 即零告警,
//      等于引导伪装)/噪声不可消退(不按日期门豁免,退役前本仓 22 条 advisory 中 14 条为该告警)/
//      quote 字段职责冲突(对质凭据 vs 并录指纹,现归还单一职责)。无 batch 的历史行静默跳过
//      (无判定依据的行不产出不可消除噪声——沿 audit-gate-hardening P3 教训)
//  17. 发版提交树上仍未收口的 intent/spec/plan [hard-block]
//      （2026-10-16 快径：当前树 package.json 无 version 字段 → 整段跳过——无 version 则版本变化提交
//      永不存在恒不触发，省全历史 git 扫描；源仓「registry 登记恒不触发」同款口径）
//  18. 委派台账对账 [warning]（policy v4 加 delegationSince 生效日豁免：日期早于锚的 L2/L3 存量豁免——
//      delegations.md 记法自始不含文件名、无豁免时 113 条不可消退；缺键 v1-v3 维持原全量对账）
//  19. 逐阶段审计（起草先于入口确认 / 台账审批顺序倒置） [warning]
//  20. 引擎脚本测试覆盖（包源环境：templates/_agents/scripts/ 下每个非 *.test.mjs 引擎脚本须有同名兄弟
//      .test.mjs，或在 .agents/scripts-test-exempt.txt 登记豁免；2026-10-01 gate-script-test-coverage） [warning]
//      判据 A=在途扫描(同名 spec/plan 为 draft 且日期≥stageGateSince 时判入口确认;plan 另判 L2/L3 的 spec);
//      判据 B=台账 approved 行按主题校验 intents≤specs≤plans 顺序(组内最早 ts 日期≥stageGateSince 才判);
//      stageGateSince 缺键(v1) → 本检查整体跳过;口径与 stage-gates.mjs / fill-* / confirm-doc 前置门互引
// 16. 量化断言指标签名对账 [warning](2026-09-28 起;登记表单源 .agents/metric-claims.txt):
// 判据 = 活跃态文档(draft/approved/open)中的 `{{指标名}}` 签名须替换为实时值,留签名=未回填=warning。
// **只查显式签名、不全文扫数字**(据实说明):本仓活跃文档「N 行/N 条/N 份」类表述数十处,绝大多数是
// 历史叙述(描述某次提交当时的规模,天然不随当前事实变化)——全文扫描对这些正确表述产生大量假阳性,
// 而本脚本已立红线「无判定依据的行不产出不可消除噪声」(P3:噪声淹没真漏点)。故本检查**假阳性恒 0**,
// 代价是覆盖面依赖作者登记。签名收窄为小写点分形态——装户模板占位符走全大写 SCREAMING_CASE
// (由 init 渲染替换,如构建/端口/项目名三类,不属本检查面)。未登记签名 / 取数器缺失 → fail-loud 出账
// (静默会让「登记了却没查」不可见);登记表不存在 → 静默跳过(未启用该检查的装户不应被噪声打扰)。
//  21. spec 验证落地核查(L2/L3 done spec 且 git 建档日 ≥ specVerifSince,「测试用例/验证计划/验证方式」
//      节无测试文件/验证命令引用 = warning;存量豁免;锚键缺 → 整段跳过)                            [warning]
//  22. 机制使用量台账(.agents/mechanism-registry.md 在场才启用;数据行行列数≠7/状态非法/待退役缺
//      处置期限/表无数据行 = warning;纯 WARN 永不 hard)                                            [warning]
//  23. 判据级收敛对账(L2/L3 done spec 锚后「验收判据」表逐判据×证据对账;advisory 档 convergenceSince
//      起证据无效 = warning,hard 档 convergenceHardSince 起路径不存在/命令不在全量门/无对应全绿行 =
//      hard-block;人工+空证据合法;无判据表两档都 = warning;存量豁免)                            [hard-block]
//  24. incident 归因字段核查(发现日 ≥ attributionSince 的新建件「来源/影响环境」必填且值在
//      incident.source.all / incident.env.all 枚举 = warning;legacy 回填件与存量豁免)              [warning]
//  25. 路由预判一致性(frontmatter「预判: kind= level=」在场才检;类型不符 intents≡require/incidents≡fix、
//      级别与「级别」字段不符、词表/枚举非法 = warning,不阻断;缺字段零告警;内容纯 WARN,lane=hard
//      随源仓 SECTIONS)                                                                          [advisory]
//  26. 闭环漏斗「协议前」占比动作阈值(workflow/metrics.md 漏斗表日历相邻两月协议前占比均 >30% =
//      warning,要求一轮归因;收口=0 的月不判;单月波动不触发)                                       [warning]
//  27. 回归清单活文档引用一致性(主台账 ∪ 分片中引用的仓库相对路径/workflow 文档须存在;弱档存在性
//      不猜语义;gitignore 易失前缀只 NOTE;判定单源 check-regression-consistency.mjs;关单时另有
//      confirm-doc done/closed 硬前置,本段是提交时可见面)                                          [warning]
//  3x(编号沿上游 3x 写法，非独立清单号——不入 1-N 配对面). incident 防复发
//      验证证据门(fixed/closed 且 git 建档日 ≥ incidentRegrSince,正文无自动化用例/回归清单引用 =
//      hard-block;存量豁免;锚键缺 → 整段跳过)                                                  [hard-block]
//
// 注：清单条目 5（状态字段+L3 复核）与 1（配对）在同一遍 intents/specs/plans 循环里实现（沿 sh 版代码结构）；
//    条目 6 的旧委派残留/钉死模型子项在「角色契约与 Adapter」代码段实现。
//
// 运行模式:CHECK_LOOP_ROOT 注入 fixture 根(全扫不过滤,非 git 时检查 10/14 跳过);
//   缺省 = git 仓库根(不在 git 仓库内 stderr 提示后 exit 0 跳过);仓库模式只扫已提交(HEAD)内容
//   (并行会话未跟踪半成品不拦别人的 push;ls-tree 失败退化为全扫,门禁不失效)。
//   --rev <sha>：把该提交剥到 commit 后挂到临时 detached worktree，ROOT 改到那里再扫。
//   原工作区的未提交改动不进入这次扫描。与 CHECK_LOOP_ROOT 同时出现则 exit 1。全 0 sha exit 1。
//   --all | --hygiene：分道运行面（2026-10-13 B6b-1，机读单源 LANE_OF）——缺省只跑硬门，口径见头部「用法」。
// 文档协议:机器字段一律由文件头 YAML frontmatter(受限子集:每行 `键: 值`)承载,本脚本只扫 frontmatter 取字段;
//   叙述性字段(独立复核/复盘三件套/验收勾验)按正文行锚定。枚举单源 .agents/workflow-enums.txt
//   (缺文件/缺键 fail-loud exit 1;经 workflow-enums.mjs 读取,CRLF 天然容忍)。
// 已确认状态: approved/done=已批或闭环; superseded/cancelled=放弃留档(仍算确认,不挡 push); incident: fixed/closed
// 用法:node .agents/scripts/check-loop.mjs [--rev <sha>] [--all | --hygiene] [--hardening] [--gate-stats]   （或经 check-loop.sh shim）
//   分道（2026-10-13 B6b-1，源仓 check-loop SECTIONS 同款口径）：默认只跑硬门（配对/判低/指纹/证据/
//   发版未收口）——关单/pre-push 门；--hygiene 只跑卫生段（索引/宿主/词表/指标签名/委派/体积预算等
//   WARN 面，不进关单——要看时另跑）；--all 两段都跑（= 分道前的裸跑全量）。--all 与 --hygiene 同给
//   报用法错。每段判据零变化，lane 只决定段归属哪个运行面；机读单源 = 本文件 LANE_OF 表。
//   --hardening：追加「加固门」（experiment 泳道 exploring 任务入 main 的转正门槛，hard-block；
//     .githooks/pre-push 对 remote=refs/heads/main 的推送传入；不占 1-20 编号，门体说明见加固门段注释）
// 测试:node templates/_agents/scripts/check-loop.test.mjs（fixture 注入 CHECK_LOOP_ROOT）
// import 契约（2026-10-08 checkloop-importable）：import { runCheckLoop, delegationResultRows, versionGreater, fmStatus, bindingSha256 }
//   ——零副作用；runCheckLoop({root?, rev?, mode?, hardening?}) 返回 { exitCode, blockers, warnings }（输出打印照旧，静默断言自行重定向 stderr）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadEnums } from './workflow-enums.mjs';
import { runCheck16 } from './check-metric-claims.mjs';
import { auditEnabled, loadKitPolicy, hasFreshVerifyLine, ledgerChainHash, ledgerDocChainActive, scopeMatches } from './policy.mjs';
import { laneOfEntry } from './stage-gates.mjs';
import { readLedgerRows, readLedgerEntries, LEDGER_REL } from './ledger-loader.mjs';
import { prunedHashes as prunedHashesOf } from './ledger-prune.mjs';
// 委派台账分片感知读（2026-10-13 ledger-shard-ledgers 回灌）：主台账 ∪ delegations.d/*.md 文本单源。
// 2026-10-25 source-port-batch：行解析与在场判据迁 delegation-presence.mjs 单源（检查 18 与
// confirm-doc 终态前置门共用同一判据，事后 WARN 与写入拦截不漂移）——本文件不再直接 import
// readDelegationsText（消费点改走 delegationRowsOf）。
import { delegationRowsOf, rowCovers } from './delegation-presence.mjs';
// MARK_RE：incident 留痕形态的单源（第七轮复核 N3——此前 check-loop 内联复制一份同口径字面量，
// 两处靠注释与人工同步；改为复用 stage-gates.mjs 的导出，从结构上消除漂移可能）
import { MARK_RE, approvedTraceHit } from './stage-gates.mjs';
// 卫生类检查已拆出（2026-10-08 selfmeasure-and-modularize）：检查 2/9/11/12/13 迁入 check-hygiene.mjs，
// 本文件只组装 ctx 并消费返回的文案数组（先例 = check-metric-claims.mjs 承载检查 16）。
// 调用点位置即输出顺序位：须留在检查 10 与 12 之间以保持 warnings 行序（稳定输出契约），见该模块内注释。
import { runCheckHygiene } from './check-hygiene.mjs';
// 检查 7 拆模块（2026-10-09 engine-quality-round2 A1）：阶段索引同步迁 check-stage-index.mjs
import { runCheckStageIndex } from './check-stage-index.mjs';
// 六段检查模块（2026-10-13 B6b-2，自 Shipyard.Material check-loop-sections s21–s26 回灌；出处沿革
// 留痕在包源仓 git 历史与 CHANGELOG）。模块形态 = 各文件 export run(ctx)：判定语义单源在段内，
// ctx 只传本文件既有共享面（helper 零复刻）；段体调 wall 位置即输出顺序位（稳定输出契约）。
import { run as runSpecVerif } from './check-spec-verif.mjs';
import { run as runRegistry } from './check-registry.mjs';
import { run as runConvergence } from './check-convergence.mjs';
import { run as runAttribution } from './check-attribution.mjs';
import { run as runPrejudgment } from './check-prejudgment.mjs';
import { run as runFunnel } from './check-funnel.mjs';
import { run as runRegressionConsistency } from './check-regression-consistency.mjs';
import { gateSeg, finishSegs, makeCollector } from './gate-seg.mjs';
// 判定流水落账（2026-10-11 judgment-ledger）：每次真实运行追加一行 per-rule 计数（观测面，fail-open）
import { recordRun } from './judgment-ledger.mjs';

// CHECK_LOOP_GIT：测试注入钩子（指向不存在/不可执行路径可稳定触发 spawn 异常）；未设置时与原行为逐字节一致（2026-10-05-gitout-fail-open）
const GIT = process.env.CHECK_LOOP_GIT || (process.platform === 'win32' ? 'git.exe' : 'git');

// usage：用法错误统一出口（2026-10-13 分道随源仓 usage() 口径逐字对齐；行 1 追加 kit 自有旗标）。
// 未知参数 / --rev 缺值 / --all 与 --hygiene 同给 → 此处 exit 1（CLI 专属路径；runCheckLoop import 面
// 不经此，mode 由 opts.mode 直给）。
function usage() {
  console.error('check-loop: 用法 node check-loop.mjs [--rev <sha>] [--all | --hygiene] [--hardening] [--gate-stats]');
  console.error('  默认只跑硬门（配对/判低/指纹/证据/发版未收口）。--hygiene 只跑卫生段。--all 两段都跑。');
  process.exit(1);
}
function takeOpts() {
  const args = process.argv.slice(2);
  const opts = { rev: null, mode: 'hard', hardening: false, gateStats: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rev') {
      opts.rev = args[++i] ?? '';
      if (!opts.rev) usage();
    } else if (args[i] === '--all') {
      if (opts.mode === 'hygiene') usage(); // 互斥组合报用法错
      opts.mode = 'all';
    } else if (args[i] === '--hygiene') {
      if (opts.mode === 'all') usage();
      opts.mode = 'hygiene';
    } else if (args[i] === '--hardening') {
      opts.hardening = true; // 加固门（2026-09-30 hybrid-governance-explore-hardening）：pre-push 对 main 目标传入
    } else if (args[i] === '--gate-stats') {
      opts.gateStats = true; // 门禁 ROI 落盘（2026-10-08 gate-roi-metrics）：默认路径输出逐字节不变
    } else usage();
  }
  return opts;
}

// ---- 分道 lane 表（2026-10-13 B6b-1，源仓 check-loop.mjs SECTIONS 同款语义；机读单源）----
// id = 段插桩 id（markGate / check-hygiene / check-stage-index / runCheck16 的 gateSeg 同名），
// 值 = 运行面。守卫只决定段跑不跑，段体判据零变化。清单 5（状态/L3 复核）在检查 1 循环内实现、
// 无独立段 id，随 '1' 同道（hard）。§21–26 与 '3x' 已随 B6b-2 落地登记（2026-10-13）。
const LANE_OF = {
  1: 'hard',     // 清单 1+5：配对 + 状态确认 + L3 复核 + 红线判低
  2: 'hygiene', 9: 'hygiene', 11: 'hygiene', 12: 'hygiene', 13: 'hygiene', // check-hygiene.mjs 五段
  3: 'hard',     // 复盘三件套 + 新 intent 回路
  4: 'hygiene',  // 引用有效性
  5: 'hygiene',  // 角色契约与宿主 Adapter（清单 6）
  6: 'hygiene',  // 阶段索引同步（清单 7；check-stage-index.mjs）
  8: 'hard',     // 验收标准对账
  10: 'hygiene', // 级别 vs 迁移文件
  14: 'hard',    // 确认留痕（approved 快照）
  15: 'hard',    // 确认指纹对账（指纹链）
  16: 'hygiene', // 量化断言签名对账
  17: 'hard',    // 发版树未收口
  18: 'hygiene', // 委派台账对账
  19: 'hygiene', // 逐阶段审计
  20: 'hygiene', // 引擎脚本测试覆盖
  // B6b-2 六段（2026-10-13；lane 沿上游：21/22/24/26 hygiene，23/25 hard）
  21: 'hygiene', // spec 验证落地核查（§21；锚 specVerifSince）
  22: 'hygiene', // 机制使用量台账（§22；.agents/mechanism-registry.md 在场才启用）
  23: 'hard',    // 判据级收敛对账（§23；hard 档随 convergenceHardSince，锚前 advisory WARN）
  24: 'hygiene', // incident 归因字段核查（§24；锚 attributionSince）
  25: 'hard',    // 路由预判一致性（§25；内容纯 WARN 不阻断，lane=hard 随源仓 SECTIONS）
  26: 'hygiene', // 闭环漏斗「协议前」占比动作阈值（§26）
  27: 'hygiene', // 回归清单活文档引用一致性（§27；弱档存在性，判定单源 check-regression-consistency.mjs）
  '3x': 'hard',  // incident 防复发验证证据门（§3 扩展，编号沿上游 3x 写法；锚 incidentRegrSince）
};

// ---- runCheckLoop：门禁主流程可 import 化（2026-10-08 checkloop-importable；2026-10-04 isMain 行点名单独立项）----
// import 本模块零副作用（isMain 主守卫，board-kb-p1 先例）；opts = { root?, rev?, mode?, hardening? }——root 显式参数
// 优先于 CHECK_LOOP_ROOT env 优先于 git toplevel（CLI 缺省行为逐字节不变）；mode = 运行面（2026-10-13 分道：
// 'hard'（缺省，关单/pre-push 面）| 'hygiene'（只卫生段）| 'all'（两段都跑=分道前裸跑全量）；CLI 由 takeOpts
// 注入，import 面按需显式给——需要全量语义的消费方传 'all'，勿依赖缺省）；返回 { exitCode, blockers, warnings }，
// 输出打印照旧在本函数内（稳定输出契约：banner 后空行、条目 `- ` 前缀、HARD-BLOCK/WARN 两段式——消费者 .githooks/pre-push）。
// opts.rev 的 worktree 清理挂 process.on('exit')——进程内多次调用累计监听器（测试场景 ≤3 次，可接受）。
// ---- 门禁 ROI 插桩件已抽至 gate-seg.mjs（2026-10-08 gate-roi-metrics）----
// 抽因：check-loop.mjs 已 import check-hygiene.mjs，后者若再 import check-loop.mjs 即循环依赖——
// 而两者都要插桩，判据单源必须只有一处。gateSeg / finishSegs / makeCollector 见该件；
// 本文件在每段开头调 markGate(id,label)，统计由数组长度差推出，不动任何 push 调用点。

// writeGateStats：门禁 ROI 落盘（2026-10-08 gate-roi-metrics）——append 一行到
// <root>/.agents/cache/gate-stats.jsonl（该目录已 gitignore，属运行时数据、不入 git、不进 kit.json
// managed 台账——刻意避开 2026-10-05 探针临时件被 sync 收编的事故面）。
// IO 失败只出账不阻断（沿 verify.mjs 凭证落账同款容错——度量失败不该让门禁变成红灯）。
export function writeGateStats(root, segs) {
  try {
    const dir = path.join(root, '.agents', 'cache');
    fs.mkdirSync(dir, { recursive: true });
    const total = segs.reduce((a, s) => a + s.ms, 0);
    fs.appendFileSync(path.join(dir, 'gate-stats.jsonl'),
      `${JSON.stringify({ ts: new Date().toISOString(), root, segs, totalMs: total })}\n`);
    const hits = segs.filter((s) => s.warns || s.blocks).length;
    console.error(`[gate-stats] ${segs.length} 段已记账（命中 ${hits} 段）→ .agents/cache/gate-stats.jsonl`);
  } catch (e) {
    console.error(`[gate-stats] ⚠️ 落盘失败（${e.code || e.message}）——不阻断门禁`);
  }
}

export function runCheckLoop(opts = {}) {
  const REV_ARG = opts.rev ?? null;
  const HARDENING = !!opts.hardening;
  const LOOP_MODE = opts.mode || 'hard'; // 分道运行面（2026-10-13 B6b-1）：hard（缺省）| hygiene | all
  // laneOn(id)：本运行面是否执行该段——all 全跑；hard/hygiene 只跑同名面。
  const laneOn = (id) => LOOP_MODE === 'all' || LANE_OF[id] === LOOP_MODE;
  if (REV_ARG && (opts.root || process.env.CHECK_LOOP_ROOT)) {
    console.error('check-loop: --rev 不能同时使用 root 参数 / CHECK_LOOP_ROOT');
    return { exitCode: 1, blockers: [], warnings: [] };
  }
  if (REV_ARG && /^0+$/.test(REV_ARG)) {
    console.error(`check-loop: --rev 不是提交 ${REV_ARG}`);
    return { exitCode: 1, blockers: [], warnings: [] };
  }
  let REV = null;

  // ---- 根目录与枚举单源 ----
  let ROOT;
  if (opts.root) {
    ROOT = path.resolve(opts.root);
    if (!fs.existsSync(ROOT)) {
      console.error('check-loop: root 不可访问:' + opts.root);
      return { exitCode: 1, blockers: [], warnings: [] };
    }
  } else if (process.env.CHECK_LOOP_ROOT) {
    ROOT = path.resolve(process.env.CHECK_LOOP_ROOT);
    if (!fs.existsSync(ROOT)) {
      console.error('check-loop: CHECK_LOOP_ROOT 不可访问:' + process.env.CHECK_LOOP_ROOT);
    return { exitCode: 1, blockers: [], warnings: [] };
    }
  } else {
    const top = gitOut(['rev-parse', '--show-toplevel']);
    if (top === null) {
      if (REV_ARG) {
        console.error(`check-loop: --rev 剥不到提交 ${REV_ARG}`);
      return { exitCode: 1, blockers: [], warnings: [] };
      }
      console.error('check-loop: 不在 git 仓库内,跳过扫描');
    return { exitCode: 0, blockers: [], warnings: [] };
    }
    ROOT = top.trim();
    if (REV_ARG) {
      const peeled = gitOut(['rev-parse', '--verify', `${REV_ARG}^{commit}`]);
      if (!peeled) {
        console.error(`check-loop: --rev 剥不到提交 ${REV_ARG}`);
      return { exitCode: 1, blockers: [], warnings: [] };
      }
      REV = peeled.trim();
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-rev-'));
      const wt = path.join(parent, 'wt');
      const main = ROOT;
      const add = spawnSync(GIT, ['worktree', 'add', '--detach', '--quiet', wt, REV], {
        cwd: main, encoding: 'utf8',
      });
      if (add.status !== 0) {
        fs.rmSync(parent, { recursive: true, force: true });
        console.error(`check-loop: 导出提交失败 ${REV_ARG}\n${add.stderr || add.stdout || ''}`);
      return { exitCode: 1, blockers: [], warnings: [] };
      }
      process.on('exit', () => {
        spawnSync(GIT, ['worktree', 'remove', '--force', wt], { cwd: main });
        fs.rmSync(parent, { recursive: true, force: true });
      });
      ROOT = wt;
    }
  }
  // 枚举单源（<root>/.agents/workflow-enums.txt——fixture 契约：缺文件/缺键 fail-loud）
  let ENUMS;
  try {
    ENUMS = loadEnums(path.join(ROOT, '.agents', 'workflow-enums.txt'));
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('不可读')) {
      console.error(`check-loop: 缺 ${path.join('.agents', 'workflow-enums.txt')}(枚举单源)——跑 flow-kit sync 恢复后重试`);
    } else {
      console.error('check-loop: 枚举单源 ' + msg);
    }
    return { exitCode: 1, blockers: [], warnings: [] };
  }
  const inSet = (v, arr) => arr.includes(v);
  const stOkDoc = (st) => inSet(st, ENUMS['doc.status.confirmed']);

  // git 调用（参数数组形式不走 shell——Windows cmd 不认单引号；git.exe 显式解析沿 doctor 先例）
  // 基础设施异常与业务失败分流（2026-10-05-gitout-fail-open）：spawn 异常响亮出账（进程级去重恰一条，
  // 沿检查 16 装户「载入失败响亮出账」先例）+ 瞬时类错误码单次重试；「非 git 仓」（status≠0）仍是
  // 合法装户语义、静默走降级。intentional-simple: 重试后仍异常继续走原降级/拦截语义（连续瞬时异常
  // 残余面小且有账可查）；升级路径 = 探测门（:720/:796）改三态拆分
  let gitInfraWarned = false;
  function warnGitInfra(args, code) {
    if (gitInfraWarned) return;
    gitInfraWarned = true;
    console.error(`check-loop: git 探测异常 ${args[0]}（${code}）——按非 git 仓降级，检查面可能收窄`);
  }
  const GIT_TRANSIENT = new Set(['EAGAIN', 'EPERM', 'EMFILE', 'EINTR']);
  function spawnGit(args) {
    const opts = { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 };
    let r = spawnSync(GIT, args, opts);
    if (r.error) {
      // 出账在重试终败后（与 linesOf 对称——瞬时重试恢复成功不打扰）；非瞬时类直接出账
      if (GIT_TRANSIENT.has(r.error.code)) r = spawnSync(GIT, args, opts);
      if (r.error) warnGitInfra(args, r.error.code || r.error.message);
    }
    return r;
  }
  function gitOut(args, { ok = () => true } = {}) {
    const r = spawnGit(args);
    if (r.error || r.status !== 0 || !ok(r)) return null;
    return r.stdout || '';
  }

  // ---- frontmatter 受限子集读取（fm_get 语义：首行 --- 进入、下一 --- 闭合、键在行首、首个命中、值两侧去空白）----
  // fs 读取同走 fail-loud（2026-10-05-gitout-fail-open 实现期诊断追加，与 spawnGit 同一故障类）：
  // readFileSync 瞬时异常（宿主资源压力 EMFILE/共享冲突类）重试一次，仍失败响亮出账（进程级去重）
  // 后按 null 降级——调用方按空文档跳过该件，但异常本身不再静默
  let fsReadWarned = new Set();
  const fileLinesCache = new Map();
  function linesOf(file) {
    if (!fileLinesCache.has(file)) {
      let lines = null;
      try {
        lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      } catch (e) {
        try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { lines = null; }
        if (!lines && !fsReadWarned.has(file)) {
          fsReadWarned.add(file);
          console.error(`check-loop: 文档读取异常 ${path.basename(file)}（${e.code || e.message}）——按空文档降级，检查面可能收窄`);
        }
      }
      fileLinesCache.set(file, lines);
    }
    return fileLinesCache.get(file);
  }
  function fmGet(file, key) {
    const lines = linesOf(file);
    if (!lines) return '';
    const isDelim = (l) => /^---\s*$/.test(l);
    if (!isDelim(lines[0] || '')) return '';
    for (let i = 1; i < lines.length; i++) {
      if (isDelim(lines[i])) return '';
      if (lines[i].startsWith(key + ':')) return lines[i].slice(key.length + 1).trim();
    }
    return '';
  }

  // 落点空壳告警（2026-10-11 landing-reality，沉淀追踪第三级，incident/intent 两侧共用）：
  //   「沉淀: <路径>」存在 ≠ 有效——文件存在但 sedimentLandingIsShell 为真（无来源 frontmatter
  //   且非占位正文不足 3 行）→ WARN 落点空壳（advisory，灰度第一档）。调用方须先出过「沉淀断档」
  //   分支（文件不存在），故此处 readFileSync 异常 = 真读取故障，按空壳出账并在文案注明读取失败。
  const warnSedimentShell = (single, sed) => {
    let text = null;
    try { text = fs.readFileSync(path.resolve(ROOT, sed), 'utf8'); } catch { text = null; }
    if (!sedimentLandingIsShell(text)) return;
    const readFail = text === null ? '；落点文件读取失败' : '';
    warnings.push(`- [WARN 落点空壳] ${single} frontmatter「沉淀: ${sed}」指向的文件存在但无有效内容（无来源 frontmatter 且非占位正文不足 3 行${readFail}）——沉淀须真实整理而非空壳占位（advisory，灰度第一档）`);
  };

  const WF = 'workflow';
  const DOC_DIRS = ['intents', 'specs', 'plans', 'incidents'];
  const blockers = [];
  const warnings = [];
  // 门禁 ROI 收集器（2026-10-08 gate-roi-metrics）：引用同一对数组 + 段游标，不复制任何数据。
  // 默认路径不打印不写盘（见 gate-seg.mjs 注释的输出契约硬约束）。
  const gateStats = makeCollector(warnings, blockers);
  const markGate = (id, label) => gateSeg(gateStats, id, label); // 局部别名，避免遮蔽同名导出
  // audit:false（init 新装）只保留 blockers。缺省与 audit:true 保持全量警告。
  // 硬规则：配对 / 验收勾验的阻断 / 确认留痕 / 发版草稿。卫生项走 warnings。
  const kitPolicy = loadKitPolicy(ROOT);
  if (!auditEnabled(kitPolicy)) {
    warnings.push = () => warnings.length;
  }

  // ---- 已提交(HEAD)过滤：仓库模式只扫 tracked（fixture 模式恒真；ls-tree 失败退化全扫）----
  let trackedSet = null; // null = 不过滤
  if (!process.env.CHECK_LOOP_ROOT) {
    const out = gitOut(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'workflow']);
    if (out !== null) trackedSet = new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
  }
  const isTracked = (abs) => trackedSet === null || trackedSet.has(path.relative(ROOT, abs).split(path.sep).join('/'));
  const docFiles = (sub) => {
    const dir = path.join(ROOT, WF, sub);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md') && /^\d/.test(f))
      .map((f) => path.join(dir, f))
      .filter((f) => isTracked(f))
      .sort();
  };

  // --- 1. intent/spec/plan 同名配对 + 状态确认 + L3 确认三件 + 风险泳道一致性 [hard-block] ---
  if (laneOn(1)) { // lane=hard：默认关单/pre-push 面（清单 5 随本段循环实现，同 lane）
  markGate('1', '意图/spec/plan 配对');
  for (const intent of docFiles('intents')) {
    const base = path.basename(intent);
    const st = fmGet(intent, '状态');
    const lvl = fmGet(intent, '级别');
    const risk = fmGet(intent, 'risk_level'); // 风险泳道字段（fill-intent 落，=级别；2026-09-30 hybrid-governance-risk-lanes）
    if (!stOkDoc(st)) {
      const msg = `${base}（frontmatter 状态键当前值:『${st || '缺失'}』）`;
      if (lvl === 'L3') blockers.push(`- [状态未确认] L3 intent 必须为 approved/done/superseded/cancelled:${msg}`);
      else warnings.push(`- [WARN 状态未确认] intent 必须为 approved/done/superseded/cancelled:${msg}`);
    }
    if (lvl === 'L2' || lvl === 'L3') {
      if (!fs.existsSync(path.join(ROOT, WF, 'specs', base))) {
        blockers.push(`- [配对断裂] intent 缺 spec:${base}（应在 ${WF}/specs/ 下同名）`);
      }
    }
    // plan 配对全级别强制（2026-10-13 L0 退役：原 L0 协作道豁免随级别退役删除；L2/L3 另须 spec）
    if (!fs.existsSync(path.join(ROOT, WF, 'plans', base))) {
      blockers.push(`- [配对断裂] intent 缺 plan:${base}（应在 ${WF}/plans/ 下同名）`);
    }
    // 风险泳道一致性（2026-10-02 caliber-convergence 起单源 laneOfEntry·方案 C 分歧双严）：非 high
    // （low 或 suspect——级别/risk_level 缺失、非法、分歧）勾选触达红线 = 自认触及规则/契约或数据/运行时
    // 结构面——就高不就低，协作道不受理 → hard 判低，须对齐两字段至 L2/L3 并补同名 spec
    if (laneOfEntry(lvl, risk, kitPolicy.riskLevelSince, fmGet(intent, '日期')) !== 'high') {
      const redlineTouched = (linesOf(intent) || [])
        .some((l) => /^- \[x\]/.test(l) && /(\$\\rightarrow\$|→)\s*级别|级别至少\s*L[23]/.test(l));
      if (redlineTouched) {
        blockers.push(`- [红线判低] ${base} 级别/风险泳道为 ${[lvl, risk].filter(Boolean).join('/')} 但触达红线已勾选（规则/契约或 schema/结构面）——协作道不受理 STOP 级改动：就高不就低，把「级别」与「risk_level」两字段对齐到 L2/L3（fill-intent 双写口径）并补同名 spec`);
      }
    }
  }

  for (const spec of docFiles('specs')) {
    const base = path.basename(spec);
    const st = fmGet(spec, '状态');
    const lvl = fmGet(spec, '级别');
    const hasEntry = fs.existsSync(path.join(ROOT, WF, 'intents', base)) || fs.existsSync(path.join(ROOT, WF, 'incidents', base));
    if (!hasEntry) blockers.push(`- [配对断裂] spec 缺 intent/incident:${base}（应在 ${WF}/intents/ 或 ${WF}/incidents/ 下同名）`);
    if (!stOkDoc(st)) {
      const msg = `${base}（frontmatter 状态键当前值:『${st || '缺失'}』）`;
      if (lvl === 'L3') blockers.push(`- [状态未确认] L3 spec 必须为 approved/done/superseded/cancelled:${msg}`);
      else warnings.push(`- [WARN 状态未确认] spec 必须为 approved/done/superseded/cancelled:${msg}`);
    }
    // L3 确认三件：确认结果/确认时间读 frontmatter；独立复核按正文行锚定（放弃件豁免 = 枚举单源 abandoned 集）
    if (lvl === 'L3' && !inSet(st, ENUMS['doc.status.abandoned'])) {
      if (fmGet(spec, '确认结果') !== 'approved') blockers.push(`- [L3 确认缺失] ${base} 确认结果必须为 approved`);
      if (!fmGet(spec, '确认时间')) blockers.push(`- [L3 确认缺失] ${base} 必须记录确认时间`);
      if (!(linesOf(spec) || []).some((l) => /^- 独立复核：[ \t]*[^<\s]/.test(l))) {
        blockers.push(`- [L3 复核缺失] ${base} 必须记录新会话独立复核结论`);
      }
    }
    // 独立复核上下文标识（2026-10-13 B6b-2，policy v12 reviewerSince advisory）：
    // 独立性声明须带可证伪基底——复核行落「复核上下文：<会话/子代理 id>」，使「主智能体自查冒充」
    // 从遗漏升级为积极伪造。只扫有独立复核行的 spec；锚前存量豁免不回填；缺键（v1–v11）→ 本子检整体跳过。
    if (kitPolicy.reviewerSince) {
      const rvDate = fmGet(spec, '日期') || (/^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '');
      if (rvDate >= kitPolicy.reviewerSince) {
        const rvLine = (linesOf(spec) || []).find((l) => /^- 独立复核：/.test(l));
        if (rvLine && !/复核上下文：/.test(rvLine)) {
          warnings.push(`- [WARN 复核上下文缺失] ${base} 独立复核行缺「复核上下文：<会话/子代理 id>」——独立性声明无可证伪基底（C2，reviewerSince ${kitPolicy.reviewerSince}）`);
        }
      }
    }
  }

  for (const plan of docFiles('plans')) {
    const base = path.basename(plan);
    const st = fmGet(plan, '状态');
    const lvl = fmGet(plan, '级别');
    const hasEntry = fs.existsSync(path.join(ROOT, WF, 'intents', base)) || fs.existsSync(path.join(ROOT, WF, 'incidents', base));
    // L1 plan 即入口（2026-10-13 B6b-2）：级别恰好为 L1 的 plan 自己就是入口，无同名
    // intent/incident 不拦。级别缺失或 L2/L3 仍要求入口（fail-closed）。已写的 intent 不论级别仍要求同名 plan。
    if (lvl !== 'L1' && !hasEntry) blockers.push(`- [配对断裂] plan 缺 intent/incident:${base}（应在 ${WF}/intents/ 或 ${WF}/incidents/ 下同名）`);
    if (!stOkDoc(st)) {
      const msg = `${base}（frontmatter 状态键当前值:『${st || '缺失'}』）`;
      if (lvl === 'L3') blockers.push(`- [状态未确认] L3 plan 必须为 approved/done/superseded/cancelled:${msg}`);
      else warnings.push(`- [WARN 状态未确认] plan 必须为 approved/done/superseded/cancelled:${msg}`);
    }
  }
  } // laneOn(1) 守卫闭合

  // --- 卫生类检查 2 / 9 / 11 / 12 / 13（2026-10-08 selfmeasure-and-modularize 拆出）---
  // ⚠️ 调用点位置即输出顺序位：原实现分处五处，逐条顺序 2 → 9 → 11 → 12 → 13，而 warnings 按插入序输出、
  //    行序属稳定输出契约（pre-push / pre-commit 消费者 + doctor 按 WARN 行计数）。拆成一次调用后本块统一落在
  //    原检查 2 的位置，**块内顺序由 check-hygiene.mjs 保证**（与其内注释互引）。新增检查请按原编号插入
  //    到正确位置，勿一律追加末尾。
  // ctx 只传既有 helper、模块内零复刻：docFiles 的 tracked 过滤、fmGet 的 frontmatter 受限子集、
  // linesOf 的读异常响亮出账各自承载不可漂移语义，复刻即造口径分叉。audit:false 下 warnings.push 是
  // no-op，卫生项因此不出账（硬规则语义保持）。
  // 分道（2026-10-13）：本调用是卫生段（2/9/11/12/13，lane=hygiene）唯一入口——硬门默认面整段跳过
  // （连带省掉检查 11/13 的生成器子进程）；--hygiene / --all 才执行。
  if (laneOn(2)) warnings.push(...runCheckHygiene({ root: ROOT, WF, DOC_DIRS, docFiles, linesOf, fmGet, isTracked, readdirOrNull, kitPolicy, gateStats }));
  // --- 3. incidents 复盘三件套 + 状态严格枚举 + 新 intent 回路（回路断档 = hard）---
  if (laneOn(3)) { // lane=hard
  markGate('3', 'incidents 复盘三件套');
  for (const inc of docFiles('incidents')) {
    const name = path.basename(inc);
    const lines = linesOf(inc) || [];
    const incLvl = fmGet(inc, '级别');
    const incSt = fmGet(inc, '状态');

    if (!inSet(incSt, ENUMS['incident.status.all'])) {
      warnings.push(`- [WARN 状态非法] incident 状态必须为 ${ENUMS['incident.status.all'].join('/')}:${name}（frontmatter 状态键当前值:『${incSt || '缺失'}』）`);
    }

    if (fmGet(inc, '流程') !== 'legacy') {
      if (!inSet(incLvl, ENUMS['level.all'])) {
        warnings.push(`- [WARN 级别缺失] ${name} 必须填写 L1/L2/L3（配对检查已跳过——补级别后重跑本脚本校验配对）`);
      } else {
        if (['L1', 'L2', 'L3'].includes(incLvl) && !fs.existsSync(path.join(ROOT, WF, 'plans', name))) {
          blockers.push(`- [配对断裂] incident 缺 plan:${name}（应在 ${WF}/plans/ 下同名）`);
        }
        if (['L2', 'L3'].includes(incLvl) && !fs.existsSync(path.join(ROOT, WF, 'specs', name))) {
          blockers.push(`- [配对断裂] incident 缺 spec:${name}（应在 ${WF}/specs/ 下同名）`);
        }
      }
    }

    // 三件套：正文行锚定 /^1\. /^2\. /^3\. （sh awk 同款）
    let trioOk = true;
    for (const n of [1, 2, 3]) {
      if (!lines.some((l) => l.startsWith(`${n}. `))) {
        warnings.push(`- [WARN 三件套不全] ${name} 缺复盘三件套之 ${n}`);
        trioOk = false;
      }
    }
    // 沉淀追踪（incident 侧，与检查 8 intent 侧对称）：closed 且三件套齐全 = 最高价值沉淀源。
    //   frontmatter「沉淀: <相对仓根路径>」登记去向；缺登记 → WARN 未沉淀（advisory，灰度第一档）；
    //   登记了但文件不存在 → WARN 沉淀断档；存在但空壳（无来源且非占位正文不足 3 行）→ WARN 落点空壳。
    //   同「沉淀: 无」显式豁免口径。
    if (incSt === 'closed' && trioOk) {
      const sed = fmGet(inc, '沉淀');
      if (!sed) {
        warnings.push(`- [WARN 未沉淀] ${name} 复盘三件套齐全（closed）但未登记沉淀去向——整理到 wiki 后在 frontmatter 记「沉淀: wiki/<主题>/<文件>」，或显式写「沉淀: 无」（advisory，灰度第一档；沉淀是人工判断，机器只提醒不强制）`);
      } else if (sed !== '无' && !fs.existsSync(path.resolve(ROOT, sed))) {
        warnings.push(`- [WARN 沉淀断档] ${name} frontmatter「沉淀: ${sed}」指向的文件不存在——沉淀文件移动/改名后须同步更新本字段（advisory，灰度第一档）`);
      } else if (sed !== '无') {
        warnSedimentShell(name, sed); // 落点真实性（P1-3）：存在但空壳 → WARN 落点空壳
      }
    }
    const hasParent = lines.some((l) => l.includes('是否需要新 intent'));
    if (!hasParent) {
      warnings.push(`- [WARN 三件套不全] ${name} 缺「是否需要新 intent」子项`);
      continue;
    }
    const yesLine = lines.find((l) => l.includes('是 → '));
    if (yesLine) {
      const m = yesLine.match(/intents\/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[^ )]*\.md/);
      const ref = m ? m[0] : null;
      if (!ref) blockers.push(`- [回路断档] ${name} 选「是」但未指明 intent 文件路径`);
      else if (!fs.existsSync(path.join(ROOT, WF, ref))) blockers.push(`- [回路断档] ${name} 引用的 intent 不存在:${ref}`);
    }
  }
  } // laneOn(3) 守卫闭合

  // --- 4. 引用有效性 [warning]（.agents/ 路径须存在；skills 特例允许用户级 ~/.agents/skills）---
  if (laneOn(4)) { // lane=hygiene
  markGate('4', '引用有效性');
  {
    // 引用可带 {a,b,c} 花括号展开（仓库通写法 `fill-{intent,spec,plan}.mjs`）或 `*` 通配（`fill-*.mjs`）——
    // 花括号展开逐路查存在，任一路存在即有效；`*` 按目录枚举 glob 匹配，命中即有效；全不中才算断档
    // （2026-09-26 审查修复：正则字符类不含 {} *，曾把 `fill-{intent,spec,plan}.mjs` / `fill-*.mjs`
    //   截断成 `fill-` 误报引用断档）
    // 全角逗号不入字符类（2026-10-08 papercuts-cleanup-batch 修 4）：中文文档路径引用后紧跟「，」时
    // 曾被并入引用串 → 引用断档误报（p0-gate-noise-batch 实证 2 条 + 本登记行自中）；花括号保留（{{VAR}} 引用形态）
    const refRe = /\.agents\/(commands|hooks|scripts|skills|roles)\/[A-Za-z0-9_][A-Za-z0-9_./{},*-]*/g;
    const expandRef = (ref) => {
      const m = ref.match(/^([^{]*)\{([^}]*)\}(.*)$/);
      if (!m) return [ref];
      return m[2].split(/[,，]/).map((v) => m[1] + v.trim() + m[3]);
    };
    // globExists：`*` 通配引用按目录枚举匹配（仅文件名层，`*` 不跨 /；目录不存在 = false）
    const globExists = (ref) => {
      const re = new RegExp('^' + path.basename(ref).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/\\\\]*') + '$');
      try { return fs.readdirSync(path.dirname(path.join(ROOT, ref))).some((f) => re.test(f)); } catch { return false; }
    };
    const refExists = (r) => (r.includes('*') ? globExists(r) : fs.existsSync(path.join(ROOT, r)));
    const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
    const files = [];
    if (fs.existsSync(path.join(ROOT, 'AGENTS.md'))) files.push('AGENTS.md');
    for (const e of readdirOrNull(ROOT) || []) {
      const p = path.join(ROOT, e, 'AGENTS.md');
      if (isDirectoryOrNull(path.join(ROOT, e)) && fs.existsSync(p)) files.push(path.join(e, 'AGENTS.md'));
    }
    for (const f of readdirOrNull(path.join(ROOT, WF)) || []) {
      if (f.endsWith('.md')) files.push(`${WF}/${f}`); // workflow 根级 *.md（README 等）
    }
    for (const sub of DOC_DIRS) {
      const dir = path.join(ROOT, WF, sub);
      // 仅扫活跃态（draft/approved/open）——终态件的引用是历史叙述（提及已改名/已废文件属常态），
      // 扫了只会产生不可消除的 advisory 噪声，真漏点被淹没（2026-09-27 audit-gate-hardening）
      const activeSet = sub === 'incidents' ? ENUMS['incident.status.active'] : ENUMS['doc.status.active'];
      for (const f of readdirOrNull(dir) || []) {
        if (!f.endsWith('.md') || !(f === '_TEMPLATE.md' || /^\d/.test(f))) continue;
        if (f !== '_TEMPLATE.md' && !inSet(fmGet(path.join(dir, f), '状态'), activeSet)) continue;
        files.push(`${WF}/${sub}/${f}`);
      }
    }
    const cmdDir = path.join(ROOT, '.agents', 'commands');
    for (const f of readdirOrNull(cmdDir) || []) {
      if (f.endsWith('.md')) files.push(`.agents/commands/${f}`);
    }
    for (const rel of files) {
      const text = linesOf(path.join(ROOT, rel));
      if (!text) continue;
      const seen = new Set();
      for (const line of text) {
        for (const m of line.matchAll(refRe)) {
          const ref = m[0];
          if (seen.has(ref)) continue;
          seen.add(ref);
          const refs = expandRef(ref);
          if (refs.some(refExists)) continue;
          if (refs.some((r) => r.startsWith('.agents/skills/') && !r.includes('*') && fs.existsSync(path.join(HOME_DIR, r)))) continue;
          warnings.push(`- [WARN 引用断档] ${rel.split(path.sep).join('/')} 引用不存在的文件:${ref}`);
        }
      }
    }
  }
  } // laneOn(4) 守卫闭合

  // --- 5. 子智能体角色契约 + 宿主 Adapter 一致性 + 旧委派残留 + 钉死模型 [warning] ---
  if (laneOn(5)) { // lane=hygiene（清单 6：角色契约与 Adapter）
  markGate('5', '角色契约与宿主 Adapter');
  {
    const cmdFiles = () => (readdirOrNull(path.join(ROOT, '.agents', 'commands')) || [])
      .filter((f) => f.endsWith('.md')).map((f) => `.agents/commands/${f}`);
    // existsSync 守卫（2026-10-06-check19-entry-enoent 同类）：AGENTS.md 等可合法缺失（调用方按空数组
    // 判定本就预期缺失态），fail-loud fs 读下按缺省跳过、不再响亮出账；其余调用方路径另有上游守卫
    const textOf = (rel) => {
      const p = path.join(ROOT, rel);
      return fs.existsSync(p) ? (linesOf(p) || []) : [];
    };
    for (const role of ['implementer', 'independent-reviewer', 'ui-verifier']) {
      const rolePath = `.agents/roles/${role}.md`;
      if (!fs.existsSync(path.join(ROOT, rolePath))) {
        warnings.push(`- [WARN 角色缺失] 公共角色契约不存在:${rolePath}`);
        continue;
      }
      if (fs.existsSync(path.join(ROOT, '.opencode', 'agents'))) {
        const p = `.opencode/agents/${role}.md`;
        if (!fs.existsSync(path.join(ROOT, p))) warnings.push(`- [WARN Adapter 缺失] OpenCode 缺 ${role}:${p}`);
        else {
          if (!/^mode:\s*subagent\s*$/m.test(textOf(p).join('\n'))) warnings.push(`- [WARN Adapter 无效] OpenCode ${role} 未声明 mode:subagent:${p}`);
          if (!textOf(p).some((l) => l.includes(rolePath))) warnings.push(`- [WARN Adapter 断线] OpenCode ${role} 未引用公共角色:${rolePath}`);
        }
      }
      if (fs.existsSync(path.join(ROOT, '.trae', 'agents'))) {
        const p = `.trae/agents/${role}.md`;
        if (!fs.existsSync(path.join(ROOT, p))) warnings.push(`- [WARN Adapter 缺失] Trae 缺 ${role}:${p}`);
        else {
          if (!new RegExp(`^name:\\s*${role}\\s*$`, 'm').test(textOf(p).join('\n'))) warnings.push(`- [WARN Adapter 无效] Trae ${role} 的 name 与文件名不一致:${p}`);
          if (!textOf(p).some((l) => l.includes(rolePath))) warnings.push(`- [WARN Adapter 断线] Trae ${role} 未引用公共角色:${rolePath}`);
        }
      }
      const zc = `.zcode/agents/${role}.md`;
      if (fs.existsSync(path.join(ROOT, zc))) { // .zcode/agents/ 现为入库件（2026-10-05 起宿主一律入库）；缺失只说明宿主未装，不告警，存在时校验一致性
        if (!new RegExp(`^name:\\s*["']?${role}["']?\\s*$`, 'm').test(textOf(zc).join('\n'))) warnings.push(`- [WARN Adapter 无效] ZCode ${role} 的 name 与文件名不一致:${zc}`);
        if (!textOf(zc).some((l) => l.includes(rolePath))) warnings.push(`- [WARN Adapter 断线] ZCode ${role} 未引用公共角色:${rolePath}`);
      }
      const cited = ['AGENTS.md', ...cmdFiles()].some((f) => textOf(f).some((l) => l.includes(rolePath)));
      if (!cited) warnings.push(`- [WARN 命令断线] 工作流未引用公共角色:${rolePath}`);
    }
    // 旧委派残留 / 钉死模型（grep -nH 行格式 file:line:content）
    const legacyRe = /(^subagent:|subagent_type=|general_purpose_task|browser_use)/;
    const legacyHits = [];
    for (const f of ['AGENTS.md', ...cmdFiles()]) {
      textOf(f).forEach((l, i) => { if (legacyRe.test(l)) legacyHits.push(`${f}:${i + 1}:${l}`); });
    }
    if (legacyHits.length) warnings.push(`- [WARN 旧委派残留] 主规则或阶段命令仍含宿主特定/旧委派声明:\n${legacyHits.join('\n')}`);
    const modelHits = [];
    for (const h of ['.opencode', '.trae', '.zcode']) {
      for (const f of readdirOrNull(path.join(ROOT, h, 'agents')) || []) {
        if (!f.endsWith('.md')) continue;
        const rel = `${h}/agents/${f}`;
        textOf(rel).forEach((l, i) => { if (/^model:/.test(l) && !/^model:\s*inherit/.test(l)) modelHits.push(`${rel}:${i + 1}:${l}`); });
      }
    }
    if (modelHits.length) warnings.push(`- [WARN 宿主耦合] 薄 Adapter 不应固定模型:\n${modelHits.join('\n')}`);
  }
  } // laneOn(5) 守卫闭合

  // --- 6. 阶段索引同步 [warning]（2026-10-09 engine-quality-round2 A1：实现迁 check-stage-index.mjs——
  //     先例 check-hygiene / check-metric-claims；段 id 沿 sh 版 '6'，清单编号 7 与文案逐字不动；
  //     调用点位置即输出顺序契约）---
  if (laneOn(6)) warnings.push(...runCheckStageIndex({ root: ROOT, linesOf, gateStats })); // lane=hygiene（清单 7）

  // --- 共享：文件「首次加入 git」的日期索引（2026-09-28 check8-git-anchor）---
  // 用途：检查 8 的生效日锚从**可手填的文件名前缀**（项目命名规范本身即 `YYYY-MM-DD-<主题>`，作者
  // 日常手写该前缀，「写早」零成本、顺手即发生——一条 hard 门可被平凡绕过）改为**首次加入 git 的日期**。
  // **诚实边界（复核 P1 更正）**：该锚取 `git log --diff-filter=A --format=@%aI`，即 **author date
  // （作者自报时间戳）**，**不是** commit 时刻——`git commit --date=<过去>` 一条参数即可伪造，故
  // 「锚不可手填」的说法**不成立**。本改动的确切收益是：关掉「改文件名（日常必写、零成本）」这条通道，
  // 把伪造成本抬到「主动加参数伪造时间戳」——后者与「伪造台账」同属**本地信任边界内不可机器防**的范畴
  // （事后对质靠 git 历史与台账）。此处如实声明，不宣称「通道已关闭」。
  // 口径：git 按时间新→旧遍历，同一文件首遇即最早那次加入（与检查 10 的 addpath 同款判据）。
  // 非 git / 命令失败 → null，调用方按既有「非 git 跳过」语义退化（不 fail-loud）。
  // 注：检查 10 需要的是「文件→加入 commit」+「commit→文件清单」两份映射（判断同提交是否触及迁移 SQL），
  // 与本索引「文件→日期」不同构，故**不合并**——避免把两处判据耦死。
  // addedDates（2026-10-09 engine-quality-round3 W1）：全史解析走持久缓存（HEAD 键）——
  // 同 HEAD 多入口复跑（verify/pre-commit/CI）不再重复全算；git-dir 探测保留在前。
  const addedDates = gitOut(['rev-parse', '--git-dir']) === null ? null : addedDatesWithCache({
    head: gitOut(['rev-parse', 'HEAD']),
    gitLog: () => gitOut(['log', '--diff-filter=A', '--format=@%aI', '--name-only']),
    cachePath: path.join(ROOT, '.agents', 'cache', 'added-dates.json'),
  });
  // 某文档「首次加入日期」（YYYY-MM-DD）；不可判定（非 git / 查不到）返回 ''
  const addedDateOf = (absDoc) => {
    if (!addedDates) return '';
    const rel = path.relative(ROOT, absDoc).split(path.sep).join('/');
    const iso = addedDates.get(rel);
    return iso ? iso.slice(0, 10) : '';
  };

  // 豁免/放行分支出账（fail-loud 口径——「裁决消失」不可归因的教训：豁免路径零痕迹；
  // 2026-10-05-check8-digit-sha-misfire）：按 type 进程级去重，每类至多一条；stderr 不改 stdout 协议
  const evidenceExemptWarned = new Set();
  function warnEvidenceExempt(type, base) {
    if (evidenceExemptWarned.has(type)) return;
    evidenceExemptWarned.add(type);
    console.error(`check-loop: 证据豁免 ${type} ${base}——该文档的验收证据未做真相核验`);
  }

  // 证据真相校验：检查证据字符串是否包含合法的 commit SHA，且该 commit 触及了 plan 声明的文件
  // 测试绿声明对账（2026-10-07 verify-evidence）：ctx = { verifyRelevant, hasFresh } 时，无 SHA 且命中
  // 关键词的证据走凭证对账——有 24h 绿行 → verify 型豁免出账；无 → verify-missing（聚合段出 warning，
  // 灰度第一档非 blocker）。ctx 由调用方按「intent 加入 git ≥ verifySince（v5 锚）」组装；锚不可判定
  // → ctx null → 维持 text 豁免（无判定依据不产出告警）。关键词表最小集起步（check2-datetime 先例：
  // 只豁免实证形态，变体实证再扩）。
  const VERIFY_GREEN_RE = /测试通过|测试全绿|测试绿|全绿/;
  function verifyEvidenceTruth(evidenceStr, planBase, root, ctx) {
    const shaMatch = evidenceStr.match(/\b([a-f0-9]{7,40})\b/i);
    if (!shaMatch) {
      if (ctx && ctx.verifyRelevant && VERIFY_GREEN_RE.test(evidenceStr)) {
        if (ctx.hasFresh) {
          warnEvidenceExempt('verify', planBase);
          return { ok: true, type: 'verify' };
        }
        return { ok: true, type: 'verify-missing' };
      }
      warnEvidenceExempt('text', planBase);
      return { ok: true, type: 'text' };
    }

    const sha = shaMatch[1];
    // 直连走 spawnGit（与 gitOut 同一 loud+retry 通道，注释互引）：spawn 异常不再被静默算作业务失败；
    // 重试后仍异常按下方 status!==0 判定（fail-closed 保持——本地核验不了就按伪造拦）
    const revParse = spawnGit(['rev-parse', sha]);
    if (revParse.status !== 0) {
      // git 通道坏死（spawn 异常，非 git 的正常回答）→ 禁用下方两类豁免：「实证分流」依赖 rev-parse
      // 可用，通道失效时纯数字/外部引用都无法实证，按伪造拦（fail-closed，与 :672 注释一致）。
      // v1.3.0 Release CI 实证：fixture 短 sha 恰全数字（≈4%/run）时，纯数字 text 豁免曾把本场景
      // fail-closed 漏成 exit 0（ubuntu 腿）；win32 sha 含字母走 forged 故本地恒绿——平台概率差异。
      if (revParse.error) {
        return { ok: false, type: 'forged', msg: `提交 ${sha} 不存在` };
      }
      // 纯数字串且解析失败 → 时间戳/ID 维持文本豁免（2026-10-05-check8-digit-sha-misfire：形态守卫
      // 曾把全数字短 SHA≈4.4%/夹具 误分类为文本致核验静默跳过——改由 rev-parse 实证分流）。
      // 纪律：文本启发式须可被实证兜底，禁以字符形态抢先分类。
      if (/^\d+$/.test(sha)) {
        warnEvidenceExempt('text', planBase);
        return { ok: true, type: 'text' };
      }
      // 区分本地伪造与外部仓库引用：
      // 剔除 SHA 与泛指词后仍有其他内容（如项目名、路径描述）→ 视为外部仓库引用，不硬拦（本地无法核验他仓哈希）；
      // 剔除后为空（如纯「commit a1b2c3d」「提交 a1b2c3d」）→ 视为本地引用伪造，硬拦。
      const residue = evidenceStr.replace(sha, '')
        .replace(/证据[：:]|commit|提交|[（）()。—-]/gi, '')
        .trim();
      if (residue.length > 0) {
        warnEvidenceExempt('external', planBase);
        return { ok: true, type: 'external' };
      }
      return { ok: false, type: 'forged', msg: `提交 ${sha} 不存在` };
    }

    // 解析成功（含纯数字短 SHA 命中提交/ref 的情形）→ 真相核验
    const planPath = path.join(ROOT, WF, 'plans', planBase + '.md');
    if (!fs.existsSync(planPath)) {
      warnEvidenceExempt('no-plan', planBase);
      return { ok: true, type: 'no-plan' }; // 缺 plan 走 Check 1 拦截
    }

    const planLines = linesOf(planPath) || [];
    const declaredFiles = [];
    // 扫描「改动面」「任务拆解」或「改动方案」（L1 Quick-Plan 生成器 fill-plan 输出）节
    let inDeclaredSec = false;
    for (const line of planLines) {
      if (/^##\s+(改动面|任务拆解|改动方案)/.test(line)) { inDeclaredSec = true; continue; }
      if (inDeclaredSec && /^##\s+/.test(line)) { inDeclaredSec = false; continue; }
      if (inDeclaredSec) {
        const fileMatch = line.match(/([a-zA-Z0-9._/-]+\.[a-zA-Z0-9]+)/);
        if (fileMatch) declaredFiles.push(fileMatch[1]);
      }
    }

    const show = spawnGit(['show', '--name-only', sha]);
    if (show.status !== 0) return { ok: false, type: 'error', msg: `无法读取提交 ${sha} 的文件列表` };
  
    const changedFiles = show.stdout.split(/\r?\n/).filter(Boolean);
    const hasIntersection = changedFiles.some(f => declaredFiles.some(df => f.includes(df) || df.includes(f)));

    if (!hasIntersection) {
      // 过程证据（2026-10-03 check-evidence-process）：执行器驱动的提交可作验收证据——提交信息带
      // 「pipeline-run <runId>」标记（docsCommit 四种格式共有段，runId 严格形态 日期8-时间4-主题-尾；
      // 与 run 事件流同源，git 历史留痕可对质）。只救 irrelevant：forged（SHA 不存在）在前已判，其余判据不动。
      // 记录型标志（2026-10-06-v114-backflow-batch）：docs 系 Conventional Commit（冒烟报告 / 留痕 / 关单台账）
      // 不触 plan 声明面属预期——是否降级豁免由检查 8 聚合段判（须同文档存在可过检实现证据），此处只出标志。
      const subj = spawnGit(['log', '-1', '--format=%s', sha]);
      const recordCommit = subj.status === 0 && /^docs[(:]/.test(subj.stdout.trim());
      if (subj.status === 0 && /pipeline-run [0-9]{8}-[0-9]{4}-[A-Za-z0-9-]+/.test(subj.stdout)) {
        warnEvidenceExempt('process', planBase);
        return { ok: true, type: 'process' };
      }
      return { ok: false, type: 'irrelevant', msg: `提交 ${sha} 未触及 plan 声明的任何文件`, recordCommit };
    }

    return { ok: true, type: 'sha' };
  }

  // --- 3 扩展（§3x，编号沿上游 3x 写法——不入 1-N 配对面）.
  //     incident 防复发验证证据门 [hard-block]（2026-10-13 B6b-2；出处沿革留痕在包源仓
  //     git 历史与 CHANGELOG）。调用点位置 = 源仓 SECTIONS 段序（s03x 居卫生 4/5/6 之后、检查 8 之前），
  //     亦为本段消费 addedDateOf 的前置依赖位（git 建档日锚单源定义于上）---
  // incidents 模板「防复发验证」强制项的机器面：防复发验证必须落到自动化用例或回归清单条目，禁「只写已人工验证」。
  // fixed/closed 且 git 建档日 ≥ incidentRegrSince（policy v9；v1–v8 缺键 → 整体跳过）的 incident，
  // 正文无自动化用例 / 回归清单引用 → hard。判据 = 宽匹配正则（引擎 .test.mjs / 回归清单 / 冒烟 / 测试命令）
  // ——门的是「落到可复跑的验证资产」，不是猜具体测试名；存量（< 锚）豁免（不可判定亦不拦——无判定依据不出 hard）。
  // kit 适配（源仓→kit 逐条）：证据正则剔除源仓实例路径面（backend/…Tests.cs、frontend/__tests__），
  //   kit 口径保留通用形态（.test.mjs / workflow/regression-checklist.md（kit 模板同款件）/ 测试与门命令）。
  if (laneOn('3x')) { // lane=hard：防复发证据门
  markGate('3x', 'incident 防复发验证证据门');
  {
    const regrAnchor = kitPolicy.incidentRegrSince;
    if (regrAnchor) {
      const REGR_EVIDENCE_RE = /\.test\.mjs|workflow\/regression-checklist\.md|regression-smoke|npm\s+test|dotnet\s+test|run-tests|verify\.mjs/;
      for (const inc of docFiles('incidents')) {
        const incSt = fmGet(inc, '状态');
        if (!['fixed', 'closed'].includes(incSt)) continue;
        const add = addedDateOf(inc);
        if (!add || add < regrAnchor) continue; // 存量豁免（不可判定亦不拦——无判定依据不出 hard）
        const lines = linesOf(inc) || [];
        if (!lines.some((l) => REGR_EVIDENCE_RE.test(l))) {
          blockers.push(`- [回归证据缺失] ${path.basename(inc)} 已 ${incSt} 但防复发验证未落自动化用例/回归清单引用（模板强制项，禁「已人工验证」）`);
        }
      }
    }
  }
  } // laneOn('3x') 守卫闭合

  // --- 8. intent 验收标准对账（done 须逐条勾验并补证据；新建 hard，存量聚合 warning）---
  if (laneOn(8)) { // lane=hard：验收对账
  markGate('8', '验收标准对账');
  // 生效日锚 2026-09-28 改「git 首次加入日期」（此前取文件名前 10 字符——命名规范强制的字段、
  // 写早零成本）。非 git → 不可判定 → 走存量口径（不误报 hard）。
  {
    const accCutoff = '2026-09-12';
    let legacyUnaccounted = 0;
    // 测试绿缺凭证聚合面（2026-10-18 告警聚合口径批）：**判据不变**（同一批文档/证据项照常检出），
    // 只改输出形态——单文档多证据项只计一份；跨运行当日去重（同文档当日只逐份点名一次，已点名的
    // 进一条聚合计数行，防静默被误读为已修）。背景：源仓 9 天遥测该 WARN 占全部告警 61%
    //（1062/1738，文档密集期 14.8 条/运行）——复读刷屏稀释 WARN 信号价值。状态面放 os.tmpdir()
    // 按 ROOT 派生键（本地机判、不进装户仓、无 gitignore 依赖、fail-open：读失败=全点名，落失败不影响裁决）。
    const verifyMissingDocs = new Map(); // rel -> base（去重键 = 仓内相对路径）
    // 测试绿凭证状态（2026-10-07 verify-evidence）：台账读一次循环外缓存；policy 缺 verifySince
    //（v1-v4）→ ctxBase null → 对账整体跳过（向后兼容）
    const verifySinceOf = kitPolicy.verifySince;
    // 台账内容循环外读一次并缓存（doc 过滤是纯内存行匹配，不新增子进程——门禁成本零增加）。
    const verifyLines = (() => {
      try {
        const vp = path.join(ROOT, '.agents', 'verifications.jsonl');
        return fs.existsSync(vp) ? fs.readFileSync(vp, 'utf8').split(/\r?\n/) : null;
      } catch { return null; }
    })();
    // 全局绿行（v5 语义）：仅供 v1-v5 装户走原路径，本仓 v6+ 不再消费它。
    const verifyFreshGlobal = verifyLines ? hasFreshVerifyLine(verifyLines) : false;
    // 2026-10-08 verify-doc-binding：v6+（verifyDocSince）按本 doc 精确匹配；缺键维持全局布尔。
    const verifyDocBound = typeof kitPolicy.verifyDocSince === 'string';
    // 2026-10-09 verifydoc-anchor：v6 精确匹配的**追溯边界**——只对「确认门 done ts ≥ verifyDocSince」的单生效。
    // 背景（用户 2026-10-09 拍板 D）：4 单（verify-evidence / workflow-dashboard / selfmeasure / gate-roi-metrics）
    // 的 done ts 均 < v6 上线日（2026-10-08 17:37），它们关单时既无 --doc 机制、也无从补证——被精确匹配追责
    // 会产 9 条不可消退 advisory（补跑=自证，回溯不了关单当时全绿，与门禁本意相悖）。退回全局布尔 = v5 语义
    // （不误报、不伪造），与检查 15/18 生效日锚同构。done ts 台账读一次循环外缓存，零新增子进程。
    const verifyDocSinceTs = verifyDocBound ? kitPolicy.verifyDocSince : null;
    const doneTsOf = (() => {
      const map = new Map();
      try {
        // 读法收敛 ledger-loader（2026-10-12 ledger-loader-p1）：末次 done 跳转取自物理读序，
        // loader 保持读序返回故「取末次」语义与逐处直读一致（分片按文件名序排在主台账之后＝较新）
        for (const e of readLedgerRows(ROOT)) {
          if (e && e.doc && ['done', 'closed'].includes(e.stage)) map.set(e.doc, e.ts || '');
        }
      } catch { /* 台账不可读 → 无锚 → 全走全局布尔（fail-open，不误报 hard） */ }
      return map;
    })();
    // 该 doc 的确认门 done 是否落在 v6 追溯窗口内；无台账行 / 台账不可读 → false（存量豁免，退回全局布尔）
    // 2026-10-09 verifydoc-anchor：按 ISO 时刻比较（不再是日期粒度）——机制上线当日的更早时刻 done 的单
    // 仍在窗口外（日期粒度会把同日的早时刻误纳入，见 policy.mjs verifyDocSince 注释）。
    const verifyDocInWindow = (rel) => {
      if (!verifyDocSinceTs) return false;
      const ts = doneTsOf.get(rel);
      return !!ts && ts >= verifyDocSinceTs;
    };
    const verifyFreshFor = (rel) => (verifyLines
      ? hasFreshVerifyLine(verifyLines, Date.now(), verifyDocInWindow(rel) ? rel : null)
      : false);
    for (const intent of docFiles('intents')) {
      if (fmGet(intent, '状态') !== 'done') continue;
      const base = path.basename(intent);
      const rel = path.relative(ROOT, intent).split(path.sep).join('/'); // 与 verify.mjs --doc 落账口径同源
      const lines = linesOf(intent) || [];
      // 节扫描：hs=有验收节；insec 至下一个二级标题；uc=未勾项；ne=勾选缺证据；ex=存量豁免声明
      //   证据可写在 [x] 行的续行（仓库通写法「（证据：…）」另起一行）——pendX 记「待证据项」，
      //   遇证据行（全角「：」/半角「:」皆认）清零；遇下一条目 / 下一小节 / 节末仍无证据 → ne
      let hs = false, uc = false, ne = false;
      let insec = false, ex = false;
      let pendX = false; // 上一 [x] 项尚无证据，证据可能在紧随的续行
      let currentEvidence = ''; // 当前条目的证据内容，用于语义校验
      const evidenceItems = []; // 逐条证据（2026-10-06-v114-backflow-batch：两遍裁决——先文档级判实现证据在场，再逐条落判）
      const evRe = /证据[：:]/;
      const closeItem = () => { 
        if (pendX) { 
          ne = true; 
          pendX = false; 
        } 
        if (currentEvidence && !ex) {
          evidenceItems.push(currentEvidence);
        }
        currentEvidence = '';
      };
      for (const line of lines) {
        if (/存量对账豁免（/.test(line)) ex = true;
        if (/^\s*##\s+[^#]*验收标准/.test(line)) { hs = true; insec = true; closeItem(); continue; }
        if (insec && /^\s*##\s/.test(line)) { insec = false; closeItem(); continue; }
        if (!insec) continue;
        if (/^\s*- \[ \]/.test(line)) { closeItem(); uc = true; continue; }
        if (/^\s*- \[x\]/.test(line)) { 
          closeItem(); 
          pendX = !evRe.test(line); 
          if (evRe.test(line)) currentEvidence = line.split(/证据[：:]/)[1].trim();
          continue; 
        }
        if (pendX && evRe.test(line)) { 
          pendX = false; 
          currentEvidence = line.split(/证据[：:]/)[1].trim();
        } else if (currentEvidence && line.trim() && !/^\s*- /.test(line)) {
          // 简单累加续行证据
          currentEvidence += ' ' + line.trim();
        }
      }
      closeItem(); // 节末（或全文末）仍无证据 → 计缺证据
      // 两遍裁决（2026-10-06-v114-backflow-batch 记录型提交豁免）：文档级先判「存在可过检实现证据」
      // （sha / process 型任一），记录型提交（subject=docs 系）证据仅在实现证据在场时降级豁免告警——
      // 冒烟报告 / approved 留痕 / 关单提交不改 plan 声明面属预期；仅引记录型而无实现证据 → 维持 hard-block
      //（豁免通道不得独立成立，防「只引 docs 提交洗白代码改动」）。
      if (evidenceItems.length) {
        const planBase = base.replace(/.md$/, '');
        // verify 对账 ctx：intent 首次加入 git ≥ verifySince（v5 锚）才参与；不可判定 → null 走 text 豁免
        const iadd = addedDateOf(intent);
        const vctx = typeof verifySinceOf === 'string' && iadd !== '' && iadd >= verifySinceOf
          ? { verifyRelevant: true, hasFresh: verifyDocBound ? verifyFreshFor(rel) : verifyFreshGlobal } : null;
        const results = evidenceItems.map((ev) => ({ t: verifyEvidenceTruth(ev, planBase, ROOT, vctx) }));
        const hasImplEvidence = results.some((r) => r.t.ok && (r.t.type === 'sha' || r.t.type === 'process'));
        for (const r of results) {
          if (r.t.ok && r.t.type === 'verify-missing') {
            verifyMissingDocs.set(rel, base); // 出账统一在循环外（聚合/当日去重，见声明处注释）
            continue;
          }
          if (r.t.ok) continue;
          if (r.t.type === 'irrelevant' && r.t.recordCommit && hasImplEvidence) {
            warnEvidenceExempt('record', planBase);
            continue;
          }
          blockers.push(`- [证据${r.t.type === 'forged' ? '伪造' : '无关'}] ${base} 验收证据校验失败: ${r.t.msg}`);
        }
      }
      // 生效日锚 = git 首次加入日期（2026-09-28 改；此前取文件名前 10 字符）。**准确收益**：关掉
      // 「改文件名日期（日常必写、零成本）即整段跳过 hard 门」这条通道；锚取 author date(%aI)，
      // 刻意伪造（`git commit --date=`）仍可绕过——与伪造台账同属本地信任边界内，不宣称"通道已关闭"。
      // 非 git / 查不到 → '' → isNew=false → 走存量口径（与既有语义一致：不可判定时不误报 hard）。
      const adddate = addedDateOf(intent);
      const isNew = adddate !== '' && adddate >= accCutoff;
      if (!hs) {
        if (isNew) blockers.push(`- [验收未对账] done intent 缺「## 验收标准」节(勾验无从核对):${base}`);
        else if (!ex) legacyUnaccounted++;
        continue;
      }
      // 场景覆盖子判据（2026-10-10 scenario-coverage，灰度第一档 = warning）：
      //   同名 spec 写了「## 验收场景」节（GIVEN/WHEN/THEN，每条带 ID：S1、S2…）时，
      //   done intent 的验收标准须**逐场景 ID 引用**（`场景：S1`）。缺引用只出 warning——
      //   有意不进 hard：新判据先灰度观察存量装户告警噪音，沿检查 8 自身 / 检查 15 / 检查 18
      //   「先 WARN、装户吃过警告后升 FAIL」的既有路径；spec 无该节 = 原判据零变化。
      //   ID 提取单源 = 本块（spec 侧），引用匹配只认验收标准节内的 `场景：S<n>` 行。
      // 引用断链子判据（2026-10-11 dangling-ref，P2-1，灰度第一档 = warning）：
      //   上判据的**反向对账**——验收标准引用了 spec 未声明的场景 ID = 悬空引用（改 ID 漏改 / 复制粘贴
      //   残留的机器信号）；spec 无场景节但引用了 S<n> 同样算断链（引用了不存在的场景）。与「场景未覆盖」
      //   共用同一次 ID 解析与引用遍历（covered 一份两用），不重复解析。
      // THEN 断言子判据（2026-10-11 then-assertion，P2-2，灰度第一档 = warning）：
      //   声明了场景却无 THEN 断言行 = 空壳场景——THEN 是可观测结果的机器对账锚（GIVEN/WHEN 可省），
      //   聚合一条不逐场景刷屏；验收场景节本身可选，节不存在 → 零变化。
      const specPath = path.join(ROOT, WF, 'specs', base);
      if (fs.existsSync(specPath)) {
        const sids = scenarioIdsOf(specPath);
        // 引用遍历单次（覆盖/断链两方向共用）：不锁进 sids.length 分支——spec 无场景节时引用同样悬空
        const covered = new Set();
        for (const line of lines) {
          const m = line.match(/场景[：:]\s*S(\d+)/);
          if (m) covered.add(`S${m[1]}`);
        }
        if (sids.length) {
          const missing = sids.filter((id) => !covered.has(id));
          if (missing.length) {
            warnings.push(`- [WARN 场景未覆盖] ${base} 同名 spec 有验收场景但验收标准未逐场景引用：缺 ${missing.join('、')}——在「## 验收标准」按「- [x] 场景：S<n> <判据>（证据：…）」补齐（advisory，灰度第一档；不写场景节的 spec 不适用）`);
          }
          // THEN 对账需 spec 全文（scenarioIdsOf 只回 ID）；读取失败 = 不可判定 → 跳过不误报（fail-open）
          let thenMap = null;
          try { thenMap = extractThenByScenario(fs.readFileSync(specPath, 'utf8')); } catch { /* 极窄竞态，不判空壳 */ }
          if (thenMap) {
            const noThen = sids.filter((id) => !(thenMap.get(id) || []).length);
            if (noThen.length) {
              warnings.push(`- [WARN 场景无断言] ${base} 同名 spec 场景缺 THEN 断言：${noThen.join('、')}——每场景至少一行「- THEN <可观测结果>」（GIVEN/WHEN 可省；advisory，灰度第一档）`);
            }
          }
        }
        const dangling = [...covered].filter((id) => !sids.includes(id));
        if (dangling.length) {
          warnings.push(`- [WARN 场景引用断链] ${base} 验收标准引用了 spec 未声明的场景 ID：${dangling.join('、')}——修正 ID 或在 spec「## 验收场景」补该场景（advisory，灰度第一档）`);
        }
      }
      // 沉淀追踪子判据（2026-10-10 sediment-tracking，灰度第一档 = warning）：
      //   intent 高价值节（影响面 / 触达红线）是 wiki 沉淀的主源——frontmatter「沉淀: <相对仓根路径>」
      //   登记去向（如 wiki/项目规范/xxx.md），「沉淀: 无」= 显式声明不沉淀。缺登记且内容高价值
      //   → WARN 未沉淀（advisory：沉淀是人工判断，机器只提醒不强制，不进 hard）；登记了但文件
      //   不存在 → WARN 沉淀断档（路径漂移）；存在但空壳（无来源且非占位正文不足 3 行）→ WARN 落点
      //   空壳（2026-10-11 landing-reality，P1-3 落点真实性）。高价值判据 = 两节之一有非占位正文内容。
      //   incident 侧对称（检查 3 内）：closed 且复盘三件套齐全 = 最高价值沉淀源，同款提醒。
      //   有意不加 policyVersion 锚：字段缺失 = 未登记，无字段语义零变化（沿场景覆盖子判据同款口径）。
      const sed = fmGet(intent, '沉淀');
      const highValue = sectionHasBody(lines, '影响面') || sectionHasBody(lines, '触达红线');
      if (highValue && !sed) {
        warnings.push(`- [WARN 未沉淀] ${base} 含高价值沉淀内容（影响面/触达红线）但未登记沉淀去向——整理到 wiki 后在 frontmatter 记「沉淀: wiki/<主题>/<文件>」，或显式写「沉淀: 无」（advisory，灰度第一档；沉淀是人工判断，机器只提醒不强制）`);
      } else if (sed && sed !== '无' && !fs.existsSync(path.resolve(ROOT, sed))) {
        warnings.push(`- [WARN 沉淀断档] ${base} frontmatter「沉淀: ${sed}」指向的文件不存在——沉淀文件移动/改名后须同步更新本字段（advisory，灰度第一档）`);
      } else if (sed && sed !== '无') {
        warnSedimentShell(base, sed); // 落点真实性（P1-3）：存在但空壳 → WARN 落点空壳
      }
      if (!uc && !ne) continue;
        if (isNew) {
          if (uc) blockers.push(`- [验收未对账] done intent 验收标准有未勾验项:${base}（逐条勾验并补证据：commit/用例/冒烟输出）`);
          if (ne) blockers.push(`- [验收缺证据] ${base} 验收标准勾选项缺「证据：」标注——证据是闭环准确性的唯一机器事实`);
        } else if (!ex) {
          legacyUnaccounted++;
        }
    }
    // 测试绿缺凭证出账（判据见 collector；⚠️ 文案锚点硬约束：既有 check-loop.test.mjs 锚定
    // 「测试绿缺凭证」四字连续，doc 与修复命令只能追加在整句之后，不得插进四字中间）：
    // 当日首次命中的文档逐份点名（可操作明细）；当日已点名的聚合成一条计数行。
    if (verifyMissingDocs.size) {
      const today = new Date().toISOString().slice(0, 10);
      const statePath = path.join(os.tmpdir(), `agentic-flow-kit-check8-warn-${ROOT.replace(/[^A-Za-z0-9]/g, '-').slice(-60)}.json`);
      let warnedToday = {};
      try { warnedToday = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { /* 无状态/坏状态 = 空集 → 全部点名 */ }
      const silent = [];
      for (const [rel, base] of verifyMissingDocs) {
        if (warnedToday[rel] === today) silent.push({ rel, base });
        else {
          warnings.push(`- [WARN 测试绿缺凭证] ${base} 验收证据声明「测试绿」但 24h 内无 verify 凭证（verifications.jsonl${verifyDocBound ? `；本单须带 --doc 落账` : ''}）——跑 node .agents/scripts/verify.mjs${verifyDocBound ? ` --doc ${rel}` : ''} 后重跑（advisory，灰度第一档）`);
        }
      }
      if (silent.length) {
        warnings.push(`- [WARN 测试绿缺凭证] 另有 ${silent.length} 份在飞文档同日已点名、去重静默（${silent.slice(0, 5).map((d) => d.base).join('、')}${silent.length > 5 ? '…' : ''}）——修法同上：跑 node .agents/scripts/verify.mjs${verifyDocBound ? ' --doc <本单>' : ''} 后重跑（advisory，灰度第一档）`);
      }
      try {
        // 只留当日命中（隔日自动失效，状态面自洁；本机各 ROOT 独立键，互不串扰）
        const next = {};
        for (const [rel] of verifyMissingDocs) next[rel] = today;
        fs.writeFileSync(statePath, JSON.stringify(next));
      } catch { /* 落状态失败不影响裁决与输出（fail-open，advisory 层不因状态面故障改行为面） */ }
    }
    if (legacyUnaccounted > 0) {
      warnings.push(`- [WARN 验收对账存量] ${legacyUnaccounted} 个存量 done intent 验收标准未对账（生效日锚之前加入仓库，豁免 hard，不回填）`);
    }
  }
  } // laneOn(8) 守卫闭合

  // --- 10. 级别 vs 迁移文件一致性 [warning]（启发式：入口文档加入提交触及迁移 SQL/Migrations → 疑似判低；非 git 跳过）---
  if (laneOn(10)) { // lane=hygiene
  markGate('10', '级别 vs 迁移文件');
  if (gitOut(['rev-parse', '--git-dir']) !== null) {
    const log = gitOut(['log', '--diff-filter=A', '--format=@%H', '--name-only']);
    if (log !== null) {
      const addpath = new Map(); // 文件 → 首次加入 commit（新→旧序首遇）
      const cfiles = new Map();  // commit → 文件清单
      let cur = null;
      for (const line of log.split('\n')) {
        if (line.startsWith('@')) { cur = line.slice(1); cfiles.set(cur, []); continue; }
        if (line.trim() && cur && !addpath.has(line.trim())) {
          addpath.set(line.trim(), cur);
          cfiles.get(cur).push(line.trim());
        }
      }
      const docs = [...docFiles('intents'), ...docFiles('incidents')];
      for (const doc of docs) {
        const rel = path.relative(ROOT, doc).split(path.sep).join('/');
        const lvl = fmGet(doc, '级别');
        if (lvl !== 'L1' && lvl !== 'L2') continue;
        const c = addpath.get(rel);
        if (!c) continue;
        const hits = (cfiles.get(c) || []).filter((f) => /(^|\/)docs\/scripts\/.*\.sql$/.test(f) || /(^|\/)Migrations\//.test(f));
        if (hits.length) {
          warnings.push(`- [WARN 级别疑似判低] ${path.basename(doc)} 级别 ${lvl} 但其加入提交触及迁移文件(混合改动应就高不就低,请复核级别):\n${hits.join('\n')}`);
        }
      }
    }
  }
  } // laneOn(10) 守卫闭合

  // --- 14. 新 done 的 spec/plan 须有确认留痕：git 历史「状态: approved」 或 confirmations.jsonl 台账 approved 行 [warning]（恒 advisory；非 git 跳过）---
  if (laneOn(14)) { // lane=hard：确认留痕
  markGate('14', '确认留痕（approved 快照）');
  // 2026-10-08 papercuts-cleanup-batch 修 3：两跳确认同批提交时 git 历史不出现行首「状态: approved」曾误报，
  // 而台账已证明两跳均走（2026-09-28-adopter-derivers 实证）——判据改 OR 并集（git 判据保留不弱化，
  // 台账为第二通道；确认事件以台账为准）。台账伪造面由检查 15 指纹 hard 门把关，本修仅消 advisory 误报。
  if (gitOut(['rev-parse', '--git-dir']) !== null && gitOut(['rev-parse', '-q', '--verify', 'HEAD']) !== null) {
    // 台账 approved 文档集合：单次读取（坏行容忍跳过，与检查 15 同口径）；缺失视为空集（git 判据仍守门）
    const ledgerApproved = new Set();
    try {
      for (const e of readLedgerRows(ROOT)) {
        if (typeof e.doc === 'string' && e.stage === 'approved') ledgerApproved.add(e.doc);
      }
    } catch { /* 台账不可读视为无 approved 行 */ }
    for (const sub of ['specs', 'plans']) {
      for (const doc of docFiles(sub)) {
        if (fmGet(doc, '状态') !== 'done') continue;
        const base = path.basename(doc);
        let d = fmGet(doc, '日期') || fmGet(doc, '发现');
        if (!d) d = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < kitPolicy.check14Since) continue; // policy.mjs check14Since
        const lines = linesOf(doc) || [];
        if (lines.some((l) => l.includes('存量确认态豁免（'))) continue; // 保留：服务对象随修 3 自然消失，退役条件=连续两版本周期零命中
        const rel = path.relative(ROOT, doc).split(path.sep).join('/');
        // 命中判据单源（stage-gates.approvedTraceHit，2026-09-30 confirm-gate-approved-history）：
        // 返回 ''=从未出现 / <sha>=命中 / null=git 调用失败（不报，沿本段 fail-open 口径）
        const hit = approvedTraceHit(ROOT, rel);
        if (hit !== null && hit === '' && !ledgerApproved.has(rel)) {
          warnings.push(`- [WARN 确认态缺失] ${base} 状态已 done 但 git 历史中从未出现行首「状态: approved」——确认环节未留痕(draft 直跳 done)`);
        }
      }
    }
  }
  } // laneOn(14) 守卫闭合

  // --- 15. 确认指纹对账 [hard-block]（2026-09-26 confirm-gate-machine；2026-09-27 confirm-gate-delegated 两形态；
  //     生效日锚 2026-09-28 改台账 ts——此前锚取自文档自报「日期/发现」，新档只要把日期写早即整段跳过判定，
  //     incident 2026-09-28-confirm-gate-effective-date-anchor 实证）---
  if (laneOn(15)) { // lane=hard：指纹链
  markGate('15', '确认指纹对账');
  // 确认两形态（confirm-doc.mjs）：TTY 亲手键入「可以」/ --delegated 对话委托代录（用户对话内明确放行后
  // AI 代录，台账行如实记 source=chat-delegated + quote 原话，永不伪装 TTY）。intents/specs/plans 凡
  // approved/done 须有 confirm-doc 产生的 frontmatter 确认指纹 + 台账（.agents/confirmations.jsonl）
  // 配对行——配对判据 doc/stage/fingerprint 三键，与 source 无关。
  // **生效日锚 = 台账 ts（2026-09-28 起）**：受管准入 = 该 doc 在台账中有合法跳转行（stage ∈ approved/done/
  // fixed/closed/superseded/cancelled，append-only 取末次）；无台账行 = 存量豁免（不追溯）。自报日期
  // （日期/发现/文件名）不再参与门禁判定——它可被作者手填，把「门是否生效」的决定权交给被约束对象本身
  // 是自举漏洞；台账行是「确认确实发生过」的唯一机器事实。docs 与 incidents 共用同一锚（原 incidents
  // 独立生效日 2026-09-28 常量退役：台账起算日 = docs 生效日，两档等价）。
  // 台账坏行容忍跳过（审计件，jsonl 追加式）；frontmatter 存 16 位、台账存 64 位，按前 16 位配对。
  {
    const EFFECTIVE = kitPolicy.confirmDocsEffective;
    // 取数走 ledger-loader 的**带来源行号视图**（2026-10-12 ledger-shard-write）：主台账 + 分片
    // `.agents/confirmations.d/*.jsonl`。分片里的行同样受链校验——否则 `--shard` 写入就等于给台账开了
    // 一个防伪盲区（门禁看得见分片行、却不验它们的链）。
    // **此处曾刻意不走 loader**（单源化时留的例外，因当时要物理行号对齐）；引入分片后该理由已不成立
    // ——单一行号跨来源无法定位，故改用带 rel 的定位。第二处例外仍是 check-ledger-invariant.mjs
    // （它审的是**盘面字节**的 append-only 前缀不变量，不是台账语义，见该文件头部）。
    const ledger = [];
    const ledgerRefs = [];   // 与 ledger 同下标：{rel, no}——断裂报文的定位来源
    for (const e of readLedgerEntries(ROOT)) {
      if (e.row === null) continue; // 坏行跳过（容错口径同前；它占物理行号但不入 ledger 下标）
      ledger.push(e.row);
      ledgerRefs.push({ rel: e.rel, no: e.no });
    }
    // 台账哈希链校验（2026-10-09 engine-quality-round2 D；2026-10-12 ledger-doc-chain 改链域；
    // 写入侧=confirm-doc appendLedger，哈希单源 policy.ledgerChainHash——判定零复刻）。
    // **链域已从「文件物理序」改为「按 doc 的逻辑序」**（锚后生效，理由与不追溯口径见 POLICIES v8）：
    //   原判据 ① prevHash = 前一带 hash 行（物理）的 hash；新判据 ① = **同行 doc** 最后一个带 hash 行的
    //   hash。两者都要求 ② hash 可重算一致。无 hash 行仍按「链段重启」处理。
    //   并发 append / git 并集合并 / 分片归并这三种**正常协作**都会打断物理链——门禁若继续据此 hard 拦，
    //   必然被 --no-verify 绕过，治理失效；而 doc 链对就地改行 / 删行 / 插行三类篡改的检出能力不变。
    // **坏行口径（复核 P2-1 勘误，此前注释误称「与写入侧一致」）**：坏行被本解析整体剔除、不重置游标
    // ——坏行后写入的链行（写入侧读末行遇坏行 prevHash=''）验链必失配出账。这是**预期 fail-loud**
    // （坏行本身即台账完整性事故，应人工查验），非口径一致场景。
    // 断裂 = hard「台账链断裂」（只报首断**物理行号** + 影响行计数，不做逐行刷屏）——就地改/删中间行
    // 必留痕迹；边界：整文件重写可重建链，不可机器防，兜底 = 台账自身 git 历史（check-ledger-invariant）。
    // 历史行（v1.5.0 前，无 hash 字段）零回填零告警——向后兼容。
    {
      let prevHash = '';
      let brokenAt = 0;
      let brokenCount = 0;
      // 链域分界（2026-10-12 ledger-doc-chain）：doc 链锚存在且合法时，**按行分域**验链——
      //   锚前行（ts < 锚）维持物理链口径（存量零变化）；锚后行（ts ≥ 锚）按「同行 doc 的最后一个
      //   带 hash 行」接续，并同样要求 hash 可重算一致。锚缺键（v1-v7）→ 全表走物理链（= 旧行为）。
      // byDoc 对**两种域的行都更新**：锚后行需要接到锚前该 doc 的最后一行，跨域才能连续。
      const docChainOn = ledgerDocChainActive(kitPolicy);
      const docChainSince = docChainOn ? kitPolicy.ledgerDocChainSince : '';
      const byDoc = new Map();
      const prunedHashSet = prunedHashesOf(ROOT); // 特许修剪凭据（无 manifest 时为空集，零 IO 成本）
      ledger.forEach((row, idx) => {
        if (!row || typeof row.hash !== 'string') { prevHash = ''; return; } // 存量行/无链字段 → 链段重启
        const { hash, prevHash: p, ...rest } = row;
        const inDocChain = docChainOn && typeof row.ts === 'string' && row.ts >= docChainSince;
        const expected = inDocChain ? (byDoc.get(row.doc) ?? '') : prevHash;
        // 特许修剪链段重启（2026-10-12 ledger-prune-manifest）：删掉某 doc 的链行后，其后继行仍带被删行
        //   的 prevHash，而该行已不在表内 → 必然失配。本行的 prevHash 若出现在 manifest 声明的被删哈希里，
        //   即视为**有凭据的合法重启点**而非篡改（凭据 = .agents/ledger-prune-manifest.json，入库可对质）。
        const prunedRestart = (p ?? '') !== expected && prunedHashSet.has(p ?? '');
        const ok = ((p ?? '') === expected || prunedRestart) && ledgerChainHash(rest, p ?? '') === hash;
        if (!ok) {
          if (!brokenAt) brokenAt = idx + 1; // 1-based 下标，供 ledgerRefs 定位
          brokenCount++;
        }
        prevHash = hash;
        if (typeof row.doc === 'string') byDoc.set(row.doc, hash);
      });
      if (brokenAt) {
        // 定位用 ledgerRefs（来源 + 行号）：跨来源后单一行号无法定位；坏行占位不计入 ledger 下标
        const at = ledgerRefs[brokenAt - 1] || { rel: LEDGER_REL, no: brokenAt };
        const domain = docChainOn ? '锚前物理链 / 锚后 doc 链' : '物理链';
        blockers.push(`- [台账链断裂] 自 ${at.rel}:${at.no} 起哈希链校验失败（${domain}，共 ${brokenCount} 行不一致——append-only 台账出现就地改/删痕迹；prevHash 接续或内容重算不符。整文件重写不可机器防，对质走台账自身 git 历史）`);
      }
    }
    // scope 子项（2026-10-09 审查 A1 干净版）：受管台账行须带**机器派生**的改动面 scope{files,sha256}。
    // 背景：委托代录的授权凭据原是 `--delegated` 的用户原话——自由文本机器不可校验、AI 可零成本复用
    //   （本仓实测「可以」133 次、「确认」60 次，406 行里仅 6 行 tty），整条授权链源头不可核对。
    //   干净版把分辨力从「一句说过的话」换成「机器实测的这 N 个文件」：写入侧 confirm-doc.machineScope
    //   自动派生（被确认文档 + `git status --porcelain` 未提交改动集），AI 无输入面。
    // 判定（scopeSince 生效**时刻**锚，缺键 v1-v6 整体跳过——存量行零新增告警、不追溯）：
    //   ① 缺 scope → warning（灰度第一档：新机制先观察，升 hard 走后续 policyVersion 演进）
    //   ② scope 存在但按其 files 重算 sha256 不符 → hard-block（「改了 files 没改摘要」= 同一信任
    //      边界内的手改痕迹；哈希链本已覆盖就地改，本项兜住「整文件重写重建链」后二次篡改的场景）
    // 注：scope 证明的是「放行时盘面上哪些文件在动」，**不是**「这些改动语义正确」——后者由 fingerprint
    //   （文档内容绑定）+ commit diff（事后对质）承担。不越界宣称（沿本检查既有口径纪律）。
// 形态口径（2026-10-19 补齐 TTY 缺口）：三形态（TTY / chat-delegated / ai-auto-trust-Lx）一律记 scope，
//   判定按形态**一致**——确认的是「放行时盘面上哪些文件在动」，与谁点的确认无关。TTY 是最常见形态
//   （本仓 406 行里 400 行 tty），此前只 delegated / ai-auto 带 scope，缺口让最常见形态吃最多告警。
    {
      const since = loadKitPolicy(ROOT).scopeSince;
      if (typeof since === 'string' && Number.isFinite(Date.parse(since))) {
        const sinceT = Date.parse(since);
        const missing = [];
        const mismatched = [];
        for (const row of ledger) {
          if (!row || typeof row.ts !== 'string') continue;
          const t = Date.parse(row.ts);
          if (!Number.isFinite(t) || t < sinceT) continue; // 存量豁免（不追溯）
          const name = row.doc || '(未知 doc)';
          if (!row.scope) { missing.push(name); continue; }
          if (!scopeMatches(row)) mismatched.push(name);
        }
        if (missing.length) {
          warnings.push(`- [WARN 缺机器改动面] ${missing.length} 条受管台账行无 scope 字段（${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' …' : ''}）——confirm-doc 落账自动派生 scope；此形态多见于手工/旧脚本写的行，advisory 不阻断`);
        }
        if (mismatched.length) {
          blockers.push(`- [台账 scope 失配] ${mismatched.length} 条受管台账行的 scope.sha256 与其 files 重算不符（${mismatched.slice(0, 3).join('、')}${mismatched.length > 3 ? ' …' : ''}）——「改了 files 没同步摘要」，同一信任边界内的手改痕迹；对质走台账 git 历史`);
        }
      }
    }
    // incidents 侧覆盖（2026-09-27 gate-coverage）：fixed/closed 为已确认态（open = 起草态不加门——
    // maintain.md 创建即对话确认的既有口径）
    // 放弃态覆盖（2026-09-27 closing-coverage）：superseded/cancelled 入配对集——confirm-doc --to 是唯一
    // 合法产生通道（cancelled 自 draft/approved/open/fixed；superseded 自 approved/done/fixed/closed），
    // 此前手改 frontmatter 即出账的口子收死
    const CONFIRMED_BY_SUB = {
      intents: ['approved', 'done', 'superseded', 'cancelled'],
      specs: ['approved', 'done', 'superseded', 'cancelled'],
      plans: ['approved', 'done', 'superseded', 'cancelled'],
      incidents: ['fixed', 'closed', 'superseded', 'cancelled'],
    };
    // 合法跳转 stage 集（台账行「确认确实发生过」的判据；revert-draft / revert-open 类回退注记行不算）
    const VALID_STAGES = new Set(['approved', 'done', 'fixed', 'closed', 'superseded', 'cancelled']);
    for (const [sub, confirmedSet] of Object.entries(CONFIRMED_BY_SUB)) {
      for (const doc of docFiles(sub)) {
        const st = fmGet(doc, '状态');
        if (!confirmedSet.includes(st)) continue;
        const base = path.basename(doc);
        const rel = path.relative(ROOT, doc).split(path.sep).join('/');
        // 受管准入 = 两条件取或（2026-09-28 改锚）：
        //   ① 台账中有该 doc 的合法跳转行——「确认确实发生过」的机器事实；它独立于自报日期成立，
        //      故堵死「确认过却把日期写早以逃掉对账」这条攻破路径（本 incident 的核心缺陷）；
        //   ② 自报日期 ≥ 生效日——覆盖「新档完全没跑 confirm-doc」的漏网面（此类无台账行，
        //      仅靠 ① 会被误判为存量豁免而静默放行）。
        // 两条件皆不满足 = 存量豁免（生效日前既有、从未走确认门，不追溯）。
        const docEntries = ledger.filter((e) => e && e.doc === rel && VALID_STAGES.has(e.stage));
        const eff = sub === 'incidents' ? kitPolicy.confirmIncidentsEffective : EFFECTIVE;
        let d = fmGet(doc, '日期') || fmGet(doc, '发现');
        if (!d) d = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
        const dateManaged = /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= eff;
        if (!docEntries.length && !dateManaged) continue; // 存量豁免
        const fp = fmGet(doc, '确认指纹');
        const ok = !!fp && docEntries.some((e) => e.stage === st
          && typeof e.fingerprint === 'string' && e.fingerprint.startsWith(fp));
        if (!ok) {
          blockers.push(`- [确认未对账] ${base} 状态 ${st} 无用户确认记录——AI 不得代确认，用户在终端跑 node .agents/scripts/confirm-doc.mjs ${rel} 后重试`);
        }
        // 内容绑定（2026-09-27 audit-gate-hardening；生效锚 2026-09-27 gate-hardening-p2-batch 自文档自报日期
        // 改为台账 done 行 ts）：done 文档当前内容须与台账 done 行确认时的内容一致——按 prev 复原跳转前文本
        // 重算比对，防「确认后篡改」（改验收标准/正文均触发）。复原口径 = confirm-doc computeFingerprint 的
        // 逆推：CRLF 归一 → frontmatter 首个「状态:」行保分隔符换值为台账 prev（双空格等非规范分隔符不误伤，
        // 与前向按原行字面计算对称）→ 剔「确认指纹:」行。两条降级路径：台账行缺 prev（schema 演进前存量，
        // 无以复原）→ warning 不拦；entry.ts 早于 2026-09-28（UTC 字符串比较——该次确认在旧关单顺序时代完成）→
        // 豁免绑定（配对判定已过，3 份失配存量即此列）。关单编辑顺序新约定不变：confirm-doc 是最后一次写入，
        // 此后修订走 superseded 或新 intent。
        if (ok && ['done', 'closed', 'superseded', 'cancelled'].includes(st)) {
          const doneEntries = ledger.filter((e) => e && e.doc === rel && e.stage === st && typeof e.fingerprint === 'string');
          const entry = doneEntries[doneEntries.length - 1]; // append-only 台账，末次生效（重确认场景）
          if (!entry || !entry.prev) {
            warnings.push(`- [WARN 绑定降级] ${base} 台账 stage=${st} 行缺 prev 字段（schema 演进前行），内容绑定跳过——仅配对判定`);
          } else if (!(typeof entry.ts === 'string' && entry.ts >= kitPolicy.bindingTs)) {
            // 该 done 确认发生在生效锚前（旧关单顺序时代）——豁免内容绑定，配对判定照常
          } else if (bindingSha256(linesOf(doc) || [], entry.prev) !== entry.fingerprint) {
            blockers.push(`- [确认内容漂移] ${base} ${st} 后内容与确认台账不符——已关单文档不得直接改（关单编辑先于关单确认）；确需修订走 superseded 或新 intent 引用，或经用户裁定按 maintain.md §4 走补偿行通道（node .agents/scripts/append-compensation.mjs <doc> --quote "<裁定原话>"）`);
          }
        }
      }
    }
    // 并录批次审计（2026-09-28 batch-ledger-audit 改判据；原 2026-09-27 confirm-gate-one-per-call 引入）：
    // **读调用事实，不猜时间戳模式**。判据 = 台账行按 `batch` 分组，组内 `of > 1` → warning「确认并录」。
    // batch/seq/of 由 confirm-doc 在**写入时**记录（那才是「本次调用落了几份」确定已知的时刻）；
    // 旧判据「同 quote + 相邻 ts 差 < 2s」是拿两个间接信号反推该事实，已实证四类失效并**整段退役**：
    //   ① 假阳性：合规逐件调用复用同句（用户两次都说「可以」）→ 必然误报；
    //   ② 假阴性：并录时给每份换不同 quote → 零告警（判据的实际效果是引导伪装者改 quote）；
    //   ③ 噪声不可消退：不按日期门豁免，退役前本仓 22 条 advisory 中 14 条为该告警，且文案自认「不可区分」；
    //   ④ 字段职责冲突：`quote` 同时当「对质凭据」与「并录指纹」——现归还单一职责，只记用户原话。
    // 无 `batch` 字段的历史行（schema 演进前，本仓全部 67 行均无该字段）→ **静默跳过**，不降级出账、不回溯：
    // 按 audit-gate-hardening P3 教训（「扫了只产生不可消除的 advisory 噪声，真漏点被淹没」），无判定依据
    // 的行不该产出告警。VALID_STAGES 复用外层声明（复核 P2-3 更正：此前本块内另有一份同名声明遮蔽外层）。
    {
      const byBatch = new Map(); // batch → 该批的台账行（仅计合法跳转 stage）
      for (const e of ledger) {
        if (!e || !VALID_STAGES.has(e.stage)) continue;
        if (typeof e.batch !== 'string' || !e.batch) continue; // 历史行无 batch → 无判定依据，跳过
        if (!byBatch.has(e.batch)) byBatch.set(e.batch, []);
        byBatch.get(e.batch).push(e);
      }
      for (const [b, rows] of byBatch) {
        // 判据取组内**任一行** of>1（复核 P2-3 更正：原取 rows[0].of 使结论依赖行序——同批首行 of=1、
        // 次行 of=2 会漏报。confirm-doc 对同批所有行写同一个 of=docs.length，故正常批次组内一致；
        // 改用 some 消除该顺序脆弱性，并对 craft 出来的不一致批次按「最大值」报，方向偏严不偏松）
        if (!rows.some((r) => typeof r.of === 'number' && r.of > 1)) continue;
        // of > 1 = 一次调用落多份态。delegated 形态下这正是「并录」（入口已拒多份，此处抓历史/绕行）；
        // TTY 形态天然逐份过目（用户亲手键入），of>1 不构成违规——故只对 delegated 行报。
        if (!rows.some((r) => r.source === 'chat-delegated')) continue;
        // 协作道批量豁免（2026-09-30 hybrid-governance-risk-lanes）：confirm-doc --batch 仅受理 L1
        // （逐份读级别，L2/L3 逐份拒绝），台账行带 brief:true——全行带标记的批次是 sanctioned 泳道行为
        // （异步审计兜底），不出「确认并录」；缺标记（旧版脚本/手造台账）照旧告警，判据偏严不偏松。
        if (rows.every((r) => r.brief === true)) continue;
        const of = Math.max(...rows.map((r) => (typeof r.of === 'number' ? r.of : 0)));
        const docs = rows.map((r) => String(r.doc).replace(/^workflow\//, '')).join('、');
        warnings.push(`- [WARN 确认并录] 单次调用落账 ${rows.length} 份（batch ${b}，of=${of}）：${docs}——同一次 --delegated 调用放行多份，塌掉「逐件确认」门（build.md；口径见根 AGENTS.md「门禁与提交」确认门节）`);
      }
    }
  }
  } // laneOn(15) 守卫闭合

  // --- 16. 量化断言指标签名对账 [warning]（2026-09-28 claim-exceeds-fix；登记表单源 .agents/metric-claims.txt）---
  if (laneOn(16)) { // lane=hygiene
  markGate('16', '量化断言签名对账');
  // 判据要点：活跃态文档（draft/approved/open）中的 `{{指标名}}`（小写点分）签名须替换为实时值，留签名=未回填=
  //   warning；只查显式签名、不全文扫数字（历史叙述假阳性恒 0）；未登记签名 / 取数器缺失 → fail-loud 出账；
  //   登记表缺失 → 静默跳过（未启用该检查的装户零噪声）；装户自有指标走 .agents/metric-derivers.cjs（CJS 契约，
  //   内置优先）。实现自 2026-09-28 check16-inline-debt 起迁出至 check-metric-claims.mjs（原内联块，判据语义/
  //   消息文案/exit 语义零变化，迁出经全量输出 diff 基线验证）。ctx 显式携带本检查引用的外层符号
  //   （ROOT/ENUMS/docFiles/fmGet/inSet/isTracked/linesOf/readdirOrNull/warnings，以代码实际引用集为准）；
  //   调用位置须保持在检查 15 之后、输出段之前——warnings 按插入序输出，位置变化会改变输出行序。
  runCheck16({ ROOT, ENUMS, docFiles, fmGet, inSet, isTracked, linesOf, readdirOrNull, warnings });
  } // laneOn(16) 守卫闭合

  // --- 17. 发版提交树上仍未收口的 intent/spec/plan [hard-block] ---
  if (laneOn(17)) { // lane=hard：发版收口
  markGate('17', '发版树未收口文档');
  // 最近一次 package.json version 发生变化的提交里，当时状态已是 draft 或 approved 的
  // intent/spec/plan，被扫描的树上仍是 draft 或 approved 则阻断。
  // 当时已是 draft：不看版本锚。当时已是 approved：只在发版版本大于
  // policy.check17UnclosedAfter 时阻断。版本 1 没有该键，因此不启用后两格。
  // 版本按主、次、修订三段整数比较。沿 package.json 的全部历史查找，不设次数上限。
  // 该提交之后新建的文件不在范围内。open 的 incident 不在此列。
  // 快径（2026-10-16 减重）：当前树 package.json 无 version 字段（装户非 node 仓 / 快照树）
  // → 整段跳过——无 version 则「version 变化的提交」永不存在，本段恒不触发，省去全历史 git log+show
  // 扫描。适配点：源仓 s17 为独立模块函数用 return 快返；kit 单体函数内改 if 包裹，保后续段照常执行。
  {
    let curVer = null;
    try { curVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { curVer = null; }
    if (curVer) {
    const log = gitOut(['log', '--format=%H', '--', 'package.json']);
    if (log) {
      let release = null;
      let releaseVer = '';
      for (const sha of log.split('\n').map((s) => s.trim()).filter(Boolean)) {
        const curTxt = gitOut(['show', `${sha}:package.json`]);
        if (!curTxt) continue;
        let cur = null;
        try { cur = JSON.parse(curTxt).version; } catch { continue; }
        const prevTxt = gitOut(['show', `${sha}^:package.json`]);
        let prev = null;
        if (prevTxt) { try { prev = JSON.parse(prevTxt).version; } catch { prev = null; } }
        if (cur && cur !== prev) { release = sha; releaseVer = cur; break; }
      }
      const tree = release && gitOut(['ls-tree', '-r', '--name-only', release, '--', `${WF}/intents`, `${WF}/specs`, `${WF}/plans`]);
      if (release && tree) {
        for (const rel of tree.split('\n').map((s) => s.trim()).filter(Boolean)) {
          if (!rel.endsWith('.md') || rel.endsWith('_TEMPLATE.md')) continue;
          const thenTxt = gitOut(['show', `${release}:${rel}`]);
          if (!thenTxt) continue;
          const thenSt = fmStatus(thenTxt);
          const nowSt = fmGet(path.join(ROOT, rel), '状态');
          if ((thenSt !== 'draft' && thenSt !== 'approved') || (nowSt !== 'draft' && nowSt !== 'approved')) continue;
          if (thenSt === 'approved' && !versionGreater(releaseVer, kitPolicy.check17UnclosedAfter)) continue;
          const here = REV ? `提交 ${REV.slice(0, 7)}` : '工作区';
          blockers.push(`- [发版草稿] ${rel} 在 version=${releaseVer} 的提交 ${release.slice(0, 7)} 上已是 ${thenSt}，${here}仍是 ${nowSt}。发版提交树上未收口的 intent/spec/plan 须先离开 draft 与 approved。覆盖面只含该提交当时已在树上的 intent/spec/plan；其后新建的文件不在此列`);
        }
      }
    }
    }
  }
  } // laneOn(17) 守卫闭合

  // --- 18. 委派台账对账 [warning] ---
  if (laneOn(18)) { // lane=hygiene
  markGate('18', '委派台账对账');
  // L2/L3 的 intent、spec、plan 状态为 done，或同级别 incident 状态为 fixed 或 closed 时，
  // 「委派结果」表与「自做任务结果」表均没有日期不早于文档日期、且含该文件名（带/不带 .md 均匹配）的一行，则警告。
  // 缺级别、缺日期、以及其他状态不警告。audit:false 时 warnings.push 已被换成空函数。
  // 两表解析口径与 agg-delegations.cjs splitTables 保持一致，一边改另一边须跟。
  // 分片感知（2026-10-13 ledger-shard-ledgers）：delegationResultRows 走 delegation-presence（主 ∪ 分片）
  // 合并读（主台账 ∪ delegations.d/*.md），分片行与本表行同一对账口径，判据零改动。
  {
    const rows = delegationResultRows(path.join(ROOT, WF, 'delegations.md'));
    for (const sub of ['intents', 'specs', 'plans', 'incidents']) {
      for (const abs of docFiles(sub)) {
        const lvl = fmGet(abs, '级别');
        if (lvl !== 'L2' && lvl !== 'L3') continue;
        const st = fmGet(abs, '状态');
        const inScope = sub === 'incidents' ? (st === 'fixed' || st === 'closed') : st === 'done';
        if (!inScope) continue;
        const date = sub === 'incidents' ? (fmGet(abs, '发现') || fmGet(abs, '日期')) : fmGet(abs, '日期');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        // delegationSince 生效日豁免（policy v4，2026-10-06 loop-audit-remediation）：锚前文档为存量回溯件
        // ——台账记法约定（delegations.md 头部「任务一句话含文件名」）自生效日才立，存量不回填；缺键
        // （v1-v3）→ 维持原全量对账行为（向后兼容，检查面不放松）
        if (typeof kitPolicy.delegationSince === 'string' && date < kitPolicy.delegationSince) continue;
        const base = path.basename(abs);
        if (rowCovers(rows, base, date)) continue; // 在场判据单源（2026-10-25 source-port-batch：与 confirm-doc 终态前置门共用）
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        warnings.push(`- [WARN 委派台账] ${rel} 在 ${date} 及之后的委派结果/自做任务结果表中没有该文件名`);
      }
    }
  }
  } // laneOn(18) 守卫闭合

  // --- 19. 逐阶段审计 [warning]（2026-09-30 stage-gate-machine；口径与 stage-gates.mjs / fill-* / confirm-doc 前置门互引） ---
  if (laneOn(19)) { // lane=hygiene
  markGate('19', '逐阶段审计');
  // 判据 A（在途扫描）：同名 spec/plan 为 draft 且其日期 ≥ stageGateSince 时——入口未确认（intent：状态非
  //   approved/done、或缺台账行且非存量；incident：「时间线」小节缺行首「用户确认」条目）→ warning；
  //   入口缺合法「级别」→ warning（与起草门 fail-closed 同口径，2026-09-30 复核 P2-7）；
  //   plan 另判（入口级别 L2/L3 且 spec 未确认或缺失）→ warning。
  // 判据 B（台账顺序）：同主题 {intents,specs,plans} 的 approved 行（每 doc 取最早）时间须非降序；仅对
  //   组内最早 ts 日期 ≥ stageGateSince 的主题判定；含更早 ts 的主题整组跳过（历史豁免）。
  // 协作道豁免（2026-09-30 hybrid-governance-risk-lanes）：入口 intent 为 draft 且级别 L1 → 判据 A 静默
  //   （「先动手后确认」是泳道语义；approved/done 无台账行仍照报）；判据 B 对入口 L1 的主题豁免顺序
  //   倒置判定（入口文件缺失不豁免）。
  // stageGateSince 缺键（policy v1）→ 本检查整体跳过；全部 warning、不 hard-block。
  {
    const since = kitPolicy.stageGateSince;
    if (typeof since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(since)) {
      const ledgerRows = [];
      {
        for (const e of readLedgerRows(ROOT)) ledgerRows.push(e);
      }
      const hasRow = (rel) => ledgerRows.some((e) => e && e.doc === rel && (e.stage === 'approved' || e.stage === 'done'));
      const docConfirmed = (rel, abs) => {
        const st = fmGet(abs, '状态');
        if (st !== 'approved' && st !== 'done') return { ok: false, legacy: false, why: `状态「${st || '缺失'}」` };
        if (hasRow(rel)) return { ok: true, level: fmGet(abs, '级别'), legacy: false };
        const d = fmGet(abs, '日期') || fmGet(abs, '发现');
        const legacy = (linesOf(abs) || []).some((l) => /^流程: legacy/.test(l))
          || (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < kitPolicy.confirmDocsEffective);
        if (legacy) return { ok: true, level: fmGet(abs, '级别'), legacy: true };
        return { ok: false, legacy: false, why: '无确认台账行' };
      };
      // incident 留痕判定：**直接复用 stage-gates.mjs 的 MARK_RE**（第七轮复核 N3：此前此处内联复制
      // 一份同口径字面量，两处靠注释人工同步、无测试钉住——改为单源复用，从结构上消除漂移可能）。
      // 判据同源：「## 时间线」小节内、行首列表条目含「用户确认」（词边界见 MARK_RE）。
      const incidentMarked19 = (lines) => {
        let inTimeline = false;
        for (const l of lines || []) {
          if (/^##\s/.test(l)) { inTimeline = /^##\s*时间线/.test(l); continue; }
          if (inTimeline && MARK_RE.test(l)) return true;
        }
        return false;
      };
      const entryConfirmed19 = (base) => {
        const irel = `${WF}/intents/${base}.md`;
        const iabs = path.join(ROOT, irel);
        if (fs.existsSync(iabs)) {
          const st19 = fmGet(iabs, '状态');
          const lvl19 = fmGet(iabs, '级别');
          const r = docConfirmed(irel, iabs);
          const body = (linesOf(iabs) || []).join('\n');
          const d19 = fmGet(iabs, '日期') || fmGet(iabs, '发现');
          const storLegacy = /^流程: legacy/m.test(body) || (/^\d{4}-\d{2}-\d{2}$/.test(d19) && d19 < kitPolicy.confirmDocsEffective);
          return { ...r, level: lvl19, risk: fmGet(iabs, 'risk_level'), date: d19, entryDraft: st19 === 'draft', storageLegacy: storLegacy };
        }
        const crel = `${WF}/incidents/${base}.md`;
        const cabs = path.join(ROOT, crel);
        if (fs.existsSync(cabs)) {
          const st = fmGet(cabs, '状态');
          if ((st === 'open' || st === 'fixed' || st === 'closed') && incidentMarked19(linesOf(cabs))) {
            return { ok: true, level: fmGet(cabs, '级别'), legacy: false, storageLegacy: false };
          }
          return { ok: false, legacy: false, storageLegacy: false, why: 'incident 未见过目留痕（时间线条目缺失）' };
        }
        return { ok: false, legacy: false, storageLegacy: false, why: '无同名入口' };
      };
      for (const sub of ['specs', 'plans']) {
        for (const abs of docFiles(sub)) {
          if (fmGet(abs, '状态') !== 'draft') continue;
          const base = path.basename(abs).replace(/\.md$/, '');
          // 日期：frontmatter 优先，缺则回落文件名前缀（plan 无「日期」字段；沿检查 15 口径）
          let d = fmGet(abs, '日期');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
          if (!(/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= since)) continue;
          const rel = path.relative(ROOT, abs).split(path.sep).join('/');
          const ent = entryConfirmed19(base);
          if (!ent.ok) {
            // 协作道异步审计豁免（2026-09-30 hybrid-governance-risk-lanes；2026-10-02 caliber-convergence
            // 起单源 laneOfEntry·方案 C）：入口 intent 仍为 draft 且泳道 low（级别 L1）→「先动手后
            // 确认」是泳道语义，不告警；suspect（缺失/非法/分歧）不豁免；approved/done 却无台账行仍照报
            // （防手改状态冒充确认，与交叉一致性口径同）；incident 入口不豁免（过目留痕本就轻量）。
            if (ent.entryDraft && laneOfEntry(ent.level, ent.risk, kitPolicy.riskLevelSince, ent.date) === 'low') continue;
            warnings.push(`- [WARN 逐阶段] ${rel} 起草先于入口确认（${ent.why}）`); continue;
          }
          // 库存量形态（标记 / 日期早于生效日）短路 level 校验与 spec 档（与起草门同口径，N1）
          const storLegacy = ent.storageLegacy === true;
          if (!storLegacy && !/^L[0-3]$/.test(ent.level)) { warnings.push(`- [WARN 逐阶段] ${rel} 入口缺合法「级别」字段（无法判定前置深度；与起草门 fail-closed 同口径，库存量形态除外）`); continue; }
          if (sub === 'plans' && !storLegacy && (ent.level === 'L2' || ent.level === 'L3')) {
            const srel = `${WF}/specs/${base}.md`;
            const sabs = path.join(ROOT, srel);
            const sp = fs.existsSync(sabs) ? docConfirmed(srel, sabs) : { ok: false, why: '缺同名 spec' };
            if (!sp.ok) warnings.push(`- [WARN 逐阶段] ${rel} 起草先于 spec 确认（${sp.why}）`);
          }
        }
      }
      const firstApproved = new Map(); // base -> { intents?, specs?, plans? } 最早 approved ts
      for (const e of ledgerRows) {
        if (!e || e.stage !== 'approved' || typeof e.doc !== 'string') continue;
        const m = /^workflow\/(intents|specs|plans)\/(.+)\.md$/.exec(e.doc);
        if (!m) continue;
        const rec = firstApproved.get(m[2]) || {};
        if (!rec[m[1]] && typeof e.ts === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(e.ts)) rec[m[1]] = e.ts;
        firstApproved.set(m[2], rec);
      }
      for (const [base, rec] of firstApproved) {
        const seq = ['intents', 'specs', 'plans'].filter((k) => rec[k]);
        if (seq.length < 2) continue;
        // 协作道豁免（2026-09-30 hybrid-governance-risk-lanes）：入口 L1 的审批顺序倒置（如 plan 先于
        // intent approved——「动手后确认」）是异步审计泳道语义，非流程违规；入口文件缺失（纯台账历史行 /
        // incident 侧）不豁免，维持既有判据。
        // existsSync 守卫（2026-10-06-check19-entry-enoent）：incident 闭环主题无同名 intent，「读空判级」
        // 惯用法（缺文件→级别空→不豁免，判定面不变）在 fail-loud fs 读（2026-10-05-gitout-fail-open）下
        // 每次推送响亮出账 N 条 ENOENT 噪声——守卫跳过读取，语义与上注释一致；同款先例 entryConfirmed19
        // 与下方 spec 读取。
        const iabsB = path.join(ROOT, WF, 'intents', `${base}.md`);
        const ilvlB = fs.existsSync(iabsB) ? fmGet(iabsB, '级别') : '';
        if (ilvlB === 'L1') continue;
        const earliest = seq.map((k) => rec[k]).sort()[0];
        if (!(earliest.slice(0, 10) >= since)) continue;
        let ordered = true;
        for (let i = 1; i < seq.length; i++) if (rec[seq[i]] < rec[seq[i - 1]]) ordered = false;
        if (!ordered) warnings.push(`- [WARN 逐阶段] 台账审批顺序倒置：${base}（${seq.map((k) => `${k}=${rec[k].slice(0, 19)}`).join(' / ')}）`);
      }
    }
  }
  } // laneOn(19) 守卫闭合

  // --- 加固门（仅 --hardening 启用；2026-09-30 hybrid-governance-explore-hardening）[hard-block] ---
  // 探索泳道（experiment/* 分支 + intent frontmatter「阶段: exploring」标记；「状态: exploring」亦认——
  // 非法状态本就会在检查 5 出账）允许「先动手后确认」快速 PoC；成果转正（合入 main）前必须完成加固：
  //   ① intent 状态离开 draft → approved/done（探索作废走显式放弃态 superseded/cancelled——留档即出列，
  //      不加固：放弃态无代码应随行）；
  //   ② 同名 plan 在场且状态收口（∈ doc.status.confirmed——本门是转正门槛，不是配对门）；
  //   ③ 泳道 L2/L3（级别优先、缺失/非法回落 risk_level，与 stage-gates 起草门同款取法）另须同名 spec
  //      在场且收口。
  // 触发面：.githooks/pre-push 对 remote=refs/heads/main 的推送以 --hardening 运行本脚本（hard 失败即阻断
  // push）；手跑 `node check-loop.mjs --hardening` 可转正前预检。诚实边界：分支名不进 commit，扫描树无法
  // 机械判定「曾在 experiment/* 上」——标记靠泳道纪律写入（intent 模板 / workflow README 口径），漏标记的
  // 探索件不被本门覆盖；本门拦的是「已标记未收口」。
  if (HARDENING) {
    for (const intent of docFiles('intents')) {
      if (fmGet(intent, '阶段') !== 'exploring' && fmGet(intent, '状态') !== 'exploring') continue;
      const base = path.basename(intent);
      const st = fmGet(intent, '状态');
      if (st === 'superseded' || st === 'cancelled') continue; // 放弃态：探索作废留档，不加固
      const lvl = fmGet(intent, '级别');
      // 泳道单源（2026-10-02 caliber-convergence 方案 C）：suspect（缺失/非法/分歧）按 high——L2/L3 另须 spec
      const lane = laneOfEntry(lvl, fmGet(intent, 'risk_level'), kitPolicy.riskLevelSince, fmGet(intent, '日期'));
      if (st !== 'approved' && st !== 'done') {
        blockers.push(`- [加固未过] exploring 任务入 main 须先收口:${base} intent 状态仍为『${st || '缺失'}』——先确认至 approved/done 并补齐同名 spec+plan，或显式放弃（superseded/cancelled）`);
        continue;
      }
      const planAbs = path.join(ROOT, WF, 'plans', base);
      const planSt = fs.existsSync(planAbs) ? fmGet(planAbs, '状态') : '';
      if (!fs.existsSync(planAbs)) {
        blockers.push(`- [加固未过] exploring 任务入 main 缺同名 plan:${base}（应在 ${WF}/plans/ 下同名）`);
      } else if (!stOkDoc(planSt)) {
        blockers.push(`- [加固未过] exploring 任务入 main 的 plan 未收口:${base}（plan 状态『${planSt || '缺失'}』须为 approved/done）`);
      }
      // 泳道单源（2026-10-02 caliber-convergence 方案 C；复核 P1-1 修正）：suspect（缺失/非法/分歧）与
      // high 同样另须同名 spec——仅 low（级别 L1）免 spec，只增不松。
      if (lane !== 'low') {
        const specAbs = path.join(ROOT, WF, 'specs', base);
        const specSt = fs.existsSync(specAbs) ? fmGet(specAbs, '状态') : '';
        if (!fs.existsSync(specAbs)) {
          blockers.push(`- [加固未过] exploring 任务入 main 缺同名 spec:${base}（级别 ${lvl}/risk ${fmGet(intent, 'risk_level') || '缺失'}，应在 ${WF}/specs/ 下同名）`);
        } else if (!stOkDoc(specSt)) {
          blockers.push(`- [加固未过] exploring 任务入 main 的 spec 未收口:${base}（spec 状态『${specSt || '缺失'}』须为 approved/done）`);
        }
      }
    }
  }

  // --- 20. 引擎脚本测试覆盖 [warning]（2026-10-01 gate-script-test-coverage；仅包源环境） ---
  if (laneOn(20)) { // lane=hygiene
  markGate('20', '引擎脚本测试覆盖');
  // 包源开发纪律：templates/_agents/scripts/ 下每个非 *.test.mjs 引擎脚本须有同名兄弟 .test.mjs，
  // 或在 .agents/scripts-test-exempt.txt 登记豁免（managed 下发）。装户（无 templates/）整体跳过。
  {
    const scriptsDir = path.join(ROOT, 'templates', '_agents', 'scripts');
    if (fs.existsSync(scriptsDir)) {
      const exemptFile = path.join(ROOT, '.agents', 'scripts-test-exempt.txt');
      const exempt = fs.existsSync(exemptFile)
        ? fs.readFileSync(exemptFile, 'utf8').split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'))
            .map((l) => l.split('|')[0].trim())
            .filter(Boolean)
        : [];
      const orphans = fs.readdirSync(scriptsDir)
        .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && !exempt.includes(f))
        .filter((f) => !fs.existsSync(path.join(scriptsDir, f.replace(/\.mjs$/, '.test.mjs'))));
      for (const f of orphans.sort()) {
        warnings.push(`- [WARN 脚本测试缺失] ${f} 缺同名 .test.mjs——新增引擎脚本默认必须带测试；库件/工具可在 .agents/scripts-test-exempt.txt 登记豁免`);
      }
    }
  }
  } // laneOn(20) 守卫闭合

  // --- §21–§26 六段检查（2026-10-13 B6b-2；段序沿上游 SECTIONS 21→26，接在 §20 后）---
  // ctx 只传既有共享面（与 check-hygiene / check-stage-index 的 ctx 同纪律：判定语义单源在段模块内，
  // helper 单源在本文件——复刻即造口径分叉）。段体直接 push 进共享 warnings/blockers（不返回数组，
  // check-16 先例），故 markGate 记账走共享收集器、增量天然正确（无需 appendSegs 中转）。
  // 各段判据与适配清单见各模块文件头注。
  const sharedCtx = { ROOT, WF, DOC_DIRS, ENUMS, inSet, docFiles, fmGet, linesOf, isTracked, readdirOrNull, addedDateOf, kitPolicy, warnings, blockers };
  if (laneOn(21)) { markGate('21', 'spec 验证落地核查'); runSpecVerif(sharedCtx); } // lane=hygiene（锚 specVerifSince）
  if (laneOn(22)) { markGate('22', '机制使用量台账'); runRegistry(sharedCtx); }     // lane=hygiene（mechanism-registry 在场才启用）
  if (laneOn(23)) { markGate('23', '判据级收敛对账'); runConvergence(sharedCtx); } // lane=hard（hard 档随 convergenceHardSince）
  if (laneOn(24)) { markGate('24', 'incident 归因字段'); runAttribution(sharedCtx); } // lane=hygiene（锚 attributionSince）
  if (laneOn(25)) { markGate('25', '路由预判一致性'); runPrejudgment(sharedCtx); } // lane=hard（内容纯 WARN 不阻断）
  if (laneOn(26)) { markGate('26', '闭环漏斗协议前占比'); runFunnel(sharedCtx); }  // lane=hygiene（metrics.md 在场才启用）
  if (laneOn(27)) { markGate('27', '回归清单引用一致性'); runRegressionConsistency(sharedCtx); }  // lane=hygiene（台账在场才产出；关单时另有 confirm-doc 硬前置）

  // --- 输出（banner 沿 sh 版字样与格式 = 稳定输出契约：banner 后空行、条目 '- ' 前缀）---
  // 门禁 ROI 收口（2026-10-08 gate-roi-metrics）：末段结算（末段之后无下次 gateSeg 调用）+ 可选落盘。
  // ⚠️ 结算在输出**之前**：否则检查 20 之后的段不计入。落盘只在 --gate-stats 时发生。
  if (opts.gateStats) writeGateStats(ROOT, finishSegs(gateStats));
  // --- 判定流水落账（2026-10-11 judgment-ledger，灰度消费端数据底座）---
  // 每次真实运行追加一行 per-rule 判定计数到 .agents/judgments.jsonl（本地 gitignore；fixture 经
  // CHECK_LOOP_ROOT 守卫自动跳过）——mechanism-registry 月度对账与 advisory→hard 升格判定的数据源
  // 由「人工 grep 输出」升级为 agg-judgments.mjs 查账。fail-open：落账失败不改变门禁裁决与输出契约。
  // mode 随分道传真实运行面（2026-10-13 B6b-1：hard/hygiene/all——原 'all' 硬编码随分道退役）。
  recordRun({ root: ROOT, mode: LOOP_MODE, blockers, warnings });
  if (blockers.length) {
    process.stderr.write(`闭环骨架断档（check-loop.sh）— HARD-BLOCK:\n\n${blockers.join('\n')}\n\n`);
    if (warnings.length) process.stderr.write(`WARN（advisory,不阻断）:\n\n${warnings.join('\n')}\n`);
    return { exitCode: 1, blockers, warnings };
  }
  if (warnings.length) {
    process.stderr.write(`check-loop.sh WARN（advisory,不阻断）:\n\n${warnings.join('\n')}\n`);
  }
    return { exitCode: 0, blockers, warnings };
}

// ---- CLI 入口（isMain 守卫）——takeOpts 的用法错误仍 process.exit(1)（CLI 专属路径）----
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('check-loop.mjs');
if (isMain) process.exit(runCheckLoop(takeOpts()).exitCode);

export function delegationResultRows(file) {
  // 单源抽取（2026-10-25 source-port-batch）：行解析与在场判据迁 delegation-presence.mjs（检查 18 与
  // confirm-doc 终态前置门共用）；本导出保持签名与语义逐字不变（import 契约 2026-10-08 checkloop-importable）。
  // file 为显式注入路径时只读该文件（测试语义不变）；传默认主台账路径 → 走分片合并。
  return delegationRowsOf(path.dirname(path.dirname(file)), file);
}

export function versionGreater(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

export function fmStatus(text) {
  const lines = String(text || '').split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] || '')) return '';
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) return '';
    if (lines[i].startsWith('状态:')) return lines[i].slice('状态:'.length).trim();
  }
  return '';
}

// bindingSha256：done 内容绑定的复原重算（检查 15 专用）——confirm-doc.mjs computeFingerprint 的逆推：
// lines 已 CRLF 归一（split(/\r?\n/)），frontmatter 区内首个「状态:」行保分隔符换值为 prev（`状态:  done`
// 双空格 → `状态:  approved`——与前向按原行字面计算对称，非规范分隔符不误伤；行尾空白等更奇异格式仍会
// 失配，触发前提本身已违反「确认落态唯一入口」约定，接受），全文剔「确认指纹:」行后 join('\n') 再 sha256。
// parseAddedDatesLog：git log（--diff-filter=A --format=@%aI --name-only）文本 → Map(rel → 加入 ISO 时间)。
// 新→旧序首遇 = 最新一次加入（复核 P2-1 勘误：旧注释「最早」系误述——行为原样零复刻，检查 8 isNew 取最新加入日期更保守）。
export function parseAddedDatesLog(logText) {
  const m = new Map();
  let cur = null;
  for (const line of logText.split('\n')) {
    if (line.startsWith('@')) { cur = line.slice(1); continue; }
    if (line.trim() && cur && !m.has(line.trim())) m.set(line.trim(), cur);
  }
  return m;
}

// addedDatesWithCache：addedDates 的持久缓存层（2026-10-09 engine-quality-round3 W1）。
// 键 = HEAD sha（同 commit 祖先不可变 → log 幂等；rebase 必改 HEAD 必重算；复核 P2-4：shallow→unshallow 同 HEAD 可见性增长有陈旧窗口——后果退化为旧行为 addedDateOf 返回 ""，HEAD 变化自愈）；
// 缓存位于 .agents/cache/（gitignored 运行态）；读/写任一失败 fail-open 回退全算（门禁不失效）；
// head 缺省（detached --rev worktree 等场景）→ 不读写缓存直接全算（语义不变）。
export function addedDatesWithCache({ head, gitLog, cachePath }) {
  if (head) {
    try {
      const c = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (c && c.head === head && c.map && Object.keys(c.map).length) return new Map(Object.entries(c.map));
    } catch { /* 缓存缺失/损坏 → 全算 */ }
  }
  const log = gitLog();
  if (log === null) return null;
  const m = parseAddedDatesLog(log);
  if (head) {
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      const tmp = cachePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ head, map: Object.fromEntries(m), savedAt: new Date().toISOString() }) + '\n');
      fs.renameSync(tmp, cachePath);
    } catch { /* 写失败 fail-open：本轮已用全算结果，缓存留待下次 */ }
  }
  return m;
}

export function bindingSha256(lines, prevStatus) {
  const isDelim = (l) => /^---\s*$/.test(l);
  const out = [];
  let i = 0;
  if (isDelim(lines[0] || '')) {
    out.push(lines[0]);
    let replaced = false;
    for (i = 1; i < lines.length; i++) {
      if (isDelim(lines[i])) { out.push(lines[i]); i++; break; }
      if (!replaced && /^状态:/.test(lines[i])) {
        out.push(lines[i].replace(/^(\s*状态:\s*)\S.*$/, `$1${prevStatus}`));
        replaced = true;
      } else out.push(lines[i]);
    }
  }
  for (; i < lines.length; i++) out.push(lines[i]);
  return createHash('sha256').update(out.filter((l) => !/^确认指纹:/.test(l)).join('\n'), 'utf8').digest('hex');
}

function readdirOrNull(dir) {
  try { return fs.readdirSync(dir); } catch { return null; }
}
function isDirectoryOrNull(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// 场景 ID 提取（2026-10-10 scenario-coverage，检查 8 场景覆盖子判据的 spec 侧单源）：
//   认「## 验收场景」节内的场景声明——三级标题 `### S1 <名>` 或列表项 `- S1 <名>`，
//   提取 S<n> 形 ID（按出现序去重）。节外不认（防「## 功能行为」里偶然出现的 S1 干扰）。
//   无该节 / 无场景声明 → 空数组（调用方按「不适用」跳过，原判据零变化）。
//   独立 export 供单元测试直测（纯函数：只吃文件路径、只读）。
export function scenarioIdsOf(specPath) {
  let lines;
  try { lines = fs.readFileSync(specPath, 'utf8').split(/\r?\n/); } catch { return []; }
  const ids = [];
  let inSec = false;
  for (const line of lines) {
    if (/^\s*##\s+[^#]*验收场景/.test(line)) { inSec = true; continue; }
    if (inSec && /^\s*##\s/.test(line)) break; // 下一二级标题 = 节末
    if (!inSec) continue;
    const m = line.match(/^\s*(?:###|-)\s*\**S(\d+)\b/i);
    if (m && !ids.includes(`S${m[1]}`)) ids.push(`S${m[1]}`);
  }
  return ids;
}

// THEN 断言抽取（2026-10-11 then-assertion，检查 8「场景无断言」子判据的 spec 侧单源）：
//   输入 spec 全文，定位「## 验收场景」节（节定位正则与 scenarioIdsOf 同款——口径单源，改写法时两处同步），
//   按场景块分组（`### S1 <名>` 三级标题或 `- S1 <名>` 列表项，声明正则同 scenarioIdsOf），抽块内 THEN 断言行。
//   行匹配口径：剥缩进后以 `- THEN` 开头（模板规定形式）；`THEN:` / `THEN `（无连字符）也认——
//   防「写了断言但少了 `- ` 前缀」的写法漂移把断言误判为空；只认行首 THEN，GIVEN/WHEN 行中段的
//   "THEN" 字样不误抽。返回 Map<S-ID, string[]>（声明即建键，无 THEN = 空数组——空壳判定交给调用方）；
//   节不存在 / 非字符串输入 → 空 Map（验收场景节本身可选，调用方零变化）。
//   独立 export 供单元测试直测（纯函数：只吃文本、无 IO）。
export function extractThenByScenario(text) {
  const byScen = new Map();
  if (typeof text !== 'string') return byScen; // 读取失败（调用方传 null）→ 空 Map，调用方按不可判定跳过
  const lines = text.split(/\r?\n/);
  let cur = null; // 当前场景块 ID（null = 尚未进入任何场景块，节头说明行不算断言）
  let inSec = false;
  for (const line of lines) {
    if (/^\s*##\s+[^#]*验收场景/.test(line)) { inSec = true; continue; }
    if (inSec && /^\s*##\s/.test(line)) break; // 下一二级标题 = 节末
    if (!inSec) continue;
    const decl = line.match(/^\s*(?:###|-)\s*\**S(\d+)\b/i);
    if (decl) {
      const id = `S${decl[1]}`;
      if (!byScen.has(id)) byScen.set(id, []);
      cur = id;
      continue;
    }
    if (cur === null) continue;
    const s = line.trim();
    if (/^-\s*THEN\b/i.test(s) || /^THEN\b/i.test(s)) byScen.get(cur).push(s);
  }
  return byScen;
}

// 节体非空判定（2026-10-10 sediment-tracking，检查 8 沉淀追踪子判据的「高价值」信号）：
//   认 `## <标题前缀>` 节内**标题之后**存在非空非占位行（占位 = `<…>` 单行包揽 / HTML 注释 / 引用）。
//   只有光标题（如模板未填的 `## 影响面`）= 未沉淀价值，不出告警——防模板未填段被误判为高价值。
//   前缀匹配（startsWith）：兼容「## 影响面」「## 影响面与边界」等变体写法。
//   独立 export 供单元测试直测（纯函数：只吃行数组、无 IO）。
export function sectionHasBody(lines, headingPrefix) {
  let inSec = false;
  for (const line of lines) {
    if (/^\s*##\s/.test(line)) {
      const t = line.replace(/^\s*##\s*/, '').trim();
      inSec = t.startsWith(headingPrefix);
      continue;
    }
    if (!inSec) continue;
    const s = line.trim();
    if (!s) continue;
    if (/^<.*>$/.test(s) || s.startsWith('<!--') || s.startsWith('>')) continue; // 占位 / 注释 / 引用
    return true;
  }
  return false;
}

// 沉淀落点空壳判定（2026-10-11 landing-reality，「存在 ≠ 有效」的落点真实性一环）：
//   落点文件可能是只有标题没有内容的空壳。满足任一即**非**空壳（有效沉淀）：
//   ① frontmatter 含「来源:」键（人工已登记来源 = 真实整理的机器信号；frontmatter 口径同 fmGet 受限子集）；
//   ② frontmatter / 标题行 / 占位行剔除后的非空正文 ≥ 3 行（占位口径逐字对齐 sectionHasBody：
//     `<…>` 单行包揽 / HTML 注释 / 引用块）——标题行不算正文，防「只有标题」凑行数绕过。
//   text = 落点文件全文；非字符串（调用方读取失败传 null）按空壳处理，调用方在告警文案注明读取失败。
//   独立 export 供单元测试直测（纯函数：只吃文本、无 IO）。
export function sedimentLandingIsShell(text) {
  if (typeof text !== 'string') return true; // 读取失败 → 按空壳
  const lines = text.split(/\r?\n/);
  const isDelim = (l) => /^---\s*$/.test(l); // 同 fmGet：首行 --- 进入、下一 --- 闭合
  let inFm = isDelim(lines[0] || '');
  if (inFm) {
    for (let i = 1; i < lines.length; i++) {
      if (isDelim(lines[i])) break; // 下一 --- = frontmatter 闭合
      if (lines[i].startsWith('来源:')) return false; // ① 有来源登记 = 有效
    }
  }
  let body = 0;
  for (let i = inFm ? 1 : 0; i < lines.length; i++) {
    if (inFm) {
      if (isDelim(lines[i])) inFm = false; // frontmatter 闭合，其后才开始数正文
      continue;
    }
    const s = lines[i].trim();
    if (!s) continue;
    if (s.startsWith('#')) continue; // 标题行 = 结构不算正文（空壳 = 只有标题没有内容）
    if (/^<.*>$/.test(s) || s.startsWith('<!--') || s.startsWith('>')) continue; // 占位 / 注释 / 引用（同 sectionHasBody）
    if (++body >= 3) return false; // ② 非占位正文 ≥ 3 行 = 有效
  }
  return true;
}
