// gen-changelog 测试（CHANGELOG.md 机制化）——纯函数组测 parseSubject/classify/renderChangelog；
// e2e 组在 tmp git 仓库造混合前缀 tag + Conventional Commits，验证 --write / --check / --notes 全链路。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSubject, classify, renderChangelog } from '../tools/gen-changelog.mjs';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(KIT, 'tools', 'gen-changelog.mjs');

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  return r.stdout;
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
}

function commit(root, subject) {
  git(root, ['add', '-A']);
  git(root, ['commit', '--allow-empty', '-q', '-m', subject]);
}

const run = (root, args) =>
  spawnSync(process.execPath, [TOOL, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });

// —— 纯函数组 ——

test('parseSubject：带/不带 scope、! 破坏标记、非匹配中文行', () => {
  assert.deepEqual(parseSubject('feat(engine): onFail 失败路由表'), {
    type: 'feat', scope: 'engine', subject: 'onFail 失败路由表',
  });
  assert.deepEqual(parseSubject('fix: 参数解析空格'), { type: 'fix', scope: null, subject: '参数解析空格' });
  // 带 ! 时归入其 type（scope 在 ! 前不丢）
  assert.deepEqual(parseSubject('feat(api)!: 破坏性变更'), { type: 'feat', scope: 'api', subject: '破坏性变更' });
  assert.deepEqual(parseSubject('refactor!: 收缩安装面'), { type: 'refactor', scope: null, subject: '收缩安装面' });
  assert.equal(parseSubject('这是一条中文普通提交'), null);
  assert.equal(parseSubject('featx: 伪类型不匹配'), null);
  assert.equal(parseSubject('feat:'), null); // 缺主题
});

test('classify：四桶有序归置，chore(release) 完全排除，未匹配行进其他', () => {
  const buckets = classify([
    'feat(engine): onFail 失败路由表',
    'fix(tui): 降级路径编号问答',
    'docs: README 用法',
    'perf: 收缩热路径',
    'chore(release): v1.1.0',
    'chore(release): 2.4.0',
    '非约定提交直接改文件',
  ]);
  assert.deepEqual(buckets, [
    { title: '新增', entries: ['feat(engine): onFail 失败路由表'] },
    { title: '修复', entries: ['fix(tui): 降级路径编号问答'] },
    { title: '文档', entries: ['docs: README 用法'] },
    { title: '其他', entries: ['perf: 收缩热路径', '非约定提交直接改文件'] },
  ]);
});

test('renderChangelog：小 fixture 全文快照（空桶不渲染、空版本只渲染段头、文件尾单换行）', () => {
  const text = renderChangelog([
    {
      version: '1.1.0',
      subjects: [
        'feat(engine): onFail 失败路由表',
        'fix: 降级路径编号问答',
        'docs: README 用法',
        'chore(release): v1.1.0',
        'refactor: 收缩安装面',
      ],
    },
    { version: '1.0.0', subjects: [] },
  ]);
  assert.equal(
    text,
    [
      '# 更新日志',
      '',
      '本文件由 tools/gen-changelog.mjs 从 Conventional Commits 生成，勿手改；重渲染用 --write。',
      '',
      '## [1.1.0]',
      '',
      '### 新增',
      '',
      '- feat(engine): onFail 失败路由表',
      '',
      '### 修复',
      '',
      '- fix: 降级路径编号问答',
      '',
      '### 文档',
      '',
      '- docs: README 用法',
      '',
      '### 其他',
      '',
      '- refactor: 收缩安装面',
      '',
      '## [1.0.0]',
    ].join('\n') + '\n',
  );
});

// —— e2e 组 ——

// tmp git 仓库：混合前缀 tag（1.0.0 / v1.1.0）+ 非 semver tag + 待发版窗口（package.json 1.2.0 无同名 tag）
function seedRepo() {
  const root = makeTmp('fk-changelog-');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']); // 仓库级身份
  git(root, ['config', 'user.name', 'changelog-test']);
  write(root, 'package.json', `${JSON.stringify({ name: 'fixture', version: '1.0.0', private: true }, null, 2)}\n`);
  commit(root, 'feat(engine): 首批引擎门禁');
  commit(root, 'fix: 参数解析空格');
  commit(root, 'docs: 安装指南');
  commit(root, '非约定提交直接改文件');
  git(root, ['tag', '1.0.0']);
  commit(root, 'feat(tui): 中文向导菜单');
  commit(root, 'chore(release): v1.1.0'); // 版本提交：进 1.1.0 区间但渲染时被排除
  commit(root, 'fix(tui): 降级路径编号问答');
  git(root, ['tag', 'v1.1.0']);
  git(root, ['tag', 'scratch']); // 非 semver tag：应被静默忽略
  write(root, 'package.json', `${JSON.stringify({ name: 'fixture', version: '1.2.0', private: true }, null, 2)}\n`);
  commit(root, 'feat(engine): 待发版能力');
  return root;
}

