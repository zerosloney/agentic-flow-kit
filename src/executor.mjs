// flow-kit route / run —— 手动路由与自动流水线（2026-10-13 flow-kit-route）
//
// 这是引擎从「骨架」到「执行器」的两条新命令。分工（硬约定）：
//   **代码留在装户 .agents/scripts/**，包 CLI 只做**薄壳转发与判定面**——执行体不搬家（决策 A）。
//   **md 指令与 md 子代理仍装在装户**（.agents/commands、.agents/roles、modules/hosts）：宿主读它们，
//   包 CLI 不复制、不改写、不解释它们的正文。
//
// ── route（手动路由的机器面）──────────────────────────────────────────
// 此前定级只以散文存在于 .agents/commands/new-task.md；AI 每次判级都可能不同，门禁无从校验判低守约。
// 本命令把「能被机器判定的部分」抽出来（判据单源 = .agents/scripts/level-criteria.mjs），
// 给出：建议档位 + 判据清单 + 下一阶段 + 该读的 md 指令路径。
// **诚实边界**：级别是**意图面**的语义判定（「一处定义、多处消费」），机器判不了语义——本命令只兜
//   「就高不就低」与「路径下限」（.agents/level-hints.txt，装户自持、内容项目私有）。
//   未配置 hints 时按 L1 起步并提示补配置，**绝不假装判得出**。
//
// ── run（自动流水线薄壳）─────────────────────────────────────────────
// 直接转发装户的 pipeline-run 状态机（start/next/status/watch/abort），不复制其逻辑：
//   状态机唯一实现在 .agents/scripts/pipeline-run.mjs，工单协议与人件门语义见 .agents/commands/pipeline-run.md。
//   薄壳只做：定位装户脚本 → 透传参数与退出码。**绝不 spawn AI 会话、永不伪造原话、永不带 --no-verify**。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const AGENT_SCRIPTS_REL = '.agents/scripts';

function parseArgs(args) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      // `--k=v` 与 `--k v` 等价（--dir=<path> 这类写法必须能解析，否则寻址参数被静默忽略）
      const eq = a.indexOf('=');
      if (eq > 2) { o[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const k = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) o[k] = true;
      else { o[k] = next; i++; }
    } else o._.push(a);
  }
  return o;
}

function resolveTarget(o) {
  return path.resolve(typeof o.dir === 'string' ? o.dir : process.cwd());
}

function fail(msg, code = 1) { console.error('❌ ' + msg); process.exit(code); }

// 装户脚本存在性判定（薄壳不做「自动 sync 装一遍」——那会静默改用户盘面，fail-loud 指向处置动作）
function requireInstalledScript(target, rel) {
  const abs = path.join(target, ...rel.split('/'));
  if (!fs.existsSync(abs)) {
    fail(`未找到 ${rel}——当前目录不是已安装 flow-kit 的项目，或安装被部分清理。\n   处置：cd 到项目根，或执行 flow-kit init / flow-kit sync 补齐。`);
  }
  return abs;
}

// 读装户权威路由表（B5，2026-10-13）：`new-task.md` §3 有一行机器可读注释
//   <!-- route-kinds: require=plan.md | fix=maintain.md | ... -->
// 包 CLI **不再自带一份映射**——此前 STAGE_ENTRY 硬编码在包里，装户改入口文件名而不动包，
// route 就会把 AI 指向一个不存在的 md（双源漂移）。权威表就在宿主 AI 也在读的 md 里，一处即两处用。
//   读不到 → 回落到包内 DEFAULT_ROUTE_TABLE 并登记降级（老版本装户无该行，不静默假装取到单源）。
const DEFAULT_ROUTE_TABLE = {
  require: 'plan.md', fix: 'maintain.md', verify: 'test.md',
  review: 'review.md', deploy: 'deploy.md',
};
const ROUTE_TABLE_LINE = /<!--\s*route-kinds:\s*([^>]*?)-->/;

