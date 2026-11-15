// codeartsdoer-host.test.mjs — issue #48：CodeArtsDoer 内置宿主的项目级 .github/hooks 接线与适配层行为。
// PATH 垫片手法同 codex-host.test.mjs：适配层委托 spawnSync('flow-kit', ...)，垫片把 flow-kit 指回本仓
// bin/flow-kit.mjs，保证测的是本仓代码而非全局安装；payload 路径一律 path.join 生成，交给 JSON.stringify 转义。
// CodeArtsDoer 无用户级接线面（hooks 在项目仓 .github/hooks/），无需假 HOME。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { HOSTS } from '../src/hosts/registry.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

// PATH 垫片：Windows 写 flow-kit.cmd（cmd 按 PATHEXT 解析），POSIX 写可执行 sh 脚本。
function makeShim() {
  const dir = makeTmp('fk-cd-shim-');
  const binFwd = BIN.split(path.sep).join('/');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'flow-kit.cmd'), `@echo off\r\nnode "${binFwd}" %*\r\n`, 'utf8');
  } else {
    fs.writeFileSync(path.join(dir, 'flow-kit'), `#!/bin/sh\nexec node "${binFwd}" "$@"\n`, 'utf8');
    fs.chmodSync(path.join(dir, 'flow-kit'), 0o755);
  }
  return dir;
}

const shim = makeShim();

