import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stackItems } from '../src/tui/flows.mjs';
import { makeT } from '../src/i18n.mjs';
import { BASELINE_DIR } from '../src/install/baseline.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-en-');
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
  assert.ok(wiki.includes('合计：**1 份**知识文档'), 'generator anchor must remain');
});

test('en install lock conflict reports in English', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents', 'install.lock'), JSON.stringify({ pid: 432100, ts: Date.now(), command: 'install' }), 'utf8');

  const r = run(['install', '--agent', 'trae', '--lang', 'en', '--stack', 'node', '--target', '.'], dir);
  assert.notEqual(r.status, 0, 'install must fail while a fresh lock is held');
  assert.match(r.stderr, /Install lock conflict/);
  assert.match(r.stderr, /pid 432100/);
  assert.doesNotMatch(r.stderr, /安装锁冲突/, 'lock conflict must not leak the Chinese fallback under --lang en');
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

  // 阶段装载表绑定的技能必须有整文件 en 覆盖，不回退中文（BACKLOG #15 / #20）。
  for (const name of ['grilling', 'codebase-design', 'domain-modeling', 'wayfinder']) {
    const body = read(dir, `.agents/skills/${name}/SKILL.md`);
    assert.ok(body.includes('Idea source:'), `${name} must use the English override`);
    assert.ok(!body.includes('思想来源'), `${name} must not fall back to the zh body`);
    assert.match(read(dir, `.claude/skills/${name}/SKILL.md`), /Authoritative skill/i);
  }
  const glossary = read(dir, 'workflow/glossary.md');
  assert.ok(glossary.includes('Maintenance discipline') && !glossary.includes('维护纪律'), 'glossary needs an English override');
  assert.match(read(dir, 'workflow/adr/_TEMPLATE.md'), /^## Decision$/m);
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

test('en install rejects an invalid --ci value in English', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--stack', 'node', '--lang', 'en', '--ci', 'bogus', '--target', '.'], dir);
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /Invalid --ci/);
});

test('en install rejects an unknown stack in English', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'trae', '--stack', 'bogus', '--lang', 'en', '--target', '.'], dir);
  assert.equal(r.status, 2);
  assert.match(`${r.stdout}${r.stderr}`, /Invalid --stack/);
});

test('en doctor suggests install --baseline-only when the baseline is missing', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--lang', 'en', '--target', '.'], dir).status, 0);
  fs.rmSync(path.join(dir, BASELINE_DIR), { recursive: true, force: true });

  const r = run(['doctor', '--target', '.', '--lang', 'en'], dir);
  assert.match(`${r.stdout}${r.stderr}`, /install --baseline-only/);
});

test('en codex install reports user-level wiring with the re-trust reminder', () => {
  const dir = tmpRepo();
  const home = makeTmp('flow-kit-en-home-');
  // Codex 接线落在用户级 ~/.codex/hooks.json：必须盖假 HOME，不能碰真实用户目录。
  const r = spawnSync(process.execPath, [BIN, 'install', '--agent', 'codex', '--stack', 'node', '--lang', 'en', '--target', '.'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /User-level hooks wired/);
  assert.match(r.stdout, /re-trust once in an interactive/);
  assert.ok(fs.existsSync(path.join(home, '.codex', 'hooks.json')));
});

// ---- MAIN-3：list-hosts 未纳管宿主探测提示走 i18n，--lang en 下不再输出中文 ----

test('en list-hosts prints the unmanaged-host probe line in English', () => {
  const home = makeTmp('flow-kit-en-home-');
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), '{}');

  const r = spawnSync(process.execPath, [BIN, 'list-hosts', '--lang', 'en'], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, FLOW_KIT_TEST: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split('\n').find((l) => l.includes('Gemini CLI'));
  assert.ok(line, 'probe line should be printed for the detected unmanaged host');
  assert.match(line, /\[probe\]/);
  assert.ok(!line.includes('探测'), 'must not fall back to the zh probe line');
});

// ---- P2-6：--target 指向普通文件时给出英文语义化错误 ----

test('en install rejects a plain-file --target in English', () => {
  const dir = tmpRepo();
  const fileTarget = path.join(dir, 'not-a-dir.txt');
  fs.writeFileSync(fileTarget, 'x', 'utf8');

  const r = run(['install', '--agent', 'trae', '--stack', 'node', '--lang', 'en', '--target', fileTarget], dir);
  assert.equal(r.status, 3, `expect TARGET exit code, got ${r.status}: ${r.stderr}`);
  assert.match(`${r.stdout}${r.stderr}`, /not a directory/i);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /ENOTDIR/);
});
