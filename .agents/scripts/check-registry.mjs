// check-registry.mjs — 检查 22：机制使用量台账 [warning]（2026-10-13 B6b-2 自 Shipyard.Material
//   check-loop-sections/s22-registry.mjs 回灌；段体判据逐字对齐，出处沿革留痕在包源仓 git 历史与
//   CHANGELOG——装户径不引实例路径）
// 背景：门禁只增不减（每道门都有事故背书，但无退役机制）——本检查给「低频机制退役」装强制处置环。
// .agents/mechanism-registry.md 在场才启用（历史 clone / 装户缺文件 = 跳过，沿 lane-surfaces.txt
// 「缺失即跳过」惯例，不制造一次性噪声）。表格式 markdown 管道表，列序固定：
//   | 机制 | 门禁位置 | 触发统计口径 | 退役阈值 | 最近触发 | 状态 | 处置期限 |
// 判据：状态 ∈ {现役,待退役,已退役}；「待退役」必须填处置期限（日期或批次号）——台账的目的不是记录
// 而是强制处置：没有时间表的退役意向等于永不变退役。触发计数本身半自动（口径列写明统计方法），
// 不进机器门——先有账，再谈自动化。纯 WARN advisory，永不 hard（机制未登记/只有示例行都只出账不拦）。
// kit 适配（源仓→kit 逐条）：台账路径平铺 .agents/config/ → .agents/（kit 装户布局无 config/ 层）。
import fs from 'node:fs';
import path from 'node:path';

export function run(ctx) {
  const { ROOT, linesOf, warnings } = ctx;
  // --- 22. 机制使用量台账（mechanism-registry；复杂度棘轮的出口）---
  {
    const regPath = path.join(ROOT, '.agents', 'mechanism-registry.md');
    if (fs.existsSync(regPath)) {
      const dataRows = (linesOf(regPath) || [])
        .filter((l) => /^\|/.test(l))
        .filter((l) => !/^\|[\s:|-]+\|?\s*$/.test(l))          // 分隔行
        .filter((l) => (l.split('|')[1] || '').trim() !== '机制'); // 表头行
      if (!dataRows.length) {
        warnings.push('- [WARN 机制台账] 无数据行——表格式：| 机制 | 门禁位置 | 触发统计口径 | 退役阈值 | 最近触发 | 状态 | 处置期限 |');
      }
      for (const l of dataRows) {
        const cells = l.split('|').slice(1, -1).map((c) => c.trim());
        if (cells.length !== 7) {
          warnings.push(`- [WARN 机制台账] 行列数 ${cells.length} ≠ 7（机制|门禁位置|触发统计口径|退役阈值|最近触发|状态|处置期限）:${cells[0] || l.slice(0, 30)}`);
          continue;
        }
        const [name, , , , , status, deadline] = cells;
        if (!['现役', '待退役', '已退役'].includes(status)) {
          warnings.push(`- [WARN 机制台账] 「${name}」状态非法（须 现役/待退役/已退役）:${status}`);
          continue;
        }
        if (status === '待退役' && !deadline) {
          warnings.push(`- [WARN 机制台账] 「${name}」待退役但缺处置期限——补时间表，或改回现役并在阈值列写保留理由`);
        }
      }
    }
  }
}
