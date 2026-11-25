// conformance-matrix.test.mjs — 泛化形态一致性矩阵（G14）：
// 代表栈 × 中英双语：装户 → doctor 全过 → verify --list 可用 → 装户输出带门禁配置报告。
// 目的：守住「任意栈 + 任意语言都能装上并自洽」，防止某个画像/语言覆盖掉队（如新增栈漏配置）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');

function tmpRepo() {
  const dir = makeTmp('flow-kit-conformance-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
  });
}

const CASES = [
  ['node', 'package.json', '{"name":"conformance-node","scripts":{"test":"node -e 0"}}\n'],
  ['typescript', 'tsconfig.json', '{}\n'],
  ['rust', 'Cargo.toml', '[package]\nname = "conformance"\nversion = "0.1.0"\n'],
  ['python', 'pyproject.toml', '[project]\nname = "conformance"\nversion = "0.1.0"\n'],
];

for (const [stack, marker, body] of CASES) {
  for (const lang of ['zh-CN', 'en']) {
    test(`${stack} / ${lang}: install → doctor → verify --list`, () => {
      const dir = tmpRepo();
      fs.writeFileSync(path.join(dir, marker), body);

      const install = run(['install', '--agent', 'claude', '--stack', stack, '--lang', lang, '--target', '.'], dir);
      assert.equal(install.status, 0, install.stderr);
      const installOut = `${install.stdout}${install.stderr}`;
      assert.match(installOut, lang === 'en' ? /Gate config:/ : /门禁配置：/);

      const doctor = run(['doctor', '--target', '.'], dir);
      assert.equal(doctor.status, 0, `${doctor.stdout}${doctor.stderr}`);

      const list = run(['run', 'verify', '--list'], dir);
      assert.equal(list.status, 0, list.stderr);
      assert.ok(list.stdout.trim().length > 0, 'verify --list should list at least engine gates');
    });
  }
}
