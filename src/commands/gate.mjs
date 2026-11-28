import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { runGateChecks, renderGateText, renderGateMarkdown, generateCiWorkflow, generateGateBadge } from '../ci/gate.mjs';

function badGateUsage(message) {
  const err = new Error(message);
  err.code = 'BAD_GATE_USAGE';
  throw err;
}

function parseRulesArg(args) {
  if (args.flags?.has('rules')) badGateUsage('`--rules` requires a comma-separated value');
  if (args.rules == null) return null;
  const list = String(args.rules).split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) badGateUsage('`--rules` must specify at least one guard name');
  return list;
}

function parseNumericThreshold(args, key) {
  const flagName = `--${key}`;
  if (args.flags?.has(key)) badGateUsage(`${flagName} requires a numeric value`);
  const raw = args[key];
  if (raw == null) return undefined;
  const s = String(raw).trim();
  const n = Number(s);
  if (!s || !Number.isFinite(n)) badGateUsage(`Invalid numeric value for ${flagName}: ${raw}`);
  return n;
}

function parseCommonGateOptions(args) {
  return {
    strict: flag(args, 'strict'),
    rules: parseRulesArg(args),
    diff: flag(args, 'diff'),
    since: args.since || null,
  };
}

/**
 * gate / ci 命令处理器
 */
export async function gateCommand({ args, t, lang = 'zh-CN' }) {
  const target = path.resolve(args.target || process.cwd());
  const sub = args._[1] || 'check';

  // 1. 初始化 CI 工作流流水线 (flow-kit gate init-ci / flow-kit ci init)
  if (sub === 'init-ci' || sub === 'init' || flag(args, 'init-ci')) {
    const provider = args.provider || 'github';
    // 审查遗留批 2026-11-23：透传 --force；目标 CI 文件已存在时由 generateCiWorkflow 抛 CONFIG_EXISTS。
    const wf = generateCiWorkflow({ provider, target, t, force: flag(args, 'force') });
    const relPath = path.relative(target, wf.path);
    console.log(t('gate.ciInitOk', { provider, file: relPath }) || `CI workflow scaffold generated (${provider}): ${relPath}`);
    return 0;
  }

  // 2. 生成状态徽章 (flow-kit gate badge)
  if (sub === 'badge' || flag(args, 'badge')) {
    const { strict, rules, diff, since } = parseCommonGateOptions(args);
    const badgeFormat = args.format || args['badge-format'] || 'markdown';

    const result = runGateChecks({ target, strict, rules, diff, since, t });
    const badgeContent = generateGateBadge(result, { format: badgeFormat });

    const outFile = args.out || args['badge-out'];
    if (outFile) {
      const outPath = path.resolve(target, outFile);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, badgeContent, 'utf8');
      console.log(t('gate.badgeSaved', { file: path.relative(target, outPath) }) || `Gate badge generated: ${path.relative(target, outPath)}`);
    } else {
      console.log(badgeContent);
    }
    return result.passed ? 0 : 1;
  }

  if (sub !== 'check' && sub !== 'run') {
    badGateUsage(t('error.gateUsage') || 'Usage: flow-kit gate [check|badge|init-ci] [options]');
  }

  // 3. 执行零信任门禁卡口检查
  const { strict, rules, diff, since } = parseCommonGateOptions(args);

  const thresholds = {};
  const maxCfr = parseNumericThreshold(args, 'max-cfr');
  const minPassRate = parseNumericThreshold(args, 'min-pass-rate');
  const maxMttr = parseNumericThreshold(args, 'max-mttr');
  const maxRework = parseNumericThreshold(args, 'max-rework');
  if (maxCfr !== undefined) thresholds.maxCfr = maxCfr;
  if (minPassRate !== undefined) thresholds.minPassRate = minPassRate;
  if (maxMttr !== undefined) thresholds.maxMttr = maxMttr;
  if (maxRework !== undefined) thresholds.maxRework = maxRework;

  const result = runGateChecks({
    target,
    strict,
    rules,
    thresholds,
    diff,
    since,
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

  // 若指定了 --badge-out 生成徽章文件
  if (args['badge-out']) {
    const badgeFormat = args['badge-format']
      || (args['badge-out'].endsWith('.svg') ? 'svg' : (args['badge-out'].endsWith('.json') ? 'json' : 'markdown'));
    const badgeContent = generateGateBadge(result, { format: badgeFormat });
    const badgeOutPath = path.resolve(target, args['badge-out']);
    fs.mkdirSync(path.dirname(badgeOutPath), { recursive: true });
    fs.writeFileSync(badgeOutPath, badgeContent, 'utf8');
  }

  // 若指定了 --out 文件落地
  if (args.out) {
    const outFile = path.resolve(target, args.out);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
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
