import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseModelFlags } from '../src/models/resolve.mjs';
import { probeModels, parseCliModels, stripJsonComments } from '../src/models/probe.mjs';
import {
  LOCAL_REL,
  readInjectedModels,
  readLocalModelRoles,
  recommendRoles,
  resolveModels,
  summarizeModels,
  writeLocalModelRoles,
} from '../src/models/resolve.mjs';

function tmpDir() {
  return makeTmp('flow-kit-models-');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

test('parseModelFlags accepts global and host-scoped forms', () => {
  const parsed = parseModelFlags(['code=sonnet', 'claude:review=opus', 'judgment=glm-5']);
  assert.deepEqual(parsed.global, { code: 'sonnet', judgment: 'glm-5' });
  assert.deepEqual(parsed.hosts, { claude: { review: 'opus' } });
  assert.throws(() => parseModelFlags(['nope']), /invalid --model/);
  assert.throws(() => parseModelFlags(['wat:code=x']), /unknown host/);
  assert.throws(() => parseModelFlags(['bogus=x']), /invalid --model/);
});

test('parseModelFlags unknown host error lists valid candidates', () => {
  assert.throws(
    () => parseModelFlags(['wat:code=x']),
    (err) => err.code === 'BAD_MODEL' && /unknown host in --model: wat \(valid: .*claude/.test(err.message),
  );
});

test('probeModels reads host config and env without executing anything', () => {
  const home = tmpDir();
  writeJson(path.join(home, '.claude', 'settings.json'), {
    model: 'sonnet',
    models: ['opus', 'haiku'],
  });
  let calls = 0;
  const exec = () => {
    calls += 1;
    return { status: 0, stdout: '', error: null };
  };
  const found = probeModels({
    host: 'claude',
    home,
    env: { ANTHROPIC_MODEL: 'claude-env-model' },
    exec,
  });
  const ids = found.map((m) => m.id);
  assert.ok(ids.includes('sonnet'));
  assert.ok(ids.includes('opus'));
  assert.ok(ids.includes('haiku'));
  assert.ok(ids.includes('claude-env-model'));
  assert.equal(calls, 0, 'CLI probe must be opt-in');
});

test('probeModels CLI is opt-in and parses model lists', () => {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, ...args]);
    return { status: 0, stdout: 'provider/model-a\nprovider/model-b\nextra info\n', error: null };
  };
  const found = probeModels({ host: 'commandcode', allowCli: true, exec });
  assert.ok(calls.length > 0);
  const ids = found.map((m) => m.id);
  assert.ok(ids.includes('provider/model-a'));
  assert.ok(ids.includes('provider/model-b'));
});

test('parseCliModels drops headers and ANSI, stripJsonComments tolerates JSONC', () => {
  assert.deepEqual(parseCliModels('\x1b[31mAvailable models:\x1b[0m\n  provider/a\n  provider/b\n'), ['provider/a', 'provider/b']);
  const jsonc = '{\n  // comment\n  "model": "x", /* block */\n  "models": ["y",],\n}';
  assert.deepEqual(JSON.parse(stripJsonComments(jsonc)), { model: 'x', models: ['y'] });
});

test('recommendRoles picks role-appropriate Claude aliases', () => {
  const roles = recommendRoles({ host: 'claude', candidates: [] });
  assert.equal(roles.code, 'sonnet');
  assert.equal(roles.judgment, 'opus');
  assert.equal(roles.review, 'opus');
});

test('recommendRoles keeps review different from code when possible', () => {
  const roles = recommendRoles({
    host: 'claude',
    candidates: [{ id: 'provider/code-x', source: 'config' }, { id: 'provider/review-y', source: 'config' }],
  });
  assert.notEqual(roles.review, roles.code);
});

test('recommendRoles records detected vs configured per role', () => {
  // claude 有内置别名兜底：池值按探测值标注。
  const known = recommendRoles({ host: 'claude', candidates: [] });
  assert.equal(known.sources.code, 'detected');
  assert.equal(known.sources.judgment, 'detected');

  // claude 无已知别名且探测为空：走 roleConfig 兜底，标注 configured。
  const fallback = recommendRoles({
    host: 'trae',
    candidates: [],
    roleConfig: { roles: { code: { model: 'cfg-code' }, judgment: { model: 'cfg-judgment' } } },
  });
  assert.equal(fallback.code, 'cfg-code');
  assert.equal(fallback.sources.code, 'configured');
  assert.equal(fallback.sources.judgment, 'configured');
  assert.equal(fallback.review, null);
  assert.equal('review' in fallback.sources, false, '无值角色不记录来源');

  // 真探测值仍标 detected。
  const probed = recommendRoles({ host: 'trae', candidates: [{ id: 'provider/x', source: 'config' }] });
  assert.equal(probed.code, 'provider/x');
  assert.equal(probed.sources.code, 'detected');
});

