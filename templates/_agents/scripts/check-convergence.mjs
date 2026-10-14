// check-convergence.mjs — 检查 23：判据级收敛对账（2026-10-13 B6b-2 自 Shipyard.Material
//   check-loop-sections/s23-convergence-audit.mjs 回灌；段体判据逐字对齐，出处沿革留痕在包源仓 git
//   历史与 CHANGELOG——装户径不引实例路径）
// 背景（convergence-audit，参照 GitHub spec-kit converge 机理「完成声明不是证据」）：
// spec 的验证承诺此前只落在叙述节（检查 21 对节内引用做存在性扫描），没有逐判据 × 逐证据的机器对账。
// 本段把「验收判据」表（workflow/specs/_TEMPLATE.md 承重节）变成机器输入：L2/L3 done spec（锚后）逐行解析
//   判据 → 证据。状态列自报「覆盖」而证据无效 → 仍判未覆盖。
// 两档（convergence-hard）：
//   advisory（有 convergenceSince、无 hard 键，或日期 < convergenceHardSince）：证据 = 存在的路径，或命令白名单声明。WARN。
//   hard（日期 ≥ convergenceHardSince）：路径仍只认存在，不读正文、不判与判据是否相关（判断题留给新会话复核）；
//     命令必须是全量门实际跑的那几个，且 workflow/verify-evidence.md 有不早于本 spec 日期的全绿行。
//     答不了（空、路径不存在、命令不在全量门、没有对应全绿行）= 未覆盖，HARD-BLOCK。人工走查且证据为空仍合法。
// 无「验收判据」节或表无数据行 → 两档都是 WARN「收敛无判据」。
// 存量豁免：日期 < convergenceSince → 跳过。缺键（v1–v9）→ 整段跳过。缺 hard 键（v1–v10）→ 不升 hard。
// kit 适配（源仓→kit 逐条）：① 命令白名单收 kit 全量门口径——verify.mjs 全量门实际跑的就是
//   `npm test` 与 `node .agents/scripts/verify.mjs` 自身（verify.mjs 编排七门、测试面走 run-tests 套件），
//   源仓的 dotnet build / npm run build / verify-ui 等实例门随 instance-ref 门修法剔除；② hard 档解锁序
//   文案对齐 kit：verify.mjs 全绿尾部自动重生成 verify-evidence.md（gen-verify-evidence 单源），
//   不再单独点名 gen-verify-evidence 步骤。
import fs from 'node:fs';
import path from 'node:path';

// advisory 档的声明白名单（文本命中即认）。hard 档不再凭命中放行。命令面 = kit 全量门口径（见头注）。
const CMD_RE = /npm\s+(run\s+)?test|verify\.mjs/;
// 引用切分：每一处引用单独取出，防「npm test 与路径同格」被整格误判。长短形态都认。
const CITE_RE = /npm\s+(?:run\s+)?test|verify\.mjs/g;
// verify.mjs 全绿行（verifications.jsonl 绿凭证）实际覆盖的命令。不在此集的白名单命令没有对应绿记录。
const GATE_CMD = new Set(['npm test', 'npm run test', 'verify.mjs']);
const PATH_RE = /[\w.@\-\\/]+\.(mjs|js|ts|tsx|cs|md|json|html|sql)/g;
const SEC_RE = /^##\s+.*验收判据/;
// 与 gen-verify-evidence.mjs 数据行同形态（kit 六列：短 SHA | ISO 时间 | 门数 | 套件计数 | 绑定单 | runId）。
// 只取日期，不复述门数。
const EVIDENCE_ROW_RE = /^\|\s*`[0-9a-f]{7,40}`\s*\|\s*([^|]+?)\s*\|/;

