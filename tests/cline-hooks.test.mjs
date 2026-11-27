import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(KIT, 'templates', 'hosts', 'cline', 'hooks', 'PreToolUse.cjs');

// 假 flow-kit：记录 stdin payload，按 FAKE_MODE 模拟门禁的各种返回形态
const FAKE_SRC = `import fs from 'node:fs';
const argv = process.argv.slice(2);
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { /* 无 stdin */ }
if (process.env.FAKE_RECORD) fs.appendFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv, raw }) + '\\n');
const mode = process.env.FAKE_MODE || 'allow';
if (mode === 'deny') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'fake deny' } }) + '\\n');
} else if (mode === 'ask') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'fake ask' } }) + '\\n');
} else if (mode === 'garbage') {
  process.stdout.write('gate exploded\\n');
} else if (mode === 'wrongshape') {
  process.stdout.write('{"foo":1}\\n');
} else if (mode === 'context') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: 'engine-face notice' } }) + '\\n');
} else if (mode === 'allowdecision') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow' } }) + '\\n');
} else if (mode === 'emptyobject') {
  process.stdout.write('{}\\n');
} else if (mode === 'exit1') {
  process.stderr.write('gate unavailable\\n');
  process.exit(1);
}
`;

function installFakeFlowKit(dir) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const js = path.join(bin, 'flow-kit-fake.mjs');
  fs.writeFileSync(js, FAKE_SRC);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, 'flow-kit.cmd'), `@echo off\r\n"${process.execPath}" "${js}" %*\r\n`);
  } else {
    const shim = path.join(bin, 'flow-kit');
    fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  return bin;
}

function envWithoutPath(base) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH') delete env[key];
  }
  return env;
}

function envWithPath(dir) {
  const env = envWithoutPath(process.env);
  env.PATH = dir + path.delimiter + (process.env.PATH || process.env.Path || '');
  return env;
}

function runAdapter({ bin, payload, raw, mode = 'allow', record }) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: raw === undefined ? JSON.stringify(payload) : raw,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...envWithPath(bin), FAKE_MODE: mode, FAKE_RECORD: record },
  });
  const calls = fs.existsSync(record)
    ? fs.readFileSync(record, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status, calls };
}

function writeCall(name, input, cwd) {
  return {
    hookName: 'tool_call',
    tool_call: { name, input },
    workspaceRoots: [cwd],
  };
}

function setup() {
  const dir = makeTmp('flow-kit-cline-');
  const bin = installFakeFlowKit(dir);
  return { dir, bin, record: path.join(dir, 'calls.jsonl') };
}

test('write_to_file forwards the real content to the write gate', () => {
  const { dir, bin, record } = setup();
  const content = '# Title\n\nbody line\n';
  const { calls } = runAdapter({ bin, record, payload: writeCall('write_to_file', { path: 'notes.md', content }, dir) });

  assert.equal(calls.length, 1, 'adapter must call the write gate once');
  const gatePayload = JSON.parse(calls[0].raw);
  assert.equal(gatePayload.tool_name, 'write');
  assert.equal(gatePayload.tool_input.content, content, 'gate must receive the full write_to_file content');
});

test('replace_in_file forwards the post-edit content to the write gate', () => {
  const { dir, bin, record } = setup();
  fs.writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  const diff = [
    '------- SEARCH', 'const a = 1;', '=======', 'const a = 42;', '+++++++ REPLACE',
    '------- SEARCH', 'const c = 3;', '=======', 'const c = 33;', '+++++++ REPLACE',
  ].join('\n');
  const { calls } = runAdapter({ bin, record, payload: writeCall('replace_in_file', { path: 'app.js', diff }, dir) });

  assert.equal(calls.length, 1, 'adapter must call the write gate once');
  const gatePayload = JSON.parse(calls[0].raw);
  assert.equal(gatePayload.tool_input.content, 'const a = 42;\nconst b = 2;\nconst c = 33;\n',
    'gate must receive the file content after every diff hunk is applied');
});

test('replace_in_file preserves CRLF content when the diff uses CRLF', () => {
  const { dir, bin, record } = setup();
  fs.writeFileSync(path.join(dir, 'win.js'), 'const a = 1;\r\nconst b = 2;\r\n');
  const diff = '------- SEARCH\r\nconst a = 1;\r\n=======\r\nconst a = 42;\r\n+++++++ REPLACE\r\n';
  const { calls } = runAdapter({ bin, record, payload: writeCall('replace_in_file', { path: 'win.js', diff }, dir) });

  assert.equal(calls.length, 1, 'adapter must call the write gate once');
  const gatePayload = JSON.parse(calls[0].raw);
  assert.equal(gatePayload.tool_input.content, 'const a = 42;\r\nconst b = 2;\r\n',
    'gate must receive CRLF content unchanged');
});

