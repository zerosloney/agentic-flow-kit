import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInstallArgs, projectShapeFlow } from '../src/tui/flows.mjs';
import { createScreen, runPrompt, createLineReader, QuitError } from '../src/tui/screen.mjs';
import { createSelect, createMultiSelect } from '../src/tui/widgets.mjs';
import { askText } from '../src/tui/prompts.mjs';
import { makeT } from '../src/i18n.mjs';
import { makeTmp } from './helpers/tmp.mjs';

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

test('buildInstallArgs: optional models are opt-in and keep flags unchanged', () => {
  const plain = buildInstallArgs({ hosts: ['claude'], lang: 'zh-CN', stack: 'node' });
  assert.equal(plain.flags.size, 0);
  assert.equal(plain.tuiModels, undefined);

  const modeled = buildInstallArgs({
    hosts: ['claude'], lang: 'zh-CN', stack: 'node',
    models: { claude: { code: 'haiku', judgment: 'opus', review: 'opus' } },
  });
  assert.equal(modeled.flags.size, 0);
  assert.deepEqual(modeled.tuiModels, { claude: { code: 'haiku', judgment: 'opus', review: 'opus' } });
});

// installFlow 产参锁定：flows.mjs 调用点以 opts.includes(...) 直接映射为 gitConfig/dryRun/force
// （git-config 在 pickMany 里默认勾选）。installFlow 是交互流，降级 e2e 触达需按每个组合跑完整
// 问答脚本，故按调用点的真实映射表达式做表驱动断言；argv 对 installCommand 的效果由 CLI 侧安装测试覆盖。
test('installFlow 产参锁定: opts → buildInstallArgs 映射 (mirrors flows.mjs call site)', () => {
  const cases = [
    { opts: [], flags: ['no-git-config'] }, // 全不勾：git 配置关闭
    { opts: ['git-config'], flags: [] }, // 默认勾选：与 CLI 默认一致，无额外 flags
    { opts: ['git-config', 'dry-run', 'force'], flags: ['dry-run', 'force'] },
    { opts: ['dry-run'], flags: ['no-git-config', 'dry-run'] }, // git-config 被取消勾选
  ];
  for (const { opts, flags } of cases) {
    const args = buildInstallArgs({
      hosts: ['trae'],
      lang: 'zh-CN',
      stack: 'node',
      surfaces: [],
      gitConfig: opts.includes('git-config'),
      dryRun: opts.includes('dry-run'),
      force: opts.includes('force'),
      models: null,
    });
    assert.deepEqual([...args.flags], flags, `opts=${JSON.stringify(opts)} should produce flags=${JSON.stringify(flags)}`);
    assert.deepEqual(args._, ['install']);
    assert.deepEqual(args.agents, ['trae']);
    assert.equal(args.lang, 'zh-CN');
    assert.equal(args.surfaces, undefined);
    assert.equal(args.tuiModels, undefined);
  }
});

test('buildInstallArgs: shape defaults add no argv keys (manifest stays unpinned)', () => {
  const plain = buildInstallArgs({ hosts: ['trae'], lang: 'zh-CN', stack: 'node' });
  const withDefaults = buildInstallArgs({
    hosts: ['trae'], lang: 'zh-CN', stack: 'node', product: 'web', ports: {}, scaffold: 'full',
  });
  assert.deepEqual(withDefaults, plain);
  assert.equal('product' in withDefaults, false);
  assert.equal('api-port' in withDefaults, false);
  assert.equal('web-port' in withDefaults, false);
  assert.equal('scaffold' in withDefaults, false);
});

test('buildInstallArgs: custom shape choices map to argv-shaped keys and leave flags untouched', () => {
  const api = buildInstallArgs({
    hosts: ['trae'], lang: 'zh-CN', stack: 'node', product: 'api', ports: { api: 9999 }, scaffold: 'minimal',
  });
  assert.equal(api.product, 'api');
  assert.equal(api['api-port'], 9999);
  assert.equal(api['web-port'], undefined);
  assert.equal(api.scaffold, 'minimal');
  assert.equal(api.flags.size, 0);

  const web = buildInstallArgs({
    hosts: ['trae'], lang: 'zh-CN', stack: 'node', product: 'web', ports: { api: 18080, web: 15173 }, scaffold: 'full',
  });
  assert.equal('product' in web, false, 'web is the default product and must not be pinned');
  assert.equal(web['api-port'], 18080);
  assert.equal(web['web-port'], 15173);
  assert.equal('scaffold' in web, false, 'full is the default scaffold and must not be pinned');
  assert.equal(web.flags.size, 0);
});

