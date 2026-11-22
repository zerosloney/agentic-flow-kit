import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import {
  matchPattern,
  deepPartialMatch,
  findSkillDatasets,
  loadSkillDataset,
  evaluateSkillCase,
  recordSkillEvalLog,
  runSkillEvalSuite,
  checkSkillsEvalHealth,
  EVAL_LOG_REL,
  EVAL_RESULTS_REL,
} from '../src/skills/eval-harness.mjs';
import { makeT } from '../src/i18n.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'flow-kit.mjs');

function cli(cwd, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

function makeTarget() {
  const dir = makeTmp('flow-kit-skill-eval-');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: dir }).status, 0);
  const r = cli(dir, ['install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--no-model-config']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return dir;
}

test('matchPattern and deepPartialMatch primitives', () => {
  // matchPattern
  assert.ok(matchPattern('hello world', 'world'));
  assert.ok(!matchPattern('hello world', 'universe'));
  assert.ok(matchPattern('Status: PASS_123', '/^status:\\s+pass_\\d+/i'));
  assert.ok(!matchPattern('Status: FAIL_123', '/^status:\\s+pass_\\d+/i'));

  // deepPartialMatch
  assert.ok(deepPartialMatch({ a: 1, b: 2, c: { x: 10, y: 20 } }, { a: 1, c: { x: 10 } }));
  assert.ok(!deepPartialMatch({ a: 1, b: 2 }, { a: 2 }));
  assert.ok(!deepPartialMatch({ a: 1 }, { b: 1 }));
  assert.ok(deepPartialMatch([1, 2, 3], [1, 2]));
  assert.ok(!deepPartialMatch([1], [1, 2]));
});

test('dataset discovery and loading', () => {
  const target = makeTarget();

  // Create skill with evals/dataset.json
  const skillDir = path.join(target, '.agents', 'skills', 'test-skill', 'evals');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(target, '.agents', 'skills', 'test-skill', 'SKILL.md'), '---\nname: test-skill\ndescription: test\n---\n# test\n');
  const dataset = {
    version: 1,
    skill: 'test-skill',
    cases: [
      {
        id: 'c1',
        title: 'Check echo output',
        command: ['node', '-e', 'console.log(JSON.stringify({ ok: true, value: 42 }))'],
        expect: {
          status: 0,
          json: { ok: true },
        },
      },
    ],
  };
  fs.writeFileSync(path.join(skillDir, 'dataset.json'), JSON.stringify(dataset, null, 2));

  // Also create a standalone dataset in .agents/evals/skills/other-skill.json
  const evalsSkillsDir = path.join(target, '.agents', 'evals', 'skills');
  fs.mkdirSync(evalsSkillsDir, { recursive: true });
  fs.writeFileSync(
    path.join(evalsSkillsDir, 'other-skill.json'),
    JSON.stringify({ version: 1, skill: 'other-skill', cases: [] }),
  );

  const found = findSkillDatasets(target);
  assert.equal(found.length, 2);
  assert.ok(found.some((f) => f.skill === 'test-skill'));
  assert.ok(found.some((f) => f.skill === 'other-skill'));

  const loaded = loadSkillDataset(target, 'test-skill');
  assert.equal(loaded.ok, true);
  assert.equal(loaded.skill, 'test-skill');
  assert.equal(loaded.cases.length, 1);
});

