#!/usr/bin/env node
// level-criteria.mjs — 风险级别判定的**机器单源**（2026-10-13 flow-kit-route）
//
// 为什么有它：风险级别（L0-L3）此前只以**散文**形态存在于 `new-task.md`「级别判断」节——
// L2 四类触达面、L3 结构面、负例、自查句全都写给人读。后果有二：
//   ① 定级是纯自由心证，AI 每次判级都可能不同，门禁无从校验「判低」是否守约；
//   ② 想让 CLI 接管路由（`flow-kit route`），就没有可执行的判据可调，只能复读 md。
// 本文件把「**能被机器判定的部分**」从散文里抽出来做成单源，md 改为引用本文件而非承载判据。
//
// 分工（诚实声明——不是所有判据都能机器判定，别指望本文件替代判断力）：
//   机器可判：档位闭集与就高不就低、**路径级最低档提示**（level-hints.txt）、混档取高、自查句与负例的**输出**。
//   机器不可判：「一处定义、多处消费」是**语义**性质——同一条路径改了可能只是修文案、也可能是改编码权威。
//     因此本文件对语义面**只给判据清单与自查句，不产出断言**。缺 hints 配置时按 L1 起步并提示补配置，
//     绝不假装判得出。
//
// 路径提示清单（`.agents/level-hints.txt`，装户 owned）：`L3 <ERE>` / `L2 <ERE>` 每行一条，
//   命中即该改动**至少**是此档。缺文件或清单为空 = 纯语义定级（本文件全程静默，不阻断）。
//   语义参照 `lane-surfaces.txt`（那是「提交面」的触达判据，本文件是「意图面」的档位提示，两者不同档）。
import fs from 'node:fs';
import path from 'node:path';

export const LEVELS = ['L0', 'L1', 'L2', 'L3'];
export const HINTS_REL = '.agents/level-hints.txt';

// 档位语义（new-task.md 引用本段，不复述——单源纪律）
export const LEVEL_MEANING = {
  L0: '文档/样式微调（无行为影响）——直接 commit，豁免 intent',
  L1: '实现级改动（未命中 L2/L3）——快车道：轻量 intent/plan + 实现',
  L2: '规则/契约（一处改、多处依赖）——入口文档 + spec + plan 三件套',
  L3: '数据与运行时结构（schema / 迁移 SQL / DI 链 / 认证与中间件管线）——同 L2 + spec 新会话独立复核',
};

// L2 四类触达面（闭集，机器不判定语义，只作为判据清单输出给人与 AI）
export const L2_SURFACES = [
  '编码权威：一处生成、多处消费的编码/命名/取号规则（具体清单按项目 AGENTS.md）',
  '共享契约：跨模块共享的基类/DTO 形状、跨模块公共接口签名',
  '既有接口语义：既有参数或端点的行为变化（失效变生效、默认值或钳制口径改变）',
  '全局横切口径：错误响应出口、分页与校验口径、聚合投影键',
];

// L3 结构面
export const L3_SURFACES = [
  'schema / 数据模型定义',
  '迁移 SQL（schema 变更、数据修复）',
  'DI 链：注册、构造器依赖、组合根',
  '认证与中间件管线',
];

// 落 L1 的负例（判低红线：命中即不得定 L2/L3）
export const L1_NEGATIVES = [
  '纯页面表现 / 文案 / 布局 / 交互实现',
  '纯新增端点或参数，且既有行为不变',
  '单模块内部重构，且无对外契约变化',
];

// 自查句（人/AI 定级时的判定式，机器只输出不裁决）
export const SELF_CHECK = '能否列出 ≥2 个受影响的消费方（模块 / 端点 / 页面）？能 → 至少 L2。';

export function rankOf(level) {
  const i = LEVELS.indexOf(String(level || '').toUpperCase());
  return i < 0 ? null : i;
}

export function maxLevel(a, b) {
  const ra = rankOf(a), rb = rankOf(b);
  if (ra === null) return rb === null ? '' : String(b).toUpperCase();
  if (rb === null) return String(a).toUpperCase();
  return LEVELS[Math.max(ra, rb)];
}

