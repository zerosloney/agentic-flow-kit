#!/usr/bin/env node
// fix-task.mjs — 修复任务窗口标记（配合 pre-write-check 的“测试不可弱化”层）
//
// 修复开始时 start，结束时 stop。窗口内修改既有测试会被写前门拒绝；
// 新建复现测试仍然允许（先写失败用例，再修实现）。
//
// 用法：
//   flow-kit run fix-task.mjs start [--id <id>] [--allow path1,path2]
//   flow-kit run fix-task.mjs status
//   flow-kit run fix-task.mjs stop
import fs from 'node:fs';
import path from 'node:path';

export function markerFile(root) {
  return path.join(root, '.agents', 'cache', 'fix-task.json');
}

export function startFixTask(root, { id = '', allowedTests = [], now = new Date() } = {}) {
  const file = markerFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = {
    active: true,
    id: String(id || `fix-${now.toISOString().slice(0, 19).replace(/[:T]/g, '')}`),
    startedAt: now.toISOString(),
    allowedTests: allowedTests.map((p) => String(p).replace(/\\/g, '/')),
  };
  fs.writeFileSync(file, JSON.stringify(row, null, 2), 'utf8');
  return row;
}

export function readFixTask(root) {
  try {
    return JSON.parse(fs.readFileSync(markerFile(root), 'utf8'));
  } catch {
    return null;
  }
}

export function stopFixTask(root) {
  const file = markerFile(root);
  const existed = fs.existsSync(file);
  fs.rmSync(file, { force: true });
  return { existed };
}

function argOf(argv, name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v == null || v.startsWith('--') ? true : v;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'status';
  const root = path.resolve(argOf(argv, 'root', process.cwd()));
  if (cmd === 'start') {
    const allow = argOf(argv, 'allow', '');
    const row = startFixTask(root, {
      id: argOf(argv, 'id', ''),
      allowedTests: allow && allow !== true ? String(allow).split(',') : [],
    });
    console.log(`fix-task 窗口已开启：${row.id}${row.allowedTests.length ? `（允许测试：${row.allowedTests.join(', ')}）` : ''}`);
    return 0;
  }
  if (cmd === 'stop') {
    const res = stopFixTask(root);
    console.log(res.existed ? 'fix-task 窗口已关闭' : 'fix-task 无活动窗口');
    return 0;
  }
  const row = readFixTask(root);
  console.log(row ? `active ${row.id} since ${row.startedAt}` : 'inactive');
  return row ? 0 : 1;
}

const isMain = process.argv[1] && process.argv[1].endsWith('fix-task.mjs');
if (isMain) process.exit(main());
