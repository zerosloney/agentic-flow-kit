#!/usr/bin/env node
// verify.mjs — 统一静态门编排（2026-10-09 质量增强版；2026-10-09 守护者自守护批次）
// 用途：在关单或 CI 前一键过门——执行全部静态检查，逐项输出 pass/fail。
// 语义：单源口径。确保本地 run-verify 与 Azure Pipeline 行为 100% 一致。
// 凭证落账：全绿才落绿凭证；任一步红即落失败行，供根因分析。
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
// 用法：node .agents/scripts/verify.mjs [--full | --scope | --face <面> | --product | --mid] [--list] [--jobs N | --serial] [--help]
//   **档位口径（命令侧单源，2026-11-08 补记）**：--scope = diff 面增量档（判据同缺省档，单源
//     verify-scope.mjs）；--full = 显式全量；--scope 与 --full 互斥。命令侧档位口径以此头注为准。
//   --product = 业务面分档（cohort product + security），不落 all-gates 凭证。
//   --mid = CI 中档（PR→develop / develop 直推）：业务面同 --product，但 backend-test 仅跑单元测试
//       （--unit-only，不碰集成测试库）；不落 all-gates 凭证。三档口径见 §6.5（本地轻 / PR 中 / main 重）。
//   **产品门单边化 CI（2026-11-08 档 1 减重；2026-11-11 增代码四门）**：缺省档与 --scope / --face 增量档
//     不再执行产品 cohort 5 门（backend-build / backend-test / frontend-lint / frontend-unit-test /
//     frontend-build）＋代码四门（code-architecture / code-audit-fields / code-delete-guard /
//     code-notify-guard，审计 P2「--no-verify 远端兜底缺口」接入）——执法点单边移交
//     CI（--full / --mid / --product 三档与 azure-pipelines 一字不变）；secrets-scan、引擎段与
//     wiki-consistency 照跑。门表叙事锚恒 20（裸 --list），增量档裁剪在执行期与 --list --scope / --face
//     干跑可见（跳过说明行）。
//   --face <面> = 显式面覆盖（合法值 = verify-scope 面枚举 backend|frontend|docs，逗号多值）：不做工作区
//     脏路径自动面检测，直接按给定面裁门；与 --full 互斥（亦拒 --scope / 分档 / 夹具旗标）；跳过 24h 兜底
//     （显式面 = 操作者已判读）；绿行记 entry.face，face 绿行因 loud-skip ledger-invariant 不作增量锚。
//       node .agents/scripts/verify.mjs --stub-gate <cmd>   （仅 CHECK_LOOP_ROOT 夹具；走生产尾段，不打 testCmd）
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
//   --list：按执行序打印门 id 后退出（含 RUN_E2E=1 时的条件门），不执行；裸 --list 不参与裁剪（门表恒 20），
//     配 --scope / --face 干跑展示增量档裁剪结果（跳过说明行走 stderr，stdout 保持纯 id 可管道）。
//   --jobs / --serial：并发档位与串行回退（见上「编排」）。
// 沿革：verify-evidence（凭证落账）；2026-10-09 统一质量检查门禁 d009965（九门）；
//       guardian-selfcheck（修 :31 缺 =、GATES 加 scripts-syntax/engine-tests、
//       恢复 --test-cmd 夹具缝供 verify.test.mjs 断言）；
//       verify-parallel（串行编排 = 各门之和，本机 318s → 并发墙钟 ~130s；绿行加 wallMs）。
//       verify-diet（2026-10-21）：③backend-test --no-build 消双构建；①失败门输出留痕 tmp/ 并回显尾部；
//       ④前端关单门 vue-tsc 分离（TF_BUILD 下仍全量 build）；②--scope diff 面增量关单（口径单源 verify-scope.mjs）。
//       verify-diet 二批（2026-10-21 P0，owner 拍板）：⑤--scope 引擎自检面——engine-tests 引擎面触 = 全量、
//       业务面 = --fast（2026-10-23 改口径，不再整门跳过）；⑥ledger-invariant
//       全史扫描默认 CI-only（diff 面触及台账时本地回列；门表/--list 恒 20，绿行 envSkips 记录跳过事实）。
//       引擎减重档 1-B（2026-11-08）：增量档（缺省/--scope/--face）产品 5 门单边化 CI + --face 显式面覆盖。
//       引擎减重档 2-E（2026-11-08）：engine-artifacts 门「漂移即红」改「自动重生成后通过」——生成物是
//       磁盘态的确定函数，漂移原地重生成自愈（复检确认），失败才红；并行会话在途立档不再误伤关单 verify。

import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDiffScope, parseEvidenceGreens, EVIDENCE_REL, CI_UNILATERAL_GATE_IDS, PRODUCT_FACES } from './verify-scope.mjs';
import { classifyFailure } from './failure-attribution.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CHECK_LOOP_ROOT || path.resolve(SCRIPT_DIR, '..', '..');