// route-kinds 行的**唯一解析器**——两个消费方共用：装户面 loadRouteTable（判定该读哪个 md）与
//   包源 help 的 routeKindList（列 kind 值域）。此前 help 自带第二份 kind 列表，装户改 kind 时
//   help 与判定面会漂移（与 GATE_LIST 同纪律：列表一律从权威面派生，不手写第二份）。
function parseRouteTable(mdAbs) {
  const m = fs.readFileSync(mdAbs, 'utf8').match(ROUTE_TABLE_LINE);
  const table = {};
  for (const part of String(m ? m[1] : '').split('|')) {
    const kv = part.trim().match(/^([a-z]+)\s*=\s*([\w.-]+\.md)$/);
    if (kv) table[kv[1]] = kv[2];
  }
  if (!Object.keys(table).length) throw new Error('route-kinds 行未解析出任何 kind');
  return table;
}

function loadRouteTable(target, degradations) {
  const p = path.join(target, '.agents', 'commands', 'new-task.md');
  try {
    return { table: parseRouteTable(p), source: 'new-task.md' };
  } catch (e) {
    degradations.push({ code: 'route-table-fallback', detail: `读不到装户 .agents/commands/new-task.md 的 route-kinds 机器单源（${String(e?.message || e).split('\n')[0]}）——kind→入口回落包内默认表，装户升级 flow-kit sync 后生效` });
    return { table: { ...DEFAULT_ROUTE_TABLE }, source: 'fallback' };
  }
}

// 包源 help 的 kind 值域：读包源权威 md（templates/_agents/commands/new-task.md）的 route-kinds 行，
//   与装户面 loadRouteTable 共用同一解析器。读不到（包源缺该行/文件）回落包内默认表，不阻断 help。
export function routeKindList(pkgRoot) {
  try {
    return Object.keys(parseRouteTable(path.join(pkgRoot, 'templates', '_agents', 'commands', 'new-task.md')));
  } catch {
    return Object.keys(DEFAULT_ROUTE_TABLE);
  }
}

// laneOfDoc：调装户 stage-gates.mjs 的单源泳道取法。返回 { key, source, reason }
//   source='stage-gates.mjs' → 真取到单源；source='fallback' → 装户缺该脚本或取不到，按档位直接回落
//   （fail-soft，不阻断路由）。**reason 区分「文件不存在」与「存在但 import 失败」**（2026-10-13
//   executor-review）——两者曾被合并成一句「缺失」，实测把「装户脚本依赖缺失导致 import 报错」诊断成
//   「未安装」，排障方向直接被带偏。
async function laneOfDoc(target, level) {
  const p = path.join(target, ...`${AGENT_SCRIPTS_REL}/stage-gates.mjs`.split('/'));
  if (!fs.existsSync(p)) {
    return { key: fallbackLane(level), source: 'fallback', reason: '装户 .agents/scripts/stage-gates.mjs 不存在（未安装或版本更早）' };
  }
  try {
    const mod = await import(pathToFileURL(p).href);
    if (typeof mod.laneOfDoc === 'function') {
      const got = mod.laneOfDoc(level);
      if (got === 'low' || got === 'high' || got === 'suspect') return { key: got, source: 'stage-gates.mjs', reason: '' };
      return { key: fallbackLane(level), source: 'fallback', reason: `装户 stage-gates.mjs 未返回合法泳道值（返回 ${JSON.stringify(got)}）` };
    }
    return { key: fallbackLane(level), source: 'fallback', reason: '装户 stage-gates.mjs 未导出 laneOfDoc（版本不匹配）' };
  } catch (e) {
    // 注意：这里必须把真实原因带出去——「脚本在但装不起来」与「脚本不在」是两回事。
    const why = String(e?.message || e).split('\n')[0];
    return { key: fallbackLane(level), source: 'fallback', reason: `装户 stage-gates.mjs 存在但 import 失败：${why}` };
  }
}

const fallbackLane = (level) => ((rankOfLevel(level)) >= 2 ? 'high' : 'low');
const rankOfLevel = (level) => ({ L0: 0, L1: 1, L2: 2, L3: 3 }[String(level || '').toUpperCase()] ?? 0);

