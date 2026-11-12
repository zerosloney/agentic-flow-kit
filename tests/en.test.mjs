import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stackItems } from '../src/tui/flows.mjs';
import { makeT } from '../src/i18n.mjs';

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

test('en stack menu names the matched file in English', () => {
  const rust = stackItems({
    detected: { stack: 'rust', file: 'Cargo.toml' },
    lang: 'en',
    t: makeT('en'),
  }).find((it) => it.value === 'rust');
  assert.equal(rust.label, 'Rust');
  assert.equal(rust.hint, 'detected Cargo.toml · A Rust project (Cargo).');
  const unspecified = stackItems({
    detected: { stack: 'empty', file: null },
    lang: 'en',
    t: makeT('en'),
  }).find((it) => it.value === 'empty');
  assert.equal(unspecified.label, 'Unspecified');
  assert.equal(unspecified.hint, 'detected · Fill in the project stack description.');
  const current = stackItems({
    detected: { stack: 'rust', file: 'Cargo.toml' },
    current: 'node',
    lang: 'en',
    t: makeT('en'),
  });
  assert.equal(current.find((it) => it.value === 'node').hint, 'current · package.json · A Node.js project.');
  assert.equal(current.find((it) => it.value === 'rust').hint, 'detected Cargo.toml · A Rust project (Cargo).');
});

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

test('en claude install writes English skill pointer and English descriptions', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--agent', 'trae', '--stack', 'node', '--lang', 'en', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);

  const skill = read(dir, '.claude/skills/verify-ui/SKILL.md');
  assert.match(skill, /Authoritative skill/i);
  assert.match(skill, /pointer shell/i);
  assert.match(skill, /UI change verification/i);
  assert.ok(!skill.includes('权威技能'), 'English pointer must not fall back to Chinese');

  const index = read(dir, '.trae/commands/wf-skills.md');
  assert.match(index, /Skills index/i);
  assert.match(index, /authoritative/i);
});

test('en rust stack renders the English stack description', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--lang', 'en', '--stack', 'rust', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(dir, 'AGENTS.md'), /A Rust project \(Cargo\)/);
  assert.equal(JSON.parse(read(dir, '.agents/install-manifest.json')).stack, 'rust');
});

test('en codebuddy native skill pointer overrides the static fallback', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'codebuddy', '--stack', 'node', '--lang', 'en', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);

  const skill = read(dir, '.codebuddy/skills/tfs-pr/SKILL.md');
  assert.match(skill, /Internal self-hosted TFS/);
  assert.match(skill, /Authoritative skill/i);
  assert.ok(!skill.includes('内网自托管'), 'generated pointer must use the English override description');
});