// --- 门禁定义 ---
// 引擎段在前（2026-10-10）：语法与引擎测试仍最先；编排/预算/生效规则/闭环硬门/泳道接在其后。
// 产品段维持原相对顺序。遇红即停，但产品面的红不再挡在引擎段前面。
// --list 只打印 id 后退出，不执行。
const GATES = [
  // guardian（2026-10-16 并行编排）：本门未过则后序门一并不启动——引擎脚本不可解析时其余门无意义，
  // 且夹具根（CHECK_LOOP_ROOT 指向无脚本目录）下若并行铺开，16 门会在假根里乱跑（原 verify.test 场景 7 口径）。
  { id: 'scripts-syntax', cohort: 'engine', guardian: true, name: '引擎脚本语法自检', cmd: 'node .agents/scripts/check-scripts-syntax.mjs', folder: '.', type: 'shell' },
  { id: 'workflows-check', cohort: 'engine', name: '编排脚本检查', cmd: 'node .agents/scripts/workflows-check.mjs', folder: '.', type: 'shell' },
  { id: 'rule-budget', cohort: 'engine', name: '常驻面预算检查', cmd: 'node .agents/scripts/rule-budget.mjs --all', folder: '.', type: 'shell' },
  // 本地门禁挂载自检（2026-10-25 优化1，WARN 档）：判据与 check-local-gates.mjs ①-④ 对齐（单源，一边改
  // 另一边须跟）。默认 WARN 缺配只告警；CI（TF_BUILD）/非 git 根 loud-skip；升格 = cmd 加 --strict（owner 拍板）。
  { id: 'local-gate-config', cohort: 'engine', name: '本地门禁挂载自检（WARN 档）', cmd: 'node .agents/scripts/check-local-gate-config.mjs', folder: '.', type: 'shell' },
  // 生成物漂移单门（2026-10-28 引擎减重第三刀；2026-11-08 档 2-E 改自愈）：effective-policy / engine-map /
  // workflow-index 三门机制相同（跑生成器 --check 比对磁盘），合并为一次调用；漂移 → 原地重生成自愈后按
  // 通过计，重生成/复检失败才红（判据与自愈单源在 check-engine-artifacts.mjs，各档含 --full 同语义）。
  { id: 'engine-artifacts', cohort: 'engine', name: '生成物漂移检查（3 份）', cmd: 'node .agents/scripts/check-engine-artifacts.mjs', folder: '.', type: 'shell' },
  // 默认硬门。hygiene 段已于 2026-10-28 全部退役（只跑 hard 5 段）。
  { id: 'check-loop', cohort: 'engine', name: '闭环门禁校验', cmd: 'node .agents/scripts/check-loop.mjs', folder: '.', type: 'shell' },
  { id: 'ledger-doc-presence', cohort: 'engine', name: '台账指针存在性', cmd: 'node .agents/scripts/check-ledger-doc-presence.mjs', folder: '.', type: 'shell' },
  // 确认台账不变量（ledger-invariant-ci）：历史全扫挂进引擎段——此前该门自称 CI 机器门
  // 却从未进任何门表，71 处存量断档积累数月无人见（当日 DAG 感知重写 + HISTORY_BASELINE 声明后
  // 首次全绿，方具挂门条件）。pre-commit 仅 --staged 前缀面，全史审计由此门独担。
  // verify-diet 二批（2026-10-21 P0-2，owner 拍板）：本地关单不再重复付全史扫描（~37s）——TF_BUILD 外
  // 执行期 loud-skip（diff 面触台账即回列；门表/--list 恒 20，同 lane-surface-ci「本地跳过」先例）；全史审计由 CI 独担
  // （main 全量 verify 含本门；develop 最小 CI 面 secrets+check-loop 不含本门——2026-10-25 起），新违规仍被提交时刻 --staged 增量门当场拦。
  { id: 'ledger-invariant', cohort: 'engine', name: '确认台账不变量（历史全扫）', cmd: 'node .agents/scripts/check-ledger-invariant.mjs', folder: '.', type: 'shell' },
  // 泳道 diff 面（ai-native-review-p1）：CI（TF_BUILD/合并提交检出）按基准执法——产品契约面
  // 改动须 diff 内协伴 L2+ 入口；本地手跑无基准事实 → 脚本内 advisory 跳过（显式 --base origin/main 可预检）。
  { id: 'lane-surface-ci', cohort: 'engine', name: '泳道完整性（CI diff 面；本地无基准则跳过）', cmd: 'node .agents/scripts/check-lane-surface.mjs --ci', folder: '.', type: 'shell' },
  // 安全段（2026-10-14 决定 4 / G5 插队）：密钥扫描。
  // secrets-scan：gitleaks detect + 基线（.gitleaks-baseline.json，存量豁免清单，用户拍板——
  //   2026-10-15 扩 6 处权限Key 标识符，见 check-secrets.mjs 头注）；
  //   **2026-10-29 起恒执法**：gitleaks 三处解析皆缺（典型 = CI agent 装不上）→ 自动降级为纯 Node
  //   兜底扫描 check-secrets-lite.mjs（同一基线做文件级豁免），不再 loud-skip；输出首行标明执法者。
  //   需要缺二进制即红：SECRETS_SCAN_REQUIRE_GITLEAKS=1（check-secrets exit 2）。
  { id: 'secrets-scan', cohort: 'security', name: '密钥扫描（gitleaks 优先 / lite 兜底，+基线）', cmd: 'node .agents/scripts/check-secrets.mjs', folder: '.', type: 'shell' },
  // 依赖漏洞审计三门（nuget-audit / frontend-audit-prod / frontend-audit-devtool）2026-10-16 退役
  //   （owner 指令）：三者皆依赖公网漏洞服务（npm `/-/npm/v1/security/*`、NuGet 源索引的
  //   `VulnerabilityInfo`），内网镜像均不代理该面（实测见 runtime-env §6.4「漏洞数据源实测」），
  //   冷缓存/网络抖动即假红、换内网源即假绿——判据不可靠，故整族退出关单门表。
  //   退役留档：机制台账两行（NuGet 漏洞门 / 前端依赖审计）+ papercuts 2026-10-16 行。
  // —— 代码四门（2026-11-11 owner 拍板接入 product cohort；2026-11-10 审计 P2「--no-verify 远端兜底缺口」
  //    修复）：原 .agents/hooks pre-commit 专用四门（local-pre-commit.mjs 同批脚本，判据单源不变），
  //    随本表进 CI --mid/--full 执法；本地 pre-commit 保留为最早拦截点（.githooks/pre-commit 口径已同步）。
  //    四门 id 已入 verify-scope 的 CI_UNILATERAL_GATE_IDS——本地增量档单边化 CI。
  { id: 'code-architecture', cohort: 'product', name: '架构红线（Application 禁引 Infrastructure 等）', cmd: 'node .agents/hooks/check-architecture.mjs', folder: '.', type: 'shell' },
  // CI_PUSH_BEFORE 在场（azure-pipelines ci-push-before 步注入的 pipeline 变量）扫该区间新增行；
  // 缺省扫暂存区新增行——存量不拦（渐进收口语义与 pre-commit 一字不变）。
  { id: 'code-audit-fields', cohort: 'product',
    name: '审计字段守卫（禁手工写 Operator 等）',
    cmd: process.env.CI_PUSH_BEFORE ? `node .agents/hooks/check-audit-fields.mjs --range ${process.env.CI_PUSH_BEFORE}..HEAD` : 'node .agents/hooks/check-audit-fields.mjs',
    folder: '.', type: 'shell' },
  // 删除守卫默认即全仓面（Application/API 全目录计数比对 allowlist，非暂存面）——静态 cmd 零改接入。
  { id: 'code-delete-guard', cohort: 'product', name: '删除守卫（Remove/RemoveRange 须登记 allowlist）', cmd: 'node .agents/hooks/check-delete-guard.mjs', folder: '.', type: 'shell' },
  { id: 'code-notify-guard', cohort: 'product', name: '通知守卫（frontend 禁直调 antd message）', cmd: 'node .agents/hooks/check-notify-guard.mjs', folder: '.', type: 'shell' },
  { id: 'frontend-lint', cohort: 'product', name: '前端代码规范检查', cmd: 'npm run lint:check', folder: 'frontend', type: 'shell' },
  // 前端单测硬门（2026-10-09）：Vitest 纯 node 面零外部依赖，CI 可执法——
  // 补齐「后端 1426 用例 vs 前端 0」的验证面不对称（AI-Native 架构审查 P1-1）。
  { id: 'frontend-unit-test', cohort: 'product', name: '前端单测 (Vitest)', cmd: 'npm run test:unit', folder: 'frontend', type: 'shell' },
  { id: 'wiki-consistency', cohort: 'product', name: 'wiki 三方一致性', cmd: 'node .agents/scripts/verify-wiki-consistency.mjs', folder: '.', type: 'shell' },
  { id: 'backend-build', cohort: 'product', name: '后端编译', cmd: 'dotnet build Shipyard.Material.sln', folder: '.', type: 'shell' },
  // --no-build（verify-diet 2026-10-21 ③）：测试直接消费 backend-build 产物，消「build → test 内部再
  // 构建同一 sln」的双构建。deps 仍必需：--no-build 无产物即红，且保持依赖门序（依赖门红 → 本门不启动）。
  // 入口收敛（gate-diet #1' 2026-10-23）：dotnet test sln --no-build 单库串行
  // （TEST_DB_CONN=Deve_CSS_SuHao；2026-10-30 分区机制退役，owner 裁定「不要搞三分区」）。
  { id: 'backend-test', cohort: 'product', name: '后端自动化测试', cmd: 'node scripts/verify/backend/run-backend-tests.mjs', folder: '.', type: 'shell', deps: ['backend-build'] },
  // 前端关单门（verify-diet ④ 分离）：本地关单只执法类型检查——vite bundle 产物不进任何断言，
  // 对验证语义无贡献，完整构建留在 deploy 与 CI（TF_BUILD 时仍 npm run build 全量）。
  // 门 id/计数变更（--list 恒 20，2026-11-11 增代码四门；2026-10-25 local-gate-config 加入引擎段；2026-10-24 复核加三门）；s23 GATE_CMD 已同步收 vue-tsc。
  { id: 'frontend-build', cohort: 'product',
    name: process.env.TF_BUILD ? '前端构建 (含类型检查)' : '前端类型检查 (vue-tsc)',
    cmd: process.env.TF_BUILD ? 'npm run build' : 'npm run type-check',
    folder: 'frontend', type: 'shell' },
];

