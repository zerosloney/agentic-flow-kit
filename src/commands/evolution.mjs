import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { flag } from '../cli/args.mjs';
import {
  resolveRuntimeRoot,
  resolveRuntimeScript,
  KIT_ROOT,
  RUNTIME_ROOT,
} from './runtime.mjs';

// 包装层帮助里的旗标，和脚本自己的位置子命令不是同一套。
// 这里把帮助承诺的旗标译成脚本 argv。脚本已经认识的位置子命令原样通过。
function pullFlag(args, name, { valued = false } = {}) {
  const out = [];
  let found = false;
  let value;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== name) {
      out.push(args[i]);
      continue;
    }
    found = true;
    if (!valued) continue;
    const next = args[i + 1];
    if (next == null || next.startsWith('--')) return { error: `${name} 缺少数值` };
    value = next;
    i += 1;
  }
  return { args: out, found, value };
}

function passthrough(argv) {
  return argv.length > 0 && !argv[0].startsWith('--');
}

export function translateTimelineArgs(argv) {
  if (passthrough(argv)) return { argv };
  let rest = argv;
  const run = pullFlag(rest, '--run', { valued: true });
  if (run.error) return run;
  rest = run.args;
  const stage = pullFlag(rest, '--stage', { valued: true });
  if (stage.error) return stage;
  rest = stage.args;
  const list = pullFlag(rest, '--list');
  if (list.error) return list;
  rest = list.args;
  const html = pullFlag(rest, '--export-html');
  if (html.error) return html;
  rest = html.args;
  const step = pullFlag(rest, '--step', { valued: true });
  if (step.error) return step;
  rest = step.args;
  if (step.found) return { error: '--step 没有对应的脚本命令' };
  if (!list.found && !html.found && !run.found && rest.length === 0) return { help: true };
  if (list.found && html.found) return { error: '--list 与 --export-html 只能选一个' };
  if (rest.length) return { error: `未知参数: ${rest.join(' ')}` };
  const out = [html.found ? 'export' : 'query'];
  if (run.found) out.push('--run', run.value);
  if (stage.found) out.push('--stage', stage.value);
  return { argv: out };
}

export function translateShadowArgs(argv) {
  if (passthrough(argv)) return { argv };
  let rest = argv;
  const task = pullFlag(rest, '--task', { valued: true });
  if (task.error) return task;
  rest = task.args;
  const steps = pullFlag(rest, '--max-steps', { valued: true });
  if (steps.error) return steps;
  rest = steps.args;
  const timeout = pullFlag(rest, '--timeout', { valued: true });
  if (timeout.error) return timeout;
  rest = timeout.args;
  const clean = pullFlag(rest, '--clean');
  if (clean.error) return clean;
  rest = clean.args;
  const keep = pullFlag(rest, '--keep');
  if (keep.error) return keep;
  rest = keep.args;
  if (!task.found && !steps.found && !timeout.found && !clean.found && !keep.found && rest.length === 0) return { help: true };
  if (clean.found && keep.found) return { error: '--clean 与 --keep 不能同时使用' };
  if (rest.length) return { error: `未知参数: ${rest.join(' ')}` };
  const out = ['shadow'];
  if (task.found) out.push('--task', task.value);
  if (steps.found) out.push('--max-steps', steps.value);
  if (timeout.found) out.push('--timeout-ms', timeout.value);
  if (keep.found) out.push('--keep');
  return { argv: out };
}

export function translateEvalArgs(argv) {
  if (passthrough(argv)) return { argv };
  let rest = argv;
  const benchmark = pullFlag(rest, '--benchmark');
  if (benchmark.error) return benchmark;
  rest = benchmark.args;
  const rubric = pullFlag(rest, '--rubric');
  if (rubric.error) return rubric;
  rest = rubric.args;
  const threshold = pullFlag(rest, '--threshold', { valued: true });
  if (threshold.error) return threshold;
  rest = threshold.args;
  const fixture = pullFlag(rest, '--fixture', { valued: true });
  if (fixture.error) return fixture;
  rest = fixture.args;
  const model = pullFlag(rest, '--model', { valued: true });
  if (model.error) return model;
  rest = model.args;
  const runner = pullFlag(rest, '--runner', { valued: true });
  if (runner.error) return runner;
  rest = runner.args;
  const report = pullFlag(rest, '--report', { valued: true });
  if (report.error) return report;
  rest = report.args;
  const record = pullFlag(rest, '--record');
  if (record.error) return record;
  rest = record.args;
  const any = benchmark.found || rubric.found || threshold.found || fixture.found || model.found || runner.found || report.found || record.found;
  if (!any && rest.length === 0) return { help: true };
  if (rest.length) return { error: `未知参数: ${rest.join(' ')}` };
  const out = ['run'];
  if (threshold.found) out.push('--threshold', threshold.value);
  if (fixture.found) out.push('--fixture', fixture.value);
  if (model.found) out.push('--model', model.value);
  if (runner.found) out.push('--runner', runner.value);
  if (report.found) out.push('--report', report.value);
  if (record.found) out.push('--record');
  return { argv: out };
}

