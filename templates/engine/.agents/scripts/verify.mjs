#!/usr/bin/env node
// verify.mjs — 统一静态门编排（2026-10-09 质量增强版；2026-10-09 守护者自守护批次）
// 用途：在关单或 CI 前一键过门——执行全部静态检查，逐项输出 pass/fail。
// 语义：单源口径。确保本地 run-verify 与 Azure Pipeline 行为 100% 一致。
// 凭证落账：全绿才落绿凭证；任一步红即落失败行，供根因分析。绿/失败行均带 dirtyTree 脏树摘要
//         （BACKLOG 34）：sha256(`git status --porcelain` 输出 + `git diff HEAD` 内容) 前 16 位——绑定
//         「验证时刻工作树 = 基线提交 + 未提交改动」，封「verify 绿→commit 之间改码」的残余窗口。
//         口径：干净树 = ''（porcelain 空，不再问 diff）；脏树 = 16 位 hex；git 不可用 / 非 git 根 =
//         省略键（未知口径，同 headShort 降级风格，消费侧按未知处理）；存量无字段行 = 未知，不回填。
// 自守护：scripts-syntax 门守引擎自身（2026-10-09 审计 P0-1：本文件曾因
//         SyntaxError 进 CI 而全链静默）。--test-cmd 为 fixture 测试注入缝：给了它则只跑
//         [test, check-loop] 两步夹具，绿行带 testCmd:true 标记（生产凭证不与之混淆，
//         且 fixture 模式不触真实 npm/dotnet）。fail-fast：任一门红立即 exit 1。
// 编排（2026-10-16 并行化）：guardian 门（scripts-syntax）串行先跑、未过即止；其余门进工作池并发
//         （--jobs N / --serial，缺省 clamp(2..4, floor(cpus/4))），各自缓冲输出、完成即整块回放。
//         任一门红 → 停排新门 + taskkill /T 树杀在跑门（fail-fast 语义与「未执行门」清单口径保留）。
//         实测（12 逻辑核，15 门时）：串行 ~300s → 并发墙钟 ~120s（j3 膝点；见 run() 内档位注释）。
//         门数沿革：2026-10-09 九门 → 2026-10-14 18 门（G5 安全段 +2、依赖审计分两面）→
//         2026-10-16 15 门（依赖漏洞审计三门退役，理由见 GATES 内安全段注释）→
//         2026-10-22 16 门（引擎地图漂移门挂入第 6 位，改进 3）。
//         2026-10-24 19 门（复核 P1：工作流索引/指标自洽两门 + 台账指针存在性门）。
//         2026-10-25 20 门（优化1：本地门禁挂载自检 WARN 档挂入引擎段第 4 位——core.hooksPath 不随
//         clone 传播的静默失效面从「靠人记得跑 check-local-gates」升格为每次关单自动对质）。
//         2026-11-11 增 4 门至 20（审计 P2「--no-verify 远端兜底缺口」：.agents/hooks 代码四门接入
//         product cohort，本地增量档单边化 CI——执法点 = --mid/--full）。
//         2026-11-14 21 门（R3-8 供应链：sbom-license 安全段 +1——SBOM/许可证策略零网络门）。
//         2026-11-14 22 门（R3-8 沙箱：devcontainer 安全段 +1——开发容器声明零网络门）。
//         2026-11-24 product-gates（基础表通用化收尾）：六道母项目产品门（backend-build / backend-test /
//         frontend-lint / frontend-unit-test / frontend-build / code-notify-guard）与 RUN_E2E 条件门
//         frontend-e2e 移出基础表——技术栈产品门改由项目 .agents/config/product-gates[.<名称>].json 配置，
//         门表三层来源 = 基础门 + 项目产品门（配置）+ 栈自动门；dotnet profile 随附中性默认配置（全带 when 守卫）。
// 用法：flow-kit run verify.mjs [--full | --scope | --face <面> | --product | --mid] [--list] [--jobs N | --serial] [--help]
//   **档位口径（命令侧单源，2026-11-08 补记）**：--scope = diff 面增量档（判据同缺省档，单源
//     verify-scope.mjs）；--full = 显式全量；--scope 与 --full 互斥。命令侧档位口径以此头注为准。
//   **--scope 环境态 loud-skip（2026-11-17 行为评测②）**：无 origin 远端（或取不到 origin/main
//     merge-base）、仓库尚无任何提交时，增量基线不可得 → 输出原因与降级建议后 exit 0（不判红、不落账）；
//     有 origin 的既有路径（含 diff 面为空的 fail-loud exit 2）零变化。
//   --product = 业务面分档（cohort product + security），不落 all-gates 凭证。
//   --mid = CI 中档（PR→develop / develop 直推）：业务面同 --product，但 backend-test 仅跑单元测试
//       （--unit-only，不碰集成测试库）；不落 all-gates 凭证。三档口径见 §6.5（本地轻 / PR 中 / main 重）。
//   **产品门单边化 CI（2026-11-08 档 1 减重；2026-11-11 增代码四门）**：缺省档与 --scope / --face 增量档
//     不再执行产品 cohort 5 门（backend-build / backend-test / frontend-lint / frontend-unit-test /
//     frontend-build）＋代码四门（code-architecture / code-audit-fields / code-delete-guard /
//     code-notify-guard，审计 P2「--no-verify 远端兜底缺口」接入）——执法点单边移交
//     CI（--full / --mid / --product 三档与 azure-pipelines 一字不变）；secrets-scan、sbom-license、
//     引擎段与 wiki-consistency 照跑。门表三层来源 = 基础门 + 项目产品门（.agents/config/product-gates*
//     .json 配置，2026-11-24 起，「恒 22」叙事退役）+ 栈自动门；增量档裁剪在执行期与 --list --scope /
//     --face 干跑可见（跳过说明行）。
//   --face <面> = 显式面覆盖（合法值 = project-faces 派生的面标签 backend|frontend|tests|data + docs，
//     逗号多值）：不做工作区
//     脏路径自动面检测，直接按给定面裁门；与 --full 互斥（亦拒 --scope / 分档 / 夹具旗标）；跳过 24h 兜底
//     （显式面 = 操作者已判读）；绿行记 entry.face，face 绿行因 loud-skip ledger-invariant 不作增量锚。
//       flow-kit run verify.mjs --stub-gate <cmd>   （仅 CHECK_LOOP_ROOT 夹具；走生产尾段，不打 testCmd）
//   **默认档 = diff 面增量**（verify-scope-default 2026-10-22）：不带参数即按变更面裁门；`--full` 显式全量。
//     兜底：最近 24h 无全量绿行（或 diff 面解析失败）→ 自动退回全量并打印 ⏭️ 兜底行，不静默降档。
//     基线候选 = 本地台账 ∪ 仓库凭证（workflow/verify-evidence.md，verify-evidence-fallback 2026-10-22）：
//     新 worktree 无本地绿行时不再必然重付全量税；候选须为 HEAD 祖先，否则回落 origin/main。
//   **门禁健康（gate-health 2026-10-22）**：成本预算 advisory（.agents/config/gate-budgets.json，
//     超限只告警不阻断，点名「下一批须退役一门」）+ 失败归因（env/flaky/real，failure-attribution.mjs，
//     只标注不改裁决）——把「体感重」变成可对质数字，假红不再训练人绕过门禁。
//     （flaky 隔离重跑已退役 2026-11-08 减重档 3-U1：近 30 天零触发；flaky 一律人工立项处置。）
//   **分层跑（2026-10-23，P0-1 改口径）**：engine-code 触面 → 引擎套件全量；业务/文档面 →
//     `npm test -- --fast`（跳过最慢 9 套件，不再整门跳过）。全量 / --engine / CI / 零裁剪仍全量。
//     绿行 `fastTests` 标记可审计。
//   --list：按执行序打印门 id 后退出（含项目产品门；when 未满足的门不进清单，stderr 打 SKIP 行），不执行；
//     裸 --list 不参与裁剪（门表 = 基础门 + 项目产品门 + 栈自动门），配 --scope / --face 干跑展示增量档
//     裁剪结果（跳过说明行走 stderr，stdout 保持纯 id 可管道）。
//   --jobs / --serial：并发档位与串行回退（见上「编排」）。
// 沿革：verify-evidence（凭证落账）；2026-10-09 统一质量检查门禁 d009965（九门）；
//       guardian-selfcheck（修 :31 缺 =、GATES 加 scripts-syntax/engine-tests、
//       恢复 --test-cmd 夹具缝供 verify.test.mjs 断言）；
//       verify-parallel（串行编排 = 各门之和，本机 318s → 并发墙钟 ~130s；绿行加 wallMs）。
//       verify-diet（2026-10-21）：③backend-test --no-build 消双构建；①失败门输出留痕 tmp/ 并回显尾部；
//       ④前端关单门 vue-tsc 分离（TF_BUILD 下仍全量 build）；②--scope diff 面增量关单（口径单源 verify-scope.mjs）。
//       verify-diet 二批（2026-10-21 P0，owner 拍板）：⑤--scope 引擎自检面——engine-tests 引擎面触 = 全量、
//       业务面 = --fast（2026-10-23 改口径，不再整门跳过）；⑥ledger-invariant
//       全史扫描默认 CI-only（diff 面触及台账时本地回列；门表/--list 恒 22，绿行 envSkips 记录跳过事实）。
//       引擎减重档 1-B（2026-11-08）：增量档（缺省/--scope/--face）产品 5 门单边化 CI + --face 显式面覆盖。
//       引擎减重档 2-E（2026-11-08）：engine-artifacts 门「漂移即红」改「自动重生成后通过」——生成物是
//       磁盘态的确定函数，漂移原地重生成自愈（复检确认），失败才红；并行会话在途立档不再误伤关单 verify。

