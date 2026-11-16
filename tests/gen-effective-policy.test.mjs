import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 模板脚本直跑（node <模板 gen-effective-policy.mjs> --root <fixture>）：清单节是模板引擎面，
// 不经安装器——fixture 即「样例项目结构」，最小 policy + 门脚本即 task 约定的构造方式。
const GEN = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'gen-effective-policy.mjs');

const REGISTRY_HEADER = [
  '# 机制使用量台账（fixture）',
  '',
  '| 机制 | 门禁位置 | 触发统计口径 | 退役阈值 | 最近触发 | 状态 | 处置期限 |',
  '|---|---|---|---|---|---|---|',
];

// 行对象 → 7 列管道行（列序与 mechanism-registry.md 固定列序一致）。
function row({ name, gate, criterion, threshold = '—', last = '—', status = '现役 [检出型]', deadline = '—' }) {
  return `| ${name} | ${gate} | ${criterion} | ${threshold} | ${last} | ${status} | ${deadline} |`;
}

function writeFixture(dir, rows) {
  fs.mkdirSync(path.join(dir, '.agents', 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.agents', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.agents', 'hooks'), { recursive: true });
  const names = rows.map((r) => r.name);
  fs.writeFileSync(path.join(dir, '.agents', 'config', 'policy.json'), `${JSON.stringify({
    $schema: 'policy/config@1',
    version: 1,
    registry: '.agents/config/mechanism-registry.md',
    mechanisms: { required: names },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, '.agents', 'config', 'mechanism-registry.md'), `${[...REGISTRY_HEADER, ...rows.map(row)].join('\n')}\n`);
}

function writeScript(dir, rel, lines) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${['#!/usr/bin/env node', ...lines, "import fs from 'node:fs';", ''].join('\n')}`);
}

function gen(dir, args = []) {
  return spawnSync(process.execPath, [GEN, '--root', dir, ...args], { cwd: dir, encoding: 'utf8' });
}

function artifact(dir) {
  return fs.readFileSync(path.join(dir, 'workflow', 'effective-policy.md'), 'utf8');
}