// parseLevelHints：读 hints 清单。行格式 `L3 <ERE>`，ERE 为 grep -E 兼容正则，匹配仓库相对路径（/ 分隔）。
//   非法档位 / 语法错误的行 → fail-loud 抛错（防静默空洞：写错配置比没配置更危险——没配置会提示，写错会误判）。
// 三条收紧（2026-10-13 executor-review，全部来自实测复现，不是假想）：
//   ① **只收 L2 / L3**。本清单语义是「哪些路径一碰就至少是 L2/L3」，L0/L1 行不构成任何门槛——
//      而此前接受 L0 会被提交面判低门当真：`L0 ^docs/` 会让纯文档提交被硬拦，修法还让人
//      「升级至 L0 及以上」（L0 即最低档，荒谬）。写这种行的人本意多半是「这里是 L0 区」，
//      那正是不该登记的面——故按写错配置处理，fail-loud 点名。
//   ② **行内 `#` 注释 fail-loud**。ERE 取整行剩余部分（`(\S.*)$`），所以 `L3 ^a\.sql$  # 注释`
//      会把注释编进正则：若路径含 `$` 锚点，该条**永不命中**且无任何报错——路径下限与提交面兜底
//      同时静默失效，而 `--check` 还报「N 条有效」。这正是随包模板原先示例的写法（评审实测）。
//      注释请单独成行；确需匹配路径里的 `#` 写 `\#`。
//   ③ 档位大写归一：只接受 `L2` / `L3`（原正则 `L[0-3]` 已含大小写外的写法，见下）。
export function parseLevelHints(text) {
  const out = [];
  const errs = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = line.match(/^(L[0-3])\s+(\S.*)$/i);
    if (!m) { errs.push(`第 ${i + 1} 行：格式须为 \`L2 <ERE>\` 或 \`L3 <ERE>\`（实际「${line.slice(0, 40)}」）`); return; }
    const level = m[1].toUpperCase();
    const re = m[2];
    if (level !== 'L2' && level !== 'L3') {
      errs.push(`第 ${i + 1} 行：档位只能是 L2 或 L3（实际 ${level}）——本清单只登记「一碰就至少是中/高风险面」的路径下限；`
        + `L0/L1 不构成门槛，登记了只会让提交面判低门对无关改动出手。若本意是「这里是低风险区」，那就不该登记`);
      return;
    }
    // 行内注释检测：空白后的未转义 #。ERE 里的 `#` 若被转义（\#）或前面不是空白（形如 `^src/#old/`）则放行。
    const inline = /(^|\s)#/.exec(re);
    if (inline) {
      errs.push(`第 ${i + 1} 行：ERE 与行内注释不得同一行（实际「${line.slice(0, 40)}」）——注释会被编进正则，`
        + `若含 $ 锚点则该条永不命中且无任何报错；请把注释放到上一行单独成行（确需匹配路径里的 # 请写 \\#）`);
      return;
    }
    try {
      out.push({ level, re, rx: new RegExp(re), source: line });
    } catch (e) {
      errs.push(`第 ${i + 1} 行：正则语法错误（${e.message}）`);
    }
  });
  if (errs.length) {
    const e = new Error(`${HINTS_REL} 配置有误：\n  - ${errs.join('\n  - ')}`);
    e.code = 'LEVEL_HINTS_INVALID';
    throw e;
  }
  return out;
}

export function loadLevelHints(root = process.cwd()) {
  const p = path.join(root, ...HINTS_REL.split('/'));
  if (!fs.existsSync(p)) return { hints: [], missing: true };
  return { hints: parseLevelHints(fs.readFileSync(p, 'utf8')), missing: false };
}