import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDiffScope, parseEvidenceGreens, EVIDENCE_REL, loadProductFaces, ciUnilateralGateIds } from './verify-scope.mjs';
import { loadFaces, isProductPath } from './faces.mjs';
import { classifyFailure } from './failure-attribution.mjs';
import { dirtyTreeDigest } from './git-tree-digest.mjs';
import { t } from './lang.mjs';
import { isCi } from './ci-provider.mjs';
let findProjectRulesFile = () => null;
let loadProjectRules = () => null;
let extractVerifyCommandGates = () => [];
let detectStackFromRules = () => [];
let stripJsonc = (text) => text;
try {
  const mod = await import('./rules-loader.mjs');
  if (typeof mod?.findProjectRulesFile === 'function') findProjectRulesFile = mod.findProjectRulesFile;
  if (typeof mod?.loadProjectRules === 'function') loadProjectRules = mod.loadProjectRules;
  if (typeof mod?.extractVerifyCommandGates === 'function') extractVerifyCommandGates = mod.extractVerifyCommandGates;
  if (typeof mod?.detectStackFromRules === 'function') detectStackFromRules = mod.detectStackFromRules;
  if (typeof mod?.stripJsonc === 'function') stripJsonc = mod.stripJsonc;
} catch {
  // 当脚本在最小隔离测试夹具中独立运行且未复制 rules-loader.mjs 时平滑降级
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOW_KIT_PROJECT_ROOT || process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const AGENTS_RUNTIME = path.resolve(SCRIPT_DIR, '..');
// 产品面单源（2026-11-24 faces 收尾）：faces 配置在门表装配前加载一次，供脏路径过滤与面裁门共用。
// 配置错误 fail-closed exit 2（不能静默当「未配置」全触发——漏跑该红的门比不跑更危险）。
const FACES_REL = '.agents/config/project-faces.json';
const PROJECT_FACES = (() => {
  try { return loadFaces(ROOT); } catch (e) {
    console.error(t(`[verify] 配置错误：${FACES_REL}——${e.message}（fail-closed，拒绝运行）`, `[verify] config error: ${FACES_REL} — ${e.message} (fail-closed, refusing to run)`, ROOT));
    process.exit(2);
  }
})();
// 面 → 门映射派生自 project-faces + product-gates；product-gates 解析失败同 fail-closed。
const PRODUCT_FACES = (() => {
  try { return loadProductFaces(ROOT, PROJECT_FACES); } catch (e) {
    console.error(t(`[verify] ${e.message}（fail-closed，拒绝运行）`, `[verify] ${e.message} (fail-closed, refusing to run)`, ROOT));
    process.exit(2);
  }
})();
const CI_UNILATERAL_GATE_IDS = ciUnilateralGateIds(PRODUCT_FACES);

// 门禁配置汇总（2026-11-24 门禁配置可见性）：「哪些项目侧门配置在场 / 缺席」一行说清——未配置 =
// 对应门 SKIP，不必翻四份文件才知道门为什么没跑。product-gates 以通配族计一项；notify-guard 无
// 配置文件（SKIP 判据在门本体）。任一份 JSON 解析失败 → 显式报「配置错误：<文件>」并 exit 2
// （fail-closed：坏配置不能当没配置放过）。--list 走 stderr（stdout 保持纯 id），运行结束走 stdout。
const GATE_CONFIG_ITEMS = [
  ['product-gates', null],
  ['architecture-redlines.json', '.agents/hooks/architecture-redlines.json'],
  ['delete-guard.json', '.agents/hooks/delete-guard.json'],
  ['audit-fields.json', '.agents/hooks/audit-fields.json'],
  ['commit-check.config.json', '.agents/hooks/commit-check.config.json'],
  ['local-gates.json', '.agents/config/local-gates.json'],
  ['project-faces.json', '.agents/config/project-faces.json'],
];
const GATE_CONFIG_SUMMARY = (() => {
  const projectRulesRel = findProjectRulesFile(ROOT);
  if (projectRulesRel) {
    let pr;
    try {
      pr = loadProjectRules(ROOT);
    } catch (e) {
      console.error(t(`[verify] 配置错误：${projectRulesRel}——规则中心配置失守（${e.message}）——拒绝运行`, `[verify] config error: ${projectRulesRel} — rules config is broken (${e.message}) — refusing to run`, ROOT));
      process.exit(2);
    }
    const ruleCount = (pr && Array.isArray(pr.rules)) ? pr.rules.length : 0;
    return t(`门禁配置：已加载 ${projectRulesRel}（声明式规则中心：${ruleCount} 条规则）`, `Gate config: loaded ${projectRulesRel} (declarative rules center: ${ruleCount} rules)`, ROOT);
  }
  const configured = [];
  const missing = [];
  for (const [name, rel] of GATE_CONFIG_ITEMS) {
    const files = rel ? [rel] : (() => {
      try {
        return fs.readdirSync(path.join(ROOT, '.agents', 'config'))
          .filter((f) => f === 'product-gates.json' || /^product-gates\..+\.json$/.test(f))
          .map((f) => path.posix.join('.agents', 'config', f));
      } catch { return []; }
    })();
    const present = files.filter((f) => fs.existsSync(path.join(ROOT, f)));
    for (const f of present) {
      try { JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) {
        console.error(t(`[verify] 配置错误：${f}——门禁配置失守（JSON 解析失败：${e.message}）——拒绝运行`, `[verify] config error: ${f} — gate config is broken (JSON parse failed: ${e.message}) — refusing to run`, ROOT));
        process.exit(2);
      }
    }
    (present.length ? configured : missing).push(name);
  }
  return t(`门禁配置：已配置 ${configured.length} / 未配置 ${missing.length}（未配置=SKIP：${missing.length ? missing.join('、') : '无'}）`, `Gate config: configured ${configured.length} / missing ${missing.length} (missing=SKIP: ${missing.length ? missing.join(', ') : 'none'})`, ROOT);
})();
// 引擎资产安装判定（issue #73，2026-11-22）：外部编排宿主（自有交付状态机，仅脚本方式消费引擎）无
// .agents/config/engine.json——硬依赖安装资产的门与 kit 自有凭证落盘对宿主不适用，loud-skip。
// kit 自装项目恒有 engine.json（install 落盘的清单），判据与门禁面零变化。夹具模式（--test-cmd /
// --stub-gate）不参与：夹具根走测试缝，凭证落账是既有断言面。testCmd/stubCmd 是 run() 内参数解析
// 产物（声明位置靠后），故此处仅声明缺省、赋值单点在 run() 夹具旗标校验之后。
let engineAssetsAbsent = false;
// 两门 id 单源 GATES 主表（生成物漂移单门 + 密钥扫描门——后者挂载脚本 check-secrets.mjs，issue 口径以脚本名称之）。
const ASSET_GATE_IDS = new Set(['engine-artifacts', 'secrets-scan']);
// issue #73 凭证跳过注记一轮一次：失败行 / 全绿落账 / 摘要生成三处跳过点共享，最早到达者打、其余静默。
let engineAssetSkipNoted = false;
const noteEngineAssetSkip = () => {
  if (engineAssetSkipNoted) return;
  engineAssetSkipNoted = true;
  console.error(t('[verify] ⏭️ 未安装引擎资产——凭证落账/摘要生成跳过（外部编排消费方自管交付状态；issue #73）', '[verify] ⏭️ engine assets not installed — skipping credential ledger / summary generation (external orchestration consumers manage their own delivery state; issue #73)', ROOT));
};
// verify 从包内运行时执行时，门命令里的 flow-kit run|hook|rules check 改为包内绝对路径：
// 不依赖 flow-kit 是否在当前进程 PATH（本地 node bin/flow-kit.mjs、直接 node 执行均可用）。
// rules check（D15）：<kit> 由 SCRIPT_DIR 上溯四级（scripts→.agents→engine→templates→<kit>）；
// 仅当包内存在 bin/flow-kit.mjs 时改写，装到目标项目 .agents/scripts 的形态原样保留。
const KIT_BIN = path.resolve(SCRIPT_DIR, '..', '..', '..', '..', 'bin', 'flow-kit.mjs');
const localizeRuntimeCmd = (cmd) => String(cmd)
  .replace(/flow-kit\s+rules\s+check\b/g, () => (fs.existsSync(KIT_BIN) ? `node "${KIT_BIN}" rules check` : 'flow-kit rules check'))
  .replace(/flow-kit\s+run\s+([A-Za-z0-9][A-Za-z0-9._-]*)/g, (m, name) => {
    const file = name.endsWith('.mjs') ? name : `${name}.mjs`;
    return `node "${path.join(AGENTS_RUNTIME, 'scripts', file)}"`;
  })
  .replace(/flow-kit\s+hook\s+([A-Za-z0-9][A-Za-z0-9._-]*)/g, (m, name) => {
    const file = name.endsWith('.cjs') || name.endsWith('.mjs') ? name : `${name}.cjs`;
    return `node "${path.join(AGENTS_RUNTIME, 'hooks', file)}"`;
  });

// --- 门禁定义 ---
// 引擎段在前（2026-10-10）：语法与引擎测试仍最先；编排/预算/生效规则/闭环硬门/泳道接在其后。
// 产品段维持原相对顺序。遇红即停，但产品面的红不再挡在引擎段前面。
// --list 只打印 id 后退出，不执行。
const GATES = [
  // guardian（2026-10-16 并行编排）：本门未过则后序门一并不启动——引擎脚本不可解析时其余门无意义，
  // 且夹具根（CHECK_LOOP_ROOT 指向无脚本目录）下若并行铺开，16 门会在假根里乱跑（原 verify.test 场景 7 口径）。
  { id: 'scripts-syntax', cohort: 'engine', guardian: true, name: t('引擎脚本语法自检', 'Engine script syntax self-check', ROOT), cmd: 'flow-kit run check-scripts-syntax.mjs', folder: '.', type: 'shell' },
  { id: 'workflows-check', cohort: 'engine', name: t('编排脚本检查', 'Orchestration script check', ROOT), cmd: 'flow-kit run workflows-check.mjs', folder: '.', type: 'shell' },
  { id: 'rule-budget', cohort: 'engine', name: t('常驻面预算检查', 'Always-on surface budget check', ROOT), cmd: 'flow-kit run rule-budget.mjs --all', folder: '.', type: 'shell' },
  // 本地门禁挂载自检（2026-10-25 优化1，WARN 档）：判据与 check-local-gates.mjs ①-④ 对齐（单源，一边改
  // 另一边须跟）。默认 WARN 缺配只告警；CI（TF_BUILD）/非 git 根 loud-skip；升格 = cmd 加 --strict（owner 拍板）。
  { id: 'local-gate-config', cohort: 'engine', name: t('本地门禁挂载自检（WARN 档）', 'Local gate wiring self-check (WARN tier)', ROOT), cmd: 'flow-kit run check-local-gate-config.mjs', folder: '.', type: 'shell' },
  // 生成物漂移单门（2026-10-28 引擎减重第三刀；2026-11-08 档 2-E 改自愈）：effective-policy / engine-map /
  // workflow-index 三门机制相同（跑生成器 --check 比对磁盘），合并为一次调用；漂移 → 原地重生成自愈后按
  // 通过计，重生成/复检失败才红（判据与自愈单源在 check-engine-artifacts.mjs，各档含 --full 同语义）。
  // 例外：整文件生成的产物含未提交的非生成内容时不重生成（覆盖后找不回），点名判红。
  { id: 'engine-artifacts', cohort: 'engine', name: t('生成物漂移检查（3 份）', 'Generated artifact drift check (3 files)', ROOT), cmd: 'flow-kit run check-engine-artifacts.mjs', folder: '.', type: 'shell' },
  // 默认硬门。hygiene 段已于 2026-10-28 全部退役（只跑 hard 5 段）。
  { id: 'check-loop', cohort: 'engine', name: t('闭环门禁校验', 'Closed-loop gate check', ROOT), cmd: 'flow-kit run check-loop.mjs', folder: '.', type: 'shell' },
  { id: 'ledger-doc-presence', cohort: 'engine', name: t('台账指针存在性', 'Ledger pointer presence', ROOT), cmd: 'flow-kit run check-ledger-doc-presence.mjs', folder: '.', type: 'shell' },
  // 确认台账不变量（ledger-invariant-ci）：历史全扫挂进引擎段——此前该门自称 CI 机器门
  // 却从未进任何门表，71 处存量断档积累数月无人见（当日 DAG 感知重写 + HISTORY_BASELINE 声明后
  // 首次全绿，方具挂门条件）。pre-commit 仅 --staged 前缀面，全史审计由此门独担。
  // verify-diet 二批（2026-10-21 P0-2，owner 拍板）：本地关单不再重复付全史扫描（~37s）——TF_BUILD 外
  // 执行期 loud-skip（diff 面触台账即回列；门表/--list 恒 22，同 lane-surface-ci「本地跳过」先例）；全史审计由 CI 独担
  // （main 全量 verify 含本门；develop 最小 CI 面 secrets+check-loop 不含本门——2026-10-25 起），新违规仍被提交时刻 --staged 增量门当场拦。
  { id: 'ledger-invariant', cohort: 'engine', name: t('确认台账不变量（历史全扫）', 'Confirmation ledger invariant (full history scan)', ROOT), cmd: 'flow-kit run check-ledger-invariant.mjs', folder: '.', type: 'shell' },
  // 泳道 diff 面（ai-native-review-p1）：CI（TF_BUILD/合并提交检出）按基准执法——产品契约面
  // 改动须 diff 内协伴 L2+ 入口；本地手跑无基准事实 → 脚本内 advisory 跳过（显式 --base origin/main 可预检）。
  { id: 'lane-surface-ci', cohort: 'engine', name: t('泳道完整性（CI diff 面；本地无基准则跳过）', 'Lane integrity (CI diff surface; skipped locally without baseline)', ROOT), cmd: 'flow-kit run check-lane-surface.mjs --ci', folder: '.', type: 'shell' },
  // 安全段（2026-10-14 决定 4 / G5 插队）：密钥扫描。
  // secrets-scan：gitleaks detect + 基线（.gitleaks-baseline.json，存量豁免清单，用户拍板——
  //   2026-10-15 扩 6 处权限Key 标识符，见 check-secrets.mjs 头注）；
  //   **2026-10-29 起恒执法**：gitleaks 三处解析皆缺（典型 = CI agent 装不上）→ 自动降级为纯 Node
  //   兜底扫描 check-secrets-lite.mjs（同一基线做文件级豁免），不再 loud-skip；输出首行标明执法者。
  //   需要缺二进制即红：SECRETS_SCAN_REQUIRE_GITLEAKS=1（check-secrets exit 2）。
  { id: 'secrets-scan', cohort: 'security', name: t('密钥扫描（gitleaks 优先 / lite 兜底，+基线）', 'Secret scan (gitleaks preferred / lite fallback, +baseline)', ROOT), cmd: 'flow-kit run check-secrets.mjs', folder: '.', type: 'shell' },
  // 供应链门（R3-8）：SBOM 生成 + 许可证策略检查（零依赖零网络，判据 = .agents/config/license-policy.json）。
  // 声明了依赖但 lockfile 缺失 = fail-closed exit 2；零依赖（未声明依赖，静态判定）= pass-with-note skipped:'zero-dep'；
  // --check 只读比对 SBOM 漂移。与 secrets-scan 同属安全段。
  { id: 'sbom-license', cohort: 'security', name: t('SBOM 与许可证策略（SPDX 2.3，零网络）', 'SBOM and license policy (SPDX 2.3, offline)', ROOT), cmd: 'flow-kit run sbom-license.mjs --check', folder: '.', type: 'shell' },
  // 沙箱门（R3-8）：开发容器声明校验——镜像来源白名单 + 版本钉死 + 声明结构。
  // 判据 = .agents/config/devcontainer-policy.json；项目没有 .devcontainer/（未启用容器）→ 大声跳过不判红。
  { id: 'devcontainer', cohort: 'security', name: t('开发容器声明（镜像白名单 + 版本钉死）', 'Dev container declaration (image allowlist + pinned versions)', ROOT), cmd: 'flow-kit run check-devcontainer.mjs', folder: '.', type: 'shell' },
  // 依赖漏洞审计三门（nuget-audit / frontend-audit-prod / frontend-audit-devtool）2026-10-16 退役
  //   （owner 指令）：三者皆依赖公网漏洞服务（npm `/-/npm/v1/security/*`、NuGet 源索引的
  //   `VulnerabilityInfo`），内网镜像均不代理该面（实测见 runtime-env §6.4「漏洞数据源实测」），
  //   冷缓存/网络抖动即假红、换内网源即假绿——判据不可靠，故整族退出关单门表。
  //   退役留档：机制台账两行（NuGet 漏洞门 / 前端依赖审计）+ papercuts 2026-10-16 行。
  // —— 代码三门（2026-11-11 owner 拍板接入 product cohort；2026-11-10 审计 P2「--no-verify 远端兜底缺口」
  //    修复）：原 .agents/hooks pre-commit 专用门（local-pre-commit.mjs 同批脚本，判据单源不变），
  //    随本表进 CI --mid/--full 执法；本地 pre-commit 保留为最早拦截点（.githooks/pre-commit 口径已同步）。
  //    id 已入 verify-scope 的 CI_UNILATERAL_GATE_IDS——本地增量档单边化 CI。
  //    （同族 code-notify-guard 已随 2026-11-24 product-gates 移出基础表，改项目配置。）
  { id: 'code-architecture', cohort: 'product', name: t('架构红线（.agents/hooks/architecture-redlines.json，未配置跳过）', 'Architecture redlines (.agents/hooks/architecture-redlines.json, skipped when unconfigured)', ROOT), cmd: 'flow-kit rules check --full --prefix arch.', folder: '.', type: 'shell' },
  // CI_PUSH_BEFORE 在场（azure-pipelines ci-push-before 步注入的 pipeline 变量）扫该区间新增行；
  // 缺省扫暂存区新增行——存量不拦（渐进收口语义与 pre-commit 一字不变）。
  { id: 'code-audit-fields', cohort: 'product',
    name: t('审计字段守卫（.agents/hooks/audit-fields.json，未配置跳过）', 'Audit field guard (.agents/hooks/audit-fields.json, skipped when unconfigured)', ROOT),
    cmd: process.env.CI_PUSH_BEFORE ? `flow-kit rules check --range ${process.env.CI_PUSH_BEFORE}..HEAD --prefix audit.` : 'flow-kit rules check --staged --prefix audit.',
    folder: '.', type: 'shell' },
  // 删除守卫默认即全仓面（Application/API 全目录计数比对 allowlist，非暂存面）——静态 cmd 零改接入。
  { id: 'code-delete-guard', cohort: 'product', name: t('删除守卫（删除调用点须登记 allowlist，未配置跳过）', 'Delete guard (delete call sites must be registered in the allowlist; skipped when unconfigured)', ROOT), cmd: 'flow-kit rules check --full --prefix delete.', folder: '.', type: 'shell' },
  // 母项目产品门（backend-build / backend-test / frontend-lint / frontend-unit-test / frontend-build /
  // code-notify-guard）与 RUN_E2E 条件门 frontend-e2e 已移出基础表（2026-11-24 product-gates）：
  // 技术栈产品门改由项目 .agents/config/product-gates[.<名称>].json 配置（下方加载段），dotnet profile
  // 随附中性默认配置。留表的是不依赖具体技术栈的通用机制门：
  { id: 'wiki-consistency', cohort: 'product', name: t('wiki 三方一致性', 'Wiki three-way consistency', ROOT), cmd: 'flow-kit run verify-wiki-consistency.mjs', folder: '.', type: 'shell' },
];

// diff 面 lint 降范围（2026-11-05，--scope 档只 lint 变更面文件）随 2026-11-08 档 1-B 单边化退役：
// frontend-lint 已整体移 CI，本地增量档不再出现该门（scopedLintCmd 与阈值常量一并移除）。

// 产品门单边化 CI 跳过说明（档 1-B）：增量档门清单上方恒打印一行（--list 走 stderr，保持 stdout 纯 id）。
const UNILATERAL_NOTE = t(`产品门单边化 CI（2026-11-08 档 1 减重；2026-11-11 增代码四门）：${[...CI_UNILATERAL_GATE_IDS].join('、')} 共 ${CI_UNILATERAL_GATE_IDS.size} 门本地增量档（缺省/--scope/--face）不执行——执法点移交 CI（--full/--mid/--product 档不变）`, `Product gates unilateral CI (2026-11-08 tier 1 diet; 2026-11-11 four code gates added): ${[...CI_UNILATERAL_GATE_IDS].join(', ')} — ${CI_UNILATERAL_GATE_IDS.size} gates not run in local incremental tiers (default / --scope / --face); enforcement moved to CI (--full / --mid / --product unchanged)`, ROOT);

// fixture 夹具门（--test-cmd 注入时替换全部生产门——原 verify.test.mjs 1/2、2/2 断言依赖此口径，测试面已退役 2026-10-28）
// check-loop 用绝对路径直调真实脚本——夹具根里没有脚本本体，root 归属仍由 CHECK_LOOP_ROOT 裁决。
const fixtureGates = (cmd) => [
  { id: 'test', name: t('测试步（注入）', 'Test step (injected)', ROOT), cmd, folder: '.', type: 'shell' },
  { id: 'check-loop', name: t('闭环门禁校验', 'Closed-loop gate check', ROOT), cmd: `node "${path.join(SCRIPT_DIR, 'check-loop.mjs')}"`, folder: '.', type: 'shell' },
];

// Stack profile（agentic-flow-kit 通用化）：基础门表里的 product 门是 dotnet/Vue 专用。
// 其余栈只保留 engine + security + wiki 门，再按栈追加一条产品测试门。
// 多栈（options.stacks）按并集执法：任一栈命中即保留/追加；旧安装无 stacks 字段走单栈回退。
const STACKS = (() => {
  try {
    const options = JSON.parse(fs.readFileSync('.agents/config/engine.json', 'utf8')).options || {};
    if (options.stacks?.length) return options.stacks;
    if (options.stack) return [options.stack];
  } catch {}
  try {
    const fromRules = detectStackFromRules(ROOT);
    if (fromRules.length) return fromRules;
  } catch {}
  const detected = [];
  if (fs.existsSync('package.json')) detected.push('node');
  if (fs.existsSync('Cargo.toml')) detected.push('rust');
  if (fs.existsSync('go.mod')) detected.push('go');
  if (fs.existsSync('pom.xml') || fs.existsSync('build.gradle')) detected.push('java');
  if (fs.existsSync('requirements.txt') || fs.existsSync('pyproject.toml')) detected.push('python');
  if (fs.existsSync('CMakeLists.txt')) detected.push('cpp');
  try {
    const files = fs.readdirSync(ROOT);
    if (files.some((f) => f.endsWith('.sln') || f.endsWith('.csproj'))) detected.push('dotnet');
  } catch {}
  return detected.length ? detected : ['dotnet'];
})();
if (!STACKS.includes('dotnet')) {
  // backend-/frontend- 是 dotnet+Vue 两段式布局的专用产品门；code- 四门是配置驱动的通用门
  // （未配置即 SKIP），所有技术栈都保留在门表里。
  for (let i = GATES.length - 1; i >= 0; i -= 1) {
    if (/^(backend-|frontend-)/.test(GATES[i].id)) GATES.splice(i, 1);
  }
}

// 项目产品门（product-gates 2026-11-24）：技术栈产品门出代码、进项目配置——.agents/config/ 下
// product-gates.json / product-gates.<名称>.json（按文件名排序，门序 = 文件名序 × 数组序），插在
// wiki-consistency 之后、各栈自动探测门之前。字段：id/name/cmd 必填，folder 默认 '.'，deps/when/env
// 可选，type 默认 'shell'。配置失守（JSON 坏 / 缺必填字段 / id 与内置门或他门重复 / deps 指向不存在
// 的门）= stderr 报错 exit 2——不能当没配置放过（漏跑该红的门比不跑更危险）。文件不存在 = 无项目
// 产品门，不报错不打印。when 语义与 hooks/commit-check.cjs 头注一致：路径存在 / 尾部 * 一层通配 /
// pkg:<点分路径>（读该门 folder 下的 package.json），或对象 { exists } / { file } / { pkg }，任一满足才启用；不满足的门不进执行清单，在门
// 清单处打 SKIP 行（--list 走 stderr 保 stdout 纯 id），不计失败、不落凭证。deps 合法域 = 基础表 ∪
// 全部配置门（栈自动门是探测产物、非稳定 id，不在域内）。
const whenItem = (w, folder) => {
  if (w && typeof w === 'object') {
    if (w.exists) return whenItem(w.exists, folder);
    if (w.file) return whenItem(w.file, folder);
    if (w.pkg) return whenItem(`pkg:${w.pkg}`, folder);
    return false;
  }
  if (typeof w === 'string' && w.startsWith('pkg:')) {
    const keys = w.slice(4).split('.').filter(Boolean);
    if (!keys.length) return false;
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(ROOT, folder, 'package.json'), 'utf8')); } catch { return false; }
    let cur = pkg;
    for (const k of keys) {
      if (cur == null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) return false;
      cur = cur[k];
    }
    return typeof cur === 'string' && cur.trim() !== '';
  }
  const s = String(w);
  const star = s.indexOf('*');
  if (star < 0) return fs.existsSync(path.join(ROOT, s));
  const dir = path.join(ROOT, path.dirname(s.slice(0, star)) || '.');
  try { return fs.readdirSync(dir).some((f) => f.endsWith(s.slice(star + 1))); } catch { return false; }
};
const whenSatisfied = (when, folder) => !when
  || (Array.isArray(when) ? when : [when]).some((w) => whenItem(w, folder));
