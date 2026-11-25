import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import {
  PROTOCOL_VERSION,
  CHALLENGE_DIMENSIONS,
  CHALLENGE_STATUSES,
  validateChallengeVector,
  computeTokenDigest,
  buildEndorsementToken,
  validateEndorsementToken,
  writeEndorsementToken,
  loadAllEndorsements,
  resolveReviewEndorsement,
} from '../templates/engine/.agents/scripts/endorsement-protocol.mjs';
import {
  verifyReviewEndorsement,
} from '../templates/engine/.agents/scripts/pipeline-run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'templates', 'engine', '.agents', 'scripts', 'endorsement-protocol.mjs');
const signCli = (args) => spawnSync(process.execPath, [CLI, 'sign', ...args], { encoding: 'utf8', timeout: 60000 });

test('validateChallengeVector validates required fields and valid statuses', () => {
  const valid = {
    id: 'ch-01',
    dimension: 'boundary-mutation',
    adversarialPrompt: '构造超长入参以测试溢出',
    assertionCode: 'assert.doesNotThrow(() => handle())',
    status: 'survived',
  };
  const resValid = validateChallengeVector(valid);
  assert.equal(resValid.ok, true);
  assert.equal(resValid.problems.length, 0);

  const missingId = { ...valid, id: '' };
  assert.equal(validateChallengeVector(missingId).ok, false);

  const missingPrompt = { ...valid, adversarialPrompt: '   ' };
  assert.equal(validateChallengeVector(missingPrompt).ok, false);

  const invalidStatus = { ...valid, status: 'passed' }; // 必须为 survived 或 breached
  const resStatus = validateChallengeVector(invalidStatus);
  assert.equal(resStatus.ok, false);
  assert.match(resStatus.problems[0], /状态非法/);
});

test('buildEndorsementToken computes deterministic canonical digest and validates schema', () => {
  const token = buildEndorsementToken({
    doc: 'workflow/specs/auth-service.md',
    commitmentFingerprint: 'sha256-fingerprint-1234',
    challenges: [
      {
        id: 'ch-01',
        dimension: 'security-injection',
        adversarialPrompt: '尝试使用 ../ 进行路径穿越',
        assertionCode: 'assert.throws(() => read("../secret"))',
        status: 'survived',
      },
    ],
    endorsements: [
      {
        role: 'primary-auditor',
        model: 'claude-3-7-sonnet',
        sessionId: 'session-claude-01',
        conclusion: 'approved',
        signedAt: '2026-11-25T17:00:00Z',
      },
      {
        role: 'adversary-challenger',
        model: 'o3-mini',
        sessionId: 'session-o3-01',
        conclusion: 'approved',
        signedAt: '2026-11-25T17:05:00Z',
      },
    ],
  });

  assert.equal(token.version, PROTOCOL_VERSION);
  assert.equal(token.doc, 'workflow/specs/auth-service.md');
  assert.ok(token.digest && token.digest.length === 32);

  const validation = validateEndorsementToken(token);
  assert.equal(validation.ok, true);

  // 篡改指纹导致 digest 失配
  const tampered = { ...token, commitmentFingerprint: 'tampered-fingerprint' };
  const valTampered = validateEndorsementToken(tampered);
  assert.equal(valTampered.ok, false);
  assert.match(valTampered.problems[0], /失配/);
});