// 降级路径假件：reader 依次吐出答案行；'' = 直接回车；undefined（队列走完）= EOF。
function degradedCtx(answers, lang = 'zh-CN') {
  const chunks = [];
  const screen = { interactive: false, output: { write: (s) => chunks.push(s) } };
  return {
    ctx: { screen, t: makeT(lang), lang, reader: async () => answers.shift() ?? null },
    output: () => chunks.join(''),
  };
}

test('projectShapeFlow degraded: all defaults (web + stack ports + full scaffold)', async () => {
  const { ctx, output } = degradedCtx(['1', '1', '1']);
  assert.deepEqual(await projectShapeFlow(ctx, { stack: 'node' }), {
    product: 'web', ports: {}, scaffold: 'full',
  });
  assert.ok(output().includes('API 3000'), 'default port label should show the stack API port');
  assert.ok(output().includes('Web 5173'), 'default port label should show the stack Web port');
});

test('projectShapeFlow degraded: api + custom API port only (no Web question)', async () => {
  const { ctx, output } = degradedCtx(['2', '2', '9999', '1']);
  assert.deepEqual(await projectShapeFlow(ctx, { stack: 'node' }), {
    product: 'api', ports: { api: 9999 }, scaffold: 'full',
  });
  assert.ok(!output().includes('Web 端口'), 'api shape must not ask for a Web port');
});

test('projectShapeFlow degraded: web + both ports custom', async () => {
  const { ctx } = degradedCtx(['1', '2', '18080', '15173', '1']);
  assert.deepEqual(await projectShapeFlow(ctx, { stack: 'node' }), {
    product: 'web', ports: { api: 18080, web: 15173 }, scaffold: 'full',
  });
});

test('projectShapeFlow degraded: blank port answers keep the stack defaults (ports absent)', async () => {
  const { ctx } = degradedCtx(['1', '2', '', '', '1']);
  assert.deepEqual(await projectShapeFlow(ctx, { stack: 'node' }), {
    product: 'web', ports: {}, scaffold: 'full',
  });
});

test('projectShapeFlow degraded: invalid port re-asks until valid', async () => {
  const { ctx, output } = degradedCtx(['1', '2', '0', 'abc', '18080', '', '1']);
  assert.deepEqual(await projectShapeFlow(ctx, { stack: 'node' }), {
    product: 'web', ports: { api: 18080 }, scaffold: 'full',
  });
  assert.ok(output().includes('端口须为 1–65535 的整数'), 'invalid port should print the validation message');
});

test('projectShapeFlow degraded: library skips the ports question entirely', async () => {
  const { ctx, output } = degradedCtx(['3', '1']);
  assert.deepEqual(await projectShapeFlow(ctx, { stack: 'node' }), {
    product: 'library', ports: {}, scaffold: 'full',
  });
  assert.ok(!output().includes('选择端口配置'), 'library shape must not ask about ports');
});

test('projectShapeFlow degraded: EOF / quit returns null', async () => {
  assert.equal(await projectShapeFlow(degradedCtx([]).ctx, { stack: 'node' }), null);
  // 形态已回答，端口问题处 EOF：整段流程放弃
  assert.equal(await projectShapeFlow(degradedCtx(['1']).ctx, { stack: 'node' }), null);
});

const press = async (input, name, sequence) => {
  await new Promise((r) => setImmediate(r));
  input.emit('keypress', { name, sequence: sequence ?? name });
};

test('projectShapeFlow interactive: web + custom ports, invalid API port re-asks', async () => {
  const { input, screen } = fakeInteractive();
  screen.setup();
  const ctx = { screen, t: makeT('zh-CN'), lang: 'zh-CN' };
  const flow = projectShapeFlow(ctx, { stack: 'node' });

  await press(input, 'return', '\r'); // shape: web（默认光标）
  await press(input, 'down', '\x1b[B'); // ports: 默认 → 自定义
  await press(input, 'return', '\r');
  await press(input, '0', '0');
  await press(input, 'return', '\r'); // 非法：0 触发红字重问
  await press(input, 'backspace');
  for (const ch of '19090') await press(input, ch, ch);
  await press(input, 'return', '\r');
  for (const ch of '15173') await press(input, ch, ch);
  await press(input, 'return', '\r'); // web 端口
  await press(input, 'return', '\r'); // scaffold: full（默认光标）

  assert.deepEqual(await flow, { product: 'web', ports: { api: 19090, web: 15173 }, scaffold: 'full' });
  screen.restore();
});

