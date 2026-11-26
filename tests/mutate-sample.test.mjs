// mutate-sample.test.mjs — 变异抽样器自身：漂移守卫、唯一替换、红/绿判定、还原、脏文件拒跑。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeTmp } from "./helpers/tmp.mjs";
import { applyFind, validateMutants, runMutant, runSample, selectMutants } from "../tools/mutate-sample.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture({ text = "export const a = 1;\n", testText = "test('x', () => {});\n" } = {}) {
  const root = makeTmp("fk-mutate-");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "m.mjs"), text, "utf8");
  fs.writeFileSync(path.join(root, "tests", "m.test.mjs"), testText, "utf8");
  return root;
}

const mutant = (over = {}) => ({
  id: "m-const",
  file: "src/m.mjs",
  find: "const a = 1;",
  replace: "const a = 2;",
  tests: ["tests/m.test.mjs"],
  why: "fixture",
  ...over,
});

test("策展清单无漂移：find 串唯一命中且测试文件存在", () => {
  assert.deepEqual(validateMutants(KIT), []);
});

test("applyFind：唯一替换，缺失/不唯一返回 null，兼容 CRLF 目标文件", () => {
  assert.equal(applyFind("a\nb\n", "b", "c"), "a\nc\n");
  assert.equal(applyFind("a\r\nb\r\n", "a\nb", "a\nc"), "a\nc\r\n");
  assert.equal(applyFind("a\nb", "z", "y"), null);
  assert.equal(applyFind("x x", "x", "y"), null);
});

test("runMutant：测试红 → KILLED，且原始字节被还原", () => {
  const root = fixture();
  const before = fs.readFileSync(path.join(root, "src", "m.mjs"), "utf8");

  const r = runMutant({
    root,
    mutant: mutant(),
    dirtyCheck: () => false,
    spawnTests: () => ({ status: 1 }),
  });

  assert.equal(r.status, "KILLED");
  assert.equal(fs.readFileSync(path.join(root, "src", "m.mjs"), "utf8"), before);
});

test("runMutant：测试绿 → SURVIVED（断言盲区）", () => {
  const root = fixture();
  const r = runMutant({ root, mutant: mutant(), dirtyCheck: () => false, spawnTests: () => ({ status: 0 }) });
  assert.equal(r.status, "SURVIVED");
});

test("runMutant：目标文件脏 / find 漂移 → SKIP，不写盘", () => {
  const root = fixture();
  const before = fs.readFileSync(path.join(root, "src", "m.mjs"), "utf8");

  const dirty = runMutant({ root, mutant: mutant(), dirtyCheck: () => true, spawnTests: () => ({ status: 0 }) });
  assert.equal(dirty.status, "SKIP");
  assert.match(dirty.reason, /未提交/);

  const drift = runMutant({
    root,
    mutant: mutant({ find: "not-there" }),
    dirtyCheck: () => false,
    spawnTests: () => ({ status: 0 }),
  });
  assert.equal(drift.status, "SKIP");
  assert.match(drift.reason, /漂移/);
  assert.equal(fs.readFileSync(path.join(root, "src", "m.mjs"), "utf8"), before);
});

test("runSample：有存活即 ok=false；全部被杀则 ok=true", () => {
  const root = fixture();
  const m1 = mutant({ id: "a", find: "const a = 1;", replace: "const a = 2;" });
  const m2 = mutant({ id: "b", find: "export ", replace: "export /*x*/ " });

  const survived = runSample({
    root,
    mutants: [m1, m2],
    dirtyCheck: () => false,
    spawnTests: ({ mutant: m }) => ({ status: m.id === "a" ? 1 : 0 }),
  });
  assert.equal(survived.ok, false);
  assert.deepEqual(survived.results.map((r) => r.status), ["KILLED", "SURVIVED"]);

  const killed = runSample({ root, mutants: [m1], dirtyCheck: () => false, spawnTests: () => ({ status: 1 }) });
  assert.equal(killed.ok, true);
  assert.deepEqual(killed.summary, { total: 1, killed: 1, survived: 0, skipped: 0, errors: 0 });
});

test("selectMutants 按 id 子串过滤；CLI --list 与清单一致", () => {
  assert.deepEqual(selectMutants("glob-").map((m) => m.id), ["glob-star-crosses-slash", "glob-doublestar-needs-dir"]);

  const r = spawnSync(process.execPath, [path.join(KIT, "tools", "mutate-sample.mjs"), "--list"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  for (const m of selectMutants("")) assert.match(r.stdout, new RegExp(m.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
