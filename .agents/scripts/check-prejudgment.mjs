// check-prejudgment.mjs — 检查 25：路由预判一致性 [warning]（2026-10-13 B6b-2 自 Shipyard.Material
//   check-loop-sections/s25-prejudgment.mjs 回灌；段体判据逐字对齐，出处沿革留痕在包源仓 git 历史与
//   CHANGELOG——装户径不引实例路径）
// 背景（prejudgment-ledger）：类型误路由（修复被当新需求 → 跳过 incident 立项与 kb-search 历史检索）
// 是路由自动识别的静默盲区；级别判低已有「红线判低」hard 与泳道门兜底，但「入口预判 vs 实际落位」的
// 偏离本身不可见。本段只做 advisory 比对：frontmatter「预判: kind=<kind> level=<L1|L2|L3>」在场才检——
// kind 与入口类型不符 / level 与「级别」字段不符 / 词表非法 → WARN，不阻断。
// kind 语义源 = pipeline-run.mjs KINDS（require/fix/verify/review/deploy）；类型只对 intents(≡require)/
// incidents(≡fix) 执法——plans/specs 是两道共用件不判类型、只比对级别。
// 缺字段零告警（存量宽容不回填，不做强制前置）——灰度数据经 judgments.jsonl（WARN 预判* 计数）
// 月度对账后再议升格，退役/升格阈值由 mechanism-registry §25 行承载。
// kit 适配（源仓→kit 逐条）：无判据改动。kind 词表与 pipeline-run.mjs 的 KINDS 同值——**刻意维持两份
//   字面量 + 注释互引**（2026-10-19 先改成 import，同日回退）：代价实测后确认不值得。pipeline-run.mjs
//   是 867 行编排器，其依赖闭包含 pipeline-run-run/docs、level-criteria、confirm-doc、kb-search、
//   fill-{intent,spec,plan}、archive-sweep 等十余个文件，还有一个 `bin/flow-kit.mjs` 的裸文件名字面量
//   （跨目录、夹具闭包扫不到）——把检查 25 这个纯 advisory 小段挂上去，等于让每次跑 check-loop 都
//   为 5 个短字符串拉整条编排链，且 fixture-scripts 的 assertFixtureScripts 会因那个字面量在建夹具
//   时炸掉。5 个字符串的漂移风险 << 这条依赖边的重量，故留字面量、留互引注释。
// 终态并集（doc 终态 + incident 终态）从 workflow-enums 派生，不再内联字面量（2026-10-19 同批收敛）。
//   这一处值得收敛：并集本身无单一键覆盖，派生表达式即文档，且 workflow-enums.mjs 是零依赖叶子模块。
import path from 'node:path';

export function run(ctx) {
  const { ROOT, WF, DOC_DIRS, ENUMS, inSet, fmGet, isTracked, readdirOrNull, warnings } = ctx;
  // --- 25. 路由预判一致性 [warning] ---
  // kind 词表单源 = pipeline-run.mjs KINDS（该处为模块内常量、已导出，但本文件刻意不 import——
  //   理由见文件头「刻意维持两份字面量」段：依赖边重量 >> 5 个字符串的漂移风险）。两侧各一份靠本注释
  //   互引，改词表须同步（pipeline-run 校验文案 `kind 须为 …` 同步）。
  const KINDS = ['require', 'fix', 'verify', 'review', 'deploy'];
  // 终态并集（2026-10-15）：形态/词表类告警跳过——终态受检查 15 内容绑定不可修订，此类 WARN 永不可
  // 消（「不可消除噪声」红线）；类型/级别比对保留——那是路由审计的本体信号，灰度对账照常采集。
  // 并集 = doc 终态（done/superseded/cancelled）∪ incident 终态（fixed/closed）——两侧枚举无单一键
  // 覆盖，故从 workflow-enums 两个键派生（不再内联字面量：字面量不会随单源演进）。
  const TERMINAL_ALL = [...ENUMS['doc.status.terminal'],
    ...ENUMS['incident.status.all'].filter((s) => !ENUMS['incident.status.active'].includes(s))];
  const rankOf = (lv) => Number(String(lv).replace(/^L/, '')) || 0;
  for (const sub of DOC_DIRS) {
    const dir = path.join(ROOT, WF, sub);
    for (const f of readdirOrNull(dir) || []) {
      if (!f.endsWith('.md') || f === '_TEMPLATE.md') continue;
      const abs = path.join(dir, f);
      if (!isTracked(abs)) continue;
      const pj = fmGet(abs, '预判');
      if (!pj) continue;
      const rel = `${WF}/${sub}/${f}`;
      const terminalDoc = TERMINAL_ALL.includes(fmGet(abs, '状态'));
      const kv = {};
      for (const m of pj.matchAll(/(kind|level)=([^\s]+)/g)) kv[m[1]] = m[2];
      if (!Object.keys(kv).length) {
        if (!terminalDoc) warnings.push(`- [WARN 预判字段不可解析] 须形如「预判: kind=<kind> level=<L1|L2|L3>」:${rel}`);
        continue;
      }
      if (kv.kind && !KINDS.includes(kv.kind) && !terminalDoc) {
        warnings.push(`- [WARN 预判字段不可解析] kind=${kv.kind} 不在词表（${KINDS.join('/')}）:${rel}`);
      }
      if (kv.level && !inSet(kv.level, ENUMS['level.all']) && !terminalDoc) {
        warnings.push(`- [WARN 预判字段不可解析] level=${kv.level} 不在枚举 level.all:${rel}`);
      }
      // 类型比对：intents ≡ require、incidents ≡ fix（plans/specs 两道共用，不判类型）
      const actualKind = sub === 'incidents' ? 'fix' : sub === 'intents' ? 'require' : null;
      if (kv.kind && actualKind && kv.kind !== actualKind) {
        warnings.push(`- [WARN 预判类型不符] 预判 kind=${kv.kind} 但落位 ${sub}（实际 kind=${actualKind}）——类型误路由会跳过对应道的检索与立档，确认是否有意:${rel}`);
      }
      // 级别比对：与 frontmatter「级别」字段
      if (kv.level) {
        const lv = fmGet(abs, '级别');
        if (lv && lv !== kv.level) {
          const hint = rankOf(lv) < rankOf(kv.level) ? '（判低信号——落位低于预判，复核两问判据）' : '（判高——流程偏重，无害）';
          warnings.push(`- [WARN 预判级别不符] 预判 ${kv.level} 落位 ${lv}${hint}:${rel}`);
        }
      }
    }
  }
}
