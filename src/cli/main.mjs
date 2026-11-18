import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, flag } from './args.mjs';
import { makeT, LANGUAGES } from '../i18n.mjs';
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
import { listHostsCommand } from '../commands/list-hosts.mjs';
import { workspaceCommand } from '../commands/workspace.mjs';
import { devcontainerCommand } from '../commands/devcontainer.mjs';
import { addSkillCommand, removeSkillCommand, skillsCommand } from '../commands/skills.mjs';
import { newHostCommand } from '../commands/new-host.mjs';
import { KIT_ROOT } from '../install/plan.mjs';

const SUPPORTED_LANGS = new Set(LANGUAGES);

// 顶层命令全集（run/hook 在 parseArgs 前分派，help 在短路块处理），unknown command 时提示候选。
const COMMANDS = [
  'install', 'add-host', 'upgrade', 'adopt', 'prune', 'remove-host', 'uninstall',
  'doctor', 'diff', 'status', 'workspace', 'devcontainer', 'add-skill', 'remove-skill',
  'skills', 'new-host', 'explain', 'list-hosts', 'run', 'hook', 'help',
];

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
  // run / hook 的脚本参数可能自带 --json / --root 等旗标，必须在通用 parseArgs 之前分派，
  // 只解析入口选项，其余原样透传。
  if (argv[0] === 'run' || argv[0] === 'hook') {
    const { runtimeCommand } = await import('../commands/runtime.mjs');
    return runtimeCommand(argv[0], argv.slice(1));
  }
  const args = parseArgs(argv);
  const command = args._[0] || 'help';
  const lang = normalizeLang(args.lang);
  const t = makeT(lang);

  // 无位置参数且无任何选项（含 --agent/--target 等值形参数，它们不进 flags.size）、交互终端 → 进入 TUI 向导（懒加载，避免影响脚本路径）
  const wizardPath = !args._.length && args.flags.size === 0 && args.lang == null && args.agents.length === 0 && args.target == null
    && process.stdin.isTTY && process.stdout.isTTY;

  // --version / help 类请求（--help / -h / help）不读宿主注册表（help 是静态目录文案），
  // 先于外部宿主加载短路，避免项目层坏 manifest 挡住版本与帮助输出；向导路径让路保持原语义。
  if (flag(args, 'version') || flag(args, 'v')) {
    console.log(readVersion());
    return 0;
  }
  if (!wizardPath && (flag(args, 'help') || flag(args, 'h') || command === 'help' || command === '-h')) {
    console.log(t('help', { version: readVersion() }));
    return 0;
  }

  // 外部宿主定义必须先于命令分派加载：install / doctor / list-hosts 等都从注册表读取能力面。
  loadExternalHosts({
    target: path.resolve(args.target || process.cwd()),
    files: args.hostManifests || [],
    t,
  });

  if (wizardPath) {
    const { wizardCommand } = await import('../tui/wizard.mjs');
    return wizardCommand({ t, lang });
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
    case 'workspace':
      return workspaceCommand({ args, t });
    case 'devcontainer':
      return devcontainerCommand({ args, t });
    case 'add-skill':
      return addSkillCommand({ args, t, lang });
    case 'remove-skill':
      return removeSkillCommand({ args, t });
    case 'skills':
      return skillsCommand({ args, t, lang });
    case 'new-host': {
      const result = newHostCommand({ args, t });
      if (flag(args, 'json')) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(result.summary);
        console.log(result.next);
      }
      return 0;
    }
    case 'explain':
      return explainCommand({ args, t });
    case 'list-hosts':
      return listHostsCommand({ args, t, lang });
    default:
      {
        const err = new Error(`unknown command: ${command} (available: ${COMMANDS.join(', ')})`);
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
