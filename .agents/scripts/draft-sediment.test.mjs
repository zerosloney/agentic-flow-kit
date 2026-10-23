#!/usr/bin/env node
// draft-sediment.mjs 测试（B2，2026-10-10）——纯函数直测 + fixture 子进程跑真 CLI
// 纯函数（extractSections/topicOf/renderDraft/setSedimentField）import 直测；CLI 场景
// 以「换 cwd」方式在临时仓跑真脚本（脚本按相对路径 workflow/ + wiki/ 读写，无需注入口）。
// 覆盖：抽节/主题取法/草稿渲染/沉淀字段回写的纯逻辑 + dry-run 不写盘 / 实跑落草稿并回写
//   并重跑 gen-wiki-board / 状态守卫拦非 done|closed / 无高价值节拒抽 / 路径越界拒收
// 用法：node .agents/scripts/draft-sediment.test.mjs（仓库任意目录执行均可）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractSections, topicOf, renderDraft, setSedimentField } from './draft-sediment.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SED = path.join(SCRIPT_DIR, 'draft-sediment.mjs');
const TODAY = new Date().toISOString().slice(0, 10); // 与脚本内取法一致（草稿目录日期段）
const USAGE = '用法：node .agents/scripts/draft-sediment.test.mjs';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

// ---- 纯函数：extractSections ----
{
  const text = [
    '# INTENT — 权限收敛',
    '',
    '## 影响面',
    '',
    '- 模块：pipeline',
    '- 数据库：无',
    '',
    '## 触达红线与边界',
    '',
    '> 这是引用块，应被剔除',
    '<!-- 注释也应剔除 -->',
    '<占位单行也应剔除>',
    '- [x] 规则变更（证据：abc123）',
    '',
    '## 目标（不在抽取词表内）',
    '',
    '- 不应被抽出来',
    '',
    '## 影响面（空节）',
    '',
    '<待补>',
    '',
  ].join('\n');
  const got = extractSections(text, ['影响面', '触达红线']);
  const titles = got.map((s) => s.title);
  check('1a 抽取指定节（影响面）', titles.includes('影响面'), JSON.stringify(titles));
  check('1b 节标题前缀匹配（「触达红线与边界」命中「触达红线」）', titles.includes('触达红线与边界'), JSON.stringify(titles));
  check('1c 词表外节不抽（目标节缺席）', !titles.some((t) => t.startsWith('目标')), JSON.stringify(titles));
  const yx = got.find((s) => s.title === '影响面');
  check('1d 正文保留（模块行入库）', yx && yx.body.includes('- 模块：pipeline'), yx && yx.body);
  const hx = got.find((s) => s.title === '触达红线与边界');
  check('1e 占位行剔除（引用块/注释/单行尖括号均不进 body）',
    hx && !hx.body.includes('引用块') && !hx.body.includes('注释也应') && !hx.body.includes('占位单行')
    && hx.body.includes('规则变更（证据：abc123）'), hx && hx.body);
  check('1f 仅占位的空节被丢弃（「影响面（空节）」不入结果）',
    !titles.includes('影响面（空节）'), JSON.stringify(titles));
}

// ---- 纯函数：topicOf（标题行优先于文件名）----
{
  check('2a 标题行优先（# INTENT — 权限收敛 胜过文件名尾段 perm）',
    topicOf('workflow/intents/2026-10-10-perm.md', '# INTENT — 权限收敛\n') === '权限收敛', '');
  check('2b 无标题行退文件名尾段（去日期前缀）',
    topicOf('workflow/intents/2026-10-10-perm.md', '# 无标题文档\n') === 'perm', '');
  check('2c 无标题无日期退文件基名',
    topicOf('wiki/随便/a.md', '# 无标题文档\n') === 'a', '');
  check('2d INCIDENT 标题行同样识别',
    topicOf('workflow/incidents/2026-09-12-x.md', '# INCIDENT — 越权写操作\n') === '越权写操作', '');
}

// ---- 纯函数：renderDraft ----
{
  const out = renderDraft({ topic: '权限收敛', date: '2026-10-10', source: 'workflow/intents/2026-10-10-perm.md',
    sections: [{ title: '影响面', body: '- 模块：pipeline' }], kind: 'intent' });
  check('3a frontmatter 含来源与草稿状态', out.startsWith('---\n') && out.includes('来源: workflow/intents/2026-10-10-perm.md')
    && out.includes('状态: 草稿（待人工归类）'), out.split('\n').slice(0, 5).join('\n'));
  check('3b intent 渲染为「需求沉淀草稿」', out.includes('# 权限收敛（需求沉淀草稿）'), out.split('\n')[4]);
  check('3c incident 渲染为「事故复盘草稿」',
    renderDraft({ topic: 't', date: '2026-10-10', source: 's', sections: [], kind: 'incident' })
      .includes('# t（事故复盘草稿）'), '');
  check('3d 抽取节原样落到正文 ## 节下', out.includes('## 影响面\n\n- 模块：pipeline'), out);
  check('3e 草稿头含中间态提示（引导人工归类）', out.includes('中间态'), out);
}

