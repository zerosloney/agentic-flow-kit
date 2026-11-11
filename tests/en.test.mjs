import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-en-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

test('en install uses English command, memory, host and scaffold overrides', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--lang', 'en', '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);

  const cmd = read(dir, '.agents/commands/new-task.md');
  assert.ok(!cmd.includes('闭环总入口'), 'command doc should not fall back to the Chinese title');
  assert.match(cmd, /New Task|new task|Closed-loop|closed-loop/i);

  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json'));
  assert.equal(manifest.language, 'en');

  const agents = read(dir, 'AGENTS.md');
  assert.match(agents, /Repository Guidelines/);
  assert.match(agents, /Local Setup/);

  const host = read(dir, '.trae/commands/wf-new-task.md');
  assert.match(host, /Authoritative command|pointer shell/i);

  const wiki = read(dir, 'wiki/INDEX.md');
  assert.match(wiki, /Wiki index|Wiki Index|Knowledge/i);
  assert.ok(wiki.includes('## 文件 → 主题 → 归属目录 映射表'), 'machine anchor must remain');
  assert.ok(wiki.includes('合计：**0 份**知识文档'), 'generator anchor must remain');
});
