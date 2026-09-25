// fill-spec.test.mjs — fill-spec 工具测试（2026-09-25 doc-fill-tools）
import { renderSpec } from './fill-spec.mjs';

let pass = 0, failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { failCount++; console.log('FAIL ' + name + (detail ? '——' + detail : '')); }
}

// ---- 场景 1：5 节正文齐 ----
{
  const { body } = renderSpec({ topic: 'test', level: 'L2' });
  const expectedSections = ['功能行为', '数据流', '系统改动', '约束遵守映射', '风险评估', '确认与复核'];
  for (const s of expectedSections) check('S1 含节 ## ' + s, body.includes('## ' + s));
  check('S1 共 6 节标题', (body.match(/^##\s/gm) || []).length === 6);
}

// ---- 场景 2：frontmatter 含 5 字段 ----
{
  const { body } = renderSpec({ topic: 't', level: 'L2' });
  const fm = body.match(/^---([\s\S]*?)---/);
  check('S2 frontmatter 含状态 draft', /状态:\s*draft/.test(fm[1]));
  check('S2 frontmatter 含级别 L2', /级别:\s*L2/.test(fm[1]));
  check('S2 frontmatter 含日期', /日期:\s*\d{4}-\d{2}-\d{2}/.test(fm[1]));
  check('S2 frontmatter 含模块', /模块:/.test(fm[1]));
  check('S2 frontmatter 含备注', /备注:/.test(fm[1]));
}

// ---- 场景 3：L3 也合法（默认 L2，但显式 L3 也接受）----
{
  const { body } = renderSpec({ topic: 't', level: 'L3' });
  check('S3 L3 合法', /级别:\s*L3/.test(body.match(/^---([\s\S]*?)---/)[1]));
}

// ---- 场景 4：非法 level 抛错 ----
{
  let threw = false;
  try { renderSpec({ topic: 't', level: 'XX' }); } catch { threw = true; }
  check('S4 非法 level 抛错', threw);
}

// ---- 场景 5：默认 L2 ----
{
  const { body } = renderSpec({ topic: 't' });
  check('S5 默认级别 L2', /级别:\s*L2/.test(body.match(/^---([\s\S]*?)---/)[1]));
}

// ---- 场景 6：日期透传 ----
{
  const { body } = renderSpec({ topic: 't', date: '2026-12-31' });
  check('S6 自定义日期透传', body.includes('日期: 2026-12-31'));
}

// ---- 场景 7：L3 必填提示独立复核 ----
{
  const { body } = renderSpec({ topic: 't', level: 'L3' });
  check('S7 L3 节确认与复核含独立复核提示', body.includes('L3 必须独立复核'));
}

console.log('\n合计: PASS ' + pass + ' / FAIL ' + failCount);
process.exit(failCount ? 1 : 0);