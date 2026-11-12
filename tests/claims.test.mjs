import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addClaim, recheckClaims } from '../templates/engine/.agents/scripts/claims.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DREAM = path.join(HERE, '..', 'templates', 'engine', '.agents', 'scripts', 'dream-run.mjs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));
}

test('add rejects a quote that is not in the file and writes nothing', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'note.txt'), 'hello world is here now\n');
  assert.throws(
    () => addClaim({ root, claim: 'the note still says hello', path: 'note.txt', quote: 'missing-quote-text' }),
    /quote 不在文件中/,
  );
  assert.equal(fs.existsSync(path.join(root, 'workflow', 'claims.d')), false);
});

test('add then recheck is held; removing the quote makes it broken', () => {
  const root = tmp();
  const quote = 'authority line stays';
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const file = path.join(root, 'docs', 'rule.txt');
  fs.writeFileSync(file, `prefix\n${quote}\nsuffix\n`);
  const row = addClaim({
    root,
    claim: 'future sessions may trust this line',
    path: 'docs/rule.txt',
    quote,
  });
  let report = recheckClaims(root);
  assert.equal(report.broken, 0);
  assert.equal(report.held, 1);
  assert.equal(report.results[0].status, 'held');
  assert.equal(report.results[0].id, row.id);

  fs.writeFileSync(file, 'prefix\nsuffix\n');
  report = recheckClaims(root);
  assert.equal(report.held, 0);
  assert.equal(report.broken, 1);
  assert.equal(report.results[0].status, 'broken');
  assert.equal(report.results[0].reason, 'quote-missing');
  assert.equal(report.results[0].id, row.id);
});

test('dream-run reports a broken claim and does not rewrite the ledger', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const quote = 'ledger quote text';
  fs.writeFileSync(path.join(root, 'docs', 'a.txt'), `${quote}\n`);
  addClaim({ root, claim: 'this quote remains', path: 'docs/a.txt', quote });
  fs.writeFileSync(path.join(root, 'docs', 'a.txt'), 'gone\n');

  const ledgerDir = path.join(root, 'workflow', 'claims.d');
  const ledgerFile = path.join(ledgerDir, fs.readdirSync(ledgerDir)[0]);
  const before = fs.readFileSync(ledgerFile);

  const r = spawnSync(process.execPath, [DREAM, '--no-judge', '--report', 'tmp/dream-report.md'], {
    cwd: root,
    env: { ...process.env, CHECK_LOOP_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);

  assert.deepEqual(fs.readFileSync(ledgerFile), before);
  const report = fs.readFileSync(path.join(root, 'tmp', 'dream-report.md'), 'utf8');
  assert.match(report, /主张依据/);
  assert.match(report, /broken 1/);
  assert.match(report, /quote-missing/);
});
