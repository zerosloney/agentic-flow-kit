#!/usr/bin/env node
// mechanism-retire-watch.test.mjs — 1b 机制退役催办纯函数套件（2026-10-14 L5 自举接线 1b）
// parseRegistry / ruleNamesOf / zeroMonthsOf / evaluate 进程内断言。
import { parseRegistry, ruleNamesOf, zeroMonthsOf, evaluate } from './mechanism-retire-watch.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

// ---- S1 parseRegistry ----
{
  const text = [
    '| 机制 | 门禁位置 | 触发统计口径 | 退役阈值 | 最近触发 | 状态 | 处置期限 |',
    '|---|---|---|---|---|---|---|',
    '| 甲门 | check-loop §1 | WARN「甲规则」计数（月） | 连续 6 月 = 0 → 评估退役 | 2026-10 在用 | 现役 | — |',
    '| 乙门 | check-loop §2 | hard 计数 | 不退役（主干） | 2026-10 | 现役 | — |',
    '| 丙门 | check-loop §3 | WARN 计数 | 连续 6 月 = 0 | 2026-10 | 待退役 | 2026-01-01 |',
    '| 坏行 | 少列 |',
  ].join('\n');
  const rows = parseRegistry(text);
  check('S1 只取 7 列数据行（表头/分隔/坏行剔除）', rows.length === 3, String(rows.length));
  check('S1 列序正确', rows[0].name === '甲门' && rows[0].status === '现役' && rows[0].deadline === '—', JSON.stringify(rows[0]));
  check('S1 待退役行期限解析', rows[2].status === '待退役' && rows[2].deadline === '2026-01-01');
}

// ---- S2 ruleNamesOf ----
check('S2 单规则名', ruleNamesOf('WARN「模板未填」计数（月）').join(',') === '模板未填');
check('S2 斜杠分隔多规则', ruleNamesOf('WARN「预判类型不符/预判级别不符/预判字段不可解析」计数').join(',') === '预判类型不符,预判级别不符,预判字段不可解析');
check('S2 无「」→ 空', ruleNamesOf('hard/WARN 计数（月）').length === 0);

// ---- S3 zeroMonthsOf ----
check('S3 连续 6 月 = 0', zeroMonthsOf('连续 6 月 = 0 → 评估退役') === 6);
check('S3 带前缀仍解析', zeroMonthsOf('WARN 命中连续 6 月 = 0 且新增预判字段停滞 → 评估退役') === 6);
check('S3 非零阈值形态 → null', zeroMonthsOf('不退役（防伪主干）') === null);
check('S3 使用率型 → null', zeroMonthsOf('<10% 且无新增 → 退役双协议') === null);

// ---- S4 evaluate：阈值触达 ----
{
  const reg = [{ name: '甲门', criterion: 'WARN「甲规则」计数', threshold: '连续 2 月 = 0 → 评估退役', status: '现役', deadline: '—' }];
  const j = [
    { ts: '2026-08-01T00:00:00Z', rules: [{ rule: '甲规则', level: 'WARN', count: 0 }] },
    { ts: '2026-09-01T00:00:00Z', rules: [] },
  ];
  const r = evaluate(reg, j, new Date('2026-10-14'));
  check('S4 连续 2 月零触发 → 动作项', r.actions.length === 1 && r.actions[0].kind === 'threshold', JSON.stringify(r.actions));
  check('S4 动作项含窗口与规则名', /2026-08 \/ 2026-09/.test(r.actions[0].detail) && /甲规则/.test(r.actions[0].detail), r.actions[0].detail);
}

// ---- S5 evaluate：窗口内有触发 → 不产动作项 ----
{
  const reg = [{ name: '甲门', criterion: 'WARN「甲规则」计数', threshold: '连续 2 月 = 0', status: '现役', deadline: '—' }];
  const j = [
    { ts: '2026-08-01T00:00:00Z', rules: [{ rule: '甲规则', level: 'WARN', count: 1 }] },
    { ts: '2026-09-01T00:00:00Z', rules: [] },
  ];
  const r = evaluate(reg, j, new Date('2026-10-14'));
  check('S5 窗口内命中 → 无动作项', r.actions.length === 0, JSON.stringify(r.actions));
}

