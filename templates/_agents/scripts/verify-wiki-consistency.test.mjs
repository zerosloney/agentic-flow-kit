// verify-wiki-consistency.test.mjs — wiki 三方一致性验证（2026-10-09 engine-quality-round2 A2 补测）
// 此前 exempt 表登记「无覆盖」——本套件补齐后移出豁免。三场景：三方一致（绿）/ 磁盘多文件未登记（红）/
// drafts-archive 协议目录缺失（红）。脚本自足（仅 node 标准库 + cwd 相对读 wiki/），fixture 子进程跑真脚本。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
};

function mkWiki({ extraDiskFile = false, noArchive = false } = {}) {
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'vwc-'));
  fs.mkdirSync(path.join(fx, 'wiki', '主题A'), { recursive: true });
  fs.writeFileSync(path.join(fx, 'wiki', '主题A', '文档1.md'), '# 文档1\n\n无外链。\n');
  if (extraDiskFile) fs.writeFileSync(path.join(fx, 'wiki', '主题A', '文档2.md'), '# 文档2\n');
  if (!noArchive) fs.mkdirSync(path.join(fx, 'wiki', 'drafts-archive'), { recursive: true });
  fs.writeFileSync(path.join(fx, 'wiki', 'INDEX.md'), [
    '# Wiki 索引',
    '',
    '## 主题目录速览',
    '',
    '| 主题 | 文件数 | 用途 |',
    '|---|---|---|',
    '| 主题A | 1 | 测试主题 |',
    '',
    '## 映射表',
    '',
    '| 文件 | 用途 | 路径 |',
    '|---|---|---|',
    '| 文档1.md | 测试 | wiki/主题A/文档1.md |',
    '',
    `合计：**1 份**知识文档，**1 个主题**`,
    '',
  ].join('\n'));
  const DATA = {
    topics: [{ name: '主题A', files: [{ file: '文档1.md', dir: '主题A' }] }],
    summary: { total: 1, files: 1, topics: 1, archive: 0 },
  };
  fs.writeFileSync(path.join(fx, 'wiki', '知识沉淀总览.html'),
    '<!doctype html><script>\nconst DATA = ' + JSON.stringify(DATA, null, 2) + ';\n</script>\n');
  return fx;
}

const run = (fx) => spawnSync(process.execPath, [path.join(SRC, 'verify-wiki-consistency.mjs')], {
  cwd: fx, encoding: 'utf8',
});

{
  // ① 三方一致 → exit 0
  const fx = mkWiki();
  const r = run(fx);
  check('① 三方一致 → exit 0', r.status === 0, `status=${r.status}\n${(r.stdout || '') + (r.stderr || '')}`.slice(0, 500));
  fs.rmSync(fx, { recursive: true, force: true });
}
{
  // ② 磁盘多文件未登记 → exit 1（合计行 fail-loud 最先拦——INDEX 合计 1 份 vs 磁盘 2 份；
  //   该检查在脚本内先于三方文件比对出账，是同问题的合法拦截路径）
  const fx = mkWiki({ extraDiskFile: true });
  const r = run(fx);
  const out = (r.stdout || '') + (r.stderr || '');
  check('② 磁盘多文件未登记 → exit 1 且合计行拦（INDEX 1 份 vs 磁盘 2 份）',
    r.status === 1 && out.includes('INDEX 合计行与磁盘不一致'), `status=${r.status}\n${out.slice(0, 500)}`);
  fs.rmSync(fx, { recursive: true, force: true });
}
{
  // ③ drafts-archive 协议目录缺失 → exit 1（门禁明示失败而非崩栈，2026-09-24 口径）
  const fx = mkWiki({ noArchive: true });
  const r = run(fx);
  const out = (r.stdout || '') + (r.stderr || '');
  check('③ drafts-archive 缺失 → exit 1 且明示', r.status === 1 && out.includes('drafts-archive'), `status=${r.status}\n${out.slice(0, 400)}`);
  fs.rmSync(fx, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
