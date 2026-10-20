// regen-ledgers.test.mjs — 重生成步骤单源与执行缝回归（2026-10-20，kit 适配）
// 钉死三件事：①四步骤齐全且顺序稳定（INDEX → metrics → verify-evidence → delegations 快照打印）
// ②执行按序逐个 spawn、全绿才汇总成功 ③fail-fast：首败即停不再 spawn 下游。
// kit 适配点：第四步是 agg-delegations.cjs 打印回贴口径（源仓为 --write 自动回写），无 --write 参数。
import assert from 'node:assert/strict';
import { buildSteps, runSteps } from './regen-ledgers.mjs';

let pass = 0;
const ok = (name) => { pass++; console.log(`PASS  ${name}`); };

// 场景 1：四步骤齐全、顺序稳定、CLI 参数正确（kit 口径：第四步 .cjs 无参）
{
  const steps = buildSteps();
  assert.equal(steps.length, 4);
  assert.match(steps[0].args[0], /gen-workflow-index\.mjs$/);
  assert.match(steps[1].args[0], /gen-workflow-metrics\.mjs$/);
  assert.match(steps[2].args[0], /gen-verify-evidence\.mjs$/);
  assert.deepEqual(steps[3].args, ['.agents/scripts/agg-delegations.cjs']);
  ok('场景 1：四步骤齐全且顺序稳定（第四步 cjs 打印口径）');
}

// 场景 2：全绿 → 4 次 spawn、成功汇总
{
  const calls = [];
  const fakeSpawn = (bin, args) => { calls.push(args[0]); return { status: 0 }; };
  const results = runSteps(buildSteps(), fakeSpawn);
  assert.equal(calls.length, 4);
  assert.equal(results.filter((r) => r.ok).length, 4);
  ok('场景 2：全绿时 4 步逐个执行');
}

// 场景 3：fail-fast —— 首败即停，下游不再 spawn
{
  const calls = [];
  const fakeSpawn = (bin, args) => { calls.push(args[0]); return { status: args[0].includes('gen-workflow-index') ? 1 : 0 }; };
  const results = runSteps(buildSteps(), fakeSpawn);
  assert.equal(calls.length, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  ok('场景 3：fail-fast 首败即停');
}

console.log(`\n合计: PASS ${pass} / FAIL 0`);