// ---- 纯函数：setSedimentField ----
{
  const fm = (body) => `---\n${body}\n---\n# INTENT — t\n`;
  const a = setSedimentField(fm('状态: done\n级别: L1'), 'wiki/drafts-archive/2026-10-10-t/t.md');
  check('4a 无沉淀字段 → 追加且 changed=true',
    a.changed && a.text.includes('沉淀: wiki/drafts-archive/2026-10-10-t/t.md')
    && a.text.includes('# INTENT — t\n'), a.text);
  const b = setSedimentField(fm('状态: done\n沉淀: 无'), 'wiki/drafts-archive/2026-10-10-t/t.md');
  check('4b 「沉淀: 无」显式豁免位 → 覆盖（豁免是占位，可写）',
    b.changed && b.text.includes('沉淀: wiki/drafts-archive/2026-10-10-t/t.md'), b.text);
  const c = setSedimentField(fm('状态: done\n沉淀: wiki/规范/x.md'), 'wiki/drafts-archive/2026-10-10-t/t.md');
  check('4c 已有人工登记 → 不覆盖 changed=false（防误抹）',
    !c.changed && c.text.includes('沉淀: wiki/规范/x.md'), c.text);
  const d = setSedimentField('# 无 frontmatter 的文档\n', 'wiki/drafts-archive/x.md');
  check('4d 无 frontmatter → 不动 changed=false', !d.changed, d.text);
  const e = setSedimentField(fm('状态: done\n沉淀:  '), 'wiki/drafts-archive/y.md');
  check('4e 空值沉淀位 → 覆盖（空同未填）',
    e.changed && e.text.includes('沉淀: wiki/drafts-archive/y.md'), e.text);
}

// ---- fixture：临时仓（wiki 根带 INDEX/看板锚点，供 gen-wiki-board 重跑；workflow 两目录）----
const mkfx = () => {
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-sed-test-'));
  fs.mkdirSync(path.join(fx, 'wiki', '主题A'), { recursive: true });
  fs.mkdirSync(path.join(fx, 'wiki', 'drafts-archive'), { recursive: true });
  fs.writeFileSync(path.join(fx, 'wiki', '主题A', 'a.md'), '# a\n', 'utf8');
  fs.writeFileSync(path.join(fx, 'wiki', 'INDEX.md'), [
    '# wiki 索引（fixture）', '',
    '| 主题 | 文件数 | 用途 |', '|---|---|---|',
    '| 主题A | 1 | fixture 主题 |',
    '| drafts-archive | — | 原文档备份（按 日期-主题 分目录）', '',
    '合计：**1 份**知识文档，**1 个主题**', '',
    '---', '', '## 文件 → 主题 → 归属目录 映射表', '',
    '### 主题A（1）', '',
    '| 文件名 | 主题 | 归属目录 |', '|---|---|---|',
    '| a.md | 主题A | wiki/主题A/ |', '', '---', '',
    '## 命名规则', '', '- fixture', '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(fx, 'wiki', '知识沉淀总览.html'), [
    '<!doctype html><html><body><script>', 'const DATA = {',
    '  "summary": { "total": 1, "topics": 1, "files": 1, "archive": 0 },',
    '  "topics": [ { "name": "主题A", "files": [',
    '      { "file": "a.md", "topic": "主题A", "dir": "./主题A/" } ]} ]',
    '};', '</script></body></html>', '',
  ].join('\n'), 'utf8');
  fs.mkdirSync(path.join(fx, 'workflow', 'intents'), { recursive: true });
  fs.mkdirSync(path.join(fx, 'workflow', 'incidents'), { recursive: true });
  return fx;
};

// 高价值正文（intent：影响面 + 触达红线均有实质内容）
const INTENT_DONE = [
  '---', '状态: done', '级别: L1', '日期: 2026-10-10', '模块: pipeline', '---',
  '# INTENT — 权限收敛', '',
  '## 影响面', '', '- 模块：pipeline', '- 数据库：无', '',
  '## 触达红线', '', '- [x] 规则 / 契约变更（证据：abc123）', '',
  '## 验收标准（可测试）', '', '- [x] 全绿（证据：npm test）', '',
].join('\n');