const showWhen = (when) => {
  if (Array.isArray(when)) return when.map(showWhen).join(' / ');
  if (when && typeof when === 'object') {
    if (when.exists) return when.exists;
    if (when.file) return when.file;
    if (when.pkg) return `pkg:${when.pkg}`;
    return JSON.stringify(when);
  }
  return String(when || '');
};
const whenSkippedGates = [];
let totalConfiguredProductGates = 0;
{
  const cfgDir = path.join(ROOT, '.agents', 'config');
  const files = fs.existsSync(cfgDir)
    ? fs.readdirSync(cfgDir).filter((f) => f === 'product-gates.json' || /^product-gates\..+\.json$/.test(f)).sort()
    : [];
  const knownIds = new Set(GATES.map((g) => g.id));
  const configured = [];
  // 执行路径单源（rules v1）：产品门委托 rules 引擎执行；规则 id = product.<slug(gate.id)>
  // （与 src/rules/adapters.mjs 同口径）。env/deps/when 仍由 verify 侧元数据承载（SKIP 行、依赖排序与 --list）；folder 只在装载期参与 when 求值，不再作运行时 cwd——命令统一从仓库根解析。
  const ruleSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  const die = (file, why) => {
    console.error(t(`[verify] 配置错误：.agents/config/${file}——项目产品门配置失守：${why}（配置非法不能当没配置放过）`, `[verify] config error: .agents/config/${file} — product gate config is broken: ${why} (invalid config must not be treated as absent)`, ROOT));
    process.exit(2);
  };
  for (const file of files) {
    let raw;
    try { raw = JSON.parse(stripJsonc(fs.readFileSync(path.join(cfgDir, file), 'utf8'))); } catch (e) { die(file, t(`JSON 解析失败（${e.message}）`, `JSON parse failed (${e.message})`, ROOT)); }
    const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray(raw.gates) ? raw.gates : null);
    if (!list) die(file, t('顶层须为数组或 { "gates": [...] }', 'top level must be an array or { "gates": [...] }', ROOT));
    for (const g of list) {
      if (!g || typeof g !== 'object' || Array.isArray(g)) die(file, t('门元素须为对象', 'each gate entry must be an object', ROOT));
      for (const key of ['id', 'name', 'cmd']) {
        if (typeof g[key] !== 'string' || !g[key].trim()) die(file, t(`门缺必填字段 ${key}`, `gate is missing required field ${key}`, ROOT));
      }
      if (knownIds.has(g.id)) die(file, t(`门 id ${g.id} 与既有门重复`, `gate id ${g.id} duplicates an existing gate`, ROOT));
      // when 空串 / 空数组 = 这道门永远不进清单（静默失效）：按配置失守处理，与规则引擎 schema（when 必须是非空字符串数组）同口径。
      const whenList = g.when === undefined ? null : (Array.isArray(g.when) ? g.when : [g.when]);
      if (whenList && (!whenList.length || whenList.some((w) => typeof w !== 'string' || !w.trim()))) {
        die(file, t(`门 ${g.id} 的 when 须为非空字符串或非空字符串数组`, `gate ${g.id}: when must be a non-empty string or a non-empty array of strings`, ROOT));
      }
      if (g.deps !== undefined && (!Array.isArray(g.deps) || g.deps.some((d) => typeof d !== 'string'))) die(file, t(`门 ${g.id} 的 deps 须为 id 数组`, `gate ${g.id}: deps must be an array of ids`, ROOT));
      knownIds.add(g.id);
      const folder = typeof g.folder === 'string' && g.folder.trim() ? g.folder : '.';
      configured.push({ file, gate: {
        id: g.id, cohort: 'product', name: g.name,
        cmd: `flow-kit rules check --with-commands --prefix product.${ruleSlug(g.id)}`,
        folder: '.',
        type: typeof g.type === 'string' && g.type.trim() ? g.type : 'shell',
        ...(Array.isArray(g.deps) && g.deps.length ? { deps: [...g.deps] } : {}),
        ...(g.env && typeof g.env === 'object' && !Array.isArray(g.env) ? { env: { ...g.env } } : {}),
      }, when: g.when, whenFolder: folder });
    }
  }
  // 规则驱动：从 flow-rules.yml 或项目规则文件装配 phase: verify 的命令门
  const projectRules = loadProjectRules(ROOT);
  if (projectRules) {
    const ruleGates = extractVerifyCommandGates(projectRules, ROOT);
    for (const rg of ruleGates) {
      if (knownIds.has(rg.id)) continue;
      knownIds.add(rg.id);
      configured.push({
        file: projectRules._file || 'flow-rules.yml',
        gate: {
          id: rg.id,
          cohort: 'product',
          name: rg.name,
          cmd: rg.cmd,
          folder: rg.folder,
          type: rg.type,
          ...(Array.isArray(rg.deps) && rg.deps.length ? { deps: [...rg.deps] } : {}),
          ...(rg.env ? { env: { ...rg.env } } : {}),
        },
        when: rg.when,
        whenFolder: rg.folder || '.',
      });
    }
  }
  for (const { file, gate } of configured) {
    const missing = (gate.deps || []).filter((d) => !knownIds.has(d));
    if (missing.length) die(file, t(`门 ${gate.id} 的 deps 指向不存在的门（${missing.join('、')}）`, `gate ${gate.id}: deps point to non-existent gates (${missing.join(', ')})`, ROOT));
  }
  totalConfiguredProductGates = configured.length;
  for (const { gate, when, whenFolder } of configured) {
    if (whenSatisfied(when, whenFolder)) GATES.push(gate);
    else whenSkippedGates.push({ id: gate.id, when: showWhen(when) });
  }
}
const pushProduct = (id, name, cmd) => {
  if (GATES.some((g) => g.id === id)) return;
  GATES.push({ id, cohort: 'product', name, cmd, folder: '.', type: 'shell' });
};
if (STACKS.includes('node') || STACKS.includes('typescript')) {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const hasTest = GATES.some((g) => g.id === 'node-test' || g.id === 'ts-test' || g.cmd === 'npm test');
    if (pkg.scripts && pkg.scripts.test && !hasTest) {
      pushProduct('node-test', 'Node tests', 'npm test');
    }
  } catch { /* not a node project root */ }
}
if (STACKS.includes('rust') && fs.existsSync('Cargo.toml')) {
  const hasRustTest = GATES.some((g) => g.id === 'cargo-test' || g.id === 'rust-test' || g.cmd === 'cargo test');
  if (!hasRustTest) pushProduct('cargo-test', 'Cargo tests', 'cargo test');
}
if (STACKS.includes('go') && fs.existsSync('go.mod')) {
  const hasGoTest = GATES.some((g) => g.id === 'go-test' || g.cmd === 'go test ./...');
  if (!hasGoTest) pushProduct('go-test', 'Go tests', 'go test ./...');
}
if (STACKS.includes('java')) {
  const hasJavaTest = GATES.some((g) => g.id === 'maven-test' || g.id === 'gradle-test' || g.id === 'java-test' || g.cmd.includes('mvn') || g.cmd.includes('gradle'));
  if (!hasJavaTest) {
    if (fs.existsSync('pom.xml')) pushProduct('maven-test', 'Maven tests', 'mvn -q test');
    else if (fs.existsSync('gradlew') || fs.existsSync('gradlew.bat')) {
      pushProduct('gradle-test', 'Gradle tests', process.platform === 'win32' ? 'gradlew.bat test' : './gradlew test');
    } else if (fs.existsSync('build.gradle') || fs.existsSync('build.gradle.kts')) {
      pushProduct('gradle-test', 'Gradle tests', 'gradle test');
    }
  }
}
if (STACKS.includes('python')) {
  const hasPytest = GATES.some((g) => g.id === 'pytest' || g.id === 'python-test' || g.cmd.includes('pytest'));
  if (!hasPytest && (fs.existsSync('pyproject.toml') || fs.existsSync('requirements.txt') || fs.existsSync('pytest.ini') || fs.existsSync('setup.py') || fs.existsSync('setup.cfg'))) {
    pushProduct('pytest', 'Python tests', 'python -m pytest');
  }
}
if (STACKS.includes('cpp')) {
  const hasCppTest = GATES.some((g) => g.id === 'ctest' || g.id === 'cpp-test' || g.id === 'make-test' || g.cmd.includes('ctest'));
  if (!hasCppTest) {
    if (fs.existsSync('CMakeLists.txt')) {
      pushProduct('ctest', 'CTest tests', 'ctest --output-on-failure');
    } else if (fs.existsSync('Makefile')) {
      pushProduct('make-test', 'Make test', 'make test');
    }
  }
}

