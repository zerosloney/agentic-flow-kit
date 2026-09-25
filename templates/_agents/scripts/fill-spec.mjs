// flow-kit fill-spec：起草 spec 草稿（功能行为 / 数据流 / 系统改动 / 约束遵守映射 / 风险评估 共 5 节）
// 用法：node .agents/scripts/fill-spec.mjs --topic "test" --output /tmp/x.md
import fs from 'node:fs';
import path from 'node:path';
import { ENUMS } from './workflow-enums.mjs';

const TODAY = new Date().toISOString().slice(0, 10);
const LEVELS = ENUMS['level.all']; // 级别词表单源（.agents/workflow-enums.txt）

function parseArgs(argv) {
  const out = { topic: null, level: 'L2', output: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) return null; return v; };
    if (a === '--topic') out.topic = next();
    else if (a === '--level') out.level = next();
    else if (a === '--output') out.output = next();
  }
  return out;
}

function fail(msg) { console.error(`❌ ${msg}`); process.exit(1); }

const SECTIONS = [
  { title: '功能行为', hint: '<完整描述本 spec 涉及的功能 / 行为变化；分用户场景列；含边界与异常>' },
  { title: '数据流', hint: '<请求→处理→持久化→回应的端到端路径；标出各环节涉及的服务 / 表 / 缓存 / 第三方调用>' },
  { title: '系统改动', hint: '<分模块列出本 spec 引入的所有改动；含新增 / 修改 / 删除；与 plan §改动面 一一对应>' },
  { title: '约束遵守映射', hint: '<逐条对照根 AGENTS.md 与目录级 AGENTS.md（如有）的红线 / 约束，说明本 spec 如何满足；逐条回应而非简单列举>' },
  { title: '风险评估', hint: '<列出本 spec 引入的风险点：数据 / 接口 / 性能 / 安全 / 回滚难度 / 用户影响；评估每个的等级与缓解措施>' },
];

export function renderSpec({ topic, level = 'L2', date = TODAY }) {
  if (!LEVELS.includes(level)) throw new Error(`level 不在枚举 ${LEVELS.join('|')}：${level}`);
  const fm = `---\n状态: draft\n级别: ${level}\n日期: ${date}\n模块: pipeline\n备注: <spec 关联 intent / plan 的同名主题>\n---\n`;
  let body = `# SPEC — ${topic}\n\n<!-- 与 intents/ 下同名入口文档配对；L2/L3 必须先有 ../intents/YYYY-MM-DD-<主题>.md approved -->\n<!-- frontmatter 受限子集（2026-09-13）：状态∈draft/approved/done/superseded/cancelled；级别∈L0/L1/L2/L3；正文不再写状态/级别行 -->\n\n`;
  for (const { title, hint } of SECTIONS) {
    body += `## ${title}\n\n${hint}\n\n`;
  }
  body += `## 确认与复核\n\n- 确认日期：\n- 复核：L3 必须独立复核（independent-reviewer，新会话）；L2 推荐独立复核；L1 可省\n`;
  return { frontmatter: fm, body: fm + body, sections: SECTIONS.map((s) => s.title) };
}

const isMain = import.meta.url === `file:///${process.argv[1]}` || process.argv[1]?.endsWith('fill-spec.mjs');
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.topic || !a.output) fail('必填：--topic / --output；选填：--level（默认 L2）');
  if (!LEVELS.includes(a.level)) fail(`level 必须在 ${LEVELS.join('|')}：${a.level}`);
  const { body } = renderSpec(a);
  fs.mkdirSync(path.dirname(a.output), { recursive: true });
  fs.writeFileSync(a.output, body);
  console.log(`✅ 已生成 spec 草稿：${a.output}（状态 draft / 级别 ${a.level}）`);
}