test('writeEndorsementToken and loadAllEndorsements support sharded storage and deduplication', () => {
  const tmpRoot = makeTmp('endorsement-shards-');
  const tokenA = buildEndorsementToken({
    doc: 'workflow/specs/billing.md',
    commitmentFingerprint: 'fp-billing-1',
    challenges: [],
    endorsements: [
      { role: 'auditor', model: 'claude-3-7-sonnet', sessionId: 'sess-01', conclusion: 'approved' },
    ],
  });

  const tokenB = buildEndorsementToken({
    doc: 'workflow/specs/gateway.md',
    commitmentFingerprint: 'fp-gateway-1',
    challenges: [
      { id: 'ch-gw', dimension: 'resource-leak', adversarialPrompt: '高并发连接耗尽测试', status: 'survived' },
    ],
    endorsements: [
      { role: 'auditor', model: 'gpt-4o', sessionId: 'sess-02', conclusion: 'approved' },
      { role: 'challenger', model: 'claude-3-5-sonnet', sessionId: 'sess-03', conclusion: 'approved' },
    ],
  });

  const fileA = writeEndorsementToken(tmpRoot, tokenA, { shard: true });
  const fileB = writeEndorsementToken(tmpRoot, tokenB, { shard: true });

  assert.ok(fs.existsSync(fileA));
  assert.ok(fs.existsSync(fileB));
  assert.ok(fileA.includes('.agents'));
  assert.ok(fileA.includes('endorsements.d'));
  assert.match(path.basename(fileA), /^billing\.[0-9a-f]{8}\.jsonl$/);

  const all = loadAllEndorsements(tmpRoot);
  assert.equal(all.length, 2);

  const onlyBilling = loadAllEndorsements(tmpRoot, 'workflow/specs/billing.md');
  assert.equal(onlyBilling.length, 1);
  assert.equal(onlyBilling[0].doc, 'workflow/specs/billing.md');
  assert.equal(onlyBilling[0].commitmentFingerprint, 'fp-billing-1');
});

test('不同目录的同名文档各写各的分片，且按 doc 精确取回', () => {
  const tmpRoot = makeTmp('endorsement-shard-paths-');
  const make = (doc, fp, model) => buildEndorsementToken({
    doc,
    commitmentFingerprint: fp,
    challenges: [],
    endorsements: [{ role: 'auditor', model, sessionId: `sess-${fp}`, conclusion: 'approved' }],
  });

  const fileA = writeEndorsementToken(tmpRoot, make('workflow/alpha/spec.md', 'fp-alpha', 'claude-3-7-sonnet'), { shard: true });
  const fileB = writeEndorsementToken(tmpRoot, make('workflow/beta/spec.md', 'fp-beta', 'gpt-4o'), { shard: true });

  assert.equal(path.dirname(fileA), path.dirname(fileB));
  assert.notEqual(path.basename(fileA), path.basename(fileB));
  assert.match(path.basename(fileA), /^spec\.[0-9a-f]{8}\.jsonl$/);
  assert.match(path.basename(fileB), /^spec\.[0-9a-f]{8}\.jsonl$/);

  const alpha = loadAllEndorsements(tmpRoot, 'workflow/alpha/spec.md');
  assert.equal(alpha.length, 1);
  assert.equal(alpha[0].commitmentFingerprint, 'fp-alpha');
  const beta = loadAllEndorsements(tmpRoot, 'workflow/beta/spec.md');
  assert.equal(beta.length, 1);
  assert.equal(beta[0].commitmentFingerprint, 'fp-beta');
  assert.equal(loadAllEndorsements(tmpRoot).length, 2);
});