// 高价值正文（incident：复盘三件套齐全）
const INC_CLOSED = [
  '---', '状态: closed', '级别: L1', '日期: 2026-09-12', '---',
  '# INCIDENT — 越权写操作', '',
  '## 影响面', '', '- 只读接口被放行写操作。', '',
  '## 根因', '', '- 鉴权中间件早于路由注册生效。', '',
  '## 为什么之前没拦住', '', '- 测试只覆盖了 happy path。', '',
  '## 复盘三件套', '', '- 修复：注册顺序对调（SHA abc123）。', '- 防复发：加契约测试。', '- 台账：已登记。', '',
].join('\n');

const runSed = (fx, targetArgs) => spawnSync(process.execPath, [SED, ...targetArgs], {
  cwd: fx, encoding: 'utf8',
});

// ---- CLI 5：--dry-run 不写盘 ----
{
  const fx = mkfx();
  fs.writeFileSync(path.join(fx, 'workflow', 'intents', '2026-10-10-perm.md'), INTENT_DONE, 'utf8');
  const r = runSed(fx, ['workflow/intents/2026-10-10-perm.md', '--dry-run']);
  const out = (r.stdout || '') + (r.stderr || '');
  check('5a --dry-run exit 0 且明示未写盘', r.status === 0 && out.includes('未写盘'), `exit=${r.status}\n${out.slice(0, 400)}`);
  check('5b 未落草稿（drafts-archive 仍空）',
    fs.readdirSync(path.join(fx, 'wiki', 'drafts-archive')).length === 0, '');
  check('5c 源文件未回写（无沉淀字段）',
    !fs.readFileSync(path.join(fx, 'workflow', 'intents', '2026-10-10-perm.md'), 'utf8').includes('沉淀:'), '');
  check('5d 预览含来源与抽取节标题', out.includes('来源: workflow/intents/2026-10-10-perm.md')
    && out.includes('## 影响面') && out.includes('## 触达红线'), out);
  check('5e 主题取标题行（权限收敛）而非文件名尾段（perm）',
    out.includes('wiki/drafts-archive/' + TODAY + '-权限收敛'), out);
  fs.rmSync(fx, { recursive: true, force: true });
}

// ---- CLI 6：实跑 intent —— 落草稿 + 回写沉淀 + 重跑 gen-wiki-board ----
{
  const fx = mkfx();
  fs.writeFileSync(path.join(fx, 'workflow', 'intents', '2026-10-10-perm.md'), INTENT_DONE, 'utf8');
  const r = runSed(fx, ['workflow/intents/2026-10-10-perm.md']);
  const out = (r.stdout || '') + (r.stderr || '');
  const draftP = path.join(fx, 'wiki', 'drafts-archive', `${TODAY}-权限收敛`, '权限收敛.md');
  check('6a 实跑 exit 0', r.status === 0, `exit=${r.status}\n${out.slice(0, 500)}`);
  check('6b 草稿落到 drafts-archive/<日期-主题>/<主题>.md',
    fs.existsSync(draftP), `期望存在：${draftP}`);
  const draft = fs.existsSync(draftP) ? fs.readFileSync(draftP, 'utf8') : '';
  check('6c 草稿带来源 frontmatter 指回源文件',
    draft.startsWith('---\n') && draft.includes('来源: workflow/intents/2026-10-10-perm.md')
    && draft.includes('（需求沉淀草稿）'), draft.split('\n').slice(0, 6).join('\n'));
  const src = fs.readFileSync(path.join(fx, 'workflow', 'intents', '2026-10-10-perm.md'), 'utf8');
  check('6d 源文件回写沉淀字段（B1 闭环——断链 WARN 由此消除）',
    src.includes(`沉淀: wiki/drafts-archive/${TODAY}-权限收敛/权限收敛.md`), src.split('\n').slice(0, 7).join('\n'));
  const board = fs.readFileSync(path.join(fx, 'wiki', '知识沉淀总览.html'), 'utf8');
  check('6e gen-wiki-board 已重跑（看板归档计数 0→1）',
    /"archive": 1/.test(board) && out.includes('gen-wiki-board'), board.split('\n').slice(0, 6).join('\n'));
  check('6f 沉淀回写幂等：再跑一次不覆盖已有登记（changed=false 分支）',
    runSed(fx, ['workflow/intents/2026-10-10-perm.md']).status === 0
    && src.includes(`沉淀: wiki/drafts-archive/${TODAY}-权限收敛/权限收敛.md`), '');
  fs.rmSync(fx, { recursive: true, force: true });
}