// 计数捕获：优先 run-tests 的「断言合计」汇总行，退路取末条「合计: PASS x / FAIL y」
//（夹具假命令与单套件输出皆走退路；无匹配则省略计数键，exitCode 才是硬事实）。
const parseCounts = (out) => {
  const agg = /断言合计 PASS (\d+) \/ FAIL (\d+)/.exec(out || '');
  if (agg) return { passed: Number(agg[1]), failed: Number(agg[2]) };
  const all = [...(out || '').matchAll(/合计: PASS (\d+) \/ FAIL (\d+)/g)];
  if (all.length) return { passed: Number(all[all.length - 1][1]), failed: Number(all[all.length - 1][2]) };
  return null;
};

// 门禁成本预算（gate-budget 2026-10-22）：advisory——超限只告警不阻断；连续两月超限由 owner
// 裁决降档/退役一门（一进一出）。配置缺失/非法 = 不告警（fail-open，观测面不挡裁决面）。
const readGateConfig = (root) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.agents', 'config', 'gate-budgets.json'), 'utf8')); } catch { return {}; }
};
const readGateBudget = (root, key) => {
  const v = Number(readGateConfig(root)[key]);
  return Number.isFinite(v) && v > 0 ? v : null;
};

// 脏树摘要（BACKLOG 34 验证证据绑定）：单源 git-tree-digest.mjs（干净 ''/脏 16hex/非 git 根 null）。
// 头注「凭证落账」段有完整口径；失败不静默吞——降级值恒可判定。

const recordFailure = (step, exitInfo, note, attribution) => {
  // 引擎资产缺失（issue #73，2026-11-22）：失败行不落宿主仓——外部编排消费方自管交付状态，kit
  // 台账写入对宿主是文件污染。exit 码与 stderr 摘要契约不变（调用方已打），只跳落盘副作用；
  // loud 注记一轮一次（后续全绿落账点静默，同款判定见尾段落账段与摘要生成段）。
  if (engineAssetsAbsent) {
    noteEngineAssetSkip();
    return;
  }
  try {
    const entry = { ts: new Date().toISOString(), exitCode: typeof exitInfo === 'number' ? exitInfo : -1, suite: step, note };
    // 归因（gate-health 2026-10-22）：env / flaky / real——红单可读，AI 不在假红上反复重跑。
    // 存量豁免（2026-11-10）：此锚前的失败行与全部绿行（绿行无失败可归因，attribution 只标注失败，
    // 恒不落）可缺该字段——消费侧按未知处理，不回填不追溯（同 policy.mjs attributionSince 存量豁免纪律）。
    if (attribution) entry.attribution = attribution;
    // 脏树摘要（BACKLOG 34）：失败行同样钉住当时工作树，红/绿同口径可对质（'' 干净 / hex 脏 / 缺键未知）。
    const dirtyTree = dirtyTreeDigest(ROOT);
    if (dirtyTree !== null) entry.dirtyTree = dirtyTree;
    if (process.env.PIPELINE_RUN_ID) entry.runId = process.env.PIPELINE_RUN_ID;
    fs.mkdirSync(path.join(ROOT, '.agents'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, '.agents', 'verifications.jsonl'), `${JSON.stringify(entry)}\n`);
    console.log(t(`[verify] 🧾 失败行已留痕 verifications.jsonl（suite=${step}${attribution ? `，归因 ${attribution}` : ''}）`, `[verify] 🧾 failure row recorded in verifications.jsonl (suite=${step}${attribution ? `, attribution ${attribution}` : ''})`, ROOT));
  } catch (e) {
    console.error(t(`[verify] ⚠️ 失败行落账失败（${e.code || e.message}）`, `[verify] ⚠️ failed to record failure row (${e.code || e.message})`, ROOT));
  }
};

// 门输出留痕（verify-diet 2026-10-21 ①）：失败门完整 stdout/stderr 落 tmp/verify-<id>.log 并回显
// 尾部 40 行——fail-fast 红从「只知道 exit 1」变为可当场定性（papercuts 2026-10-17 拟修①；
// 先例：后端门红无法区分已知负载偶发与新回归，只能盲跑复跑）。落盘失败不改裁决（同 recordFailure 容错）。
const persistGateLog = (gate, r) => {
  // 引擎资产缺失（issue #73）：tmp/verify-*.log 留痕同样不写宿主仓——返回 null（失败 note 不附 log 路径）。
  if (engineAssetsAbsent) return null;
  try {
    const dir = path.join(ROOT, 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `verify-${gate.id}.log`);
    fs.writeFileSync(p, [
      `# gate=${gate.id} name=${gate.name}`,
      `# cmd=${gate.cmd}`,
      `# status=${r.status ?? r.error?.code} duration=${r.durMs}ms`,
      '=== stdout ===', r.stdout || '(空)',
      '=== stderr ===', r.stderr || '(空)', '',
    ].join('\n'));
    const tail = `${r.stdout || ''}\n${r.stderr || ''}`.trimEnd().split(/\r?\n/).slice(-40).join('\n');
    if (tail) console.error(t(`[verify] 🧾 门输出尾部 40 行（全文 ${path.relative(ROOT, p)}）：\n${tail}`, `[verify] 🧾 last 40 lines of gate output (full text: ${path.relative(ROOT, p)}):\n${tail}`, ROOT));
    return p;
  } catch { return null; }
};

// --help 出口（2026-11-06）：只出用法——不读 git、不裁变更面、不落凭证、不跑门
function usageText() {
  return t([
    '用法：flow-kit run verify.mjs [档位] [选项]',
    '',
    '档位（缺省 = diff 面增量；最近 24h 无全量绿行时自动回落 --full 并打印 ⏭️ 兜底行）：',
    '  --full      全量门（关单凭证；引擎段 + 业务面 + 安全段）',
    '  --scope     diff 面增量（基线 = 最近全量绿行 headShort，回退 origin/main merge-base；',
    '              无 origin / 零提交的本地仓 loud-skip exit 0 并给降级建议，不判红）',
    '  --face <面> 显式面覆盖增量档（backend|frontend|tests|data|docs，逗号多值；与 --full/--scope 互斥；跳过 24h 兜底）',
    '  --product   业务面（product + security）',
    '  --mid       CI 中档（PR→develop / develop 直推）：业务面 + 后端只跑单测',
    '  --engine    仅引擎段自检',
    '',
    '增量档（缺省 / --scope / --face）产品门单边化 CI（2026-11-08 档 1 减重；2026-11-11 增代码门；2026-11-24 技术栈产品门改项目配置）：',
    '  id 属于 backend-build / backend-test / frontend-* / code-* 的产品门由 CI（--mid / --full）执法，本地增量档不跑；',
    '  其余项目产品门（.agents/config/product-gates*.json）与栈自动门照跑；secrets-scan + 引擎段 + wiki-consistency 照跑。',
    '',
    '选项：',
    '  --list            只列本轮门 id（配 --verbose 出「id<TAB>名称<TAB>命令」），不执行门',
    '  --help, -h        本帮助，立即退出',
    '  --jobs N          并发档位（缺省 clamp(2..4, cpus/4)）；--serial 回退串行',
    '  --verbose         --list 时附带每门命令',
    '  --test-cmd <cmd>  夹具：整表替换为单门（测试通道）',
    '  --stub-gate <cmd> 夹具：单门但走生产尾段（须配 CHECK_LOOP_ROOT）',
    '',
    '退出码：0 全绿 ｜ 1 有门失败（fail-fast，未跑门标「已中止」）｜ 2 参数或配置失守',
  ].join('\n'), [
    'Usage: flow-kit run verify.mjs [tier] [options]',
    '',
    'Tiers (default = diff-surface incremental; falls back to --full automatically when no full green run exists within 24h, printing a ⏭️ fallback line):',
    '  --full      full gate table (closeout credential; engine + product + security)',
    '  --scope     diff-surface incremental (baseline = last full green headShort, falling back to origin/main merge-base;',
    '              local repo without origin / zero commits loud-skips with exit 0 and a degraded-mode hint, not red)',
    '  --face <f>  explicit face override for the incremental tier (backend|frontend|tests|data|docs, comma-separated; mutually exclusive with --full/--scope; skips the 24h fallback)',
    '  --product   product surface (product + security)',
    '  --mid       CI mid tier (PR→develop / direct develop push): product surface + backend unit tests only',
    '  --engine    engine section only',
    '',
    'Incremental tiers (default / --scope / --face) make product gates unilateral CI (2026-11-08 tier 1 diet; 2026-11-11 code gates added; 2026-11-24 stack product gates moved to project config):',
    '  product gates whose id is backend-build / backend-test / frontend-* / code-* are enforced by CI (--mid / --full) and do not run in local incremental tiers;',
    '  other project product gates (.agents/config/product-gates*.json) and stack auto gates still run; secrets-scan + engine section + wiki-consistency still run.',
    '',
    'Options:',
    '  --list            list this run\'s gate ids only (with --verbose also print "id<TAB>name<TAB>command"), do not execute gates',
    '  --help, -h        this help, exit immediately',
    '  --jobs N          concurrency tier (default clamp(2..4, cpus/4)); --serial falls back to serial',
    '  --verbose         attach each gate\'s command to --list',
    '  --test-cmd <cmd>  fixture: replace the whole table with a single gate (test channel)',
    '  --stub-gate <cmd> fixture: single gate but runs the production tail (requires CHECK_LOOP_ROOT)',
    '',
    'Exit codes: 0 all green | 1 a gate failed (fail-fast; unstarted gates marked "aborted") | 2 bad arguments or config',
  ].join('\n'), ROOT);
}

