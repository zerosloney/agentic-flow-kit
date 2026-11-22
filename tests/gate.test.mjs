import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { makeT } from '../src/i18n.mjs';
import {
  runGateChecks,
  renderGateText,
  renderGateMarkdown,
  generateCiWorkflow,
} from '../src/ci/gate.mjs';
import { generateKeyPair, signPayload, writeSignatureFile } from '../src/install/notary.mjs';
import { recordSkillEvalLog } from '../src/skills/eval-harness.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const t = makeT('zh-CN');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

test('runGateChecks passes on clean empty repository', () => {
  const dir = makeTmp('flow-kit-gate-clean-');
  const res = runGateChecks({ target: dir, strict: false, t });

  assert.equal(res.passed, true);
  assert.equal(res.verdict, 'APPROVED');
  assert.equal(res.summary.failed, 0);
  assert.ok(res.guards.length >= 4);
});

test('renderGateText and renderGateMarkdown output readable summaries', () => {
  const dir = makeTmp('flow-kit-gate-render-');
  const res = runGateChecks({ target: dir, strict: false, t });

  const text = renderGateText(res, t);
  assert.match(text, /AI-Native Zero-Trust Quality Gate|AI 原生零信任合流质量门禁/);
  assert.match(text, /APPROVED/);

  const md = renderGateMarkdown(res, t);
  assert.match(md, /APPROVED/);
  assert.match(md, /架构分层|Architecture Layering/);
  assert.match(md, /### 📊 Summary/);
});

test('runGateChecks blocks on architecture circular dependency', () => {
  const dir = makeTmp('flow-kit-gate-arch-fail-');
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'a'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'b'), { recursive: true });

  // 写入架构分层配置
  fs.writeFileSync(
    path.join(dir, '.agents', 'config', 'architecture.json'),
    JSON.stringify({
      version: '1.0',
      layers: [
        { name: 'a', pattern: 'src/a/**' },
        { name: 'b', pattern: 'src/b/**' },
      ],
      rules: [{ from: 'a', canOnlyImport: ['b'] }],
    }),
    'utf8'
  );

  // 构造 A -> B -> A 循环依赖
  fs.writeFileSync(path.join(dir, 'src', 'a', 'index.mjs'), `import '../b/index.mjs';\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'b', 'index.mjs'), `import '../a/index.mjs';\n`, 'utf8');

  const res = runGateChecks({ target: dir, strict: false, t });
  assert.equal(res.passed, false);
  assert.equal(res.verdict, 'REJECTED');

  const archGuard = res.guards.find((g) => g.name === 'arch');
  assert.ok(archGuard);
  assert.equal(archGuard.status, 'failed');
});

test('runGateChecks blocks on failed skills regression evaluation', () => {
  const dir = makeTmp('flow-kit-gate-skill-fail-');
  const skillDir = path.join(dir, '.agents', 'skills', 'tester');
  const evalsDir = path.join(skillDir, 'evals');
  fs.mkdirSync(evalsDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: tester\n---\n');
  fs.writeFileSync(
    path.join(evalsDir, 'dataset.json'),
    JSON.stringify({ version: 1, skill: 'tester', cases: [] }),
    'utf8'
  );

  // 构造未达标评测凭据（通过率 0.4 < 阈值 0.8，outcome: fail）
  recordSkillEvalLog(dir, {
    skill: 'tester',
    passRate: 0.4,
    total: 10,
    passed: 4,
    threshold: 0.8,
    outcome: 'fail',
  });

  const res = runGateChecks({ target: dir, strict: false, t });
  assert.equal(res.passed, false);
  assert.equal(res.verdict, 'REJECTED');

  const skillGuard = res.guards.find((g) => g.name === 'skills');
  assert.ok(skillGuard);
  assert.equal(skillGuard.status, 'failed');
});

test('runGateChecks blocks on tampered attestation notary proof', () => {
  const dir = makeTmp('flow-kit-gate-notary-fail-');
  fs.mkdirSync(path.join(dir, '.agents', 'notary'), { recursive: true });

  const { publicKey, privateKey } = generateKeyPair();
  fs.writeFileSync(path.join(dir, '.agents', 'notary', 'public.pem'), publicKey, 'utf8');

  const originalPayload = { spec: 'workflow-v1', author: 'agent', timestamp: '2026-11-22' };
  const sigObj = signPayload({ payload: originalPayload, privateKeyPem: privateKey });
  writeSignatureFile(path.join(dir, '.agents', 'attestation.sig'), sigObj);

  // 故意写入被篡改的 payload 内容
  const tamperedPayload = { spec: 'workflow-v1', author: 'attacker', timestamp: '2026-11-22' };
  fs.writeFileSync(path.join(dir, '.agents', 'attestation.json'), JSON.stringify(tamperedPayload), 'utf8');

  const res = runGateChecks({ target: dir, strict: false, t });
  assert.equal(res.passed, false);
  assert.equal(res.verdict, 'REJECTED');

  const notaryGuard = res.guards.find((g) => g.name === 'notary');
  assert.ok(notaryGuard);
  assert.equal(notaryGuard.status, 'failed');
});

test('generateCiWorkflow generates valid GitHub Actions and GitLab CI files', () => {
  const dir = makeTmp('flow-kit-gate-ci-');

  // 1. GitHub
  const gh = generateCiWorkflow({ provider: 'github', target: dir, t });
  assert.equal(gh.created, true);
  assert.equal(fs.existsSync(gh.path), true);
  assert.match(gh.content, /AI-Native Zero-Trust Quality Gate/);
  assert.match(gh.content, /agentic-flow-kit gate/);

  // 2. GitLab
  const gl = generateCiWorkflow({ provider: 'gitlab', target: dir, t });
  assert.equal(gl.created, true);
  assert.equal(fs.existsSync(gl.path), true);
  assert.match(gl.content, /ai-gate:/);
  assert.match(gl.content, /agentic-flow-kit gate/);
});

test('CLI flow-kit gate and ci commands e2e integration', () => {
  const dir = makeTmp('flow-kit-gate-cli-');

  // 1. flow-kit gate 默认执行
  const r1 = run(['gate', '--target', dir], dir);
  assert.equal(r1.status, 0);
  assert.match(r1.stdout, /APPROVED/);

  // 2. flow-kit gate --json 输出
  const r2 = run(['gate', '--target', dir, '--json'], dir);
  assert.equal(r2.status, 0);
  const json = JSON.parse(r2.stdout);
  assert.equal(json.verdict, 'APPROVED');
  assert.equal(json.passed, true);

  // 3. flow-kit gate --markdown --out gate-summary.md
  const r3 = run(['gate', '--target', dir, '--markdown', '--out', 'gate-summary.md'], dir);
  assert.equal(r3.status, 0);
  const summaryFile = path.join(dir, 'gate-summary.md');
  assert.equal(fs.existsSync(summaryFile), true);
  const mdContent = fs.readFileSync(summaryFile, 'utf8');
  assert.match(mdContent, /AI-Native Zero-Trust Quality Gate/);
  assert.match(mdContent, /APPROVED/);

  // 4. flow-kit ci init 生成流水线
  const r4 = run(['ci', 'init', '--target', dir, '--provider', 'github'], dir);
  assert.equal(r4.status, 0);
  assert.equal(fs.existsSync(path.join(dir, '.github', 'workflows', 'ai-gate.yml')), true);

  // 5. 阻断场景退出码为 1
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'x'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'y'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agents', 'config', 'architecture.json'),
    JSON.stringify({
      version: '1.0',
      layers: [
        { name: 'x', pattern: 'src/x/**' },
        { name: 'y', pattern: 'src/y/**' },
      ],
      rules: [{ from: 'x', canOnlyImport: ['y'] }],
    }),
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'src', 'x', 'a.mjs'), `import '../y/b.mjs';\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'y', 'b.mjs'), `import '../x/a.mjs';\n`, 'utf8');

  const r5 = run(['gate', '--target', dir], dir);
  assert.equal(r5.status, 1);
  assert.match(r5.stdout, /REJECTED/);
});
