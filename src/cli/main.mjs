import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, flag } from './args.mjs';
import { makeT, LANGUAGES } from '../i18n.mjs';
import { HOST_NAMES, resolveHost, hostSource } from '../hosts/registry.mjs';
import { loadExternalHosts } from '../hosts/external.mjs';
import { installCommand } from '../commands/install.mjs';
import { doctorCommand } from '../commands/doctor.mjs';
import { addHostCommand } from '../commands/add-host.mjs';
import { upgradeCommand } from '../commands/upgrade.mjs';
import { adoptCommand } from '../commands/adopt.mjs';
import { diffCommand, statusCommand } from '../commands/diff.mjs';
import { pruneCommand } from '../commands/prune.mjs';
import { removeHostCommand, uninstallCommand } from '../commands/remove-host.mjs';
import { explainCommand } from '../commands/explain.mjs';
import { KIT_ROOT } from '../install/plan.mjs';

const SUPPORTED_LANGS = new Set(LANGUAGES);

function normalizeLang(input) {
  const lang = String(input || 'zh-CN');
  if (!SUPPORTED_LANGS.has(lang)) {
    const err = new Error(`unsupported language: ${lang}`);
    err.code = 'BAD_LANG';
    throw err;
  }
  return lang;
}

async function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0] || (args.help || args.h ? 'help' : 'help');
  const lang = normalizeLang(args.lang);
  const t = makeT(lang);

  // 外部宿主定义必须先于命令分派加载：install / doctor / list-hosts 等都从注册表读取能力面。
  loadExternalHosts({
    target: path.resolve(args.target || process.cwd()),
    files: args.hostManifests || [],
    t,
  });

  // 无位置参数且无任何选项（含 --agent/--target 等值形参数，它们不进 flags.size）、交互终端 → 进入 TUI 向导（懒加载，避免影响脚本路径）
  if (!args._.length && args.flags.size === 0 && args.lang == null && args.agents.length === 0 && args.target == null
    && process.stdin.isTTY && process.stdout.isTTY) {
    const { wizardCommand } = await import('../tui/wizard.mjs');
    return wizardCommand({ t, lang });
  }

  if (flag(args, 'version') || flag(args, 'v')) {
    console.log(readVersion());
    return 0;
  }
  if ((flag(args, 'help') || flag(args, 'h')) && command !== 'help') {
    console.log(t('help', { version: readVersion() }));
    return 0;
  }

  switch (command) {
    case 'install':
      return installCommand({ args, t, lang });
    case 'add-host':
      return addHostCommand({ args, t, lang });
    case 'upgrade':
      return upgradeCommand({ args, t, lang });
    case 'adopt':
      return adoptCommand({ args, t });
    case 'prune':
      return pruneCommand({ args, t });
    case 'remove-host':
      return removeHostCommand({ args, t });
    case 'uninstall':
      return uninstallCommand({ args, t });
    case 'doctor':
      return doctorCommand({ args, t, lang });
    case 'diff':
      return diffCommand({ args, t });
    case 'status':
      return statusCommand({ args, t });
    case 'explain':
      return explainCommand({ args, t });
    case 'list-hosts': {
      // 宿主能力来自注册表；--json 只输出数组，人类表格保持原样。
      const hosts = HOST_NAMES.map((name) => {
        const h = resolveHost(name);
        return {
          name,
          label: h.label,
          dir: h.dir,
          source: hostSource(name),
          tracked: Boolean(h.tracked),
          commands: Boolean(h.commands),
          agents: Boolean(h.agents),
          skills: h.skills ? h.skills.mode : null,
          hooks: Boolean(h.hooks),
          modelField: h.agents?.modelField || null,
        };
      });
      if (flag(args, 'json')) {
        console.log(JSON.stringify(hosts, null, 2));
        return 0;
      }
      for (const h of hosts) {
        console.log(`${h.name}\t${h.label}\t${h.dir}${h.tracked ? '\ttracked' : ''}`);
      }
      return 0;
    }
    case 'help':
    case '--help':
    case '-h':
      console.log(t('help', { version: readVersion() }));
      return 0;
    default:
      {
        const err = new Error(`unknown command: ${command}`);
        err.code = 'BAD_COMMAND';
        throw err;
      }
  }
}

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

export { main, normalizeLang, SUPPORTED_LANGS, flag };