test('askText degraded path reads a line and retries on validation error', async () => {
  const answers = ['', 'sonnet'];
  const screen = { interactive: false, output: { write() {} } };
  const ctx = { screen, t: (key) => key, reader: async () => answers.shift() ?? null };
  const value = await askText(ctx, {
    question: 'Model',
    validate: (s) => (String(s).trim() ? null : 'required'),
  });
  assert.equal(value, 'sonnet');
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

// 回归锁：主菜单进体检 → 普通体检，doctor 必须正常产出而非抛 TypeError
// （flows 内 doctor 调用须携带 baseArgs 的 flags，否则 cli/args.mjs flag() 解引用 args.flags 崩溃）
test('degraded wizard e2e: menu 4 doctor normal check prints doctor output without TypeError', async () => {
  const dir = makeTmp('flow-kit-wizard-doctor-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const setup = spawnSync(process.execPath, [BIN, 'install', '--agent', 'trae', '--stack', 'node', '--target', '.'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
  assert.equal(setup.status, 0, setup.stderr);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FIXTURE], { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });
    let stdout = '';
    let stderr = '';
    let sentRun = false;
    let sentQuit = false;
    child.stdout.on('data', (d) => {
      stdout += d;
      // 体检子菜单出现后选第 1 项「普通体检」；doctor 汇总（或 TypeError，修复前的坏路径）落地后再拒绝「返回菜单」
      if (!sentRun && stdout.includes('普通体检')) {
        sentRun = true;
        child.stdin.write('1\n');
      } else if (sentRun && !sentQuit && /doctor (失败|全过)|Cannot read properties/.test(stdout)) {
        sentQuit = true;
        child.stdin.write('n\n');
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('degraded wizard doctor flow did not finish within 10s'));
    }, 10000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.write('4\n'); // 主菜单第 4 项：体检
  });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes('install-manifest'), 'doctor check rows should print');
  assert.ok(/doctor (失败|全过)/.test(result.stdout), 'doctor summary should print');
  assert.ok(!result.stdout.includes('Cannot read properties'), 'TypeError must not leak into the wizard doctor flow');
  assert.equal(result.stderr.trim(), '', 'no stack traces expected');
});

// 降级向导安装 e2e：按安装流完整答案序列（含新增的形态 / 端口 / 脚手架三问）跑到写盘，
// 断言计划框落了选择结果，且 manifest 只记显式值（api 形态的 web 端口不被钉死）。
test('degraded wizard e2e: install flow asks shape/ports/scaffold and installs with them', () => {
  const dir = makeTmp('flow-kit-wizard-install-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  // 菜单 install → trae 勾选+确认 → 语言 zh-CN → 栈 node → 形态 api → 端口自定义 → 9999 →
  // 脚手架 minimal → 无切面 → 默认开关 → 确认安装 → 不体检 → 返回菜单 n
  const answers = ['1', '1', '', '1', '2', '2', '2', '9999', '2', '', '', 'y', 'n', 'n'].join('\n') + '\n';
  const r = spawnSync(process.execPath, [FIXTURE], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, FLOW_KIT_TEST: '1' },
    input: answers,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.trim(), '', 'no stack traces expected');
  assert.ok(r.stdout.includes('选择项目形态'), 'shape question should be asked');
  assert.ok(r.stdout.includes('选择端口配置'), 'ports question should be asked');
  assert.ok(r.stdout.includes('选择脚手架档位'), 'scaffold question should be asked');
  assert.ok(!r.stdout.includes('Web 端口'), 'api shape must not ask for a Web port');
  assert.ok(r.stdout.includes('形态：仅 API 服务'), 'plan box should show the chosen shape');
  assert.ok(r.stdout.includes('端口：API 9999（自定义）'), 'plan box should mark the custom port');
  assert.ok(r.stdout.includes('脚手架：精简脚手架'), 'plan box should show the non-default scaffold');

  const mf = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'install-manifest.json'), 'utf8'));
  assert.equal(mf.product, 'api');
  assert.deepEqual(mf.ports, { api: 9999 });
  assert.equal(mf.scaffold, 'minimal');
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

// 交互模式假件：EventEmitter input（emit('data') 走自研解码器真实路径，不直接 emit keypress）+ PassThrough output
function fakeInteractive() {
  const input = new EventEmitter();
  input.setRawMode = () => {};
  input.isTTY = true;
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (d) => chunks.push(d));
  const screen = createScreen({ input, output });
  const outText = async () => {
    await new Promise((r) => setImmediate(r));
    const s = Buffer.concat(chunks).toString('utf8');
    chunks.length = 0;
    return s;
  };
  return { input, screen, outText };
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