test('replace_in_file cancels when the diff cannot be applied to the file', () => {
  const { dir, bin, record } = setup();
  fs.writeFileSync(path.join(dir, 'app.js'), 'const a = 1;\n');
  const diff = ['------- SEARCH', 'const missing = 0;', '=======', 'const replaced = 1;', '+++++++ REPLACE'].join('\n');
  const { stdout, calls } = runAdapter({ bin, record, payload: writeCall('replace_in_file', { path: 'app.js', diff }, dir) });

  assert.equal(calls.length, 0, 'adapter must not ask the gate to judge a proposal it could not reconstruct');
  assert.match(stdout, /"cancel":true/, 'adapter must fail closed instead of allowing an ungated write');
});

test('write tool without reconstructable content cancels', () => {
  const { dir, bin, record } = setup();
  const { stdout, calls } = runAdapter({ bin, record, payload: writeCall('write_to_file', { path: 'notes.md' }, dir) });

  assert.equal(calls.length, 0);
  assert.match(stdout, /"cancel":true/, 'adapter must not send an empty proposal for a write whose content it cannot see');
});

test('hook that exits non-zero cancels instead of allowing', () => {
  const { dir, bin, record } = setup();
  const { stdout } = runAdapter({ bin, record, mode: 'exit1', payload: writeCall('write_to_file', { path: 'a.md', content: 'x' }, dir) });

  assert.match(stdout, /"cancel":true/, 'a gate that did not run must not leave the write allowed');
});

test('hook with unparsable output cancels instead of allowing', () => {
  const { dir, bin, record } = setup();
  const { stdout } = runAdapter({ bin, record, mode: 'garbage', payload: writeCall('write_to_file', { path: 'a.md', content: 'x' }, dir) });

  assert.match(stdout, /"cancel":true/, 'an unusable gate answer must not be read as allow');
});

test('context-only reply allows the write and forwards the context', () => {
  const { dir, bin, record } = setup();
  const { stdout } = runAdapter({ bin, record, mode: 'context', payload: writeCall('write_to_file', { path: 'a.md', content: 'x' }, dir) });

  assert.match(stdout, /"context":"engine-face notice"/, 'a context-only reply is a valid allow and its notice must reach Cline');
  assert.doesNotMatch(stdout, /"cancel":true/);
});

test('decision-only reply stays silent when it allows', () => {
  const { dir, bin, record } = setup();
  const { stdout } = runAdapter({ bin, record, mode: 'allowdecision', payload: writeCall('write_to_file', { path: 'a.md', content: 'x' }, dir) });

  assert.equal(stdout.trim(), '', 'an explicit allow with no context emits no control line');
});

test('empty JSON object cancels instead of allowing', () => {
  const { dir, bin, record } = setup();
  const { stdout } = runAdapter({ bin, record, mode: 'emptyobject', payload: writeCall('write_to_file', { path: 'a.md', content: 'x' }, dir) });

  assert.match(stdout, /"cancel":true/, 'a reply with no decision and no context carries nothing usable');
});

test('hook JSON without a decision cancels instead of allowing', () => {
  const { dir, bin, record } = setup();
  const { stdout } = runAdapter({ bin, record, mode: 'wrongshape', payload: writeCall('write_to_file', { path: 'a.md', content: 'x' }, dir) });

  assert.match(stdout, /"cancel":true/, 'a gate answer with no permissionDecision is unusable');
});

test('missing flow-kit executable cancels instead of allowing', () => {
  const dir = makeTmp('flow-kit-cline-');
  const emptyBin = path.join(dir, 'empty-bin');
  fs.mkdirSync(emptyBin);
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(writeCall('write_to_file', { path: 'a.md', content: 'x' }, dir)),
    encoding: 'utf8',
    timeout: 60000,
    env: { ...envWithoutPath(process.env), PATH: emptyBin },
  });

  assert.match(r.stdout || '', /"cancel":true/, 'an unreachable gate must not leave the write allowed');
});

