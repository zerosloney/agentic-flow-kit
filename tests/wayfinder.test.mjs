// 探索态决策地图（BACKLOG #20）：wayfinder 技能 + workflow/decision-maps/ 工件随包落盘、中英文覆盖齐，
// 且地图对既有门禁**惰性**——不属四类文档，索引/归档/证据门/确认门都不因它判红或迁移它。
// 装载表裸名 wayfinder 必须可解析（删技能即红），否则 §1c 指针悬空（同 #15 的悬空技能教训）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { runLint } from '../tools/lint-templates.mjs';
import { buildDocList } from '../templates/engine/.agents/scripts/archive-sweep.mjs';
import { projectTasks } from '../templates/engine/.agents/scripts/gen-workflow-index.mjs';
import { acceptanceEvidenceGate } from '../templates/engine/.agents/scripts/stage-gates.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const SKILL_REL = '.agents/skills/wayfinder/SKILL.md';
const TPL_REL = 'workflow/decision-maps/_TEMPLATE.md';
const MAP_REL = 'workflow/decision-maps/2026-11-17-auth-model.md';

function tmpRepo(prefix = 'wayfinder-') {
  const dir = makeTmp(prefix);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function install(lang, agent = 'claude', dir = tmpRepo()) {
  const r = run(['install', '--agent', agent, '--lang', lang, '--stack', 'node', '--target', '.'], dir);
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

// 门禁脚本要读 git 历史（archive-sweep 的 last-touch 锚），故先落一笔真实提交再安装——
// 不用 --no-verify、不改 hooksPath：安装前仓库还没有钩子，提交照常走。
function installWithHistory(lang) {
  const dir = tmpRepo();
  write(dir, 'README.md', '# fixture\n');
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  };
  git('add', 'README.md');
  git('commit', '-q', '-m', 'chore: fixture init');
  return install(lang, 'claude', dir);
}

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function write(dir, rel, text) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

// 全树指纹（相对路径 + 逐字节内容）：证明「零写」不是只看一个文件。
function treeHash(root) {
  const hash = createHash('sha256');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else hash.update(path.relative(root, abs)).update('\u0000').update(fs.readFileSync(abs)).update('\u0001');
    }
  };
  walk(root);
  return hash.digest('hex');
}

// 填实的地图：一个未决节点（实验类）+ frontier，状态 open——正是门禁最容易误判的形态。
const FILLED_MAP = [
  '---',
  '状态: open',
  '日期: 2026-11-17',
  '主题: auth-model',
  '---',
  '# 决策地图 — auth-model',
  '',
  '## 覆盖范围',
  '认证口径跨会话未决：先定会话载体才能问刷新策略。',
  '',
  '## 节点',
  '| # | 待决问题（可判定） | 为什么现在决不了 | 依赖 | 分型 | 答案形状 / 最小探针 | 状态 | 去向与依据 |',
  '|---|---|---|---|---|---|---|---|',
  '| 1 | 会话载体按 cookie 还是 bearer？ | 缺存量客户端实测 | — | 实验 | 跑现有登录链路抓响应头 | open | |',
  '| 2 | 刷新策略按滑动还是绝对过期？ | 依赖节点 1 | 1 | 裁定 | 滑动 / 绝对 | open | |',
  '',
  '## frontier（一次只解一个）',
  '- 当前节点：1',
  '- 本轮动作：跑探针',
  '- 证据指针：',
  '',
  '## 收图',
  '- 全部节点 decided/dropped 后改 closed，主线入口 = workflow/intents/2026-11-17-auth-model.md。',
  '',
].join('\n');

test('zh install lands the wayfinder skill, map template and single-source registrations', () => {
  const dir = install('zh-CN');
  const skill = read(dir, SKILL_REL);
  assert.match(skill, /^name: wayfinder$/m);
  assert.ok(skill.includes('思想来源'), 'zh body must be the kit source, not an override');
  assert.ok(skill.includes('节点是待决问题，不是交付物'));
  assert.ok(skill.includes('一次只解一个 frontier 节点'));
  // 分型判据不复制正文，只指单源（new-task §1「提问分型」）。
  assert.ok(skill.includes('`new-task.md` §1「提问分型」'));

  const tpl = read(dir, TPL_REL);
  assert.match(tpl, /^状态: open$/m);
  assert.ok(tpl.includes('| # | 待决问题（可判定） |'));
  assert.ok(tpl.includes('## frontier（一次只解一个）'));
  assert.ok(tpl.includes('.agents/skills/wayfinder/SKILL.md'), 'template must point at the writing single source');

  const manifest = JSON.parse(read(dir, '.agents/install-manifest.json')).files;
  for (const rel of [SKILL_REL, TPL_REL, '.claude/skills/wayfinder/SKILL.md']) {
    assert.ok(manifest[rel], `${rel} must be manifest-managed`);
  }
  assert.match(read(dir, '.claude/skills/wayfinder/SKILL.md'), /\.agents\/skills\/wayfinder\/SKILL\.md/);
  // 派生引擎地图的技能清单含 wayfinder（install 末尾 generateDerivedArtifacts 实跑）。
  assert.match(read(dir, '.agents/notes/engine-map.md'), /wayfinder/);

  // 真相源唯一行 + README 登记 + 两处装载指针。
  const sources = read(dir, 'workflow/artifact-sources.md').split(/\r?\n/)
    .filter((line) => line.includes('decision-maps'));
  assert.equal(sources.length, 1, 'exactly one source-of-truth row for decision maps');
  assert.ok(sources[0].includes('.agents/skills/wayfinder/SKILL.md'));
  assert.ok(read(dir, 'workflow/README.md').includes('`decision-maps/`'));
  assert.match(read(dir, '.agents/commands/new-task.md'), /Plan（intent）.*`wayfinder`/);
  assert.match(read(dir, '.agents/commands/pipeline-run.md'), /\*\*draft\*\*.*`wayfinder`/);
});

