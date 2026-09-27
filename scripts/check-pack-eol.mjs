#!/usr/bin/env node
// check-pack-eol.mjs — npm publish 前的 EOL 断言（2026-09-27 p2-batch1 P2-2）
// 背景：npm pack 从【工作树】读文件、不做 EOL 归一——autocrlf=true 工作树（Windows 常态）检出为 CRLF，
// 从此工作树发布会把 CRLF 钩子/脚本投递给装户（Linux dash 下 fail-closed 拦死首次提交；init 审查实测）。
// 断言口径：以【git 索引字节】为准（git cat-file，与 rule-budgets「索引字节」同族）——工作树 CRLF 是
// autocrlf 检出态、入库即归 LF，不算失败；索引字节里含 CR 才是真问题（eol=lf 属性漏配或编辑器直写索引）。
// 扫描面：templates/ 下 git tracked 的文本件（.sh/.mjs/.js/.cjs/.json/.md/.txt/.html/.yml/.yaml + 无扩展名）。
// 用法：node scripts/check-pack-eol.mjs（prepack 自动跑；也可手动）
import { execSync } from 'node:child_process';
import path from 'node:path';

const TEXT_EXTS = new Set(['.sh', '.mjs', '.js', '.cjs', '.json', '.md', '.txt', '.html', '.yml', '.yaml']);
const files = execSync('git -c core.quotepath=off ls-files -- templates/', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  .split('\n').map((s) => s.trim()).filter(Boolean)
  .filter((rel) => TEXT_EXTS.has(path.extname(rel)) || !path.extname(rel));

const bad = [];
for (const rel of files) {
  const blob = execSync(`git cat-file blob "HEAD:${rel}"`, { maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  if (blob.includes(13)) bad.push(rel);
}
if (bad.length) {
  console.error(`❌ 发布断言失败：以下 templates/ 文件在 git 索引中含 CR 字节（eol=lf 属性漏配或非检出态污染——npm pack 投递工作树字节，装户将收到 CRLF）：\n  ${bad.join('\n  ')}\n修复：核对 .gitattributes 规则后 git add --renormalize templates/ 并提交`);
  process.exit(1);
}
console.log(`✅ 发布 EOL 断言通过：templates/ ${files.length} 份索引文本件零 CR`);