// diff 面 lint 降范围（2026-11-05，--scope 档只 lint 变更面文件）随 2026-11-08 档 1-B 单边化退役：
// frontend-lint 已整体移 CI，本地增量档不再出现该门（scopedLintCmd 与阈值常量一并移除）。

// 产品门单边化 CI 跳过说明（档 1-B）：增量档门清单上方恒打印一行（--list 走 stderr，保持 stdout 纯 id）。
const UNILATERAL_NOTE = `产品门单边化 CI（2026-11-08 档 1 减重；2026-11-11 增代码四门）：${[...CI_UNILATERAL_GATE_IDS].join('、')} 共 ${CI_UNILATERAL_GATE_IDS.size} 门本地增量档（缺省/--scope/--face）不执行——执法点移交 CI（--full/--mid/--product 档不变）`;

// fixture 夹具门（--test-cmd 注入时替换全部生产门——原 verify.test.mjs 1/2、2/2 断言依赖此口径，测试面已退役 2026-10-28）
// check-loop 用绝对路径直调真实脚本——夹具根里没有脚本本体，root 归属仍由 CHECK_LOOP_ROOT 裁决。
const fixtureGates = (cmd) => [
  { id: 'test', name: '测试步（注入）', cmd, folder: '.', type: 'shell' },
  { id: 'check-loop', name: '闭环门禁校验', cmd: `node "${path.join(SCRIPT_DIR, 'check-loop.mjs')}"`, folder: '.', type: 'shell' },
];

