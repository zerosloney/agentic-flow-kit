// commit-check-trigger.test.mjs — builds/checks 触发判定测试（ext 全局 / prefix 前缀 / 双不命中 / 引擎自改豁免 / --full）。
// 方法：临时 git 仓库 + 被测 hook + 假构建命令（node -e 打标）——不跑真实构建，秒级完成。
// 命名避开装户项目的 commit-check.test.mjs（敏感判据测试，项目自持）——本文件测触发器，随包走。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(SCRIPT_DIR, '..', 'hooks', 'commit-check.cjs');

let pass = 0, fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n       ${detail}` : ''}`); }
};
const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

// mkfix：临时 git 仓 + hook + 触发器假配置（构建命令 = 打标文件，跑没跑看标记存在性）
const mkfix = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-trigger-test-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.agents', 'hooks'), { recursive: true });
  fs.copyFileSync(HOOK, path.join(root, '.agents', 'hooks', 'commit-check.cjs'));
  const marks = path.join(root, 'marks');
  const cmd = (name) => `node -e "require('fs').writeFileSync('${marks.replaceAll('\\', '/').replaceAll('\'', '\\\'')}/${name}','')"`;
  fs.mkdirSync(marks);
  fs.writeFileSync(path.join(root, '.agents', 'hooks', 'commit-check.config.json'), JSON.stringify({
    knownPatterns: [],
    builds: [
      { name: 'extbuild', command: cmd('extbuild'), ext: ['.xyz'] },
      { name: 'prefixbuild', command: cmd('prefixbuild'), prefix: 'docs/' },
    ],
    checks: [],
  }));
  return { root, marks, cmd };
};

// stage：写文件并暂存，跑 hook（extraArgs 透传如 --full），返回 { status, out, ran }
const runHook = (root, extraArgs = []) => {
  const r = spawnSync('node', ['.agents/hooks/commit-check.cjs', ...extraArgs], { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};
const stage = (root, rel, content) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  git(root, ['add', '--', rel]);
};
const ran = (marks, name) => fs.existsSync(path.join(marks, name));

let f = mkfix();

// 场景 1：ext 全局触发——任意目录下 .xyz 命中 extbuild
stage(f.root, 'src/a.xyz', 'x');
let r = runHook(f.root);
check('S1 ext 全局触发（.xyz → extbuild 跑）', ran(f.marks, 'extbuild') && r.status === 0, r.out);

// 场景 2：prefix 前缀触发——docs/ 下任意文件命中 prefixbuild；其他位置同名扩展不命中
f = mkfix();
stage(f.root, 'wiki/看板.html', '<html></html>');
r = runHook(f.root);
check('S2 prefix 外的 .html 不触发 prefixbuild（wiki html 场景）', !ran(f.marks, 'prefixbuild') && r.status === 0, r.out);
stage(f.root, 'docs/readme.md', 'doc');
r = runHook(f.root);
check('S2b docs/ 前缀任意文件触发 prefixbuild', ran(f.marks, 'prefixbuild') && r.status === 0, r.out);

// 场景 3：双不命中 → SKIP 提示且零构建
f = mkfix();
stage(f.root, 'notes/other.txt', 'plain');
r = runHook(f.root);
check('S3 双不命中 → SKIP 提示、无构建', r.out.includes('SKIP') && !ran(f.marks, 'extbuild') && !ran(f.marks, 'prefixbuild') && r.status === 0, r.out);

// 场景 4：引擎自改豁免——.agents/ 下即使放 .xyz 也不触发构建
f = mkfix();
stage(f.root, '.agents/scripts/engine.xyz', 'engine');
r = runHook(f.root);
check('S4 .agents/ 自身变更不触发构建', !ran(f.marks, 'extbuild') && r.status === 0, r.out);

// 场景 5：--full 全跑（合并提交口径）
f = mkfix();
stage(f.root, 'unrelated.txt', 'x');
r = runHook(f.root, ['--full']);
check('S5 --full 无条件全跑全部 builds', ran(f.marks, 'extbuild') && ran(f.marks, 'prefixbuild') && r.status === 0, r.out);

// 场景 6：builds.when = pkg:scripts.build。无脚本则 SKIP 且不执行；文件型 when 缺失仍跳过。
f = mkfix();
fs.writeFileSync(path.join(f.root, '.agents', 'hooks', 'commit-check.config.json'), JSON.stringify({
  knownPatterns: [],
  builds: [{ name: 'build', command: f.cmd('build'), ext: ['.js'], when: ['pkg:scripts.build'] }],
  checks: [{ name: 'lint', command: f.cmd('lint'), ext: ['.js'], when: ['eslint.config.js'] }],
}));
fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ name: 't', scripts: {} }));
stage(f.root, 'src/a.js', 'console.log(1)\n');
r = runHook(f.root);
check('S6 无 scripts.build → 构建 SKIP、命令不跑、退出 0',
  r.status === 0 && !ran(f.marks, 'build') && r.out.includes('pkg:scripts.build') && r.out.includes('SKIP')
  && !r.out.includes('无匹配的源码变更'), r.out);
