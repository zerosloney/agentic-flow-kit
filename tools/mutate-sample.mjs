#!/usr/bin/env node
// mutate-sample — 策展变异抽样：对核心判据逐个注入语义变异，跑目标测试，确认断言真的会红。
// 口径：存活 = 断言盲区；漂移（find 串找不到/不唯一）= 变异体失效，同样判红。
// 安全：只改 MUTANTS 声明的文件；目标文件有未提交改动时拒跑；无论成败都在 finally 还原原始字节。
// 用法：node tools/mutate-sample.mjs [--list] [--json] [--filter <id 子串>] [--timeout <ms>]
// 零依赖；退出码 1 = 有存活/跳过/漂移/错误。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..");

// 策展清单：每条都对应一个「测试没它就会静默放过」的语义点。新增条目必须同时能杀掉。
export const MUTANTS = [
  {
    id: "glob-star-crosses-slash",
    file: "src/rules/glob.mjs",
    find: "re += '[^/]*';",
    replace: "re += '.*';",
    tests: ["tests/rules-yaml.test.mjs"],
    why: "* 不得跨 /（否则 src/*.js 误收 src/x/b.js）",
  },
  {
    id: "glob-doublestar-needs-dir",
    file: "src/rules/glob.mjs",
    find: "re += '(?:.*/)?';",
    replace: "re += '(?:.*/)+';",
    tests: ["tests/rules-yaml.test.mjs"],
    why: "**/ 必须匹配零级目录（否则 src/**/*.js 漏掉 src/a.js）",
  },
  {
    id: "jsonc-escape-quote",
    file: "src/rules/jsonc.mjs",
    find: "else if (ch === '\\\\') escape = true;",
    replace: "else if (false) escape = true;",
    tests: ["tests/rules-jsonc.test.mjs"],
    why: "字符串内转义引号不得提前结束字符串",
  },
  {
    id: "jsonc-trailing-bracket",
    file: "src/rules/jsonc.mjs",
    find: "if (src[j] === '}' || src[j] === ']') {",
    replace: "if (src[j] === '}') {",
    tests: ["tests/rules-jsonc.test.mjs"],
    why: "数组尾逗号必须同样被容忍",
  },
  {
    id: "yaml-comment-whitespace-guard",
    file: "src/rules/yaml.mjs",
    find: "if (i === 0 || /\\s/.test(raw[i - 1])) {",
    replace: "if (true) {",
    tests: ["tests/yaml.test.mjs"],
    why: "未前置空白的 # 不是注释（URL fragment 不得被截断）",
  },
  {
    id: "kernel-no-crlf-normalize",
    file: "src/kernel/index.mjs",
    find: "const normalizeEol = (text) => String(text).replace(/\\r\\n/g, '\\n');",
    replace: "const normalizeEol = (text) => String(text);",
    tests: ["tests/kernel.test.mjs"],
    why: "判据摘要必须 CRLF→LF 归一（双平台一致）",
  },
  {
    id: "gate-summary-invert-state",
    file: "src/install/gate-summary.mjs",
    find: "states.set(id, 'configured');",
    replace: "states.set(id, 'missing');",
    tests: ["tests/gate-summary.test.mjs"],
    why: "已配置门禁必须归类 configured",
  },
  {
    id: "metrics-missing-data-silent",
    file: "src/install/metrics.mjs",
    find: "if (metrics.dora.changeFailureRate == null) {",
    replace: "if (false) {",
    tests: ["tests/metrics.test.mjs", "tests/gate.test.mjs"],
    why: "阈值已声明而指标缺失必须 fail-closed，不得静默跳过",
  },
  {
    id: "gate-notary-missing-key",
    file: "src/ci/gate.mjs",
    find: "if (!pubKey) {\n      violations.push(t('gate.notaryMissingKey', { file: 'attestation.sig' })",
    replace: "if (false) {\n      violations.push(t('gate.notaryMissingKey', { file: 'attestation.sig' })",
    tests: ["tests/gate-guards.test.mjs"],
    why: "有签名无公钥必须判 failed 并点名签名文件",
  },
  {
    id: "gate-policy-unsynced",
    file: "src/ci/gate.mjs",
    find: "if (policy.remotePolicyServer && !policy.lastSyncedAt) {",
    replace: "if (false) {",
    tests: ["tests/gate-guards.test.mjs"],
    why: "远程策略未同步必须 warned 并给同步提示",
  },
  {
    id: "gate-handoff-problems-source",
    file: "src/ci/gate.mjs",
    find: "error: (verifyRes.problems || []).join('; '),",
    replace: "error: verifyRes.reason,",
    tests: ["tests/gate-guards.test.mjs"],
    why: "交接信封违规原因必须取 problems，不得渲染 undefined",
  },
  {
    id: "derived-claim-blind-write",
    file: "src/install/apply.mjs",
    find: "        existing = readText(abs);",
    replace: "        existing = text;",
    tests: ["tests/adopt.test.mjs"],
    why: "认领派生工件不得盲写模板（issue #86：INDEX.md 锚点外手工区被覆盖）",
  },
  {
    id: "derived-whole-file-guard",
    file: "src/install/apply.mjs",
    find: "      if (derivedMode === 'whole' && managedHash && managedHash !== currentHash) {",
    replace: "      if (false) {",
    tests: ["tests/adopt.test.mjs"],
    why: "用户改过整文件生成的派生工件时必须保留原文并跳过重生成（不得静默吃数据）",
  },
  {
    id: "diff-overwritten-hint",
    file: "src/commands/diff.mjs",
    find: "      ...(overwritten ? { overwritten } : {}),",
    replace: "      ...(false ? { overwritten } : {}),",
    tests: ["tests/adopt.test.mjs"],
    why: "diff 必须携带 overwritten 提示（有 git 证据时点名受损仓）",
  },
  {
    id: "overwritten-needs-git-evidence",
    file: "src/install/derived.mjs",
    find: "  if (normEol(prev.before) === normEol(tpl.before)) return null;",
    replace: "  if (false) return null;",
    tests: ["tests/adopt.test.mjs"],
    why: "受损判定必须有 git 证据（否则每个健康新装户都被误报）",
  },
  {
    id: "force-discard-warn",
    file: "src/install/apply.mjs",
    find: "        const discarded = countDiscardableLines(existing, derivedMode);",
    replace: "        const discarded = 0;",
    tests: ["tests/adopt.test.mjs"],
    why: "--force 覆盖派生工件必须报出丢弃的非生成内容行数（issue #86）",
  },
];

