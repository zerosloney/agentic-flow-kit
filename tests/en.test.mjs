import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allowProbeQuestion, projectShapeFlow, stackItems } from '../src/tui/flows.mjs';
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

test('en shape / ports / scaffold questions render in English', async () => {
  const chunks = [];
  const screen = { interactive: false, output: { write: (s) => chunks.push(s) } };
  const answers = ['1', '1', '1'];
  const ctx = { screen, t: makeT('en'), lang: 'en', reader: async () => answers.shift() ?? null };
  assert.deepEqual(await projectShapeFlow(ctx, { stack: 'node' }), {
    product: 'web', ports: {}, scaffold: 'full',
  });
  const out = chunks.join('');
  assert.ok(out.includes('Choose the project shape'), 'shape question label should be English');
  assert.ok(out.includes('Terminal command; no runtime ports'), 'CLI option hint should be English');
  assert.ok(out.includes('Use stack defaults (API 3000, Web 5173)'), 'stack defaults should be English and concrete');
  assert.ok(out.includes('Choose the scaffold tier'), 'scaffold question label should be English');
});

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

test('en doctor reports old-named wiki directories in English', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'trae', '--stack', 'node', '--lang', 'en', '--target', '.'], dir).status, 0);
  fs.mkdirSync(path.join(dir, 'wiki/产品需求'), { recursive: true });

  const r = run(['doctor', '--target', '.', '--lang', 'en'], dir);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /do not match the installed language/);
  assert.doesNotMatch(out, /wiki 目录名与安装语言不一致/, 'en output must not fall back to the zh sentence');
});

// issue #86：英文覆盖模板自身没有锚点（生成器首次运行时才在整份模板后追加生成区），检测不得漏报。
test('en diff and doctor name an overwritten hand-written header outside the anchor', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'claude', '--stack', 'node', '--lang', 'en', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  const rel = 'workflow/INDEX.md';
  const full = read(dir, rel);
  const anchor = full.indexOf('<!-- GENERATED:BEGIN');
  assert.ok(anchor > 0, '安装必须把生成区追加在无锚点的 en 模板之后');
  fs.writeFileSync(path.join(dir, rel), '# My index\n\n> hand-written header, keep me.\n\n' + full.slice(anchor), 'utf8');
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--no-verify', '-m', 'manual header'], { cwd: dir });
  // 模拟旧版安装：锚点外被覆盖回样板（整份 en 模板 + 生成器追加的生成区）。
  fs.writeFileSync(path.join(dir, rel), full, 'utf8');

  const diff = run(['diff', '--target', '.'], dir);
  assert.equal(diff.status, 0, diff.stderr);
  assert.match(diff.stdout, /likely overwritten by an older install/);
  assert.doesNotMatch(diff.stdout, /疑似被旧版安装覆盖/);

  const diffJson = JSON.parse(run(['diff', '--target', '.', '--json'], dir).stdout);
  const item = diffJson.items.find((entry) => entry.targetRel === rel);
  assert.ok(item, `missing diff item for ${rel}`);
  assert.ok(item.overwritten, 'diff --json 必须把该文件标成 overwritten');

  const doctor = run(['doctor', '--target', '.', '--lang', 'en'], dir);
  assert.match(doctor.stdout, /Hand-written area outside the anchor looks overwritten/);
  assert.match(doctor.stdout, /workflow\/INDEX\.md/);
});