// hintLevelFor：路径命中的**最低档**提示（多条命中取最高）。无命中返回 ''。
export function hintLevelFor(hints, files) {
  let hit = '';
  const hitRe = [];
  for (const f of files || []) {
    const norm = String(f).replace(/\\/g, '/').replace(/^\.\//, '');
    for (const h of hints) {
      if (h.rx.test(norm)) { hit = maxLevel(hit, h.level); hitRe.push(`${h.level}←${norm}`); }
    }
  }
  return { level: hit, matched: [...new Set(hitRe)] };
}

// assessLevel：定级判定面。输入 = 改动文件 + 调用方给的建议档；输出 = 机器可判的部分。
//   语义面（是否「一处定义多处消费」）**不由本函数裁决**——它只保证：hints 提示档是下限、混档取高。
export function assessLevel(root, { files = [], proposed = '' } = {}) {
  const { hints, missing } = loadLevelHints(root);
  const { level: hintLevel, matched } = hintLevelFor(hints, files);
  const finalLevel = maxLevel(hintLevel, proposed);
  return {
    level: finalLevel,
    hintLevel,
    matched,
    proposed: proposed ? String(proposed).toUpperCase() : '',
    hintsConfigured: !missing && hints.length > 0,
    // 调用方给的建议档若低于 hint 下限 → 提示；不硬拦（判级纪律仍由 lane-surface 触达面门在提交面兜）
    underHint: !!(hintLevel && rankOf(proposed) !== null && rankOf(proposed) < rankOf(hintLevel)),
  };
}

// routeAdvice：给人/AI 的**判据面**文本（route 命令直接输出这份）。
//   2026-10-13 executor-review：原先这里还兼报「hints 未配置」「建议档低于下限」两条**状态**信息，
//   而 route 的降级块（executor.mjs degradations）讲的是同一件事 → 文本模式把同一事实打了两遍。
//   口径：**判据归本函数、状态归降级块**，单一出口。故 ctx（原 hintsConfigured / underHint /
//   hintLevel / matched）保留在签名里仅为兼容既有调用方，本函数不再读取——故参数名带下划线前缀。
export function routeAdvice(level, _ctx = {}) {
  const L = String(level || 'L1').toUpperCase();
  const lines = [];
  lines.push(`建议级别：${L} —— ${LEVEL_MEANING[L] || '（未知档）'}`);
  if (L === 'L2' || L === 'L3') {
    lines.push('');
    lines.push(`【L2 触达面 · 闭集，逐条判】`);
    for (const s of L2_SURFACES) lines.push(`  · ${s}`);
  }
  if (L === 'L3') {
    lines.push('');
    lines.push(`【L3 结构面】`);
    for (const s of L3_SURFACES) lines.push(`  · ${s}`);
  }
  if (L === 'L1' || L === 'L0') {
    lines.push('');
    lines.push(`【负例 · 命中即不得升 L2/L3】`);
    for (const s of L1_NEGATIVES) lines.push(`  · ${s}`);
  }
  lines.push('');
  lines.push(`【自查句】${SELF_CHECK}`);
  lines.push('提示：级别是**意图面**的语义判定（「一处定义、多处消费」），机器只兜「就高不就低」与路径下限。');
  return lines.join('\n');
}

// ---- 体检入口（2026-10-13 hint-doctor）------------------------------------
// 为什么需要：非法 hints 此前只在**跑 flow-kit route 时**才抛 LEVEL_HINTS_INVALID，而 route 是
//   可选调用 → 写错的清单能静默存活很久，直到某天有人碰巧路由一次才炸。写错配置比没配置危险
//   （没配置会提示补，写错会误判），故给 doctor 一条**主动体检**通道。
// 口径纪律：doctor 不自己复刻解析器（复刻=判据双源漂移），改为 spawn 本文件执行本节——
//   解析逻辑永远只有 parseLevelHints 一份。
//   用法：node level-criteria.mjs --check <清单路径>
//   退出码：0 通过（含文件缺失/空清单＝未启用）；1 配置有误（stderr 出逐行原因）。无参数 → 退出 2。
export function checkHintsFile(file) {
  if (!fs.existsSync(file)) return { configured: false, entries: 0, note: '文件不存在（默认空＝纯语义定级）' };
  const text = fs.readFileSync(file, 'utf8');
  let hints;
  try {
    hints = parseLevelHints(text);
  } catch (e) {
    return { configured: true, ok: false, entries: 0, error: e.message, code: e.code || 'LEVEL_HINTS_INVALID' };
  }
  return {
    configured: true,
    ok: true,
    entries: hints.length,
    levels: [...new Set(hints.map((h) => h.level))].sort(),
  };
}

// CLI 自运行守卫：仅当本文件被直接执行时进入体检模式（被 import 时不跑——库用法不受影响）
if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'level-criteria.mjs'))) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--check');
  if (at >= 0) {
    const file = argv[at + 1];
    if (!file || argv[at + 1].startsWith('--')) {
      console.error('用法：node level-criteria.mjs --check <level-hints.txt 路径>');
      process.exit(2);
    }
    const r = checkHintsFile(path.resolve(file));
    if (r.ok === false) {
      console.error(`[level-hints 配置有误] ${file}\n${String(r.error).split('\n').map((l) => `  ${l}`).join('\n')}`);
      console.error('  修法：按 `<档位> <ERE>` 格式修正（档位 ∈ L0-L3，ERE 为 grep -E 兼容正则）——'
        + '写错配置比没配置危险：没配置会提示补配置，写错会误判档位');
      process.exit(1);
    }
    console.log(r.configured
      ? `level-hints：${r.entries} 条有效（${(r.levels || []).join('/') || '—'}）`
      : `level-hints：未配置（${r.note}）`);
    process.exit(0);
  }
}