import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLint } from '../tools/lint-templates.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  return makeTmp('flow-kit-lint-');
}

function write(root, rel, text) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

test('kit templates pass the full lint', () => {
  const result = runLint({ external: false });
  const failures = result.sections.flatMap((sec) => sec.errors.map((error) => `${sec.name}: ${error}`));
  assert.deepEqual(failures, []);
  assert.equal(result.ok, true);
});

test('lint fails on missing skill frontmatter and pointer drift', () => {
  const root = fixture();
  write(root, 'templates/engine/.agents/skills/broken/SKILL.md', '---\nname: broken\n---\n\n# Broken\n');
  write(root, 'templates/engine/.agents/commands/review.md', '# Review\n');
  write(root, 'templates/engine/.agents/roles/implementer.md', '# Implementer\n');
  write(root, 'templates/hosts/trae/commands/wf-ghost.md', '---\ndescription: ghost\n---\n`.agents/commands/ghost.md`\n');
  write(root, 'templates/hosts/trae/agents/implementer.md', '---\ndescription: role\n---\n`.agents/commands/implementer.md`\n');
  const result = runLint({ root, checks: ['frontmatter'] });
  const errors = result.sections[0].errors.join('\n');
  assert.equal(result.ok, false);
  assert.match(errors, /broken\/SKILL\.md: frontmatter description is required/);
  assert.match(errors, /wf-ghost\.md: engine command \.agents\/commands\/ghost\.md not found/);
  assert.match(errors, /implementer\.md: agent shell must reference \.agents\/roles\/implementer\.md/);
});

test('lint fails when a skill description exceeds the shared budget', () => {
  const root = fixture();
  const long = 'x'.repeat(301);
  write(root, 'templates/engine/.agents/skills/verbose/SKILL.md', `---\nname: verbose\ndescription: ${long}\n---\n\n# Verbose\n`);
  const result = runLint({ root, checks: ['frontmatter'] });
  assert.equal(result.ok, false);
  assert.match(result.sections[0].errors.join('\n'), /verbose\/SKILL\.md: description exceeds 300 chars/);
  // 预算单源（BACKLOG #26）：工具面必须引用 src/skills/lint.mjs 的 DESCRIPTION_BUDGET，不自写数字。
  assert.match(fs.readFileSync(path.join(KIT, 'tools', 'lint-templates.mjs'), 'utf8'), /DESCRIPTION_BUDGET/);
});

test('lint fails when installer locales drift', () => {
  const root = fixture();
  write(root, 'locales/zh-CN/installer.json', JSON.stringify({ a: '1', b: { c: '2' } }));
  write(root, 'locales/en/installer.json', JSON.stringify({ a: '1' }));
  const result = runLint({ root, checks: ['i18n'], external: false });
  assert.equal(result.ok, false);
  const errors = result.sections[0].errors.join('\n');
  assert.match(errors, /missing key "b\.c"/);
});

test('lint fails when the stage loading table loads an undistributed skill', () => {
  const root = fixture();
  write(root, 'templates/engine/.agents/commands/new-task.md', [
    '# New Task',
    '',
    '| 阶段 | 进入即装载 |',
    '|---|---|',
    '| Plan（intent） | `grilling`（追问） |',
    '| Design（spec） | `ghost-skill`；实现委派走 `implementer` 角色 |',
    '',
    '正文其余部分。',
    '',
  ].join('\n'));
  write(root, 'templates/engine/.agents/skills/grilling/SKILL.md', '---\nname: grilling\ndescription: d\n---\n');
  write(root, 'templates/engine/.agents/roles/implementer.md', '# Implementer\n');
  const result = runLint({ root, checks: ['stage-skills'] });
  assert.equal(result.ok, false);
  const errors = result.sections[0].errors.join('\n');
  assert.match(errors, /stage table loads "ghost-skill"/);
  assert.doesNotMatch(errors, /"grilling"/);
  assert.doesNotMatch(errors, /"implementer"/);
});

test('lint fails when the stage loading table is missing', () => {
  const root = fixture();
  write(root, 'templates/engine/.agents/commands/new-task.md', '# New Task\n\n没有装载表。\n');
  const result = runLint({ root, checks: ['stage-skills'] });
  assert.equal(result.ok, false);
  assert.match(result.sections[0].errors.join('\n'), /stage loading table not found/);
});

test('frontmatter lint covers skills that live only in a stack profile', () => {
  const root = fixture();
  // 栈专用技能住在 profile 层：只放 profile 的技能也必须被 frontmatter 检查覆盖。
  write(root, 'templates/profiles/dotnet/.agents/skills/broken/SKILL.md', '---\nname: broken\n---\n\n# Broken\n');
  const result = runLint({ root, checks: ['frontmatter'] });
  assert.equal(result.ok, false);
  assert.match(result.sections[0].errors.join('\n'), /broken\/SKILL\.md: frontmatter description is required/);
});
