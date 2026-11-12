import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInstallArgs } from '../src/tui/wizard.mjs';
import { createScreen, runPrompt } from '../src/tui/screen.mjs';
import { createSelect } from '../src/tui/widgets.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const FIXTURE = path.join(KIT, 'tests', 'fixtures', 'wizard-degraded.mjs');

test('buildInstallArgs: defaults (git-config on, empty flags Set)', () => {
  const args = buildInstallArgs({ hosts: ['trae', 'claude'], lang: 'zh-CN', stack: 'dotnet' });
  assert.deepEqual(args._, ['install']);
  assert.deepEqual(args.agents, ['trae', 'claude']);
  assert.equal(args.lang, 'zh-CN');
  assert.equal(args.stack, 'dotnet');
  assert.equal(args.flags.size, 0);
  assert.ok(args.flags instanceof Set);
});

test('buildInstallArgs: switch semantics (no-git-config / dry-run / force)', () => {
  // gitConfig=false turns git config off; dry-run / force turn their flags on
  const mixed = buildInstallArgs({ hosts: ['trae'], lang: 'en', stack: 'node', gitConfig: false, dryRun: true, force: true });
  assert.equal(mixed.flags.size, 3);
  assert.ok(mixed.flags.has('no-git-config'), 'gitConfig=false should produce no-git-config');
  assert.ok(mixed.flags.has('dry-run'));
  assert.ok(mixed.flags.has('force'));
  assert.ok(!mixed.flags.has('git-config'));

  // git-config on, dry-run/force off -> empty flags (same as CLI defaults)
  const plain = buildInstallArgs({ hosts: [], lang: 'en', stack: 'empty', gitConfig: true, dryRun: false, force: false });
  assert.equal(plain.flags.size, 0);
});

test('non-TTY: piped stdin (immediate EOF) prints help, exits 0, no stack traces', () => {
  const r = spawnSync(process.execPath, [BIN], { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('install'), 'stdout should contain the help keyword');
  assert.equal(r.stderr.trim(), '', 'no stack traces expected');
});

test('degraded wizard e2e: menu 5 prints host table, n on backOrQuit exits 0', async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FIXTURE], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let sentQuit = false;
    child.stdout.on('data', (d) => {
      stdout += d;
      // 宿主表落地后再拒绝「返回菜单」，保证表内容先于退出被断言到
      if (!sentQuit && stdout.includes('.trae')) {
        sentQuit = true;
        child.stdin.write('n\n');
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('degraded wizard did not finish within 5s'));
    }, 5000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.write('5\n'); // 主菜单第 5 项：宿主列表
  });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('trae'), 'host table should list trae');
  assert.ok(result.stdout.includes('返回菜单？'), 'back-or-quit prompt should appear');
  assert.equal(result.stderr.trim(), '', 'no stack traces expected');
});

test('degraded wizard e2e: EOF at main menu exits 0 and prints the menu', () => {
  const r = spawnSync(process.execPath, [FIXTURE], { stdio: 'pipe', encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('安装'), 'degraded mode should print the first menu item');
  assert.ok(r.stdout.includes('退出'), 'degraded mode should print the last menu item');
  assert.equal(r.stderr.trim(), '', 'no stack traces expected');
});

test('screen.render: cursor bookkeeping across grow, shrink and equal redraws', async () => {
  const { screen, written } = fakeScreen();
  screen.render(['a']);
  assert.equal(await written(), '\r\x1b[2Ka\n', 'first draw must not move the cursor up');
  screen.render(['a', 'b']);
  assert.equal(await written(), '\x1b[1A\r\x1b[2Ka\n\r\x1b[2Kb\n', 'grow: move up last lines then rewrite');
  screen.render(['a', 'b']);
  assert.equal(await written(), '\x1b[2A\r\x1b[2Ka\n\r\x1b[2Kb\n', 'equal: move up 2 and rewrite both');
  screen.render(['c']);
  assert.equal(await written(), '\x1b[2A\r\x1b[2Kc\n\r\x1b[2K\n\x1b[1A', 'shrink: rewrite + clear residue + recenter');
});

test('screen.clear erases the block; screen.print resets the origin and writes raw output', async () => {
  const { screen, written } = fakeScreen();
  screen.render(['x', 'y']);
  await written();
  screen.clear();
  assert.equal(await written(), '\x1b[2A\r\x1b[2K\n\r\x1b[2K\n\x1b[2A', 'clear must erase every rendered line');
  screen.print('hello\n');
  assert.equal(await written(), 'hello\n', 'print writes raw output after resetting the origin');
  screen.render(['z']);
  assert.equal(await written(), '\r\x1b[2Kz\n', 'render after print must not move up');
});

// PassThrough 假流：collect chunks，written() 等流事件落地后按段取出并清空
function fakeScreen() {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (d) => chunks.push(d));
  const screen = createScreen({ input, output });
  const written = async () => {
    await new Promise((r) => setImmediate(r));
    const s = Buffer.concat(chunks).toString('utf8');
    chunks.length = 0;
    return s;
  };
  return { input, output, screen, written };
}

test('pseudo-TTY: interactive flag after setup and keypress-driven select (P0 regression lock)', async () => {
  const input = new PassThrough();
  input.setRawMode = () => {};
  input.isTTY = true;
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (d) => chunks.push(d));

  const screen = createScreen({ input, output });
  screen.setup();
  assert.equal(screen.interactive, true, 'interactive should be true after setup');
  assert.equal(screen.setup(), undefined, 'setup must not return a value');

  // take the promise before emitting keys: down -> 2nd item, return -> resolve its value
  const valueP = runPrompt(screen, {
    title: 'T',
    question: 'Q',
    hint: 'H',
    widget: createSelect({
      items: [
        { value: 'first', label: 'First' },
        { value: 'second', label: 'Second' },
      ],
    }),
  });
  input.emit('keypress', { name: 'down' });
  input.emit('keypress', { name: 'return' });
  assert.equal(await valueP, 'second', 'down+return should resolve the 2nd item value');

  await new Promise((r) => setImmediate(r)); // let streamed 'data' events settle
  const out = Buffer.concat(chunks).toString('utf8');
  assert.ok(out.includes('╭'), 'output should contain the box border ╭');
  assert.ok(out.includes('❯'), 'output should contain the cursor mark ❯');
  assert.ok(out.includes('\x1b[?25l'), 'setup should hide the cursor in interactive mode');
  screen.restore();
  await new Promise((r) => setImmediate(r));
  const out2 = Buffer.concat(chunks).toString('utf8');
  assert.ok(out2.includes('\x1b[?25h'), 'restore should pair with the hidden cursor');
});
