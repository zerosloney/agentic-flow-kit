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
// kit 适配（源仓→kit 逐条）：无判据改动。kind 词表沿源仓 s25 等价落——pipeline-run.mjs 的 KINDS 为
//   模块内常量、无导出（两侧同状），故本文件按源仓同款内联声明 + 注释互引（改任一侧须同步，见下）。
import path from 'node:path';

export function run(ctx) {
  const { ROOT, WF, DOC_DIRS, ENUMS, inSet, fmGet, isTracked, readdirOrNull, warnings } = ctx;
  // --- 25. 路由预判一致性 [warning] ---
  // kind 词表单源 = pipeline-run.mjs KINDS（该处为模块内常量、未导出——源仓 s25 同款内联等价落）；
  // 两侧各一份靠本注释互引，改词表须同步（pipeline-run 校验文案 `kind 须为 …` 同步）。
  const KINDS = ['require', 'fix', 'verify', 'review', 'deploy'];
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
      const kv = {};
      for (const m of pj.matchAll(/(kind|level)=([^\s]+)/g)) kv[m[1]] = m[2];
      if (!Object.keys(kv).length) {
        warnings.push(`- [WARN 预判字段不可解析] 须形如「预判: kind=<kind> level=<L1|L2|L3>」:${rel}`);
        continue;
      }
      if (kv.kind && !KINDS.includes(kv.kind)) {
        warnings.push(`- [WARN 预判字段不可解析] kind=${kv.kind} 不在词表（${KINDS.join('/')}）:${rel}`);
      }
      if (kv.level && !inSet(kv.level, ENUMS['level.all'])) {
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
