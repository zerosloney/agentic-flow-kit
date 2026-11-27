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
  notaryTouches,
  renderGateText,
  renderGateMarkdown,
  generateCiWorkflow,
  generateGateBadge,
} from '../src/ci/gate.mjs';
import { generateKeyPair, signPayload, writeSignatureFile } from '../src/install/notary.mjs';
import { recordSkillEvalLog } from '../src/skills/eval-harness.mjs';
import { readKitVersion } from '../src/install/version.mjs';

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

test('notaryTouches covers signatures, payloads, and handoffs in diff scope', () => {
  // 触碰判定五类：公证目录 / 任意签名文件 / 交接信封 / attestation 载荷 / sbom 载荷
  assert.equal(notaryTouches(['.agents/notary/public.pem']), true);
  assert.equal(notaryTouches(['src/a.mjs', 'release.sbom.export.sig']), true);
  assert.equal(notaryTouches(['.agents/handoffs/H-001.json']), true);
  assert.equal(notaryTouches(['.agents/attestation.json']), true);
  assert.equal(notaryTouches(['.agents/sbom.json']), true);

  // 非公证资产触碰不触发验签（安全修复批 2026-11-23：载荷纳入判定集，防改载荷绕过验签）
  assert.equal(notaryTouches(['README.md', 'src/index.mjs']), false);
  assert.equal(notaryTouches([]), false);
  assert.equal(notaryTouches(null), false);
});

test('runGateChecks metrics guard fails on empty ledger with declared thresholds', () => {
  const dir = makeTmp('flow-kit-gate-metrics-empty-');
  const res = runGateChecks({
    target: dir,
    strict: false,
    thresholds: { maxCfr: 15 },
    t,
  });

  // 安全修复批 2026-11-23：空台账 CFR 为 null 不冒充 0，阈值已声明而数据缺失计 violation
  const metricsGuard = res.guards.find((g) => g.name === 'metrics');
  assert.ok(metricsGuard);
  assert.equal(metricsGuard.status, 'failed');
  assert.match(metricsGuard.reason, /CFR data missing/);
  assert.equal(res.passed, false);
});

test('generateCiWorkflow generates valid GitHub Actions and GitLab CI files', () => {
  const dir = makeTmp('flow-kit-gate-ci-');

  // 1. GitHub
  const gh = generateCiWorkflow({ provider: 'github', target: dir, t });
  assert.equal(gh.created, true);
  assert.equal(fs.existsSync(gh.path), true);
  assert.match(gh.content, /AI-Native Zero-Trust Quality Gate/);
  assert.match(gh.content, /agentic-flow-kit@\d+\.\d+\.\d+ gate/);

  // 2. GitLab
  const gl = generateCiWorkflow({ provider: 'gitlab', target: dir, t });
  assert.equal(gl.created, true);
  assert.equal(fs.existsSync(gl.path), true);
  assert.match(gl.content, /ai-gate:/);
  assert.match(gl.content, /agentic-flow-kit@\d+\.\d+\.\d+ gate/);
  // 声明的工件必须真实存在：gate 只写 markdown，不得声明从未生成的 JUnit 报告
  assert.doesNotMatch(gl.content, /junit:/);
  assert.doesNotMatch(gl.content, /gate-summary\.xml/);
  assert.match(gl.content, /paths:/);
  assert.match(gl.content, /gate-summary\.md/);
  assert.match(gl.content, /when: always/);
});

// D26 追加：生成器写进用户项目的 ai-gate.yml 与安装模板同标准——
// action 按完整 commit SHA 固定、最小权限、kit 版本与当前生成器一致。
test('generateCiWorkflow pins actions, permissions, and the generator kit version', () => {
  const dir = makeTmp('flow-kit-gate-ci-pin-');
  const gh = generateCiWorkflow({ provider: 'github', target: dir, t });
  const uses = gh.content.split(/\r?\n/).filter((line) => /^\s*uses:\s*\S+/.test(line));
  assert.ok(uses.length >= 2, '生成的 GitHub 工作流应至少有两个第三方 action');
  for (const line of uses) {
    assert.match(
      line.trim(),
      /^uses:\s*[^@\s]+@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+$/,
      `action 未按完整 SHA 固定：${line.trim()}`
    );
  }
  assert.match(gh.content, /^permissions:\s*$/m);
  assert.match(gh.content, /^\s+contents:\s*read\s*$/m);

  const version = readKitVersion();
  const pinned = new RegExp(`npx --yes agentic-flow-kit@${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} gate --strict`);
  assert.match(gh.content, pinned);
  assert.doesNotMatch(gh.content, /npx --yes agentic-flow-kit(?!@)/);

  const gl = generateCiWorkflow({ provider: 'gitlab', target: dir, t });
  assert.match(gl.content, pinned);
  assert.doesNotMatch(gl.content, /npx --yes agentic-flow-kit(?!@)/);
});

