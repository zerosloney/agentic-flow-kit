#!/usr/bin/env node
// policy-check.mjs — CI / 本地一键校验策略面（R3-1）。
// 在临时目录做一次真实安装，然后运行目标内的 policy.mjs check 与 effective-policy 生成/防漂移，
// 不改动当前仓库；任何一步失败即退出 1。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const target = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-policy-'));

const run = (args, cwd = target) => spawnSync(process.execPath, args, {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, FLOW_KIT_TEST: '1' },
  windowsHide: true,
});

const fail = (message, result) => {
  console.error(`[policy-ci] ❌ ${message}`);
  if (result?.stdout) console.error(result.stdout.trim());
  if (result?.stderr) console.error(result.stderr.trim());
  process.exitCode = 1;
};

try {
  const git = spawnSync('git', ['init', '-q'], { cwd: target, encoding: 'utf8', windowsHide: true });
  if (git.status !== 0) throw new Error(`git init 失败: ${git.stderr || git.status}`);

  const install = run([BIN, 'install', '--agent', 'claude', '--stack', 'node', '--target', '.', '--json']);
  if (install.status !== 0) {
    fail('临时目标安装失败', install);
  } else {
    const check = run([path.join(target, '.agents', 'scripts', 'policy.mjs'), 'check', '--root', target, '--json']);
    const parsed = (() => {
      try { return JSON.parse(check.stdout.trim()); } catch { return null; }
    })();
    if (check.status !== 0 || !parsed) {
      fail('policy check 未通过', check);
    } else if (!parsed.ok) {
      fail(`policy check 发现 ${parsed.problems.length} 项问题`, check);
      for (const problem of parsed.problems) console.error(`  [${problem.code}] ${problem.message}`);
    } else {
      const generate = run([path.join(target, '.agents', 'scripts', 'gen-effective-policy.mjs'), '--root', target]);
      if (generate.status !== 0) {
        fail('effective-policy 生成失败', generate);
      } else {
        const drift = run([path.join(target, '.agents', 'scripts', 'gen-effective-policy.mjs'), '--root', target, '--check']);
        if (drift.status !== 0) fail('effective-policy 与生成器不一致', drift);
        else console.log(`[policy-ci] ✅ 策略面一致（机制 ${parsed.summary.mechanisms?.total || 0} 行）`);
      }
    }
  }
} catch (error) {
  fail(error.message);
} finally {
  fs.rmSync(target, { recursive: true, force: true });
}
