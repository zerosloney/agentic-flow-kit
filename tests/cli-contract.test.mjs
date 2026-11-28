import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXIT, exitCodeForError, REGISTERED_ERROR_CODES, IO_ERROR_CODES } from '../src/cli/exit.mjs';
import { parseArgs, flag } from '../src/cli/args.mjs';
import { COMMANDS } from '../src/cli/main.mjs';
import { STACKS } from '../src/install/profiles.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-contract-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function install(dir, extra = []) {
  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.', ...extra], dir);
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function readManifest(dir) {
  return JSON.parse(read(dir, '.agents/install-manifest.json'));
}

function writeManifest(dir, value) {
  fs.writeFileSync(
    path.join(dir, '.agents/install-manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function addOrphan(dir, rel, content, managed = content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  const manifest = readManifest(dir);
  manifest.files[rel] = sha(managed);
  writeManifest(dir, manifest);
}

function parseSingleJson(r) {
  return JSON.parse(r.stdout);
}

// ---- 退出码映射（纯单元，不 spawn） ----

test('exit code mapping covers every documented class', () => {
  assert.equal(EXIT.OK, 0);
  assert.equal(EXIT.CONFLICT, 1);
  assert.equal(EXIT.USAGE, 2);
  assert.equal(EXIT.TARGET, 3);
  assert.equal(EXIT.HOST, 4);
  assert.equal(EXIT.IO, 5);
  assert.equal(EXIT.LOCK, 6);

  for (const code of ['BAD_COMMAND', 'BAD_LANG', 'BAD_MODEL', 'BAD_TIER', 'NO_HOSTS', 'MISSING_ARG', 'HOST_NOT_INSTALLED', 'INVALID_HOST_NAME', 'INVALID_HOST_DEF']) {
    assert.equal(exitCodeForError({ code }), EXIT.USAGE, code);
  }
  for (const code of ['INSTALL_LOCKED', 'USER_HOOKS_LOCKED']) {
    assert.equal(exitCodeForError({ code }), EXIT.LOCK, code);
  }
  for (const code of ['TARGET_MISSING', 'NO_MANIFEST', 'NO_HOSTS_IN_MANIFEST', 'BAD_MANIFEST']) {
    assert.equal(exitCodeForError({ code }), EXIT.TARGET, code);
  }
  assert.equal(exitCodeForError({ code: 'UNKNOWN_HOST' }), EXIT.HOST);
  for (const code of ['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EROFS', 'EEXIST']) {
    assert.equal(exitCodeForError({ code }), EXIT.IO, code);
  }
  assert.equal(exitCodeForError(new Error('boom')), EXIT.CONFLICT);
  assert.equal(exitCodeForError({ code: 'SOMETHING_ELSE' }), EXIT.CONFLICT);
  assert.equal(exitCodeForError(null), EXIT.CONFLICT);
});

test('every err.code referenced in src is registered in exit.mjs', () => {
  const SRC = path.join(KIT, 'src');
  const nativeIo = new Set(IO_ERROR_CODES);
  const patterns = [
    /fail\(\s*'([A-Z][A-Z0-9_]+)'/g,
    /err\.code\s*=\s*'([A-Z][A-Z0-9_]+)'/g,
    /code:\s*'([A-Z][A-Z0-9_]+)'/g,
    /fail\([^\n]*?,\s*'([A-Z][A-Z0-9_]+)'\s*\)/g,
  ];
  const found = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(mjs|cjs|js)$/.test(entry.name)) continue;
      const text = fs.readFileSync(abs, 'utf8');
      for (const re of patterns) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(text))) {
          const code = match[1];
          if (nativeIo.has(code)) continue;
          found.set(code, path.relative(KIT, abs));
        }
      }
    }
  };
  walk(SRC);
  const unregistered = [...found.keys()]
    .filter((code) => !Object.prototype.hasOwnProperty.call(REGISTERED_ERROR_CODES, code))
    .sort();
  assert.deepEqual(
    unregistered,
    [],
    `unregistered err.code in src/: ${unregistered.map((code) => `${code} (${found.get(code)})`).join(', ')}`,
  );
});

test('CLI maps usage, target and host errors to their exit codes', () => {
  const dir = tmpRepo();
  assert.equal(run(['nope'], dir).status, EXIT.USAGE);
  assert.equal(run(['install', '--agent', 'not-a-host', '--target', '.'], dir).status, EXIT.HOST);
  assert.equal(run(['diff', '--target', path.join(dir, 'missing')], dir).status, EXIT.TARGET);
  assert.equal(run(['diff', '--target', '.'], dir).status, EXIT.TARGET, 'no manifest yet');
});

test('CLI maps a corrupt install manifest to exit code 3', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'install-manifest.json'), '{', 'utf8');

  const r = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, EXIT.TARGET, r.stderr);
  assert.match(r.stderr, /invalid install manifest/);
});