test('resolveModels precedence: CLI > TUI > local > detection > inherit', () => {
  const target = tmpDir();
  writeJson(path.join(target, LOCAL_REL), {
    roles: { code: { model: 'local-code' }, review: { model: 'local-review' } },
    hosts: { claude: { judgment: 'local-judgment' } },
  });

  const local = resolveModels({ hosts: ['claude'], target, probe: false });
  assert.deepEqual(local.hosts.claude, {
    code: 'local-code',
    judgment: 'local-judgment',
    review: 'local-review',
  });

  const cli = resolveModels({
    hosts: ['claude'],
    target,
    probe: false,
    cli: { global: { code: 'cli-code' }, hosts: { claude: { review: 'cli-review' } } },
  });
  assert.equal(cli.hosts.claude.code, 'cli-code');
  assert.equal(cli.hosts.claude.review, 'cli-review');
  assert.equal(cli.hosts.claude.judgment, 'local-judgment');

  const tui = resolveModels({
    hosts: ['claude'],
    target,
    probe: false,
    tui: { claude: { code: 'tui-code' } },
  });
  assert.equal(tui.hosts.claude.code, 'tui-code');

  const none = resolveModels({
    hosts: ['claude'],
    target,
    probe: false,
    tui: { claude: { code: '__none__' } },
  });
  assert.equal(none.hosts.claude.code, null);
});

test('resolveModels detects static config and falls back to inherit', () => {
  const target = tmpDir();
  const home = tmpDir();
  writeJson(path.join(home, '.claude', 'settings.json'), { model: 'claude-sonnet-5-5' });
  const detected = resolveModels({ hosts: ['claude'], target, home, env: {} });
  assert.equal(detected.hosts.claude.code, 'claude-sonnet-5-5');
  assert.equal(detected.hosts.claude.judgment, 'opus');
  assert.equal(detected.hosts.claude.review, 'opus');

  const inherit = resolveModels({ hosts: ['claude'], target, probe: false, mode: 'inherit' });
  assert.equal(inherit.hosts.claude.code, 'inherit');
  assert.equal(inherit.hosts.claude.review, 'inherit');
});

test('resolveModels labels role-config fallback as configured, not detected', () => {
  const target = tmpDir();
  const home = tmpDir();
  // trae 无内置别名、空 home 下探测为空：推荐值来自 roleConfig 兜底而非探测。
  const result = resolveModels({
    hosts: ['trae'],
    target,
    home,
    env: {},
    roleConfig: {
      roles: {
        code: { model: 'cfg-code' },
        judgment: { model: 'cfg-judgment' },
        review: { model: 'cfg-review' },
      },
    },
  });
  assert.equal(result.hosts.trae.code, 'cfg-code');
  assert.equal(result.hosts.trae.judgment, 'cfg-judgment');
  assert.equal(result.hosts.trae.review, 'cfg-review');
  assert.equal(result.source, 'configured');
});

test('resolveModels role summary does not depend on host order', () => {
  const target = tmpDir();
  const home = tmpDir();
  writeJson(path.join(home, '.claude', 'settings.json'), { model: 'claude-sonnet-5-5' });
  // 第一个宿主没有模型能力，第二个才有：全局角色摘要仍要取到实际值。
  const result = resolveModels({ hosts: ['trae', 'claude'], target, home, env: {} });
  assert.equal(result.roles.code.model, 'claude-sonnet-5-5');
  assert.equal(result.roles.judgment.model, 'opus');
  assert.equal(result.roles.review.model, 'opus');
  assert.equal(result.hosts.claude.code, 'claude-sonnet-5-5');
});

test('resolveModels honors explicit local review even when equal to code', () => {
  const target = tmpDir();
  writeJson(path.join(target, LOCAL_REL), {
    roles: { code: { model: 'same-model' }, review: { model: 'same-model' } },
  });
  const result = resolveModels({ hosts: ['claude'], target, probe: false });
  assert.equal(result.hosts.claude.code, 'same-model');
  assert.equal(result.hosts.claude.review, 'same-model');
  assert.ok(result.warnings.some((w) => w.code === 'REVIEW_SAME_AS_CODE'));
});

