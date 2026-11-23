import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { readKitVersion, resolveTarget } from './install.mjs';
import {
  computeAiDoraMetrics,
  exportOpenTelemetryMetrics,
  renderMetricsMarkdown,
  checkMetricsThresholds,
} from '../install/metrics.mjs';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

export function metricsCommand({ args, t }) {
  const subcommand = String(args._[1] || 'report').toLowerCase();
  const target = resolveTarget(args);
  const days = args.days ? Number(args.days) : 30;

  switch (subcommand) {
    case 'report': {
      const isJson = flag(args, 'json');
      const isMarkdown = flag(args, 'markdown');
      const outFile = args.out ? path.resolve(target, args.out) : null;

      const metrics = computeAiDoraMetrics(target, { days });

      let output = '';
      if (isJson && !isMarkdown) {
        output = JSON.stringify(metrics, null, 2);
      } else {
        output = renderMetricsMarkdown(metrics);
      }

      if (outFile) {
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, `${output.trimEnd()}\n`, 'utf8');
        console.log(t('metrics.exported', { file: path.relative(target, outFile) || outFile }));
      } else {
        console.log(output.trimEnd());
      }
      return 0;
    }

    case 'export': {
      const format = String(args.format || 'otel').toLowerCase();
      const version = args.version || readKitVersion();
      const outFile = args.out ? path.resolve(target, args.out) : null;

      const metrics = computeAiDoraMetrics(target, { days });
      let data = null;
      if (format === 'otel') {
        data = exportOpenTelemetryMetrics(metrics, version);
      } else {
        data = metrics;
      }

      const output = JSON.stringify(data, null, 2);

      if (outFile) {
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, `${output}\n`, 'utf8');
        console.log(t('metrics.exported', { file: path.relative(target, outFile) || outFile }));
      } else {
        console.log(output);
      }
      return 0;
    }

    case 'check': {
      const isJson = flag(args, 'json');
      const metrics = computeAiDoraMetrics(target, { days });

      const thresholds = {};
      if (args['max-cfr'] != null) thresholds.maxCfr = Number(args['max-cfr']);
      if (args['max-mttr'] != null) thresholds.maxMttr = Number(args['max-mttr']);
      if (args['min-pass-rate'] != null) thresholds.minPassRate = Number(args['min-pass-rate']);
      if (args['max-rework'] != null) thresholds.maxRework = Number(args['max-rework']);

      const result = checkMetricsThresholds(metrics, thresholds);

      if (isJson) {
        console.log(JSON.stringify({ ok: result.ok, doraTier: metrics.doraTier, violations: result.violations }, null, 2));
      } else if (result.ok) {
        console.log(t('metrics.checkPass', { tier: metrics.doraTier }));
      } else {
        console.error(t('metrics.checkFailed'));
        for (const v of result.violations) {
          console.error(`  - ${v}`);
        }
      }

      if (!result.ok) {
        fail('METRICS_CHECK_FAILED', t('error.metricsThresholdExceeded', { count: result.violations.length }));
      }
      return 0;
    }

    default:
      fail('BAD_ARGS', t('error.metricsUsage'));
  }
}
