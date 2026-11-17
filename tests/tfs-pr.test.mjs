// BACKLOG #22：tfs-pr 逐提交导读 + 噪声历史清理建议（只读）+ CI 红定位失败检查。
// 本地 http 桩 + 临时 git 仓库，不触真实服务、不需要真 PAT。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'templates/engine/.agents/skills/tfs-pr/scripts/tfs-pr.mjs');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const PAT = 'stub-pat-value-must-never-be-printed';

function git(dir, args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败：${r.stderr || r.stdout}`);
  return String(r.stdout || '').trim();
}

function commit(dir, file, content, message) {
  const abs = path.join(dir, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(dir, ['add', file]);
  git(dir, ['commit', '-q', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

// 历史夹具：常规提交 + fixup + 非 Conventional + 破坏性 + 重复主题 + 合并提交；
// 目标分支在分叉后也改了同一文件同一行 → overlap 与文本冲突都真实存在。
function historyRepo() {
  const dir = makeTmp('flow-kit-tfs-pr-');
  git(dir, ['init', '-q']);
  git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  // TFS 形态远端：让 resolveTarget 能推导 base/project/repo（context 全程零请求，不会连它）。
  git(dir, ['remote', 'add', 'origin', 'http://127.0.0.1:1/tfs/COLL/P/_git/R']);
  const base = commit(dir, 'src/api.js', 'line1\n', 'feat(api): 基线');
  git(dir, ['update-ref', 'refs/remotes/origin/main', base]);
  git(dir, ['checkout', '-q', '-b', 'feat']);
  const b = commit(dir, 'src/api.js', 'line1-feat\n', 'feat(api): 新增分页');
  const c = commit(dir, 'src/api.js', 'line1-feat2\n', 'fixup! feat(api): 新增分页');
  const d = commit(dir, 'notes.txt', 'n\n', '随手改改');
  const e = commit(dir, 'src/api.js', 'line1-feat3\n', 'feat(api)!: 改契约');
  const f = commit(dir, 'extra.txt', 'e\n', 'feat(api): 新增分页');
  git(dir, ['checkout', '-q', '-b', 'side', b]);
  commit(dir, 'side.txt', 's\n', 'feat(side): 侧支');
  git(dir, ['checkout', '-q', 'feat']);
  git(dir, ['merge', '--no-ff', 'side', '-m', "Merge branch 'side' into feat"]);
  const m = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', 'main']);
  const mainTip = commit(dir, 'src/api.js', 'line1-main\n', 'feat(api): 主线改动');
  git(dir, ['update-ref', 'refs/remotes/origin/main', mainTip]);
  git(dir, ['checkout', '-q', 'feat']);
  return { dir, short: { b, c, d, e, f, m } };
}

// 必须异步 spawn：http 桩跑在本进程，spawnSync 会阻塞事件循环 → 子进程等响应、父进程等子进程，死锁。
function runScript(args, cwd, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd,
      env: { ...process.env, TFS_PAT: PAT, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => resolve({ status: -1, stdout, stderr: `${stderr}${e.message}` }));
    child.on('close', (code) => resolve({ status: code, stdout, stderr }));
  });
}

async function contextJson(dir, extra = []) {
  const r = await runScript(['context', '--source', 'feat', '--target', 'main', '--no-fetch', '--json', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return { r, c: JSON.parse(r.stdout) };
}

test('context guide reads commits chronologically with type, size and risk flags', async () => {
  const { dir, short } = historyRepo();
  const headBefore = git(dir, ['rev-parse', 'HEAD']);
  const { c } = await contextJson(dir);
  const g = c.guide;

  assert.equal(g.order, 'chronological');
  assert.equal(g.truncated, false);
  assert.equal(g.commits.length, c.commitCount);
  assert.equal(g.commits.length, 7);
  // 时间正序：第一条是分叉后首个提交，最后一条是合并提交。
  assert.equal(g.commits[0].sha, short.b);
  assert.equal(g.commits[g.commits.length - 1].sha, short.m);

  const bySha = new Map(g.commits.map((x) => [x.sha, x]));
  assert.equal(bySha.get(short.b).type, 'feat');
  assert.equal(bySha.get(short.b).scope, 'api');
  assert.deepEqual(bySha.get(short.b).files, [{ path: 'src/api.js', added: 1, deleted: 1 }]);
  assert.equal(bySha.get(short.b).added, 1);
  assert.equal(bySha.get(short.b).deleted, 1);
  assert.equal(bySha.get(short.e).breaking, true);
  assert.equal(bySha.get(short.m).parents, 2);
  assert.equal(g.types.feat, 4);
  assert.equal(g.types.other, 3);

  // 冲突/重叠标记来自真实 merge-tree 与 overlap，不是猜的。
  assert.ok(c.overlap.includes('src/api.js'));
  assert.ok(c.conflicts.files.includes('src/api.js'));
  for (const sha of [short.b, short.c, short.e]) {
    const flags = bySha.get(sha).flags;
    assert.ok(flags.includes('conflict'), `${sha} 应标 conflict`);
    assert.ok(flags.includes('overlap'), `${sha} 应标 overlap`);
    assert.ok(bySha.get(sha).note.includes('src/api.js'));
  }
  assert.ok(bySha.get(short.e).flags.includes('breaking'));
  assert.ok(!bySha.get(short.d).flags.includes('conflict'));
  assert.ok(g.focus.includes(bySha.get(short.b).short));
  assert.ok(g.focus.includes(bySha.get(short.e).short));
  assert.ok(!g.focus.includes(bySha.get(short.d).short));

  // 导读只读：跑完 HEAD 与提交数不变。
  assert.equal(git(dir, ['rev-parse', 'HEAD']), headBefore);
  assert.equal(git(dir, ['rev-list', '--count', 'HEAD']), '8');
});

test('guide noise suggestions cover fixup / non-conventional / duplicate / merge and never rewrite history', async () => {
  const { dir, short } = historyRepo();
  const { c } = await contextJson(dir);
  const kinds = c.guide.noise.map((n) => n.kind);
  assert.ok(kinds.includes('fixup'));
  assert.ok(kinds.includes('non-conventional'));
  assert.ok(kinds.includes('duplicate'));
  assert.ok(kinds.includes('merge'));
  const shortBySha = new Map(c.guide.commits.map((x) => [x.sha, x.short]));
  const dup = c.guide.noise.filter((n) => n.kind === 'duplicate').map((n) => n.short).sort();
  assert.deepEqual(dup, [shortBySha.get(short.b), shortBySha.get(short.f)].sort());
  for (const n of c.guide.noise) assert.ok(n.suggestion.length > 0);
  // 未推送 → 允许本地整理；措辞不得授权改写已推送历史。
  assert.equal(c.push.unpushed, true);
  assert.match(c.guide.notice, /未推送/);
  assert.match(c.guide.notice, /须用户显式授权/);

  // 已推送 → 强提示：建议不等于授权，force push 仍禁。
  git(dir, ['update-ref', 'refs/remotes/origin/feat', git(dir, ['rev-parse', 'HEAD'])]);
  const after = (await contextJson(dir)).c;
  assert.equal(after.push.unpushed, false);
  assert.match(after.guide.notice, /已推送历史/);
  assert.match(after.guide.notice, /须用户显式授权/);
  assert.match(after.guide.notice, /禁 force push|不代跑/);

  // 结构性护栏：脚本里不存在任何改写历史 / 推送的 git 子命令调用。
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(!/\[\s*'(push|rebase|reset|filter-branch|filter-repo|commit|merge|cherry-pick)'/.test(src),
    'tfs-pr 脚本不得自行推送或改写历史');
});

test('guide prints a reading order and has a text surface', async () => {
  const { dir } = historyRepo();
  const r = await runScript(['context', '--source', 'feat', '--target', 'main', '--no-fetch'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /逐提交导读（时间正序 = 建议阅读顺序/);
  assert.match(r.stdout, /重点先看：/);
  assert.match(r.stdout, /类型分布：/);
  assert.match(r.stdout, /噪声历史（\d+ 条，只给建议，不代跑改写）/);
  assert.ok(!r.stdout.includes(PAT));
});

// ---------- CI 检查：本地 http 桩 ----------
const RECORDS = [
  { id: 'r-stage', name: 'CI', type: 'Stage', result: 'failed', state: 'completed', order: 1, parentId: null },
  { id: 'r-job', name: 'build', type: 'Job', result: 'failed', state: 'completed', order: 2, parentId: 'r-stage' },
  { id: 'r-ok', name: 'Install deps', type: 'Task', result: 'succeeded', state: 'completed', order: 3, parentId: 'r-job', log: { id: 3, url: 'http://stub/logs/3' } },
  {
    id: 'r-bad', name: 'Run tests', type: 'Task', result: 'failed', state: 'completed', order: 4, parentId: 'r-job',
    errorCount: 2, warningCount: 0, attempt: 1,
    issues: [
      { type: 'error', message: 'tests/api.test.mjs:12 AssertionError: expected 200 got 500' },
      { type: 'error', message: '##[error]Process completed with exit code 1.' },
    ],
    log: { id: 4, url: 'http://stub/P/_apis/build/builds/101/logs/4' },
  },
  {
    id: 'r-warn', name: 'Lint', type: 'Task', result: 'succeededWithIssues', state: 'completed', order: 5, parentId: 'r-job',
    warningCount: 3, issues: [{ type: 'warning', message: 'no-unused-vars' }], log: { id: 5, url: 'http://stub/logs/5' },
  },
];

function build(id, over = {}) {
  return {
    id,
    buildNumber: `20261117.${id}`,
    result: 'failed',
    status: 'completed',
    reason: 'individualCI',
    sourceBranch: 'refs/heads/feat',
    repository: { id: 'repo-guid', name: 'R', type: 'TfsGit' },
    queueTime: `2026-11-17T0${id % 10}:00:00Z`,
    finishTime: `2026-11-17T0${id % 10}:05:00Z`,
    _links: { web: { href: `http://stub/P/_build/results?buildId=${id}` } },
    ...over,
  };
}