test('en install overrides the wayfinder skill and map template without zh fallback', () => {
  const dir = install('en');
  const skill = read(dir, SKILL_REL);
  assert.ok(skill.includes('Idea source:'), 'wayfinder must use the English override');
  assert.ok(!skill.includes('思想来源'), 'wayfinder must not fall back to the zh body');
  assert.ok(skill.includes('A node is an open question, not a deliverable.'));
  assert.match(read(dir, '.claude/skills/wayfinder/SKILL.md'), /Authoritative skill/i);

  const tpl = read(dir, TPL_REL);
  assert.match(tpl, /^## Nodes$/m);
  assert.match(tpl, /^## Frontier \(resolve one at a time\)$/m);
  assert.ok(!tpl.includes('待决问题'), 'map template must not fall back to zh');
  // frontmatter 键沿用中文（与 en ADR 模板同款先例：键是机器口径，正文才是语言面）。
  assert.match(tpl, /^状态: open$/m);

  const readme = read(dir, 'workflow/README.md');
  assert.ok(readme.includes('Exploration-state artifact'));
  assert.ok(!readme.includes('探索态工件'));
  assert.match(read(dir, '.agents/commands/new-task.md'), /Plan \(intent\).*`wayfinder`/);
  assert.match(read(dir, '.agents/commands/pipeline-run.md'), /\*\*draft\*\*.*`wayfinder`/);
});

test('a filled decision map is inert to the existing workflow gates', () => {
  const dir = installWithHistory('zh-CN');
  const indexBefore = read(dir, 'workflow/INDEX.md');
  const baseline = run(['run', 'check-loop.mjs'], dir);

  write(dir, MAP_REL, FILLED_MAP);
  const mapAbs = path.join(dir, MAP_REL);
  const mapBefore = fs.readFileSync(mapAbs);

  // 索引：--check 仍绿，INDEX 逐字节不变，输出不提地图。
  const idx = run(['run', 'gen-workflow-index.mjs', '--', '--check'], dir);
  assert.equal(idx.status, 0, `${idx.stdout}\n${idx.stderr}`);
  assert.equal(read(dir, 'workflow/INDEX.md'), indexBefore);
  assert.ok(!`${idx.stdout}${idx.stderr}`.includes('decision-maps'));
  assert.ok(!JSON.stringify(projectTasks(dir)).includes('auth-model'));

  // 归档：四目录闭集不含地图；dry-run 输出不提地图。
  assert.ok(!buildDocList(dir).some((doc) => String(doc.rel || doc).includes('decision-maps')));
  const sweep = run(['run', 'archive-sweep.mjs'], dir);
  assert.equal(sweep.status, 0, `${sweep.stdout}\n${sweep.stderr}`);
  assert.ok(!`${sweep.stdout}${sweep.stderr}`.includes('decision-maps'));

  // 证据门：非四类 → 跳过（不是判红，也不是判绿放行）。
  assert.deepEqual(acceptanceEvidenceGate(dir, mapAbs, MAP_REL), { ok: true, skipped: 'type' });

  // 确认门：路径不匹配四类 → 跳过，且不迁移地图状态、不写任何台账（workflow/ 全树逐字节不变）。
  const workflowBefore = treeHash(path.join(dir, 'workflow'));
  const confirm = run(['run', 'confirm-doc.mjs', '--', MAP_REL, '--delegated', '夹具原话：地图不属四类文档'], dir);
  assert.ok(`${confirm.stdout}${confirm.stderr}`.includes('路径须匹配'), `${confirm.stdout}\n${confirm.stderr}`);
  assert.deepEqual(fs.readFileSync(mapAbs), mapBefore, 'confirm-doc must not touch the map');
  assert.match(read(dir, MAP_REL), /^状态: open$/m);
  assert.equal(treeHash(path.join(dir, 'workflow')), workflowBefore, 'confirm-doc must not write a ledger row for the map');

  // 聚合硬门：状态与地图无关，输出不提地图。
  const after = run(['run', 'check-loop.mjs'], dir);
  assert.equal(after.status, baseline.status, `${after.stdout}\n${after.stderr}`);
  assert.ok(!`${after.stdout}${after.stderr}`.includes('decision-maps'));
  assert.ok(!`${after.stdout}${after.stderr}`.includes('auth-model'));
});

test('stage loading table resolves wayfinder and turns red when the skill is removed', () => {
  const root = makeTmp('wayfinder-lint-');
  const copy = (rel) => {
    const from = path.join(KIT, rel);
    const to = path.join(root, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  };
  copy('templates/engine/.agents/skills');
  copy('templates/engine/.agents/roles');
  copy('templates/engine/.agents/commands/new-task.md');
  copy('locales/en/overrides/.agents/commands/new-task.md');

  const green = runLint({ root, checks: ['stage-skills'] });
  assert.deepEqual(green.sections[0].errors, []);
  assert.equal(green.ok, true);

  fs.rmSync(path.join(root, 'templates/engine/.agents/skills/wayfinder/SKILL.md'));
  const red = runLint({ root, checks: ['stage-skills'] });
  assert.equal(red.ok, false);
  const errors = red.sections[0].errors.join('\n');
  assert.match(errors, /new-task\.md: stage table loads "wayfinder"/);
  // 中英文装载表都点名（en 覆盖不是可选装饰）。
  assert.match(errors, /locales\/en\/overrides\/\.agents\/commands\/new-task\.md: stage table loads "wayfinder"/);
});
