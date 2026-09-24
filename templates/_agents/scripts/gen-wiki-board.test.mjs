#!/usr/bin/env node
// gen-wiki-board.mjs 的 fixture 驱动测试（2026-09-21 随 CRLF 解析缺陷修复引入）
// 现场构造临时 wiki 根，以「换 cwd」方式运行被测脚本（脚本按相对路径 'wiki/' 读盘，无需注入口）。
// 断言：①CRLF 下速览表「用途」列（唯一人工维护位）重生成后保持——papercut 2026-09-17 缺陷回归；
//       ②行尾保持（CRLF 不被改写成 LF）；③新增 wiki 文件后速览计数 / 合计行 / 看板 DATA 同步。
// 用法：node .agents/scripts/gen-wiki-board.test.mjs（在仓库任意目录执行均可）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.join(SCRIPT_DIR, 'gen-wiki-board.mjs');
const USAGE = '用法：node .agents/scripts/gen-wiki-board.test.mjs';

const USAGE_COL = '主题A 用途说明（人工列）';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

// 行尾统计：验证 CRLF fixture 不被改写成 LF
const eolStats = (p) => {
  const b = fs.readFileSync(p);
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 10) { if (i > 0 && b[i - 1] === 13) crlf++; else lf++; }
  }
  return { crlf, lf };
};

// mkfix：建临时 wiki 根（INDEX 按 eol 拼装；看板 DATA 块固定 LF——与仓库现状一致）
const mkfix = (eol) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-wiki-board-test-'));
  fs.mkdirSync(path.join(root, 'wiki', '主题A'), { recursive: true });
  fs.mkdirSync(path.join(root, 'wiki', 'drafts-archive'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wiki', '主题A', 'a.md'), '# a\n', 'utf8');
  fs.writeFileSync(path.join(root, 'wiki', 'INDEX.md'), [
    '# wiki 索引（fixture）',
    '',
    '| 主题 | 文件数 | 用途 |',
    '|---|---|---|',
    `| 主题A | 1 | ${USAGE_COL} |`,
    '| drafts-archive | — | 原文档备份（按 日期-主题 分目录） |',
    '',
    '合计：**1 份**知识文档，**1 个主题**',
    '',
    '---',
    '',
    '## 文件 → 主题 → 归属目录 映射表',
    '',
    '### 主题A（1）',
    '',
    '| 文件名 | 主题 | 归属目录 |',
    '|---|---|---|',
    '| a.md | 主题A | wiki/主题A/ |',
    '',
    '---',
    '',
    '## 命名规则',
    '',
    '- fixture',
    '',
  ].join(eol), 'utf8');
  fs.writeFileSync(path.join(root, 'wiki', '知识沉淀总览.html'), [
    '<!doctype html><html><body>',
    '<script>',
    'const DATA = {',
    '  "summary": { "total": 1, "topics": 1, "files": 1, "archive": 0 },',
    '  "topics": [',
    '    { "name": "主题A", "files": [',
    '      { "file": "a.md", "topic": "主题A", "dir": "./主题A/" }',
    '    ]}',
    '  ]',
    '};',
    '</script>',
    '</body></html>',
    '',
  ].join('\n'), 'utf8');
  return root;
};

const runGen = (root) => spawnSync(process.execPath, [GEN], { cwd: root, encoding: 'utf8' });

// ---- 场景 1：CRLF INDEX ——「用途」列重生成后保持 + 行尾保持（缺陷回归）----
{
  const root = mkfix('\r\n');
  const r = runGen(root);
  const out = fs.readFileSync(path.join(root, 'wiki', 'INDEX.md'), 'utf8');
  const { crlf, lf } = eolStats(path.join(root, 'wiki', 'INDEX.md'));
  check('场景 1：CRLF INDEX 生成器 exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check(`场景 1：「用途」列保持（CRLF 致整表解析为空即丢——papercut 2026-09-17）`, out.includes(USAGE_COL), out.split('\n').slice(0, 10).join('\n'));
  check('场景 1：未退化为 <待补>', !out.includes('<待补'), out.split('\n').slice(0, 10).join('\n'));
  check('场景 1：行尾保持 CRLF（未被改写为 LF）', crlf > 0 && lf === 0, `crlf=${crlf} bareLF=${lf}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 2：LF INDEX 对照 —— 用途保持（证明解析不依赖行尾）----
{
  const root = mkfix('\n');
  const r = runGen(root);
  const out = fs.readFileSync(path.join(root, 'wiki', 'INDEX.md'), 'utf8');
  const { crlf, lf } = eolStats(path.join(root, 'wiki', 'INDEX.md'));
  check('场景 2：LF INDEX 生成器 exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 2：「用途」列保持', out.includes(USAGE_COL), out.split('\n').slice(0, 10).join('\n'));
  check('场景 2：行尾保持 LF', lf > 0 && crlf === 0, `crlf=${crlf} bareLF=${lf}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 3：新增 wiki 文件 —— 速览计数 / 合计行 / 看板 DATA 同步 ----
{
  const root = mkfix('\r\n');
  fs.writeFileSync(path.join(root, 'wiki', '主题A', 'b.md'), '# b\n', 'utf8');
  const r = runGen(root);
  const index = fs.readFileSync(path.join(root, 'wiki', 'INDEX.md'), 'utf8');
  const board = fs.readFileSync(path.join(root, 'wiki', '知识沉淀总览.html'), 'utf8');
  check('场景 3：新增文件后生成器 exit 0', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 3：速览表计数同步为 2', /\| 主题A \| 2 \|/.test(index), index.split('\n').slice(0, 8).join('\n'));
  check('场景 3：合计行同步为 2 份', index.includes('合计：**2 份**知识文档，**1 个主题**'), index.split('\n').slice(0, 12).join('\n'));
  check('场景 3：看板 DATA 同步 total=2', /"summary": \{ "total": 2/.test(board), '');
  check('场景 3：「用途」列保持', index.includes(USAGE_COL), '');
  check('场景 3：映射表节收录新文件', index.includes('| b.md | 主题A | wiki/主题A/ |'), '');
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 4：映射表锚点缺失 → fail-loud（2026-09-24 审查修复：原静默跳过致映射表悄悄陈旧仍报成功）----
{
  const root = mkfix('\n');
  const idx = path.join(root, 'wiki', 'INDEX.md');
  fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/^## 文件 → 主题 → 归属目录 映射表$/m, '## 映射（锚点被改）'), 'utf8');
  const r = runGen(root);
  check('场景 4：映射表锚点缺失 → exit 1', r.status === 1, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 4：报错点名映射表锚点', (r.stderr || '').includes('映射表锚点'), r.stderr);
  check('场景 4：未写盘（INDEX 原样保留）', fs.readFileSync(idx, 'utf8').includes('## 映射（锚点被改）'), '');
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- 场景 5：drafts-archive 缺失 → 不崩栈，警告 + 归档按 0（2026-09-24 审查修复）----
{
  const root = mkfix('\n');
  fs.rmSync(path.join(root, 'wiki', 'drafts-archive'), { recursive: true });
  const r = runGen(root);
  check('场景 5：drafts-archive 缺失 → exit 0（不崩栈）', r.status === 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  check('场景 5：stderr 有缺失警告', (r.stderr || '').includes('drafts-archive'), r.stderr);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log(`\n${USAGE}`);
  process.exit(1);
}
process.exit(0);