test('keypress undefined (fragmented escape sequence) is ignored, next valid key still drives select', async () => {
  const input = new EventEmitter();
  input.setRawMode = () => {};
  input.isTTY = true;
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (d) => chunks.push(d));

  const screen = createScreen({ input, output });
  screen.setup();

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

  // 真实崩溃序列：readline 对分片转义序列先 emit undefined key，随后才是合法键
  input.emit('keypress', undefined); // 同步 emit：若守卫缺失，此处直接抛 TypeError
  input.emit('keypress', { name: 'return' });
  assert.equal(await valueP, 'first', 'undefined key must be silently ignored; return resolves the 1st item');

  await new Promise((r) => setImmediate(r));
  const out = Buffer.concat(chunks).toString('utf8');
  assert.ok(out.includes('❯'), 'output should contain the cursor mark ❯');
});

test('decoder: CSI down in one chunk resolves the 2nd select item', async () => {
  const { input, screen } = fakeInteractive();
  screen.setup();
  const valueP = runPrompt(screen, {
    title: 'T',
    question: 'Q',
    hint: 'H',
    widget: createSelect({ items: [{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }] }),
  });
  input.emit('data', '\x1b[B'); // 完整 CSI 方向键下
  input.emit('data', '\r');
  assert.equal(await valueP, 'second', 'raw-data down+return should resolve the 2nd item');
  screen.restore();
});

test('decoder: CSI split across chunks (\\x1b[ then A) yields up and wraps to the last item', async () => {
  const { input, screen } = fakeInteractive();
  screen.setup();
  const valueP = runPrompt(screen, {
    title: 'T',
    question: 'Q',
    hint: 'H',
    widget: createSelect({ items: [{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }] }),
  });
  input.emit('data', '\x1b['); // 不完整 CSI 前缀：须保留余量等下一 chunk
  input.emit('data', 'A'); // 与余量续解出 up
  input.emit('data', '\r');
  // 两项表 index0 按 up 回绕到末项：选中 second 即证明分片序列解码成功且光标真的移动了
  assert.equal(await valueP, 'second', 'fragmented up must move the cursor (wrap to last), not stay at index 0');
  screen.restore();
});

test('decoder: SS3 \\x1bOB (legacy arrow down) resolves the 2nd select item', async () => {
  const { input, screen } = fakeInteractive();
  screen.setup();
  const valueP = runPrompt(screen, {
    title: 'T',
    question: 'Q',
    hint: 'H',
    widget: createSelect({ items: [{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }] }),
  });
  input.emit('data', '\x1bOB'); // 老终端 SS3 形式方向键下
  input.emit('data', '\r');
  assert.equal(await valueP, 'second', 'SS3 down+return should resolve the 2nd item');
  screen.restore();
});