check('S6 文件型 when 缺失仍跳过（eslint.config.js）', !ran(f.marks, 'lint') && r.out.includes('eslint.config.js'), r.out);

// 场景 7：scripts.build 为非空字符串 → 构建命令执行；补上 eslint 配置后质量检查也执行。
f = mkfix();
fs.writeFileSync(path.join(f.root, '.agents', 'hooks', 'commit-check.config.json'), JSON.stringify({
  knownPatterns: [],
  builds: [{ name: 'build', command: f.cmd('build'), ext: ['.js'], when: ['pkg:scripts.build'] }],
  checks: [{ name: 'lint', command: f.cmd('lint'), ext: ['.js'], when: ['eslint.config.js'] }],
}));
fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ name: 't', scripts: { build: 'node -e 0' } }));
fs.writeFileSync(path.join(f.root, 'eslint.config.js'), 'export default [];\n');
stage(f.root, 'src/a.js', 'console.log(1)\n');
r = runHook(f.root);
check('S7 有 scripts.build 且 eslint 配置存在 → 构建与质量检查都执行',
  r.status === 0 && ran(f.marks, 'build') && ran(f.marks, 'lint'), r.out);

// 场景 8：--full 也不越过 pkg: when（没有脚本就不跑）
f = mkfix();
fs.writeFileSync(path.join(f.root, '.agents', 'hooks', 'commit-check.config.json'), JSON.stringify({
  knownPatterns: [],
  builds: [{ name: 'build', command: f.cmd('build'), ext: ['.js'], when: ['pkg:scripts.build'] }],
  checks: [],
}));
fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ name: 't' }));
stage(f.root, 'src/a.js', 'console.log(1)\n');
r = runHook(f.root, ['--full']);
check('S8 --full 仍尊重 pkg:scripts.build',
  r.status === 0 && !ran(f.marks, 'build') && r.out.includes('SKIP') && !r.out.includes('无匹配的源码变更'), r.out);

// 场景 9：pkg:scripts.build 四种不满足都不执行（空白、非字符串、非法 JSON、没有 package.json）
const unsatisfied = [
  ['空白字符串', (root) => fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't', scripts: { build: '   ' } }))],
  ['非字符串', (root) => fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 't', scripts: { build: 1 } }))],
  ['非法 JSON', (root) => fs.writeFileSync(path.join(root, 'package.json'), '{')],
  ['缺少 package.json', () => {}],
];
for (const [label, writePkg] of unsatisfied) {
  f = mkfix();
  fs.writeFileSync(path.join(f.root, '.agents', 'hooks', 'commit-check.config.json'), JSON.stringify({
    knownPatterns: [],
    builds: [{ name: 'build', command: f.cmd('build'), ext: ['.js'], when: ['pkg:scripts.build'] }],
    checks: [],
  }));
  writePkg(f.root);
  stage(f.root, 'src/a.js', 'console.log(1)\n');
  r = runHook(f.root);
  check(`S9 ${label} → SKIP、命令不跑、不报无匹配`,
    r.status === 0 && !ran(f.marks, 'build') && r.out.includes('pkg:scripts.build') && !r.out.includes('无匹配的源码变更'), r.out);
}

// 场景 10：--no-build 跳过全部构建（2026-10-16 构建门后移 pre-push）——ext 命中也不跑
f = mkfix();
stage(f.root, 'src/a.xyz', 'x');
r = runHook(f.root, ['--no-build']);
check('S10 --no-build 命中 ext 也不构建（后移 pre-push）',
  r.status === 0 && !ran(f.marks, 'extbuild') && r.out.includes('--no-build'), r.out);

// 场景 11：--range 推送范围模式——范围内 .xyz 触发 extbuild；敏感扫描跳过有提示
f = mkfix();
fs.writeFileSync(path.join(f.root, 'old.txt'), 'old\n');
git(f.root, ['add', 'old.txt']);
git(f.root, ['commit', '-q', '-m', 'old']);
stage(f.root, 'src/ranged.xyz', 'x');
const shaOld = git(f.root, ['rev-parse', 'HEAD']).stdout.trim();
git(f.root, ['commit', '-q', '-m', 'ranged']);
const shaNew = git(f.root, ['rev-parse', 'HEAD']).stdout.trim();
r = runHook(f.root, ['--range', shaOld, shaNew]);
check('S11 --range 范围内 .xyz 触发 extbuild 且提示跳过敏感扫描',
  r.status === 0 && ran(f.marks, 'extbuild') && r.out.includes('SKIP: --range 模式跳过敏感扫描'), r.out);

