// fill-plan.test.mjs — fill-plan 工具测试（2026-09-25 doc-fill-tools）
import { renderPlan } from './fill-plan.mjs';

let pass = 0, failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { failCount++; console.log('FAIL ' + name + (detail ? '——' + detail : '')); }
}

// ---- 场景 1：L1 极简 2 节 ----
{
  const { body } = renderPlan({ topic: 't', level: 'L1' });
  const sections = body.match(/^##\s.+$/gm) || [];
  check('S1 L1 含节 ## 改动面', body.includes('## 改动面'));
  check('S1 L1 含节 ## 验证方式', body.includes('## 验证方式'));
  check('S1 L1 共 3 节（改动面 + 验证方式 + 确认与复核）', sections.length === 3, '实际 ' + sections.length + ' 节');
}

// ---- 场景 2：L2 完整 4 节 ----
{
  const { body } = renderPlan({ topic: 't', level: 'L2' });
  const sections = body.match(/^##\s.+$/gm) || [];
  check('S2 L2 含节 ## 改动面', body.includes('## 改动面'));
  check('S2 L2 含节 ## 任务拆解', body.includes('## 任务拆解'));
  check('S2 L2 含节 ## 执行顺序', body.includes('## 执行顺序'));
  check('S2 L2 含节 ## 验证方式', body.includes('## 验证方式'));
  check('S2 L2 共 5 节（4 节 + 确认与复核）', sections.length === 5, '实际 ' + sections.length + ' 节');
}

// ---- 场景 3：L3 与 L2 同结构 ----
{
  const { body } = renderPlan({ topic: 't', level: 'L3' });
  check('S3 L3 含节 ## 改动面', body.includes('## 改动面'));
  check('S3 L3 含节 ## 任务拆解', body.includes('## 任务拆解'));
}

// ---- 场景 4：非法 level 抛错 ----
{
  let threw = false;
  try { renderPlan({ topic: 't', level: 'X' }); } catch { threw = true; }
  check('S4 非法 level 抛错', threw);
}

// ---- 场景 5：默认 L1 ----
{
  const { body } = renderPlan({ topic: 't' });
  check('S5 默认级别 L1', /级别:\s*L1/.test(body.match(/^---([\s\S]*?)---/)[1]));
}

// ---- 场景 6：frontmatter 含 3 字段（与 _TEMPLATE 对齐——L1 plan 无日期字段）----
{
  const { body } = renderPlan({ topic: 't', level: 'L1' });
  const fm = body.match(/^---([\s\S]*?)---/)[1];
  check('S6 frontmatter 含状态', /状态:/.test(fm));
  check('S6 frontmatter 含级别', /级别:/.test(fm));
  check('S6 frontmatter 含模块', /模块:/.test(fm));
}

// ---- 场景 7：与入口配对提示 ----
{
  const { body } = renderPlan({ topic: 't', level: 'L1' });
  check('S7 含「对应入口」段', body.includes('对应入口：'));
  check('S7 含「对应 spec」段（L1 可省略）', body.includes('对应 spec：'));
}

console.log('\n合计: PASS ' + pass + ' / FAIL ' + failCount);
process.exit(failCount ? 1 : 0);