const checklistOf = (dir) => {
  const text = artifact(dir);
  const m = text.match(/## 现役门禁清单（人读）[\s\S]*?(?=\n<!-- GENERATED)/);
  assert.ok(m, 'artifact 缺少「现役门禁清单（人读）」章节');
  return m[0];
};

// 两道带门脚本 fixture 门（scripts/ 与 hooks/ 各一，覆盖两个扫描目录）+ 一道无脚本门（回落统计口径列）。
function baseRows() {
  return [
    { name: 'Alpha 架构红线门', gate: '.githooks/pre-commit 接线 check-alpha.mjs', criterion: 'hard「Alpha 违例」计数（月）' },
    { name: 'Beta 确认门', gate: 'confirm-doc 接线 .agents/hooks/check-beta.mjs（draft→approved 前置）', criterion: 'advisory「缺确认」计数（月）' },
    { name: 'Delta 文件门', gate: '.agents/config/delta.txt 存在性检查', criterion: 'WARN「delta 缺失」计数（月）' },
  ];
}

function writeBaseFixture(dir) {
  writeFixture(dir, baseRows());
  writeScript(dir, '.agents/scripts/check-alpha.mjs', ['// check-alpha: 校验 Alpha 模块架构红线', '// 违例输出 stderr 并 exit 1']);
  writeScript(dir, '.agents/hooks/check-beta.mjs', ['// check-beta — Beta 确认门：draft→approved 须确认指纹配对']);
}

test('gen-effective-policy renders a human-readable gate checklist row per active gate', () => {
  const dir = makeTmp('flow-kit-gen-gates-');
  writeBaseFixture(dir);
  const r = gen(dir);
  assert.equal(r.status, 0, r.stderr);
  const list = checklistOf(dir);

  // 全部 fixture 现役门各一行（Alpha/Beta/Delta = 3；数据面排除在 test 2 用 Theta 行专测）。
  assert.match(list, /共 3 道现役门（台账现役 3 行，其中数据面 0 行不入清单）/);
  assert.match(list, /\| Alpha 架构红线门 \|/);
  assert.match(list, /\| Beta 确认门 \|/);
  assert.match(list, /\| Delta 文件门 \|/);

  // 查什么：门脚本头部注释（scripts/ 与 hooks/ 两目录都扫描；basename 前缀剥重）。
  assert.match(list, /\| check-alpha：校验 Alpha 模块架构红线 违例输出 stderr 并 exit 1 \|/);
  assert.match(list, /check-beta：Beta 确认门：draft→approved 须确认指纹配对/);
  // 查什么：无门脚本命中 → 回落统计口径列（不脑补）。
  assert.match(list, /\| Delta 文件门 \| WARN「delta 缺失」计数（月） \|/);

  // 谁看：门禁位置关键词归并（pre-commit → 提交者；confirm-doc → 审批者；无命中 → 见门禁位置列）。
  assert.match(list, /\| 提交者（本地 git 钩子） \|/);
  assert.match(list, /\| spec\/plan 审批者（confirm-doc 确认门） \|/);
  assert.match(list, /\| Delta 文件门 \|[^\n]*\| 见门禁位置列 \|/);
  // 失败动作：统计口径/门禁位置列档位标记（hard「→硬拦；advisory→不阻断；WARN→告警）。
  assert.match(list, /\| 硬拦（违例即阻断） \|/);
  assert.match(list, /\| Beta 确认门 \|[^\n]*\| advisory（只报告不阻断） \|/);
  assert.match(list, /\| Delta 文件门 \|[^\n]*\| WARN 告警（不阻断） \|/);

  // 角色闭集行来自 policy.json roles。
  assert.ok(!list.includes('审批角色闭集'), 'fixture policy.json 无 roles 时不渲染角色行');
});

test('gate checklist excludes pending/retired rows and honors the data-plane tag', () => {
  const dir = makeTmp('flow-kit-gen-gates-');
  writeFixture(dir, [
    ...baseRows(),
    { name: 'Eta 待退役门', gate: '.githooks/pre-commit 接线 check-eta.mjs', criterion: 'hard「Eta 违例」计数（月）', status: '待退役 [检出型]' },
    { name: 'Zeta 已退役门', gate: '.githooks/pre-commit 接线 check-zeta.mjs', criterion: 'hard「Zeta 违例」计数（月）', status: '已退役 [检出型]' },
    { name: 'Theta 数据门', gate: 'workflow/metrics.md 月度聚合', criterion: '行数（月）', status: '现役 [数据面]' },
  ]);
  writeScript(dir, '.agents/scripts/check-alpha.mjs', ['// check-alpha: 校验 Alpha 模块架构红线']);
  const r = gen(dir);
  assert.equal(r.status, 0, r.stderr);
  const list = checklistOf(dir);
  // 6 行台账中现役 4（含数据面 Theta），入清单 3。
  assert.match(list, /共 3 道现役门（台账现役 4 行，其中数据面 1 行不入清单）/);
  for (const gone of ['Eta 待退役门', 'Zeta 已退役门', 'Theta 数据门']) {
    assert.ok(!list.includes(gone), `${gone} 不得入清单`);
  }
});

test('adding a gate adds a checklist row; removing it drops the row (bidirectional regeneration)', () => {
  const dir = makeTmp('flow-kit-gen-gates-');
  writeFixture(dir, [baseRows()[0]]);
  writeScript(dir, '.agents/scripts/check-alpha.mjs', ['// check-alpha: 校验 Alpha 模块架构红线']);
  assert.equal(gen(dir).status, 0);
  assert.match(checklistOf(dir), /共 1 道现役门/);

  // 加一道门（台账加行 + hooks 门脚本）→ 重生成 → 多一行。
  const rows = baseRows();
  writeFixture(dir, [rows[0], rows[1]]);
  writeScript(dir, '.agents/hooks/check-beta.mjs', ['// check-beta — Beta 确认门：draft→approved 须确认指纹配对']);
  assert.equal(gen(dir).status, 0);
  assert.match(checklistOf(dir), /共 2 道现役门/);
  assert.match(checklistOf(dir), /\| Beta 确认门 \|/);

  // 移除该门（删台账行）→ 重生成 → 少一行。
  writeFixture(dir, [rows[0]]);
  assert.equal(gen(dir).status, 0);
  assert.match(checklistOf(dir), /共 1 道现役门/);
  assert.ok(!checklistOf(dir).includes('Beta 确认门'), '移除后清单不得再含该门行');
});

test('--check flags registry drift and passes after regeneration', () => {
  const dir = makeTmp('flow-kit-gen-gates-');
  writeFixture(dir, [baseRows()[0]]);
  writeScript(dir, '.agents/scripts/check-alpha.mjs', ['// check-alpha: 校验 Alpha 模块架构红线']);
  assert.equal(gen(dir).status, 0);
  assert.equal(gen(dir, ['--check']).status, 0, '刚生成后 --check 必须一致');

  // 台账加门未重生成 → 漂移 exit 1；重生成后 exit 0（清单节随同一份 --check 把关）。
  const rows = baseRows();
  writeFixture(dir, [rows[0], rows[1]]);
  const drifted = gen(dir, ['--check']);
  assert.equal(drifted.status, 1);
  assert.match(drifted.stderr, /漂移/);
  assert.equal(gen(dir).status, 0);
  assert.equal(gen(dir, ['--check']).status, 0);
});