test('evaluateSkillCase handles status, stdout regex, json assertions and timeouts', () => {
  const target = makeTarget();

  // 1. Success case with status, regex and json
  const passCase = {
    id: 'case-pass',
    title: 'Print valid json',
    command: ['node', '-e', 'console.log(JSON.stringify({ result: "ok", count: 100 }))'],
    expect: {
      status: 0,
      stdout: '/"result":\\s*"ok"/',
      json: { result: 'ok', count: 100 },
      maxDurationMs: 10000,
    },
  };
  const res1 = evaluateSkillCase(passCase, { target });
  assert.equal(res1.ok, true);
  assert.equal(res1.status, 0);
  assert.equal(res1.errors.length, 0);

  // 2. Failure case with status mismatch
  const failStatusCase = {
    id: 'case-fail-status',
    command: ['node', '-e', 'process.exit(2)'],
    expect: { status: 0 },
  };
  const res2 = evaluateSkillCase(failStatusCase, { target });
  assert.equal(res2.ok, false);
  assert.match(res2.errors[0], /Expected exit status 0, got 2/);

  // 3. Failure case with json mismatch
  const failJsonCase = {
    id: 'case-fail-json',
    command: ['node', '-e', 'console.log(JSON.stringify({ code: 500 }))'],
    expect: { json: { code: 200 } },
  };
  const res3 = evaluateSkillCase(failJsonCase, { target });
  assert.equal(res3.ok, false);
  assert.match(res3.errors[0], /stdout JSON does not satisfy expected partial match/);

  // 4. Timeout failure
  const timeoutCase = {
    id: 'case-timeout',
    command: ['node', '-e', 'const s = Date.now(); while (Date.now() - s < 300) {}'],
    expect: { maxDurationMs: 100 },
  };
  const res4 = evaluateSkillCase(timeoutCase, { target });
  assert.equal(res4.ok, false);
  assert.match(res4.errors[0], /Execution timed out/);
});

test('runSkillEvalSuite and recordSkillEvalLog records evidence', () => {
  const target = makeTarget();

  const skillDir = path.join(target, '.agents', 'skills', 'math-skill', 'evals');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(target, '.agents', 'skills', 'math-skill', 'SKILL.md'), '---\nname: math-skill\ndescription: math\n---\n# math\n');

  const dataset = {
    version: 1,
    skill: 'math-skill',
    cases: [
      {
        id: 'c1',
        title: 'Compute 2+2',
        command: ['node', '-e', 'console.log("sum: 4")'],
        expect: { status: 0, stdout: 'sum: 4' },
      },
      {
        id: 'c2',
        title: 'Compute 3*3',
        command: ['node', '-e', 'console.log("prod: 9")'],
        expect: { status: 0, stdout: 'prod: 9' },
      },
    ],
  };
  fs.writeFileSync(path.join(skillDir, 'dataset.json'), JSON.stringify(dataset, null, 2));

  // Run suite with recording enabled
  const suiteRes = runSkillEvalSuite(target, { skill: 'math-skill', record: true, threshold: 0.8 });
  assert.equal(suiteRes.ok, true);
  assert.equal(suiteRes.suites.length, 1);
  assert.equal(suiteRes.suites[0].passRate, 1);
  assert.equal(suiteRes.suites[0].outcome, 'pass');

  // Verify eval-log.json and results.jsonl were generated
  const logFile = path.join(target, EVAL_LOG_REL);
  const resultsFile = path.join(target, EVAL_RESULTS_REL);
  assert.ok(fs.existsSync(logFile), 'eval-log.json should exist');
  assert.ok(fs.existsSync(resultsFile), 'results.jsonl should exist');

  const logContent = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  assert.equal(logContent.version, 1);
  assert.equal(logContent.entries.length, 1);
  const entry = logContent.entries[0];
  assert.equal(entry.skill, 'math-skill');
  assert.equal(entry.passRate, 1);
  assert.equal(entry.tasks, 2);
  assert.equal(entry.outcome, 'pass');
  assert.equal(entry.threshold, 0.8);
  assert.ok(typeof entry.signature === 'string' && entry.signature.length > 0);
});