test('CLI maps filesystem failures to exit code 5', () => {
  const dir = tmpRepo();
  // 宿主目录位置被同名文件占住：写盘阶段 mkdir 抛 ENOTDIR/EEXIST。
  fs.writeFileSync(path.join(dir, '.claude'), 'x', 'utf8');
  const r = run(['install', '--agent', 'claude', '--target', '.'], dir);
  assert.equal(r.status, EXIT.IO, r.stderr);
  assert.match(r.stderr, /ENOTDIR|EEXIST|ENOENT/);
});

// ---- MAIN-1：--version / help 类请求不读外部宿主，项目层坏 manifest 不应挡住版本与帮助输出 ----

test('version and help stay usable despite a broken project host manifest', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.flow-kit', 'hosts'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.flow-kit', 'hosts', 'broken.json'), '{', 'utf8');

  const v = run(['--version'], dir);
  assert.equal(v.status, EXIT.OK, v.stderr);
  assert.match(v.stdout, /^\d+\.\d+\.\d+/);

  for (const argv of [['--help'], ['-h'], ['help']]) {
    const h = run(argv, dir);
    assert.equal(h.status, EXIT.OK, `${argv.join(' ')}: ${h.stderr}`);
    assert.match(h.stdout, /agentic-flow-kit v/, argv.join(' '));
  }
});

// ---- MAIN-5：unknown command 报错附可用命令候选 ----

test('unknown command error lists available commands', () => {
  const dir = tmpRepo();
  const r = run(['nope'], dir);
  assert.equal(r.status, EXIT.USAGE);
  assert.match(r.stderr, /unknown command: nope/);
  assert.match(r.stderr, /list-hosts/);
  assert.match(r.stderr, /install/);
});

// ---- help 目录与单源对齐：COMMANDS 全覆盖、--stack 列表取自 STACKS 闭集 ----

test('help lists every top-level command', () => {
  const dir = tmpRepo();
  const h = run(['--help'], dir);
  assert.equal(h.status, EXIT.OK, h.stderr);
  // help 自身是帮助入口，不在用法目录里列。
  for (const name of COMMANDS.filter((c) => c !== 'help')) {
    assert.match(h.stdout, new RegExp(`^  flow-kit ${name}(\\s|$)`, 'm'), `help 缺少命令: ${name}`);
  }
});

test('help stack list follows the STACKS closed set', () => {
  const dir = tmpRepo();
  for (const lang of ['zh-CN', 'en']) {
    const h = run(['--lang', lang, '--help'], dir);
    assert.equal(h.status, EXIT.OK, `${lang}: ${h.stderr}`);
    assert.ok(h.stdout.includes(STACKS.join('|')), `${lang}: --stack 列表与 STACKS 不一致`);
  }
});

// ---- --json 输出契约 ----

test('install --json keeps stdout pure JSON and human progress on stderr', () => {
  const dir = tmpRepo();
  const r = install(dir, ['--json']);
  const out = parseSingleJson(r);
  assert.equal(out.command, 'install');
  assert.equal(out.target, dir);
  assert.equal(out.dryRun, false);
  assert.equal(out.language, 'zh-CN');
  assert.equal(out.stack, 'node');
  assert.deepEqual(out.hosts, ['trae']);
  assert.deepEqual(out.conflicts, []);
  assert.ok(out.plan.count > 0);
  assert.ok(fs.existsSync(out.manifest));
  assert.ok(r.stderr.trim().length > 0, 'human progress should go to stderr');
  assert.ok(!r.stderr.includes('"command"'), 'stderr should not contain the JSON payload');
});

test('install --strict fails on conflicts and reports them in JSON', () => {
  const dir = tmpRepo();
  install(dir);
  fs.appendFileSync(path.join(dir, '.agents/commands/new-task.md'), '\nuser edit\n', 'utf8');

  const plain = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--target', '.', '--json'], dir);
  assert.equal(plain.status, 0, 'without --strict conflicts do not fail the run');
  assert.ok(parseSingleJson(plain).conflicts.length >= 1);

  const strict = run(['install', '--agent', 'trae', '--lang', 'zh-CN', '--target', '.', '--json', '--strict'], dir);
  assert.equal(strict.status, EXIT.CONFLICT, strict.stderr);
  assert.ok(parseSingleJson(strict).conflicts.includes('.agents/commands/new-task.md'));
});

test('diff and status --strict fail on any drift', () => {
  const dir = tmpRepo();
  install(dir);
  fs.appendFileSync(path.join(dir, '.agents/commands/new-task.md'), '\nuser edit\n', 'utf8');

  const diff = run(['diff', '--target', '.', '--json', '--strict'], dir);
  assert.equal(diff.status, EXIT.CONFLICT);
  const diffOut = parseSingleJson(diff);
  assert.ok(diffOut.summary.userModified >= 1);
  assert.equal(run(['diff', '--target', '.', '--json'], dir).status, EXIT.OK);

  const status = run(['status', '--target', '.', '--json', '--strict'], dir);
  assert.equal(status.status, EXIT.CONFLICT);
  assert.ok(parseSingleJson(status).summary.userModified >= 1);
  assert.equal(run(['status', '--target', '.', '--json'], dir).status, EXIT.OK);
});