test('resolveReviewEndorsement falls back to legacy regex or loads sharded token', () => {
  const tmpRoot = makeTmp('endorsement-resolve-');

  // 1. 无分片凭证时回落至正文正则提取
  const legacyMarkdown = [
    '## 确认与复核',
    '- 独立复核：通过 复核上下文：conv-legacy-01',
    '- 复核模型: claude-3-5-sonnet',
    '- 二次复核：通过 复核上下文：conv-legacy-02',
    '- 模型: gpt-4o',
  ].join('\n');

  const fallback = resolveReviewEndorsement({
    text: legacyMarkdown,
    docRel: 'workflow/specs/legacy-doc.md',
    root: tmpRoot,
  });

  assert.equal(fallback.fromToken, undefined);
  assert.equal(fallback.id, 'conv-legacy-01');
  assert.equal(fallback.reviewers.length, 2);
  assert.equal(fallback.dualEndorsed, true);

  // 2. 写入分片凭证后优先加载凭证
  const token = buildEndorsementToken({
    doc: 'workflow/specs/new-doc.md',
    commitmentFingerprint: 'fp-new-doc',
    challenges: [
      { id: 'ch-01', dimension: 'boundary-mutation', adversarialPrompt: '攻击入参', status: 'survived' },
    ],
    endorsements: [
      { role: 'auditor', model: 'claude-3-7-sonnet', sessionId: 'sess-token-01', conclusion: 'approved' },
      { role: 'challenger', model: 'deepseek-chat', sessionId: 'sess-token-02', conclusion: 'approved' },
    ],
  });
  writeEndorsementToken(tmpRoot, token, { shard: true });

  const resolved = resolveReviewEndorsement({
    text: '## 确认与复核\n(正文无元数据)',
    docRel: 'workflow/specs/new-doc.md',
    root: tmpRoot,
  });

  assert.equal(resolved.fromToken, true);
  assert.equal(resolved.id, 'sess-token-01');
  assert.equal(resolved.reviewers.length, 2);
  assert.equal(resolved.dualEndorsed, true);
  assert.equal(resolved.challenges.length, 1);
  assert.equal(resolved.challenges[0].status, 'survived');
  assert.equal(resolved.tokenDigest, token.digest);
});

test('verifyReviewEndorsement enforces adversarial challenge survival and handles breached attacks', () => {
  const ctx = {
    dispatch: {
      reviewPolicy: {
        enforceHeterogeneous: true,
        requireDualReview: true,
        requireAdversarialChallenge: true,
      },
    },
    modelRoles: { roles: { code: 'claude-3-7-sonnet' } },
  };
  const runL3 = { triage: { level: 'L3' } };

  // 1. 挑战被攻破 (breached) 必须被硬门禁阻断
  const metaBreached = {
    id: 'sess-01',
    reviewerModel: 'gpt-4o',
    reviewers: [
      { id: 'sess-01', reviewerModel: 'gpt-4o', conclusion: 'approved' },
      { id: 'sess-02', reviewerModel: 'deepseek-chat', conclusion: 'approved' },
    ],
    dualEndorsed: true,
    challenges: [
      { id: 'ch-01', dimension: 'security-injection', status: 'breached' },
    ],
  };

  const resBreached = verifyReviewEndorsement(ctx, runL3, 'review', metaBreached);
  assert.equal(resBreached.ok, false);
  assert.ok(resBreached.problems.some((p) => p.includes('被攻破的对抗挑战向量')));

  // 2. L3 要求对抗挑战，但未包含任何通过挑战
  const metaNoChallenges = {
    id: 'sess-01',
    reviewerModel: 'gpt-4o',
    reviewers: [
      { id: 'sess-01', reviewerModel: 'gpt-4o', conclusion: 'approved' },
      { id: 'sess-02', reviewerModel: 'deepseek-chat', conclusion: 'approved' },
    ],
    dualEndorsed: true,
    challenges: [],
  };

  const resMissing = verifyReviewEndorsement(ctx, runL3, 'review', metaNoChallenges);
  assert.equal(resMissing.ok, false);
  assert.ok(resMissing.problems.some((p) => p.includes('必须包含至少 1 项防御成功的对抗挑战向量')));

  // 3. 包含 survived 挑战，且异构双模型背书通过
  const metaSuccess = {
    id: 'sess-01',
    reviewerModel: 'gpt-4o',
    reviewers: [
      { id: 'sess-01', reviewerModel: 'gpt-4o', conclusion: 'approved' },
      { id: 'sess-02', reviewerModel: 'deepseek-chat', conclusion: 'approved' },
    ],
    dualEndorsed: true,
    challenges: [
      { id: 'ch-01', dimension: 'boundary-mutation', status: 'survived' },
    ],
  };

  const resSuccess = verifyReviewEndorsement(ctx, runL3, 'review', metaSuccess);
  assert.equal(resSuccess.ok, true);
  assert.equal(resSuccess.problems.length, 0);
  assert.equal(resSuccess.challenges.length, 1);
});