async function stub(routes) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const hit = { method: req.method, url: req.url, auth: req.headers.authorization || '', body: Buffer.concat(chunks).toString('utf8') };
      hits.push(hit);
      const url = new URL(req.url, 'http://stub');
      const route = routes(url, hit);
      if (!route) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: `stub 未定义路由：${req.url}` }));
        return;
      }
      res.writeHead(route.status || 200, { 'content-type': route.type || 'application/json; charset=utf-8' });
      res.end(typeof route.body === 'string' ? route.body : JSON.stringify(route.body));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    hits,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      // fetch 走 keep-alive：不主动断开空闲连接，server.close() 会一直等下去。
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

// 默认桩：PR 12 的验证构建（refs/pull/12/merge）比分支 CI 新，timeline 有一条 failed Task。
function ciRoutes(over = {}) {
  const patch = (b) => ({ ...b, ...(over.buildPatch || {}) });
  const prBuild = patch(build(101, { reason: 'pullRequest', sourceBranch: 'refs/pull/12/merge', queueTime: '2026-11-17T09:00:00Z' }));
  const branchBuild = patch(build(100, { queueTime: '2026-11-17T08:00:00Z' }));
  return (url) => {
    const p = url.pathname;
    if (p === '/P/_apis/git/repositories/R/pullrequests/12') {
      return { body: { pullRequestId: 12, status: 'active', mergeStatus: 'succeeded', sourceRefName: 'refs/heads/feat', targetRefName: 'refs/heads/main' } };
    }
    if (p === '/P/_apis/build/builds') {
      const branch = url.searchParams.get('branchName');
      if (over.builds) return { body: { count: over.builds.length, value: over.builds } };
      if (branch === 'refs/pull/12/merge') return { body: { count: 1, value: [prBuild] } };
      if (branch === 'refs/heads/feat') return { body: { count: 1, value: [branchBuild] } };
      return { body: { count: 0, value: [] } };
    }
    if (p === '/P/_apis/build/builds/101') return { body: prBuild };
    if (p === '/P/_apis/build/builds/100') return { body: branchBuild };
    if (/^\/P\/_apis\/build\/builds\/\d+\/timeline$/.test(p)) return { body: { id: 'tl', records: over.records || RECORDS } };
    return null;
  };
}