export function run(ctx) {
  const { ROOT, WF, docFiles, fmGet, linesOf, addedDateOf, kitPolicy, warnings, blockers } = ctx;
  // --- 23. 判据级收敛对账（锚 convergenceSince / convergenceHardSince）---
  function greenEvidenceDates() {
    const dates = [];
    let text = '';
    try { text = fs.readFileSync(path.join(ROOT, WF, 'verify-evidence.md'), 'utf8'); } catch { return dates; }
    for (const raw of text.split(/\r?\n/)) {
      const m = raw.trim().match(EVIDENCE_ROW_RE);
      if (!m) continue;
      const day = m[1].trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) dates.push(day);
    }
    return dates;
  }

  // 命令格：每一处引用都须落在全量门里，且有不早于 spec 日期的全绿行。解析不出引用 → 不放行。
  // 两侧日期同须 UTC 口径（台账渲染 UTC ts；spec「日期」fill-spec 默认 UTC，手写见 _TEMPLATE.md 验收判据注）：
  // 本地时区手写日期会在 UTC+8 0–8 点窗与全绿行错位一天——fail-closed，不误放。
  function commandCovered(ev, specDate, greenDates) {
    const cites = ev.match(CITE_RE) || [];
    if (!cites.length) return false;
    const fresh = greenDates.some((g) => g >= specDate);
    return cites.every((c) => GATE_CMD.has(c) && fresh);
  }

  {
    const anchor = kitPolicy.convergenceSince;
    const hardAnchor = kitPolicy.convergenceHardSince;
    if (anchor) {
      const greenDates = greenEvidenceDates();
      const isPlaceholder = (s) => !s || /^<.*>$/.test(s);
      for (const spec of docFiles('specs')) {
        const st = fmGet(spec, '状态');
        const lvl = fmGet(spec, '级别');
        if (st !== 'done' || !['L2', 'L3'].includes(lvl)) continue;
        // 生效日锚：frontmatter「日期」优先（fill-spec 必写），缺则 git 首加日 / 文件名前缀（同检查 12 退化序）
        let d = fmGet(spec, '日期') || addedDateOf(spec);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = /^\d{4}-\d{2}-\d{2}/.test(path.basename(spec)) ? path.basename(spec).slice(0, 10) : '';
        if (!d || d < anchor) continue; // 锚前存量不回填
        const hard = !!(hardAnchor && d >= hardAnchor);
        const lines = linesOf(spec) || [];
        const secLines = [];
        let inSec = false;
        for (const l of lines) {
          if (SEC_RE.test(l)) { inSec = true; continue; }
          if (inSec && /^##\s+/.test(l)) { inSec = false; continue; }
          if (inSec) secLines.push(l);
        }
        // 解析表数据行（表头才是数据边界——沿用 agg-delegations splitTables 口径；分隔行/表头行/占位行跳过）
        const rows = secLines
          .filter((l) => /^\|.*\|\s*$/.test(l))
          .filter((l) => !/^\|[\s:|-]+\|\s*$/.test(l))
          .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, '')))
          .filter((cells) => cells.length >= 3)
          .filter((cells) => !cells[1].startsWith('证据（')) // 表头行
          .filter((cells) => !isPlaceholder(cells[0])); // 模板占位行
        const base = path.basename(spec);
        if (!rows.length) {
          warnings.push(`- [WARN 收敛无判据] ${base} 无「验收判据」表或表为空——L2/L3 done spec 须逐条登记可验判据（检查 23，模板 workflow/specs/_TEMPLATE.md）`);
          continue;
        }
        const missed = [];
        for (const [crit, ev, stat] of rows.map((c) => [c[0], c[1], (c[2] || '').trim()])) {
          if (stat === '人工' && isPlaceholder(ev)) continue; // 人工走查判据：空证据合法
          let ok = false;
          if (!isPlaceholder(ev)) {
            if (hard && CMD_RE.test(ev)) ok = commandCovered(ev, d, greenDates);
            else if (CMD_RE.test(ev)) ok = true; // advisory：命令白名单认声明
            else {
              const cands = ev.match(PATH_RE) || [];
              ok = cands.some((p) => fs.existsSync(path.join(ROOT, p)));
            }
          }
          if (!ok) missed.push(`${crit}→${ev || '（空）'}`);
        }
        if (missed.length) {
          const detail = `${base} ${rows.length} 条判据中 ${missed.length} 条证据无效（${missed.join('; ')}）`;
          if (hard) blockers.push(`- [收敛未覆盖] ${detail}——状态列自报不作数；命令须是全量门（npm test / verify.mjs）且 workflow/verify-evidence.md 有不早于本 spec 日期的全绿行；路径只认存在（检查 23）。若本 spec 已标 done：先标后补会与本门互为前提（verify 门序含 check-loop）——解锁序：状态临时改回非 done → 跑 node .agents/scripts/verify.mjs 全量门（全绿尾部自动重生成 workflow/verify-evidence.md 全绿行）→ 再标 done`);
          else warnings.push(`- [WARN 收敛未覆盖] ${detail}——状态列自报不作数，证据须存在或为验证命令（检查 23）`);
        }
      }
    }
  }
}