async function run() {
  const argv = process.argv.slice(2);
  // 2026-11-06：此前 --help 是未知旗标——被静默忽略后照常解析档位并开跑全量门（敲 help 反付一次全量税）。
  // 帮助必须是最便宜的路径：早于一切 git 解析与门表装配。
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usageText());
    process.exit(0);
  }
  // 未知旗标告警（同上一行的教训）：静默忽略会把「参数拼错」伪装成「按缺省档跑」。只告警不阻断。
  const VALUED_FLAGS = new Set(['--jobs', '--test-cmd', '--stub-gate', '--face']);
  const KNOWN_FLAGS = new Set([
    '--full', '--scope', '--face', '--product', '--mid', '--engine', '--list', '--verbose', '--serial', '--help', '-h',
    ...VALUED_FLAGS,
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    if (VALUED_FLAGS.has(argv[i])) {
      i += 1;
      continue;
    }
    if (argv[i].startsWith('-') && argv[i].length > 1 && !KNOWN_FLAGS.has(argv[i])) {
      console.error(t(`[verify] ⚠️ 未知参数 ${argv[i]}（flow-kit run verify.mjs --help 看用法）`, `[verify] ⚠️ unknown argument ${argv[i]} (see usage: flow-kit run verify.mjs --help)`, ROOT));
    }
  }
  const ti = argv.indexOf('--test-cmd');
  const testCmd = ti >= 0 ? argv[ti + 1] : null;
  // --stub-gate（2026-10-15）：单门夹具但走生产尾段（落凭证 / 门禁成本 / gen-verify-evidence）。
  // 不打 testCmd 标记。必须配 CHECK_LOOP_ROOT，禁止在真实仓库写出可被当成关单凭证的绿行。
  const si = argv.indexOf('--stub-gate');
  const stubCmd = si >= 0 ? argv[si + 1] : null;
  if (si >= 0 && !stubCmd) {
    console.error(t('[verify] --stub-gate 需要一条命令', '[verify] --stub-gate requires a command', ROOT));
    process.exit(2);
  }
  if (stubCmd && testCmd) {
    console.error(t('[verify] --stub-gate 与 --test-cmd 互斥', '[verify] --stub-gate and --test-cmd are mutually exclusive', ROOT));
    process.exit(2);
  }
  if (stubCmd && !process.env.CHECK_LOOP_ROOT) {
    console.error(t('[verify] --stub-gate 只允许配合 CHECK_LOOP_ROOT 夹具根（禁止在真实仓库落无关单凭证）', '[verify] --stub-gate is only allowed with a CHECK_LOOP_ROOT fixture root (never write unrelated single-gate credentials into a real repo)', ROOT));
    process.exit(2);
  }
  // 引擎资产判定赋值（issue #73 单一定义点）：testCmd / stubCmd 已解析完毕——夹具旗标在位即不判定
  // （夹具根走测试缝；判定语义与双受众口径见 AGENTS_RUNTIME 旁的声明处注释）。
  engineAssetsAbsent = !testCmd && !stubCmd && !fs.existsSync(path.join(ROOT, '.agents', 'config', 'engine.json'));
  // --face（2026-11-08 档 1-B）：显式面覆盖——不做工作区脏路径自动面检测，直接按给定面裁门（增量档）。
  // 合法值单源 = verify-scope 面枚举（PRODUCT_FACES 的 face 字段，docs = 显式「无产品面」）；逗号多值。
  const fi = argv.indexOf('--face');
  const faceRaw = fi >= 0 ? argv[fi + 1] : null;
  let faceArg = null;
  if (fi >= 0) {
    const faces = String(faceRaw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const legal = [...new Set([...PRODUCT_FACES.map((pf) => pf.face), 'backend', 'frontend', 'docs'])];
    const illegal = faces.filter((f) => !legal.includes(f));
    if (!faceRaw || !faces.length || illegal.length) {
      console.error(t(`[verify] --face 需要面清单（合法值：${legal.join('|')}；逗号多值）${illegal.length ? `；非法值：${illegal.join(',')}` : ''}`, `[verify] --face requires a face list (valid: ${legal.join('|')}; comma-separated)${illegal.length ? `; invalid: ${illegal.join(',')}` : ''}`, ROOT));
      process.exit(2);
    }
    faceArg = faces;
  }
  // --scope（verify-diet 2026-10-21 ②；复核后基线升级）：diff 面增量关单——变更面（基线..HEAD ∪
  // 工作区 ∪ untracked；基线 = 最近全量绿行 headShort，回落在 origin/main merge-base）未触及的产品
  // 重门与引擎自检门跳过（密钥扫描 + wiki 一致性 + 关单主干引擎门恒跑；引擎测试门已退役，
  // .agents/ 不映射任何门——2026-10-28）。
  // 纯文档/业务面分支把关单压到分钟级以下；面触及对应路径自动回列，基线/面解析失败 fail-loud 拒增量。
  // 与 --test-cmd/--engine 互斥（夹具行不带生产标记、与引擎段增量门语义重叠）；--stub-gate 下只记
  // entry.scope 标记不裁门（stub 整表替换，测试通道用它做凭证渲染的集成断言）。
  const engineOnly = argv.includes('--engine');
  const productOnly = argv.includes('--product');
  // --mid（2026-10-29 三档门禁）：CI 中档 = PR→develop / develop 直推。业务面（product + security）
  // 与 --product 同集合，唯 backend-test 换「只跑单测」（不碰集成测试库）——PR 阶段不依赖测试库
  // 副本，DB 回归留给 develop→main 的重档（全量 22 门）。同 --product 不落 all-gates 凭证：
  // 分档绿不是关单凭证（关单仍要本地全量）。
  const midOnly = argv.includes('--mid');
  const explicitScope = argv.includes('--scope');
  const explicitFull = argv.includes('--full');
  // 重档判定（2026-11-06 修复）：显式 `--full` 或默认档回落全量（24h 无绿行 / diff 面解析失败）——
  // 门禁链据此让 backend-test 跑含集成的全量；默认档/中档仍单测档（集成执法点 = pre-push --select-range + CI 重档）。
  let fullTier = explicitFull;
  const listOnly = argv.includes('--list');
  if (explicitScope && explicitFull) {
    console.error(t('[verify] --scope 与 --full 互斥', '[verify] --scope and --full are mutually exclusive', ROOT));
    process.exit(2);
  }
  if (explicitScope && (testCmd || engineOnly)) {
    console.error(t('[verify] --scope 与 --test-cmd / --engine 互斥', '[verify] --scope is mutually exclusive with --test-cmd / --engine', ROOT));
    process.exit(2);
  }
  if (productOnly && (engineOnly || explicitScope)) {
    console.error(t('[verify] --product 与 --engine / --scope 互斥（业务面全量分档，CI main 用）', '[verify] --product is mutually exclusive with --engine / --scope (full product-surface tier, used by CI main)', ROOT));
    process.exit(2);
  }
  if (midOnly && (engineOnly || productOnly || explicitScope)) {
    console.error(t('[verify] --mid 与 --engine / --product / --scope 互斥（业务面分档，CI 中档用）', '[verify] --mid is mutually exclusive with --engine / --product / --scope (product-surface tier, used by CI mid tier)', ROOT));
    process.exit(2);
  }
  if (faceArg && explicitFull) {
    console.error(t('[verify] --face 与 --full 互斥（显式面覆盖属增量档）', '[verify] --face and --full are mutually exclusive (explicit face override belongs to the incremental tier)', ROOT));
    process.exit(2);
  }
  if (faceArg && (explicitScope || engineOnly || productOnly || midOnly || testCmd || stubCmd)) {
    console.error(t('[verify] --face 与 --scope / --engine / --product / --mid / 夹具旗标互斥（面来源与档位二选一）', '[verify] --face is mutually exclusive with --scope / --engine / --product / --mid / fixture flags (choose one face source and one tier)', ROOT));
    process.exit(2);
  }
  // 默认档（verify-scope-default 2026-10-22，owner 拍板）：未显式 --full、且非夹具/非引擎段/非 --list →
  // 默认走 diff 面增量，`--full` 才全量。实测依据：一日 23 次全量、墙钟中位 234s ≈ 90 分钟纯等待，而
  // 绝大多数分支只动文档面；「默认便宜、全量显式」是把关单压到分钟级以下的唯一杠杆。
  // --list 不参与：门表（基础门 + 项目产品门 + 栈自动门）是叙事锚与对外契约，裁剪只在执行期生效。
  let scopeMode = explicitScope ? 'diff'
    : faceArg ? 'face'
    : (!explicitFull && !testCmd && !stubCmd && !engineOnly && !productOnly && !midOnly && !listOnly) ? 'diff' : null;
  let scope = null;
  let ledgerBase = null;
  let baseSourceHint = 'ledger';
  // 绿行锚点（verify-evidence-fallback 2026-10-22 立；2026-10-29 secrets-incr/unit-tier 常算并放宽）：
  // 本地台账最近一次绿行 ∪ 仓库级凭证 workflow/verify-evidence.md（入库追加保全，跨机/换 worktree 不失历史），
  // 取「最新且为 HEAD 祖先」者（非祖先 = 别的分支/rebase 残留，拒用回落 origin/main）。
  // **scope 行自 2026-10-29 起可作锚**（owner 拍板「关单只跑单测」）：默认档 backend-test 恒为单测档、
  // 集成测试移推送/CI——scope 绿行对面外重门的面裁担保仍是传递链，密钥门每行都执法（未装机时降级 lite，
  // 仍执法；envSkips 行见落账段）。锚点三消费方：diff 面基线、24h 兜底、secrets-scan 增量基线。
  const candidates = [];
  try {
    const vp = path.join(ROOT, '.agents', 'verifications.jsonl');
    const rows = fs.existsSync(vp) ? fs.readFileSync(vp, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
    for (let i = rows.length - 1; i >= 0; i--) {
      try {
        const e = JSON.parse(rows[i]);
        // fastTests 行（engine-tests 降 --fast、无 scope 标记的裁剪绿）禁作锚——
        // 否则增量担保建立在漏跑慢套件的树上（2026-10-24 复核 P1-5）
        // envSkips 行（2026-10-27 anchor-envskip）：有门被 loud-skip 的「看似全量」行同样禁作锚——
        // 该行实跑门数 < 门表（实测 12 条 gates=14/15 + envSkips=ledger-invariant），
        // 一旦当锚，后续增量担保会建立在「没跑 ledger-invariant」的树上；
        // 2026-10-29 起密钥门恒执法（gitleaks 缺装机则降级 lite），故 secrets 不再产生 envSkips；
        if (e.exitCode === 0 && e.suite === 'all-gates' && e.headShort && !e.fastTests && !e.testCmd && !e.engineOnly
          && !(Array.isArray(e.envSkips) && e.envSkips.length)) {
          candidates.push({ sha: e.headShort, ts: e.ts, source: 'ledger' });
          break;
        }
      } catch { /* 坏行跳过 */ }
    }
  } catch { /* 读不到台账 = 无本地候选 */ }
  try {
    const ep = path.join(ROOT, EVIDENCE_REL);
    if (fs.existsSync(ep)) {
      for (const row of parseEvidenceGreens(fs.readFileSync(ep, 'utf8'))) {
        candidates.push({ sha: row.headShort, ts: row.ts, source: 'evidence' });
      }
    }
  } catch { /* 读不到凭证 = 无仓库候选 */ }
  const seen = new Set();
  const ordered = candidates
    .filter((c) => c.sha && Number.isFinite(Date.parse(c.ts)))
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .filter((c) => (seen.has(c.sha) ? false : (seen.add(c.sha), true)));
  const isAncestor = (sha) => spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { encoding: 'utf8', cwd: ROOT }).status === 0;
  const chosen = ordered.find((c) => isAncestor(c.sha)) || null;
  const lastFullTs = chosen ? chosen.ts : null;
  if (chosen) { ledgerBase = chosen.sha; baseSourceHint = chosen.source; }
  if (scopeMode) {
    // 24h 绿行兜底：**只约束默认档**（显式 --scope / --face = 操作者已判读面，且夹具端到端用例依赖无历史绿行算面）。
    // 判据 = 最近绿行（scope 计入，2026-10-29 单测档口径）age < 24h；过期或不存在 → 本次退回全量。
    // 刻意**不认失败行**：红树上的增量绿会伪造安全感，「跑过」不等于「跑绿」。代价是树长期红时默认档
    // 恒失效——这是有意的取舍：门禁全红时该修树，不该降档。
    if (!explicitScope && !faceArg) {
      const age = lastFullTs ? Date.now() - Date.parse(lastFullTs) : null;
      const freshFull = age !== null && Number.isFinite(age) && age >= 0 && age < 24 * 3600 * 1000;
      if (!freshFull) {
        const why = lastFullTs ? t(`最近绿行 ${lastFullTs.slice(0, 16)}（已 ${(age / 3600000).toFixed(1)}h）`, `last green ${lastFullTs.slice(0, 16)} (${(age / 3600000).toFixed(1)}h ago)`, ROOT) : t('本地台账与仓库凭证均无绿行', 'no green run in local ledger or repo evidence', ROOT);
        console.log(t(`[verify] ⏭️ 24h 内无绿行（${why}）→ 本次全量执法（兜底）\n`, `[verify] ⏭️ no green run within 24h (${why}) → running the full gate table (fallback)\n`, ROOT));
        scopeMode = null; fullTier = true;
      }
    }
  }
  if (scopeMode === 'face') {
    // --face 显式面（档 1-B）：不读 git 变更面，直接按给定面组装配裁。ledgerTouched 恒 false——
    // ledger-invariant 照 CI-only 口径本地 loud-skip（绿行 envSkips 留痕，故 face 绿行不作增量锚，
    // 24h 兜底锚链语义不变）。
    const touched = new Set(faceArg);
    scope = {
      baseShort: ledgerBase || 'none',
      baseSource: 'manual',
      fileCount: 0,
      touched,
      skippedGateIds: PRODUCT_FACES.filter((pf) => !touched.has(pf.face)).flatMap((pf) => pf.gates),
      matched: [],
      files: [],
      ledgerTouched: false,
    };
  } else if (scopeMode) {
    const git = (args) => spawnSync('git', args, { encoding: 'utf8', cwd: ROOT });
    try {
      scope = computeDiffScope(git, ledgerBase, baseSourceHint, PRODUCT_FACES);
    } catch (e) {
      // 显式 --scope 保持 fail-loud（拒增量）；默认档退回全量——默认档不该因基线缺失整体失败。
      if (explicitScope) {
        // 环境态 loud-skip（scope loud-skip 2026-11-17 行为评测②）：本地未推送仓（无 origin / 零提交）
        // 增量基线不可得不再 exit 2——输出原因与降级建议，exit 0 不判红。有 origin 的既有路径零变化
        // （diff 面为空等仍 fail-loud exit 2）；推送范围对账由 pre-push check-scope-range 硬门兜底。
        if (e.scopeSkip) {
          console.log(t(`[verify] ⏭️ --scope loud-skip：${e.message}——本次增量档不执行（exit 0，不判红）`, `[verify] ⏭️ --scope loud-skip: ${e.message} — incremental tier not executed (exit 0, not red)`, ROOT));
          console.log(t('[verify]    降级建议：plan↔git 对账用 flow-kit run check-scope.mjs <plan> --base <sha>（或 --staged）；推送级对账由 pre-push check-scope-range 硬门兜底', '[verify]    degradation hint: reconcile plan↔git with flow-kit run check-scope.mjs <plan> --base <sha> (or --staged); push-range reconciliation is covered by the pre-push check-scope-range hard gate', ROOT));
          process.exit(0);
        }
        console.error(`[verify] --scope: ${e.message}`);
        process.exit(2);
      }
      console.log(t(`[verify] ⏭️ diff 面解析失败（${e.message}）→ 本次全量执法（兜底）\n`, `[verify] ⏭️ diff surface resolution failed (${e.message}) → running the full gate table (fallback)\n`, ROOT));
      scopeMode = null; fullTier = true;
    }
  }
  // engine-tests 门已随引擎测试面退役删除（2026-10-28，owner 决策：不再跑引擎面全量测试）；
  // fastTests 字段保留为历史凭证兼容（恒 false）。
  let fastEngineTests = false;
  // 增量档实际裁剪 = 面裁（skipSet 源）∪ 产品门单边化 CI（档 1-B 产品 5 门；2026-11-11 增代码四门，增量档恒裁，执法点在 CI）。
  let effSkipped = [];
  if (scopeMode && scope && !stubCmd) {
    effSkipped = [...new Set([...scope.skippedGateIds, ...CI_UNILATERAL_GATE_IDS])];
    if (scopeMode === 'face') {
      console.log(t(`[verify] 🔀 face=${faceRaw}（显式指定，跳过变更面自动检测）：裁 ${effSkipped.length} 门（${effSkipped.join('、') || '无'}）\n`, `[verify] 🔀 face=${faceRaw} (explicit, skipping automatic change-surface detection): ${effSkipped.length} gates skipped (${effSkipped.join(', ') || 'none'})\n`, ROOT));
    } else {
      const faceNote = PRODUCT_FACES
        .map((pf) => `${pf.face}:${scope.touched.has(pf.face) ? t('触', 'touched', ROOT) : t('未触', 'untouched', ROOT)}`).join(' ') || t('无产品面', 'no product faces', ROOT);
      const skipNote = t(`跳过 ${effSkipped.length} 门（${effSkipped.join('、')}）`, `${effSkipped.length} gates skipped (${effSkipped.join(', ')})`, ROOT);
      const baseWhy = scope.baseSource === 'ledger' ? t('上次绿行', 'last green run', ROOT)
        : scope.baseSource === 'evidence' ? t('仓库凭证', 'repo evidence', ROOT) : 'origin/main';
      console.log(t(`[verify] 🔀 scope=diff：基线 ${scope.baseShort}（${baseWhy}）｜变更面 ${scope.fileCount} 文件（${faceNote}）——${skipNote}\n`, `[verify] 🔀 scope=diff: baseline ${scope.baseShort} (${baseWhy}) | changed surface ${scope.fileCount} files (${faceNote}) — ${skipNote}\n`, ROOT));
    }
  }
  // --engine（2026-10-11 C7 方案②）：只跑 cohort=engine 的引擎段门——原设计供 develop 增量 CI
  // （该 CI 步已随 2026-10-21 死步清理删除；--engine 保留本地/手动用法）。与全量的关键差异：
  // 全绿**不落 all-gates 绿行、不生成摘要**——增量段绿不是 22 门全量关单凭证，落了会被 hasFreshVerifyLine
  // 与 gen-verify-evidence 误认成全量绿（伪凭证）；失败行照记（suite=门 id，诊断用）。
  const skipSet = scope ? new Set(scope.skippedGateIds) : new Set();
  // CI-only 门（verify-diet 二批 2026-10-21 P0-2；2026-10-24 复核 P1 收紧）：ledger-invariant 全史扫描
  // 在 TF_BUILD 外默认 loud-skip，但 diff 面触及台账/修剪 manifest 时回列（verify-scope.ledgerTouched）
  // ——台账变更才付 ~90s，未触及仍跳过；全量档（无 scope）与 CI 照跑。绿行 envSkips 记录跳过事实。
  const CI_ONLY_GATE_IDS = new Set(['ledger-invariant']);
  const isCiEnv = isCi();
  const localLedgerSkip = !testCmd && !stubCmd && !isCiEnv
    && !!scope && !scope.ledgerTouched;
  const envSkipIds = localLedgerSkip ? CI_ONLY_GATE_IDS : new Set();
  // 引擎资产缺失（issue #73）：两门 loud-skip 记入 envSkips——绿行记录跳过事实（带 envSkips 的行
  // 按既有锚点规则不作增量锚，语义正确）。门本体在执行前裁剪（--list 分支之后的裁剪点）。
  if (engineAssetsAbsent) {
    envSkipIds.add('engine-artifacts');
    envSkipIds.add('secrets-scan');
  }
  let gates = testCmd ? fixtureGates(testCmd)
    : stubCmd ? [{ id: 'stub', cohort: 'engine', name: t('夹具单门', 'Fixture gate', ROOT), cmd: stubCmd, folder: '.', type: 'shell' }]
    : engineOnly ? GATES.filter((g) => g.cohort === 'engine')
    : productOnly ? GATES.filter((g) => g.cohort !== 'engine') // 业务面：product + security（CI main）
    // 中档（--mid）：业务面同 --product，唯一差异 = backend-test 只跑单元测试（不碰集成测试库）。
    // 门 id/名称不变，deps 边（backend-test ← backend-build）照旧成立。
    : midOnly ? GATES.filter((g) => g.cohort !== 'engine')
      .map((g) => (g.id === 'backend-test'
        ? { ...g, cmd: `${g.cmd} --unit-only`, name: t('后端单元测试（不含集成测试）', 'Backend unit tests (excluding integration tests)', ROOT) }
        : g))
    // 重档（--full / 默认档回落，2026-11-06 修复）：全量门表（基础门 + 项目产品门 + 栈自动门），backend-test 不附 --unit-only（含集成）——
    // 直推 main 与 PR→main 的 CI 重档执法面（CI 已备 TEST_DB_ALLOW_DEV=1 逃生，见 azure-pipelines.yml）；
    // 本地默认档/中档仍单测档（集成在 pre-push --select-range / CI 重档）。
    // !scopeMode 兜住裸 --list：裸 --list 门表不裁剪（裁剪只在增量档执行期与 --list --scope/--face 生效）。
    : fullTier || !scopeMode ? GATES
    // 增量档（缺省 / --scope / --face；2026-11-08 档 1-B 产品门单边化 CI）：
    // ① 产品 cohort 5 门（backend-build / backend-test / frontend-lint / frontend-unit-test / frontend-build）
    //   ＋代码四门（code-architecture / code-audit-fields / code-delete-guard / code-notify-guard，2026-11-11）
    //   恒不执行——执法点单边移交 CI（--full/--mid/--product 与 azure-pipelines 一字不变）；门清单上方
    //   打印跳过说明行（UNILATERAL_NOTE）。面裁（skipSet）保留：给定/计算面仍决定 entry.scope 审计事实。
    // ② secrets-scan 降范围增量——锚点 = 上方绿行锚（祖先校验过），每轮只扫 锚..HEAD 新提交
    //   （实测全史 15s → 0.8s）；无锚点（首跑/树红后）自动全量，全史兜底留 --full 与 CI main 重档。
    // ③ 引擎段 + wiki-consistency 恒跑（关单主干；单测档 --unit-only 随 backend-test 单边化一并退役）。
    : GATES.filter((g) => !skipSet.has(g.id) && !CI_UNILATERAL_GATE_IDS.has(g.id))
      .map((g) => {
        if (g.id === 'secrets-scan' && ledgerBase) {
          return { ...g, env: { SECRETS_SCAN_BASE: ledgerBase }, name: t('密钥扫描（gitleaks 增量+基线）', 'Secret scan (gitleaks incremental + baseline)', ROOT) };
        }
        return g;
      });
  // deps 完整性断言（复核 P2）：依赖门被裁剪/表形态破坏时，worker 会把依赖孤儿静默 continue——
  // 门从绿跑里无声消失、绿凭证残缺。此处 fail-loud，不带病跑（--no-build 放大此陷阱的后果）。
  {
    const gateIds = new Set(gates.map((g) => g.id));
    for (const g of gates) {
      for (const d of g.deps || []) {
        if (!gateIds.has(d)) {
          console.error(t(`[verify] 门 ${g.id} 依赖 ${d} 不在本轮门清单——裁剪/表形态错误，拒绝运行`, `[verify] gate ${g.id} depends on ${d}, which is not in this run's gate list — pruning / table shape error, refusing to run`, ROOT));
          process.exit(2);
        }
      }
    }
  }

  if (argv.includes('--list')) {
    if (testCmd) {
      console.error(t('[verify] --list 与 --test-cmd 互斥', '[verify] --list and --test-cmd are mutually exclusive', ROOT));
      process.exit(1);
    }
    // 干跑展示裁剪（档 1-B）：跳过说明走 stderr——stdout 保持纯 id，管道消费方不受影响。
    if (scopeMode) console.error(`[verify] ⏭️ ${UNILATERAL_NOTE}`);
    // 引擎资产缺失（issue #73）：--list 不裁 stdout 的 id 清单（裸 --list 门表恒 22 叙事锚不动），
    // stderr 一行说明执行期将裁两门（secrets-scan 挂载 check-secrets.mjs，随门一并跳过）。
    if (engineAssetsAbsent) console.error(t(`[verify] ⏭️ 未安装引擎资产（无 .agents/config/engine.json）——跳过 ${[...ASSET_GATE_IDS].join('、')} 门（check-secrets.mjs 密钥扫描随 secrets-scan 一并跳过；外部编排消费方；issue #73）`, `[verify] ⏭️ engine assets not installed (no .agents/config/engine.json) — skipping gates ${[...ASSET_GATE_IDS].join(', ')} (the check-secrets.mjs secret scan is skipped together with secrets-scan; external orchestration consumers; issue #73)`, ROOT));
    // when 未满足的项目产品门：不进清单，SKIP 行走 stderr（stdout 保持纯 id 可管道）。
    for (const s of whenSkippedGates) console.error(t(`SKIP: ${s.id}（未找到 ${s.when}，跳过——配置好后自动启用）`, `SKIP: ${s.id} (${s.when} not found; skipped — enabled automatically once configured)`, ROOT));
    if (totalConfiguredProductGates > 0 && whenSkippedGates.length >= totalConfiguredProductGates) {
      console.error(t('[verify] 💡 提示：所有已配置的项目产品门因 when 条件未满足已全部跳过（当前无业务代码检查执行）。', '[verify] 💡 Advisory: all configured project product gates were skipped due to unmet "when" conditions (no business checks ran).', ROOT));
    }
    // 门禁配置汇总（2026-11-24）：一行报项目侧配置文件在场/缺席；stderr 保持 stdout 纯 id。
    console.error(`[verify] ${GATE_CONFIG_SUMMARY}`);
    const verbose = argv.includes('--verbose');
    for (const g of gates) console.log(verbose ? `${g.id}\t${g.name}\t${g.cmd}` : g.id);
    process.exit(0);
  }

  // 引擎资产缺失裁剪（issue #73，2026-11-22）：外部编排宿主无 .agents/config/engine.json——
  // engine-artifacts（workflow-index 重生成器 ENOENT 崩）/ secrets-scan（check-secrets.mjs 缺基线
  // exit 2 拒跑）两门硬依赖安装资产，宿主面 loud-skip。--list 已在上分支 exit（叙事锚不动，stderr
  // 已注记）；跳过事实经上方 envSkipIds 进绿行 envSkips。kit 自装项目恒有 engine.json，此分支
  // 不可达，门禁面零变化。
  if (engineAssetsAbsent) {
    gates = gates.filter((g) => !ASSET_GATE_IDS.has(g.id));
    console.error(t(`[verify] ⏭️ 未安装引擎资产（无 .agents/config/engine.json）——跳过 ${[...ASSET_GATE_IDS].join('、')} 门（check-secrets.mjs 密钥扫描随 secrets-scan 一并跳过；外部编排消费方；issue #73）`, `[verify] ⏭️ engine assets not installed (no .agents/config/engine.json) — skipping gates ${[...ASSET_GATE_IDS].join(', ')} (the check-secrets.mjs secret scan is skipped together with secrets-scan; external orchestration consumers; issue #73)`, ROOT));
  }

  // 并发档位（2026-10-16 并行编排）：门之间无共享状态（各自独立进程 + 独立工作目录），串行编排下
  // 总耗时 = 各门之和（本机实测（15 门时）~300s：engine-tests 118s / backend-test 63s / ledger-invariant 55s…）。
  // 工作池并发后墙钟 ≈ max(最长门, 各门之和 / 并发)——门自身已内部并行（npm test 套件池 6、dotnet 多核、
  // check-loop.test 分片 6），并发档位越高越互相抢核，最长门（engine-tests）反而变慢。本机 12 逻辑核
  // 实测（×2 取均值，全绿）：j2 177.8s / **j3 122.3s** / j4 129.3s / j6 136.6s——膝点在 3。
  // 缺省 = clamp(2..4, floor(cpus/4))（12 核 → 3）；--serial 回退串行（排障/对比）；--jobs N 显式钉档。
  const serial = argv.includes('--serial');
  const jobsRaw = argv.includes('--jobs') ? Number(argv[argv.indexOf('--jobs') + 1]) : null;
  if (jobsRaw !== null && (!Number.isInteger(jobsRaw) || jobsRaw < 1)) {
    console.error(t(`[verify] --jobs 须为正整数（现 ${argv[argv.indexOf('--jobs') + 1]}）`, `[verify] --jobs must be a positive integer (got ${argv[argv.indexOf('--jobs') + 1]})`, ROOT));
    process.exit(2);
  }
  const JOBS = serial ? 1 : Math.min(jobsRaw ?? Math.max(2, Math.min(4, Math.floor(os.cpus().length / 4))), gates.length);
  // 单门输出上限（与旧 spawnSync maxBuffer 同口径）：超限即树杀判红，不静默截断
  const MAX_GATE_OUTPUT = 32 * 1024 * 1024;
  // 树杀（fail-fast 中止在跑门）：Windows 下 shell:true 起的是 cmd.exe，kill 只杀壳不杀孙进程
  // （npm→node、dotnet→vstest 会成孤儿并占住 bin 锁）——故走 taskkill /T /F 整树。
  const killTree = (child) => {
    try {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch { /* best-effort：杀不动不改变裁决 */ }
  };

  if (scopeMode) console.log(`[verify] ⏭️ ${UNILATERAL_NOTE}\n`);
  const modeSuffix = `${serial ? t('·串行', ', serial', ROOT) : ''}${testCmd ? t('【fixture 模式】', ' [fixture mode]', ROOT) : ''}${stubCmd ? t('【stub 尾段】', ' [stub tail]', ROOT) : ''}${engineOnly ? t('【引擎段增量门】', ' [engine incremental gates]', ROOT) : ''}${productOnly ? t('【业务面分档】', ' [product-surface tier]', ROOT) : ''}${midOnly ? t('【中档：业务面+单测】', ' [mid tier: product surface + unit tests]', ROOT) : ''}`;
  console.log(t(`[verify] 🚀 开始全量静态门验证 (共 ${gates.length} 项，并发 ${JOBS}${modeSuffix})\n`, `[verify] 🚀 starting full static gate verification (${gates.length} items, concurrency ${JOBS}${modeSuffix})\n`, ROOT));
  // when 未满足的项目产品门：门清单处显式 SKIP（跳过可见，与 fail-loud 对称）；不计失败、不落凭证。
  if (!testCmd && !stubCmd && !engineOnly) {
    for (const s of whenSkippedGates) console.log(t(`SKIP: ${s.id}（未找到 ${s.when}，跳过——配置好后自动启用）`, `SKIP: ${s.id} (${s.when} not found; skipped — enabled automatically once configured)`, ROOT));
    if (totalConfiguredProductGates > 0 && whenSkippedGates.length >= totalConfiguredProductGates) {
      console.log(t('[verify] 💡 提示：所有已配置的项目产品门因 when 条件未满足已全部跳过（当前无业务代码检查执行）。', '[verify] 💡 Advisory: all configured project product gates were skipped due to unmet "when" conditions (no business checks ran).', ROOT));
    }
  }

  let passedCount = 0;
  const outputs = {};
  // 逐门耗时埋点（2026-10-14 G8 门禁计时）：durations 随 all-gates 绿行入 verifications.jsonl，
  // metrics.md「门禁成本/迭代」表消费——G10（影响面裁剪）的判据数据源。
  const durations = {};
  let cohortSeen = '';
  const cohortLabel = { engine: t('引擎段', 'Engine section', ROOT), security: t('安全段', 'Security section', ROOT), product: t('产品段', 'Product section', ROOT) };
  const doneIdx = new Set();  // 已出裁决的门序（成功/失败/中止；未列入者 = fail-fast 后状态未知）
  const aborted = new Set();  // 因他门失败被树杀中止的门序
  const running = new Map();  // 门序 -> child（树杀目标）
  let failedIdx = -1;

  const startGate = (i) => {
    const gate = gates[i];
    // CI-only 门本地 loud-skip：合成「通过」裁决（不 spawn、不计耗时、不进 passedCount）——
    // 跳过在 finishGate 以 ⏭️ 行显式可见（与 E2E loud-skip 对称：没跑 ≠ 过了，台账可区分）。
    if (envSkipIds.has(gate.id)) {
      return Promise.resolve({ status: 0, skip: true, stdout: '', stderr: '', durMs: 0 });
    }
    if (gate.cohort && gate.cohort !== cohortSeen) {
      cohortSeen = gate.cohort;
      const n = gates.filter((g) => g.cohort === cohortSeen).length;
      console.log(t(`[verify] —— ${cohortLabel[cohortSeen] || cohortSeen}（${n}）——`, `[verify] —— ${cohortLabel[cohortSeen] || cohortSeen} (${n}) ——`, ROOT));
    }
    console.log(`[verify] ▶ ${i + 1}/${gates.length} ${gate.name}...`);
    const t0 = performance.now();
    const child = spawn(localizeRuntimeCmd(gate.cmd), { shell: true, cwd: path.join(ROOT, gate.folder), env: gate.env ? { ...process.env, ...gate.env } : process.env });
    running.set(i, child);
    const buf = { stdout: '', stderr: '', overflow: false };
    const pump = (src, key) => {
      src.setEncoding('utf8');
      src.on('data', (d) => {
        if (buf.overflow) return;
        buf[key] += d;
        // 与旧 spawnSync maxBuffer 同口径：超限即中止判红（不静默截断——截断后的输出不可当证据）
        if (buf[key].length > MAX_GATE_OUTPUT) { buf.overflow = true; killTree(child); }
      });
    };
    pump(child.stdout, 'stdout');
    pump(child.stderr, 'stderr');
    return new Promise((resolve) => {
      let settled = false;
      const settle = (status, error) => {
        if (settled) return;
        settled = true;
        running.delete(i);
        resolve({ status, error, ...buf, durMs: Math.round(performance.now() - t0) });
      };
      child.on('error', (e) => settle(null, e));
      child.on('close', (status) => settle(status, null));
    });
  };

  // 出裁决：先回放该门缓冲输出（并发下输出按门整块回放，逐门可读，与 run-tests 同口径），再打结论行。
  // 返回 true = 该门红（调用方据此 fail-fast）。
  const finishGate = (i, r) => {
    const gate = gates[i];
    doneIdx.add(i);
    if (r.skip) {
      console.log(t(`[verify] ⏭️ ${i + 1}/${gates.length} ${gate.name}：CI-only（非 CI 环境跳过——提交时刻 --staged 增量门已执法，全史扫描 CI 兜底）\n`, `[verify] ⏭️ ${i + 1}/${gates.length} ${gate.name}: CI-only (skipped outside CI — the commit-time --staged incremental gate already enforced it; full-history scan covered by CI)\n`, ROOT));
      return false;
    }
    durations[gate.id] = r.durMs;
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (aborted.has(i)) {
      console.error(t(`[verify] ⏹ ${i + 1}/${gates.length} ${gate.name} 已中止（他门失败触发 fail-fast，状态未知）`, `[verify] ⏹ ${i + 1}/${gates.length} ${gate.name} aborted (another gate failed and triggered fail-fast; status unknown)`, ROOT));
      return false;
    }
    if (r.overflow) {
      console.error(t(`[verify] ❌ ${i + 1}/${gates.length} ${gate.name} 未通过（输出超 ${MAX_GATE_OUTPUT / 1024 / 1024}MB 上限，已中止）`, `[verify] ❌ ${i + 1}/${gates.length} ${gate.name} FAILED (output exceeded ${MAX_GATE_OUTPUT / 1024 / 1024}MB limit; aborted)`, ROOT));
      persistGateLog(gate, r);
      // 归因恒带（2026-11-10）：溢出前已捕获的输出仍可供 failure-attribution 启发式签名匹配，
      // 无签名则落保守默认 real（同 classifyFailure「否则 real」口径）——失败行不留无归因空洞。
      recordFailure(gate.id, -1, 'output-overflow', classifyFailure(`${r.stdout || ''}\n${r.stderr || ''}`));
      return true;
    }
    if (r.status !== 0) {
      const logPath = persistGateLog(gate, r);
      const note = `exit ${r.status ?? r.error?.code}${logPath ? `·log ${path.relative(ROOT, logPath)}` : ''}`;
      // 归因（gate-health 2026-10-22）：env / flaky / real——只标注不改裁决；假红可当场定性。
      const attribution = classifyFailure(`${r.stdout || ''}\n${r.stderr || ''}`);
      console.error(t(`[verify] ❌ ${i + 1}/${gates.length} ${gate.name} 未通过 (${note})｜归因 ${attribution}`, `[verify] ❌ ${i + 1}/${gates.length} ${gate.name} FAILED (${note}) | attribution ${attribution}`, ROOT));
      recordFailure(gate.id, r.status, note, attribution);
      return true;
    }
    // stdout+stderr 都留档（2026-10-29 secrets-incr）：loud-skip 类声明多走 stderr（check-secrets 用
    // console.error），只存 stdout 会让落账段的 envSkips 动态探测落空——锚点空洞堵不住。
    outputs[gate.id] = `${r.stdout || ''}\n${r.stderr || ''}`;
    console.log(t(`[verify] ✅ ${i + 1}/${gates.length} ${gate.name} 通过 [${r.durMs} ms]\n`, `[verify] ✅ ${i + 1}/${gates.length} ${gate.name} passed [${r.durMs} ms]\n`, ROOT));
    passedCount++;
    return false;
  };

  const wallStart = performance.now();

  // flaky 隔离重跑已退役（2026-11-08 减重档 3-U1：近 30 天零触发）——门结果即首跑结果；
  // 首跑红按归因标注（上方 startGate），处置一律人工立项（commands/stages.md），不再自动重跑。
  const runGate = startGate;

  // 依赖边（deps）：本门须待所列门**成功**后才启动——backend-test 走 --no-build 直接消费 backend-build
  // 产物（verify-diet ③，双构建已消）；deps 兼任门序：构建红 → 测试不启动。串行后 19s+81s 仍在
  // engine-tests 的影子里，不增墙钟。依赖门红/未跑 → 本门不启动（状态未知，由尾段清单兜底）。
  const idxOf = new Map(gates.map((g, i) => [g.id, i]));
  const gatePromise = new Map(); // 门序 -> 该门结果 Promise（依赖方 await 用）
  const skippedByDep = new Set(); // 因依赖未过而未启动的门（主循环后 fail-loud）

  // 守卫段（guardian）：串行先跑、未过即止——后序门一并不启动
  for (let i = 0; i < gates.length && failedIdx < 0; i++) {
    if (!gates[i].guardian) continue;
    const p = runGate(i);
    gatePromise.set(i, p);
    if (finishGate(i, await p) && failedIdx < 0) failedIdx = i;
  }

  if (failedIdx < 0) {
    // 主体段：工作池并发（完成一个补一个）；任一门红 → 停排新门 + 树杀在跑门（fail-fast 语义保留）
    // 门序按 deps 稳定拓扑排序（只认本轮门表内的边；同层保持原相对顺序）：worker 按 bodyIdx 顺序取门，
    // 被依赖门若排在依赖方之后且尚未被取走，依赖方会读到 null 而被静默跳过——排序消掉该窗口。
    const bodyIdx = (() => {
      const original = gates.map((_, i) => i).filter((i) => !gates[i].guardian);
      const inBody = new Set(original);
      const pending = new Map(original.map((i) => [
        i,
        new Set((gates[i].deps || [])
          .map((d) => idxOf.get(d))
          .filter((j) => j !== undefined && j !== i && inBody.has(j))),
      ]));
      const ordered = [];
      const done = new Set();
      while (ordered.length < original.length) {
        const ready = original.filter((i) => !done.has(i) && [...pending.get(i)].every((j) => done.has(j)));
        if (!ready.length) {
          // 依赖环：按原顺序补齐（尾段 skippedByDep 兜底 fail-loud，不会静默绿）
          for (const i of original) {
            if (!done.has(i)) {
              ordered.push(i);
              done.add(i);
            }
          }
          break;
        }
        for (const i of ready) {
          ordered.push(i);
          done.add(i);
        }
      }
      return ordered;
    })();
    let cursor = 0;
    const worker = async () => {
      while (failedIdx < 0 && cursor < bodyIdx.length) {
        const i = bodyIdx[cursor++];
        const deps = gates[i].deps || [];
        if (deps.length) {
          const depResults = await Promise.all(deps.map((d) => gatePromise.get(idxOf.get(d)) ?? Promise.resolve(null)));
          if (failedIdx >= 0) return;
          if (depResults.some((r) => !r || r.status !== 0)) {
            // 依赖未过（含尚未出结果的 null）→ 本门不启动；主循环后 fail-loud，绝不静默绿。
            skippedByDep.add(gates[i].id);
            continue;
          }
        }
        const p = runGate(i);
        gatePromise.set(i, p);
        if (finishGate(i, await p) && failedIdx < 0) {
          failedIdx = i;
          for (const [j, child] of [...running]) { aborted.add(j); killTree(child); }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(JOBS, bodyIdx.length) }, worker));
  }

  // 门禁配置汇总（2026-11-24）：运行结束恒打一行（绿/红都可见），说明哪些项目侧门配置缺席=SKIP。
  console.log(`[verify] ${GATE_CONFIG_SUMMARY}`);

  // 依赖未过导致门未启动：无失败门也绝不静默绿（旧行为：该门既不执行也不进任何清单）。
  if (failedIdx < 0 && skippedByDep.size > 0) {
    const ids = gates.filter((g) => skippedByDep.has(g.id)).map((g) => g.id);
    console.error(t(`[verify] ⏭️ 门未启动（依赖未通过）：${ids.join('、')}`, `[verify] ⏭️ gate not started (dependency failed): ${ids.join(', ')}`, ROOT));
    process.exit(1);
  }

  if (failedIdx >= 0) {
    // 未执行门清单（2026-10-11 D2；2026-10-16 并发编排后按「已出裁决」算）：fail-fast 后状态未知≠通过——
    // 验证系统输出须完备，与 E2E loud-skip 对称（否则「没跑」在台账里与「过了」不可区分）。
    const remaining = gates.map((g, i) => i).filter((i) => !doneIdx.has(i)).map((i) => gates[i].id);
    if (remaining.length) console.error(t(`[verify] ⏭️ 未执行门（fail-fast，状态未知）：${remaining.join('、')}`, `[verify] ⏭️ gates not executed (fail-fast; status unknown): ${remaining.join(', ')}`, ROOT));
    process.exit(1);
  }

  // ---- 全绿尾段（任一门红已在上方 exit 1 返回，能走到这里即全绿）----
  // 引擎段增量门不落 all-gates 凭证（增量段绿 ≠ 22 门全量关单凭证）——台账/摘要双跳过；
  // fixture 绿行照落（带 testCmd:true 标记，hasFreshVerifyLine 不认——测试面沿既有契约）
  if (!engineOnly && !productOnly && !midOnly) {
    let entry = null;
    try {
      entry = { ts: new Date().toISOString(), exitCode: 0, suite: 'all-gates', gates: passedCount };
      // 档位标记（2026-11-06 P0-1 续测）：显式 `--full` / 默认 diff / 默认回落全量 / 夹具——
      // 使「关单是否按默认档走」可直接对质（此前只能靠 unitOnly 有无间接推断，且与「未裁门」不可分）。
      entry.mode = testCmd ? 'fixture' : (explicitFull ? 'full' : (scopeMode === 'face' ? 'face' : (scopeMode ? 'diff' : 'fallback')));
      // --face 落账（档 1-B）：绿行原样记录给定面清单，审计可对质「该凭证按哪个面裁的门」。
      if (scopeMode === 'face') entry.face = faceRaw;
      // HEAD 短 SHA 钉进绿行本体（2026-10-09 AI-Native 架构审查修复收尾）：确定性证据此前只存在于测试
      // 夹具、绿行无 SHA 可锚定验证对象；非 git 环境（fixture 根在 os.tmpdir）解析失败则省略该键，不伪造。
      const rev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: ROOT });
      if (rev.status === 0 && rev.stdout) entry.headShort = rev.stdout.trim();
      // 业务脏路径快照（closeout-skill-hardening 2026-11-08）：confirm-doc 关单时比对当前
      // 业务路径的脏文件——绿行之后新出现的业务改动使凭证过期（HEAD 判不出未提交改动）。
      // 判据单源 = faces.mjs（2026-11-24）：code + ui 前缀（与旧 backend//frontend/ 口径等价）；
      // 未配置 faces → isProductPath 恒 true（保守：任何脏文件都算业务面）。
      // 只记路径列表（不记内容、不记哈希）：重跑 verify 即刷新；非 git 环境省略该键，
      // confirm-doc 对存量/缺字段绿行维持 fail-open（与 v1–v7 advisory 同口径）。
      const st = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: ROOT });
      if (st.status === 0 && st.stdout) {
        entry.dirty = st.stdout.split(/\r?\n/)
          .map((l) => l.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, '').replace(/\\/g, '/'))
          .filter((p) => p && isProductPath(PROJECT_FACES, p, ['code', 'ui'])).sort();
      }
      // 脏树摘要（BACKLOG 34）：'' = 干净树 / 16 位 hex = 脏树 / 缺键 = 未知（git 不可用）——
      // 口径见 dirtyTreeDigest 头注；gen-verify-evidence 对非空摘要渲染「非干净树」标注。
      const dirtyTree = dirtyTreeDigest(ROOT);
      if (dirtyTree !== null) entry.dirtyTree = dirtyTree;
      const counts = parseCounts(outputs['test'] || '');
      if (counts) Object.assign(entry, counts);
      // 门禁成本入账（G8）：逐门毫秒 + 总耗时，metrics 消费。
      // totalMs = 各门之和（并发后已非墙钟，保留以续接历史口径）；wallMs = 本次实际墙钟（2026-10-16
      // 并行编排引入）——「一次迭代的等待成本」是墙钟，metrics 表以 wallMs 优先。
      entry.totalMs = Object.values(durations).reduce((a, b) => a + b, 0);
      entry.wallMs = Math.round(performance.now() - wallStart);
      entry.durations = durations;
      if (testCmd) entry.testCmd = true;
      // CI-only 本地跳过（verify-diet 二批 P0-2）：绿行记录跳过事实——审计面可对质「该行没跑哪些门、为何」。
      // secrets 执法者（2026-10-29 lite-fallback）：gitleaks 缺装机时门自动降级为纯 Node 兜底扫描（仍执法），
      // 不再是跳过——故不再落 envSkips（可作增量锚），改记 entry.secretsEnforcer='lite' 供审计对质；
      // 仅当输出里真的出现 loud-skip（旧脚本/人工包装）时才落 envSkips。
      const secretsOut = outputs['secrets-scan'] || '';
      const secretsLoudSkip = !envSkipIds.has('secrets-scan') && secretsOut.includes('loud-skip');
      if (envSkipIds.size || secretsLoudSkip) entry.envSkips = [...envSkipIds, ...(secretsLoudSkip ? ['secrets-scan'] : [])];
      if (!secretsLoudSkip && secretsOut.includes('执法者=lite')) entry.secretsEnforcer = 'lite';
      // scope 增量凭证标记（verify-diet ②）：gen-verify-evidence 渲染进摘要行，审计面可对质
      // 「该绿行跑了哪些门、基于哪个基线」；hasFreshVerifyLine 认其为合法关单凭证（口径见 verify-scope.mjs）。
      // **只在真裁掉门时打标记**（verify-scope-default 2026-10-22 修复）：变截面全触及 → 门表照跑全量，
      // 该行实质是全量绿。2026-10-29 锚语义放宽（backend-unit-tier）：带 scope 标记的行**本地台账侧**
      // 亦可作锚（单测档口径下面裁担保仍是传递链）；evidence 文件侧锚候选仍只认无标记行（parseEvidenceGreens）。
      if (scopeMode && scope && effSkipped.length) entry.scope = { mode: scopeMode, base: scope.baseShort, baseSource: scope.baseSource, skipped: effSkipped, fileCount: scope.fileCount };
      // 分层跑标记（2026-10-23）：diff 档 engine-tests 用 --fast——绿行记录，审计可对质。
      if (fastEngineTests) entry.fastTests = true;
      // 单测档标记（unitOnly，2026-10-29 backend-unit-tier）随档 1-B 退役：增量档 backend-test 已整体
      // 单边化 CI（本地不再有「只跑单测」的后端门），该字段若继续落账反而失真；无消费方读它
      // （policy.mjs hasFreshVerifyLine / gen-verify-evidence 均不消费），集成执法点照旧在 pre-push 与 CI 重档。
      if (process.env.PIPELINE_RUN_ID) entry.runId = process.env.PIPELINE_RUN_ID;
      // 引擎资产缺失（issue #73）：凭证不落宿主仓——loud 注记一轮一次，全绿轮由此处（最早到达点）
      // 打，失败轮已由失败行打过，后续摘要生成点静默。
      if (engineAssetsAbsent) {
        noteEngineAssetSkip();
      } else {
        fs.mkdirSync(path.join(ROOT, '.agents'), { recursive: true });
        fs.appendFileSync(path.join(ROOT, '.agents', 'verifications.jsonl'), `${JSON.stringify(entry)}\n`);
        console.log(t('[verify] 🧾 全绿凭证已落账 verifications.jsonl', '[verify] 🧾 all-green credential recorded in verifications.jsonl', ROOT));
      }
    } catch (e) {
      console.error(t(`[verify] ⚠️ 凭证落账失败: ${e.message}`, `[verify] ⚠️ failed to record credential: ${e.message}`, ROOT));
    }
    // 摘要事件原子化（2026-10-11 C4）：全绿事实与仓内摘要（workflow/verify-evidence.md——检查 23 收敛
    // 硬门自 convergenceHardSince 2026-10-12 起的读源）同刻生成，消除「本地台账已绿、committed 摘要滞后」
    // 的双真相分叉。仅生产全量模式（fixture 假门 / 引擎段增量门均不得产凭证）；生成失败响亮告警但不
    // 推翻绿裁决（同落账口径）。
    if (!testCmd) {
      const top3 = Object.entries(durations).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([id, ms]) => `${id}(${(ms / 1000).toFixed(1)}s)`).join(' ');
      const wallMs = entry ? entry.wallMs : Math.round(performance.now() - wallStart);
      const totalMs = entry ? entry.totalMs : Object.values(durations).reduce((a, b) => a + b, 0);
      // 成本预算（gate-budget 2026-10-22）：advisory——超限只告警不阻断；把「体感重」变成可对质的数字。
      // 预算档按「**实际裁掉了几门**」选，不按 --scope 开关选（2026-10-27 修正）：变截面全触及 /
      // 只触及非前端面时，--scope 仍会跑重活门（现役 backend-test；engine-tests 已随引擎测试面退役），
      // 实质是全量成本——此时拿增量档 scopeMs(120s) 去比会产出假超限告警（实测 129.5s 报「超 7.9%」，
      // 而全量档 240s 本就富余）。与绿行 scope 标记同口径：零裁剪即零标记。
      const skippedGateIds = effSkipped;
      const budget = readGateBudget(ROOT, skippedGateIds.length ? 'scopeMs' : 'fullMs');
      const over = budget !== null && wallMs > budget;
      const budgetNote = budget === null ? '' : t(`（预算 ${(budget / 1000).toFixed(0)}s${over ? `，超 ${((wallMs / budget - 1) * 100).toFixed(1)}%` : ''}）`, ` (budget ${(budget / 1000).toFixed(0)}s${over ? `, over by ${((wallMs / budget - 1) * 100).toFixed(1)}%` : ''})`, ROOT);
      console.log(t(`[verify] ⏱️ 门禁成本：墙钟 ${(wallMs / 1000).toFixed(1)}s${budgetNote}｜各门合计 ${(totalMs / 1000).toFixed(1)}s｜最慢三门 ${top3}`, `[verify] ⏱️ gate cost: wall clock ${(wallMs / 1000).toFixed(1)}s${budgetNote} | gate total ${(totalMs / 1000).toFixed(1)}s | slowest three ${top3}`, ROOT));
      if (over) {
        console.log(t('[verify] ⚠️ 门禁成本超预算——下一批须退役一门（一进一出；候选 flow-kit run agg-judgments.mjs --retire-candidates）', '[verify] ⚠️ gate cost over budget — retire one gate next batch (one in, one out; candidates: flow-kit run agg-judgments.mjs --retire-candidates)', ROOT));
      }
      // 引擎资产缺失（issue #73）：摘要生成（workflow/verify-evidence.md 落盘）同样不进宿主仓——
      // 注记已由更早到达的落账点打过（一轮一次），此处静默跳过。
      if (!engineAssetsAbsent) {
        const gen = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'gen-verify-evidence.mjs'), '--root', ROOT], { encoding: 'utf8' });
        if (gen.status === 0) {
          if (gen.stdout) process.stdout.write(String(gen.stdout).trimEnd() + '\n');
        } else {
          console.error(t(`[verify] ⚠️ 绿凭证摘要生成失败（${String(gen.stderr || gen.stdout || '').trim().slice(0, 200)}）——绿裁决不变，手动补跑 flow-kit run gen-verify-evidence.mjs`, `[verify] ⚠️ failed to generate the green-credential summary (${String(gen.stderr || gen.stdout || '').trim().slice(0, 200)}) — the green verdict stands; rerun manually: flow-kit run gen-verify-evidence.mjs`, ROOT));
        }
      }
    }
  }
  if (engineOnly) {
    console.log(t(`\n[verify] ✅ 引擎段 ${passedCount} 门全绿——增量门通过（非 22 门关单凭证，不落 all-gates 台账与摘要）`, `\n[verify] ✅ all ${passedCount} engine-section gates green — incremental gates passed (not a 22-gate closeout credential; no all-gates ledger row or summary written)`, ROOT));
  } else if (productOnly) {
    console.log(t(`\n[verify] ✅ 业务面 ${passedCount} 门全绿——分面凭证（非 22 门关单凭证，不落 all-gates 台账与摘要）`, `\n[verify] ✅ all ${passedCount} product-surface gates green — per-surface credential (not a 22-gate closeout credential; no all-gates ledger row or summary written)`, ROOT));
  } else if (midOnly) {
    console.log(t(`\n[verify] ✅ 中档 ${passedCount} 门全绿——业务面 + 后端单测（集成测试未跑；非 22 门关单凭证，不落 all-gates 台账与摘要）`, `\n[verify] ✅ all ${passedCount} mid-tier gates green — product surface + backend unit tests (integration tests not run; not a 22-gate closeout credential; no all-gates ledger row or summary written)`, ROOT));
  } else {
    console.log(t(`\n[verify] 🎉 全绿——可以关单（共 ${passedCount} 项通过）`, `\n[verify] 🎉 all green — ready to close (${passedCount} items passed)`, ROOT));
  }
}

run().catch(e => {
  console.error(t(`[verify] 💥 运行时崩溃: ${e.stack}`, `[verify] 💥 runtime crash: ${e.stack}`, ROOT));
  process.exit(1);
});
