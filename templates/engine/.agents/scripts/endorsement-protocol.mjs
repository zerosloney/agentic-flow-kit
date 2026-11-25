#!/usr/bin/env node
// endorsement-protocol.mjs — 异构对抗审计与去中心化背书协议核心（2026-11-25）
// 核心目标：
//   1. 结构化对抗挑战向量（ChallengeVector）：记录红方构造的对抗攻击、证伪断言与防御结果；
//   2. 去中心化背书凭证（EndorsementToken）：将承诺面指纹、跨模型独立背书人与对抗挑战通过规范化哈希（digest）强绑定；
//   3. 分片台账存储（.agents/endorsements.d/<doc-base>.<doc-路径哈希>.jsonl）：单文档独占写，彻底消除多智能体并发审查冲突；
//   4. 透明平滑适配（resolveReviewEndorsement）：优先加载分片凭证，无凭证时平滑回落至存量正则提取。
//   契约：代码复核凭证的 commitmentFingerprint 取值为复核范围 <base>..<head>，与代码复核产物里机器写入的「复核范围」一行一致。
//   用法（CLI 签署入口）：
//     flow-kit run endorsement-protocol.mjs sign --doc <相对路径> --commitment <承诺指纹> --session <会话或子代理 id>
//       --model <模型名> --conclusion <approved|rejected> [--role <角色>] [--challenge <JSON>]... [--root <仓库根>] [--no-shard] [--json]
//     代码复核的 --commitment 取代码复核产物里机器写入的「复核范围」<base>..<head>。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  normalizeModelFamily,
  isHeterogeneousModel,
  parseReviewMetadata,
  isApprovedConclusion,
} from './touch-set.mjs';

export const PROTOCOL_VERSION = 1;
export const CHALLENGE_DIMENSIONS = [
  'boundary-mutation',       // 边界入参变异与越界攻击
  'state-machine',           // 状态机非法转移与乱序绕过
  'resource-leak',           // 资源泄漏、并发死锁与句柄未释放
  'assumption-falsification',// 隐式业务假设与前置条件证伪
  'security-injection',      // 路径穿越、代码注入与未授权访问
];

export const CHALLENGE_STATUSES = ['survived', 'breached'];
export const VERDICT_STATUSES = ['approved', 'rejected', 'downgraded'];

export function validateChallengeVector(vector) {
  const problems = [];
  if (!vector || typeof vector !== 'object') {
    return { ok: false, problems: ['挑战向量必须为对象'] };
  }
  if (!vector.id || typeof vector.id !== 'string' || !vector.id.trim()) {
    problems.push('挑战向量缺少标识符 (id)');
  }
  if (!vector.dimension || typeof vector.dimension !== 'string' || !vector.dimension.trim()) {
    problems.push('挑战向量缺少攻击维度 (dimension)');
  }
  if (!vector.adversarialPrompt || typeof vector.adversarialPrompt !== 'string' || !vector.adversarialPrompt.trim()) {
    problems.push('挑战向量缺少对抗提示词或攻击描述 (adversarialPrompt)');
  }
  if (!vector.status || !CHALLENGE_STATUSES.includes(vector.status)) {
    problems.push(`挑战向量状态非法:「${vector.status || ''}」，必须为 ${CHALLENGE_STATUSES.join(' / ')}`);
  }
  return { ok: problems.length === 0, problems };
}

