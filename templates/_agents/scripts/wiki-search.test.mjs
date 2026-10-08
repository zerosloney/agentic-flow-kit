// wiki-search.test.mjs — wiki 检索转发壳（2026-10-09 engine-quality-round2 A2 补测）
// 壳语义三断言：①默认 -n 20 + --scope wiki 追加（固定语料=wiki 活跃层）；②用户显式 -n 不被覆盖；
// ③exit 码透传（kb-search 非零 → 壳非零）。fixture 复制壳 + kb-search 及其依赖（workflow-enums/
// 配置文件），wiki 语料一文件命中（kb-search.test 场景 1 已覆盖 kb-search 本体判定，此处只测壳）。
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

const COPIED = ['wiki-search.mjs', 'kb-search.mjs', 'workflow-enums.mjs'];
function mkFixture() {
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  fs.mkdirSync(path.join(fx, '.agents', 'scripts'), { recursive: true });
  for (const f of COPIED) fs.copyFileSync(path.join(SRC, f), path.join(fx, '.agents', 'scripts', f));
  for (const f of ['workflow-enums.txt', 'workflow-modules.txt'])
    fs.copyFileSync(path.join(SRC, '..', f), path.join(fx, '.agents', f));
  fs.mkdirSync(path.join(fx, 'wiki', '测试主题'), { recursive: true });
  fs.writeFileSync(path.join(fx, 'wiki', '测试主题', '说明.md'), '# 说明\n\n编码模板的领域知识条目。\n');
  fs.mkdirSync(path.join(fx, 'workflow', 'intents'), { recursive: true });
  fs.writeFileSync(path.join(fx, 'workflow', 'intents', '2026-10-09-a.md'),
    '---\n状态: approved\n级别: L1\n日期: 2026-10-09\n模块: pipeline\n---\n# INTENT\n\n编码模板的 workflow 侧条目。\n');
  return fx;
}
const run = (fx, args) => spawnSync(process.execPath, [path.join(fx, '.agents', 'scripts', 'wiki-search.mjs'), ...args], {
  cwd: fx, encoding: 'utf8',
});

{
  const fx = mkFixture();
  const r = run(fx, ['编码模板']);
  const out = (r.stdout || '') + (r.stderr || '');
  check('① 默认形态命中 wiki 语料且不含 workflow 语料（--scope wiki 固定）',
    r.status === 0 && out.includes('wiki/测试主题/说明.md') && !out.includes('workflow/intents'), out.slice(0, 400));
  fs.rmSync(fx, { recursive: true, force: true });
}
{
  const fx = mkFixture();
  const r = run(fx, ['-n', '0', '编码模板']);
  check('② 显式 -n 透传（0=不限，不因壳默认覆盖报错）且命中', r.status === 0 && (r.stdout || '').includes('说明.md'), (r.stdout || '').slice(0, 300));
  fs.rmSync(fx, { recursive: true, force: true });
}
{
  const fx = mkFixture();
  const r = run(fx, []); // 无词 → kb-search 用法错误 exit 1
  check('③ exit 码透传（无词 → 壳非零）', (r.status ?? 1) !== 0, `status=${r.status}`);
  fs.rmSync(fx, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