// 展开 env 时先删掉 Windows 的 Path 原键再统一写 PATH，避免双键并存的未定义行为。
function childEnv() {
  const env = { ...process.env };
  delete env.Path;
  env.PATH = `${shim}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
  env.FLOW_KIT_TEST = '1';
  return env;
}

function tmpRepo() {
  const dir = makeTmp('fk-cd-repo-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function runWith(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: childEnv() });
}

// 经垫片以 CodeArtsDoer hook 形态调起适配层（flow-kit hook codeartsdoer-gate），喂 stdin payload。
function runGate(payload, cwd) {
  const r = spawnSync('flow-kit', ['hook', 'codeartsdoer-gate'], {
    cwd,
    encoding: 'buffer',
    shell: process.platform === 'win32',
    input: Buffer.from(JSON.stringify(payload), 'utf8'),
    env: childEnv(),
  });
  return {
    status: r.status,
    out: Buffer.from(r.stdout || []).toString('utf8'),
    err: Buffer.from(r.stderr || []).toString('utf8'),
  };
}

const SPEC = () => HOSTS.codeartsdoer.hooks;
const hooksFile = (repo) => path.join(repo, SPEC().file); // .github/hooks/flow-kit-gates.json（仓根锚定）
const installCodeartsdoer = (repo) => runWith(['install', '--agent', 'codeartsdoer', '--stack', 'node', '--target', '.'], repo);

test('install --agent codeartsdoer wires .github/hooks at the repo root', () => {
  const repo = tmpRepo();
  const r = installCodeartsdoer(repo);
  assert.equal(r.status, 0, r.stderr);

  // 根锚定：hooks 文件在仓根 .github/hooks/ 下，绝不落到宿主点目录里
  assert.equal(fs.existsSync(hooksFile(repo)), true, `${SPEC().file} at repo root`);
  assert.equal(fs.existsSync(path.join(repo, '.codeartsdoer/.github')), false, 'no hooks under host dir');
  // 与 git 模板 .github/workflows/ 同存互不干扰（standard 档双发 CI）
  assert.equal(fs.existsSync(path.join(repo, '.github/workflows/ci.yml')), true, 'workflows co-exist');

  const config = JSON.parse(fs.readFileSync(hooksFile(repo), 'utf8'));
  const events = SPEC().events;
  assert.deepEqual(Object.keys(config), ['hooks']);
  const entries = config.hooks.PreToolUse;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, events.matchers.shell);
  assert.equal(entries[0].hooks[0].type, 'command');
  assert.equal(entries[0].hooks[0].command, 'flow-kit hook codeartsdoer-gate');
  assert.equal(entries[0].hooks[0].timeout, events.timeouts.shell);

  // 技能指针壳：宿主标准文件名 SKILL.md，正文指向 .agents/skills/ 权威
  const skillsDir = path.join(repo, '.codeartsdoer/skills');
  const skillNames = fs.readdirSync(skillsDir);
  assert.ok(skillNames.length >= 1, 'at least one skill pointer shell');
  for (const name of skillNames) {
    const text = fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');
    assert.match(text, /\.agents\/skills\//);
  }

  // 规则入口是指针：指到根 AGENTS.md，不复制权威正文
  const rule = fs.readFileSync(path.join(repo, '.codeartsdoer/rule/flow-kit.md'), 'utf8');
  assert.ok(rule.includes('AGENTS.md'), 'rule pointer references root AGENTS.md');

  const manifest = JSON.parse(fs.readFileSync(path.join(repo, '.agents/install-manifest.json'), 'utf8'));
  assert.ok(manifest.hosts.includes('codeartsdoer'));

  const diff = runWith(['diff', '--all', '--strict', '--target', '.'], repo);
  assert.equal(diff.status, 0, diff.stdout + diff.stderr);
});

test('codeartsdoer-gate adapter: deny, allow, array form and no-op states', () => {
  const repo = tmpRepo();
  assert.equal(installCodeartsdoer(repo).status, 0);
  const deny = (payload) => {
    const r = runGate({ cwd: repo, ...payload }, repo);
    assert.equal(r.status, 0, r.out + r.err);
    return r;
  };
  // gates.json deny 清单经归一后的 Bash payload 命中（execute → tool_name 'Bash' + command 字符串）
  assert.match(deny({ tool_name: 'execute', tool_input: { command: 'dotnet ef database update' } }).out,
    /permissionDecision"\s*:\s*"deny/);
  // command 数组形态按 join ' ' 后判定
  assert.match(deny({ tool_name: 'execute', tool_input: { command: ['dotnet', 'ef', 'database', 'update'] } }).out,
    /permissionDecision"\s*:\s*"deny/);
  // kernel 字段别名兼容：cmdline 形态同样进命令门
  assert.match(deny({ tool_name: 'execute', tool_input: { cmdline: 'git push --force origin main' } }).out,
    /permissionDecision"\s*:\s*"deny/);
  // allow：无输出放行
  assert.equal(deny({ tool_name: 'execute', tool_input: { command: 'git status' } }).out, '');
  // edit：带可识别路径字段 → 交给写前门（执法面自保护对 .agents/hooks/gates.json 是确定性 deny；
  // 对未知字段写前门 fail-open——此处选确定性路径断言 deny 形态）
  assert.match(deny({ tool_name: 'edit', tool_input: { path: '.agents/hooks/gates.json', content: '{}' } }).out,
    /permissionDecision"\s*:\s*"deny/);
  // edit：抽不出路径字段 → 放行 + stderr 提示一句
  const noPath = runGate({ tool_name: 'edit', tool_input: { content: 'orphan' }, cwd: repo }, repo);
  assert.equal(noPath.status, 0);
  assert.equal(noPath.out, '');
  assert.match(noPath.err, /路径/);
  // 其余工具（search/agent/read/web/todo）与 MCP 不设门
  for (const tool of ['search', 'agent', 'read', 'web', 'todo', 'mcp__x__y']) {
    const r = deny({ tool_name: tool, tool_input: {} });
    assert.equal(r.out, '', `no-op for ${tool}`);
  }
  // 非 flow-kit 仓（向上找不到 manifest）→ no-op
  const nowhere = makeTmp('fk-cd-nowhere-');
  const r = runGate({ tool_name: 'execute', tool_input: { command: 'dotnet ef database update' }, cwd: nowhere }, nowhere);
  assert.equal(r.status, 0);
  assert.equal(r.out, '');
});

test('upgrade is idempotent: .github/hooks file bytes stay put', () => {
  const repo = tmpRepo();
  assert.equal(installCodeartsdoer(repo).status, 0);
  const before = fs.readFileSync(hooksFile(repo), 'utf8');
  const r = runWith(['upgrade', '--target', '.'], repo);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(hooksFile(repo), 'utf8'), before);
});

test('remove-host codeartsdoer removes the root-anchored hooks file and host shells', () => {
  const repo = tmpRepo();
  assert.equal(installCodeartsdoer(repo).status, 0);
  const rem = runWith(['remove-host', 'codeartsdoer', '--target', '.'], repo);
  assert.equal(rem.status, 0, rem.stderr);
  // 本工具创建且未被改动的 merge-host 文件整体删除；宿主指针壳按 category host 删除
  assert.equal(fs.existsSync(hooksFile(repo)), false, 'hooks file deleted');
  assert.equal(fs.existsSync(path.join(repo, '.codeartsdoer')), false, 'host dir cleaned');
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, '.agents/install-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.hosts, []);
  // 引擎与 git 门禁不受牵连
  assert.equal(fs.existsSync(path.join(repo, '.agents/install-manifest.json')), true);
  assert.equal(fs.existsSync(path.join(repo, '.githooks')), true);

  // 重装后 uninstall：同样清掉 .github/hooks 接线与 .codeartsdoer/ 托管产物
  assert.equal(installCodeartsdoer(repo).status, 0);
  const un = runWith(['uninstall', '--target', '.'], repo);
  assert.equal(un.status, 0, un.stderr);
  assert.equal(fs.existsSync(hooksFile(repo)), false, 'hooks file deleted on uninstall');
  assert.equal(fs.existsSync(path.join(repo, '.codeartsdoer')), false, 'host dir cleaned on uninstall');
});

test('list-hosts includes codeartsdoer as a builtin host', () => {
  const repo = tmpRepo();
  const r = runWith(['list-hosts'], repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /codeartsdoer\tCodeArtsDoer/);
  assert.doesNotMatch(r.stdout, /\[探测\]/);
});
