import { spawnSync } from 'node:child_process';
import { EVOLUTION_COMMAND_FLAGS, flag } from '../cli/args.mjs';
import {
  resolveRuntimeRoot,
  resolveRuntimeScript,
  KIT_ROOT,
  RUNTIME_ROOT,
} from './runtime.mjs';

const WRAPPER_VALUE_FLAGS = new Set(['--target', '--root', '--lang']);

function adaptEvolutionArgs(rawArgv, { stripBoolean = [], renameValues = {} } = {}) {
  const stripSet = new Set(['--json', '--strict', ...stripBoolean.map((f) => `--${f}`)]);
  const src = Array.isArray(rawArgv) ? rawArgv : [];
  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    const token = src[i];
    const eq = token.indexOf('=');
    const flagKey = eq >= 0 ? token.slice(0, eq) : token;
    if (stripSet.has(flagKey)) continue;
    if (WRAPPER_VALUE_FLAGS.has(flagKey)) {
      if (eq < 0 && i + 1 < src.length && !src[i + 1].startsWith('--')) i += 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(renameValues, flagKey)) {
      const targetFlag = renameValues[flagKey];
      if (eq >= 0) {
        out.push(`${targetFlag}=${token.slice(eq + 1)}`);
      } else {
        out.push(targetFlag);
        if (i + 1 < src.length && !src[i + 1].startsWith('--')) out.push(src[++i]);
      }
      continue;
    }
    out.push(token);
  }
  return out;
}

function runRuntimeScript(scriptName, { args, scriptArgs, capture = false }) {
  const root = resolveRuntimeRoot({ root: args.root || args.target });
  const scriptFile = resolveRuntimeScript(scriptName);
  const forwarded = [...scriptArgs];
  if (flag(args, 'json') && !forwarded.includes('--json')) forwarded.push('--json');

  const env = {
    ...process.env,
    FLOW_KIT_PROJECT_ROOT: root,
    FLOW_KIT_RUNTIME_ROOT: RUNTIME_ROOT,
    FLOW_KIT_CLI_ROOT: KIT_ROOT,
  };

  return spawnSync(process.execPath, [scriptFile, ...forwarded], {
    cwd: root,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: capture ? 'utf8' : undefined,
    env,
  });
}

function forwardToScript(scriptName, { args, scriptArgs, helpText }) {
  if (args._[1] === 'help' || flag(args, 'help') || flag(args, 'h')) {
    console.log(helpText.trim());
    return 0;
  }
  const run = runRuntimeScript(scriptName, { args, scriptArgs });
  return run.status ?? 1;
}

export function timelineCommand({ args, rawArgv = process.argv.slice(3) }) {
  const helpText = `
用法：flow-kit timeline [--run <id>] [--export-html <path>] [--list] [--step <idx>] [--stage <name>] [--json]

参数：
  --run <id>          指定流水线运行 ID
  --list              查询规范时序事件流或列出所有运行记录
  --export-html <out> 导出自包含离线单页 HTML 复盘包
  --step <idx>        时间旅行关键帧快照重放
  --stage <name>      按阶段过滤事件流
  --json              输出 JSON 格式
`;
  const cleaned = adaptEvolutionArgs(rawArgv, { stripBoolean: EVOLUTION_COMMAND_FLAGS.timeline });
  const knownSubs = new Set(['append', 'query', 'export', 'replay', 'list', 'help']);
  if (!knownSubs.has(cleaned[0])) {
    if (args['export-html'] != null) cleaned.unshift('export');
    else if (args.step != null) cleaned.unshift('replay');
    else if (flag(args, 'list')) {
      if (args.run != null) cleaned.unshift('query');
      else cleaned.unshift('list');
    } else if (args.run != null) {
      cleaned.unshift('query');
    }
  }
  return forwardToScript('timeline-trace', { args, scriptArgs: cleaned, helpText });
}

