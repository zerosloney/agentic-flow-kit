#!/usr/bin/env node
// stage-gates.test.mjs — 逐阶段前置门 + 待澄清门的纯函数直测（2026-10-12 needs-clarification）
// 为什么单建本套件（stage-gates.mjs 此前登记 scripts-test-exempt，靠 check-loop.test 间接覆盖）：
//   本批给该模块加了两条**此前不存在的判据族**（clarifyGateFor / openClarifications），
//   而这两条**没有 check-loop 侧的对应检查**——check-loop 不消费它们。间接覆盖天然盖不到
//   「确认门拒绝未澄清项」这条行为，纯函数直测是唯一能钉住它的位置（check 20 的豁免登记
//   在此更新为「同名直测 + 间接覆盖并有」）。
// 覆盖：CLARIFY_RE 形态矩阵（正例 5 / 负例 7）+ HTML 注释不计 + 已澄清前缀不计
//       + clarifyGateFor 三态（无 / 有 / 不可读）+ 行号点名。
// 用法：node templates/_agents/scripts/stage-gates.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openClarifications, clarifyGateFor } from './stage-gates.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

// ---- T1 正例形态矩阵（5 个写法都应抽出，行号正确）----
{
  const body = [
    '# S',                          // 1
    '',                             // 2
    '- 待澄清：错误率判据？',        // 3  ← 行首列表符 + 全角冒号
    '* 需澄清: 依赖版本未定',        // 4  ← 星号 + 半角冒号 + 同义前缀
    '  - 待确认细节：用户没说要不要兼容旧数据', // 5 ← 前导空格 + 第三同义前缀
    '正文里提到「待澄清」二字不算（不是行首列表条目）', // 6 ← 负例
    '',                             // 7
    '- 待澄清了：已解决的说法不该被抽', // 8 ← 负例（词后跟了别的字符）
    '待澄清：无列表符的行不算',       // 9 ← 负例
    '- 已澄清：这是已解决的',         // 10 ← 负例（前缀已澄清）
  ].join('\n');
  const items = openClarifications(body);
  check('T1 三个同义前缀 + 列表符变体 + 全/半角冒号全命中（5 个写法）', items.length === 3, JSON.stringify(items));
  check('T1 行号正确（3 / 4 / 5）',
    items.map((i) => i.lineNo).join(',') === '3,4,5', JSON.stringify(items.map((i) => i.lineNo)));
  check('T1 抽出的是标记后的正文（不含前缀与冒号）',
    items[0].text === '错误率判据？' && items[1].text === '依赖版本未定' && items[2].text === '用户没说要不要兼容旧数据',
    JSON.stringify(items.map((i) => i.text)));
  check('T1 负例四类全不误抽（正文提及 / 前缀粘连 / 无列表符 / 已澄清）',
    !items.some((i) => /待澄清了|无列表符|已解决/.test(i.text)), JSON.stringify(items));
}

// ---- T2 HTML 注释行不计（模板自带说明写在注释里，不该被判成作者的未澄清项）----
{
  const body = [
    '# S',
    '<!-- 起草时照实写一行 - 待澄清：<你卡在哪>，不要猜 -->',  // 整行注释
    '- 待澄清：真问题',
    '<!-- - 待澄清：注释里的第二处 -->',                      // 整行注释
    '行尾注释不算：- 待澄清：真的吗 <!-- 附注 -->',            // 行尾注释
  ].join('\n');
  const items = openClarifications(body);
  check('T2 整行 HTML 注释里的标记不计（只 1 处命中）', items.length === 1 && items[0].lineNo === 3, JSON.stringify(items));
  check('T2 行尾注释形态不计（模板说明常这么写）', !items.some((i) => /真的吗/.test(i.text)), JSON.stringify(items));
}

// ---- T2b 已知边界（跨行 HTML 注释块）——如实钉住，不假装覆盖 ----
// 逐行过滤只认「整行注释」与「行尾注释」；跨行注释块 <!--\n - 待澄清：x\n--> 的中间行会被抽出。
// 为何不修：跨行注释在 workflow 文档里零先例（模板说明一律单行注释），为不存在的形态加状态机
// 是过度工程。**方向是保守的**（多抽一处 → 确认门拒一次，作者看到就改），不会漏放。
{
  const items = openClarifications('<!--\n- 待澄清：跨行注释块中间行\n-->');
  check('T2b 已知边界：跨行注释块中间行会被抽出（保守方向——多拒不漏放）',
    items.length === 1 && items[0].lineNo === 2, JSON.stringify(items));
}

// ---- T3 CRLF 与空输入 ----
{
  check('T3 CRLF 归一后形态不变（行号按 \\n 计）',
    openClarifications('- a\r\n\r\n- 待澄清：x\r\n').length === 1);
  check('T3 空 / undefined 输入 → 空数组（不抛）',
    openClarifications('').length === 0 && openClarifications(undefined).length === 0 && openClarifications(null).length === 0);
}

// ---- T4 clarifyGateFor 三态 ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-gates-test-'));
  const p = path.join(tmp, 'doc.md');
  fs.writeFileSync(p, '---\n状态: draft\n---\n# S\n- 待澄清：甲\n- 待澄清：乙\n');
  const g = clarifyGateFor(p);
  check('T4 挂未澄清项 → ok=false 且 items 含两处', !g.ok && g.items.length === 2, JSON.stringify(g));
  check('T4 reason 逐条点名行号与内容（作者不必回去逐行找）',
    /第5行「甲」/.test(g.reason) && /第6行「乙」/.test(g.reason), g.reason);
  check('T4 reason 给出条数 + hint 给两条解决路径（改前缀 / 删行）',
    /2 处未澄清项/.test(g.reason) && /已澄清/.test(g.hint) && /删行/.test(g.hint), JSON.stringify(g));
  check('T4 ok=false 时必然带 reason 与 hint（出账完整，勿半截）', !!g.reason && !!g.hint);

  fs.writeFileSync(p, '---\n状态: draft\n---\n# S\n- 已澄清：都解决了\n');
  const g2 = clarifyGateFor(p);
  check('T4 全部已澄清 → ok=true', g2.ok && g2.items.length === 0, JSON.stringify(g2));

  const missing = clarifyGateFor(path.join(tmp, 'nope.md'));
  check('T4 文件不可读 → ok=true + skipped=unreadable（fail-open，不因读不到而拒确认）',
    missing.ok && missing.skipped === 'unreadable', JSON.stringify(missing));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('\n用法：node templates/_agents/scripts/stage-gates.test.mjs'); process.exit(1); }
process.exit(0);