test('loadAllEndorsements ignores tokens rejected by validateEndorsementToken and resolve falls back to regex', () => {
  const tmpRoot = makeTmp('endorsement-invalid-');
  const docRel = 'workflow/specs/tampered.md';
  const token = buildEndorsementToken({
    doc: docRel,
    commitmentFingerprint: 'fp-tampered-1',
    endorsements: [
      { role: 'auditor', model: 'claude-3-7-sonnet', sessionId: 'sess-tampered-01', conclusion: 'approved' },
    ],
  });
  // 写入端 validateEndorsementToken 会拒绝的凭证：摘要失配 / 协议版本非法——读取端不得照收
  const badDigest = { ...token, digest: 'deadbeefdeadbeefdeadbeefdeadbeef' };
  const badVersion = { ...token, version: 2 };
  const shardDir = path.join(tmpRoot, '.agents', 'endorsements.d');
  fs.mkdirSync(shardDir, { recursive: true });
  fs.writeFileSync(
    path.join(shardDir, 'tampered.jsonl'),
    [badDigest, badVersion].map((t) => JSON.stringify(t)).join('\n') + '\n',
    'utf8',
  );

  assert.equal(loadAllEndorsements(tmpRoot, docRel).length, 0);

  const legacyText = '## 确认与复核\n- 独立复核：通过 复核上下文：conv-fallback-01 模型：gpt-4o';
  const resolved = resolveReviewEndorsement({ text: legacyText, docRel, root: tmpRoot });
  assert.equal(resolved.fromToken, undefined);
  assert.equal(resolved.id, 'conv-fallback-01');
});

test('resolveReviewEndorsement only accepts tokens whose commitmentFingerprint matches the requested commitment', () => {
  const tmpRoot = makeTmp('endorsement-commitment-');
  const docRel = 'workflow/tasks/2026-11-13-test/code-review.md';
  writeEndorsementToken(tmpRoot, buildEndorsementToken({
    doc: docRel,
    commitmentFingerprint: 'aaaa000..bbbb111',
    endorsements: [
      { role: 'auditor', model: 'gpt-4o', sessionId: 'sess-oldreview1', conclusion: 'approved' },
    ],
  }));
  const legacyText = '## 确认与复核\n- 独立复核：通过 复核上下文：conv-legacy-02 模型：gpt-4o';

  // 指纹相等 → 采纳凭证
  const matched = resolveReviewEndorsement({ text: legacyText, docRel, root: tmpRoot, commitment: 'aaaa000..bbbb111' });
  assert.equal(matched.fromToken, true);
  assert.equal(matched.id, 'sess-oldreview1');

  // 指纹不等 → 回落至正文正则提取
  const mismatched = resolveReviewEndorsement({ text: legacyText, docRel, root: tmpRoot, commitment: 'aaaa000..cccc222' });
  assert.equal(mismatched.fromToken, undefined);
  assert.equal(mismatched.id, 'conv-legacy-02');

  // 不传 commitment → 行为不变（优先采纳凭证）
  const unbound = resolveReviewEndorsement({ text: legacyText, docRel, root: tmpRoot });
  assert.equal(unbound.fromToken, true);
  assert.equal(unbound.id, 'sess-oldreview1');
});