/** 在原文里找唯一匹配并替换；同时兼容 LF 与 CRLF 目标文件。返回新文本或 null（缺失/不唯一）。 */
export function applyFind(text, find, replace) {
  const variants = find.includes("\n") ? [find, find.replaceAll("\n", "\r\n")] : [find];
  for (const variant of variants) {
    const first = text.indexOf(variant);
    if (first < 0) continue;
    if (text.indexOf(variant, first + variant.length) >= 0) return null;
    return text.slice(0, first) + replace + text.slice(first + variant.length);
  }
  return null;
}

/** 变异体漂移校验：文件/测试存在，find 串唯一命中。返回问题列表。 */
export function validateMutants(root = DEFAULT_ROOT, mutants = MUTANTS) {
  const problems = [];
  for (const m of mutants) {
    const abs = path.join(root, m.file);
    if (!fs.existsSync(abs)) {
      problems.push(`${m.id}: 目标文件不存在 ${m.file}`);
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    const variants = m.find.includes("\n") ? [m.find, m.find.replaceAll("\n", "\r\n")] : [m.find];
    const hits = variants.reduce((n, v) => n + (v && text.split(v).length - 1), 0);
    if (hits === 0) problems.push(`${m.id}: find 串在 ${m.file} 中找不到（漂移）`);
    else if (hits > 1) problems.push(`${m.id}: find 串在 ${m.file} 中命中 ${hits} 次（不唯一）`);
    for (const t of m.tests) {
      if (!fs.existsSync(path.join(root, t))) problems.push(`${m.id}: 测试文件不存在 ${t}`);
    }
  }
  return problems;
}

/** 目标文件是否有未提交改动（有则拒跑，避免覆盖用户工作）。 */
export function isDirty(root, file) {
  const r = spawnSync("git", ["diff", "--quiet", "--", file], { cwd: root, encoding: "utf8" });
  if (r.status === 0) return false;
  if (r.status === 1) return true;
  return null; // git 不可用/非仓：按未知处理，调用方拒跑
}

function defaultSpawnTests({ root, mutant, timeoutMs }) {
  return spawnSync(process.execPath, ["--test", ...mutant.tests], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  });
}

