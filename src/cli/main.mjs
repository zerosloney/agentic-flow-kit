import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, flag } from './args.mjs';
import { makeT, LANGUAGES } from '../i18n.mjs';
import { HOST_NAMES, resolveHost } from '../hosts/registry.mjs';
import { installCommand } from '../commands/install.mjs';
import { doctorCommand } from '../commands/doctor.mjs';
import { addHostCommand } from '../commands/add-host.mjs';
import { upgradeCommand } from '../commands/upgrade.mjs';
import { diffCommand, statusCommand } from '../commands/diff.mjs';
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
    case 'doctor':
      return doctorCommand({ args, t, lang });
    case 'diff':
      return diffCommand({ args, t });
    case 'status':
      return statusCommand({ args, t });
    case 'list-hosts':
      for (const name of HOST_NAMES) {
        const h = resolveHost(name);
        console.log(`${name}\t${h.label}\t${h.dir}${h.tracked ? '\ttracked' : ''}`);
      }
      return 0;
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
