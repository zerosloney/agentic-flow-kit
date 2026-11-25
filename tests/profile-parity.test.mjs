import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import { STACK_ORDER } from '../src/install/stack-registry.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

test('every stack profile in templates has product-gates, project-faces, and stack rule layer', () => {
  for (const stack of STACK_ORDER) {
    const profileDir = path.join(KIT, 'templates', 'profiles', stack);
    assert.ok(fs.existsSync(profileDir), `Profile dir missing for stack: ${stack}`);

    const productGates = path.join(profileDir, '.agents', 'config', 'product-gates.json');
    assert.ok(fs.existsSync(productGates), `product-gates.json missing for stack: ${stack}`);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(productGates, 'utf8')), `Invalid JSON in ${productGates}`);

    const projectFaces = path.join(profileDir, '.agents', 'config', 'project-faces.json');
    assert.ok(fs.existsSync(projectFaces), `project-faces.json missing for stack: ${stack}`);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(projectFaces, 'utf8')), `Invalid JSON in ${projectFaces}`);

    const stackRule = path.join(profileDir, '.agents', 'rules', `stack.${stack}.json`);
    assert.ok(fs.existsSync(stackRule), `stack.${stack}.json missing for stack: ${stack}`);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(stackRule, 'utf8')), `Invalid JSON in ${stackRule}`);
  }
});

test('fresh install for each stack registers its own stack rule layer in doctor', () => {
  for (const stack of ['node', 'rust', 'go', 'python']) {
    const dir = makeTmp(`parity-${stack}-`);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    const r = run(['install', '--agent', 'claude', '--stack', stack, '--lang', 'zh-CN', '--target', '.'], dir);
    assert.equal(r.status, 0, r.stderr);

    const doc = run(['doctor', '--target', '.', '--json'], dir);
    assert.equal(doc.status, 0, doc.stderr);
    const parsed = JSON.parse(doc.stdout);
    const rulesRow = parsed.checks?.find((row) => row.name === 'rules');
    assert.ok(rulesRow, `doctor rules row not found for ${stack}`);
    assert.match(rulesRow.detail, new RegExp(`stack\\.${stack}`), `Rules layers should include stack.${stack}`);
  }
});
