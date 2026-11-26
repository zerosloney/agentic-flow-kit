#!/usr/bin/env node
// coverage-gate — 变更文件覆盖率门：只对「本次变更的 src 文件」要求覆盖下限，防新代码靠 spawn 测试绕过统计。
// 输入 = `node --test --experimental-test-coverage` 的输出日志；变更集 = git diff（since...HEAD ∪ 工作树）。
// 判定：变更的 src/*.mjs 必须在覆盖表里出现（未被任何测试加载 = not-loaded），且行覆盖 >= 阈值（默认 60）。
// 豁免：tools/coverage-allowlist.json 的 entries（每条必须写原因）；spawn-only 的模板脚本不在 scope 内。
// 用法：node tools/coverage-gate.mjs --log coverage.log --since origin/main [--threshold 60] [--scope src/]
//        [--allow tools/coverage-allowlist.json] [--files a.mjs,b.mjs] [--json]
// 退出码：0 通过 / 1 有失败 / 2 输入或 git 引用错误。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..");
const DEFAULT_ALLOWLIST = path.join(HERE, "coverage-allowlist.json");

/** 解析 node --experimental-test-coverage 的嵌套表格；返回 Map<相对路径, {lines,branches,funcs}>。 */
export function parseCoverageTable(text) {
  const rows = new Map();
  const stack = [];
  let inReport = false;
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.includes("start of coverage report")) {
      inReport = true;
      continue;
    }
    if (raw.includes("end of coverage report")) break;
    if (!inReport || !raw.startsWith("ℹ")) continue;
    const body = raw.slice(1);
    const indent = body.match(/^ */)[0].length;
    const rest = body.trim();
    if (!rest || rest.startsWith("all files")) continue;
    const level = indent - 1;
    const m = rest.match(/^(.+?)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/);
    if (!m) {
      stack.length = Math.max(0, level);
      stack[level] = rest.split("|")[0].trim();
      continue;
    }
    const dir = stack.slice(0, Math.max(0, level)).filter(Boolean).join("/");
    rows.set(`${dir ? `${dir}/` : ""}${m[1].trim()}`, { lines: +m[2], branches: +m[3], funcs: +m[4] });
  }
  return rows;
}

/** 解析豁免清单：{ entries: { "path": "原因" } } 或扁平 { "path": "原因" }；原因必填。 */
export function parseAllowlist(text) {
  const parsed = JSON.parse(text);
  const entries = parsed && parsed.entries ? parsed.entries : parsed || {};
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error("allowlist 必须是对象（entries 映射）");
  }
  for (const [file, reason] of Object.entries(entries)) {
    if (typeof reason !== "string" || !reason.trim()) throw new Error(`allowlist 条目 ${file} 缺少原因`);
  }
  return entries;
}

/** 变更集：since...HEAD 的已提交变更 ∪ 相对 HEAD 的工作树变更 ∪ 未跟踪新文件。 */
export function changedFiles({ root = DEFAULT_ROOT, since = "origin/main" } = {}) {
  const base = /^0+$/.test(String(since)) ? "HEAD~1" : since;
  const out = new Set();
  for (const range of [`${base}...HEAD`, "HEAD"]) {
    const r = spawnSync("git", ["diff", "--name-only", "--diff-filter=AM", range], {
      cwd: root,
      encoding: "utf8",
    });
    if (r.status !== 0) {
      throw new Error(`git diff ${range} 失败：${(r.stderr || "").trim() || "引用不存在"}`);
    }
    for (const line of r.stdout.split(/\r?\n/)) if (line.trim()) out.add(line.trim());
  }
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  if (untracked.status !== 0) {
    throw new Error(`git ls-files 失败：${(untracked.stderr || "").trim()}`);
  }
  for (const line of untracked.stdout.split(/\r?\n/)) if (line.trim()) out.add(line.trim());
  return [...out].sort();
}

/** 判定：scope 内变更文件逐条检查「被加载 + 行覆盖 >= 阈值」，豁免需原因。 */
export function evaluate({ rows, changed, threshold = 60, scope = "src/", allowlist = {} }) {
  const files = [...new Set(changed)]
    .filter((f) => f.startsWith(scope) && f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .sort();
  const failures = [];
  const exempt = [];
  const passed = [];
  for (const file of files) {
    if (allowlist[file]) {
      exempt.push({ file, reason: allowlist[file] });
      continue;
    }
    const row = rows.get(file);
    if (!row) {
      failures.push({ file, reason: "not-loaded", detail: "未被任何测试加载（spawn 测试不计入覆盖）" });
    } else if (row.lines < threshold) {
      failures.push({ file, reason: "below-threshold", lines: row.lines, threshold });
    } else {
      passed.push({ file, ...row });
    }
  }
  return { ok: failures.length === 0, checked: files.length, threshold, scope, passed, failures, exempt };
}

/** 完整跑一次：读日志 → 取变更集 → 读豁免 → 判定。 */
export function runGate({
  root = DEFAULT_ROOT,
  logPath,
  since = "origin/main",
  threshold = 60,
  scope = "src/",
  allowlistPath = null,
  files = null,
} = {}) {
  if (!logPath || !fs.existsSync(logPath)) throw new Error(`覆盖日志不存在：${logPath || "(未提供 --log)"}`);
  const rows = parseCoverageTable(fs.readFileSync(logPath, "utf8"));
  if (rows.size === 0) throw new Error("覆盖日志里没有解析到任何文件（报告格式变了？）");
  const changed = files ? files : changedFiles({ root, since });
  let allowlist = {};
  const allowFile = allowlistPath || (fs.existsSync(DEFAULT_ALLOWLIST) ? DEFAULT_ALLOWLIST : null);
  if (allowFile && fs.existsSync(allowFile)) allowlist = parseAllowlist(fs.readFileSync(allowFile, "utf8"));
  return { ...evaluate({ rows, changed, threshold, scope, allowlist }), since, changed: changed.length };
}

function parseArgs(argv) {
  const opts = { json: false, since: "origin/main", threshold: 60, scope: "src/", allowlistPath: null, files: null, logPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--log") opts.logPath = argv[++i];
    else if (a === "--since") opts.since = argv[++i];
    else if (a === "--threshold") opts.threshold = Number(argv[++i]);
    else if (a === "--scope") opts.scope = argv[++i];
    else if (a === "--allow") opts.allowlistPath = argv[++i];
    else if (a === "--files") opts.files = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  let report;
  try {
    report = runGate(opts);
  } catch (err) {
    console.error(`[coverage-gate] ${err.message}`);
    process.exit(2);
  }
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const e of report.exempt) console.log(`[coverage-gate] EXEMPT ${e.file} — ${e.reason}`);
    for (const f of report.failures) {
      const detail = f.reason === "not-loaded" ? f.detail : `行覆盖 ${f.lines}% < ${f.threshold}%`;
      console.log(`[coverage-gate] FAIL ${f.file} — ${detail}`);
    }
    console.log(
      `[coverage-gate] ${report.ok ? "ok" : "failed"}：变更 ${report.checked} 个 ${report.scope} 文件，` +
        `通过 ${report.passed.length}，豁免 ${report.exempt.length}，失败 ${report.failures.length}（since ${report.since}）`,
    );
  }
  process.exit(report.ok ? 0 : 1);
}