test('readInjectedModels recovers role models from installed agents', () => {
  const target = tmpDir();
  const dir = path.join(target, '.claude', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'implementer.md'), '---\nmodel: haiku\n---\n');
  fs.writeFileSync(path.join(dir, 'independent-reviewer.md'), '---\nmodel: opus\n---\n');
  fs.writeFileSync(path.join(dir, 'ui-verifier.md'), '---\nmodel: opus\n---\n');
  const found = readInjectedModels({ target, hosts: ['claude', 'trae'] });
  assert.deepEqual(found.claude, { code: 'haiku', review: 'opus', judgment: 'opus' });
  assert.equal(found.trae, undefined, 'hosts without a model field are ignored');
});

test('readInjectedModels keeps inherit values (diff 误报根因回归：跳过 inherit 值会让 diff 判模板更新)', () => {
  const target = tmpDir();
  const dir = path.join(target, '.claude', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'implementer.md'), '---\nmodel: inherit\n---\n');
  fs.writeFileSync(path.join(dir, 'independent-reviewer.md'), '---\nmodel: inherit\n---\n');
  // inherit 也是磁盘注入态：回读必须保留，否则 diff/upgrade/remove-host 重建渲染会与磁盘不一致
  assert.deepEqual(readInjectedModels({ target, hosts: ['claude'] }).claude, { code: 'inherit', review: 'inherit' });
});

test('resolveModels warns when review cannot differ from code', () => {
  const target = tmpDir();
  const result = resolveModels({
    hosts: ['trae'],
    target,
    probe: false,
    tui: { trae: { code: 'only-model', review: 'only-model' } },
  });
  assert.equal(result.hosts.trae.code, 'only-model');
  assert.equal(result.hosts.trae.review, 'only-model');
  assert.ok(result.warnings.some((w) => w.code === 'REVIEW_SAME_AS_CODE'));
});

test('writeLocalModelRoles writes once, then merges only when explicit', () => {
  const target = tmpDir();
  const first = { roles: { code: { model: 'a' }, judgment: { model: 'b' }, review: { model: 'c' } }, hosts: { claude: { code: 'a', judgment: 'b', review: 'c' } } };
  const saved = writeLocalModelRoles(target, first);
  assert.equal(saved.written, true);
  const file = path.join(target, LOCAL_REL);
  assert.match(fs.readFileSync(file, 'utf8'), /"code"/);

  const second = { roles: { code: { model: 'x' }, judgment: { model: 'y' }, review: { model: 'z' } }, hosts: { qwen: { code: 'x' } } };
  const skipped = writeLocalModelRoles(target, second);
  assert.equal(skipped.written, false);

  const merged = writeLocalModelRoles(target, second, { overwrite: true });
  assert.equal(merged.written, true);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(data.roles.code.model, 'x');
  assert.equal(data.hosts.claude.code, 'a');
  assert.equal(data.hosts.qwen.code, 'x');

  const empty = writeLocalModelRoles(tmpDir(), { roles: { code: { model: null }, judgment: { model: null }, review: { model: null } }, hosts: {} });
  assert.equal(empty.written, false);
});

test('readLocalModelRoles reports missing and malformed files without throwing', () => {
  const missing = readLocalModelRoles(tmpDir());
  assert.equal(missing.exists, false);
  assert.deepEqual(missing.roles, {});

  const target = tmpDir();
  fs.mkdirSync(path.dirname(path.join(target, LOCAL_REL)), { recursive: true });
  fs.writeFileSync(path.join(target, LOCAL_REL), '{ nope');
  const broken = readLocalModelRoles(target);
  assert.equal(broken.exists, true);
  assert.equal(broken.error, true);
});

test('summarizeModels shows the __none__ sentinel as inherit', () => {
  const text = summarizeModels({ hosts: { claude: { code: 'sonnet', judgment: '__none__', review: '' } } });
  assert.equal(text, 'claude: code=sonnet judgment=inherit review=inherit');
});

test('summarizeModels renders every host and role', () => {
  const text = summarizeModels({ hosts: { claude: { code: 'sonnet', judgment: 'opus', review: 'opus' } } });
  assert.match(text, /claude: code=sonnet judgment=opus review=opus/);
  assert.equal(summarizeModels(null), '-');
});
