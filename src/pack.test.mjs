// pack.test.mjs — npm 打包防线断言：templates/_agents/cache（运行时生成、gitignore）不得进发布包。
// 0.4.0 实发包含测试残留 kb-index.json（incident 2026-09-24-npm-pack-cache-leak）——files 白名单列出
// templates 后 npm-packlist 不再按根 .gitignore 排除目录内文件，须显式负向排除；prepack 兜底物理清除。
// 此处断言配置层两道防线在位（npm 10/11 双版本 pack 行为已在 incident 实测验证）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? `——${detail}` : ''}`); }
}

const files = pkg.files || [];
const prepack = pkg.scripts?.prepack || '';
check('P1 files 负向排除 cache 目录与内容', files.includes('!templates/_agents/cache') && files.includes('!templates/_agents/cache/**'), JSON.stringify(files));
check('P2 prepack 兜底清除 cache 目录', /templates[\\/]_agents[\\/]cache/.test(prepack) && /rmSync/.test(prepack), prepack || 'scripts.prepack 缺失');

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
