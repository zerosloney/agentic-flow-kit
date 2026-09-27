#!/usr/bin/env node
// check-pack-eol.mjs — npm publish 前的 EOL 卫生（2026-09-27 p2-batch1 P2-2；同日复核 P1-1 二次收窄）
// 背景：npm pack 从【工作树】读文件且不做 EOL 归一——autocrlf=true 工作树检出为 CRLF，pack 会把
// CRLF 钩子/脚本投递给装户（Linux dash 下 fail-closed；init 审查实测）。git 索引侧由 .gitattributes
// eol=lf 保证入库即 LF（git archive 实测 0 CR），缺口只在「工作树检出态字节」。
// 做法：把 pack 面（bin/src/templates/modules）文本件的 CRLF 就地归一为 LF（与索引字节一致——
// 归一后 git status 本来就干净，clean filter 对 LF 入库无差异；编辑器直写污染则会在 status 可见），
// 然后断言零 CR。fail-closed：任何非文本面/大文件不动，断言不过即 pack 失败。
// 用法：node scripts/check-pack-eol.mjs（prepack 自动跑；也可手动）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_DIRS = ['bin', 'src', 'templates', 'modules'];
const TEXT_EXTS = new Set(['.sh', '.mjs', '.js', '.cjs', '.json', '.md', '.txt', '.html', '.yml', '.yaml']);

let scanned = 0;
let normalized = 0;
const stillBad = [];
for (const dir of PACK_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'cache') continue; // 运行时缓存（prepack 已清；双保险）
        walk(p);
        continue;
      }
      const st = fs.statSync(p);
      if (st.size >= 512 * 1024) continue;
      const buf = fs.readFileSync(p);
      if (buf.includes(0)) continue; // 二进制不在文本断言面
      if (!(TEXT_EXTS.has(path.extname(p)) || !path.extname(p))) continue;
      scanned++;
      if (buf.includes(13)) {
        fs.writeFileSync(p, buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'); // 就地归一（与索引字节一致）
        normalized++;
        if (fs.readFileSync(p).includes(13)) stillBad.push(path.relative(ROOT, p)); // 理论不可达，双保险
      }
    }
  })(abs);
}
if (stillBad.length) {
  console.error(`❌ 发布断言失败：归一后仍含 CR（非 CRLF 形态的孤立 CR，需人工核查）：\n  ${stillBad.join('\n  ')}`);
  process.exit(1);
}
console.log(`✅ 发布 EOL 卫生完成：pack 面 ${scanned} 份文本件零 CR（工作树归一 ${normalized} 份——检出态字节对齐索引，装户收到的 tarball 无 CRLF）`);