test('e2e：--write 降序渲染含待发版段，--check 防漂移（含默认同义），--notes 出单段', () => {
  const root = seedRepo();
  const changelogPath = path.join(root, 'CHANGELOG.md');

  const w = run(root, ['--write']);
  assert.equal(w.status, 0, w.stderr);
  const text = fs.readFileSync(changelogPath, 'utf8');
  // 版本段降序：待发版 1.2.0（bump 后、打 tag 前）在最前
  assert.deepEqual(
    text.split('\n').filter((l) => l.startsWith('## [')),
    ['## [1.2.0]', '## [1.1.0]', '## [1.0.0]'],
  );
  assert.ok(text.startsWith('# 更新日志\n')); // 文件头
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text)); // 无任何日期（消除 write→tag 时序伪漂移）
  assert.ok(!text.includes('chore(release)')); // 版本提交不进任何桶
  assert.ok(text.includes('- feat(engine): 待发版能力')); // 待发版段有内容
  assert.ok(text.includes('- 非约定提交直接改文件')); // 未匹配行进「其他」且保留全文
  assert.ok(!text.includes('scratch')); // 非 semver tag 静默忽略

  // --check：一致 exit 0；默认（无参数）与 --check 同义
  assert.equal(run(root, ['--check']).status, 0);
  assert.equal(run(root, []).status, 0);

  // 手改一个字 → exit 1 且 stderr 提示重跑 --write
  const tampered = text.replace('# 更新日志', '# 更新日志!');
  assert.notEqual(tampered, text);
  fs.writeFileSync(changelogPath, tampered, 'utf8');
  const c1 = run(root, ['--check']);
  assert.equal(c1.status, 1);
  assert.ok(c1.stderr.includes('重跑 node tools/gen-changelog.mjs --write'));

  // 恢复（--write 幂等：与首次写出逐字节一致）→ 再 check 过
  assert.equal(run(root, ['--write']).status, 0);
  assert.equal(fs.readFileSync(changelogPath, 'utf8'), text);
  assert.equal(run(root, ['--check']).status, 0);

  // --notes --to 1.1.0：只含该段，不含文件头与其他版本
  const n = run(root, ['--notes', '--to', '1.1.0']);
  assert.equal(n.status, 0, n.stderr);
  assert.ok(n.stdout.startsWith('## [1.1.0]\n'));
  assert.ok(n.stdout.includes('- feat(tui): 中文向导菜单'));
  assert.ok(n.stdout.includes('- fix(tui): 降级路径编号问答'));
  assert.ok(!n.stdout.includes('chore(release)'));
  assert.ok(!n.stdout.includes('# 更新日志')); // 不含文件头
  assert.ok(!n.stdout.includes('## [1.0.0]'));
  assert.ok(!n.stdout.includes('## [1.2.0]'));
});

test('e2e：--notes 默认最新 tag；--to 接受待发版 version；未知版本 exit 1', () => {
  const root = seedRepo();

  const nDefault = run(root, ['--notes']);
  assert.equal(nDefault.status, 0, nDefault.stderr);
  assert.ok(nDefault.stdout.startsWith('## [1.1.0]\n')); // 默认最新 tag 版本，不是待发版 1.2.0

  const nPending = run(root, ['--notes', '--to', '1.2.0']);
  assert.equal(nPending.status, 0, nPending.stderr);
  assert.ok(nPending.stdout.startsWith('## [1.2.0]\n'));
  assert.ok(nPending.stdout.includes('- feat(engine): 待发版能力'));

  const nMissing = run(root, ['--notes', '--to', '9.9.9']);
  assert.equal(nMissing.status, 1);
});

test('e2e：--check 无 CHANGELOG.md 报第 1 行差异；无 tag 仓库 --notes 报找不到版本', () => {
  const root = seedRepo();
  fs.rmSync(path.join(root, 'CHANGELOG.md'), { force: true }); // 显式确保不存在：走磁盘空串比对路径
  const c = run(root, ['--check']);
  assert.equal(c.status, 1);
  assert.ok(c.stderr.includes('首个差异在第 1 行'), c.stderr);
  assert.ok(c.stderr.includes('重跑 node tools/gen-changelog.mjs --write'), c.stderr);

  // 无 tag 仓库：--notes 默认目标取 tags[0] 为 null → 找不到段 exit 1
  const bare = makeTmp('fk-changelog-notag-');
  git(bare, ['init', '-q']);
  git(bare, ['config', 'user.email', 'test@example.com']);
  git(bare, ['config', 'user.name', 'changelog-test']);
  write(bare, 'package.json', `${JSON.stringify({ name: 'fixture', version: '1.0.0', private: true }, null, 2)}\n`);
  commit(bare, 'feat: 只有提交没有 tag');
  const n = run(bare, ['--notes']);
  assert.equal(n.status, 1);
  assert.ok(n.stderr.includes('找不到版本'), n.stderr);
});
