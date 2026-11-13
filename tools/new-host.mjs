#!/usr/bin/env node
// 维护者入口：等价于 `flow-kit new-host`，方便在源码仓直接生成宿主插件。
// 用法：node tools/new-host.mjs <name> [--out <dir>] [--hooks] [--permissions] [--mcp claude|opencode] ...
import { parseArgs, flag } from '../src/cli/args.mjs';
import { makeT, LANGUAGES } from '../src/i18n.mjs';
import { newHostCommand } from '../src/commands/new-host.mjs';
import { exitCodeForError } from '../src/cli/exit.mjs';

function main(argv) {
  const args = parseArgs(argv);
  const lang = LANGUAGES.includes(args.lang) ? args.lang : 'zh-CN';
  const t = makeT(lang);
  try {
    // newHostCommand 与 CLI 同形：args._[0] 是子命令名。
    const result = newHostCommand({ args: { ...args, _: ['new-host', ...args._] }, t });
    if (flag(args, 'json')) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(result.summary);
    console.log(result.next);
    return 0;
  } catch (err) {
    console.error(err.message);
    return exitCodeForError(err);
  }
}

process.exit(main(process.argv.slice(2)));