// ---- S6 evaluate：数据不足 / 无规则名 → notAuto ----
{
  const reg = [
    { name: '甲门', criterion: 'WARN「甲规则」计数', threshold: '连续 6 月 = 0', status: '现役', deadline: '—' },
    { name: '乙门', criterion: 'hard 计数', threshold: '连续 6 月 = 0', status: '现役', deadline: '—' },
    { name: '丙门', criterion: 'WARN「丙规则」计数', threshold: '不退役（主干）', status: '现役', deadline: '—' },
  ];
  const j = [{ ts: '2026-09-01T00:00:00Z', rules: [] }];
  const r = evaluate(reg, j, new Date('2026-10-14'));
  check('S6 数据不足 → notAuto', r.notAuto.some((x) => x.name === '甲门' && /数据不足/.test(x.reason)), JSON.stringify(r.notAuto));
  check('S6 无规则名 → notAuto', r.notAuto.some((x) => x.name === '乙门' && /未列规则名/.test(x.reason)));
  check('S6 非零阈值形态 → notAuto', r.notAuto.some((x) => x.name === '丙门' && /非「连续/.test(x.reason)));
  check('S6 无动作项', r.actions.length === 0);
}

// ---- S7 evaluate：待退役逾期 / 缺期限 ----
{
  const reg = [
    { name: '甲门', criterion: '', threshold: '', status: '待退役', deadline: '2026-01-01' },
    { name: '乙门', criterion: '', threshold: '', status: '待退役', deadline: '下批次' },
    { name: '丙门', criterion: '', threshold: '', status: '已退役', deadline: '—' },
  ];
  const r = evaluate(reg, [], new Date('2026-10-14'));
  check('S7 逾期 → overdue', r.actions.some((a) => a.kind === 'overdue' && a.name === '甲门'), JSON.stringify(r.actions));
  check('S7 非日期期限 → no-deadline', r.actions.some((a) => a.kind === 'no-deadline' && a.name === '乙门'));
  check('S7 已退役行跳过', !r.actions.some((a) => a.name === '丙门'));
}
// ---- S7b：期限当天不逾期（本地日，不当天 08:00 后提前催）----
{
  const reg = [{ name: '甲门', criterion: '', threshold: '', status: '待退役', deadline: '2026-10-14' }];
  const now = new Date(2026, 9, 14, 9, 0, 0);
  const r = evaluate(reg, [], now);
  check('S7b 期限当天本地 09:00 不逾期', r.actions.length === 0, JSON.stringify(r.actions));
}
// ---- S4b：有数据月不连续 → 缺月不算零命中 ----
{
  const reg = [{ name: '甲门', criterion: 'WARN「甲规则」计数', threshold: '连续 2 月 = 0 → 评估退役', status: '现役', deadline: '—' }];
  const j = [
    { ts: '2026-08-01T00:00:00Z', rules: [] },
    { ts: '2026-10-01T00:00:00Z', rules: [] },
  ];
  const r = evaluate(reg, j, new Date('2026-10-14T00:00:00Z'));
  check('S4b 8 月与 10 月之间缺 9 月 → 不产退役动作', r.actions.length === 0, JSON.stringify(r.actions));
  check('S4b 缺月记入 notAuto', r.notAuto.some((x) => x.name === '甲门' && /缺月/.test(x.reason) && /2026-09/.test(x.reason)), JSON.stringify(r.notAuto));
}

// ---- S8 空入参 ----
check('S8 空台账 → 无动作项', evaluate([], [], new Date()).actions.length === 0);
check('S8 null judgments 不 throw', evaluate([], null, new Date()).actions.length === 0);

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
