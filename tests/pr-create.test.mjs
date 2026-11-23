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
  const dir = makeTmp('pr-create-');
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

test('forgeFromRemote classifies github, azure, and the rest', () => {
  assert.equal(forgeFromRemote('https://github.com/a/b.git'), 'github');
  assert.equal(forgeFromRemote('git@github.com:a/b.git'), 'github');
  assert.equal(forgeFromRemote('https://dev.azure.com/org/project/_git/repo'), 'azure');
  assert.equal(forgeFromRemote('https://org.visualstudio.com/proj/_git/repo'), 'azure');
  assert.equal(forgeFromRemote('ssh://git@host/tfs/COLL/PROJ/_git/R'), 'azure');
  assert.equal(forgeFromRemote('https://gitlab.com/a/b.git'), null);
  assert.equal(forgeFromRemote(''), null);
});

test('pr-create stops when origin is missing or not github or azure', () => {
  const none = run(repo(), ['create', '--title', 't', '--body-file', 'b.md']);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /无 origin/);
  const other = run(repo('https://gitlab.com/a/b.git'), ['create', '--title', 't']);
  assert.equal(other.status, 2);
  assert.match(other.stderr, /gitlab\.com/);
});

test('pr-create dry-run on github prints gh and does not call it', () => {
  const dir = repo('git@github.com:a/b.git');
  const r = run(dir, ['create', '--source', 'feat', '--target', 'main', '--title', 'feat: x', '--body-file', 'body.md', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /gh pr create --head feat --base main --title feat: x --body-file body.md/);
});

test('pr-create on github invokes gh', () => {
  const dir = repo('https://github.com/a/b.git');
  const log = path.join(dir, 'gh-log.txt');
  const stub = path.join(dir, 'gh-stub.mjs');
  fs.writeFileSync(stub, `import fs from 'node:fs';\nfs.writeFileSync(process.env.GH_LOG, process.argv.slice(2).join('\\n'));\n`);
  const r = run(dir, ['--title', 'feat: x', '--body-file', 'body.md'], { PR_CREATE_GH: stub, GH_LOG: log });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(log, 'utf8'), /pr\ncreate\n--title\nfeat: x\n--body-file\nbody.md/);
});

test('pr-create on azure delegates to tfs-pr', () => {
  const dir = repo('https://dev.azure.com/org/project/_git/repo');
  const script = path.join(dir, '.agents/skills/tfs-pr/scripts/tfs-pr.mjs');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  const log = path.join(dir, 'tfs-log.txt');
  fs.writeFileSync(script, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(log)}, process.argv.slice(2).join('\\n'));\n`);
  const r = run(dir, ['create', '--title', 'feat: x', '--body-file', 'body.md']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(log, 'utf8'), /create\n--title\nfeat: x/);
});

test('pr-create --json on github prints one JSON object and never forwards --json to gh', () => {
  const dir = repo('https://github.com/a/b.git');
  const stub = path.join(dir, 'gh-stub.mjs');
  fs.writeFileSync(stub, [
    "if (process.argv.includes('--json')) { console.error('unknown flag: --json'); process.exit(1); }",
    "process.stdout.write('https://github.com/a/b/pull/42\\n');",
  ].join('\n'));
  const r = run(dir, ['create', '--title', 'feat: x', '--json'], { PR_CREATE_GH: stub });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, url: 'https://github.com/a/b/pull/42', number: 42 });
});

test('pr-create without --json passes gh stdout through unchanged', () => {
  const dir = repo('https://github.com/a/b.git');
  const stub = path.join(dir, 'gh-stub.mjs');
  fs.writeFileSync(stub, "process.stdout.write('https://github.com/a/b/pull/42\\n');\n");
  const r = run(dir, ['create', '--title', 'feat: x'], { PR_CREATE_GH: stub });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'https://github.com/a/b/pull/42\n');
});

test('pr-create maps a non-zero gh exit to 1 instead of forwarding the raw code', () => {
  const dir = repo('https://github.com/a/b.git');
  const stub = path.join(dir, 'gh-stub.mjs');
  fs.writeFileSync(stub, "process.stderr.write('gh: unknown flag\\n');\nprocess.exit(3);\n");
  const r = run(dir, ['create', '--title', 'feat: x'], { PR_CREATE_GH: stub });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.signal, null);
  assert.match(r.stderr, /gh: unknown flag/);
});

test('pr-create --json maps a non-zero gh exit to 1', () => {
  const dir = repo('https://github.com/a/b.git');
  const stub = path.join(dir, 'gh-stub.mjs');
  fs.writeFileSync(stub, "process.stderr.write('gh: unknown flag\\n');\nprocess.exit(3);\n");
  const r = run(dir, ['create', '--title', 'feat: x', '--json'], { PR_CREATE_GH: stub });
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: false, url: null, number: null });
});

test('pr-create maps a non-zero tfs-pr exit to 1 instead of forwarding the raw code', () => {
  const dir = repo('https://dev.azure.com/org/project/_git/repo');
  const script = path.join(dir, '.agents/skills/tfs-pr/scripts/tfs-pr.mjs');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, 'process.exit(3);\n');
  const r = run(dir, ['create', '--title', 'feat: x']);
  assert.equal(r.status, 1, r.stderr);
});

test('pr-create --json without a PR URL reports null and keeps raw output off stdout', () => {
  const dir = repo('https://github.com/a/b.git');
  const stub = path.join(dir, 'gh-stub.mjs');
  fs.writeFileSync(stub, "process.stdout.write('done, no link\\n');\n");
  const r = run(dir, ['create', '--title', 'feat: x', '--json'], { PR_CREATE_GH: stub });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, url: null, number: null });
  assert.match(r.stderr, /done, no link/);
});
