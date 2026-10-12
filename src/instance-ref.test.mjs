// instance-ref.test.mjs — 引擎/文档实例引用不变量门（2026-10-11 engine-output-provenance）。
// 公理：引擎面向用户的输出是证据性的——引用的每个出处装户必须可解析（README「不伪造」柱）。
// 此前 check-lane-surface.mjs 阻断消息与 check-loop.mjs WARN 引用包源仓专属的 specs/incidents/papercuts
// 实例文档（装户随包只有 _TEMPLATE 与骨架，路径悬空）——本门把不变量机器化：
//   包源随包下发件（引擎脚本 + 命令/角色/协议文档）不得引用「实例专属的带日期文档路径」。
// 判据形态（宁可窄不可误伤）：
//   /(incidents|specs|intents|plans)\/20\d{2}-/   带日期的实例文档路径（目录前缀引用合法——
//                                                  new-task.md「立 incident（workflow/incidents/）」不受影响）
//   /papercuts(\.md)?\s+20\d{2}/                  papercuts 条目按日期引用（papercuts-cleanup-batch
//                                                  事件名不带空格+日期，不命中）
// 例外：*.test.mjs 夹具里的合法日期文件名；board/（第三方 vendor）。出处一律写「包源仓 git 历史
// 与 CHANGELOG」——立法时间点保留，可解析指针删除。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATTERNS = [
  { re: /(incidents|specs|intents|plans)\/20\d{2}-/g, why: '实例带日期文档路径' },
  { re: /papercuts(\.md)?\s+20\d{2}/g, why: 'papercuts 条目日期引用' },
];
const EXTS = new Set(['.mjs', '.sh', '.cjs', '.md', '.txt', '.json']);
const SKIP_DIR = new Set(['board', '.git', 'node_modules', 'cache']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) yield* walk(path.join(dir, e.name)); continue; }
    if (!EXTS.has(path.extname(e.name))) continue;
    if (e.name.endsWith('.test.mjs')) continue; // 夹具日期文件名合法
    yield path.join(dir, e.name);
  }
}

const targets = [
  ...walk(path.join(ROOT, 'templates')),
  ...fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map((f) => path.join(ROOT, 'src', f)),
  ...fs.readdirSync(path.join(ROOT, 'bin')).filter((f) => f.endsWith('.mjs')).map((f) => path.join(ROOT, 'bin', f)),
  ...fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => path.join(ROOT, 'scripts', f)),
];

const hits = [];
let scanned = 0;
for (const abs of targets) {
  scanned++;
  const lines = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { re, why } of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(lines[i])) hits.push(`${path.relative(ROOT, abs)}:${i + 1}（${why}）`);
    }
  }
}

if (hits.length) {
  console.log(`FAIL 引擎/文档存在实例专属引用（装户径路径悬空）——${hits.length} 处：`);
  for (const h of hits) console.log(`  - ${h}`);
  console.log('修法：出处改写为「留痕在包源仓 git 历史与 CHANGELOG，装户径不引实例路径」；用法示例用 <日期> 占位。');
  process.exit(1);
}
console.log(`PASS 实例引用不变量：${scanned} 份随包源文件零实例专属日期引用`);
console.log(`\n合计: PASS 1 / FAIL 0`);
process.exit(0);
