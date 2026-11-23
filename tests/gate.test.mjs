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
  resolveChangedFiles,
  renderGateText,
  renderGateMarkdown,
  generateCiWorkflow,
  generateGateBadge,
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

test('runGateChecks notary guard passes when public key is at default keygen path', () => {
  const dir = makeTmp('flow-kit-gate-notary-default-key-');

  // keygen 默认落盘位置：.agents/keys/flow-kit-key.pub.pem
  const { publicKey, privateKey } = generateKeyPair();
  const keysDir = path.join(dir, '.agents', 'keys');
  fs.mkdirSync(keysDir, { recursive: true });
  fs.writeFileSync(path.join(keysDir, 'flow-kit-key.pub.pem'), publicKey, 'utf8');

  const payload = { spec: 'workflow-v1', author: 'agent', timestamp: '2026-11-22' };
  const sigObj = signPayload({ payload, privateKeyPem: privateKey });
  writeSignatureFile(path.join(dir, '.agents', 'attestation.sig'), sigObj);
  fs.writeFileSync(path.join(dir, '.agents', 'attestation.json'), JSON.stringify(payload), 'utf8');

  const res = runGateChecks({ target: dir, strict: false, t });
  const notaryGuard = res.guards.find((g) => g.name === 'notary');
  assert.ok(notaryGuard);
  assert.equal(notaryGuard.status, 'passed', notaryGuard.reason);
  assert.doesNotMatch(notaryGuard.reason, /public key|公钥/i);
  assert.equal(notaryGuard.details.count, 1);
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
  // 声明的工件必须真实存在：gate 只写 markdown，不得声明从未生成的 JUnit 报告
  assert.doesNotMatch(gl.content, /junit:/);
  assert.doesNotMatch(gl.content, /gate-summary\.xml/);
  assert.match(gl.content, /paths:/);
  assert.match(gl.content, /gate-summary\.md/);
  assert.match(gl.content, /when: always/);
});

test('generateGateBadge outputs valid markdown, svg, and json badges', () => {
  const dir = makeTmp('flow-kit-gate-badge-');
  const resApproved = runGateChecks({ target: dir, strict: false, t });

  // 1. Markdown badge
  const mdBadge = generateGateBadge(resApproved, { format: 'markdown' });
  assert.match(mdBadge, /img\.shields\.io\/badge\/AI--Gate-APPROVED-2ea44f/);

  // 2. SVG badge
  const svgBadge = generateGateBadge(resApproved, { format: 'svg' });
  assert.match(svgBadge, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svgBadge, /APPROVED/);

  // 3. JSON badge
  const jsonBadgeStr = generateGateBadge(resApproved, { format: 'json' });
  const jsonBadge = JSON.parse(jsonBadgeStr);
  assert.equal(jsonBadge.label, 'AI Gate');
  assert.equal(jsonBadge.message, 'APPROVED');
  assert.equal(jsonBadge.color, '2ea44f');
});

test('diff scoping restricts check scope to modified files', () => {
  const dir = makeTmp('flow-kit-gate-diff-');
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });

  // 提交初始文件（含有效架构配置）
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agents', 'config', 'architecture.json'),
    JSON.stringify({ version: '1.0', layers: [{ name: 'a', pattern: 'src/**' }], rules: [] }),
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'README.md'), '# Initial', 'utf8');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: dir });

  // 仅修改一个无关文档文件
  fs.writeFileSync(path.join(dir, 'README.md'), '# Updated docs', 'utf8');

  const res = runGateChecks({ target: dir, diff: true, t });
  assert.equal(res.passed, true);
  assert.equal(res.diffScoping?.active, true);
  assert.equal(res.diffScoping.changedCount, 1);

  // 架构守护和技能守护应识别为无需全量扫描（增量快通）
  const archGuard = res.guards.find((g) => g.name === 'arch');
  assert.equal(archGuard.status, 'passed');
  assert.match(archGuard.reason, /diff scope|增量/);
});

test('resolveChangedFiles returns null when git cannot resolve the diff scope', () => {
  const dir = makeTmp('flow-kit-gate-nongit-');
  assert.equal(resolveChangedFiles(dir), null);
});

test('resolveChangedFiles returns an array in a clean git repository', () => {
  const dir = makeTmp('flow-kit-gate-clean-diff-');
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });

  const changed = resolveChangedFiles(dir);
  assert.ok(Array.isArray(changed));
  assert.deepEqual(changed, []);
});

test('runGateChecks falls back to full checks when diff scope cannot be resolved', () => {
  const dir = makeTmp('flow-kit-gate-nongit-diff-');
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'a'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'b'), { recursive: true });

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
  fs.writeFileSync(path.join(dir, 'src', 'a', 'index.mjs'), `import '../b/index.mjs';\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'src', 'b', 'index.mjs'), `import '../a/index.mjs';\n`, 'utf8');

  const res = runGateChecks({ target: dir, diff: true, t });
  assert.equal(res.diffScoping, null);
  assert.equal(res.passed, false);
  assert.equal(res.verdict, 'REJECTED');

  const archGuard = res.guards.find((g) => g.name === 'arch');
  assert.equal(archGuard.status, 'failed');
});

test('CLI flow-kit gate, ci and badge commands e2e integration', () => {
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

  // 5. flow-kit gate badge 生成徽章
  const r5 = run(['gate', 'badge', '--target', dir, '--format', 'svg', '--out', 'badge.svg'], dir);
  assert.equal(r5.status, 0);
  assert.equal(fs.existsSync(path.join(dir, 'badge.svg')), true);
  assert.match(fs.readFileSync(path.join(dir, 'badge.svg'), 'utf8'), /<svg/);

  // 6. 阻断场景退出码为 1
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

  const r6 = run(['gate', '--target', dir], dir);
  assert.equal(r6.status, 1);
  assert.match(r6.stdout, /REJECTED/);
});