export async function route(args) {
  const o = parseArgs(args);
  const target = resolveTarget(o);
  const scriptsDir = path.join(target, ...AGENT_SCRIPTS_REL.split('/'));
  // 降级可见通道（2026-10-13 degradation-channel）：此前同一命令里混用四种「缺失」策略——
  //   判据单源缺 → fail-loud；stage-gates 缺 → 静默回落泳道；enums 缺 → 静默用自带表；
  //   hints 缺 → 静默按 L1 起步。**只有 laneSource 一个字段对外可见**，--json 消费方拿到的是同一份静默。
  // 口径：fail-loud 的判据单源缺失仍在最前面（改配置比没配置危险），此后**所有软回落一律登记进
  //   degradations**，文本与 --json 走同一个通道——降级必须可见，但不因此阻断定级（路由不该因为
  //   词表缺失整个挂掉）。
  const degradations = [];

  // 判据单源在装户面（随模板下发、随 sync 升级）——包不复制判据，避免双源漂移
  const critPath = path.join(scriptsDir, 'level-criteria.mjs');
  if (!fs.existsSync(critPath)) {
    fail(`未找到 .agents/scripts/level-criteria.mjs（级别判据单源）。\n   该文件随 1.7.15+ 下发；若你的项目更早，执行 flow-kit sync 升级。`);
  }
  const crit = await import(pathToFileURL(critPath).href);

  // 枚举单源（模块值域 / kind 集合）：同样在装户面
  let levelList = crit.LEVELS;
  let modules = [];
  try {
    const enumsMod = await import(pathToFileURL(path.join(scriptsDir, 'workflow-enums.mjs')).href);
    const enums = enumsMod.loadEnums(path.join(scriptsDir, '..', 'workflow-enums.txt'));
    if (Array.isArray(enums['level.all']) && enums['level.all'].length) levelList = enums['level.all'];
    else degradations.push({ code: 'enums-missing-key', detail: '.agents/workflow-enums.txt 无 level.all 键——档位值域回落判据单源自带表' });
  } catch (e) {
    degradations.push({ code: 'enums-fallback', detail: `读不到 .agents/workflow-enums.txt（${String(e?.message || e).split('\n')[0]}）——档位值域回落判据单源自带表，不阻断定级` });
  }
  const modFile = path.join(target, '.agents', 'workflow-modules.txt');
  if (fs.existsSync(modFile)) {
    modules = fs.readFileSync(modFile, 'utf8').split(/\r?\n/)
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  }

  // 路由表从装户权威 md 读（B5）：kind 闭集随之以装户为准，包内不再硬编码 kind 列表
  const route = loadRouteTable(target, degradations);
  const kind = typeof o.kind === 'string' ? o.kind : '';
  if (kind && !Object.keys(route.table).includes(kind)) {
    fail(`--kind 须为 ${Object.keys(route.table).join('|')}（实际「${kind}」，值域读自 ${route.source}）`);
  }

  const files = typeof o.files === 'string'
    ? o.files.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    : [];
  const proposed = typeof o.level === 'string' ? o.level.toUpperCase() : '';
  if (proposed && !levelList.includes(proposed)) {
    fail(`--level 须为 ${levelList.join('|')}（实际「${proposed}」）`);
  }

  const a = crit.assessLevel(target, { files, proposed });
  const level = a.level || 'L1';
  // 泳道取法沿装户 stage-gates 单源（laneOfDoc：级别单字段协议），不在本文件复刻 low/high 口径。
  //   装户无 stage-gates.mjs（老版本未升级）→ fail-soft 回退默认（判 L2/L3 → high），并登记降级。
  const laneKey = await laneOfDoc(target, level);
  if (laneKey.source === 'fallback') {
    degradations.push({ code: 'lane-source-fallback', detail: `${laneKey.reason || '装户 .agents/scripts/stage-gates.mjs 缺失或 laneOfDoc 不可用'}——泳道按档位回落判定（建议 flow-kit sync 升级）` });
  }
  if (a.hintsConfigured === false) {
    degradations.push({ code: 'level-hints-empty', detail: `.agents/level-hints.txt 未配置（缺失或为空）→ 机器面给不出档位提示，本次按 ${level} 起步；该清单登记「哪些路径一碰就至少是 L2/L3」（项目私有，只收 L2/L3 两档）` });
  }
  if (a.underHint) {
    degradations.push({ code: 'under-hint-proposed', detail: `建议档 ${a.proposed} 低于路径提示下限 ${a.hintLevel}（命中：${(a.matched || []).slice(0, 4).join('、')}）——已按就高不就低取 ${a.hintLevel}，建议复核` });
  }
  const lane = laneKey.key === 'high' ? '防御道（同步确认门）' : '协作道（快车道）';
  const entry = route.table[kind] || route.table.require;

  if (o.json) {
    console.log(JSON.stringify({
      level, lane, laneKey: laneKey.key, laneSource: laneKey.source, kind: kind || '(未定)',
      files, proposed: a.proposed, hintLevel: a.hintLevel, matched: a.matched,
      underHint: a.underHint, hintsConfigured: a.hintsConfigured,
      // 路由表来源（B5）：'new-task.md' = 真取到装户机器单源；'fallback' = 包内兜底表（已登记降级）
      routeTableSource: route.source,
      // 降级统一出口（消费方判「这次路由是否在降级态」只需看这一个字段，不必逐个猜 source 字段）
      degraded: degradations.length > 0, degradations,
      nextStage: entry, nextCommand: `.agents/commands/${entry}`,
      modules,
    }, null, 2));
    return;
  }

  console.log(`flow-kit route — 手动路由判定（机器面）\n`);
  console.log(crit.routeAdvice(level, a));
  console.log('');
  console.log(`泳道：${lane}`);
  if (kind) console.log(`入口指令：.agents/commands/${entry}（kind=${kind}）`);
  else console.log(`入口指令：未定 —— 先判 kind（require 新需求 / fix 修复 / verify 验证 / review 评审 / deploy 上线）`);
  console.log(`  new-task 阶段索引：.agents/commands/new-task.md`);
  if (degradations.length) {
    console.log('');
    console.log(`⚠️ 降级运行（${degradations.length} 项——机器面能给的部分比完整态少，逐条点名）：`);
    for (const d of degradations) console.log(`  · [${d.code}] ${d.detail}`);
  }
  console.log('');
  console.log('本命令只给机器可判的部分。**定级仍需语义判断**——按上面自查句逐条判；');
  console.log('不确定就高不就低。要走全自动六阶段闭环另用：flow-kit run start "<需求>"');
}

