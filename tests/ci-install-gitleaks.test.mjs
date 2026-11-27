// ci-install-gitleaks.test.mjs — 装机脚本的供应链契约：产物 SHA-256 不符或重定向出白名单时
// 不装机、exit 0，交 check-secrets 的 lite 兜底（脚本文件头的文档承诺）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
  'engine',
  '.agents',
  'scripts',
  'ci-install-gitleaks.mjs',
);

// 脚本用 `git rev-parse --show-toplevel` 定位工具目录，cwd 必须是 git 仓库。
function gitRepo() {
  const dir = makeTmp('flow-kit-gitleaks-');
  const r = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

function runInstaller({ cwd, base, toolsDir }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd,
      env: { ...process.env, GITLEAKS_RELEASE_BASE: base, GITLEAKS_TOOLS_DIR: toolsDir },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const binPath = (cwd) => path.join(cwd, '.agents', 'tools', process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');

test('SHA-256 mismatch aborts the install and exits 0 (lite fallback)', async () => {
  const cwd = gitRepo();
  const { srv, base } = await listen((req, res) => {
    res.writeHead(200);
    res.end('tampered payload');
  });
  try {
    const r = await runInstaller({ cwd, base, toolsDir: path.join(cwd, '.agents', 'tools') });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /SHA-256 不匹配/);
    assert.doesNotMatch(r.stdout, /解压失败/, 'hash 未通过时不得进入解压步骤');
    assert.equal(fs.existsSync(binPath(cwd)), false, '未核验的产物不得落到 .agents/tools/');
  } finally {
    srv.close();
  }
});

test('a redirect off the GitHub asset hosts is refused before the target is fetched', async () => {
  const cwd = gitRepo();
  let targetHits = 0;
  const target = await listen((req, res) => {
    targetHits += 1;
    res.writeHead(200);
    res.end('payload');
  });
  const entry = await listen((req, res) => {
    res.writeHead(302, { location: `${target.base}/gitleaks.download` });
    res.end();
  });
  try {
    const r = await runInstaller({ cwd, base: entry.base, toolsDir: path.join(cwd, '.agents', 'tools') });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /重定向目标不受信/);
    assert.equal(targetHits, 0, '重定向目标必须在请求前拒绝');
    assert.equal(fs.existsSync(binPath(cwd)), false);
  } finally {
    entry.srv.close();
    target.srv.close();
  }
});

test('a dropped download body skips the install instead of crashing', async () => {
  const cwd = gitRepo();
  let hits = 0;
  const { srv, base } = await listen((req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-length': '1024' });
    res.write('partial');
    res.destroy();
  });
  try {
    const r = await runInstaller({ cwd, base, toolsDir: path.join(cwd, '.agents', 'tools') });
    assert.ok(hits > 0, '安装器必须使用注入的下载源');
    assert.equal(r.status, 0, `下载中断必须走 lite 兜底而不是崩：${r.stderr}`);
    assert.match(r.stdout, /下载失败/);
    assert.equal(fs.existsSync(binPath(cwd)), false);
  } finally {
    srv.close();
  }
});

test('version and the per-platform SHA-256 remain pinned in the script', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /const VERSION = '8\.30\.1'/);
  // 官方 gitleaks_8.30.1_checksums.txt 的两条资产校验和（windows_x64.zip / linux_x64.tar.gz）
  assert.match(src, /d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e/);
  assert.match(src, /551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/);
  assert.match(src, /redirect: 'manual'/);
});
