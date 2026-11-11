#!/usr/bin/env node
// trust-mode: AI 自治信任等级管理（2026-09-30 ai-autonomy-trust；同日 hybrid-governance-risk-lanes 加名称双轨）
// 管理 .agents/trust-mode.json，授权 AI 对 L1 文档进行自治放行（--auto）。
// 等级语义（名称 ↔ 数值双轨：confirm-doc.mjs 读数值 enabled/level，人机接口名称与数值皆收）：
//   Strict   (level 0, enabled=false): AI 自治关闭（默认）——confirm-doc --auto 一律拒绝
//   Standard (level 1): AI 可自批 L1 draft -> approved
//   Trusted  (level 2): AI 可自批 L1 draft -> approved 及 approved -> done（全闭环）
// 安全默认值：未开启（enabled: false）时，confirm-doc.mjs --auto 一律拒绝。
// 审计链（2026-10-09 P3-3）：升降级/开关写入本地追加式台账 .agents/trust-mode-audit.jsonl——
//   每行含前一行的 sha256（prev 链），--verify 校验链完整性。自治授权面的变化从此可追溯；
//   不进 .agents/confirmations.jsonl（该台账行协议钉死 workflow 四目录 doc 路径，见
//   check-ledger-invariant.mjs 行级 ④）。诚实边界：本地文件、非签名——删整份台账=审计面全失
//   （与 check-loop 检查 15 台账同类边界），篡改单行则链断可检。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const CONFIG_PATH = path.join(process.cwd(), '.agents', 'trust-mode.json');
const AUDIT_PATH = path.join(process.cwd(), '.agents', 'trust-mode-audit.jsonl');
const NAME_BY_LEVEL = { 0: 'Strict', 1: 'Standard', 2: 'Trusted' };
const LEVEL_BY_NAME = { Strict: 0, Standard: 1, Trusted: 2 };

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { enabled: false, level: 0, name: 'Strict', enabledAt: null };
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// 追加审计行：prev = 末行原文 sha256（链式），行自身完整性由后一行 prev 递归保证
// （末行无后继——末行被改只影响其内容与 config 现值的对质，属已知残留面，如实声明）
function appendAudit(action, from, to) {
  fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
  let prev = 'GENESIS';
  try {
    const lines = fs.readFileSync(AUDIT_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length) prev = sha256(lines[lines.length - 1]);
  } catch { /* 无台账 = GENESIS */ }
  const row = {
    ts: new Date().toISOString(),
    action,
    from: { enabled: !!from.enabled, level: from.level ?? 0, name: from.name || 'Strict' },
    to: { enabled: !!to.enabled, level: to.level ?? 0, name: to.name || 'Strict' },
    prev,
  };
  fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(row)}\n`);
}

function verifyAudit() {
  let lines;
  try {
    lines = fs.readFileSync(AUDIT_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    console.log('✅ 无审计台账（从未变更过信任等级）');
    process.exit(0);
  }
  let prev = 'GENESIS';
  const problems = [];
  lines.forEach((line, i) => {
    let e;
    try { e = JSON.parse(line); } catch { problems.push(`第 ${i + 1} 行：非 JSON`); return; }
    if (e.prev !== prev) problems.push(`第 ${i + 1} 行：prev 链断裂（期望 ${prev.slice(0, 12)}…，实际 ${String(e.prev).slice(0, 12)}…）——前一行或本行被篡改/插入`);
    if (typeof e.ts !== 'string' || Number.isNaN(Date.parse(e.ts))) problems.push(`第 ${i + 1} 行：ts 非 ISO`);
    prev = sha256(line);
  });
  if (problems.length) {
    console.error(`❌ 审计链校验失败（${problems.length} 处）：\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`✅ 审计链完整（${lines.length} 条变更记录，无篡改信号）`);
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  const config = readConfig();

  if (args.includes('--verify')) {
    verifyAudit();
    return;
  }

  if (args.includes('--enable')) {
    const levelIdx = args.indexOf('--level');
    const raw = levelIdx !== -1 ? String(args[levelIdx + 1] ?? '') : '1';
    const level = LEVEL_BY_NAME[raw] ?? (['0', '1', '2'].includes(raw) ? Number(raw) : NaN);
    if (![0, 1, 2].includes(level)) {
      console.error('❌ --level 必须为 Strict|Standard|Trusted（或 0|1|2）');
      process.exit(1);
    }
    if (level === 0) {
      writeConfig({ enabled: false, level: 0, name: 'Strict', enabledAt: null });
      appendAudit('disable', config, { enabled: false, level: 0, name: 'Strict' });
      console.log('🔒 AI 自治模式已关闭（Strict）');
      return;
    }
    const next = { enabled: true, level, name: NAME_BY_LEVEL[level], enabledAt: new Date().toISOString() };
    writeConfig(next);
    appendAudit('enable', config, next);
    console.log(`✅ AI 自治模式已开启 (${NAME_BY_LEVEL[level]} / Level ${level})`);
    console.log(level === 1 ? '   授权范围：L1 文档 draft -> approved' : '   授权范围：L1 文档全闭环 (approved + done)');
    console.log('   审计：本次变更已记入 .agents/trust-mode-audit.jsonl（--verify 校验链）');
    return;
  }

  if (args.includes('--disable')) {
    writeConfig({ enabled: false, level: 0, name: 'Strict', enabledAt: null });
    appendAudit('disable', config, { enabled: false, level: 0, name: 'Strict' });
    console.log('🔒 AI 自治模式已关闭 (Strict)');
    return;
  }

  if (args.includes('--status')) {
    console.log(JSON.stringify({ name: NAME_BY_LEVEL[config.level] || 'Strict', ...config }, null, 2));
    return;
  }

  console.log('用法: node .agents/scripts/trust-mode.mjs [--enable --level <Strict|Standard|Trusted|1|2> | --disable | --status | --verify]');
  process.exit(config.enabled ? 0 : 1);
}

main();
