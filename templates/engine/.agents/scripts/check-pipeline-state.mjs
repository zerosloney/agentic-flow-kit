#!/usr/bin/env node
// check-pipeline-state.mjs — pipeline-run 状态机闭包检查（静态，零依赖）
//
// 背景（Anthropic《The AI-native SDLC playbook》Stage 6）：闭环执行器的可信度
// 来自“状态转移是闭集”。pipeline-run 自述“保留待用、零 run”，在第一次真实 run 之前，
// 至少要有机器检查保证：脚本里出现的 stage / stopType 都在登记表内，登记表里的 stage
// 也都在脚本里可达。
//
// 这是静态合同检查，不替代一次端到端 run；它拦住“新增/改名 stage 忘了登记”的低级漂移。
//
// 用法：
//   flow-kit run check-pipeline-state.mjs [--json] [--file <path>]
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_FILE = process.env.FLOW_KIT_RUNTIME_SCRIPTS
  ? path.join(process.env.FLOW_KIT_RUNTIME_SCRIPTS, 'pipeline-run.mjs')
  : '.agents/scripts/pipeline-run.mjs';
const DEFAULT_CFG = '.agents/config/pipeline.json';

export function analyze(source, config) {
  const problems = [];
  const stages = new Set(config.stages || []);
  const stopTypes = new Set(config.stopTypes || []);

  const stageLiterals = [...String(source).matchAll(/(?:run\.stage\s*=\s*|stage:\s*)'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]);
  const stopLiterals = [...String(source).matchAll(/(?:run\.stopType\s*=\s*|stopType:\s*)'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]);
  const handled = [...String(source).matchAll(/(?:\bs\s*===\s*)'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]);

  const seenStages = new Set([...stageLiterals, ...handled]);
  for (const s of seenStages) if (!stages.has(s) && s !== 'cur' && s !== 'past' && s !== 'string') {
    problems.push(`stage 未登记：'${s}'（补 .agents/config/pipeline.json 的 stages）`);
  }
  for (const s of stages) {
    if (!seenStages.has(s)) problems.push(`登记的 stage 在 pipeline-run 中不可达：'${s}'`);
  }
  for (const s of new Set(stopLiterals)) {
    if (!stopTypes.has(s)) problems.push(`stopType 未登记：'${s}'（补 stopTypes）`);
  }
  for (const s of stopTypes) {
    if (!stopLiterals.includes(s)) problems.push(`登记的 stopType 在脚本中未出现：'${s}'`);
  }
  if (!seenStages.has('triage')) problems.push("初始 stage 'triage' 未出现");

  // 失败路由表（R6-1）：onFail 的键与目标都必须是闭集内且脚本可达的阶段，否则是死配置或悬空退回。
  // 一条失败边都不声明同样不合法：门失败将原地停机，模板契约至少要留 verify 退回边。
  const onFail = config.onFail && typeof config.onFail === 'object' ? config.onFail : {};
  if (Object.keys(onFail).length === 0) {
    problems.push('onFail 未声明任何失败路由：门失败将原地停机（模板契约至少声明 verify 退回边）');
  }
  for (const [stage, edge] of Object.entries(onFail)) {
    if (!stages.has(stage)) problems.push(`onFail 键未登记：'${stage}'（补 stages）`);
    else if (!handled.includes(stage)) problems.push(`onFail 声明的阶段在 pipeline-run 中不可达：'${stage}'`);
    if (stage === 'done') problems.push("onFail 不得声明终态 'done'");
    const to = edge?.to;
    if (typeof to !== 'string' || !stages.has(to)) problems.push(`onFail['${stage}'].to 未登记：'${to}'`);
    else if (!seenStages.has(to)) problems.push(`onFail['${stage}'].to 在 pipeline-run 中不可达：'${to}'`);
    if (to === 'done') problems.push(`onFail['${stage}'] 不得路由到终态 'done'`);
    const r = edge?.retry;
    if (!Number.isInteger(r) || r < 0 || r > 5) problems.push(`onFail['${stage}'].retry 须为 0-5 整数（当前 ${JSON.stringify(r)}）`);
  }

  return {
    ok: problems.length === 0,
    problems,
    counts: { stages: stageLiterals.length, handled: handled.length, stopTypes: stopLiterals.length, onFail: Object.keys(onFail).length },
  };
}

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function main() {
  const argv = process.argv.slice(2);
  const root = path.resolve(argOf(argv, 'root', process.env.FLOW_KIT_PROJECT_ROOT || process.cwd()));
  const file = path.resolve(root, argOf(argv, 'file', DEFAULT_FILE));
  const cfgFile = path.resolve(root, argOf(argv, 'config', DEFAULT_CFG));
  if (!fs.existsSync(file)) {
    console.error(`✗ 找不到 ${path.relative(root, file)}`);
    return 2;
  }
  if (!fs.existsSync(cfgFile)) {
    console.error(`✗ 找不到 ${path.relative(root, cfgFile)}`);
    return 2;
  }
  const res = analyze(fs.readFileSync(file, 'utf8'), JSON.parse(fs.readFileSync(cfgFile, 'utf8')));
  if (argv.includes('--json')) {
    console.log(JSON.stringify(res, null, 2));
    return res.ok ? 0 : 1;
  }
  if (!res.ok) {
    console.error('✗ pipeline 状态机闭包检查失败：');
    for (const p of res.problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log(`✅ pipeline 状态机闭包（stages=${res.counts.stages} handled=${res.counts.handled} stopTypes=${res.counts.stopTypes}）`);
  return 0;
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-pipeline-state.mjs');
if (isMain) process.exit(main());
