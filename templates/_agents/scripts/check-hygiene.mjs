// check-hygiene.mjs — check-loop 卫生类检查模块（2026-10-08 selfmeasure-and-modularize，L2）
// 承载 check-loop.mjs 的检查 2 / 9 / 11 / 12 / 13（拆分先例 = check-metric-claims.mjs 承载检查 16）：
//   2. 模板字段占位符残留            [warning]
//   9. 文件名英文 kebab-case          [warning]
//  11. 生成物漂移（INDEX + DASHBOARD）[warning]  ← 本次扩 DASHBOARD（原仅 INDEX）
//  12. frontmatter「模块:」合法性      [warning]
//  13. 常驻面体积预算                 [warning]
//
// 为什么是这五个：它们无跨检查共享状态——判据只依赖 ctx 里既有的 helper（docFiles / linesOf / fmGet /
// isTracked / readdirOrNull）与 policy，不消费其他检查的中间产物。耦合高的检查 1/5（共享文档循环）、
// 8（证据核验）、15（指纹对账）留后续批次，拆它们需先解耦，不与本批混（2026-10-08-checkloop-importable
// 教训：1600+ 行变换与行为修复混批 diff 巨大且不可审）。
//
// **判定零复刻铁律**：ctx 里每个 helper 都从 check-loop.mjs 原样传入，模块内**不得**重新实现
// docFiles / fmGet / linesOf / isTracked——它们各自承载不可漂移的语义（docFiles 的「仓库模式只扫
// tracked(HEAD)」、fmGet 的 frontmatter 受限子集、linesOf 的读异常响亮出账 + 按空文档降级）。复刻即造口径分叉。
//
// 输出契约：本模块**只返回文案数组**，不打印、不 exit、不改 ctx。调用方 `warnings.push(...ret)`——
// check-loop 在 `audit:false`（init 新装）下把 `warnings.push` 替换为 no-op，卫生项因此不出账（硬规则语义保持）。
// 检查 11 的生成器 `--check` 口径同样不复刻（调子进程，判据单源在生成器内）。
//
// 测试：node templates/_agents/scripts/check-hygiene.test.mjs（fixture root 注入，不触真实 workflow/）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gateSeg, finishSegs, makeCollector, appendSegs } from './gate-seg.mjs';

// 门禁 ROI 插桩（2026-10-08 gate-roi-metrics）：本模块承载的检查 2/9/11/12/13 同样需要计入门禁成本
// 统计——尤其检查 11（调两个生成器 --check 的 spawn 子进程）与检查 13（调 sh rule-budget.sh）是耗时大户，
// 不插桩就等于把最贵的两段排除在度量之外。collector 由 check-loop 传入（它持有全局 warnings/blockers），
// 未传时跳过插桩（纯函数直测场景零副作用）。判据单源见 gate-seg.mjs。

