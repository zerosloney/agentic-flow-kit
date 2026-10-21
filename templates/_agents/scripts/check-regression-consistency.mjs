#!/usr/bin/env node
// check-regression-consistency — 回归清单活文档引用存在性检查（泛化自源仓 44390bde 关单活文档门）
//
// 动机：回归清单是自由文本，独立复核反复抓到「清单残留旧口径」类活文档债（引用的资产已删/改名），
//   却只在复核阶段可见。把「清单引用的资产还在吗」前移到关单 + 提交双闸，残留当场被拦。
// 口径（弱档 / 存在性，不猜语义）：清单条目无法机器对账语义，只校验「引用指向的资产在仓库里仍存在」。
//   能抓「删了文件但清单还说有」「改名后清单未跟」；抓不到「值口径变了但符号还在」——那是强档
//   语义对账，自由文本无结构化契约，显式不做。
// 与源仓差异（泛化点）：源仓检查①是 C# 栈特化（`*Tests` 类名对 tests/*.cs）；kit 装户任意语言，
//   改为**语言无关的仓库相对路径存在性检查**——清单中的代码路径（扩展名交替**最长优先**，沿用
//   check-convergence 的教训：js/ts 是 mjs/json/tsx 前缀且无尾锚会截断）须存在；`workflow/**.md`
//   引用须存在；gitignore 易失前缀（tmp/ 等）只 advisory 不拦（防「本地清掉但条目仍有效」恒误报）。
// 落点：check-loop 检查 27（hygiene WARN，提交时可见）+ confirm-doc 关单（docs→done / incidents→closed
//   前置拒绝，防残留进归档）。
// 用法：node .agents/scripts/check-regression-consistency.mjs [--root <仓库根>]
//   exit 0 = 无悬空引用；exit 1 = 存在悬空引用（代码/文档路径）；易失前缀缺失只提示不拦。
// 测试：node .agents/scripts/check-regression-consistency.test.mjs（纯函数逐项）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLedgerText } from './ledger-shards.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// 扩展名交替最长优先（js/ts 是 mjs/json/tsx 前缀且无尾锚会截断——check-convergence 实证教训）
const PATH_EXT = 'tsx|mjs|cjs|json|html|sql|vue|cs|md|ts|js';
// gitignore 易失前缀：本地易被清（tmp/、.cache/ 等），存在性恒误报面，只 advisory
const VOLATILE_PREFIXES = ['tmp/', 'temp/', '.cache/', 'dist/'];

// extractRefs(text)：提取清单引用（纯函数）。返回 { codePaths, docRefs, volatilePaths }
//   codePaths: 带代码扩展名的仓库相对路径（语言无关——命中即须存在）
//   docRefs: workflow/**/*.md 流程文档引用（intent/spec/plan/incident 引用）
//   volatilePaths: 易失前缀路径（advisory）
// 刻意不含裸标识符/类名——自由文本里误报率过高（源仓 SQL 标识符教训在案）。
export function extractRefs(text) {
  const codePaths = new Set();
  const docRefs = new Set();
  const volatilePaths = new Set();
  const t = String(text || '').replace(/<!--[\s\S]*?-->/g, ''); // HTML 注释不计（模板说明非作者引用）
  // 定界类含反引号/引号——用普通字符串拼接构造（模板字符串转义层级过深易错）
  const PATH_RE = new RegExp('(?:^|[\\s`\'"（(｜；：，。、])([\\w.@\\-/\\p{L}]+\\.(?:' + PATH_EXT + '))', 'gu');
  for (const m of t.matchAll(PATH_RE)) {
    const p = m[1].replace(/\\/g, '/');
    if (p.startsWith('workflow/') && p.endsWith('.md')) continue; // workflow/**.md 归 docRefs 面，不双计（workflow/evidence/*.json 等受管证据仍走存在性检查）
    if (VOLATILE_PREFIXES.some((v) => p.startsWith(v))) volatilePaths.add(p);
    else codePaths.add(p);
  }
  for (const m of t.matchAll(/\b(workflow\/[A-Za-z0-9_./\\-]+\.md)\b/g)) docRefs.add(m[1].replace(/\\/g, '/'));
  return {
    codePaths: [...codePaths].sort(),
    docRefs: [...docRefs].sort(),
    volatilePaths: [...volatilePaths].sort(),
  };
}

// scanRegressionRefs(root)：主检查（读主台账 ∪ 全部分片，对照仓库实际资产）。纯函数。
// 返回 { danglingPaths, danglingDocs, missingVolatile }——排序后数组。
export function scanRegressionRefs(root) {
  let text = '';
  try { text = readLedgerText(root, 'regression-checklist'); } catch { return { danglingPaths: [], danglingDocs: [], missingVolatile: [] }; }
  const refs = extractRefs(text);
  const danglingPaths = refs.codePaths.filter((p) => !fs.existsSync(path.join(root, p)));
  const danglingDocs = refs.docRefs.filter((p) => !fs.existsSync(path.join(root, p)));
  const missingVolatile = refs.volatilePaths.filter((p) => !fs.existsSync(path.join(root, p)));
  return { danglingPaths, danglingDocs, missingVolatile };
}

// run(ctx)：check-loop 检查 27 模块形态（沿 check-stage-index 先例——只返回 warnings，不打印不 exit、不改 ctx）
export function run(ctx) {
  const { ROOT, warnings } = ctx;
  const r = scanRegressionRefs(ROOT);
  for (const p of r.danglingPaths) warnings.push(`- [WARN 回归清单悬空引用] 路径 ${p} 已不在但清单仍引用——按维护规则 4 删除或改写过时条目（关单时为硬前置，confirm-doc 拒绝落账）`);
  for (const p of r.danglingDocs) warnings.push(`- [WARN 回归清单悬空引用] 流程文档 ${p} 不存在但清单仍引用——更新为正确路径或删除过时条目`);
  for (const p of r.missingVolatile) warnings.push(`- [NOTE 回归清单易失路径缺失] ${p} 当前不在（gitignore 前缀，advisory 不拦）`);
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-regression-consistency.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('用法：node .agents/scripts/check-regression-consistency.mjs [--root <仓库根>]');
      process.exit(0);
    }
  }
  void SCRIPT_DIR;
  const r = scanRegressionRefs(root);
  for (const p of r.missingVolatile) console.log(`ℹ️  清单引用的易失路径当前不在（${p}——gitignore 前缀，不拦）`);
  const problems = [
    ...r.danglingPaths.map((p) => `悬空路径：${p}`),
    ...r.danglingDocs.map((p) => `悬空流程文档：${p}`),
  ];
  if (problems.length) {
    console.error(`\n❌ 回归清单引用了不存在的资产（${problems.length} 处）——残留未清：`);
    for (const p of problems) console.error('  - ' + p);
    console.error('  处理：删除/改写清单里已过时的条目（维护规则 4），或恢复被误删的资产。');
    process.exit(1);
  }
  console.log(`✅ 回归清单引用一致：无悬空路径/文档${r.missingVolatile.length ? `（${r.missingVolatile.length} 个易失路径缺失仅提示）` : ''}`);
  process.exit(0);
}
