#!/usr/bin/env node
// check-spec-packages.mjs — 校验 workflow/specs/<name>/ 的 Spec / Tasks / Verify 工件。
// 约定：目录包（不含 _TEMPLATE）内三件套齐全；spec 有验收标准；
// tasks 至少一条勾选项；verify-report 有结果/证据节与可识别的结论。
// 用法：flow-kit run check-spec-packages.mjs [--root <dir>] [--json]
// 退出码：0 通过；1 存在缺件/缺节；2 用法错误。
import fs from 'node:fs';
import path from 'node:path';
import { parseHandoffSheet, validateHandoffSheet } from './touch-set.mjs';

export { parseHandoffSheet, validateHandoffSheet };

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  return value == null || value.startsWith('--') ? true : value;
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function checkPackage(root, name, options = {}) {
  const dir = path.join(root, 'workflow', 'specs', name);
  const problems = [];
  const spec = read(path.join(dir, 'spec.md'));
  const tasks = read(path.join(dir, 'tasks.md'));
  const verify = read(path.join(dir, 'verify-report.md'));
  if (spec == null) problems.push('missing spec.md');
  else if (!/^##\s*(?:\d+[.、)]\s*)?验收标准/m.test(spec) && !/^##\s*(?:\d+[.、)]\s*)?验收判据/m.test(spec)) problems.push('spec.md missing "## 验收标准"'); // 编号前缀容忍（issue #56）
  if (tasks == null) problems.push('missing tasks.md');
  else if (!/^\s*-\s*\[[ xX]\]/m.test(tasks)) problems.push('tasks.md has no checkbox items');
  if (verify == null) problems.push('missing verify-report.md');
  else {
    if (!/^##\s*(?:\d+[.、)]\s*)?结果/m.test(verify)) problems.push('verify-report.md missing "## 结果"'); // 编号前缀容忍（issue #56）
    if (!/^##\s*(?:\d+[.、)]\s*)?证据/m.test(verify)) problems.push('verify-report.md missing "## 证据"'); // 编号前缀容忍（issue #56）
    if (!/^\s*结论\s*[:：]\s*(pass|fail|partial)\b/im.test(verify)) {
      problems.push('verify-report.md missing "结论: pass|fail|partial"');
    }
  }

  // 交接契约校验（Handoff Sheet）
  const handoffJson = read(path.join(dir, 'handoff.json'));
  const handoffMd = read(path.join(dir, 'handoff.md'));
  if (handoffJson != null) {
    const sheet = parseHandoffSheet(handoffJson);
    const v = validateHandoffSheet(sheet);
    if (!v.ok) problems.push(`handoff.json 契约不满足: ${v.problems.join('; ')}`);
  } else if (handoffMd != null) {
    const sheet = parseHandoffSheet(handoffMd);
    const v = validateHandoffSheet(sheet);
    if (!v.ok) problems.push(`handoff.md 契约不满足: ${v.problems.join('; ')}`);
  } else if (options.requireHandoff) {
    problems.push('missing handoff sheet (handoff.json or handoff.md)');
  }

  return { package: name, ok: problems.length === 0, problems };
}

export function checkAll(root, options = {}) {
  const base = path.join(root, 'workflow', 'specs');
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return { root, packages: [], ok: true };
  }
  const packages = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => checkPackage(root, entry.name, options));
  return { root, packages, ok: packages.every((pkg) => pkg.ok) };
}

function main() {
  const argv = process.argv.slice(2);
  const root = path.resolve(argOf(argv, 'root', process.cwd()));
  const asJson = argv.includes('--json');
  const requireHandoff = argv.includes('--require-handoff');
  const result = checkAll(root, { requireHandoff });
  if (asJson) {
    console.log(JSON.stringify({ root: result.root, ok: result.ok, packages: result.packages }, null, 2));
    return result.ok ? 0 : 1;
  }
  if (!result.packages.length) {
    console.log('✅ spec packages: none');
    return 0;
  }
  for (const pkg of result.packages) {
    if (pkg.ok) console.log(`✅ ${pkg.package}`);
    else console.error(`✗ ${pkg.package}: ${pkg.problems.join('; ')}`);
  }
  return result.ok ? 0 : 1;
}

const isMain = process.argv[1] && process.argv[1].endsWith('check-spec-packages.mjs');
if (isMain) process.exit(main());
