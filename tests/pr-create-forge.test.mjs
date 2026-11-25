import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { forgeFromRemote } from '../src/install/forge.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PR = path.join(KIT, 'templates/engine/.agents/scripts/pr-create.mjs');

function repo(url) {
  const dir = makeTmp('pr-create-forge-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (url) spawnSync('git', ['remote', 'add', 'origin', url], { cwd: dir });
  return dir;
}

function run(dir, args, env = {}) {
  return spawnSync(process.execPath, [PR, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('forgeFromRemote recognizes gitlab.com and self-hosted gitlab hosts', () => {
  assert.equal(forgeFromRemote('https://gitlab.com/a/b.git'), 'gitlab');
  assert.equal(forgeFromRemote('git@gitlab.example.com:a/b.git'), 'gitlab');
  assert.equal(forgeFromRemote('https://gitlab.example.com/group/sub/repo'), 'gitlab');
  // 回归：GitHub / Azure 判定不变，路径里的 "gitlab" 不算主机名。
  assert.equal(forgeFromRemote('https://github.com/a/b.git'), 'github');
  assert.equal(forgeFromRemote('git@github.com:a/b.git'), 'github');
  assert.equal(forgeFromRemote('https://dev.azure.com/org/project/_git/repo'), 'azure');
  assert.equal(forgeFromRemote('https://org.visualstudio.com/proj/_git/repo'), 'azure');
  assert.equal(forgeFromRemote('ssh://git@host/tfs/COLL/PROJ/_git/R'), 'azure');
  assert.equal(forgeFromRemote('https://example.com/gitlab/a/b.git'), null);
  assert.equal(forgeFromRemote(''), null);
});

test('pr-create dry-run on gitlab prints glab mr create with mapped flags', () => {
  const dir = repo('https://gitlab.com/a/b.git');
  const r = run(dir, ['create', '--source', 'feat', '--target', 'main', '--title', 'feat: x', '--body-file', 'body.md', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    r.stdout,
    'glab mr create --source-branch feat --target-branch main --title feat: x --description "$(cat body.md)"\n',
  );
});

test('pr-create on gitlab passes body file contents to glab --description', () => {
  const dir = repo('git@gitlab.example.com:a/b.git');
  const stub = path.join(dir, 'glab-stub.mjs');
  const log = path.join(dir, 'glab-log.txt');
  fs.writeFileSync(stub, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`);
  fs.writeFileSync(path.join(dir, 'body.md'), 'Summary: x\nEvidence: y\n');
  const r = run(dir, ['create', '--source', 'feat', '--target', 'main', '--title', 'feat: x', '--body-file', 'body.md'], {
    PR_CREATE_GLAB: stub,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8')), [
    'mr', 'create',
    '--source-branch', 'feat',
    '--target-branch', 'main',
    '--title', 'feat: x',
    '--description', 'Summary: x\nEvidence: y\n',
  ]);
});

test('pr-create --json on gitlab extracts the MR URL into one JSON object', () => {
  const dir = repo('https://gitlab.com/a/b.git');
  const stub = path.join(dir, 'glab-stub.mjs');
  fs.writeFileSync(stub, [
    "if (process.argv.includes('--json')) { console.error('unknown flag: --json'); process.exit(1); }",
    "process.stdout.write('Creating merge request...\\n');",
    "process.stdout.write('https://gitlab.com/a/b/-/merge_requests/7\\n');",
  ].join('\n'));
  const r = run(dir, ['create', '--source', 'feat', '--target', 'main', '--title', 'feat: x', '--json'], { PR_CREATE_GLAB: stub });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, url: 'https://gitlab.com/a/b/-/merge_requests/7', number: 7 });
});

test('pr-create --json on gitlab without an MR URL reports null and keeps raw output off stdout', () => {
  const dir = repo('https://gitlab.com/a/b.git');
  const stub = path.join(dir, 'glab-stub.mjs');
  fs.writeFileSync(stub, "process.stdout.write('done, no link\\n');\n");
  const r = run(dir, ['create', '--title', 'feat: x', '--json'], { PR_CREATE_GLAB: stub });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, url: null, number: null });
  assert.match(r.stderr, /done, no link/);
});
