#!/usr/bin/env node
// check-lane-surface.test.mjs — 泳道完整性门禁 fixture 套件（2026-10-01 drift-hardening）
// 方法：现场构造临时根（workflow/{intents,incidents} + .agents/lane-surfaces.txt），经
//       --root/--branch/--staged-file 三注入位 spawn 脚本，断言 exit code 与输出关键词。
//       场景集对齐同名 spec「功能行为」表 S1-S6 + 平台边界（CRLF / 非 ASCII / detached /
//       配置语法 / 状态活性 / incident 等价），另含 1 个 git 真仓端到端（quotepath=off 实路径）。
// 用法：node templates/_agents/scripts/check-lane-surface.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPT_DIR, 'check-lane-surface.mjs');

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? '\n      ' + detail : ''}`); }
};

const mkfix = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-surface-test-'));
  for (const s of ['intents', 'incidents']) fs.mkdirSync(path.join(d, 'workflow', s), { recursive: true });
  fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
  return d;
};
const w = (root, rel, content) => fs.writeFileSync(path.join(root, rel), content);
// eol='\r\n' 时整文件按 CRLF 写（平台边界：frontmatter 读取容忍性）
const intent = (name, fm, eol = '\n') => `---${eol}${fm}${eol}---${eol}# INTENT — ${name}${eol}`;
const incident = (fm) => `---\n${fm}\n---\n# INCIDENT\n`;
const run = (root, { branch = 'main', staged = [] } = {}) => {
  const listFile = path.join(root, 'staged.txt');
  fs.writeFileSync(listFile, staged.join('\n') + '\n');
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root, '--branch', branch, '--staged-file', listFile], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// 通用 fixture：面清单 + 一个活跃 L1 intent（2026-09-28）+ 可选第二个入口
const base = (root, { level = 'L1', status = 'approved', extra = null } = {}) => {
  w(root, '.agents/lane-surfaces.txt', '^templates/\n^\\.agents/(scripts|hooks)/\n');
  w(root, 'workflow/intents/2026-09-28-old-l1.md', intent('x', `状态: ${status}\n级别: ${level}\n日期: 2026-09-28\n模块: pipeline`));
  if (extra) w(root, extra[0], intent('y', extra[1]));
};
const FM_LOW_NEW = '状态: draft\n级别: L1\n日期: 2026-10-01\n模块: ui';

