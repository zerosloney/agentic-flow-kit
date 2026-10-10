#!/usr/bin/env node
// init.mjs 交互解析纯函数测试（normalizeStack / parseChoices）+ 装户面断言——解析层不触真实安装与 stdin；
// 装户面节对真实 templates/ 树跑 renderTree（init/sync 同一装户路径），断言编排 runner 与 workflows 目录在装户清单内。
// 断言：①ts/js 别名归一 node；②序号/名称/混输/全角逗号/空白分隔解析正确（去重保序）；
//       ③非法输入返回 null（就地重问信号）；④空输入回默认（EOF/直接回车安全回退）；⑥装户面含 runner/workflows。
// 用法：node src/init.test.mjs
import { normalizeStack, parseChoices, hasAgentsSkeleton, mergeAgents, menuMark } from './init.mjs';
import { HOSTS as HOST_REG } from './profiles.mjs';
import { renderTree, scriptTrusted, listTree } from './render.mjs';
import { sha256 } from './render.mjs';
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
{
  const realHosts = Object.keys(HOST_REG);
  const n = String(realHosts.length);
  check('菜单号覆盖全部宿主，序号 7 选中最后一项', menuMark(realHosts.length - 1) === n && eq(parseChoices(n, realHosts, 'zcode'), [realHosts[realHosts.length - 1]]));
}
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

