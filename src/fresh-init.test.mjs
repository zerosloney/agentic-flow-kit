#!/usr/bin/env node
// 空 git 仓库 fresh init --hosts claude：doctor 必须 exit 0，kit 写 audit:false，薄适配落盘。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = process.platform === 'win32' ? 'git.exe' : 'git';
let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-fresh-'));
spawnSync(git, ['init', '-q'], { cwd: dir });
const r = spawnSync(process.execPath, [
  path.join(ROOT, 'bin', 'flow-kit.mjs'), 'init',
  '--stack', 'none', '--hosts', 'claude', '--board-port', '8941', '--dir', dir,
], { encoding: 'utf8', timeout: 120000 });
const out = `${r.stdout || ''}${r.stderr || ''}`;
check('fresh init exit 0', r.status === 0, `exit=${r.status}\n${out.split('\n').slice(-30).join('\n')}`);
const kit = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'kit.json'), 'utf8'));
check('新装 audit 为 false 且 policyVersion 为 2', kit.audit === false && kit.policyVersion === 2, JSON.stringify({ audit: kit.audit, policyVersion: kit.policyVersion }));
// 模板下发感知初始锚（2026-10-06 template-downstream）：有包源模板对应的 owned 条目带 srcSha256＝
// 包源模板原文 LF 归一 sha；生成器目标（INDEX.md 类）排除出感知面无该键
{
  const { createHash } = await import('node:crypto');
  const tplAnchor = (rel) => kit.owned.find((f) => f.rel === rel);
  const shaOf = (buf) => createHash('sha256').update(buf).digest('hex');
  const agents = tplAnchor('AGENTS.md');
  const srcRaw = fs.readFileSync(path.join(ROOT, 'templates', 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n');
  check('新装 owned 模板条目带 srcSha256 且等于包源原文 sha（AGENTS.md）',
    agents && typeof agents.srcSha256 === 'string' && agents.srcSha256 === shaOf(Buffer.from(srcRaw, 'utf8')),
    JSON.stringify(agents || null));
  check('新装生成器目标无锚（wiki/INDEX.md 排除出感知面）',
    tplAnchor('wiki/INDEX.md') !== undefined && tplAnchor('wiki/INDEX.md').srcSha256 === undefined);
  const cfg = tplAnchor('.agents/hooks/commit-check.config.json');
  check('新装无包源模板对应条目无锚（生成类配置不参与感知）', cfg !== undefined && cfg.srcSha256 === undefined);
  const rb = tplAnchor('.agents/rule-budgets.txt');
  check('新装 _agents 前缀翻译参与感知（rule-budgets 带锚）', rb !== undefined && typeof rb.srcSha256 === 'string');
}
check('claude 命令与角色薄适配落盘',
  fs.existsSync(path.join(dir, '.claude', 'commands', 'wf-plan.md'))
  && fs.existsSync(path.join(dir, '.claude', 'agents', 'implementer.md')));
const hooks = spawnSync(git, ['config', 'core.hooksPath'], { cwd: dir, encoding: 'utf8' });
check('钩子已挂到 .githooks', hooks.stdout.trim() === '.githooks', hooks.stdout);
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