// 审查遗留批 2026-11-23：init-ci 对已存在的 .gitlab-ci.yml 不再无条件覆盖——默认抛 CONFIG_EXISTS
// （exit.mjs 登记 → 退出码 1），只有 --force 才允许重写用户手改过的 CI 配置。
test('generateCiWorkflow refuses to overwrite an existing GitLab CI file without force', () => {
  const dir = makeTmp('flow-kit-gate-ci-exists-');
  const first = generateCiWorkflow({ provider: 'gitlab', target: dir, t });
  assert.equal(first.created, true);

  // 模拟用户手改：默认重跑不得静默覆盖
  fs.writeFileSync(first.path, '# user-tuned pipeline', 'utf8');
  assert.throws(
    () => generateCiWorkflow({ provider: 'gitlab', target: dir, t }),
    (err) => {
      assert.equal(err.code, 'CONFIG_EXISTS');
      assert.match(err.message, /\.gitlab-ci\.yml/);
      return true;
    }
  );
  assert.equal(fs.readFileSync(first.path, 'utf8'), '# user-tuned pipeline', 'existing file must not be silently overwritten');

  // --force 才覆盖
  const forced = generateCiWorkflow({ provider: 'gitlab', target: dir, t, force: true });
  assert.equal(forced.created, true);
  assert.match(fs.readFileSync(forced.path, 'utf8'), /ai-gate:/);
});

// CLI 侧端到端：CONFIG_EXISTS 走 exit.mjs 契约（退出码 1），--force 放行。
test('gate init-ci exits 1 on an existing .gitlab-ci.yml and --force overwrites', () => {
  const dir = makeTmp('flow-kit-gate-initci-cli-');
  const first = run(['gate', 'init-ci', '--provider', 'gitlab', '--target', dir], dir);
  assert.equal(first.status, 0, first.stderr);

  const again = run(['gate', 'init-ci', '--provider', 'gitlab', '--target', dir], dir);
  assert.equal(again.status, 1, `CONFIG_EXISTS should map to CONFLICT(1), got ${again.status}: ${again.stderr}`);
  assert.match(again.stderr, /\.gitlab-ci\.yml/);

  const forced = run(['gate', 'init-ci', '--provider', 'gitlab', '--force', '--target', dir], dir);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(fs.readFileSync(path.join(dir, '.gitlab-ci.yml'), 'utf8'), /ai-gate:/);
});

// 审计修复 2026-11-27：GitHub 分支与 GitLab 同契约。init-ci 默认 provider 就是 github，
// 此前无条件重写 ai-gate.yml，会静默冲掉用户手改的工作流。
test('generateCiWorkflow refuses to overwrite an existing GitHub workflow without force', () => {
  const dir = makeTmp('flow-kit-gate-ci-gh-exists-');
  const first = generateCiWorkflow({ provider: 'github', target: dir, t });
  assert.equal(first.created, true);
  fs.writeFileSync(first.path, '# user-tuned workflow', 'utf8');

  assert.throws(
    () => generateCiWorkflow({ provider: 'github', target: dir, t }),
    (err) => {
      assert.equal(err.code, 'CONFIG_EXISTS');
      assert.match(err.message, /\.github\/workflows\/ai-gate\.yml/);
      return true;
    }
  );
  assert.equal(fs.readFileSync(first.path, 'utf8'), '# user-tuned workflow', 'existing file must not be silently overwritten');

  const forced = generateCiWorkflow({ provider: 'github', target: dir, t, force: true });
  assert.equal(forced.created, true);
  assert.match(fs.readFileSync(forced.path, 'utf8'), /AI-Native Zero-Trust Quality Gate/);
});

test('gate init-ci exits 1 on an existing GitHub workflow and --force overwrites', () => {
  const dir = makeTmp('flow-kit-gate-initci-gh-cli-');
  const first = run(['gate', 'init-ci', '--target', dir], dir);
  assert.equal(first.status, 0, first.stderr);

  const again = run(['gate', 'init-ci', '--target', dir], dir);
  assert.equal(again.status, 1, `CONFIG_EXISTS should map to CONFLICT(1), got ${again.status}: ${again.stderr}`);
  assert.match(again.stderr, /ai-gate\.yml/);

  const forced = run(['gate', 'init-ci', '--force', '--target', dir], dir);
  assert.equal(forced.status, 0, forced.stderr);
});