test('checkSkillsEvalHealth detects missing, failing, and healthy skill evals', () => {
  const target = makeTarget();
  const t = makeT('zh-CN');

  // 1. Skills exist but no datasets -> returns warn
  const skillDir = path.join(target, '.agents', 'skills', 'custom-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: custom-skill\n---\n');

  let health = checkSkillsEvalHealth(target, t);
  assert.equal(health.ok, true);
  assert.equal(health.warn, true);
  assert.match(health.detail, /未发现回归评测数据集/);

  // 2. Add dataset but no eval-log yet -> reports missing eval
  const evalsDir = path.join(skillDir, 'evals');
  fs.mkdirSync(evalsDir, { recursive: true });
  fs.writeFileSync(
    path.join(evalsDir, 'dataset.json'),
    JSON.stringify({ version: 1, skill: 'custom-skill', cases: [] }),
  );

  health = checkSkillsEvalHealth(target, t);
  assert.equal(health.ok, true);
  assert.equal(health.warn, true);
  assert.match(health.detail, /缺少评测日志凭证/);

  // 3. Record failing eval (passRate 0.5 < threshold 0.8) -> reports ok: false
  recordSkillEvalLog(target, {
    skill: 'custom-skill',
    passRate: 0.5,
    total: 2,
    passed: 1,
    threshold: 0.8,
    outcome: 'fail',
  });

  health = checkSkillsEvalHealth(target, t);
  assert.equal(health.ok, false);
  assert.match(health.detail, /评测未达标/);

  // 4. Record passing eval -> reports ok: true
  recordSkillEvalLog(target, {
    skill: 'custom-skill',
    passRate: 1.0,
    total: 2,
    passed: 2,
    threshold: 0.8,
    outcome: 'pass',
  });

  health = checkSkillsEvalHealth(target, t);
  assert.equal(health.ok, true);
  assert.equal(health.warn, undefined);
  assert.match(health.detail, /技能评测凭证核验通过/);
});

test('flow-kit skills eval CLI command execution and JSON output', () => {
  const target = makeTarget();

  const skillDir = path.join(target, '.agents', 'skills', 'cli-skill', 'evals');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(target, '.agents', 'skills', 'cli-skill', 'SKILL.md'), '---\nname: cli-skill\n---\n');

  const dataset = {
    version: 1,
    skill: 'cli-skill',
    cases: [
      {
        id: 'check-1',
        title: 'Check ok status',
        command: ['node', '-e', 'console.log("ALL_PASS")'],
        expect: { status: 0, stdout: 'ALL_PASS' },
      },
    ],
  };
  fs.writeFileSync(path.join(skillDir, 'dataset.json'), JSON.stringify(dataset, null, 2));

  // CLI eval with --json and --record
  const r = cli(target, ['skills', 'eval', '--skill', 'cli-skill', '--record', '--json']);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.command, 'skills eval');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.suites.length, 1);
  assert.equal(parsed.suites[0].skill, 'cli-skill');
  assert.equal(parsed.suites[0].passRate, 1);

  // Run doctor to verify checkSkillsEvalHealth integration in doctor CLI
  const rDoc = cli(target, ['doctor', '--json']);
  assert.equal(rDoc.status, 0, rDoc.stderr || rDoc.stdout);
  const docJson = JSON.parse(rDoc.stdout);
  const evalCheck = docJson.checks.find((c) => c.name === 'skills eval');
  assert.ok(evalCheck, 'skills eval check should appear in doctor output');
  assert.equal(evalCheck.ok, true);

  // Human readable output
  const rHuman = cli(target, ['skills', 'eval', '--skill', 'cli-skill']);
  assert.equal(rHuman.status, 0, rHuman.stderr || rHuman.stdout);
  assert.match(rHuman.stdout, /技能评测：cli-skill/);
  assert.match(rHuman.stdout, /评测达标：通过率 100\.0%/);
  assert.match(rHuman.stdout, /技能回归评测全部通过/);
});

test('flow-kit skills eval exits 1 on failure and supports custom dataset', () => {
  const target = makeTarget();

  // Create a custom dataset outside .agents/skills
  const customDsPath = path.join(target, 'my-eval-dataset.json');
  fs.writeFileSync(
    customDsPath,
    JSON.stringify({
      version: 1,
      skill: 'failing-skill',
      cases: [
        {
          id: 'fail-1',
          title: 'Will fail intentionally',
          command: ['node', '-e', 'console.log("wrong")'],
          expect: { status: 0, stdout: 'expected_token' },
        },
      ],
    }, null, 2),
  );

  // Evaluate using --dataset
  const rFail = cli(target, ['skills', 'eval', '--dataset', customDsPath, '--json']);
  assert.equal(rFail.status, 1, 'Should exit with code 1 on failed evaluation');
  const parsed = JSON.parse(rFail.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.suites[0].outcome, 'fail');
  assert.equal(parsed.suites[0].passRate, 0);

  // Human mode failure output
  const rFailHuman = cli(target, ['skills', 'eval', '--dataset', customDsPath]);
  assert.equal(rFailHuman.status, 1);
  assert.match(rFailHuman.stdout, /评测未达标/);
});