export function runCheckHygiene(ctx) {
  const { root: ROOT, WF, DOC_DIRS, docFiles, linesOf, fmGet, isTracked, readdirOrNull, kitPolicy } = ctx;
  const warnings = [];
  // ⚠️ 插桩记在**本模块的局部数组**上，不是 ctx.gateStats 的全局数组——本模块产出的是局部 warnings，
  // 由 check-loop 在返回后才 spread 进全局；执行期间全局长度不动，直接共用游标会导致确定的错账
  // （本模块 5 段恒记 0 命中，全部增量被误记到模块之后的第一个段即检查 3 头上；实测已抓到该症状）。
  // 末尾用 appendSegs 把结算好的段按序并入全局收集器——它会先结算模块前的那一段（如检查 1）再清游标。
  const localStats = makeCollector(warnings, []); // 本模块只产 warnings，不产 blockers
  const markGate = (id, label) => { if (ctx.gateStats) gateSeg(localStats, id, label); };

  // --- 2. 模板字段占位符残留 [warning]（排除运行时文件名格式与协议样板，口径沿 sh 版）---
  markGate('2', '模板字段占位符残留');
  {
    const phRe = /YYYY-MM-DD|<主题>|<日期 主题>|L0 \/ L1 \/ L2 \/ L3|draft \/ approved \/ done|open \/ fixed \/ closed/;
    const boilerRe = /\.\.\/specs\/[A-Za-z0-9-]*\.md|写明如何满足|防复发验证|_YYYY-MM-DD\.|format\('YYYY-MM-DD'\)|value-format="YYYY-MM-DD"|确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）/;
    // plan 确认节样板豁免（2026-10-03 plan-confirm-boiler）：plan 模板「确认与复核」节自带
    // 「确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）」
    // 样板句，未回填不等于漏填占位（确认由 confirm-doc 机器兜底）——精确豁免整句，真实占位（如
    // `日期: YYYY-MM-DD`）照拦。
    // 命名约定豁免：`<主题>` 与 `.md` 同行 = 在描述文件命名规则（如 `.agents/workflows/<主题>.md`、
    //   「复制本模板为 YYYY-MM-DD-<主题>.md」），非未填占位符；真未填的占位（标题 `# INTENT — <主题>`、
    //   `日期: YYYY-MM-DD`）不含 .md，仍照拦（2026-09-25-wf-runtime incident 记录的误报口径）
    const isNamingConv = (line) => line.includes('<主题>') && /\.md/.test(line);
    // 样例引用豁免（2026-10-02 caliber-convergence 假阳性消除，先例=检查 18 行尾归一）：命中位于行内代码
    // （反引号包裹）或围栏代码块内 = 引用样例而非未填占位符，不报；正文裸占位符照报——真占位符均为
    // 裸文本（模板正文无反引号包裹），检测面不缩。
    // 日期显示格式豁免（2026-10-06 check2-datetime-literal-exempt）：`YYYY-MM-DD HH:mm(:ss)` 是功能
    // 自实现的显示格式描述（文档叙述「匹配时间列显示为 YYYY-MM-DD HH:mm」属常态——cancel-export
    // intent/plan 实证 2 条 advisory、2026-10-06 loop-audit intent 现场复现），非未填占位——行内剔除
    // 后再判；真占位（`日期: YYYY-MM-DD`，无时间粒度后缀）不含该形态仍拦。只豁免实证形态，变体（斜杠日期
    // /十二进制等）出现假阳性再扩。
    const stripSamples = (lines) => {
      let inFence = false;
      return lines.map((line) => {
        if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return ''; }
        if (inFence) return '';
        return line.replace(/`[^`]*`/g, '').replace(/YYYY-MM-DD\s+HH:mm(:ss)?/g, '');
      });
    };
    const groups = new Map(); // file -> [ "行号:内容" ]（首现序）
    for (const sub of DOC_DIRS) {
      for (const f of docFiles(sub)) {
        const lines = linesOf(f) || [];
        const hits = [];
        stripSamples(lines).forEach((line, i) => {
          if (phRe.test(line) && !boilerRe.test(line) && !isNamingConv(line)) hits.push(`${i + 1}:${lines[i]}`);
        });
        if (hits.length) groups.set(f, hits);
      }
    }
    for (const [f, hits] of groups) {
      warnings.push(`- [WARN 模板未填] ${path.relative(ROOT, f).split(path.sep).join('/')} 含模板占位符:\n${hits.join('\n')}`);
    }
  }

  // --- 9. 文件名英文 kebab-case [warning] ---
  markGate('9', '文件名 kebab-case');
  for (const sub of DOC_DIRS) {
    const dir = path.join(ROOT, WF, sub);
    for (const f of readdirOrNull(dir) || []) {
      if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
      const abs = path.join(dir, f);
      if (!isTracked(abs)) continue;
      if (!/^[\x20-\x7e]*$/.test(f)) {
        warnings.push(`- [WARN 文件名非英文] 文件名含非 ASCII 字符,应为英文 kebab-case:${WF}/${sub}/${f}`);
      }
    }
  }

  // --- 11. 生成物漂移 [warning]（调生成器 --check，口径单一不复刻渲染）---
  markGate('11', '生成物漂移（INDEX+DASHBOARD）');
  // ⚠️ 位置：本段须排在 12/13 之前——check-loop 输出按 warnings 插入序，行序是稳定输出契约
  // （pre-push / pre-commit 消费者 + doctor 按 WARN 行计数）；原序为 2 → 9 → 11 → 12 → 13，勿调换。
  // 两个生成物各自独立出账：漂移来源不同、修复命令不同，混成一条会让装户猜该跑哪个。
  // 装户跳过语义（防常驻噪声，audit-gate-hardening P3 教训）：
  //   ① 生成器脚本不存在（旧装副本）→ 跳过；
  //   ② DASHBOARD.md 不存在（从未生成过）→ 跳过——**新装用户不得因未生成过看板而每次 push 吃 WARN**；
  //      （INDEX.md 不设此前置：init 必落该文件，不存在本身即异常）
  for (const [label, genName, docRel] of [
    ['索引漂移', 'gen-workflow-index.mjs', 'workflow/INDEX.md'],
    ['仪表盘漂移', 'gen-workflow-dashboard.mjs', 'workflow/DASHBOARD.md'],
  ]) {
    const gen = path.join(ROOT, '.agents', 'scripts', genName);
    if (!fs.existsSync(gen)) continue;
    if (label === '仪表盘漂移' && !fs.existsSync(path.join(ROOT, docRel))) continue;
    const r = spawnSync(process.execPath, [gen, '--check'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      const first = `${r.stdout || ''}${r.stderr || ''}`.split('\n')[0];
      warnings.push(`- [WARN ${label}] ${docRel} 与当前事实不一致——跑 node .agents/scripts/${genName} 重新生成（${first}）`);
    }
  }

  // --- 12. frontmatter「模块:」合法性 [warning]（词表单源；缺字段只对 2026-09-22 起新建提示）---
  markGate('12', '模块枚举合法性');
  {
    const modsFile = path.join(ROOT, '.agents', 'workflow-modules.txt');
    if (fs.existsSync(modsFile)) {
      const mods = linesOf(modsFile).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim());
      const vocab = new Set(mods);
      for (const sub of ['intents', 'specs', 'plans', 'incidents']) {
        for (const doc of docFiles(sub)) {
          const base = path.basename(doc);
          const mod = fmGet(doc, '模块');
          let d = fmGet(doc, '日期') || fmGet(doc, '发现');
          if (!d) d = /^\d{4}-\d{2}-\d{2}$/.test(base.slice(0, 10)) ? base.slice(0, 10) : '';
          if (mod) {
            if (!vocab.has(mod)) warnings.push(`- [WARN 模块元数据] ${base}「模块: ${mod}」不在词表(见 .agents/workflow-modules.txt)`);
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= kitPolicy.moduleSince) {
            warnings.push(`- [WARN 模块元数据] ${base} 缺「模块:」字段(${kitPolicy.moduleSince} 起新建文档必填)`);
          }
        }
      }
    }
  }

  // --- 13. 常驻面体积预算 [warning]（判定单源 rule-budget.sh；无 sh 环境静默跳过——advisory，pre-commit 硬拦兜底）---
  markGate('13', '常驻面体积预算');
  {
    const rb = path.join(ROOT, '.agents', 'scripts', 'rule-budget.sh');
    const budgets = path.join(ROOT, '.agents', 'rule-budgets.txt');
    if (fs.existsSync(rb) && fs.existsSync(budgets)) {
      const r = spawnSync('sh', [rb, '--all'], { cwd: ROOT, encoding: 'utf8' });
      if (!r.error && r.status !== 0) {
        const head = `${r.stdout || ''}${r.stderr || ''}`.split('\n').slice(0, 5).map((l) => '    ' + l).join('\n');
        warnings.push(`- [WARN 常驻面超限] 常驻面体积超预算(先删除或下沉被取代条目再增——一进一出):\n${head}`);
      }
    }
  }

  // 并入全局收集器（仅显式插桩时）：把本模块 5 段按序插到「模块前的那一段」之后，
  // 游标由 appendSegs 清空 → check-loop 随后的 markGate('3', …) 从零起算，Δ 天然正确。
  if (ctx.gateStats) appendSegs(ctx.gateStats, finishSegs(localStats));

  return warnings;
}