async function withStub(routes, fn) {
  const s = await stub(routes);
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

function checksArgs(s, extra = []) {
  return ['checks', '--base', s.base, '--project', 'P', '--repo', 'R', ...extra];
}

test('checks locates the failed CI check with its job path, error issues and log pointer', async () => {
  const dir = makeTmp('flow-kit-tfs-pr-ci-');
  await withStub(ciRoutes(), async (s) => {
    const r = await runScript(checksArgs(s, ['12', '--json']), dir);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.prId, 12);
    assert.equal(out.branch, 'feat');
    assert.equal(out.ci, 'red');
    assert.equal(out.analyzed, 101, 'PR 验证构建更新，应分析它');
    assert.equal(out.builds.length, 2, 'refs/pull/<id>/merge 与 refs/heads/<branch> 都查且去重');
    assert.equal(out.timeline.total, RECORDS.length);
    assert.equal(out.timeline.failed.length, 1);
    const f = out.timeline.failed[0];
    assert.equal(f.name, 'Run tests');
    assert.equal(f.type, 'Task');
    assert.equal(f.path, 'CI / build');
    assert.equal(f.errorCount, 2);
    assert.match(f.issues[0].message, /tests\/api\.test\.mjs:12/);
    assert.equal(f.log.id, 4);
    assert.equal(out.timeline.warned.length, 1);
    assert.equal(out.timeline.warned[0].name, 'Lint');

    // 只读：全部请求都是 GET，没有排队构建 / 合并 / 改 PR。
    assert.ok(s.hits.length > 0);
    assert.ok(s.hits.every((h) => h.method === 'GET'), `出现写请求：${JSON.stringify(s.hits.map((h) => h.method))}`);
    assert.ok(s.hits.every((h) => !/\/(queue|complete|merge|statuses)/.test(h.url)));
    // PAT 只进 Authorization 头，不进输出。
    assert.equal(s.hits[0].auth, `Basic ${Buffer.from(`:${PAT}`).toString('base64')}`);
    assert.ok(!r.stdout.includes(PAT) && !r.stderr.includes(PAT));
  });
});