/** 跑单个变异体：注入 → 跑测试 → finally 还原。 */
export function runMutant({
  root = DEFAULT_ROOT,
  mutant,
  timeoutMs = 180000,
  spawnTests = defaultSpawnTests,
  dirtyCheck = isDirty,
} = {}) {
  const abs = path.join(root, mutant.file);
  const started = Date.now();
  const dirty = dirtyCheck(root, mutant.file);
  if (dirty !== false) {
    return { id: mutant.id, status: "SKIP", reason: dirty === true ? "目标文件有未提交改动" : "无法确认 git 状态", durationMs: Date.now() - started };
  }
  const original = fs.readFileSync(abs, "utf8");
  const mutated = applyFind(original, mutant.find, mutant.replace);
  if (mutated === null) {
    return { id: mutant.id, status: "SKIP", reason: "find 串缺失或不唯一（漂移）", durationMs: Date.now() - started };
  }

  const restoreFn = () => fs.writeFileSync(abs, original, "utf8");
  process.once("exit", restoreFn);
  let result;
  try {
    fs.writeFileSync(abs, mutated, "utf8");
    const r = spawnTests({ root, mutant, timeoutMs });
    if (r.error && r.error.code === "ETIMEDOUT") {
      result = { id: mutant.id, status: "ERROR", reason: "测试超时", durationMs: Date.now() - started };
    } else {
      result = { id: mutant.id, status: r.status === 0 ? "SURVIVED" : "KILLED", durationMs: Date.now() - started };
    }
  } finally {
    restoreFn();
    process.removeListener("exit", restoreFn);
  }
  return result;
}

export function selectMutants(filter, mutants = MUTANTS) {
  if (!filter) return mutants;
  return mutants.filter((m) => m.id.includes(filter));
}

/** 跑一轮抽样，返回 { ok, results, summary, problems }。 */
export function runSample({
  root = DEFAULT_ROOT,
  filter = "",
  timeoutMs = 180000,
  mutants = MUTANTS,
  spawnTests = defaultSpawnTests,
  dirtyCheck = isDirty,
} = {}) {
  const selected = selectMutants(filter, mutants);
  const problems = validateMutants(root, selected);
  const results = problems.length
    ? []
    : selected.map((mutant) => runMutant({ root, mutant, timeoutMs, spawnTests, dirtyCheck }));
  const summary = { total: results.length, killed: 0, survived: 0, skipped: 0, errors: 0 };
  for (const r of results) {
    if (r.status === "KILLED") summary.killed += 1;
    else if (r.status === "SURVIVED") summary.survived += 1;
    else if (r.status === "SKIP") summary.skipped += 1;
    else summary.errors += 1;
  }
  const ok = problems.length === 0 && summary.survived === 0 && summary.skipped === 0 && summary.errors === 0;
  return { ok, results, summary, problems };
}

function parseArgs(argv) {
  const opts = { list: false, json: false, filter: "", timeoutMs: 180000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--list") opts.list = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--filter") opts.filter = argv[++i] || "";
    else if (a === "--timeout") opts.timeoutMs = Number(argv[++i]) || opts.timeoutMs;
  }
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.list) {
    for (const m of selectMutants(opts.filter)) console.log(`${m.id}  ${m.file}  (${m.why})`);
    process.exit(0);
  }
  const report = runSample({ filter: opts.filter, timeoutMs: opts.timeoutMs });
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const p of report.problems) console.log(`[mutate] PROBLEM ${p}`);
    for (const r of report.results) {
      const tail = r.reason ? ` (${r.reason})` : "";
      console.log(`[mutate] ${r.status} ${r.id}${tail} ${r.durationMs}ms`);
    }
    const s = report.summary;
    console.log(`[mutate] killed=${s.killed} survived=${s.survived} skipped=${s.skipped} errors=${s.errors}`);
  }
  process.exit(report.ok ? 0 : 1);
}
