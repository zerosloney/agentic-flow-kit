// fill-intent.test.mjs — fill-intent 工具测试（2026-09-25 doc-fill-tools）
// 方法：直接 import 模块调 renderIntent 拿字符串（不写盘），断言 frontmatter 字段 + 节数 + 枚举值合法性
// 用法：node .agents/scripts/fill-intent.test.mjs
import { renderIntent } from './fill-intent.mjs';

let pass = 0, failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { failCount++; console.log('FAIL ' + name + (detail ? '——' + detail : '')); }
}

// ---- 场景 1：L1 必填 frontmatter 字段都在 ----
{
  const { body } = renderIntent({ topic: 'test', module: 'pipeline', level: 'L1' });
  const fm = body.match(/^---([\s\S]*?)---/);
  check('S1 frontmatter 含状态 draft', /状态:\s*draft/.test(fm[1]));
  check('S1 frontmatter 含级别 L1', /级别:\s*L1/.test(fm[1]));
  check('S1 frontmatter 含日期 YYYY-MM-DD', /日期:\s*\d{4}-\d{2}-\d{2}/.test(fm[1]));
  check('S1 frontmatter 含模块 pipeline', /模块:\s*pipeline/.test(fm[1]));
  check('S1 frontmatter 含备注', /备注:/.test(fm[1]));
}

// ---- 场景 2：L2/L3 frontmatter 同样含完整字段 ----
{
  for (const level of ['L2', 'L3']) {
    const { body } = renderIntent({ topic: 't', module: 'pipeline', level });
    const fm = body.match(/^---([\s\S]*?)---/);
    check('S2 级别 ' + level + ' frontmatter 完整', /状态:\s*draft/.test(fm[1]) && /级别:\s*/.test(fm[1]) && /日期:/.test(fm[1]));
  }
}

// ---- 场景 3：非法 level 抛错（枚举严格）----
{
  let threw = false;
  try { renderIntent({ topic: 't', module: 'pipeline', level: 'L9' }); } catch { threw = true; }
  check('S3 非法 level 抛错', threw);
}

// ---- 场景 4：7 节正文齐 ----
{
  const { body } = renderIntent({ topic: 't', module: 'pipeline', level: 'L1' });
  const expectedSections = ['背景与问题', '目标', '非目标', '约束', '影响面', '触达红线', '验收标准', '确认与复核'];
  for (const s of expectedSections) check('S4 含节 ## ' + s, body.includes('## ' + s));
  check('S4 共 8 节标题', (body.match(/^##\s/gm) || []).length === 8);
}

// ---- 场景 5：备注字段透传 ----
{
  const { body } = renderIntent({ topic: 't', module: 'pipeline', level: 'L1', notes: '自定义备注' });
  check('S5 自定义备注透传', body.includes('备注: 自定义备注'));
  const { body: body2 } = renderIntent({ topic: 't', module: 'pipeline', level: 'L1' });
  check('S5 默认备注占位', body2.includes('备注: <可选：附注自由文本，check-loop 不解析>'));
}

// ---- 场景 6：日期默认今日 ----
{
  const today = new Date().toISOString().slice(0, 10);
  const { body } = renderIntent({ topic: 't', module: 'pipeline', level: 'L1' });
  check('S6 日期默认今日 ' + today, body.includes('日期: ' + today));
  const { body: body2 } = renderIntent({ topic: 't', module: 'pipeline', level: 'L1', date: '2026-01-15' });
  check('S6 自定义日期透传', body2.includes('日期: 2026-01-15'));
}

// ---- 场景 7：导出函数可单元测试 ----
{
  check('S7 renderIntent 是函数', typeof renderIntent === 'function');
  // 边界：缺 topic 应返回字符串（渲染时缺 topic → topic 是 undefined 字符串，不抛错——按 design 透传）
  const r = renderIntent({ module: 'pipeline', level: 'L1' });
  check('S7 缺 topic 仍可渲染（透传设计）', typeof r.body === 'string' && r.body.includes('INTENT — undefined'));
}

console.log('\n合计: PASS ' + pass + ' / FAIL ' + failCount);
process.exit(failCount ? 1 : 0);