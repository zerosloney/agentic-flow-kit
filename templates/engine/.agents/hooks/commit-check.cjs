#!/usr/bin/env node
// commit-check — Phase 5：条件构建 / 质量检查 / 推送前测试统一交给 rules 引擎执行
// （规则由 .agents/hooks/commit-check.config.json 投影，判据单源；对拍见 tests/commit-check.test.mjs）。
// 本脚本保留历史参数与输出格式（OK / SKIP / BLOCK 行），退出码语义不变：
//   0 通过（含跳过）；1 构建/检查/推送前测试失败；2 配置错误（rules 引擎 fail-closed）。
// 参数：--no-build（跳过构建段）；--full（不看 ext/prefix 裁剪，仍尊重 when）；
//       --range <old> <new>（推送范围模式，执行 pushTests；全零 old = 全量匹配语义）。
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

process.chdir(process.env.FLOW_KIT_PROJECT_ROOT || path.resolve(__dirname, '../..'));

const CONFIG = '.agents/hooks/commit-check.config.json';
const argv = process.argv.slice(2);
const NO_BUILD = argv.includes('--no-build');
const FULL = argv.includes('--full');
const ri = argv.indexOf('--range');
const RANGE = ri >= 0 ? argv.slice(ri + 1, ri + 3) : null;
if (RANGE && (RANGE.length < 2 || !/^[0-9a-f]{4,40}$/i.test(RANGE[0]) || !/^[0-9a-f]{4,40}$/i.test(RANGE[1]))) {
  console.log(`BLOCK: --range 参数须为两个 git sha（现「${(RANGE || []).join(' ')}」）`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
} catch (e) {
  if (e.code === 'ENOENT') {
    console.log('SKIP: 未配置 .agents/hooks/commit-check.config.json（builds/checks/pushTests 全跳过）');
    process.exit(0);
  }
  // 与历史行为一致：配置读不了/JSON 坏按未配置跳过（git 钩子与独立复核兜底）。
  console.log('SKIP: .agents/hooks/commit-check.config.json 解析失败——按未配置跳过');
  process.exit(0);
}

const cli = [process.env.FLOW_KIT_CLI, path.resolve(__dirname, '..', '..', '..', '..', 'bin', 'flow-kit.mjs')]
  .filter(Boolean)
  .find((p) => fs.existsSync(p));
if (!cli) {
  console.log('BLOCK: 找不到 flow-kit CLI（rules 引擎入口），无法执行 commit-check');
  process.exit(1);
}

const groupsCfg = {
  build: Array.isArray(config.builds) ? config.builds : [],
  check: Array.isArray(config.checks) ? config.checks : [],
  push: Array.isArray(config.pushTests) ? config.pushTests : [],
};
const KIND = { build: '构建', check: '质量检查', push: '推送前测试' };
const groups = [];
if (RANGE) {
  if (!NO_BUILD) groups.push('build');
  groups.push('check', 'push');
} else {
  if (!NO_BUILD) groups.push('build');
  groups.push('check');
}
if (NO_BUILD) console.log('SKIP: --no-build（构建门后移 pre-push——常规提交不再构建，推送时按范围执法）');

const ZERO_OLD = RANGE ? /^0{4,40}$/i.test(RANGE[0]) : false;
const args = [cli, 'rules', 'check', '--json', '--with-commands', '--prefix', groups.map((g) => `commit.${g}.`).join(',')];
if (RANGE && !ZERO_OLD) args.push('--range', `${RANGE[0]}..${RANGE[1]}`);
else if (!RANGE && !FULL) args.push('--staged');
if (RANGE && ZERO_OLD) args.push('--range-old', RANGE[0], '--range-new', RANGE[1]);

const r = spawnSync(process.execPath, args, {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 60 * 60 * 1000,
  maxBuffer: 32 * 1024 * 1024,
});
let data = null;
try {
  data = JSON.parse(r.stdout || '{}');
} catch { /* 下方按引擎失败处理 */ }
if (!data || (r.status !== 0 && !Array.isArray(data.violations))) {
  console.log(`BLOCK: rules 引擎执行失败（exit ${r.status}）\n${String(r.stderr || '').trim().slice(-1200)}`);
  process.exit(r.status === 2 ? 2 : 1);
}
const find = (list, id) => (list || []).find((x) => x.ruleId === id);

for (const group of groups) {
  const list = groupsCfg[group];
  let considered = 0;
  let matchedByFiles = 0;
  let printed = 0;
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (!entry || typeof entry.command !== 'string' || !entry.command) continue;
    considered += 1;
    const id = `commit.${group}.${i}`;
    const violation = find(data.violations, id);
    if (violation) {
      console.log(`BLOCK: ${entry.name || id} ${KIND[group]}未通过（${entry.command}）\n${String(violation.detail || '').slice(0, 1500)}`);
      process.exit(1);
    }
    const skipped = find(data.skipped, id);
    if (skipped && skipped.reason === 'files') {
      matchedByFiles += 1;
      continue;
    }
    if (skipped && skipped.reason === 'when') {
      const when = Array.isArray(skipped.when) ? skipped.when : [];
      // whenEnv 门槛（env: 谓词）不满足 = 配置意图，不执行也不打印（历史语义）。
      if (when.length && when.every((w) => String(w).startsWith('env:'))) continue;
      console.log(`SKIP: ${entry.name || id}（未找到 ${when.join(', ')}，跳过${KIND[group]}——配置好后自动启用）`);
      printed += 1;
      continue;
    }
    if (find(data.passed, id)) {
      console.log(`OK: ${entry.name || id} ${KIND[group]}通过（${entry.command}）`);
      printed += 1;
    }
  }
  if (considered > 0 && matchedByFiles === considered) {
    const text = group === 'build'
      ? 'SKIP: 无匹配的源码变更，跳过构建验证'
      : group === 'check' ? 'SKIP: 无匹配的源码变更，跳过质量检测' : 'SKIP: 无匹配的源码变更，跳过推送前测试';
    if (printed === 0) console.log(text);
  }
  if (group === 'build' && considered === 0) {
    console.log('SKIP: 未配置 builds（.agents/hooks/commit-check.config.json），跳过构建验证');
  }
}

process.exit(0);
