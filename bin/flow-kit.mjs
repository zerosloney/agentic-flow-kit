#!/usr/bin/env node
import { main } from '../src/cli/main.mjs';

// 预期错误的退出码契约：2 用法错误、3 目标或 manifest 缺失、4 未知宿主。
// 未预期错误保留 1，便于 CI 区分。
const EXIT_BY_CODE = {
  BAD_COMMAND: 2,
  BAD_LANG: 2,
  BAD_MODEL: 2,
  BAD_TIER: 2,
  NO_HOSTS: 2,
  TARGET_MISSING: 3,
  NO_MANIFEST: 3,
  NO_HOSTS_IN_MANIFEST: 3,
  UNKNOWN_HOST: 4,
};

main(process.argv.slice(2))
  .then((code) => {
    if (Number.isInteger(code)) process.exitCode = code;
  })
  .catch((err) => {
    // 预期内的用户错误（code 已标注）只打印消息；未预期错误保留堆栈便于定位。
    if (err?.code) console.error(err.message);
    else console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = EXIT_BY_CODE[err?.code] || 1;
  });