// issue #69：ledger baseline advisory 两键的中英双侧断言（en 输出英文、zh 回退不串英文文案）。
test('en doctor reports the missing ledger baseline declaration in English', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'trae', '--stack', 'node', '--lang', 'en', '--target', '.'], dir).status, 0);
  fs.mkdirSync(path.join(dir, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.agents/confirmations.jsonl'), '{"ts":"2026-11-20T00:00:00.000Z"}\n', 'utf8');

  const en = run(['doctor', '--target', '.', '--lang', 'en'], dir);
  assert.match(`${en.stdout}${en.stderr}`, /no history baseline is declared/);
  assert.doesNotMatch(`${en.stdout}${en.stderr}`, /未声明历史基线/, 'en output must not fall back to the zh sentence');
  // Hint（fix）只在 --json 的 fix 字段输出：人读模式仅失败项打 fix 行，warn 项不打。
  const enJson = run(['doctor', '--target', '.', '--lang', 'en', '--json'], dir);
  const item = JSON.parse(enJson.stdout).checks.find((c) => c.name === 'ledger baseline');
  assert.match(item.fix, /ledger-history-baseline\.md/);

  const zh = run(['doctor', '--target', '.', '--lang', 'zh-CN'], dir);
  assert.match(`${zh.stdout}${zh.stderr}`, /未声明历史基线/);
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

test('en list-hosts unmanagedProbe i18n translation is in English', async () => {
  const { makeT } = await import('../src/i18n.mjs');
  const t = makeT('en');
  const line = t('listHosts.unmanagedProbe', { name: 'Gemini CLI', dir: '.gemini' });
  assert.match(line, /\[probe\] Gemini CLI \(~\/\.gemini\) — detected on this machine but not yet supported/);
  assert.doesNotMatch(line, /探测/);
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

// ---- EXT-2：模型探测同意门必须透露将执行的具体命令 ----

test('en allowProbe confirm names the host-declared probe commands', () => {
  const q = allowProbeQuestion({ host: 'commandcode', t: makeT('en') });
  assert.match(q, /cmd --list-models/, 'the first declared command must appear verbatim');
  assert.match(q, /commandcode --list-models/, 'the second declared command must appear verbatim');
  assert.ok(!q.includes('探测'), 'en catalog must not fall back to the zh sentence');
});

test('en install --probe-models prints declared probe commands before probing', () => {
  const dir = tmpRepo();
  const r = run(['install', '--agent', 'commandcode', '--stack', 'node', '--probe-models', '--lang', 'en', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  // 审计行走 emit：--json 时落 stderr，人类模式随进度落 stdout——两侧都搜
  const line = `${r.stderr}\n${r.stdout}`.split('\n').find((l) => l.includes('--list-models'));
  assert.ok(line, 'audit line listing the probe commands should be printed before probing');
  assert.match(line, /commandcode/, 'the audit line should name the host');
  assert.match(line, /cmd --list-models/, 'the audit line should carry the exact command');
});

// ---- PR #77 审查跟进：本 PR 新增 5 个 en 键的输出断言（archPresetUnknown / policy.syncConflict* / gate.diffScopeFailed）----

test('en arch init rejects an unknown preset in English with the USAGE exit code', () => {
  const dir = tmpRepo();
  const r = run(['arch', 'init', '--preset', 'bogus', '--lang', 'en', '--target', '.'], dir);
  assert.equal(r.status, 2, `BAD_ARGS should map to USAGE(2), got ${r.status}: ${r.stderr}`);
  assert.match(`${r.stdout}${r.stderr}`, /Unknown architecture preset: bogus \(expected clean \/ ddd \/ layered\)/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /未知的架构预设/, 'en output must not fall back to the zh sentence');
});

test('en policy sync conflict reports the skipped surfaces in English', () => {
  const central = makeTmp('flow-kit-en-central-conflict-');
  const target = tmpRepo();
  const rel = '.agents/config/gate-budgets.json';
  assert.equal(run(['install', '--agent', 'claude', '--stack', 'node', '--lang', 'en', '--target', '.'], target).status, 0);

  const remotePolicy = {
    $schema: 'policy/config@1',
    version: 2,
    surfaces: { gateBudgets: rel },
  };
  fs.mkdirSync(path.join(central, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(path.join(central, '.agents', 'config', 'policy.json'), JSON.stringify(remotePolicy, null, 2), 'utf8');
  fs.writeFileSync(path.join(central, rel), fs.readFileSync(path.join(target, rel)));

  assert.equal(run(['policy', 'link', central, '--target', '.'], target).status, 0);

  // 用户本地调优 + 中央基线改为不同内容 → sync 检出冲突，保留本地版本
  fs.writeFileSync(path.join(target, rel), JSON.stringify({ fullMs: 4242, userTuned: true }, null, 2), 'utf8');
  fs.writeFileSync(path.join(central, rel), JSON.stringify({ fullMs: 999999 }, null, 2), 'utf8');

  const r = run(['policy', 'sync', '--target', '.', '--lang', 'en'], target);
  assert.equal(r.status, 0, r.stderr);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /Skipped 1 policy surface\(s\) with local changes:/);
  assert.match(out, /! gateBudgets \(\.agents\/config\/gate-budgets\.json\) has local changes; kept the local version/);
  assert.match(out, /Run flow-kit diff to review the differences and resolve them, then retry/);
  assert.doesNotMatch(out, /策略面/, 'en output must not fall back to the zh sentence');
});

test('en gate warns in English when the diff scope cannot be resolved', () => {
  // 非 git 目录：resolveChangedFiles 返回 null，门禁回退全量检查并输出英文告警
  const dir = makeTmp('flow-kit-en-gate-nongit-');
  const r = run(['gate', '--target', dir, '--diff', '--lang', 'en'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Failed to resolve diff scope \(git diff\/status unavailable\); falling back to full checks/);
  assert.doesNotMatch(r.stderr, /差异集解析失败/, 'en output must not fall back to the zh sentence');
});

// ---- 审查遗留批 2026-11-23：gate init-ci 拒绝覆盖已有 .gitlab-ci.yml（gate.ciExists）的英文输出 ----

test('en gate init-ci reports the existing .gitlab-ci.yml conflict in English', () => {
  const dir = tmpRepo();
  assert.equal(run(['gate', 'init-ci', '--provider', 'gitlab', '--lang', 'en', '--target', '.'], dir).status, 0);

  const r = run(['gate', 'init-ci', '--provider', 'gitlab', '--lang', 'en', '--target', '.'], dir);
  assert.equal(r.status, 1, `CONFIG_EXISTS should map to CONFLICT(1), got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /CI gate workflow config already exists: \.gitlab-ci\.yml; use --force to overwrite/);
  assert.doesNotMatch(r.stderr, /已存在/, 'en output must not fall back to the zh sentence');
});

// ---- doctor：PATH 上的 flow-kit 与安装清单版本不一致时，--lang en 输出英文 ----

test('en doctor reports the flow-kit version mismatch in English', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'trae', '--stack', 'node', '--lang', 'en', '--target', '.'], dir).status, 0);

  // 假 flow-kit 两种平台都要有：Windows 走 cmd 解析 .cmd；POSIX 走无扩展名 sh 脚本。
  const binDir = makeTmp('flow-kit-en-fake-bin-');
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'flow-kit.cmd'), '@echo off\r\necho 2.0.0\r\n', 'utf8');
  } else {
    const fake = path.join(binDir, 'flow-kit');
    fs.writeFileSync(fake, '#!/bin/sh\necho 2.0.0\n', 'utf8');
    fs.chmodSync(fake, 0o755);
  }
  const r = spawnSync(process.execPath, [BIN, 'doctor', '--target', '.', '--lang', 'en'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1', PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(`${r.stdout}${r.stderr}`, /install manifest/);
  assert.match(`${r.stdout}${r.stderr}`, /2\.0\.0/);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /版本不一致/, 'en output must not fall back to the zh sentence');
});

// ---- rules / doctor：rules v1 的校验发现项、init 用法错误、畸形 whenEnv 点名与规则汇总在 --lang en 下输出英文 ----

test('en rules validate, init and malformed whenEnv messages are English', () => {
  const dir = tmpRepo();
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const rules = (args) => run(['rules', ...args, '--lang', 'en'], dir);
  const rule = (id, extra = {}) => ({
    id, face: 'code', phase: 'pre-commit', severity: 'block',
    assert: { kind: 'content', args: { targets: ['src/**'], contains: ['X'] } },
    message: { zh: 'x', en: 'x' }, ...extra,
  });

  // validate：发现项沿用配置错误消息的既有约定（代码侧中文），汇总行必须是英文。
  write('.agents/rules/project.json', JSON.stringify({
    version: 1, rules: [rule('proj.never', { when: ['pkg:'] })], waivers: [{ rule: 'ghost', expires: '2099-01-01', reason: 'x' }],
  }));
  const validated = rules(['validate']);
  assert.equal(validated.status, 2, validated.stderr);
  assert.match(validated.stdout, /Rules validation failed: 2 issue\(s\)/);
  assert.doesNotMatch(`${validated.stdout}${validated.stderr}`, /规则校验未通过/, 'en output must not fall back to the zh sentence');

  // init：目标已存在 = 用法错误（exit 2），提示为英文。
  const again = rules(['init']);
  assert.equal(again.status, 2, again.stderr);
  assert.match(again.stderr, /already exists \(use --force to overwrite\)/);
  assert.doesNotMatch(again.stderr, /已存在/, 'en output must not fall back to the zh sentence');

  // 畸形 whenEnv：规则永不启用（不执行命令），但 check 汇总必须点名，且为英文。
  write('.agents/rules/project.json', JSON.stringify({ version: 1, rules: [] }));
  write('src/a.js', 'console.log(1);\n');
  write('.agents/hooks/commit-check.config.json', JSON.stringify({ pushTests: [{ name: 'unit', command: 'node -v', ext: ['.js'], whenEnv: 'RUN_PUSH' }] }));
  const git = spawnSync('git', ['add', 'src/a.js'], { cwd: dir, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const checked = rules(['check', '--staged']);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /Malformed whenEnv \(expected KEY=VALUE\)[\s\S]*commit\.push\.0/);
  assert.doesNotMatch(`${checked.stdout}${checked.stderr}`, /写法有误/, 'en output must not fall back to the zh sentence');
});

test('en doctor prints the rules summary and gate coverage rows in English', () => {
  const dir = tmpRepo();
  assert.equal(run(['install', '--agent', 'trae', '--stack', 'dotnet', '--lang', 'en', '--target', '.'], dir).status, 0);
  const r = run(['doctor', '--target', '.', '--lang', 'en'], dir);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /rules: \d+ active of \d+ \(block \d+ \/ warn \d+\)/);
  assert.match(out, /gate families: configured [\s\S]*not configured \(SKIP\)/);
  assert.doesNotMatch(out, /规则包：|门禁族：/, 'en output must not fall back to the zh sentence');
});

test('en rules export messages are English', () => {
  const dir = tmpRepo();
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const rules = (args) => run(['rules', ...args, '--lang', 'en'], dir);

  // 写入碎片配置以供 export 合拢
  write('.agents/config/project-faces.json', JSON.stringify({ ui: ['src/ui'] }));
  write('package.json', JSON.stringify({ name: 'my-app' }));

  // export 成功输出：必须是英文
  const exported = rules(['export']);
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /Successfully exported and consolidated into flow-rules\.yml/);
  assert.doesNotMatch(exported.stdout, /已成功导出并合拢/, 'en output must not fall back to the zh sentence');

  // export 目标已存在（未给 --force）：报错必须是英文
  const again = rules(['export']);
  assert.equal(again.status, 2, again.stderr);
  assert.match(again.stderr, /flow-rules\.yml already exists \(use --force to overwrite\)/);
  assert.doesNotMatch(again.stderr, /已存在/, 'en output must not fall back to the zh sentence');
});
