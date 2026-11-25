import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { flag } from '../cli/args.mjs';
import {
  resolveRuntimeRoot,
  resolveRuntimeScript,
  KIT_ROOT,
  RUNTIME_ROOT,
} from './runtime.mjs';

function forwardToScript(scriptName, { args, helpText }) {
  if (args._[1] === 'help' || flag(args, 'help') || flag(args, 'h')) {
    console.log(helpText.trim());
    return 0;
  }
  const root = resolveRuntimeRoot({ root: args.root || args.target });
  const scriptFile = resolveRuntimeScript(scriptName);

  // 从 args 中剔除第一位子命令名（自身名字），其余参数原样透传
  const rawArgv = process.argv.slice(3);
  const filtered = rawArgv.filter((a) => a !== '--json' && a !== '--strict');
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
用法：flow-kit timeline [--run <id>] [--export-html <path>] [--list] [--step <idx>] [--json]

参数：
  --run <id>          指定流水线运行 ID
  --list              查询规范时序事件流
  --export-html <out> 导出自包含离线单页 HTML 复盘包
  --step <idx>        时间旅行关键帧快照重放
  --json              输出 JSON 格式
`;
  return forwardToScript('timeline-trace', { args, helpText });
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
  return forwardToScript('headless-driver', { args, helpText });
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
  return forwardToScript('agent-evaluator', { args, helpText });
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
  return forwardToScript('skill-optimizer', { args, helpText });
}
