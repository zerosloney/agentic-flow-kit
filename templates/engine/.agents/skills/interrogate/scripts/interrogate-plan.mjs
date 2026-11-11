#!/usr/bin/env node
// interrogate-plan.mjs — /interrogate 的复核计划生成器（2026-10-22 pstack 借鉴）
// 用法：node .agents/skills/interrogate/scripts/interrogate-plan.mjs [--base <ref>] [--head <ref>] [--spec <path>] [--json]
// 输出：变更文件 + 镜头（correctness/security/quality/performance/tests/spec）+ 每个镜头的文件切片与提示词。
// 不做复核——复核由子代理按镜头独立做；本脚本只保证镜头覆盖一致、可复跑、可对质。
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const argOf = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
};
const base = argOf('--base') || 'origin/main';
const head = argOf('--head') || 'HEAD';
const spec = argOf('--spec') || '';
const asJson = argv.includes('--json');

const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (root.status !== 0 || !root.stdout.trim()) {
  console.error('interrogate-plan: 不在 git 仓库');
  process.exit(2);
}
process.chdir(root.stdout.trim());
const git = (args) => spawnSync('git', args, { encoding: 'utf8' });
if (git(['rev-parse', '--verify', `${base}^{commit}`]).status !== 0) {
  console.error(`interrogate-plan: 基线 ${base} 不存在（先 git fetch origin，或用 --base 指定）`);
  process.exit(2);
}
if (git(['rev-parse', '--verify', `${head}^{commit}`]).status !== 0) {
  console.error(`interrogate-plan: head ${head} 不存在`);
  process.exit(2);
}

const files = String(git(['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', `${base}...${head}`]).stdout || '')
  .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
if (!files.length) {
  console.error(`interrogate-plan: ${base}...${head} 无变更——没有可复核的 diff`);
  process.exit(2);
}

const match = (re) => files.filter((f) => re.test(f));
const security = match(/auth|token|secret|password|crypto|sql|query|upload|import|export|api|controller|middleware|permission|role/i);
const performance = match(/service|repository|query|sql|index|list|table|render|computed|watch|effect|loop|batch/i);
const tests = match(/(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$/i);

const lenses = [
  { id: 'correctness', focus: '逻辑、边界、错误路径、状态转换、并发交错', files },
  { id: 'security', focus: '信任边界、注入、鉴权、越权、敏感数据、输入解析', files: security.length ? security : files, note: security.length ? '' : '无显式安全敏感文件——仍按全量文件扫信任边界' },
  { id: 'quality', focus: '死代码、重复、命名、注释、抽象层数、可维护性', files },
  { id: 'performance', focus: '查询/循环/渲染/内存/并发资源', files: performance.length ? performance : files, note: performance.length ? '' : '无显式性能敏感文件——仍按全量文件扫热点' },
  { id: 'tests', focus: '行为断言、边界覆盖、测试是否会在实现全返回 undefined 时仍通过', files: tests.length ? tests : files, note: tests.length ? '' : '无测试文件变更——检查是否缺测试' },
  { id: 'spec', focus: spec ? `对照 spec ${spec} 的验收标准与契约` : '对照 workflow/specs 与契约面（未指定 --spec 时按变更面找同名 spec）', files },
];

const promptOf = (l) => [
  `镜头：${l.id}——${l.focus}`,
  `目标：${base}...${head}`,
  spec ? `spec：${spec}` : '',
  `文件（${l.files.length}）：`,
  ...l.files.map((f) => `- ${f}`),
  l.note ? `注：${l.note}` : '',
  '输出：每条 finding = 严重度（P0/P1/P2）+ file:line + 证据 + 修法；确认的与推测的分开；无发现写「无」。',
].filter(Boolean).join('\n');

if (asJson) {
  console.log(JSON.stringify({ base, head, spec: spec || null, files, lenses: lenses.map((l) => ({ ...l, prompt: promptOf(l) })) }, null, 2));
  process.exit(0);
}
console.log(`# interrogate plan：${base}...${head}（${files.length} 文件）\n`);
for (const l of lenses) {
  console.log(`## ${l.id}（${l.files.length} 文件）\n${l.focus}${l.note ? `\n注：${l.note}` : ''}\n`);
}
