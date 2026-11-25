// tests/runtime-artifacts.test.mjs
// 引擎运行时产物必须同时登记在两处，否则会变成未跟踪改动并卡死回填门：
//   1) templates/git/.gitignore.engine —— 装户仓库侧不入库；
//   2) pipeline-run.mjs 的 RUNTIME_OWNED —— 回填时判定为运行态噪音而非「改动超出回填清单」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { isRuntimeOrManaged } from '../templates/engine/.agents/scripts/pipeline-run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitignoreEngine = fs.readFileSync(path.join(repoRoot, 'templates', 'git', '.gitignore.engine'), 'utf8');

// 引擎运行期写盘、但可能落到项目根的产物
const RUNTIME_ARTIFACTS = ['.agents/traces/', '.agents/prescriptions.jsonl'];

test('.gitignore.engine ignores engine runtime artifacts', () => {
  const entries = gitignoreEngine.split('\n').map((line) => line.trim());
  for (const rel of RUNTIME_ARTIFACTS) {
    assert.ok(entries.includes(rel), `.gitignore.engine must list ${rel}\n${gitignoreEngine}`);
  }
});

test('RUNTIME_OWNED classifies engine runtime artifacts as runtime noise', () => {
  const ctx = { root: makeTmp('pipeline-runtime-artifacts-') };

  assert.equal(isRuntimeOrManaged(ctx, '.agents/traces/run-2026-11-25.timeline.jsonl'), true);
  assert.equal(isRuntimeOrManaged(ctx, '.agents/prescriptions.jsonl'), true);

  // 非运行态产物不得被误豁免
  assert.equal(isRuntimeOrManaged(ctx, '.agents/evals/report.json'), false);
});