test('checks text output names the failed check and the focused-fix route', async () => {
  const dir = makeTmp('flow-kit-tfs-pr-ci-');
  await withStub(ciRoutes(), async (s) => {
    const r = await runScript(checksArgs(s, ['--source', 'feat']), dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FAIL \[Task\] Run tests/);
    assert.match(r.stdout, /path: CI \/ build/);
    assert.match(r.stdout, /tests\/api\.test\.mjs:12/);
    assert.match(r.stdout, /CI=red/);
    assert.match(r.stdout, /聚焦修复/);
    assert.match(r.stdout, /禁自动合并/);
    assert.ok(!r.stdout.includes(PAT));
  });
});

test('checks reports green, running and empty without inventing data', async () => {
  const dir = makeTmp('flow-kit-tfs-pr-ci-');
  const green = RECORDS.map((x) => ({ ...x, result: 'succeeded', issues: [], errorCount: 0 }));
  await withStub(ciRoutes({
    buildPatch: { result: 'succeeded' },
    records: green,
  }), async (s) => {
    const r = await runScript(checksArgs(s, ['12', '--json']), dir);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ci, 'green');
    assert.equal(out.timeline.failed.length, 0);
  });

  await withStub(ciRoutes({ buildPatch: { status: 'inProgress', result: null } }), async (s) => {
    const r = await runScript(checksArgs(s, ['12']), dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /CI=running/);
    assert.match(r.stdout, /别把 running 当绿/);
  });

  await withStub(ciRoutes({ builds: [] }), async (s) => {
    const r = await runScript(checksArgs(s, ['--source', 'feat', '--json']), dir);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ci, 'no-builds');
    assert.deepEqual(out.builds, []);
    assert.equal(out.timeline, null);
    assert.match(out.empty, /未找到构建/);
    assert.match(out.empty, /--build <id>/);
    assert.equal(s.hits.every((h) => h.method === 'GET'), true);
  });
});

