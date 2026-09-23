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
const MARK = 'TRIGGER_TEST_BUILD_RAN';

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
  return { root, marks };
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

for (const d of fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith('cc-trigger-test-'))) {
  fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
}
console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
