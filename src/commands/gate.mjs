import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { runGateChecks, renderGateText, renderGateMarkdown, generateCiWorkflow } from '../ci/gate.mjs';

/**
 * gate / ci 命令处理器
 */
export async function gateCommand({ args, t, lang = 'zh-CN' }) {
  const target = path.resolve(args.target || process.cwd());
  const sub = args._[1] || 'check';

  // 1. 初始化 CI 工作流流水线 (flow-kit gate init-ci / flow-kit ci init)
  if (sub === 'init-ci' || sub === 'init' || flag(args, 'init-ci')) {
    const provider = args.provider || 'github';
    const wf = generateCiWorkflow({ provider, target, t });
    const relPath = path.relative(target, wf.path);
    console.log(t('gate.ciInitOk', { provider, file: relPath }) || `CI workflow scaffold generated (${provider}): ${relPath}`);
    return 0;
  }

  if (sub !== 'check' && sub !== 'run') {
    const err = new Error(t('error.gateUsage') || 'Usage: flow-kit gate [check|init-ci] [options]');
    err.code = 'BAD_GATE_USAGE';
    throw err;
  }

  // 2. 执行零信任门禁卡口检查
  const strict = flag(args, 'strict');
  const rules = typeof args.rules === 'string' ? args.rules.split(',') : null;

  const thresholds = {};
  if (args['max-cfr'] != null) thresholds.maxCfr = Number(args['max-cfr']);
  if (args['min-pass-rate'] != null) thresholds.minPassRate = Number(args['min-pass-rate']);
  if (args['max-mttr'] != null) thresholds.maxMttr = Number(args['max-mttr']);
  if (args['max-rework'] != null) thresholds.maxRework = Number(args['max-rework']);

  const result = runGateChecks({
    target,
    strict,
    rules,
    thresholds,
    t,
  });

  // 处理输出报告
  let outputContent = '';
  if (flag(args, 'json')) {
    outputContent = JSON.stringify(result, null, 2);
    console.log(outputContent);
  } else if (flag(args, 'markdown')) {
    outputContent = renderGateMarkdown(result, t);
    console.log(outputContent);
  } else {
    outputContent = renderGateText(result, t);
    console.log(outputContent);
  }

  // 若指定了 --out 文件落地
  if (args.out) {
    const outFile = path.resolve(target, args.out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    // 若 --out 指定为 .json 结尾但未传 --json，或显式传了 --json，存 json
    let filePayload = outputContent;
    if (outFile.endsWith('.json') && !flag(args, 'json')) {
      filePayload = JSON.stringify(result, null, 2);
    } else if (outFile.endsWith('.md') && !flag(args, 'markdown')) {
      filePayload = renderGateMarkdown(result, t);
    }
    fs.writeFileSync(outFile, filePayload, 'utf8');
  }

  // 返回退出码：passed -> 0, failed -> 1
  return result.passed ? 0 : 1;
}

export const ciCommand = gateCommand;
