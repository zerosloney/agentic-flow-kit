// fixture-scripts.mjs — 测试夹具脚本闭包工具（2026-10-12 fixture-closure-rootfix）
//
// 为什么有它：夹具此前用**手工枚举**把被测脚本及其依赖拷进临时根（如 `const SCRIPTS = ['check-loop.mjs',
// 'policy.mjs', ...]`）。那份枚举必须与被测脚本真实的依赖闭包一致，但两者互不校验——给脚本加一行
// `import './x.mjs'`，枚举不会自动跟着变，而滞后的表现是**静默绿**：ESM resolve 失败 → 被测脚本根本没跑
// → 断言面为空 → 套件判绿。2026-10-12 那批台账改动就因此在 `check-loop.test` /
// `ledger-prune.test` 两处先后假绿（各自补拷才转绿）。补齐是止血，消灭枚举才是根治。
//
// 本模块给两样东西，各自独立成立：
//   ① scriptClosure / copyScriptClosure —— 自动求依赖传递闭包并整闭包拷贝，维护面归零（新增依赖自动跟随）；
//   ② assertFixtureScripts —— 拷完在**目标目录**独立复扫一遍，任一相对依赖解析不到就抛错报全量缺失清单。
//      这是纵深防御：即使将来有人又手写枚举（或绕过本 helper 直接拷），漏拷会在建夹具那一刻响亮炸掉，
//      而不是几十个场景之后以「门禁没跑」的形式悄悄绿掉。
//
// 依赖发现口径（刻意取宽）：**静态 import/export from**、**动态 import()**、以及**裸文件名字面量**
// （形如 path.join(here, 'kb-search.mjs') 的 spawn 依赖——wiki-search.mjs 就只靠这一条挂住 kb-search；
// check-hygiene 靠它挂住 rule-budget.mjs 与两个生成器）。裸文件名只在**解析到同目录真实文件**时才计入，
// 故 `'../hooks/commit-check.cjs'` 这类跨目录字面量天然被排除（scripts/ 下不存在同名文件）。
// 宁可多拷（多一个文件不会让测试变假绿），不可漏拷（漏拷就是假绿）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const SCRIPT_EXT = /\.(?:mjs|cjs|js|sh)$/;
// 裸文件名 / ./x / ../x 三种形态；含目录分隔的更长路径字面量（如 'templates/_agents/scripts/gate.mjs'）不匹配。
// 点开头的隐藏名不匹配：check-loop.mjs 里有 `.replace(/\.mjs$/, '.test.mjs')`，那个 '.test.mjs'
// 是**后缀字面量**不是文件名，按名解析必然扑空（对每个测试夹具都误报「漏拷」→ 整套件红）。
const BARE_NAME = /^(?:\.{1,2}\/)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
// 引号字面量（单/双引号皆可），逐行扫即可——模板字面量里的文件名由动态拼接给出，不在此列
const QUOTED = /'([^'\n]*)'|"([^"\n]*)"/g;

// stripComments：抹掉注释，保留字符串字面量内容。
// 刻意**不用正则**：正则版把 `confirmations.d/*.jsonl` 这类注释里的 `/*` 当块注释起点，跨注释一路吃到下一个
// 真 `*/`，把后面的 import 整段吃掉（check-ledger-invariant 实测：12141 字符被砍到 4198，43 行的
// import 直接消失 → 闭包漏依赖 → 回到假绿）。故走一个 40 行的逐字符状态机，只认三种真形态。
// 字符串内容**不抹**（我们要的就是字面量里的文件名），故正则里的 ".*?/*.jsonl" 这类串不被误当注释。
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// depsOf：某脚本源码里引用的、可能落在同目录的脚本文件名（去重、保持出现序）。
// 纯文本解析——不查盘面，故「源码引用了但盘面没有的名字」也会被列出，由调用方按盘面存在性收窄。
export function depsOf(sourceText) {
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  const text = stripComments(sourceText);
  // import/export ... from '...' 与 import('...')
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g)) push(m[2]);
  // 其余裸文件名字面量（spawn / path.join 依赖）
  for (const m of text.matchAll(QUOTED)) push(m[1] || m[2]);
  return out.filter((v) => SCRIPT_EXT.test(v) && BARE_NAME.test(v));
}

// scriptClosure：从入口出发递归求同目录依赖传递闭包（BFS，稳定序；不存在的引用不炸——由 assert 层兜）
export function scriptClosure(entries, { from = SCRIPT_DIR } = {}) {
  const queue = [...new Set(entries)].map((e) => path.basename(e));
  const seen = new Set();
  const order = [];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    order.push(name);
    const abs = path.join(from, name);
    if (!fs.existsSync(abs)) continue;
    for (const dep of depsOf(fs.readFileSync(abs, 'utf8'))) {
      const base = path.basename(dep);
      if (!seen.has(base)) queue.push(base);
    }
  }
  return order;
}

// copyScriptClosure：把入口的整个依赖闭包拷进 destScriptsDir，返回实际拷入的文件名。
// opts.extra —— 额外要拷的同级非脚本件（如 rule-budget.mjs 之外的 .txt 词表由 copyAgentsFiles 负责）。
export function copyScriptClosure(destScriptsDir, entries, opts = {}) {
  const from = opts.from || SCRIPT_DIR;
  fs.mkdirSync(destScriptsDir, { recursive: true });
  const closure = scriptClosure(entries, { from });
  const copied = [];
  for (const name of closure) {
    const src = path.join(from, name);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const dest = path.join(destScriptsDir, name);
    fs.copyFileSync(src, dest);
    copied.push(name);
  }
  // 纵深防御：在**目标目录**独立复扫，不复用上面的闭包结果（这样才抓得到拷贝环节本身的错漏）
  assertFixtureScripts(destScriptsDir);
  return copied;
}

// copyAgentsFiles：把包源 `.agents/` 面的词表/配置（workflow-enums.txt 等）拷进夹具的 .agents/ 根
export function copyAgentsFiles(destAgentsDir, names, { from = path.join(SCRIPT_DIR, '..') } = {}) {
  fs.mkdirSync(destAgentsDir, { recursive: true });
  const copied = [];
  for (const name of names) {
    const src = path.join(from, name);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(destAgentsDir, name));
    copied.push(name);
  }
  return copied;
}

// assertFixtureScripts：扫目录内全部脚本，任一相对/裸文件名依赖解析不到 → 抛错（报全量缺失，不报第一个）
// 用法：夹具建好后立即调；漏拷在当场炸，而不是在「门禁静默不跑」之后绿掉。
export function assertFixtureScripts(dir) {
  const missing = [];
  if (!fs.existsSync(dir)) throw new Error(`assertFixtureScripts: 目录不存在 ${dir}`);
  for (const f of fs.readdirSync(dir).filter((f) => SCRIPT_EXT.test(f)).sort()) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const dep of depsOf(src)) {
      if (dep.includes('/') && dep.startsWith('..')) continue; // 跨目录引用不在本夹具职责内
      if (!fs.existsSync(path.join(dir, dep))) missing.push(`${f} → ${dep}`);
    }
  }
  if (missing.length) {
    throw new Error(`夹具依赖缺失（漏拷 → 被测脚本 import 失败 → 门禁静默不跑 = 假绿）：\n  ${missing.join('\n  ')}\n`
      + '修法：改用 copyScriptClosure(入口脚本) 让闭包自动跟随，不要手写枚举。');
  }
  return true;
}