export function computeTokenDigest(token) {
  if (!token || typeof token !== 'object') return '';
  const canonical = {
    version: token.version || PROTOCOL_VERSION,
    doc: String(token.doc || '').replace(/\\/g, '/'),
    commitmentFingerprint: String(token.commitmentFingerprint || ''),
    challenges: (token.challenges || []).map((c) => ({
      id: String(c.id || ''),
      dimension: String(c.dimension || ''),
      adversarialPrompt: String(c.adversarialPrompt || '').trim(),
      assertionCode: String(c.assertionCode || '').trim(),
      status: String(c.status || ''),
    })),
    endorsements: (token.endorsements || []).map((e) => ({
      role: String(e.role || ''),
      model: String(e.model || ''),
      family: String(e.family || normalizeModelFamily(e.model)),
      sessionId: String(e.sessionId || ''),
      conclusion: String(e.conclusion || ''),
      signedAt: String(e.signedAt || ''),
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex').slice(0, 32);
}

export function buildEndorsementToken({
  doc,
  commitmentFingerprint,
  challenges = [],
  endorsements = [],
  version = PROTOCOL_VERSION,
} = {}) {
  const normDoc = String(doc || '').replace(/\\/g, '/').replace(/^\.?\//, '').trim();
  const token = {
    version: Number(version) || PROTOCOL_VERSION,
    doc: normDoc,
    commitmentFingerprint: String(commitmentFingerprint || '').trim(),
    challenges: Array.isArray(challenges) ? challenges : [],
    endorsements: Array.isArray(endorsements) ? endorsements.map((e) => ({
      ...e,
      family: e.family || normalizeModelFamily(e.model),
    })) : [],
  };
  token.digest = computeTokenDigest(token);
  return token;
}

export function validateEndorsementToken(token) {
  const problems = [];
  if (!token || typeof token !== 'object') {
    return { ok: false, problems: ['背书凭证必须为有效对象'] };
  }
  if (token.version !== PROTOCOL_VERSION) {
    problems.push(`不支持的背书凭证协议版本: ${token.version}`);
  }
  if (!token.doc || typeof token.doc !== 'string' || !token.doc.trim()) {
    problems.push('背书凭证缺少目标文档路径 (doc)');
  }
  if (!token.commitmentFingerprint || typeof token.commitmentFingerprint !== 'string' || token.commitmentFingerprint.length < 6) {
    problems.push('背书凭证缺少有效的承诺面指纹 (commitmentFingerprint)');
  }
  if (!Array.isArray(token.endorsements) || token.endorsements.length === 0) {
    problems.push('背书凭证必须包含至少一位独立背书人记录 (endorsements)');
  } else {
    for (const [idx, end] of token.endorsements.entries()) {
      if (!end.sessionId || typeof end.sessionId !== 'string') {
        problems.push(`背书人 [${idx}] 缺少外部会话或子代理会话 ID (sessionId)`);
      }
      if (!end.model || typeof end.model !== 'string') {
        problems.push(`背书人 [${idx}] 缺少背书模型标识 (model)`);
      }
      if (!end.conclusion || typeof end.conclusion !== 'string') {
        problems.push(`背书人 [${idx}] 缺少背书结论 (conclusion)`);
      }
    }
  }
  if (Array.isArray(token.challenges)) {
    for (const [idx, ch] of token.challenges.entries()) {
      const v = validateChallengeVector(ch);
      if (!v.ok) {
        problems.push(`挑战向量 [${idx}] 校验失败: ${v.problems.join('; ')}`);
      }
    }
  }
  const expectedDigest = computeTokenDigest(token);
  if (!token.digest || token.digest !== expectedDigest) {
    problems.push(`背书凭证摘要 (digest) 失配: 期望 ${expectedDigest}，实际 ${token.digest || '缺失'}`);
  }
  return { ok: problems.length === 0, problems };
}

export function writeEndorsementToken(root = process.cwd(), token, { shard = true } = {}) {
  const val = validateEndorsementToken(token);
  if (!val.ok) {
    throw new Error(`无法写入非法背书凭证: ${val.problems.join(', ')}`);
  }
  let targetFile;
  if (shard && token.doc) {
    const shardDir = path.join(root, '.agents', 'endorsements.d');
    fs.mkdirSync(shardDir, { recursive: true });
    // doc 归一与 buildEndorsementToken 同口径；分片名带路径哈希——不同目录的同名文档各写各的分片。
    const normDoc = String(token.doc).replace(/\\/g, '/').replace(/^\.?\//, '').trim();
    const baseName = path.basename(normDoc, '.md');
    const docHash = crypto.createHash('sha256').update(normDoc, 'utf8').digest('hex').slice(0, 8);
    targetFile = path.join(shardDir, `${baseName}.${docHash}.jsonl`);
  } else {
    targetFile = path.join(root, '.agents', 'endorsements.jsonl');
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  }

  fs.appendFileSync(targetFile, JSON.stringify(token) + '\n', 'utf8');
  return targetFile;
}

export function loadAllEndorsements(root = process.cwd(), docRel = null) {
  const normTarget = docRel ? String(docRel).replace(/\\/g, '/').replace(/^\.?\//, '').trim() : null;
  const byKey = new Map();

  const parseLines = (text) => {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (!obj || !obj.doc) continue;
        const normDoc = String(obj.doc).replace(/\\/g, '/').replace(/^\.?\//, '').trim();
        if (normTarget && normDoc !== normTarget) continue;
        // 读取端与写入端同规：写入端 validateEndorsementToken 拒绝的凭证（摘要失配/版本非法/字段缺失）不得被采纳
        const val = validateEndorsementToken(obj);
        if (!val.ok) {
          console.error(`[endorsement-protocol] 凭证校验失败，已忽略: ${normDoc}（${val.problems.join('；')}）`);
          continue;
        }
        const key = `${normDoc}|${obj.commitmentFingerprint || ''}|${obj.digest || ''}`;
        byKey.delete(key);
        byKey.set(key, obj);
      } catch {
        // 坏行静默忽略
      }
    }
  };

  // 1. 读主台账
  const mainFile = path.join(root, '.agents', 'endorsements.jsonl');
  if (fs.existsSync(mainFile)) {
    try {
      parseLines(fs.readFileSync(mainFile, 'utf8'));
    } catch (err) {
      console.error(`[endorsement-protocol] 主台账读取失败: ${mainFile} (${err.message})`);
    }
  }

  // 2. 读分片目录
  const shardDir = path.join(root, '.agents', 'endorsements.d');
  if (fs.existsSync(shardDir) && fs.statSync(shardDir).isDirectory()) {
    try {
      const files = fs.readdirSync(shardDir).filter((f) => f.endsWith('.jsonl')).sort();
      for (const file of files) {
        try {
          parseLines(fs.readFileSync(path.join(shardDir, file), 'utf8'));
        } catch (err) {
          console.error(`[endorsement-protocol] 分片读取失败: ${file} (${err.message})`);
        }
      }
    } catch (err) {
      console.error(`[endorsement-protocol] 分片目录读取失败: ${shardDir} (${err.message})`);
    }
  }

  return [...byKey.values()];
}

export function resolveReviewEndorsement({ text, docRel, root = process.cwd(), commitment } = {}) {
  if (docRel) {
    let tokens = loadAllEndorsements(root, docRel);
    // 复核范围绑定：传 commitment 时只采纳指纹相等的凭证，避免旧范围的凭证为新范围放行
    if (commitment) tokens = tokens.filter((t) => t.commitmentFingerprint === commitment);
    if (tokens.length > 0) {
      const token = tokens[tokens.length - 1];
      const reviewers = (token.endorsements || []).map((e) => ({
        id: e.sessionId,
        reviewerModel: e.model,
        family: e.family || normalizeModelFamily(e.model),
        conclusion: e.conclusion,
        role: e.role,
      }));
      const dualEndorsed =
        reviewers.length >= 2 &&
        reviewers.every((r) => isApprovedConclusion(r.conclusion));

      return {
        id: reviewers[0]?.id || '',
        reviewerModel: reviewers[0]?.reviewerModel || '',
        isDowngraded: false,
        downgradeReason: '',
        reviewers,
        dualEndorsed,
        challenges: token.challenges || [],
        tokenDigest: token.digest || '',
        commitmentFingerprint: token.commitmentFingerprint || '',
        fromToken: true,
      };
    }
  }

  return parseReviewMetadata(text);
}

// ── CLI：签署背书凭证（台账的唯一写入入口） ─────────────────────────────
const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,}$/;
// 与 touch-set.mjs 的 externalReviewId 同口径：占位符不算有效会话。
const SESSION_PLACEHOLDERS = /^(todo|xxx|tbd|placeholder|session|subagent|id)$/i;

function parseSignArgs(argv) {
  const opts = { challenges: [], unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--json') { opts.json = true; continue; }
    if (key === '--no-shard') { opts.noShard = true; continue; }
    const value = argv[i + 1];
    switch (key) {
      case '--doc': opts.doc = value; i += 1; break;
      case '--commitment': opts.commitment = value; i += 1; break;
      case '--session': opts.session = value; i += 1; break;
      case '--model': opts.model = value; i += 1; break;
      case '--conclusion': opts.conclusion = value; i += 1; break;
      case '--role': opts.role = value; i += 1; break;
      case '--challenge': opts.challenges.push(value); i += 1; break;
      case '--root': opts.root = value; i += 1; break;
      default: opts.unknown.push(key);
    }
  }
  return opts;
}

function signCommand(argv) {
  if (argv[0] !== 'sign') {
    console.error('用法：endorsement-protocol.mjs sign --doc <相对路径> --commitment <承诺指纹> --session <会话或子代理 id> --model <模型名> --conclusion <approved|rejected> [--role <角色>] [--challenge <JSON>]... [--root <仓库根>] [--no-shard] [--json]');
    return 2;
  }
  const opts = parseSignArgs(argv.slice(1));
  const problems = [];
  const doc = String(opts.doc || '').trim();
  if (!doc) problems.push('缺少目标文档路径：--doc <相对路径>');
  const commitment = String(opts.commitment || '').trim();
  if (commitment.length < 6) problems.push(`承诺指纹 (--commitment) 至少 6 个字符，实得「${commitment}」`);
  const session = String(opts.session || '').trim();
  if (!session) problems.push('缺少会话或子代理标识：--session <id>');
  else if (!SESSION_PATTERN.test(session) || SESSION_PLACEHOLDERS.test(session)) {
    problems.push(`会话标识非法：「${session}」——须匹配 ${SESSION_PATTERN.source} 且不是占位符`);
  }
  const model = String(opts.model || '').trim();
  if (!model) problems.push('缺少背书模型标识：--model <模型名>');
  const conclusion = String(opts.conclusion || '').trim();
  if (!VERDICT_STATUSES.includes(conclusion)) {
    problems.push(`结论非法：「${conclusion}」——必须为 ${VERDICT_STATUSES.join(' / ')}`);
  }
  const challenges = [];
  for (const [idx, raw] of opts.challenges.entries()) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      problems.push(`--challenge[${idx}] 不是合法 JSON`);
      continue;
    }
    const v = validateChallengeVector(parsed);
    if (!v.ok) problems.push(`--challenge[${idx}] 校验失败：${v.problems.join('；')}`);
    else challenges.push(parsed);
  }
  for (const key of opts.unknown) problems.push(`未知参数：${key}`);
  if (problems.length) {
    for (const p of problems) console.error(p);
    return 2;
  }
  const token = buildEndorsementToken({
    doc,
    commitmentFingerprint: commitment,
    challenges,
    endorsements: [{
      role: String(opts.role || '').trim(),
      model,
      sessionId: session,
      conclusion,
    }],
  });
  const root = opts.root ? path.resolve(opts.root) : process.cwd();
  try {
    const file = writeEndorsementToken(root, token, { shard: !opts.noShard });
    if (opts.json) console.log(JSON.stringify({ file, digest: token.digest }));
    else console.log(`已签署：${token.doc}（会话 ${session} / 模型 ${model} / 结论 ${conclusion}）→ ${file}`);
    return 0;
  } catch (err) {
    console.error(`签署失败：${err.message}`);
    return 1;
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('endorsement-protocol.mjs');
if (isMain) process.exit(signCommand(process.argv.slice(2)));
