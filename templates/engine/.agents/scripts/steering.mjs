#!/usr/bin/env node
// steering.mjs — 按模型档解析“严格度”（不变量不变，只调表达方式）
//
// 用法：
//   flow-kit run steering.mjs resolve --model opus [--json]
//   flow-kit run steering.mjs show
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT = {
  version: 1,
  defaultTier: 'standard',
  tiers: {
    frontier: { scaffolding: 'goal', judgmentLatitude: 'high', guidance: '' },
    standard: { scaffolding: 'mixed', judgmentLatitude: 'medium', guidance: '' },
    lean: { scaffolding: 'step', judgmentLatitude: 'low', guidance: '' },
  },
  invariants: [],
};

// 只做“已知别名 → 档位”的保守映射；未知模型落到 default，不猜能力。
const FRONTIER = /(^|[-/])(opus|fable|o3|o4|deepseek-r|deepseek-v4)([-/.]|$)/i;
const LEAN = /(^|[-/])(haiku|mini|flash|small|nano)([-/.]|$)/i;

export function loadConfig(root) {
  try {
    return { ...DEFAULT, ...JSON.parse(fs.readFileSync(path.join(root, '.agents', 'config', 'steering.json'), 'utf8')) };
  } catch {
    return DEFAULT;
  }
}

export function tierFor(model, cfg = DEFAULT) {
  const id = String(model || '').toLowerCase();
  if (!id) return cfg.defaultTier;
  if (FRONTIER.test(id)) return 'frontier';
  if (LEAN.test(id)) return 'lean';
  return cfg.defaultTier;
}

export function resolveSteering(root, model) {
  const cfg = loadConfig(root);
  const tier = tierFor(model, cfg);
  return { model: String(model || ''), tier, ...(cfg.tiers[tier] || {}), invariants: cfg.invariants || [] };
}

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function main() {
  const argv = process.argv.slice(2);
  const root = path.resolve(argOf(argv, 'root', process.cwd()));
  const cmd = argv[0] || 'show';
  if (cmd === 'resolve') {
    const res = resolveSteering(root, argOf(argv, 'model', ''));
    if (argv.includes('--json')) console.log(JSON.stringify(res, null, 2));
    else console.log(`${res.model || '(default)'} -> ${res.tier} · scaffolding=${res.scaffolding} · judgment=${res.judgmentLatitude}\n${res.guidance}`);
    return 0;
  }
  const cfg = loadConfig(root);
  if (argv.includes('--json')) console.log(JSON.stringify(cfg, null, 2));
  else {
    console.log(`defaultTier=${cfg.defaultTier}`);
    for (const [name, t] of Object.entries(cfg.tiers)) console.log(`- ${name}: scaffolding=${t.scaffolding} judgment=${t.judgmentLatitude}`);
    console.log(`invariants: ${(cfg.invariants || []).join(' / ') || '—'}`);
  }
  return 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('steering.mjs');
if (isMain) process.exit(main());