// 薄壳自有参数：这些是包 CLI 的选项，**不**透传给装户状态机（状态机有自己的参数协议）
const SHELL_ONLY_KEYS = new Set(['dir']);

export function runPipeline(args) {
  const o = parseArgs(args);
  const sub = o._[0];
  // 用法校验先于脚本存在性校验：先告诉用户「怎么用」，再谈装没装（反过来会拿安装问题盖住用法）
  if (!sub) {
    fail('用法：flow-kit run <start|next|status|watch|abort> [...]\n' +
         '   驱动协议与停机点语义见 .agents/commands/pipeline-run.md（该文件是宿主面权威，本命令只透传）。');
  }
  const target = resolveTarget(o);
  const script = requireInstalledScript(target, `${AGENT_SCRIPTS_REL}/pipeline-run.mjs`);
  // 透传 = 用户给的参数原样交给装户状态机，但**剔除薄壳自有参数**（--dir 是包面寻址，不是状态机参数）
  const passthrough = [];
  for (let i = args.indexOf(sub) + 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.slice(2).split('=')[0];
      if (SHELL_ONLY_KEYS.has(k)) {
        if (!a.includes('=') && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) i++;
        continue;
      }
    }
    passthrough.push(a);
  }
  const r = spawnSync(process.execPath, [script, sub, ...passthrough], {
    cwd: target, stdio: 'inherit', windowsHide: true,
  });
  process.exit(r.status ?? 1);
}