test('checks --build bypasses the branch query and flags foreign-repo builds', async () => {
  const dir = makeTmp('flow-kit-tfs-pr-ci-');
  await withStub(ciRoutes(), async (s) => {
    const r = await runScript(checksArgs(s, ['--build', '101', '--json']), dir);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.analyzed, 101);
    assert.equal(out.builds.length, 1);
    assert.ok(s.hits.every((h) => !h.url.includes('branchName=')), '--build 不应再按分支列表查询');
  });

  await withStub(ciRoutes({ builds: [build(101, { repository: { name: 'OtherRepo', type: 'TfsGit' } })] }), async (s) => {
    const r = await runScript(checksArgs(s, ['--source', 'feat', '--json']), dir);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.match(out.repoNote, /repository 名都与本仓 R 不符/);
    assert.equal(out.builds[0].repoMatch, false);
  });

  const bad = await runScript(['checks', '--base', 'http://127.0.0.1:1', '--project', 'P', '--repo', 'R', '--build', 'abc'], dir);
  assert.equal(bad.status, 2);
  assert.match(`${bad.stdout}${bad.stderr}`, /--build 需要数字构建 id/);
});

test('checks surfaces a 401 html response as an auth error with the Build scope hint', async () => {
  const dir = makeTmp('flow-kit-tfs-pr-ci-');
  await withStub(() => ({ status: 401, type: 'text/html; charset=utf-8', body: '<html><title>TF400813: not authorized</title></html>' }), async (s) => {
    const r = await runScript(checksArgs(s, ['--source', 'feat']), dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /TF400813/);
    assert.match(r.stderr, /Build R/);
    assert.ok(!r.stderr.includes(PAT));
  });
});

test('the installed skill ships checks and the guide, and both languages document the authorization rule', () => {
  const dir = makeTmp('flow-kit-tfs-pr-install-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const install = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(install.status, 0, install.stderr);
  const installed = path.join(dir, '.agents/skills/tfs-pr/scripts/tfs-pr.mjs');
  assert.ok(fs.existsSync(installed), '技能自带脚本必须随安装落地');
  const help = spawnSync(process.execPath, [installed, '--help'], { cwd: dir, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /checks \[<prId>\]/);
  assert.match(help.stdout, /guide：逐提交导读/);

  const zh = fs.readFileSync(path.join(KIT, 'templates/engine/.agents/skills/tfs-pr/SKILL.md'), 'utf8');
  const en = fs.readFileSync(path.join(KIT, 'locales/en/overrides/.agents/skills/tfs-pr/SKILL.md'), 'utf8');
  for (const [lang, body] of [['zh', zh], ['en', en]]) {
    assert.match(body, /tfs-pr checks/, `${lang} 技能正文须给出 checks 命令`);
    assert.match(body, /guide/, `${lang} 技能正文须给出导读字段`);
    assert.match(body, /Build \(Read\)|Build Read/, `${lang} PAT 指引须含 Build 读权限`);
  }
  assert.match(zh, /须用户显式授权/);
  assert.match(zh, /禁自动合并/);
  assert.match(en, /explicit user authorization/i);
  assert.match(en, /never merges automatically|no automatic merge/i);

  for (const rel of [
    'templates/engine/.agents/commands/pr-review.md',
    'locales/en/overrides/.agents/commands/pr-review.md',
    'templates/engine/.agents/commands/pipeline-run.md',
    'locales/en/overrides/.agents/commands/pipeline-run.md',
  ]) {
    const body = fs.readFileSync(path.join(KIT, rel), 'utf8');
    assert.match(body, /tfs-pr/, `${rel} 须衔接到 tfs-pr`);
  }
});