// E2E 冒烟条件门（2026-10-09）：RUN_E2E=1 才执法——前置是全栈在线
// （前端 5203 + API 8932 + SMOKE_ADMIN/SMOKE_ADMIN_PASSWORD 凭证），CI 未配全栈前不假装执法；
// 未启用时开跑前显式打印 loud-skip（跳过可见，与 fail-loud 对称）。
if (process.env.RUN_E2E === '1') {
  GATES.push({ id: 'frontend-e2e', cohort: 'product', name: '前端 E2E 冒烟 (Playwright)', cmd: 'npm run test:e2e', folder: 'frontend', type: 'shell' });
}

// Stack profile（agentic-flow-kit 通用化）：基础门表里的 product 门是 dotnet/Vue 专用。
// node/empty 装户只保留 engine + security + wiki 门；node 栈在 package.json 有 test 脚本时追加 npm test。
const STACK = (() => {
  try { return JSON.parse(fs.readFileSync('.agents/config/engine.json', 'utf8')).options?.stack || 'dotnet'; }
  catch { return 'dotnet'; }
})();
if (STACK !== 'dotnet') {
  for (let i = GATES.length - 1; i >= 0; i -= 1) {
    if (/^(backend-|frontend-|code-)/.test(GATES[i].id)) GATES.splice(i, 1);
  }
}
if (STACK === 'node') {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (pkg.scripts && pkg.scripts.test) {
      GATES.push({ id: 'node-test', cohort: 'product', name: 'Node tests', cmd: 'npm test', folder: '.', type: 'shell' });
    }
  } catch { /* not a node project root */ }
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

const recordFailure = (step, exitInfo, note, attribution) => {
  try {
    const entry = { ts: new Date().toISOString(), exitCode: typeof exitInfo === 'number' ? exitInfo : -1, suite: step, note };
    // 归因（gate-health 2026-10-22）：env / flaky / real——红单可读，AI 不在假红上反复重跑。
    // 存量豁免（2026-11-10）：此锚前的失败行与全部绿行（绿行无失败可归因，attribution 只标注失败，
    // 恒不落）可缺该字段——消费侧按未知处理，不回填不追溯（同 policy.mjs attributionSince 存量豁免纪律）。
    if (attribution) entry.attribution = attribution;
    if (process.env.PIPELINE_RUN_ID) entry.runId = process.env.PIPELINE_RUN_ID;
    fs.mkdirSync(path.join(ROOT, '.agents'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, '.agents', 'verifications.jsonl'), `${JSON.stringify(entry)}\n`);
    console.log(`[verify] 🧾 失败行已留痕 verifications.jsonl（suite=${step}${attribution ? `，归因 ${attribution}` : ''}）`);
  } catch (e) {
    console.error(`[verify] ⚠️ 失败行落账失败（${e.code || e.message}）`);
  }
};

// 门输出留痕（verify-diet 2026-10-21 ①）：失败门完整 stdout/stderr 落 tmp/verify-<id>.log 并回显
// 尾部 40 行——fail-fast 红从「只知道 exit 1」变为可当场定性（papercuts 2026-10-17 拟修①；
// 先例：后端门红无法区分已知负载偶发与新回归，只能盲跑复跑）。落盘失败不改裁决（同 recordFailure 容错）。
const persistGateLog = (gate, r) => {
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
    if (tail) console.error(`[verify] 🧾 门输出尾部 40 行（全文 ${path.relative(ROOT, p)}）：\n${tail}`);
    return p;
  } catch { return null; }
};