// --- S1：命中 + 活跃 L2 存在 → 豁免放行 ---
{
  const d = mkfix();
  base(d, { level: 'L2' });
  const r = run(d, { staged: ['templates/_agents/scripts/x.mjs'] });
  check('S1 命中面+活跃 L2 入口 → 放行且无触达面判低输出', r.code === 0 && !r.out.includes('触达面判低'), r.out);
}
// --- S2：命中 + 活跃全为 L1（低泳道）→ 阻断 ---
{
  const d = mkfix();
  base(d);
  const r = run(d, { staged: ['templates/_agents/scripts/x.mjs', 'docs/readme.md'] });
  check('S2 命中面+仅活跃 L1 → 阻断且消息含标签/命中文件/入口名/修法',
    r.code === 1 && r.out.includes('[触达面判低]') && r.out.includes('templates/_agents/scripts/x.mjs')
      && r.out.includes('workflow/intents/2026-09-28-old-l1.md') && r.out.includes('修法'),
    r.out);
}
// --- S2b：多个低泳道（L1）活跃 → 点名最新（日期排序）---
{
  const d = mkfix();
  base(d, { extra: ['workflow/intents/2026-10-01-new-low.md', FM_LOW_NEW] });
  const r = run(d, { staged: ['templates/t.md'] });
  check('S2b 多活跃 L1 → 关联入口取最新日期件', r.code === 1 && r.out.includes('2026-10-01-new-low') && r.out.includes('共 2 件'), r.out);
}
// --- S2c：experiment 分支 → 检查 A 降级 advisory ---
{
  const d = mkfix();
  base(d);
  const r = run(d, { branch: 'experiment/poc', staged: ['templates/t.md'] });
  check('S2c experiment 分支检查 A → advisory 放行', r.code === 0 && r.out.includes('advisory·experiment'), r.out);
}
// --- S3：命中 + 无活跃入口 → advisory 放行（done 不算活跃）---
{
  const d = mkfix();
  w(d, '.agents/lane-surfaces.txt', '^templates/\n');
  w(d, 'workflow/intents/2026-09-01-closed.md', intent('c', '状态: done\n级别: L1\n日期: 2026-09-01\n模块: ui'));
  const r = run(d, { staged: ['templates/t.md'] });
  check('S3 命中+无活跃（done 不算活跃）→ advisory 放行', r.code === 0 && r.out.includes('无任何活跃入口'), r.out);
}
// --- S4b：experiment 分支 intent 缺标记 → 阻断；补标记放行 ---
{
  const d = mkfix();
  w(d, 'workflow/intents/2026-10-01-poc.md', intent('p', '状态: draft\n级别: L1\n日期: 2026-10-01\n模块: ui'));
  const r1 = run(d, { branch: 'experiment/poc', staged: ['workflow/intents/2026-10-01-poc.md'] });
  check('S4b-1 experiment 分支无标记 intent → 阻断且含修法',
    r1.code === 1 && r1.out.includes('[探索标记缺失]') && r1.out.includes('阶段: exploring'), r1.out);
  w(d, 'workflow/intents/2026-10-01-poc.md', intent('p', '状态: draft\n级别: L1\n日期: 2026-10-01\n模块: ui\n阶段: exploring'));
  const r2 = run(d, { branch: 'experiment/poc', staged: ['workflow/intents/2026-10-01-poc.md'] });
  check('S4b-2 补「阶段: exploring」后放行', r2.code === 0, r2.out);
}
// --- S4b-c：口径同加固门——「状态: exploring」亦认 ---
{
  const d = mkfix();
  w(d, 'workflow/intents/2026-10-01-poc.md', intent('p', '状态: exploring\n级别: L1\n日期: 2026-10-01\n模块: ui'));
  const r = run(d, { branch: 'experiment/poc', staged: ['workflow/intents/2026-10-01-poc.md'] });
  check('S4b-c 「状态: exploring」亦认（口径同加固门）', r.code === 0, r.out);
}
// --- S6：非 experiment 分支 → 检查 B 不触发 ---
{
  const d = mkfix();
  w(d, 'workflow/intents/2026-10-01-poc.md', intent('p', '状态: draft\n级别: L1\n日期: 2026-10-01\n模块: ui'));
  const r = run(d, { branch: 'main', staged: ['workflow/intents/2026-10-01-poc.md'] });
  check('S6 非 experiment 分支无标记 intent → 放行（B 不触发）', r.code === 0 && !r.out.includes('探索标记缺失'), r.out);
}
// --- S5：配置缺失 → 检查 A 整体静默跳过（装户无感）---
{
  const d = mkfix();
  w(d, 'workflow/intents/2026-09-28-l1.md', intent('x', '状态: approved\n级别: L1\n日期: 2026-09-28\n模块: ui'));
  const r = run(d, { staged: ['templates/t.md'] });
  check('S5 无 lane-surfaces.txt → 静默跳过', r.code === 0 && r.out.trim() === '', JSON.stringify(r.out));
}
// --- incident 等价：open incident L2 豁免；fixed L1 算活跃低级 ---
{
  const d = mkfix();
  w(d, '.agents/lane-surfaces.txt', '^src/\n');
  w(d, 'workflow/incidents/2026-09-30-inc.md', incident('状态: open\n级别: L2\n发现: 2026-09-30\n模块: backend'));
  const r = run(d, { staged: ['src/a.ts'] });
  check('incident 等价：活跃 open incident L2 → 豁免放行', r.code === 0, r.out);
}
{
  const d = mkfix();
  w(d, '.agents/lane-surfaces.txt', '^src/\n');
  w(d, 'workflow/incidents/2026-09-30-inc.md', incident('状态: fixed\n级别: L1\n发现: 2026-09-30\n模块: backend'));
  const r = run(d, { staged: ['src/a.ts'] });
  check('incident 等价：fixed L1 算活跃低级入口 → 阻断',
    r.code === 1 && r.out.includes('[触达面判低]') && r.out.includes('incidents/2026-09-30-inc.md'), r.out);
}
// --- 级别缺失：suspect 拦截（方案 C：不能自证 high 即拦，消息给两字段对齐指引）---
{
  const d = mkfix();
  base(d, { level: '', status: 'draft' });
  const r = run(d, { staged: ['templates/t.md'] });
  check('级别缺失 → 泳道 suspect 拦断且消息含两字段对齐指引',
    r.code === 1 && r.out.includes('suspect') && r.out.includes('对齐'), r.out);
}
// --- 方案 C：级别与 risk_level 分歧 → suspect 拦截（两字段协议期）---
{
  const d = mkfix();
  w(d, '.agents/lane-surfaces.txt', '^templates/\n');
  w(d, '.agents/kit.json', JSON.stringify({ policyVersion: 2 }));
  w(d, 'workflow/intents/2026-10-02-divergent.md',
    intent('x', '状态: approved\n级别: L2\nrisk_level: L1\n日期: 2026-10-02\n模块: pipeline'));
  const r = run(d, { staged: ['templates/t.md'] });
  check('分歧（L2/L1）→ suspect 拦断（不作豁免依据）',
    r.code === 1 && r.out.includes('suspect') && r.out.includes('2026-10-02-divergent'), r.out);
}
// --- 方案 C：两字段一致 high → 豁免（对照）---
{
  const d = mkfix();
  w(d, '.agents/lane-surfaces.txt', '^templates/\n');
  w(d, '.agents/kit.json', JSON.stringify({ policyVersion: 2 }));
  w(d, 'workflow/intents/2026-10-02-aligned.md',
    intent('x', '状态: approved\n级别: L2\nrisk_level: L2\n日期: 2026-10-02\n模块: pipeline'));
  const r = run(d, { staged: ['templates/t.md'] });
  check('两字段一致 L2 → 豁免放行', r.code === 0 && !r.out.includes('触达面判低'), r.out);
}
// --- 平台边界：CRLF frontmatter ---
{
  const d = mkfix();
  w(d, '.agents/lane-surfaces.txt', '^templates/\n');
  w(d, 'workflow/intents/2026-09-28-crlf.md', intent('x', '状态: approved\r\n级别: L1\r\n日期: 2026-09-28\r\n模块: ui', '\r\n'));
  const r = run(d, { staged: ['templates/t.md'] });
  check('CRLF frontmatter 正常解析（仍阻断）', r.code === 1 && r.out.includes('2026-09-28-crlf'), r.out);
}
// --- 平台边界：非 ASCII 路径透传（quotepath 教训的对账面）---
{
  const d = mkfix();
  w(d, '.agents/lane-surfaces.txt', '^模块/\n');
  w(d, 'workflow/intents/2026-09-28-l1.md', intent('x', '状态: approved\n级别: L1\n日期: 2026-09-28\n模块: ui'));
  const r = run(d, { staged: ['模块/接口契约.ts'] });
  check('非 ASCII 暂存路径命中模式且消息原样透传', r.code === 1 && r.out.includes('模块/接口契约.ts'), r.out);
}
// --- 平台边界：detached HEAD（branch=HEAD）→ A strict、B 跳过 ---
{
  const d = mkfix();
  base(d);
  w(d, 'workflow/intents/2026-10-01-poc.md', intent('p', '状态: draft\n级别: L1\n日期: 2026-10-01\n模块: ui'));
  const r = run(d, { branch: 'HEAD', staged: ['templates/t.md', 'workflow/intents/2026-10-01-poc.md'] });
  check('detached HEAD：A 按 strict 阻断、B 不触发', r.code === 1 && r.out.includes('[触达面判低]') && !r.out.includes('探索标记缺失'), r.out);
}
// --- 边界：_TEMPLATE.md 排除（不算活跃入口、不触发 B）---
{
  const d = mkfix();
  w(d, 'workflow/intents/_TEMPLATE.md', intent('t', '状态: draft\n级别: L1'));
  const r = run(d, { branch: 'experiment/poc', staged: ['workflow/intents/_TEMPLATE.md'] });
  check('_TEMPLATE.md 不触发检查 B，也不算活跃入口', r.code === 0, r.out);
}
// --- 配置边界：非法 ERE 行 → fail-closed ---
{
  const d = mkfix();
  w(d, '.agents/lane-surfaces.txt', '^ok/\n[invalid(\n');
  const r = run(d, { staged: ['ok/a.ts'] });
  check('配置含非法 ERE → fail-closed 阻断并指出坏行', r.code === 1 && r.out.includes('[面清单语法错误]') && r.out.includes('[invalid('), r.out);
}
// --- S-hints（2026-10-13 hints-backstop）：level-hints 接入提交面判低 ---
// 此前「就高不就低」只在 flow-kit route 输出 advisory，提交面只认 lane-surfaces → 两份清单无机器对账。
{
  // ① hints 命中 L3，但活跃入口只有 L2 → 判低必须拦（此前「有个 high 入口」就放行）
  const d = mkfix();
  base(d, { level: 'L2' });
  w(d, '.agents/level-hints.txt', 'L3 ^src/db/\n');
  const r = run(d, { staged: ['src/db/schema.sql'] });
  check('S-hints hints 命中 L3 + 活跃仅 L2 → 阻断（要求入口 ≥ L3，不只「有个 high」）',
    r.code === 1 && r.out.includes('[触达面判低]') && r.out.includes('src/db/schema.sql')
      && r.out.includes('L3') && r.out.includes('level-hints.txt'), r.out);

  // ② 升到 L3 后放行
  const d2 = mkfix();
  base(d2, { level: 'L3' });
  w(d2, '.agents/level-hints.txt', 'L3 ^src/db/\n');
  const r2 = run(d2, { staged: ['src/db/schema.sql'] });
  check('S-hints 入口升到 L3 → 放行', r2.code === 0 && !r2.out.includes('[触达面判低]'), r2.out);

  // ③ 无 hints（默认空）→ 不产生任何新阻断面（旧装户零影响）
  const d3 = mkfix();
  base(d3, { level: 'L1' });
  const r3 = run(d3, { staged: ['src/db/schema.sql'] });
  check('S-hints 未配 hints → 不触发新判定（默认空=纯语义定级）', !r3.out.includes('[触达面判低]'), r3.out);

  // ④ hints 命中但无任何活跃入口 → advisory（与检查 A 同口径，豁免 docs/bootstrap 类）
  const d4 = mkfix();
  w(d4, '.agents/lane-surfaces.txt', '^templates/\n');
  w(d4, '.agents/level-hints.txt', 'L2 ^src/db/\n');
  const r4 = run(d4, { staged: ['src/db/x.sql'] });
  check('S-hints 命中但无活跃入口 → advisory 不阻断',
    r4.code === 0 && r4.out.includes('触达面判低') && r4.out.includes('advisory'), r4.out);

  // ⑤ hints 语法错 → fail-closed（写错配置比没配置危险）
  const d5 = mkfix();
  base(d5, { level: 'L2' });
  w(d5, '.agents/level-hints.txt', 'L3 [bad(\n');
  const r5 = run(d5, { staged: ['ok/a.ts'] });
  check('S-hints 非法 hints → fail-closed 阻断并带路径行号',
    r5.code === 1 && r5.out.includes('[level-hints 配置错误]') && r5.out.includes('level-hints.txt'), r5.out);

  // ⑥ 两份清单交叉对账：hints 登记了高风险面、lane-surfaces 为空 → advisory 点名「提交面无兜底」
  const d6 = mkfix();
  w(d6, '.agents/level-hints.txt', 'L2 ^src/db/\n');
  const r6 = run(d6, { staged: ['src/db/x.sql'] });
  check('S-hints hints 已登记但触达面清单空 → advisory 点名无兜底',
    r6.code === 0 && r6.out.includes('level-hints 无提交面兜底'), r6.out);

  // ⑦ L0 档 hints → 配置错误 fail-closed（2026-10-13 executor-review 实测 Major）
  //   原实现接受 `L0 ^docs/`，提交面判低门当真 → 纯文档提交被硬拦，修法还让人「升级至 L0 及以上」
  const d7 = mkfix();
  base(d7, { level: 'L1' });
  w(d7, '.agents/level-hints.txt', 'L0 ^docs/\n');
  const r7 = run(d7, { staged: ['docs/readme.md'] });
  check('S-hints L0 档 hints → fail-closed 阻断（不拿低档当门槛）',
    r7.code === 1 && r7.out.includes('[level-hints 配置错误]') && r7.out.includes('L2 或 L3'), r7.out);

  // ⑧ 路径归一化口径与判据单源一致（复用 hintLevelFor，不再各自复刻）
  //   同一文件同时命中 hints 与触达面 → 判据里点名两处来源；Windows 反斜杠写法也要能命中
  const d8 = mkfix();
  base(d8, { level: 'L3' });
  w(d8, '.agents/level-hints.txt', 'L3 ^src/db/\n');
  const r8 = run(d8, { staged: ['src\\db\\a.sql'] });
  check('S-hints 反斜杠路径经单源归一后仍命中（复用 hintLevelFor）',
    r8.code === 0 && !r8.out.includes('[触达面判低]'), r8.out);
}
// --- git 真仓端到端：走生产发现路径（quotepath=off + diff --cached）---
{
  const d = mkfix();
  const g = (a) => spawnSync('git', ['-c', 'core.quotepath=off', ...a], { cwd: d, encoding: 'utf8' });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  w(d, '.agents/lane-surfaces.txt', '^模块/\n');
  w(d, 'workflow/intents/2026-09-28-l1.md', intent('x', '状态: approved\n级别: L1\n日期: 2026-09-28\n模块: ui'));
  fs.mkdirSync(path.join(d, '模块'), { recursive: true });
  w(d, '模块/接口契约.ts', 'export {};\n');
  g(['add', '模块/接口契约.ts']);
  const r = spawnSync(process.execPath, [SCRIPT, '--root', d], { cwd: d, encoding: 'utf8' });
  check('git 端到端：真实暂存非 ASCII 路径 → 阻断且路径不转义',
    r.status === 1 && `${r.stdout || ''}${r.stderr || ''}`.includes('模块/接口契约.ts'),
    `${r.stdout || ''}${r.stderr || ''}`);
}

console.log(`\n${fail ? `❌ ${fail} failed` : '✅ all passed'}（${pass} passed）`);
process.exit(fail ? 1 : 0);
