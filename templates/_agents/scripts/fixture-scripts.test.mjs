#!/usr/bin/env node
// fixture-scripts.test.mjs — 夹具闭包工具自身套件（2026-10-12 fixture-closure-rootfix）
// 命题：本工具**只能比手工枚举多拷，绝不能少拷**——多拷的文件不会让测试假绿，少拷的文件会让
// 被测脚本 import 失败、门禁静默不跑、套件假绿（2026-10-12 台账那批三处假绿的根因）。
// 覆盖面：多层传递依赖 / node: 内建跳过 / 注释与字符串字面量不误收 / 后缀字面量（'.test.mjs'）不误报 /
//       缺失即炸且报全量清单 / spawn 依赖（裸文件名字面量）也被收进闭包。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCRIPT_DIR, depsOf, scriptClosure, copyScriptClosure, assertFixtureScripts, copyAgentsFiles } from './fixture-scripts.mjs';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const tmpRoot = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `fxsc-${p}-`));
// 造一个合成 scripts 目录（不触真实盘面——本工具的依赖发现是纯文本解析，故合成目录可独立验证）
const synth = (files) => {
  const dir = tmpRoot('synth');
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, 'utf8');
  return dir;
};

// ---- S1：多层传递依赖闭包 ----
{
  const src = synth({
    'a.mjs': `import './b.mjs';\nimport { x } from './sub/c.mjs';\n`,
    'b.mjs': `import './c.mjs';\n`,
    'c.mjs': `export const x = 1;\n`,
    'd.mjs': `export const y = 2;\n`,
  });
  const cl = scriptClosure(['a.mjs'], { from: src });
  check('S1 三层传递依赖全部收进闭包', ['a.mjs', 'b.mjs', 'c.mjs'].every((f) => cl.includes(f)) && !cl.includes('d.mjs'), cl.join(','));
}

// ---- S2：node: 内建与跨目录字面量不误收 ----
{
  const src = synth({
    'a.mjs': `import fs from 'node:fs';\nimport { x } from './b.mjs';\nconst p = path.join(h, 'templates/_agents/scripts/gate.mjs');\n`,
    'b.mjs': 'export const x=1;\n',
  });
  const cl = scriptClosure(['a.mjs'], { from: src });
  check('S2 node: 内建与长路径字面量被排除', cl.length === 2, cl.join(','));
}

// ---- S3：注释与字符串里的脚本名不算依赖 ----
{
  const deps = depsOf(`// 拷 './gone.mjs' 进来\n/* from './gone2.mjs' */\nimport './real.mjs';\n`);
  check('S3 注释里的文件名不算依赖', deps.length === 1 && deps[0] === './real.mjs', JSON.stringify(deps));
}

// ---- S4：后缀字面量（'.test.mjs'）不误报——防「每个夹具都误报漏拷」 ----
// 这条是真实回归：check-loop.mjs 里就有 `.replace(/\.mjs$/, '.test.mjs')`，按名解析必然扑空。
{
  const deps = depsOf(`f.replace(/\\.mjs$/, '.test.mjs')\nimport './real.mjs';\n`);
  check('S4 后缀字面量 .test.mjs 不计入依赖', !deps.some((d) => d.includes('test')), JSON.stringify(deps));
}

// ---- S5：spawn 依赖（裸文件名字面量）也进闭包——wiki-search 只靠 path.join(here,'kb-search.mjs') 挂住依赖 ----
{
  const src = synth({
    'wiki-search.mjs': `spawnSync(process.execPath, [path.join(here, 'kb-search.mjs')]);\n`,
    'kb-search.mjs': `import './workflow-enums.mjs';\n`,
    'workflow-enums.mjs': 'export const a=1;\n',
  });
  const cl = scriptClosure(['wiki-search.mjs'], { from: src });
  check('S5 spawn 裸文件名依赖传递收进闭包', cl.includes('kb-search.mjs') && cl.includes('workflow-enums.mjs'), cl.join(','));
}

// ---- S6：缺失即炸且报全量清单（非报第一个就停） ----
{
  const dir = tmpRoot('missing');
  fs.writeFileSync(path.join(dir, 'a.mjs'), `import './m1.mjs';\nimport './m2.mjs';\n`, 'utf8');
  let msg = '';
  try { assertFixtureScripts(dir); } catch (e) { msg = String(e.message); }
  check('S6 缺依赖 → 抛错', !!msg, '未抛错');
  check('S6 报全量缺失清单（m1+m2 都在）', msg.includes('m1.mjs') && msg.includes('m2.mjs'), msg);
  check('S6 报文点明假绿与修法', msg.includes('假绿') && msg.includes('copyScriptClosure'), msg.slice(0, 120));
}

// ---- S7：copyScriptClosure 对真实盘面跑通（check-loop 闭包 + 拷后自检不炸） ----
{
  const dest = path.join(tmpRoot('copy'), 'scripts');
  const copied = copyScriptClosure(dest, ['check-loop.mjs']);
  check('S7 check-loop 闭包含新台账依赖（含 policy.mjs——B6b-1 分道/policy 锚随闭包自动跟随）', ['check-loop.mjs', 'ledger-loader.mjs', 'ledger-prune.mjs', 'policy.mjs'].every((f) => copied.includes(f)), copied.join(','));
  // B6b-2 六段模块（2026-10-13）：check-loop.mjs import 的段模块须随闭包自动带上——漏拷 = 被测脚本
  // 在夹具里 resolve 失败 → 门禁静默不跑（本文件头注的假绿形态）。显式断言六件在场，不靠运气。
  check('S7 check-loop 闭包含 B6b-2 六段模块（import 闭包自动跟随）',
    ['check-spec-verif.mjs', 'check-registry.mjs', 'check-convergence.mjs', 'check-attribution.mjs', 'check-prejudgment.mjs', 'check-funnel.mjs'].every((f) => copied.includes(f)),
    copied.join(','));
  check('S7 拷贝后 assertFixtureScripts 不炸（闭包自洽）', assertFixtureScripts(dest) === true);
  // 真跑一次被测脚本，确认夹具不是「文件齐了但跑不起来」
  const fx = path.dirname(dest);
  fs.mkdirSync(path.join(fx, '.agents'), { recursive: true });
  fs.copyFileSync(SCRIPT_DIR.replace(/scripts$/, 'workflow-enums.txt'), path.join(fx, '.agents', 'workflow-enums.txt'));
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [path.join(dest, 'check-loop.mjs')], {
    cwd: fx, encoding: 'utf8', env: { ...process.env, CHECK_LOOP_ROOT: fx },
  });
  check('S7 夹具内 check-loop 真能跑起来（非 ENOENT 崩）', !/Cannot find module|ERR_MODULE_NOT_FOUND/.test(`${r.stdout || ''}${r.stderr || ''}`), `${r.stdout || ''}${r.stderr || ''}`.slice(0, 200));
}

// ---- S8：copyAgentsFiles 拷词表，缺失的静默跳过 ----
{
  const dest = tmpRoot('agents');
  const copied = copyAgentsFiles(dest, ['workflow-enums.txt', 'definitely-absent.txt']);
  check('S8 存在词表拷入、缺席跳过', copied.length === 1 && copied[0] === 'workflow-enums.txt', copied.join(','));
}

console.log(`\n[fixture-scripts] PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);