// 场景 11b：--range 范围只含非触发文件 → 零构建
f = mkfix();
fs.writeFileSync(path.join(f.root, 'a.txt'), 'a\n');
git(f.root, ['add', 'a.txt']);
git(f.root, ['commit', '-q', '-m', 'a']);
const s1 = git(f.root, ['rev-parse', 'HEAD']).stdout.trim();
fs.writeFileSync(path.join(f.root, 'b.txt'), 'b\n');
git(f.root, ['add', 'b.txt']);
git(f.root, ['commit', '-q', '-m', 'b']);
const s2 = git(f.root, ['rev-parse', 'HEAD']).stdout.trim();
r = runHook(f.root, ['--range', s1, s2]);
check('S11b --range 范围无触发文件 → 零构建',
  r.status === 0 && !ran(f.marks, 'extbuild') && !ran(f.marks, 'prefixbuild'), r.out);

// 场景 12：--range 全零 old sha（新分支首推）→ 全量构建语义（等价 --full 构建面）
f = mkfix();
fs.writeFileSync(path.join(f.root, 'seed.txt'), 'seed\n');
git(f.root, ['add', 'seed.txt']);
git(f.root, ['commit', '-q', '-m', 'seed']);
const shaHead = git(f.root, ['rev-parse', 'HEAD']).stdout.trim();
r = runHook(f.root, ['--range', '0'.repeat(40), shaHead]);
check('S12 --range 全零 old = 全量构建语义',
  r.status === 0 && ran(f.marks, 'extbuild') && ran(f.marks, 'prefixbuild'), r.out);

// 场景 13：--range sha 非法 → BLOCK（信任边界：sha 来自 git 管道仍校验）
f = mkfix();
r = runHook(f.root, ['--range', 'not-a-sha', 'HEAD']);
check('S13 --range 非 sha 参数 → BLOCK exit 1', r.status === 1 && r.out.includes('BLOCK'), r.out);

// 场景 14：敏感信息扫描脱敏（2026-10-19 secret-redaction）——命中必 BLOCK，但输出绝不含密钥原文。
// 这一组是包侧回归：回显面（终端回滚 / CI 日志 / 复制粘贴）与暂存区同级，都是泄露面。
const RAW = 'supersecretvalue12345';
f = mkfix();
stage(f.root, 'src/config.js', `const a = 1\nconst password = "${RAW}"\nconst b = 2\n`);
r = runHook(f.root, ['--no-build']);
check('R1 密钥命中 → BLOCK exit 1', r.status === 1 && r.out.includes('BLOCK'), r.out);
check('R1b 报出文件:行号（密钥在第 2 行）', r.out.includes('src/config.js:2'), r.out);
check('R1c 值已掩码（前缀 + 长度）', r.out.includes('password=sup***') && r.out.includes(`${RAW.length} 字符`), r.out);
check('R1d 输出不含密钥原文', !r.out.includes(RAW), `泄露: ${r.out}`);

// 场景 15：行号跟 hunk 走——同文件前面插入一行，密钥行号应随动
f = mkfix();
stage(f.root, 'src/config.js', `// header\nconst password = "${RAW}"\n`);
r = runHook(f.root, ['--no-build']);
check('R2 行号随 hunk 前移（密钥在第 2 行）', r.status === 1 && r.out.includes('src/config.js:2'), r.out);

// 场景 16：knownPatterns 白名单按行豁免
f = mkfix();
fs.writeFileSync(path.join(f.root, '.agents', 'hooks', 'commit-check.config.json'), JSON.stringify({
  knownPatterns: ['knownseedvalue123'],
  builds: [], checks: [],
}));
stage(f.root, 'src/config.js', `const token = "knownseedvalue123"\n`);
r = runHook(f.root, ['--no-build']);
check('R3 knownPatterns 白名单命中 → 不拦', r.status === 0 && !r.out.includes('BLOCK'), r.out);

// 场景 17：SELF 自豁免——判据/白名单自身的定义行长得像密钥赋值
f = mkfix();
stage(f.root, 'src/defs.js', 'const SECRET = /x/; // token = "abcdefghijkl"\n');
r = runHook(f.root, ['--no-build']);
check('R4 判据定义行自豁免 → 不拦', r.status === 0 && !r.out.includes('BLOCK'), r.out);
f = mkfix();
stage(f.root, 'src/defs.js', 'const OTHER = /x/; // token = "abcdefghijkl"\n');
r = runHook(f.root, ['--no-build']);
check('R4b 去掉 const SECRET = / 前缀 → 照拦', r.status === 1 && r.out.includes('BLOCK'), r.out);

// 场景 18：删除行不计——密钥只出现在被删的旧行里时不拦
f = mkfix();
stage(f.root, 'src/gone.js', 'const token = "supersecretvalue12345"\n');
git(f.root, ['commit', '-q', '-m', 'seed']);
fs.writeFileSync(path.join(f.root, 'src/gone.js'), 'const token = ""\n');
git(f.root, ['add', 'src/gone.js']);
r = runHook(f.root, ['--no-build']);
check('R5 密钥仅存于删除行 → 不拦', r.status === 0 && !r.out.includes('BLOCK'), r.out);

for (const d of fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith('cc-trigger-test-'))) {
  fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
}
console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