test('hook with no output still allows, per the repo hook contract', () => {
  const { dir, bin, record } = setup();
  const { stdout, calls } = runAdapter({ bin, record, payload: writeCall('write_to_file', { path: 'a.md', content: 'x' }, dir) });

  assert.equal(calls.length, 1);
  assert.equal(stdout.trim(), '', 'a normally-exited gate with no output means allow');
});

test('a flow-kit shim in the project root cannot hijack the gate', () => {
  // 安装布局：适配器在 <proj>/.cline/hooks/（ROOT 即项目根）。Windows 的 cmd.exe 对裸名命令
  // 先搜当前目录：项目根放一个「熄灯」flow-kit.cmd 会让裸名 spawn 命中它 → 门禁静默放行；
  // 适配器必须显式沿 PATH 解析绝对路径，根 shim 只能被无视。
  const dir = makeTmp('flow-kit-cline-');
  const bin = installFakeFlowKit(dir);
  const record = path.join(dir, 'calls.jsonl');
  fs.mkdirSync(path.join(dir, '.cline', 'hooks'), { recursive: true });
  fs.copyFileSync(HOOK, path.join(dir, '.cline', 'hooks', 'PreToolUse.cjs'));
  fs.writeFileSync(path.join(dir, 'flow-kit.cmd'), '@echo off\r\nexit /b 0\r\n');
  const r = spawnSync(process.execPath, [path.join(dir, '.cline', 'hooks', 'PreToolUse.cjs')], {
    input: JSON.stringify(writeCall('run_commands', { command: 'git reset --hard' }, dir)),
    encoding: 'utf8',
    timeout: 60000,
    env: { ...envWithPath(bin), FAKE_MODE: 'deny', FAKE_RECORD: record },
  });
  const calls = fs.existsSync(record)
    ? fs.readFileSync(record, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : [];

  assert.match(r.stdout || '', /"cancel":true/, 'the gate on PATH must run; the project-root shim must be ignored');
  assert.equal(calls.length, 1, 'the real gate must have been invoked exactly once');
});

test('deny from the hook is forwarded as a cancel', () => {
  const { dir, bin, record } = setup();
  const { stdout } = runAdapter({ bin, record, mode: 'deny', payload: writeCall('write_to_file', { path: 'a.md', content: 'x' }, dir) });

  assert.match(stdout, /"cancel":true/);
  assert.match(stdout, /fake deny/);
});

test('parameters-only tool call still reaches the shell gate and cancels', () => {
  const { dir, bin, record } = setup();
  const payload = {
    hookName: 'tool_call',
    tool_call: { name: 'run_commands' },
    preToolUse: { toolName: 'run_commands', parameters: JSON.stringify({ command: 'git reset --hard' }) },
    workspaceRoots: [dir],
  };
  const { stdout, calls } = runAdapter({ bin, record, mode: 'deny', payload });

  assert.equal(calls.length, 1, 'a command carried only in parameters must still be judged by the gate');
  assert.equal(JSON.parse(calls[0].raw).tool_input.command, 'git reset --hard');
  assert.match(stdout, /"cancel":true/);
});

test('unparsable payload cancels instead of allowing', () => {
  const { bin, record } = setup();
  const { stdout, calls } = runAdapter({ bin, record, raw: '{"hookName":"tool_call", broken' });

  assert.equal(calls.length, 0);
  assert.match(stdout, /"cancel":true/, 'a payload the adapter cannot read must not become a silent allow');
});

test('UTF-8 BOM before a valid deny payload still gates and cancels', () => {
  const { dir, bin, record } = setup();
  const raw = '\uFEFF' + JSON.stringify(writeCall('run_commands', { command: 'git reset --hard' }, dir));
  const { stdout, calls } = runAdapter({ bin, record, raw, mode: 'deny' });

  assert.equal(calls.length, 1, 'the BOM must be stripped before parsing so the gate still runs');
  assert.match(stdout, /"cancel":true/);
  assert.match(stdout, /fake deny/);
});

test('run_command (singular) is judged by the shell gate like run_commands', () => {
  const { dir, bin, record } = setup();
  const { stdout, calls } = runAdapter({ bin, record, mode: 'deny', payload: writeCall('run_command', { command: 'git reset --hard' }, dir) });

  assert.equal(calls.length, 1, 'the singular tool name must not slip past the shell gate');
  assert.equal(JSON.parse(calls[0].raw).tool_name, 'bash');
  assert.match(stdout, /"cancel":true/);
});
