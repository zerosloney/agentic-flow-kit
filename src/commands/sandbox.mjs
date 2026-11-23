import fs from 'node:fs';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { resolveTarget } from './install.mjs';
import { readManifest } from '../install/manifest.mjs';
import {
  SANDBOX_CONFIG_REL,
  detectContainerEngine,
  loadSandboxConfig,
  initSandboxConfig,
  routeCommand,
  executeSandbox,
} from '../install/sandbox.mjs';
import { STACK_IMAGES, STACK_CONTAINER_USER } from '../install/devcontainer.mjs';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

export function sandboxCommand({ args, t }) {
  const subcommand = String(args._[1] || 'inspect').toLowerCase();
  const target = resolveTarget(args);
  const isJson = flag(args, 'json');

  switch (subcommand) {
    case 'inspect': {
      const { exists, config, error } = loadSandboxConfig(target);
      const manifest = readManifest(target);
      const stack = manifest?.stack || 'node';
      const engine = detectContainerEngine(config?.engine || 'auto');
      const defaultImage = STACK_IMAGES[stack] || STACK_IMAGES.empty;
      const defaultUser = STACK_CONTAINER_USER[stack] || 'vscode';

      const data = {
        hasConfig: exists,
        configFile: exists ? SANDBOX_CONFIG_REL : null,
        error: error || null,
        engine: {
          available: engine.available,
          name: engine.engine,
          version: engine.version,
        },
        stack,
        image: config?.image || defaultImage,
        containerUser: config?.containerUser || defaultUser,
        mode: config?.mode || 'auto',
        network: config?.network || 'bridge',
        dropPrivileges: config?.dropPrivileges !== false,
      };

      if (isJson) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(t('sandbox.inspectEngine', {
          engine: engine.engine || 'none',
          version: engine.version || 'n/a',
          status: engine.available ? 'online' : 'unavailable',
        }));
        console.log(t('sandbox.inspectImage', {
          image: data.image,
          user: data.containerUser,
        }));
        console.log(t('sandbox.inspectNetwork', { network: data.network }));
        console.log(t('sandbox.inspectMode', { mode: data.mode }));
      }
      return 0;
    }

    case 'init': {
      const configFile = path.join(target, SANDBOX_CONFIG_REL);
      const isForce = flag(args, 'force');
      if (fs.existsSync(configFile) && !isForce) {
        fail('CONFIG_EXISTS', t('error.sandboxConfigExists', { path: SANDBOX_CONFIG_REL }));
      }

      const mode = args.mode || 'auto';
      const engine = args.engine || 'auto';
      const network = args.network || 'bridge';
      const image = args.image || null;

      const res = initSandboxConfig(target, { mode, engine, network, image });
      if (isJson) {
        console.log(JSON.stringify({ ok: true, file: SANDBOX_CONFIG_REL, config: res.config }, null, 2));
      } else {
        console.log(t('sandbox.initOk', { mode, engine, file: SANDBOX_CONFIG_REL }));
      }
      return 0;
    }

    case 'route': {
      const cmdTokens = args._.slice(2);
      if (!cmdTokens.length) {
        fail('COMMAND_REQUIRED', t('error.sandboxCommandRequired'));
      }
      const cmdStr = cmdTokens.join(' ');
      const isStrict = flag(args, 'strict');

      const decision = routeCommand({
        target,
        command: cmdStr,
        strict: isStrict,
      });

      if (isJson) {
        console.log(JSON.stringify({
          ok: decision.canExecute,
          command: cmdStr,
          ...decision,
        }, null, 2));
      } else {
        console.log(t('sandbox.routeDecision', {
          route: decision.route,
          level: decision.level,
          dangerous: decision.dangerous ? 'true' : 'false',
          reason: decision.reason,
        }));
        if (!decision.canExecute) {
          console.error(t('sandbox.routeBlocked', { level: decision.level }));
        }
      }

      return decision.canExecute ? 0 : 1;
    }

    case 'exec': {
      const cmdTokens = args._.slice(2);
      if (!cmdTokens.length) {
        fail('COMMAND_REQUIRED', t('error.sandboxCommandRequired'));
      }
      const cmdStr = cmdTokens.join(' ');
      const isDryRun = flag(args, 'dry-run');
      const isOffline = flag(args, 'offline');
      const image = args.image || null;
      const network = args.network || null;
      const user = args.user || null;

      const result = executeSandbox({
        target,
        command: cmdStr,
        options: {
          dryRun: isDryRun,
          offline: isOffline,
          image,
          network,
          user,
          json: isJson,
        },
      });

      if (isJson) {
        console.log(JSON.stringify(result, null, 2));
      } else if (isDryRun) {
        console.log(t('sandbox.execDryRun', { command: result.fullCommand }));
      }

      return result.status || 0;
    }

    default: {
      fail('UNKNOWN_SUBCOMMAND', t('error.sandboxUsage'));
    }
  }
}
