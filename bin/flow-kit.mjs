#!/usr/bin/env node
import { main } from '../src/cli/main.mjs';
import { exitCodeForError } from '../src/cli/exit.mjs';

main(process.argv.slice(2))
  .then((code) => {
    if (Number.isInteger(code)) process.exitCode = code;
  })
  .catch((err) => {
    // 预期内的用户错误（code 已标注）只打印消息；未预期错误保留堆栈便于定位。
    if (err?.code) console.error(err.message);
    else console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = exitCodeForError(err);
  });
