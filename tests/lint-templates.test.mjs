import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLint } from '../tools/lint-templates.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-lint-'));
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

test('lint fails when installer locales drift', () => {
  const root = fixture();
  write(root, 'locales/zh-CN/installer.json', JSON.stringify({ a: '1', b: { c: '2' } }));
  write(root, 'locales/en/installer.json', JSON.stringify({ a: '1' }));
  const result = runLint({ root, checks: ['i18n'], external: false });
  assert.equal(result.ok, false);
  const errors = result.sections[0].errors.join('\n');
  assert.match(errors, /missing key "b\.c"/);
});
