#!/usr/bin/env node
// init.mjs 交互解析纯函数测试（normalizeStack / parseChoices）+ 装户面断言——解析层不触真实安装与 stdin；
// 装户面节对真实 templates/ 树跑 renderTree（init/sync 同一装户路径），断言编排 runner 与 workflows 目录在装户清单内。
// 断言：①ts/js 别名归一 node；②序号/名称/混输/全角逗号/空白分隔解析正确（去重保序）；
//       ③非法输入返回 null（就地重问信号）；④空输入回默认（EOF/直接回车安全回退）；⑥装户面含 runner/workflows。
// 用法：node src/init.test.mjs
import { normalizeStack, parseChoices, hasAgentsSkeleton, mergeAgents } from './init.mjs';
import { renderTree } from './render.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const HOSTS = ['zcode', 'opencode', 'trae', 'omp'];
const STACKS = ['dotnet', 'node', 'python', 'go', 'none'];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- ① 别名归一 ----
check('ts/TS/TypeScript/javascript 均归一 node', normalizeStack('ts') === 'node' && normalizeStack('TS') === 'node' && normalizeStack('TypeScript') === 'node' && normalizeStack('javascript') === 'node');
check('规范名与空值透传', normalizeStack('node') === 'node' && normalizeStack('dotnet') === 'dotnet' && normalizeStack('  go ') === 'go' && normalizeStack('') === '' && normalizeStack(undefined) === '');

// ---- ② 序号/名称/混输解析 ----
check('序号 1,3 → zcode,trae', eq(parseChoices('1,3', HOSTS, 'zcode'), ['zcode', 'trae']));
check('名称 trae → trae', eq(parseChoices('trae', HOSTS, 'zcode'), ['trae']));
check('混输 zcode，3（全角逗号）→ zcode,trae', eq(parseChoices('zcode，3', HOSTS, 'zcode'), ['zcode', 'trae']));
check('空白分隔 1 3 → zcode,trae', eq(parseChoices('1 3', HOSTS, 'zcode'), ['zcode', 'trae']));
check('去重保序 3,1,1 → trae,zcode', eq(parseChoices('3,1,1', HOSTS, 'zcode'), ['trae', 'zcode']));
check('栈序号 2 + map 归一 → node', eq(parseChoices('2', STACKS, 'none', normalizeStack), ['node']));
check('栈别名 ts + map 归一 → node', eq(parseChoices('ts', STACKS, 'none', normalizeStack), ['node']));

// ---- ③ 非法输入 → null（就地重问） ----
check('越界序号 9 → null', parseChoices('9', HOSTS, 'zcode') === null);
check('未知名称 bad → null', parseChoices('zcode,bad', HOSTS, 'zcode') === null);
check('栈别名未传 map 不归一（ts → null）', parseChoices('ts', STACKS, 'none') === null);

// ---- ④ 空输入回默认 ----
check('空串 → [def]', eq(parseChoices('', HOSTS, 'zcode'), ['zcode']));
check('undefined → [def]', eq(parseChoices(undefined, STACKS, 'none'), ['none']));

// ---- ⑤ AGENTS.md 骨架探测与合并 ----
check('标记探测：带标记 true', hasAgentsSkeleton('x\n<!-- flow-kit:agents-skeleton -->\n# y') === true);
check('标记探测：外部自写 AGENTS.md false', hasAgentsSkeleton('# 我的项目\n\n构建: dotnet build') === false);
check('标记探测：空值 false', hasAgentsSkeleton('') === false && hasAgentsSkeleton(undefined) === false);
check('合并：原内容在上、空行分隔、骨架在下',
  mergeAgents('# A\n内容', '<!-- m -->\n# B') === '# A\n内容\n\n<!-- m -->\n# B\n');
check('合并：原内容尾部空白折叠不产生连续空行',
  mergeAgents('# A\n内容\n\n\n', '<!-- m -->\n# B') === '# A\n内容\n\n<!-- m -->\n# B\n');
check('合并：原内容为空时骨架即全文', mergeAgents('', '<!-- m -->\n# B') === '<!-- m -->\n# B\n');

// ---- ⑥ 装户面：真实模板树含编排 runner 与 workflows（init/sync 同走 renderTree，结构保证装户必有） ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-surface-'));
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const t = renderTree(path.join(pkgRoot, 'templates'), tmp, { BOARD_PORT: '8933' }, { force: true });
  const rels = new Set(t.written.map((w) => w.rel));
  check('装户面含编排 runner（.agents/scripts/wf-run.mjs）', rels.has('.agents/scripts/wf-run.mjs'));
  check('装户面含 workflows 三件（_TEMPLATE / providers.json / 示例）',
    rels.has('.agents/workflows/_TEMPLATE.md') && rels.has('.agents/workflows/providers.json') && rels.has('.agents/workflows/示例-并行实现评审.mjs'),
    [...rels].filter((r) => r.includes('workflows')).join('、'));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log('\n用法：node src/init.test.mjs');
  process.exit(1);
}
process.exit(0);