// --help 出口（2026-11-06）：只出用法——不读 git、不裁变更面、不落凭证、不跑门
function usageText() {
  return [
    '用法：node .agents/scripts/verify.mjs [档位] [选项]',
    '',
    '档位（缺省 = diff 面增量；最近 24h 无全量绿行时自动回落 --full 并打印 ⏭️ 兜底行）：',
    '  --full      全量门（关单凭证；引擎段 + 业务面 + 安全段）',
    '  --scope     diff 面增量（基线 = 最近全量绿行 headShort，回退 origin/main merge-base）',
    '  --face <面> 显式面覆盖增量档（backend|frontend|docs，逗号多值；与 --full/--scope 互斥；跳过 24h 兜底）',
    '  --product   业务面（product + security）',
    '  --mid       CI 中档（PR→develop / develop 直推）：业务面 + 后端只跑单测',
    '  --engine    仅引擎段自检',
    '',
    '增量档（缺省 / --scope / --face）产品门单边化 CI（2026-11-08 档 1 减重；2026-11-11 增代码四门）：',
    '  产品 9 门（backend-build/backend-test/frontend-lint/frontend-unit-test/frontend-build + 代码四门',
    '  code-architecture/code-audit-fields/code-delete-guard/code-notify-guard）由 CI 执法，本地不跑；',
    '  secrets-scan + 引擎段 + wiki-consistency 照跑。',
    '',
    '选项：',
    '  --list            只列本轮门 id（配 --verbose 出「id<TAB>命令」），不执行门',
    '  --help, -h        本帮助，立即退出',
    '  --jobs N          并发档位（缺省 clamp(2..4, cpus/4)）；--serial 回退串行',
    '  --verbose         --list 时附带每门命令',
    '  --test-cmd <cmd>  夹具：整表替换为单门（测试通道）',
    '  --stub-gate <cmd> 夹具：单门但走生产尾段（须配 CHECK_LOOP_ROOT）',
    '',
    '退出码：0 全绿 ｜ 1 有门失败（fail-fast，未跑门标「已中止」）｜ 2 参数或配置失守',
  ].join('\n');
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
      console.error(`[verify] ⚠️ 未知参数 ${argv[i]}（node .agents/scripts/verify.mjs --help 看用法）`);
    }
  }
  const ti = argv.indexOf('--test-cmd');
  const testCmd = ti >= 0 ? argv[ti + 1] : null;
  // --stub-gate（2026-10-15）：单门夹具但走生产尾段（落凭证 / 门禁成本 / gen-verify-evidence）。
  // 不打 testCmd 标记。必须配 CHECK_LOOP_ROOT，禁止在真实仓库写出可被当成关单凭证的绿行。
  const si = argv.indexOf('--stub-gate');
  const stubCmd = si >= 0 ? argv[si + 1] : null;
  if (si >= 0 && !stubCmd) {
    console.error('[verify] --stub-gate 需要一条命令');
    process.exit(2);
  }
  if (stubCmd && testCmd) {
    console.error('[verify] --stub-gate 与 --test-cmd 互斥');
    process.exit(2);
  }
  if (stubCmd && !process.env.CHECK_LOOP_ROOT) {
    console.error('[verify] --stub-gate 只允许配合 CHECK_LOOP_ROOT 夹具根（禁止在真实仓库落无关单凭证）');
    process.exit(2);
  }
  // --face（2026-11-08 档 1-B）：显式面覆盖——不做工作区脏路径自动面检测，直接按给定面裁门（增量档）。
  // 合法值单源 = verify-scope 面枚举（PRODUCT_FACES 的 face 字段，docs = 显式「无产品面」）；逗号多值。
  const fi = argv.indexOf('--face');
  const faceRaw = fi >= 0 ? argv[fi + 1] : null;
  let faceArg = null;
  if (fi >= 0) {
    const faces = String(faceRaw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const legal = PRODUCT_FACES.map((pf) => pf.face);
    const illegal = faces.filter((f) => !legal.includes(f));
    if (!faceRaw || !faces.length || illegal.length) {
      console.error(`[verify] --face 需要面清单（合法值：${legal.join('|')}；逗号多值）${illegal.length ? `；非法值：${illegal.join(',')}` : ''}`);
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
  // 副本，DB 回归留给 develop→main 的重档（全量 20 门）。同 --product 不落 all-gates 凭证：
  // 分档绿不是关单凭证（关单仍要本地全量）。
  const midOnly = argv.includes('--mid');
  const explicitScope = argv.includes('--scope');
  const explicitFull = argv.includes('--full');
  // 重档判定（2026-11-06 修复）：显式 `--full` 或默认档回落全量（24h 无绿行 / diff 面解析失败）——
  // 门禁链据此让 backend-test 跑含集成的全量；默认档/中档仍单测档（集成执法点 = pre-push --select-range + CI 重档）。
  let fullTier = explicitFull;
  const listOnly = argv.includes('--list');
  if (explicitScope && explicitFull) {
    console.error('[verify] --scope 与 --full 互斥');
    process.exit(2);
  }
  if (explicitScope && (testCmd || engineOnly)) {
    console.error('[verify] --scope 与 --test-cmd / --engine 互斥');
    process.exit(2);
  }
  if (productOnly && (engineOnly || explicitScope)) {
    console.error('[verify] --product 与 --engine / --scope 互斥（业务面全量分档，CI main 用）');
    process.exit(2);
  }
  if (midOnly && (engineOnly || productOnly || explicitScope)) {
    console.error('[verify] --mid 与 --engine / --product / --scope 互斥（业务面分档，CI 中档用）');
    process.exit(2);
  }
  if (faceArg && explicitFull) {
    console.error('[verify] --face 与 --full 互斥（显式面覆盖属增量档）');
    process.exit(2);
  }
  if (faceArg && (explicitScope || engineOnly || productOnly || midOnly || testCmd || stubCmd)) {
    console.error('[verify] --face 与 --scope / --engine / --product / --mid / 夹具旗标互斥（面来源与档位二选一）');
    process.exit(2);
  }
  // 默认档（verify-scope-default 2026-10-22，owner 拍板）：未显式 --full、且非夹具/非引擎段/非 --list →
  // 默认走 diff 面增量，`--full` 才全量。实测依据：一日 23 次全量、墙钟中位 234s ≈ 90 分钟纯等待，而
  // 绝大多数分支只动文档面；「默认便宜、全量显式」是把关单压到分钟级以下的唯一杠杆。
  // --list 不参与：门表恒 20 是叙事锚与对外契约，裁剪只在执行期生效。
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
        const why = lastFullTs ? `最近绿行 ${lastFullTs.slice(0, 16)}（已 ${(age / 3600000).toFixed(1)}h）` : '本地台账与仓库凭证均无绿行';
        console.log(`[verify] ⏭️ 24h 内无绿行（${why}）→ 本次全量执法（兜底）\n`);
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
      scope = computeDiffScope(git, ledgerBase, baseSourceHint);
    } catch (e) {
      // 显式 --scope 保持 fail-loud（拒增量）；默认档退回全量——默认档不该因基线缺失整体失败。
      if (explicitScope) {
        console.error(`[verify] --scope: ${e.message}`);
        process.exit(2);
      }
      console.log(`[verify] ⏭️ diff 面解析失败（${e.message}）→ 本次全量执法（兜底）\n`);
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
      console.log(`[verify] 🔀 face=${faceRaw}（显式指定，跳过变更面自动检测）：裁 ${effSkipped.length} 门（${effSkipped.join('、') || '无'}）\n`);
    } else {
      const faceNote = ['backend', 'frontend'].map((f) => `${f}:${scope.touched.has(f) ? '触' : '未触'}`).join(' ');
      const skipNote = `跳过 ${effSkipped.length} 门（${effSkipped.join('、')}）`;
      const baseWhy = scope.baseSource === 'ledger' ? '上次绿行'
        : scope.baseSource === 'evidence' ? '仓库凭证' : 'origin/main';
      console.log(`[verify] 🔀 scope=diff：基线 ${scope.baseShort}（${baseWhy}）｜变更面 ${scope.fileCount} 文件（${faceNote}）——${skipNote}\n`);
    }
  }
  // --engine（2026-10-11 C7 方案②）：只跑 cohort=engine 的引擎段门——原设计供 develop 增量 CI
  // （该 CI 步已随 2026-10-21 死步清理删除；--engine 保留本地/手动用法）。与全量的关键差异：
  // 全绿**不落 all-gates 绿行、不生成摘要**——增量段绿不是 20 门全量关单凭证，落了会被 hasFreshVerifyLine
  // 与 gen-verify-evidence 误认成全量绿（伪凭证）；失败行照记（suite=门 id，诊断用）。
  const skipSet = scope ? new Set(scope.skippedGateIds) : new Set();
  // CI-only 门（verify-diet 二批 2026-10-21 P0-2；2026-10-24 复核 P1 收紧）：ledger-invariant 全史扫描
  // 在 TF_BUILD 外默认 loud-skip，但 diff 面触及台账/修剪 manifest 时回列（verify-scope.ledgerTouched）
  // ——台账变更才付 ~90s，未触及仍跳过；全量档（无 scope）与 CI 照跑。绿行 envSkips 记录跳过事实。
  const CI_ONLY_GATE_IDS = new Set(['ledger-invariant']);
  const localLedgerSkip = !testCmd && !stubCmd && !process.env.TF_BUILD
    && !!scope && !scope.ledgerTouched;
  const envSkipIds = localLedgerSkip ? CI_ONLY_GATE_IDS : new Set();
  const gates = testCmd ? fixtureGates(testCmd)
    : stubCmd ? [{ id: 'stub', cohort: 'engine', name: '夹具单门', cmd: stubCmd, folder: '.', type: 'shell' }]
    : engineOnly ? GATES.filter((g) => g.cohort === 'engine')
    : productOnly ? GATES.filter((g) => g.cohort !== 'engine') // 业务面：product + security（CI main）
    // 中档（--mid）：业务面同 --product，唯一差异 = backend-test 只跑单元测试（不碰集成测试库）。
    // 门 id/名称不变，deps 边（backend-test ← backend-build）照旧成立。
    : midOnly ? GATES.filter((g) => g.cohort !== 'engine')
      .map((g) => (g.id === 'backend-test'
        ? { ...g, cmd: `${g.cmd} --unit-only`, name: '后端单元测试（不含集成测试）' }
        : g))
    // 重档（--full / 默认档回落，2026-11-06 修复）：全量 20 门，backend-test 不附 --unit-only（含集成）——
    // 直推 main 与 PR→main 的 CI 重档执法面（CI 已备 TEST_DB_ALLOW_DEV=1 逃生，见 azure-pipelines.yml）；
    // 本地默认档/中档仍单测档（集成在 pre-push --select-range / CI 重档）。
    // !scopeMode 兜住裸 --list：门表叙事锚恒 20（裁剪只在增量档执行期与 --list --scope/--face 生效）。
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
          return { ...g, env: { SECRETS_SCAN_BASE: ledgerBase }, name: '密钥扫描（gitleaks 增量+基线）' };
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
          console.error(`[verify] 门 ${g.id} 依赖 ${d} 不在本轮门清单——裁剪/表形态错误，拒绝运行`);
          process.exit(2);
        }
      }
    }
  }

  if (argv.includes('--list')) {
    if (testCmd) {
      console.error('[verify] --list 与 --test-cmd 互斥');
      process.exit(1);
    }
    // 干跑展示裁剪（档 1-B）：跳过说明走 stderr——stdout 保持纯 id，管道消费方不受影响。
    if (scopeMode) console.error(`[verify] ⏭️ ${UNILATERAL_NOTE}`);
    const verbose = argv.includes('--verbose');
    for (const g of gates) console.log(verbose ? `${g.id}\t${g.cmd}` : g.id);
    process.exit(0);
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
    console.error(`[verify] --jobs 须为正整数（现 ${argv[argv.indexOf('--jobs') + 1]}）`);
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
  console.log(`[verify] 🚀 开始全量静态门验证 (共 ${gates.length} 项，并发 ${JOBS}${serial ? '·串行' : ''})${testCmd ? '【fixture 模式】' : ''}${stubCmd ? '【stub 尾段】' : ''}${engineOnly ? '【引擎段增量门】' : ''}${productOnly ? '【业务面分档】' : ''}${midOnly ? '【中档：业务面+单测】' : ''}\n`);
  if (!testCmd && !stubCmd && process.env.RUN_E2E !== '1') {
    console.log('[verify] ⏭️  E2E 冒烟门未启用（RUN_E2E≠1）——前置为全栈在线（前端 5203 + API 8932 + SMOKE_ADMIN/SMOKE_ADMIN_PASSWORD）；启用方式：RUN_E2E=1 node .agents/scripts/verify.mjs\n');
  }

  let passedCount = 0;
  const outputs = {};
  // 逐门耗时埋点（2026-10-14 G8 门禁计时）：durations 随 all-gates 绿行入 verifications.jsonl，
  // metrics.md「门禁成本/迭代」表消费——G10（影响面裁剪）的判据数据源。
  const durations = {};
  let cohortSeen = '';
  const cohortLabel = { engine: '引擎段', security: '安全段', product: '产品段' };
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
      console.log(`[verify] —— ${cohortLabel[cohortSeen] || cohortSeen}（${n}）——`);
    }
    console.log(`[verify] ▶ ${i + 1}/${gates.length} ${gate.name}...`);
    const t0 = performance.now();
    const child = spawn(gate.cmd, { shell: true, cwd: path.join(ROOT, gate.folder), env: gate.env ? { ...process.env, ...gate.env } : process.env });
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
      console.log(`[verify] ⏭️ ${i + 1}/${gates.length} ${gate.name}：CI-only（TF_BUILD 外跳过——提交时刻 --staged 增量门已执法，全史扫描 CI 兜底）\n`);
      return false;
    }
    durations[gate.id] = r.durMs;
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (aborted.has(i)) {
      console.error(`[verify] ⏹ ${i + 1}/${gates.length} ${gate.name} 已中止（他门失败触发 fail-fast，状态未知）`);
      return false;
    }
    if (r.overflow) {
      console.error(`[verify] ❌ ${i + 1}/${gates.length} ${gate.name} 未通过（输出超 ${MAX_GATE_OUTPUT / 1024 / 1024}MB 上限，已中止）`);
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
      console.error(`[verify] ❌ ${i + 1}/${gates.length} ${gate.name} 未通过 (${note})｜归因 ${attribution}`);
      recordFailure(gate.id, r.status, note, attribution);
      return true;
    }
    // stdout+stderr 都留档（2026-10-29 secrets-incr）：loud-skip 类声明多走 stderr（check-secrets 用
    // console.error），只存 stdout 会让落账段的 envSkips 动态探测落空——锚点空洞堵不住。
    outputs[gate.id] = `${r.stdout || ''}\n${r.stderr || ''}`;
    console.log(`[verify] ✅ ${i + 1}/${gates.length} ${gate.name} 通过 [${r.durMs} ms]\n`);
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

  // 守卫段（guardian）：串行先跑、未过即止——后序门一并不启动
  for (let i = 0; i < gates.length && failedIdx < 0; i++) {
    if (!gates[i].guardian) continue;
    const p = runGate(i);
    gatePromise.set(i, p);
    if (finishGate(i, await p) && failedIdx < 0) failedIdx = i;
  }

  if (failedIdx < 0) {
    // 主体段：工作池并发（完成一个补一个）；任一门红 → 停排新门 + 树杀在跑门（fail-fast 语义保留）
    const bodyIdx = gates.map((_, i) => i).filter((i) => !gates[i].guardian);
    let cursor = 0;
    const worker = async () => {
      while (failedIdx < 0 && cursor < bodyIdx.length) {
        const i = bodyIdx[cursor++];
        const deps = gates[i].deps || [];
        if (deps.length) {
          const depResults = await Promise.all(deps.map((d) => gatePromise.get(idxOf.get(d)) ?? Promise.resolve(null)));
          if (failedIdx >= 0) return;
          if (depResults.some((r) => !r || r.status !== 0)) continue; // 依赖未过 → 本门不启动
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

  if (failedIdx >= 0) {
    // 未执行门清单（2026-10-11 D2；2026-10-16 并发编排后按「已出裁决」算）：fail-fast 后状态未知≠通过——
    // 验证系统输出须完备，与 E2E loud-skip 对称（否则「没跑」在台账里与「过了」不可区分）。
    const remaining = gates.map((g, i) => i).filter((i) => !doneIdx.has(i)).map((i) => gates[i].id);
    if (remaining.length) console.error(`[verify] ⏭️ 未执行门（fail-fast，状态未知）：${remaining.join('、')}`);
    process.exit(1);
  }

  // ---- 全绿尾段（任一门红已在上方 exit 1 返回，能走到这里即全绿）----
  // 引擎段增量门不落 all-gates 凭证（增量段绿 ≠ 20 门全量关单凭证）——台账/摘要双跳过；
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
      // backend/ frontend/ 脏路径——绿行之后新出现的业务改动使凭证过期（HEAD 判不出未提交改动）。
      // 只记路径列表（不记内容、不记哈希）：重跑 verify 即刷新；非 git 环境省略该键，
      // confirm-doc 对存量/缺字段绿行维持 fail-open（与 v1–v7 advisory 同口径）。
      const st = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: ROOT });
      if (st.status === 0 && st.stdout) {
        entry.dirty = st.stdout.split(/\r?\n/)
          .map((l) => l.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, '').replace(/\\/g, '/'))
          .filter((p) => /^(backend|frontend)\//.test(p)).sort();
      }
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
      fs.mkdirSync(path.join(ROOT, '.agents'), { recursive: true });
      fs.appendFileSync(path.join(ROOT, '.agents', 'verifications.jsonl'), `${JSON.stringify(entry)}\n`);
      console.log(`[verify] 🧾 全绿凭证已落账 verifications.jsonl`);
    } catch (e) {
      console.error(`[verify] ⚠️ 凭证落账失败: ${e.message}`);
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
      const budgetNote = budget === null ? '' : `（预算 ${(budget / 1000).toFixed(0)}s${over ? `，超 ${((wallMs / budget - 1) * 100).toFixed(1)}%` : ''}）`;
      console.log(`[verify] ⏱️ 门禁成本：墙钟 ${(wallMs / 1000).toFixed(1)}s${budgetNote}｜各门合计 ${(totalMs / 1000).toFixed(1)}s｜最慢三门 ${top3}`);
      if (over) {
        console.log('[verify] ⚠️ 门禁成本超预算——下一批须退役一门（一进一出；候选 node .agents/scripts/agg-judgments.mjs --retire-candidates）');
      }
      const gen = spawnSync(process.execPath, [path.join(SCRIPT_DIR, 'gen-verify-evidence.mjs'), '--root', ROOT], { encoding: 'utf8' });
      if (gen.status === 0) {
        if (gen.stdout) process.stdout.write(String(gen.stdout).trimEnd() + '\n');
      } else {
        console.error(`[verify] ⚠️ 绿凭证摘要生成失败（${String(gen.stderr || gen.stdout || '').trim().slice(0, 200)}）——绿裁决不变，手动补跑 node .agents/scripts/gen-verify-evidence.mjs`);
      }
    }
  }
  if (engineOnly) {
    console.log(`\n[verify] ✅ 引擎段 ${passedCount} 门全绿——增量门通过（非 20 门关单凭证，不落 all-gates 台账与摘要）`);
  } else if (productOnly) {
    console.log(`\n[verify] ✅ 业务面 ${passedCount} 门全绿——分面凭证（非 20 门关单凭证，不落 all-gates 台账与摘要）`);
  } else if (midOnly) {
    console.log(`\n[verify] ✅ 中档 ${passedCount} 门全绿——业务面 + 后端单测（集成测试未跑；非 20 门关单凭证，不落 all-gates 台账与摘要）`);
  } else {
    console.log(`\n[verify] 🎉 全绿——可以关单（共 ${passedCount} 项通过）`);
  }
}

run().catch(e => {
  console.error(`[verify] 💥 运行时崩溃: ${e.stack}`);
  process.exit(1);
});
