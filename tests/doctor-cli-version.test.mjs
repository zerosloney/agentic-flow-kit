import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { doctorCommand, flowKitVersionDrift } from '../src/commands/doctor.mjs';
import { parseArgs } from '../src/cli/args.mjs';
import { makeT } from '../src/i18n.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8')).version;

function tmpRepo() {
  const dir = makeTmp('flow-kit-doctor-cli-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function runIn(args, dir, extraEnv = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1', ...extraEnv },
  });
}

function install(dir) {
  return runIn(['install', '--agent', 'trae', '--stack', 'node', '--target', '.'], dir);
}

// 假 flow-kit 命令两种平台都要有（CI 跑 ubuntu 和 windows）：
// Windows 下 doctor 用 shell:true 探测，cmd.exe 按 PATHEXT 解析 .cmd；POSIX 下是无扩展名 sh 脚本。
function writeFakeFlowKit(binDir, output) {
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'flow-kit.cmd'), `@echo off\r\necho ${output}\r\n`, 'utf8');
  } else {
    const file = path.join(binDir, 'flow-kit');
    fs.writeFileSync(file, `#!/bin/sh\necho ${output}\n`, 'utf8');
    fs.chmodSync(file, 0o755);
  }
}

function doctorJson(dir, binDir) {
  const env = { PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
  const r = runIn(['doctor', '--target', '.', '--json'], dir, env);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function flowKitCliCheck(json) {
  return json.checks.find((c) => c.name === 'flow-kit cli');
}

test('flowKitVersionDrift parses cli output and compares against the manifest version', () => {
  assert.deepEqual(flowKitVersionDrift('2.12.1', '9.9.9'), { cli: '2.12.1', manifest: '9.9.9' });
  assert.deepEqual(flowKitVersionDrift('v2.12.1', '9.9.9'), { cli: '2.12.1', manifest: '9.9.9' });
  assert.deepEqual(flowKitVersionDrift('flow-kit 2.12.1', '9.9.9'), { cli: '2.12.1', manifest: '9.9.9' });
  assert.equal(flowKitVersionDrift('abc', '2.12.3'), null);
  assert.equal(flowKitVersionDrift('2.12.3', ''), null, 'an unparseable manifest version must skip the comparison');
  assert.equal(flowKitVersionDrift('2.12.3', '2.12.3'), null, 'equal versions must not drift');
  assert.deepEqual(flowKitVersionDrift('2.12.1', '2.12.3'), { cli: '2.12.1', manifest: '2.12.3' });
});

test('doctor warns but stays green when the flow-kit on PATH differs from the manifest version', () => {
  const dir = tmpRepo();
  assert.equal(install(dir).status, 0, 'install must succeed');

  const binDir = makeTmp('flow-kit-doctor-cli-bin-');
  writeFakeFlowKit(binDir, '2.0.0');
  const human = runIn(['doctor', '--target', '.'], dir, { PATH: `${binDir}${path.delimiter}${process.env.PATH}` });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /! flow-kit cli/);

  const json = doctorJson(dir, binDir);
  const item = flowKitCliCheck(json);
  assert.equal(item.ok, true, 'a version mismatch must not fail the check');
  assert.equal(item.warn, true);
  assert.ok(item.detail.includes('2.0.0'), `detail must carry the PATH version: ${item.detail}`);
  assert.ok(item.detail.includes(PKG_VERSION), `detail must carry the manifest version: ${item.detail}`);
  assert.equal(json.ok, true, 'a warn-only check must not turn doctor red');
});

test('doctor keeps the plain check when the flow-kit on PATH matches the manifest version', () => {
  const dir = tmpRepo();
  assert.equal(install(dir).status, 0);

  const binDir = makeTmp('flow-kit-doctor-cli-bin-');
  writeFakeFlowKit(binDir, PKG_VERSION);
  const item = flowKitCliCheck(doctorJson(dir, binDir));
  assert.equal(item.ok, true);
  assert.equal(item.warn, false);
  assert.equal(item.detail, PKG_VERSION);
});

test('doctor skips the version comparison when the flow-kit on PATH prints no version', () => {
  const dir = tmpRepo();
  assert.equal(install(dir).status, 0);

  const binDir = makeTmp('flow-kit-doctor-cli-bin-');
  writeFakeFlowKit(binDir, 'unknown');
  const item = flowKitCliCheck(doctorJson(dir, binDir));
  assert.equal(item.ok, true);
  assert.equal(item.warn, false);
});

test('doctorCommand isolates mcpPolicyCache per invocation across different targets', () => {
  const badDir = tmpRepo();
  const cleanDir = tmpRepo();
  assert.equal(runIn(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], badDir).status, 0);
  assert.equal(runIn(['install', '--agent', 'claude', '--stack', 'node', '--target', '.'], cleanDir).status, 0);

  // Declare an over-broad toolPolicy only in badDir (valid JSON so buildDiff passes, fails runtime tool reconciliation)
  fs.mkdirSync(path.join(badDir, '.flow-kit', 'mcp'), { recursive: true });
  fs.writeFileSync(
    path.join(badDir, '.flow-kit', 'mcp', 'servers.json'),
    JSON.stringify({
      servers: {
        'flow-kit-wiki': { command: 'flow-kit', args: ['run', 'wiki-mcp'] },
      },
      toolPolicy: {
        mode: 'allow',
        servers: { 'flow-kit-wiki': ['wiki_search', 'nonexistent_tool'] },
      },
    }),
    'utf8',
  );

  const t = makeT('en');
  const origLog = console.log;
  const runDoctorInProcess = (target) => {
    let captured = '';
    console.log = (line) => { captured += `${line}\n`; };
    try {
      const code = doctorCommand({ args: parseArgs(['doctor', '--target', target, '--json']), t });
      return { code, json: JSON.parse(captured) };
    } finally {
      console.log = origLog;
    }
  };

  const first = runDoctorInProcess(badDir);
  assert.equal(first.code, 1);
  assert.ok(first.json.checks.some((c) => c.name === 'mcp policy claude' && c.ok === false));

  const second = runDoctorInProcess(cleanDir);
  assert.equal(second.code, 0, `cleanDir must not inherit badDir mcpPolicyCache: ${JSON.stringify(second.json.checks.filter((c) => !c.ok))}`);
});