test('CLI sign 以分片台账写出凭证并输出 digest，读取端按承诺范围取得到', () => {
  const root = makeTmp('endorsement-cli-');
  const docRel = 'workflow/tasks/2026-11-13-test/code-review.md';
  const commitment = 'a1b2c3d4e5f6a7b8..0f1e2d3c4b5a6978';
  const r = signCli([
    '--doc', docRel, '--commitment', commitment, '--session', 'sess-cli-sign01',
    '--model', 'gpt-4o', '--conclusion', 'approved', '--role', 'independent-reviewer',
    '--root', root, '--json',
  ]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout);
  assert.match(out.digest, /^[0-9a-f]{32}$/);
  assert.equal(path.dirname(out.file), path.join(root, '.agents', 'endorsements.d'));
  assert.match(path.basename(out.file), /^code-review\.[0-9a-f]{8}\.jsonl$/);

  const tokens = loadAllEndorsements(root, docRel);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].digest, out.digest);
  assert.equal(tokens[0].endorsements[0].sessionId, 'sess-cli-sign01');

  const resolved = resolveReviewEndorsement({ docRel, root, commitment });
  assert.equal(resolved.fromToken, true);
  assert.equal(resolved.id, 'sess-cli-sign01');
  assert.equal(resolved.reviewerModel, 'gpt-4o');
  assert.equal(resolved.commitmentFingerprint, commitment);
});

test('CLI sign 非 --json 输出一行；--no-shard 落主台账并接受合法挑战向量', () => {
  const root = makeTmp('endorsement-cli-noshard-');
  const challenge = JSON.stringify({
    id: 'ch-cli-01',
    dimension: 'boundary-mutation',
    adversarialPrompt: '构造超长入参触发越界',
    assertionCode: 'assert.throws(() => handle("x".repeat(1e6)))',
    status: 'survived',
  });
  const r = signCli([
    '--doc', 'workflow/plans/t.md', '--commitment', 'abcdef123456', '--session', 'sess-cli-sign02',
    '--model', 'claude-3-7-sonnet', '--conclusion', 'approved', '--challenge', challenge,
    '--root', root, '--no-shard',
  ]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /^已签署：workflow\/plans\/t\.md（会话 sess-cli-sign02 \/ 模型 claude-3-7-sonnet \/ 结论 approved）→ /);
  assert.ok(fs.existsSync(path.join(root, '.agents', 'endorsements.jsonl')), '--no-shard 写主台账');
  const tokens = loadAllEndorsements(root, 'workflow/plans/t.md');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].challenges.length, 1);
  assert.equal(tokens[0].challenges[0].id, 'ch-cli-01');
});

test('CLI sign 非法入参逐条报错、exit 2 且不写台账', () => {
  const root = makeTmp('endorsement-cli-bad-');
  const base = ['--doc', 'workflow/tasks/t/code-review.md', '--commitment', 'a1b2c3d4e5', '--session', 'sess-cli-bad01', '--model', 'gpt-4o', '--conclusion', 'approved', '--root', root];
  const replace = (flag, value) => {
    const args = [...base];
    const i = args.indexOf(flag);
    if (i >= 0) args[i + 1] = value;
    else args.push(flag, value);
    return args;
  };
  const cases = [
    { args: base.slice(2), re: /--doc/ }, // 缺 --doc
    { args: replace('--commitment', 'abc'), re: /commitment/ },
    { args: replace('--session', 'placeholder'), re: /占位符/ },
    { args: replace('--session', 'short'), re: /会话标识非法/ },
    { args: replace('--conclusion', 'maybe'), re: /结论非法/ },
    { args: [...base, '--challenge', '{bad json'], re: /--challenge\[0\] 不是合法 JSON/ },
    { args: [...base, '--challenge', '{"id":"ch-1"}'], re: /--challenge\[0\] 校验失败/ },
  ];
  for (const c of cases) {
    const r = signCli(c.args);
    assert.equal(r.status, 2, `args=${JSON.stringify(c.args)}\n${r.stderr || r.stdout}`);
    assert.match(r.stderr, c.re);
  }
  assert.equal(fs.existsSync(path.join(root, '.agents')), false, '非法入参不得写台账');
});