// ---- ⑥ 装户面：真实模板树含编排机制件（init/sync 同走 renderTree，结构保证装户必有） ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-surface-'));
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const t = renderTree(path.join(pkgRoot, 'templates'), tmp, { BOARD_PORT: '8933' }, { force: true });
  const rels = new Set(t.written.map((w) => w.rel));
  check('装户面含机制文档与编排脚本示例（_TEMPLATE + 示例 .md）',
    rels.has('.agents/workflows/_TEMPLATE.md') && rels.has('.agents/workflows/示例-并行实现评审.md'),
    [...rels].filter((r) => r.includes('workflows')).join('、'));
  check('装户面含 steps 扩展点示例', rels.has('.agents/workflows/steps/示例-部署验证.md'),
    [...rels].filter((r) => r.includes('steps')).join('、'));
  check('装户面无 orchestrate 命令残留（编排机制为目录约定，2026-09-25-wf-runtime）',
    ![...rels].some((r) => r.includes('orchestrate')),
    [...rels].filter((r) => r.includes('orchestrate')).join('、'));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- ⑦ 钩子执行位 + 供应链防线 + 记账归一（2026-09-27 init-p1-batch 复核条件①）----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'init-p1-'));
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const vars = { BOARD_PORT: '8933' };
  renderTree(path.join(pkgRoot, 'templates'), tmp, vars, { force: true });
  // P1-1：renderTree 落盘执行位——win32 下 statSync().mode 无 0o111 语义（恒 0666 系），
  // 断言「writeFileSync 带 mode 参数不炸 + POSIX 语义表达」；真值在 POSIX CI 腿验证
  const hookStat = fs.statSync(path.join(tmp, '.githooks', 'pre-commit'));
  const hookHasExecBit = (hookStat.mode & 0o111) !== 0;
  check('钩子落盘执行位：writeFileSync mode=0755 不炸且 POSIX 语义下可执行位为真（win32 平台分支容忍）',
    hookHasExecBit || process.platform === 'win32',
    `mode=${(hookStat.mode & 0o777).toString(8)} platform=${process.platform}`);
  // P1-3：scriptTrusted——一致放行 / 预置拒绝 / 包源无模板拒绝
  const ok1 = scriptTrusted({ pkgRoot, target: tmp, rel: '.agents/scripts/gen-workflow-index.mjs', vars });
  check('scriptTrusted：与包源渲染值一致 → ok', ok1.ok, ok1.note);
  fs.writeFileSync(path.join(tmp, '.agents/scripts/gen-workflow-index.mjs'), 'require("fs").writeFileSync("MARKER","pwned")\n');
  const bad1 = scriptTrusted({ pkgRoot, target: tmp, rel: '.agents/scripts/gen-workflow-index.mjs', vars });
  check('scriptTrusted：预置/被改动 → 拒绝且 note 可见', !bad1.ok && bad1.note.includes('不符'), bad1.note);
  const bad2 = scriptTrusted({ pkgRoot, target: tmp, rel: '.agents/scripts/not-in-pkg.mjs', vars });
  check('scriptTrusted：包源无模板 → fail-closed 拒绝', !bad2.ok, bad2.note);
  // P1-4：owned 记账 LF 归一——CRLF 盘面与 LF 内容同 sha（与 doctor §6.6 比较口径一致）
  const crlfFile = path.join(tmp, 'crlf-owned.txt');
  fs.writeFileSync(crlfFile, '行甲\r\n行乙\r\n');
  const normSha = sha256(Buffer.from('行甲\n行乙\n', 'utf8'));
  const rawSha = sha256(Buffer.from('行甲\r\n行乙\r\n', 'utf8'));
  const readNorm = sha256(Buffer.from(fs.readFileSync(crlfFile, 'utf8').replace(/\r\n/g, '\n'), 'utf8'));
  check('记账口径：LF 归一 sha == LF 内容 sha != 原始字节 sha（CRLF 盘面跨 checkout 稳定）',
    readNorm === normSha && readNorm !== rawSha);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- ⑧ --force owned 保护 + 端口校验（2026-09-27 p2-batch1）----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'init-protect-'));
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const vars = { BOARD_PORT: '8933' };
  // 预置「用户已自定义」的 owned 文件（内容 != 模板渲染值）
  const agPath = path.join(tmp, 'AGENTS.md');
  fs.writeFileSync(agPath, '# 我的项目\n\n自定义适配区命令行，p2b1-marker-keep。\n');
  const lpPath = path.join(tmp, '.agents', 'hooks', 'local-pre-commit');
  fs.mkdirSync(path.dirname(lpPath), { recursive: true });
  fs.writeFileSync(lpPath, '#!/bin/sh\nset -e\nsh .agents/hooks/check-architecture.sh  # add-gate 接线行 p2b1-marker-keep\n');
  const t = renderTree(path.join(pkgRoot, 'templates'), tmp, vars, { force: true, protectSet: new Set([...listTree(path.join(pkgRoot, 'templates')).filter((rel) => rel === 'AGENTS.md' || rel === '.agents/hooks/local-pre-commit')]) });
  check('⑧--force owned 保护：自定义 AGENTS.md 不被覆盖（marker 保留 + protectedSkipped 记录）',
    fs.readFileSync(agPath, 'utf8').includes('p2b1-marker-keep') && (t.protectedSkipped || []).includes('AGENTS.md'),
    JSON.stringify({ ps: t.protectedSkipped }));
  check('⑧--force owned 保护：local-pre-commit 接线行保留',
    fs.readFileSync(lpPath, 'utf8').includes('p2b1-marker-keep') && (t.protectedSkipped || []).includes('.agents/hooks/local-pre-commit'),
    JSON.stringify({ ps: t.protectedSkipped }));
  // managed 文件不受保护（--force 照常覆盖）
  const cmd = path.join(tmp, '.agents', 'commands', 'plan.md');
  check('⑧managed 文件 --force 照常覆盖（不在 protectedSkipped）',
    fs.existsSync(cmd) && !(t.protectedSkipped || []).includes('.agents/commands/plan.md'),
    JSON.stringify({ ps: t.protectedSkipped }));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- ⑨ 引擎基线不下发（装户端内容清理后：包源径基线的键命名空间与装户盘面不一致，下发即污染）----
{
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-lock-src-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-lock-tgt-'));
  fs.mkdirSync(path.join(src, '_agents', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(src, '_agents', 'scripts', 'gate.mjs'), '// 正常模板件\n');
  fs.writeFileSync(path.join(src, '_agents', 'engine-lock.json'), '{"files":{}}\n');
  const rels = listTree(src);
  check('⑨listTree 排除 .agents/engine-lock.json（枚举面无基线）',
    rels.includes('.agents/scripts/gate.mjs') && !rels.includes('.agents/engine-lock.json'),
    JSON.stringify(rels));
  const t = renderTree(src, tmp, {}, { force: true });
  check('⑨renderTree 不落盘 .agents/engine-lock.json（written 无基线、目标不生成）',
    !t.written.some((w) => w.rel === '.agents/engine-lock.json') && !fs.existsSync(path.join(tmp, '.agents', 'engine-lock.json')),
    JSON.stringify(t.written.map((w) => w.rel)));
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
if (fail) {
  console.log('\n用法：node src/init.test.mjs');
  process.exit(1);
}
process.exit(0);