test('prune --json --strict reports skipped orphans and exits 1', () => {
  const dir = tmpRepo();
  install(dir);
  addOrphan(dir, 'legacy/edited.md', 'edited\n', 'managed\n');

  const r = run(['prune', '--target', '.', '--json', '--strict'], dir);
  assert.equal(r.status, EXIT.CONFLICT, r.stderr);
  const out = parseSingleJson(r);
  assert.equal(out.skipped, 1);
  assert.equal(out.deleted, 0);
  assert.deepEqual(out.items, [{ path: 'legacy/edited.md', action: 'skip' }]);
  assert.ok(fs.existsSync(path.join(dir, 'legacy/edited.md')));
});

test('prune --json reports deletions and exits 0 without --strict', () => {
  const dir = tmpRepo();
  install(dir);
  addOrphan(dir, 'legacy/old.md', 'old\n');

  const r = run(['prune', '--target', '.', '--json'], dir);
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = parseSingleJson(r);
  assert.equal(out.deleted, 1);
  assert.equal(out.skipped, 0);
  assert.deepEqual(out.items, [{ path: 'legacy/old.md', action: 'delete' }]);
  assert.equal(fs.existsSync(path.join(dir, 'legacy/old.md')), false);
});

test('explain --json returns one structured object', () => {
  const dir = tmpRepo();
  install(dir);

  const r = run(['explain', '.agents/commands/new-task.md', '--target', '.', '--json'], dir);
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = parseSingleJson(r);
  assert.equal(out.path, '.agents/commands/new-task.md');
  assert.equal(out.kind, 'unchanged');
  assert.ok(out.template);
  assert.ok(out.managedHash);
  assert.equal(out.actualHash, out.managedHash);
  assert.equal(out.model, null);
});

test('doctor --json returns checks and a summary', () => {
  const dir = tmpRepo();
  install(dir);

  const r = run(['doctor', '--target', '.', '--json'], dir);
  assert.equal(r.status, EXIT.OK, r.stderr);
  const out = parseSingleJson(r);
  assert.equal(out.ok, true);
  assert.equal(out.target, dir);
  assert.ok(Array.isArray(out.checks) && out.checks.length > 0);
  assert.equal(out.summary.total, out.checks.length);
  assert.equal(out.summary.failed, 0);
  assert.ok(out.checks.every((c) => typeof c.name === 'string' && typeof c.ok === 'boolean'));
  assert.equal(out.deep, null);
});

test('list-hosts --json lists the registry surface', () => {
  const r = run(['list-hosts', '--json'], KIT);
  assert.equal(r.status, EXIT.OK, r.stderr);
  const hosts = parseSingleJson(r);
  assert.equal(hosts.length, 14);
  const claude = hosts.find((h) => h.name === 'claude');
  assert.ok(claude);
  assert.equal(claude.dir, '.claude');
  assert.equal(claude.modelField, 'model');
  assert.ok(hosts.every((h) => h.skills === null || typeof h.skills === 'string'));
});

test('parseArgs keeps boolean flags boolean even when placed right before positional arguments', () => {
  const r1 = parseArgs(['remove-host', '--dry-run', 'claude']);
  assert.equal(flag(r1, 'dry-run'), true);
  assert.deepEqual(r1._, ['remove-host', 'claude']);

  const r2 = parseArgs(['gate', '--strict', '--json', 'check']);
  assert.equal(flag(r2, 'strict'), true);
  assert.equal(flag(r2, 'json'), true);
  assert.deepEqual(r2._, ['gate', 'check']);

  const r3 = parseArgs(['explain', '--json', '.agents/commands/new-task.md']);
  assert.equal(flag(r3, 'json'), true);
  assert.deepEqual(r3._, ['explain', '.agents/commands/new-task.md']);

  // Explicit --flag=false / --flag=true still works as before
  const r4 = parseArgs(['install', '--dry-run=false', 'extra']);
  assert.equal(flag(r4, 'dry-run'), false);
  assert.deepEqual(r4._, ['install', 'extra']);

  // Dual-mode --version & --summary disambiguate by command context
  const r5 = parseArgs(['--version', 'install']);
  assert.equal(flag(r5, 'version'), true);
  assert.deepEqual(r5._, ['install']);

  const r6 = parseArgs(['metrics', 'export', '--version', '2.0.0']);
  assert.equal(r6.version, '2.0.0');

  const r7 = parseArgs(['mcp', '--summary', 'audit']);
  assert.equal(flag(r7, 'summary'), true);
  assert.deepEqual(r7._, ['mcp', 'audit']);

  const r8 = parseArgs(['handoff', 'create', '--summary', 'handoff note']);
  assert.equal(r8.summary, 'handoff note');

  const r9 = parseArgs(['timeline', 'append', '--run', 'run-1', '--summary', 'step done', '--status', 'success']);
  assert.equal(r9.summary, 'step done');
  assert.equal(r9.status, 'success');
  assert.deepEqual(r9._, ['timeline', 'append']);

  const r10 = parseArgs(['shadow-run', '--status', '--json']);
  assert.equal(flag(r10, 'status'), true);
  assert.deepEqual(r10._, ['shadow-run']);
});
