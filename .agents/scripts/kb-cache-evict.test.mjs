#!/usr/bin/env node
// kb-cache-evict.mjs 的 fixture 测试（--cache 指临时文件，不触真实缓存）
// 断言：①跨命名空间摘除命中 key、他 key 原样保留、fp 不变；②范围外清单不动缓存；
//       ③坏输入（缺文件/坏 JSON/无 files 字段）静默 exit 0；④stdin 管道路径与 --files-from 等价。
// 用法：node .agents/scripts/kb-cache-evict.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EVICT = path.join(SCRIPT_DIR, 'kb-cache-evict.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const mkCache = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-evict-test-'));
  const file = path.join(dir, 'kb-index.json');
  const entry = (t) => ({ st: [111, 222], kind: 'wf', meta: { 状态: t }, title: 'T', lines: [[1, '(标题)', '# x']] });
  fs.writeFileSync(file, JSON.stringify({
    fp: 'FIXFP00000000000',
    files: {
      'CWD1::workflow/intents/a.md': entry('done'),
      'CWD2::workflow/intents/a.md': entry('done'),
      'CWD1::wiki/测试主题/b.md': entry('done'),
      'CWD1::workflow/plans/keep.md': entry('approved'),
      'CWD2::workflow/README.md': entry('draft'),
    },
  }), 'utf8');
  return { dir, file };
};

const run = (argv, opts = {}) => spawnSync(process.execPath, [EVICT, ...argv], { encoding: 'utf8', ...opts });
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const LIST = 'workflow/intents/a.md\nwiki/测试主题/b.md\nbackend/Dtos/X.cs\n';

// ---- 场景 1：跨命名空间摘除 + 他 key 与 fp 保留 ----
{
  const { dir, file } = mkCache();
  const lf = path.join(dir, 'list.txt');
  fs.writeFileSync(lf, LIST, 'utf8');
  const r = run(['--files-from', lf, '--cache', file]);
  const j = load(file);
  check('场景 1：exit 0 且 stderr 空', r.status === 0 && !r.stderr, `exit=${r.status}\n${r.stderr}`);
  check('场景 1：同 rel 跨两命名空间全摘（a.md×2 + b.md×1）',
    !('CWD1::workflow/intents/a.md' in j.files) && !('CWD2::workflow/intents/a.md' in j.files) && !('CWD1::wiki/测试主题/b.md' in j.files), Object.keys(j.files).join('\n'));
  check('场景 1：无关 key 原样保留（keep 与 README 完好，计数 2）',
    Object.keys(j.files).length === 2 && j.files['CWD1::workflow/plans/keep.md']?.meta?.['状态'] === 'approved' && j.files['CWD2::workflow/README.md']?.meta?.['状态'] === 'draft', Object.keys(j.files).join('\n'));
  check('场景 1：fp 保持不变', j.fp === 'FIXFP00000000000', j.fp);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- 场景 2：范围外清单 → 缓存文件逐字节不动 ----
{
  const { dir, file } = mkCache();
  const before = fs.readFileSync(file);
  const lf = path.join(dir, 'list.txt');
  fs.writeFileSync(lf, 'backend/Dtos/X.cs\nwiki\n\n', 'utf8');
  const r = run(['--files-from', lf, '--cache', file]);
  check('场景 2：范围外清单 exit 0 且缓存字节不变', r.status === 0 && fs.readFileSync(file).equals(before), `exit=${r.status}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- 场景 3：坏输入三态静默 exit 0 ----
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-evict-test-'));
  const lf = path.join(dir, 'list.txt');
  fs.writeFileSync(lf, 'workflow/intents/a.md\n', 'utf8');
  const missing = path.join(dir, 'nope.json');
  const garbage = path.join(dir, 'garbage.json');
  fs.writeFileSync(garbage, 'not-json{{{', 'utf8');
  const nofiles = path.join(dir, 'nofiles.json');
  fs.writeFileSync(nofiles, JSON.stringify({ fp: 'x' }), 'utf8');
  const a = run(['--files-from', lf, '--cache', missing]);
  const b = run(['--files-from', lf, '--cache', garbage]);
  const c = run(['--files-from', lf, '--cache', nofiles]);
  check('场景 3：缺缓存/坏 JSON/无 files 字段均 exit 0 且无输出',
    a.status === 0 && b.status === 0 && c.status === 0 && !a.stdout && !b.stdout && !c.stdout && !a.stderr && !b.stderr && !c.stderr,
    `a=${a.status}/${a.stderr} b=${b.status}/${b.stderr} c=${c.status}/${c.stderr}`);
  check('场景 3：清单文件缺失也静默 exit 0', run(['--files-from', path.join(dir, 'nope.txt'), '--cache', garbage]).status === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- 场景 4：stdin 管道与 --files-from 等价（钩子实际走的路径） ----
{
  const { dir, file } = mkCache();
  const r = run(['--cache', file], { input: LIST });
  const j = load(file);
  check('场景 4：stdin 路径摘除同果', r.status === 0 && Object.keys(j.files).length === 2 && !('CWD1::wiki/测试主题/b.md' in j.files), `exit=${r.status} keys=${Object.keys(j.files).join(',')}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log('\n用法：node .agents/scripts/kb-cache-evict.test.mjs');
  process.exit(1);
}
process.exit(0);