// D25 补全：安装器已写 .github/workflows/ci.yml 时，init-ci 不能再生成第二条流水线；
// 只按 kit 标记（name: ai-native-gates）判断，用户自己的 ci.yml 不算冲突。
test('gate init-ci refuses when the kit-installed ci.yml is present', () => {
  const dir = makeTmp('flow-kit-gate-installed-ci-');
  const workflows = path.join(dir, '.github', 'workflows');
  const installed = path.join(workflows, 'ci.yml');
  const generated = path.join(workflows, 'ai-gate.yml');
  fs.mkdirSync(workflows, { recursive: true });

  // 用户自己的 ci.yml：无 kit 标记，不触发拒绝
  fs.writeFileSync(installed, 'name: my-own-ci\n', 'utf8');
  const unrelated = generateCiWorkflow({ provider: 'github', target: dir, t });
  assert.equal(unrelated.created, true);
  assert.equal(fs.existsSync(generated), true);

  // 安装器生成的 ci.yml：按 kit 标记识别并拒绝，消息点名该文件且要求只保留一条流水线
  fs.rmSync(generated);
  fs.writeFileSync(installed, 'name: ai-native-gates\non: push\n', 'utf8');
  assert.throws(
    () => generateCiWorkflow({ provider: 'github', target: dir, t }),
    (err) => {
      assert.equal(err.code, 'CONFIG_EXISTS');
      assert.match(err.message, /\.github\/workflows\/ci\.yml/);
      assert.ok(
        err.message.includes(t('gate.ciInstalledHint')),
        `拒绝消息必须包含本地化提示（gate.ciInstalledHint）：${err.message}`
      );
      return true;
    }
  );
  assert.equal(fs.existsSync(generated), false, '拒绝时不得写入第二条流水线');

  // --force 仍然写入
  const forced = generateCiWorkflow({ provider: 'github', target: dir, t, force: true });
  assert.equal(forced.created, true);

  // 自己的目标文件已存在：默认仍拒绝
  assert.throws(
    () => generateCiWorkflow({ provider: 'github', target: dir, t }),
    (err) => err.code === 'CONFIG_EXISTS'
  );
});

// 审查遗留批 2026-11-23：git 默认把非 ASCII 路径 C 转义（"文档/\350\257\264..."），增量范围漏判。
// resolveChangedFiles 的 git 调用必须带 -c core.quotepath=off 返回原样路径。
test('resolveChangedFiles returns raw paths for non-ASCII filenames', () => {
  const dir = makeTmp('flow-kit-gate-quotepath-');
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  };
  git(['init']);
  git(['config', 'user.name', 'test']);
  git(['config', 'user.email', 'test@test.com']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# initial', 'utf8');
  git(['add', '.']);
  git(['commit', '-m', 'initial']);
  // 第二个提交引入中文文件名，让 HEAD~1...HEAD 的差异集恰好含非 ASCII 路径
  fs.mkdirSync(path.join(dir, '文档'), { recursive: true });
  fs.writeFileSync(path.join(dir, '文档', '说明.md'), '# 中文路径', 'utf8');
  git(['add', '.']);
  git(['commit', '-m', 'docs: add chinese doc']);

  const files = resolveChangedFiles(dir);
  assert.ok(Array.isArray(files), 'diff scope must resolve');
  assert.ok(files.includes('文档/说明.md'), `expected raw CJK path, got ${JSON.stringify(files)}`);
  assert.ok(!files.some((f) => /\\\d{3}/.test(f)), 'must not return C-quoted octal escapes');
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

  // 第二个提交让 HEAD~1 可达（安全修复批 2026-11-23 后：diff 失败即回退全量，不再被 porcelain 顶替）
  fs.writeFileSync(path.join(dir, 'README.md'), '# Updated docs', 'utf8');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'docs: update readme'], { cwd: dir });

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

test('resolveChangedFiles returns null in a zero-commit repository (fail-closed)', () => {
  const dir = makeTmp('flow-kit-gate-clean-diff-');
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });

  // 安全修复批 2026-11-23：零提交仓 HEAD~1 不可达，diff 失败即返回 null 回退全量，
  // 不再被 porcelain 腿误判为「空差异集」放行增量守卫
  assert.equal(resolveChangedFiles(dir), null);
});

test('resolveChangedFiles returns null in a shallow clone (fail-closed)', () => {
  const src = makeTmp('flow-kit-gate-shallow-src-');
  spawnSync('git', ['init'], { cwd: src });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: src });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: src });
  fs.writeFileSync(path.join(src, 'README.md'), '# shallow source', 'utf8');
  spawnSync('git', ['add', '.'], { cwd: src });
  const commitRes = spawnSync('git', ['commit', '-m', 'initial'], { cwd: src, encoding: 'utf8' });
  assert.equal(commitRes.status, 0, commitRes.stderr);

  const dst = makeTmp('flow-kit-gate-shallow-clone-');
  const cloneUrl = `file:///${src.replace(/\\/g, '/')}`;
  const cloneRes = spawnSync('git', ['clone', '--depth', '1', cloneUrl, dst], { encoding: 'utf8' });
  assert.equal(cloneRes.status, 0, cloneRes.stderr);

  // 浅克隆下 HEAD~1 不可达：差异集判 null → gate 回退全量并告警，而不是空集放行
  assert.equal(resolveChangedFiles(dst), null);

  const res = runGateChecks({ target: dst, diff: true, t });
  assert.equal(res.diffScoping, null);
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
