// derived-placeholder.test.mjs — issue #86 检测面 A：
// 「新装户占位头 + 生成区已有真实数据」必须判漂移；健康态/合法新装户不得误报。
// 模板侧（gen-workflow-index.mjs）与安装器侧（src/install/derived-placeholder.mjs）双实现交叉校验。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmp } from "./helpers/tmp.mjs";
import { detectPlaceholderDrift as srcDetect, countOutsideAnchorLines } from "../src/install/derived-placeholder.mjs";
import { detectPlaceholderDrift as genDetect } from "../templates/engine/.agents/scripts/gen-workflow-index.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GEN = path.join(KIT, "templates", "engine", ".agents", "scripts", "gen-workflow-index.mjs");
const TEMPLATE = fs.readFileSync(path.join(KIT, "templates", "scaffold", "workflow", "INDEX.md"), "utf8");

const write = (root, rel, text) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
};

const doc = (status = "draft") => `---\n状态: ${status}\n级别: L2\n日期: 2026-11-26\n模块: engine\n---\n\n# INTENT — demo\n`;

function project({ withDoc = true } = {}) {
  const root = makeTmp("fk-derived-placeholder-");
  spawnSync("git", ["init", "-q"], { cwd: root });
  for (const dir of ["intents", "specs", "plans", "incidents"]) fs.mkdirSync(path.join(root, "workflow", dir), { recursive: true });
  if (withDoc) write(root, "workflow/intents/2026-11-26-demo.md", doc());
  return root;
}

const runGen = (root, args = []) =>
  spawnSync(process.execPath, [GEN, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, FLOW_KIT_TEST: "1" } });

test("双实现同口径：模板占位/混合态/正常态判定一致", () => {
  const root = project();
  const generated = runGen(root);
  assert.equal(generated.status, 0, generated.stderr);
  const healthy = fs.readFileSync(path.join(root, "workflow", "INDEX.md"), "utf8");

  const mixed = TEMPLATE.slice(0, TEMPLATE.indexOf("<!-- GENERATED:BEGIN")) + healthy.slice(healthy.indexOf("<!-- GENERATED:BEGIN"));
  const userHeader = "# 我的索引\n\n> 手工说明。\n\n" + healthy.slice(healthy.indexOf("<!-- GENERATED:BEGIN"));
  const fixtures = [TEMPLATE, healthy, mixed, userHeader, "no anchors at all\n"];

  for (const text of fixtures) {
    assert.deepEqual(srcDetect(text), genDetect(text));
  }
  assert.equal(srcDetect(TEMPLATE), null, "合法新装户占位（生成区全 0）不得误报");
  assert.equal(srcDetect(mixed)?.counts.active, 1, "混合态必须识别出生成区已有数据");
  assert.equal(srcDetect(userHeader), null, "用户自写头不得误报");
});

test("生成器 --check：混合态 exit 1 且点名 issue #86", () => {
  const root = project();
  const first = runGen(root);
  assert.equal(first.status, 0, first.stderr);

  const healthy = fs.readFileSync(path.join(root, "workflow", "INDEX.md"), "utf8");
  const mixed = TEMPLATE.slice(0, TEMPLATE.indexOf("<!-- GENERATED:BEGIN")) + healthy.slice(healthy.indexOf("<!-- GENERATED:BEGIN"));
  write(root, "workflow/INDEX.md", mixed);

  const check = runGen(root, ["--check"]);
  assert.equal(check.status, 1, check.stdout + check.stderr);
  assert.match(check.stderr, /新装户占位/);
  assert.match(check.stderr, /issue #86/);
  assert.match(check.stderr, /活跃 1/);
});

test("生成器 --check：健康生成物 exit 0；正常生成对混合态打 warn 但不阻断", () => {
  const root = project();
  assert.equal(runGen(root).status, 0);
  const healthy = fs.readFileSync(path.join(root, "workflow", "INDEX.md"), "utf8");

  const ok = runGen(root, ["--check"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);

  const mixed = TEMPLATE.slice(0, TEMPLATE.indexOf("<!-- GENERATED:BEGIN")) + healthy.slice(healthy.indexOf("<!-- GENERATED:BEGIN"));
  write(root, "workflow/INDEX.md", mixed);
  const regen = runGen(root);
  assert.equal(regen.status, 0, regen.stderr);
  assert.match(regen.stderr, /issue #86/);
});

test("countOutsideAnchorLines：只数锚点外非空行", () => {
  const text = "# 头\n\n> 说明\n\n<!-- GENERATED:BEGIN — x -->\n\n| INTENT |\n\n<!-- GENERATED:END -->\n\n尾部\n";
  assert.equal(countOutsideAnchorLines(text), 3);
  assert.equal(countOutsideAnchorLines("no anchors\n"), 0);
});