export function translateOptimizeArgs(argv) {
  if (passthrough(argv)) return { argv };
  let rest = argv;
  const extract = pullFlag(rest, '--extract');
  if (extract.error) return extract;
  rest = extract.args;
  const arbitrate = pullFlag(rest, '--arbitrate');
  if (arbitrate.error) return arbitrate;
  rest = arbitrate.args;
  const apply = pullFlag(rest, '--apply');
  if (apply.error) return apply;
  rest = apply.args;
  const skill = pullFlag(rest, '--skill', { valued: true });
  if (skill.error) return skill;
  rest = skill.args;
  const dry = pullFlag(rest, '--dry-run');
  if (dry.error) return dry;
  rest = dry.args;
  const delta = pullFlag(rest, '--min-delta', { valued: true });
  if (delta.error) return delta;
  rest = delta.args;
  if (extract.found && (arbitrate.found || apply.found)) return { error: '--extract 不能与 --arbitrate / --apply 同时使用' };
  const any = extract.found || arbitrate.found || apply.found || skill.found || dry.found || delta.found;
  if (!any && rest.length === 0) return { help: true };
  if (!extract.found && !arbitrate.found && !apply.found) return { error: '需要 --extract、--arbitrate 或 --apply' };
  if (rest.length) return { error: `未知参数: ${rest.join(' ')}` };
  const out = [extract.found ? 'extract' : 'optimize'];
  if (skill.found) out.push('--skill', skill.value);
  if (apply.found) out.push('--apply');
  if (dry.found) out.push('--dry-run');
  if (delta.found) out.push('--min-delta', delta.value);
  return { argv: out };
}

function stripConsumed(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' || argv[i] === '--target') {
      i += 1;
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}

function forwardToScript(scriptName, { args, helpText, translate }) {
  if (args._[1] === 'help' || flag(args, 'help') || flag(args, 'h')) {
    console.log(helpText.trim());
    return 0;
  }
  const root = resolveRuntimeRoot({ root: args.root || args.target });
  const scriptFile = resolveRuntimeScript(scriptName);

  // 从 args 中剔除第一位子命令名（自身名字）。--root / --target 已用于定位仓库，不传给脚本。
  const rawArgv = stripConsumed(process.argv.slice(3).filter((a) => a !== '--json' && a !== '--strict'));
  let filtered = rawArgv;
  if (translate) {
    const translated = translate(rawArgv);
    if (translated.error) {
      console.error(translated.error);
      console.log(helpText.trim());
      return 2;
    }
    if (translated.help) {
      console.log(helpText.trim());
      return 0;
    }
    filtered = translated.argv;
  }
  if (flag(args, 'json')) filtered.push('--json');

  const env = {
    ...process.env,
    FLOW_KIT_PROJECT_ROOT: root,
    FLOW_KIT_RUNTIME_ROOT: RUNTIME_ROOT,
    FLOW_KIT_CLI_ROOT: KIT_ROOT,
  };

  const run = spawnSync(process.execPath, [scriptFile, ...filtered], {
    cwd: root,
    stdio: 'inherit',
    env,
  });

  return run.status ?? 1;
}

export function timelineCommand({ args, t, lang }) {
  const helpText = `
用法：flow-kit timeline [--run <id>] [--list] [--stage <name>] [--json]
      flow-kit timeline export --run <id> [--stage <name>] [--json]

参数：
  --run <id>          指定流水线运行 ID
  --list              查询规范时序事件流（须与 --run 同用；缺 --run 会退出并提示）
  --json              输出 JSON 格式

export 子命令：flow-kit timeline export --run <id> 导出自包含离线单页 HTML 复盘包（文件按 runId 命名）
`;
  return forwardToScript('timeline-trace', { args, helpText, translate: translateTimelineArgs });
}

export function shadowRunCommand({ args, t, lang }) {
  const helpText = `
用法：flow-kit shadow-run [--task <desc>] [--max-steps <n>] [--timeout <ms>] [--clean] [--json]

参数：
  --task <desc>       指定影子沙箱执行的目标任务
  --max-steps <n>     硬性步数预算上限（默认 50）
  --timeout <ms>      最大墙钟耗时熔断（毫秒）
  --clean             清理/重置影子沙箱目录
  --json              输出 JSON 格式
`;
  return forwardToScript('headless-driver', { args, helpText, translate: translateShadowArgs });
}

export function evalCommand({ args, t, lang }) {
  const helpText = `
用法：flow-kit eval [--benchmark] [--rubric] [--threshold <0..1>] [--json]

参数：
  --benchmark         执行标准研发任务基准套件
  --rubric            计算 5 维效能评分卡并生成雷达图
  --threshold <n>     准入分数阈值（默认 0.8）
  --json              输出 JSON 格式
`;
  return forwardToScript('agent-evaluator', { args, helpText, translate: translateEvalArgs });
}

export function optimizeSkillCommand({ args, t, lang }) {
  const helpText = `
用法：flow-kit optimize-skill [--skill <name>] [--extract] [--arbitrate] [--apply] [--json]

参数：
  --skill <name>      目标技能名称
  --extract           从历史处方提取缺陷模式与优化建议
  --arbitrate         在影子沙箱执行 A/B 双臂对抗裁决
  --apply             零回归安全应用胜出版本
  --json              输出 JSON 格式
`;
  return forwardToScript('skill-optimizer', { args, helpText, translate: translateOptimizeArgs });
}
