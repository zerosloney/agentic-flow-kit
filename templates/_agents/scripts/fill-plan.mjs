// flow-kit fill-plan：起草 plan 草稿（L1 极简 2 节 / L2-L3 完整 4 节）
// 用法：node .agents/scripts/fill-plan.mjs --level L1 --topic "test" --output /tmp/x.md
// L1：改动面（必填）+ 验证方式（必填）
// L2/L3：改动面 + 任务拆解 + 执行顺序 + 验证方式
import fs from 'node:fs';
import path from 'node:path';

const TODAY = new Date().toISOString().slice(0, 10);
const LEVELS = ['L0', 'L1', 'L2', 'L3'];

function parseArgs(argv) {
  const out = { topic: null, level: 'L1', output: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) return null; return v; };
    if (a === '--topic') out.topic = next();
    else if (a === '--level') out.level = next();
    else if (a === '--output') out.output = next();
  }
  return out;
}

function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

const L1_SECTIONS = [
  { title: '改动面（L1 极简形态主节；L2/L3 可作任务拆解的汇总或删本节）', hint: '- <文件/组件>：<做什么；判据细节直接写进条目，如「L771 message.success 改『更新成功』>' },
  { title: '验证方式', hint: '- 静态门：项目构建命令（+ 项目测试命令，测试项目就绪后）\n- 前端：cd frontend && npm run build（vue-tsc）\n- UI：.agents/commands/test.md（涉及页面改动必走，headless Chrome 实测）\n- L2 追加：<契约 / 规则面比对：编码结果抽样 / 接口契约断言 / 口径对账>\n- L3 追加：<含 schema 变更：备份 + 回滚 SQL 就绪后执行；仅运行时 / 管线：回退上一 release tag + 配置开关预案>' },
];

const FULL_SECTIONS = [
  L1_SECTIONS[0],
  { title: '任务拆解（L2/L3 必填；L1 仅多文件多步骤时用，单任务微改动删本节）', hint: '1. <任务>\n   - 判据：<怎样算完成；尽量对应一个测试或可复现操作>\n   - 风险：低 / 中 / 高（<原因>）\n2. <任务>\n   - 判据：…\n   - 风险：…' },
  { title: '执行顺序（L2/L3 必填；L1 单文件微改动删本节）', hint: '<1 → 2 → 3；标注依赖关系>' },
  L1_SECTIONS[1],
];

export function renderPlan({ topic, level = 'L1', date = TODAY }) {
  if (!LEVELS.includes(level)) throw new Error('level 不在枚举 ' + LEVELS.join('|') + '：' + level);
  const sections = level === 'L1' ? L1_SECTIONS : FULL_SECTIONS;
  const fm = '---\n状态: draft\n级别: ' + level + '\n模块: pipeline\n---\n';
  let body = '# PLAN — ' + topic + '\n\n<!-- 与 intents/ 或 incidents/ 下同名入口文档配对；L2/L3 必须先有 ../specs/ 同名 spec 确认通过；AI 起草、用户对话内确认后开工 -->\n<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->\n<!-- L1 极简形态（2026-09-13 瘦身，L1 默认）：单/少文件微改动只填「改动面」+「验证方式」两节——改动面逐条列改哪个文件做什么（判据细节直接写进条目），验证一行静态门 + 按需 UI 实测；任务拆解/执行顺序仅 L1 多文件多步骤时保留 -->\n\n对应入口：../intents/YYYY-MM-DD-<主题>.md 或 ../incidents/YYYY-MM-DD-<主题>.md（保留实际一项）\n对应 spec：../specs/YYYY-MM-DD-<主题>.md（L1 可省略）\n\n';
  for (const { title, hint } of sections) {
    body += '## ' + title + '\n\n' + hint + '\n\n';
  }
  body += '## 确认与复核\n\n> 确认 = 用户在对话内一句话通过；确认后本 plan 状态 draft → approved 并回填本节（确认环节的机器可见态），done 只在关单出现——禁从 draft 直跳 done（2026-09-22 papercut）。\n- 确认结果：approved（YYYY-MM-DD 用户对话内确认）；done（YYYY-MM-DD 关单，随入口文档置终态）\n- 确认门记录：plan 草稿全文过目 + 改动清单确认（build.md 两道门，逐次，不合并）\n- 复核：L1 不要求独立复核\n';
  return { frontmatter: fm, body: fm + body, sections: sections.map((s) => s.title) };
}

const isMain = process.argv[1] && process.argv[1].endsWith('fill-plan.mjs');
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.topic || !a.output) fail('必填：--topic / --output；选填：--level（默认 L1）');
  if (!LEVELS.includes(a.level)) fail('level 必须在 ' + LEVELS.join('|') + '：' + a.level);
  const { body } = renderPlan(a);
  fs.mkdirSync(path.dirname(a.output), { recursive: true });
  fs.writeFileSync(a.output, body);
  console.log('✅ 已生成 plan 草稿：' + a.output + '（状态 draft / 级别 ' + a.level + ' / ' + (a.level === 'L1' ? '极简 2 节' : '完整 4 节') + '）');
}
export default renderPlan;