export function shadowRunCommand({ args, rawArgv = process.argv.slice(3), t }) {
  const helpText = `
用法：flow-kit shadow-run [--task <desc>] [--max-steps <n>] [--timeout <ms>] [--stages <s1,s2>] [--clean] [--status] [--json]

参数：
  --task <desc>       指定影子沙箱执行的目标任务
  --max-steps <n>     硬性步数预算上限（默认 50）
  --timeout <ms>      最大墙钟耗时熔断（毫秒）
  --stages <s1,s2>    流水线执行阶段列表（默认 plan,implement,verify）
  --clean             清理/重置影子沙箱目录
  --status            查询残留或活跃影子沙箱状态
  --json              输出 JSON 格式
`;
  if (args._[1] === 'help' || flag(args, 'help') || flag(args, 'h')) {
    console.log(helpText.trim());
    return 0;
  }
  if (flag(args, 'clean') && !args.task && args['max-steps'] == null && args.timeout == null && args._[1] !== 'shadow') {
    const res = runRuntimeScript('headless-driver', { args, scriptArgs: ['clean'], capture: true });
    let cleaned = 0;
    try {
      cleaned = JSON.parse(res.stdout || '{}').cleaned || 0;
    } catch { /* fallback 0 */ }
    if (flag(args, 'json')) console.log(JSON.stringify({ ok: true, cleaned }, null, 2));
    else console.log(t('shadowRun.cleaned', { count: cleaned }));
    return res.status ?? 0;
  }
  const cleaned = adaptEvolutionArgs(rawArgv, {
    stripBoolean: EVOLUTION_COMMAND_FLAGS['shadow-run'],
    renameValues: { '--timeout': '--timeout-ms' },
  });
  const knownSubs = new Set(['shadow', 'clean', 'status', 'help']);
  if (!knownSubs.has(cleaned[0])) {
    if (flag(args, 'status') || args._[1] === 'status') cleaned.unshift('status');
    else cleaned.unshift('shadow');
  }
  return forwardToScript('headless-driver', { args, scriptArgs: cleaned, helpText });
}

export function evalCommand({ args, rawArgv = process.argv.slice(3) }) {
  const helpText = `
用法：flow-kit eval [--benchmark] [--rubric] [--threshold <0..1>] [--model <name>] [--fixture <id>] [--category <cat>] [--record] [--report <path>] [--json]

参数：
  --benchmark         执行标准研发任务基准套件
  --rubric            计算 5 维效能评分卡并生成雷达图
  --threshold <n>     准入分数阈值（默认 0.8）
  --model <name>      指定被测智能体模型标识
  --fixture <id>      指定单项基准评测任务
  --category <cat>    按分类筛选评测用例（repair/refactor/security/governance/resilience）
  --record            将评测通过凭证自动登记至 agent-eval 门禁
  --report <path>     导出 Markdown 格式评测复盘报告
  --json              输出 JSON 格式
`;
  const cleaned = adaptEvolutionArgs(rawArgv, { stripBoolean: ['benchmark'] });
  const knownSubs = new Set(['run', 'list']);
  if (!knownSubs.has(cleaned[0])) cleaned.unshift('run');
  return forwardToScript('agent-evaluator', { args, scriptArgs: cleaned, helpText });
}

export function optimizeSkillCommand({ args, rawArgv = process.argv.slice(3) }) {
  const helpText = `
用法：flow-kit optimize-skill [--skill <name>] [--extract] [--arbitrate] [--apply] [--rollback] [--min-delta <0..1>] [--json]

参数：
  --skill <name>      目标技能名称
  --extract           从历史处方提取缺陷模式与优化建议
  --arbitrate         在影子沙箱执行 A/B 双臂对抗裁决
  --apply             零回归安全应用胜出版本
  --rollback          一键回滚最近一次技能优化
  --min-delta <n>     胜出所需的最小通过率提升门槛（默认 0.10）
  --json              输出 JSON 格式
`;
  const cleaned = adaptEvolutionArgs(rawArgv, { stripBoolean: ['extract', 'arbitrate', 'rollback'] });
  const knownSubs = new Set(['extract', 'optimize', 'rollback', 'help']);
  if (!knownSubs.has(cleaned[0])) {
    if (args._[1] === 'rollback' || flag(args, 'rollback')) cleaned.unshift('rollback');
    else if (flag(args, 'extract')) cleaned.unshift('extract');
    else if (cleaned.length > 0 || flag(args, 'arbitrate') || flag(args, 'json')) cleaned.unshift('optimize');
  }
  return forwardToScript('skill-optimizer', { args, scriptArgs: cleaned, helpText });
}
