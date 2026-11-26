// coverage-gate.test.mjs — 覆盖率门自身：表格解析、阈值/缺席判定、豁免原因校验、git 变更集、CLI 退出码。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmp } from "./helpers/tmp.mjs";
import { parseCoverageTable, parseAllowlist, changedFiles, evaluate, runGate } from "../tools/coverage-gate.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = path.join(KIT, "tools", "coverage-gate.mjs");

const LOG = `ℹ start of coverage report
ℹ ------------------------------------------------------------------
ℹ file                     | line % | branch % | funcs % | uncovered lines
ℹ ------------------------------------------------------------------
ℹ bin
ℹ  flow-kit.mjs            |  92.86 |    75.00 |  100.00 | 12
ℹ src
ℹ  ci
ℹ   gate.mjs               |  82.02 |    64.29 |   95.24 | 26-27
ℹ  rules
ℹ   glob.mjs               |  92.68 |    64.71 |  100.00 |
ℹ  install
ℹ   low.mjs                |  10.00 |     0.00 |    0.00 | 1-9
ℹ all files                |  82.53 |    68.27 |   82.21 |
ℹ end of coverage report
`;

function writeLog(root = makeTmp("fk-covgate-")) {
  const file = path.join(root, "coverage.log");
  fs.writeFileSync(file, LOG, "utf8");
  return file;
}

function git(root, ...args) {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test("parseCoverageTable：嵌套目录还原为相对路径，汇总行不入表", () => {
  const rows = parseCoverageTable(LOG);
  assert.deepEqual([...rows.keys()].sort(), ["bin/flow-kit.mjs", "src/ci/gate.mjs", "src/install/low.mjs", "src/rules/glob.mjs"]);
  assert.deepEqual(rows.get("src/ci/gate.mjs"), { lines: 82.02, branches: 64.29, funcs: 95.24 });
  assert.equal(rows.has("all files"), false);
});

test("parseAllowlist：支持 entries 包裹与扁平映射；缺原因即报错", () => {
  assert.deepEqual(parseAllowlist('{"entries":{"src/a.mjs":"spawn-only"}}'), { "src/a.mjs": "spawn-only" });
  assert.deepEqual(parseAllowlist('{"src/a.mjs":"spawn-only"}'), { "src/a.mjs": "spawn-only" });
  assert.throws(() => parseAllowlist('{"src/a.mjs":""}'), /缺少原因/);
  assert.throws(() => parseAllowlist('{"entries":[]}'), /必须是对象/);
});

test("evaluate：scope 内逐条判定——达标/低于阈值/未被加载/豁免", () => {
  const rows = parseCoverageTable(LOG);
  const changed = [
    "src/ci/gate.mjs",
    "src/rules/glob.mjs",
    "src/install/low.mjs",
    "src/missing.mjs",
    "docs/x.md",
    "tests/x.test.mjs",
    "templates/engine/a.mjs",
  ];

  const strict = evaluate({ rows, changed, threshold: 60 });
  assert.equal(strict.checked, 4);
  assert.deepEqual(strict.failures.map((f) => [f.file, f.reason]), [
    ["src/install/low.mjs", "below-threshold"],
    ["src/missing.mjs", "not-loaded"],
  ]);
  assert.equal(strict.ok, false);

  const waived = evaluate({ rows, changed, threshold: 60, allowlist: { "src/install/low.mjs": "spawn-only 执行" } });
  assert.deepEqual(waived.exempt.map((e) => e.file), ["src/install/low.mjs"]);
  assert.deepEqual(waived.failures.map((f) => f.file), ["src/missing.mjs"]);
});

test("evaluate：恰好等于阈值算通过（>= 口径）", () => {
  const rows = new Map([["src/a.mjs", { lines: 60, branches: 0, funcs: 0 }]]);
  const r = evaluate({ rows, changed: ["src/a.mjs"], threshold: 60 });
  assert.equal(r.ok, true);
  assert.equal(r.passed.length, 1);
});

test("changedFiles：since...HEAD 的提交变更 ∪ 工作树变更", () => {
  const root = makeTmp("fk-covgate-git-");
  git(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "a.mjs"), "export const a = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "c0");
  fs.writeFileSync(path.join(root, "b.mjs"), "export const b = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "c1");
  fs.writeFileSync(path.join(root, "c.mjs"), "export const c = 1;\n");

  const files = changedFiles({ root, since: "HEAD~1" });
  assert.deepEqual(files, ["b.mjs", "c.mjs"]);
});

test("runGate：日志缺失/空表 → 抛错（不静默放行）", () => {
  assert.throws(() => runGate({ logPath: path.join(makeTmp("fk-covgate-none-"), "nope.log") }), /覆盖日志不存在/);
  const empty = path.join(makeTmp("fk-covgate-empty-"), "empty.log");
  fs.writeFileSync(empty, "no report here\n");
  assert.throws(() => runGate({ logPath: empty, files: ["src/a.mjs"] }), /没有解析到任何文件/);
});

test("CLI：失败退出 1、通过退出 0、--json 带失败原因", () => {
  const logPath = writeLog();
  const fail = spawnSync(
    process.execPath,
    [TOOL, "--log", logPath, "--files", "src/install/low.mjs,src/missing.mjs", "--json"],
    { encoding: "utf8" },
  );
  assert.equal(fail.status, 1, fail.stderr);
  const report = JSON.parse(fail.stdout);
  assert.equal(report.ok, false);
  assert.deepEqual(report.failures.map((f) => f.reason), ["below-threshold", "not-loaded"]);

  const pass = spawnSync(process.execPath, [TOOL, "--log", logPath, "--files", "src/rules/glob.mjs"], {
    encoding: "utf8",
  });
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(pass.stdout, /变更 1 个 src\/ 文件/);

  const badInput = spawnSync(process.execPath, [TOOL, "--log", path.join(makeTmp("fk-covgate-miss-"), "x.log")], {
    encoding: "utf8",
  });
  assert.equal(badInput.status, 2);
  assert.match(badInput.stderr, /覆盖日志不存在/);
});