test('decoder: space data toggles the multiselect check mark into the view', async () => {
  const { input, screen, outText } = fakeInteractive();
  screen.setup();
  const valueP = runPrompt(screen, {
    title: 'T',
    question: 'Q',
    hint: 'H',
    widget: createMultiSelect({ items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
  });
  input.emit('data', ' ');
  const out = await outText();
  assert.ok(out.includes('✓'), 'space should check the item under the cursor');
  input.emit('data', '\x03'); // 收尾退出，避免悬着的 promise
  await assert.rejects(valueP, QuitError);
  screen.restore();
});

test('decoder: \\x03 data quits runPrompt with QuitError', async () => {
  const { input, screen } = fakeInteractive();
  screen.setup();
  const valueP = runPrompt(screen, {
    title: 'T',
    question: 'Q',
    hint: 'H',
    widget: createSelect({ items: [{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }] }),
  });
  input.emit('data', '\x03');
  await assert.rejects(valueP, QuitError, 'Ctrl+C byte via raw data must surface as QuitError');
  screen.restore();
});

test('decoder: lone ESC with no follow-up yields escape after the 50ms window', async () => {
  const { input, screen } = fakeInteractive();
  screen.setup();
  const keys = [];
  input.on('keypress', (key) => keys.push(key));
  input.emit('data', '\x1b');
  assert.deepEqual(keys, [], 'nothing decoded while waiting for follow-up');
  await new Promise((r) => setTimeout(r, 60)); // 越过 50ms 等待窗
  assert.equal(keys.length, 1, 'exactly one key decoded after the window');
  assert.equal(keys[0].name, 'escape');
  assert.equal(keys[0].sequence, '\x1b');
  screen.restore(); // 清理计时 / 监听，避免挂着的 timer 悬住事件循环
});

test('decoder: spurious stdin close must not kill the decoder (frozen prompt regression)', async () => {
  const { input, screen, outText } = fakeInteractive();
  screen.setup();
  // 虚假 close（Windows 同步子进程后控制台句柄抖动）：解码器只归 restore 清理，close 不得摘 data 监听
  input.emit('close');
  const valueP = runPrompt(screen, {
    title: 'T',
    question: 'Q',
    hint: 'H',
    widget: createSelect({ items: [{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }] }),
  });
  input.emit('data', '\r');
  assert.equal(await valueP, 'first', 'after a spurious close the decoder must still parse return → 1st item');
  const out = await outText();
  assert.ok(out.includes('❯'), 'output should contain the cursor mark ❯');
  screen.restore();
});

// SCR-1 回归锁：prompt 结束必须恢复 cooked（命令执行期 ISIG 生效，Ctrl+C 走 Node 默认 SIGINT 中断，
// 不再出现「wizard 安装挂死只能杀终端」）；下一问开始再重进 raw。rawMode 开关是可观察的输入模式契约。
// 执行期打入的换行终结输入由仍挂着的解码器消费后丢弃（无 keypress 监听），不得滞留成下一问的输入；
// 真 TTY 上 cooked 行缓冲会回显残行，内存流无行纪律，故按进程内可观察行为断言并以此为准。
test('prompt lifecycle: raw during the prompt, cooked for command execution, raw again next prompt', async () => {
  const input = new EventEmitter();
  const rawLog = [];
  input.setRawMode = (on) => { rawLog.push(on); };
  input.isTTY = true;
  const output = new PassThrough();
  const screen = createScreen({ input, output });
  screen.setup();
  assert.equal(rawLog[0], true, 'setup enters raw mode');

  const ask = () => runPrompt(screen, {
    title: 'T',
    question: 'Q',
    hint: 'H',
    widget: createSelect({ items: [{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }] }),
  });

  const p1 = ask();
  assert.equal(rawLog.at(-1), true, 'prompt must run in raw mode');
  input.emit('data', '\r');
  assert.equal(await p1, 'first');
  assert.equal(rawLog.at(-1), false, 'prompt end must restore cooked mode for the command-execution phase');

  // 命令执行期：打入的回车在此被丢弃，不得预答下一问
  input.emit('data', '\n');

  const p2 = ask();
  assert.equal(rawLog.at(-1), true, 'next prompt re-enters raw mode');
  const preAnswered = await Promise.race([p2.then(() => true), new Promise((r) => setImmediate(() => r(false)))]);
  assert.equal(preAnswered, false, 'execution-phase Enter must not pre-answer the next prompt');
  input.emit('data', '\r');
  assert.equal(await p2, 'first', 'fresh prompt starts from the first item with no residual selection');

  screen.restore();
});

// SCR-2 回归锁：readline terminal 模式（构造时探测 output.isTTY）收到 \x03 会 emit 'SIGINT'；
// 无监听时只 emit 'pause'，pending 的 reader() Promise 永久悬挂（wizard 冻结无输出）。
// 修复语义与 EOF 一致：resolve null + eof 置位，走既有 null → 干净退出链路（wizard 对 null 与 QuitError 同为退出码 0）。
test('degraded reader: SIGINT resolves the pending read with null instead of freezing', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.isTTY = true;
  const reader = createLineReader(input, output);
  const p = reader();
  input.write('\x03');
  const settled = await Promise.race([
    p.then(() => 'resolved'),
    new Promise((r) => setTimeout(() => r('hung'), 300)),
  ]);
  assert.equal(settled, 'resolved', 'pending read must not hang after SIGINT');
  assert.equal(await p, null, 'SIGINT quits like EOF: resolve null');
  assert.equal(await reader(), null, 'every later read quits too (EOF-identical semantics)');
});

// 无 pending 时 SIGINT 同样触发退出：滞留残行一并丢弃，后续读取不得消费陈旧行（否则多问一轮才退）
test('degraded reader: SIGINT drops stale queued lines so no later read consumes them', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.isTTY = true;
  const reader = createLineReader(input, output);
  input.write('5\n'); // 无 pending 读入：行滞留队列
  await new Promise((r) => setTimeout(r, 20)); // 等 'line' 事件落队
  input.write('\x03');
  await new Promise((r) => setTimeout(r, 20)); // 等 data → keypress → SIGINT 处理完成
  assert.equal(await reader(), null, 'stale line must be drained; the next read quits with null');
});