// ---- CLI 7：实跑 incident —— 事故口径四节 ----
{
  const fx = mkfx();
  fs.writeFileSync(path.join(fx, 'workflow', 'incidents', '2026-09-12-x.md'), INC_CLOSED, 'utf8');
  const r = runSed(fx, ['workflow/incidents/2026-09-12-x.md']);
  const draftP = path.join(fx, 'wiki', 'drafts-archive', `${TODAY}-越权写操作`, '越权写操作.md');
  const draft = fs.existsSync(draftP) ? fs.readFileSync(draftP, 'utf8') : '';
  check('7a incident 实跑 exit 0 且草稿落盘', r.status === 0 && fs.existsSync(draftP),
    `exit=${r.status}\n${(r.stdout || '') + (r.stderr || '')}`.slice(0, 400));
  check('7b 草稿为事故复盘口径（标题 + 四节齐备）',
    draft.includes('（事故复盘草稿）') && ['影响面', '根因', '为什么之前没拦住', '复盘三件套']
      .every((h) => draft.includes('## ' + h)), draft.slice(0, 300));
  check('7c 源文件回写沉淀字段',
    fs.readFileSync(path.join(fx, 'workflow', 'incidents', '2026-09-12-x.md'), 'utf8')
      .includes(`沉淀: wiki/drafts-archive/${TODAY}-越权写操作/越权写操作.md`), '');
  fs.rmSync(fx, { recursive: true, force: true });
}

// ---- CLI 8：守卫（状态 / 无高价值节 / 路径越界）----
{
  const fx = mkfx();
  // 8a 非 done intent
  fs.writeFileSync(path.join(fx, 'workflow', 'intents', 'a-draft.md'),
    INTENT_DONE.replace('状态: done', '状态: draft'), 'utf8');
  const r8a = runSed(fx, ['workflow/intents/a-draft.md']);
  check('8a 非 done intent → exit 1 且明示状态要求',
    r8a.status === 1 && (r8a.stderr || '').includes('须为 done'), `exit=${r8a.status}\n${r8a.stderr}`);
  // 8b 非 closed incident
  fs.writeFileSync(path.join(fx, 'workflow', 'incidents', 'b-open.md'),
    INC_CLOSED.replace('状态: closed', '状态: open'), 'utf8');
  const r8b = runSed(fx, ['workflow/incidents/b-open.md']);
  check('8b 非 closed incident → exit 1 且明示状态要求',
    r8b.status === 1 && (r8b.stderr || '').includes('须为 closed'), `exit=${r8b.status}\n${r8b.stderr}`);
  // 8c 高价值节全为占位 → 拒抽
  fs.writeFileSync(path.join(fx, 'workflow', 'intents', 'c-empty.md'), [
    '---', '状态: done', '---', '# INTENT — 空单', '',
    '## 影响面', '', '<待补>', '', '## 触达红线', '', '<待补>', '',
  ].join('\n'), 'utf8');
  const r8c = runSed(fx, ['workflow/intents/c-empty.md']);
  check('8c 高价值节仅占位 → exit 1 且明示无沉淀价值',
    r8c.status === 1 && (r8c.stderr || '').includes('未抽取到高价值节'), `exit=${r8c.status}\n${r8c.stderr}`);
  check('8c 占位拒抽不落草稿', !fs.existsSync(path.join(fx, 'wiki', 'drafts-archive', `${TODAY}-空单`)), '');
  // 8d 路径在 workflow/ 外
  fs.writeFileSync(path.join(fx, 'outside.md'), INTENT_DONE, 'utf8');
  const r8d = runSed(fx, ['outside.md']);
  check('8d 源文件不在 workflow/intents|incidents 下 → exit 1',
    r8d.status === 1 && (r8d.stderr || '').includes('workflow/intents'), `exit=${r8d.status}\n${r8d.stderr}`);
  // 8e 不存在的文件
  const r8e = runSed(fx, ['workflow/intents/不存在.md']);
  check('8e 源文件不存在 → exit 1', r8e.status === 1, `exit=${r8e.status}\n${r8e.stderr}`);
  // 8f 无参数
  const r8f = runSed(fx, []);
  check('8f 无源文件参数 → exit 1 且打印用法', r8f.status === 1, `exit=${r8f.status}`);
  fs.rmSync(fx, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(`\n${USAGE}`);
  process.exit(1);
}
process.exit(0);
