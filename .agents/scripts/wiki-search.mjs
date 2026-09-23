#!/usr/bin/env node
// wiki 活跃层全文检索（2026-09-13 引入；2026-09-21 起降为 kb-search.mjs 的 wiki 域转发壳）
// —— 检索实现与降噪口径单一维护在 .agents/scripts/kb-search.mjs，本脚本保留以兼容既有文档 / SKILL §8 的命令。
// 用法：node .agents/scripts/wiki-search.mjs <词1> [词2 ...]     多词 AND（全部命中才算）
//       node .agents/scripts/wiki-search.mjs -t 数据维护 <词>    限定主题
//       node .agents/scripts/wiki-search.mjs -n 0 <词>          输出上限（本脚本默认 20，0=不限）
// 语料固定为 wiki 活跃层（含数据维护子目录；排除 drafts-archive、INDEX.md、知识沉淀总览.html）；
// 默认跳过 .json/.csv、*.visual-check.* 与 >180KB bulk（--include-generated 纳入）。
// 跨语料（workflow + wiki）请直接用：node .agents/scripts/kb-search.mjs "<词>"
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
// 兼容保留 P0 版默认输出上限 20；用户显式传 -n 时不覆盖；--scope wiki 追加在末尾以固定语料（后出现者生效）
const pass = [...args, ...(args.includes('-n') ? [] : ['-n', '20']), '--scope', 'wiki'];
const r = spawnSync(process.execPath, [path.join(here, 'kb-search.mjs'), ...pass], { stdio: 'inherit' });
process.exit(r.status ?? 1);
