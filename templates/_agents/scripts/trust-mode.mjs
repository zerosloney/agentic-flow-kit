#!/usr/bin/env node
// trust-mode: AI 自治信任等级管理（2026-09-30 ai-autonomy-trust；同日 hybrid-governance-risk-lanes 加名称双轨）
// 管理 .agents/trust-mode.json，授权 AI 对 L0/L1 文档进行自治放行（--auto）。
// 等级语义（名称 ↔ 数值双轨：confirm-doc.mjs 读数值 enabled/level，人机接口名称与数值皆收）：
//   Strict   (level 0, enabled=false): AI 自治关闭（默认）——confirm-doc --auto 一律拒绝
//   Standard (level 1): AI 可自批 L0/L1 draft -> approved
//   Trusted  (level 2): AI 可自批 L0/L1 draft -> approved 及 approved -> done（全闭环）
// 安全默认值：未开启（enabled: false）时，confirm-doc.mjs --auto 一律拒绝。
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.join(process.cwd(), '.agents', 'trust-mode.json');
const NAME_BY_LEVEL = { 0: 'Strict', 1: 'Standard', 2: 'Trusted' };
const LEVEL_BY_NAME = { Strict: 0, Standard: 1, Trusted: 2 };

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
    if (level === 0) {
      writeConfig({ enabled: false, level: 0, name: 'Strict', enabledAt: null });
      console.log('🔒 AI 自治模式已关闭（Strict）');
      return;
    }
    writeConfig({ enabled: true, level, name: NAME_BY_LEVEL[level], enabledAt: new Date().toISOString() });
    console.log(`✅ AI 自治模式已开启 (${NAME_BY_LEVEL[level]} / Level ${level})`);
    console.log(level === 1 ? '   授权范围：L0/L1 文档 draft -> approved' : '   授权范围：L0/L1 文档全闭环 (approved + done)');
    return;
  }

  if (args.includes('--disable')) {
    writeConfig({ enabled: false, level: 0, name: 'Strict', enabledAt: null });
    console.log('🔒 AI 自治模式已关闭 (Strict)');
    return;
  }

  if (args.includes('--status')) {
    console.log(JSON.stringify({ name: NAME_BY_LEVEL[config.level] || 'Strict', ...config }, null, 2));
    return;
  }

  console.log('用法: node .agents/scripts/trust-mode.mjs [--enable --level <Strict|Standard|Trusted|1|2> | --disable | --status]');
  process.exit(config.enabled ? 0 : 1);
}

main();
