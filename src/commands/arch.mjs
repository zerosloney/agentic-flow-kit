import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { resolveTarget } from './install.mjs';
import {
  ARCH_CONFIG_REL,
  initArchConfig,
  evaluateArchitecture,
  generateArchitectureMermaid,
} from '../install/arch-guard.mjs';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

export function archCommand({ args, t }) {
  const subcommand = String(args._[1] || 'check').toLowerCase();
  const target = resolveTarget(args);

  switch (subcommand) {
    case 'init': {
      const preset = args.preset || 'clean';
      const isForce = flag(args, 'force');
      const configFile = path.join(target, ARCH_CONFIG_REL);

      if (fs.existsSync(configFile) && !isForce) {
        fail('CONFIG_EXISTS', t('error.archConfigExists', { path: ARCH_CONFIG_REL }));
      }

      initArchConfig(target, { preset });
      console.log(t('arch.initOk', { preset, file: ARCH_CONFIG_REL }));
      return 0;
    }

    case 'check': {
      const isJson = flag(args, 'json');
      const isStrict = flag(args, 'strict');

      const result = evaluateArchitecture(target);

      if (!result.hasConfig) {
        if (isJson) {
          console.log(JSON.stringify({ hasConfig: false, ok: true, message: t('arch.noConfig') }, null, 2));
        } else {
          console.log(t('arch.noConfigHint'));
        }
        return 0;
      }

      if (isJson) {
        console.log(JSON.stringify({
          hasConfig: true,
          ok: result.ok,
          totalFiles: result.totalFiles,
          cycles: result.cycles,
          boundaryViolations: result.boundaryViolations,
          privateViolations: result.privateViolations,
        }, null, 2));
      } else {
        console.log(t('arch.checkTitle', { count: result.totalFiles }));
        if (result.ok) {
          console.log(t('arch.checkPass'));
        } else {
          console.error(t('arch.checkFailed', {
            cycles: result.cycles.length,
            layerViolations: result.boundaryViolations.length,
            privateViolations: result.privateViolations.length,
          }));
          for (const cycle of result.cycles) {
            console.error(`  - [Circular Dependency] ${cycle.join(' -> ')}`);
          }
          for (const v of result.boundaryViolations) {
            console.error(`  - [Boundary Violation] ${v.fromFile} (${v.fromLayer}) -> ${v.targetFile} (${v.targetLayer}): ${v.reason}`);
          }
          for (const v of result.privateViolations) {
            console.error(`  - [Private Import Violation] ${v.fromFile} -> ${v.targetFile}: ${v.reason}`);
          }
        }
      }

      if (!result.ok && isStrict) {
        fail('ARCH_CHECK_FAILED', t('error.archCheckFailed'));
      }
      return result.ok ? 0 : 1;
    }

    case 'graph': {
      const format = String(args.format || 'mermaid').toLowerCase();
      const outFile = args.out ? path.resolve(target, args.out) : null;

      const result = evaluateArchitecture(target);
      let output = '';

      if (format === 'json') {
        const serializableGraph = {};
        for (const [k, v] of result.graph.entries()) {
          serializableGraph[k] = [...v];
        }
        output = JSON.stringify(serializableGraph, null, 2);
      } else if (format === 'text') {
        const lines = [];
        for (const [k, v] of result.graph.entries()) {
          lines.push(`${k}:`);
          for (const dep of v) {
            lines.push(`  └─ ${dep}`);
          }
        }
        output = lines.join('\n');
      } else {
        output = generateArchitectureMermaid(result.graph, result.config, [
          ...result.boundaryViolations,
          ...result.privateViolations,
        ]);
      }

      if (outFile) {
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, `${output.trimEnd()}\n`, 'utf8');
        console.log(t('arch.graphExported', { file: path.relative(target, outFile) || outFile }));
      } else {
        console.log(output);
      }
      return 0;
    }

    default:
      fail('BAD_ARGS', t('error.archUsage'));
  }
}
