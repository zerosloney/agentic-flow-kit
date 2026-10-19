#!/usr/bin/env node
// trust-mode: AI 自治信任等级管理（2026-09-30 ai-autonomy-trust；同日 hybrid-governance-risk-lanes 加名称双轨）
// 管理 .agents/trust-mode.json，授权 AI 对 L1 文档进行自治放行（--auto）。
// 等级语义（名称 ↔ 数值双轨：confirm-doc.mjs 读数值 enabled/level，人机接口名称与数值皆收）：
//   Strict   (level 0, enabled=false): AI 自治关闭（默认）——confirm-doc --auto 一律拒绝
//   Standard (level 1): AI 可自批 L1 draft -> approved
//   Trusted  (level 2): AI 可自批 L1 draft -> approved 及 approved -> done（全闭环）
// 安全默认值：未开启（enabled: false）时，confirm-doc.mjs --auto 一律拒绝。
// TTL（2026-10-19 补漏）：--enable 可带 --ttl <dur>（如 8h / 30m / 2d / 裸数字=小时）写 expiresAt。
//   此前 enabledAt 只记录不消费——授权一旦开启就永久有效，直到有人记得 --disable；「临时开一下」
//   事实上变成「永久开」。expiresAt 过期后消费方（confirm-doc）按 Strict 拒绝，须显式重开。
//   缺 expiresAt = 不过期（存量装户零影响）；--disable / --level 0 一律清空 expiresAt。
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.join(process.cwd(), '.agents', 'trust-mode.json');
const NAME_BY_LEVEL = { 0: 'Strict', 1: 'Standard', 2: 'Trusted' };
const LEVEL_BY_NAME = { Strict: 0, Standard: 1, Trusted: 2 };

// 时长 → 毫秒。支持 30m / 8h / 2d / 裸数字（小时）。返回 NaN 表示非法——调用方 fail-loud，
// 不接受「看不懂就当不过期」（静默放过期比报错危险）。
function parseTtlMs(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d)?$/i.exec(s);
  if (!m) return NaN;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  const unit = (m[2] || 'h').toLowerCase();
  const mult = unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return Math.round(n * mult);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { enabled: false, level: 0, name: 'Strict', enabledAt: null };
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function main() {
  const args = process.argv.slice(2);
  const config = readConfig();

  if (args.includes('--enable')) {
    const levelIdx = args.indexOf('--level');
    const raw = levelIdx !== -1 ? String(args[levelIdx + 1] ?? '') : '1';
    const level = LEVEL_BY_NAME[raw] ?? (['0', '1', '2'].includes(raw) ? Number(raw) : NaN);
    if (![0, 1, 2].includes(level)) {
      console.error('❌ --level 必须为 Strict|Standard|Trusted（或 0|1|2）');
      process.exit(1);
    }
    const ttlIdx = args.indexOf('--ttl');
    if (ttlIdx !== -1 && level === 0) {
      console.error('❌ --ttl 只对 Level 1/2 有意义（Level 0 = 关闭，无授权可过期）');
      process.exit(1);
    }
    let expiresAt = null;
    if (ttlIdx !== -1) {
      const ms = parseTtlMs(args[ttlIdx + 1]);
      if (!Number.isFinite(ms)) {
        console.error(`❌ --ttl 时长非法：「${args[ttlIdx + 1] ?? ''}」——支持 30m / 8h / 2d / 裸数字（小时）`);
        process.exit(1);
      }
      expiresAt = new Date(Date.now() + ms).toISOString();
    }
    if (level === 0) {
      writeConfig({ enabled: false, level: 0, name: 'Strict', enabledAt: null, expiresAt: null });
      console.log('🔒 AI 自治模式已关闭（Strict）');
      return;
    }
    writeConfig({ enabled: true, level, name: NAME_BY_LEVEL[level], enabledAt: new Date().toISOString(), expiresAt });
    console.log(`✅ AI 自治模式已开启 (${NAME_BY_LEVEL[level]} / Level ${level})`);
    console.log(level === 1 ? '   授权范围：L1 文档 draft -> approved' : '   授权范围：L1 文档全闭环 (approved + done)');
    if (expiresAt) console.log(`   有效期至 ${expiresAt}（到期自动回落 Strict，须显式重开）`);
    return;
  }

  if (args.includes('--disable')) {
    writeConfig({ enabled: false, level: 0, name: 'Strict', enabledAt: null, expiresAt: null });
    console.log('🔒 AI 自治模式已关闭 (Strict)');
    return;
  }

  if (args.includes('--status')) {
    const out = { name: NAME_BY_LEVEL[config.level] || 'Strict', ...config };
    // 过期态显式化：--status 是「现在到底生不生效」的唯一人机入口，只吐 enabled:true 会骗人
    if (config.enabled && config.expiresAt) {
      const left = Date.parse(config.expiresAt) - Date.now();
      out.expired = left <= 0;
      out.expiresInMs = left;
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log('用法: node .agents/scripts/trust-mode.mjs [--enable --level <Strict|Standard|Trusted|1|2> [--ttl <30m|8h|2d>] | --disable | --status]');
  process.exit(config.enabled ? 0 : 1);
}

main();
