// check-schema-residue.test.mjs — 通用化后的连接来源 / 豁免清单 / 前置缺失行为：
// 假 sqlcmd 经 SQLCMD_BIN 注缝（argv 落日志；查询里的「表.列」在存在集合内打 Y 否则 N），
// 夹具全部用中性表列名，批次目录走默认 wiki/数据维护/schema变更。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(KIT, 'templates', 'engine', '.agents', 'scripts', 'check-schema-residue.mjs');
const CONN = 'Server=fake-srv;Database=fake-db;User Id=fake-user;Password=fake-pw;';

// 假 sqlcmd：把收到的 argv 追加写进同目录日志，再按存在集合应答（与真脚本的 Y/N 协议一致）
const FAKE_SOURCE = `
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(here, 'sqlcmd-log.jsonl'), JSON.stringify(argv) + '\\n');
const q = argv[argv.indexOf('-Q') + 1] || '';
const m = /OBJECT_ID\\('dbo\\.([^']+)'\\)\\s*AND\\s*name='([^']+)'/.exec(q);
const exists = new Set(JSON.parse(fs.readFileSync(path.join(here, 'fake-exists.json'), 'utf8')));
console.log(m && exists.has(m[1] + '.' + m[2]) ? 'Y' : 'N');
`;

// 每个用例一套临时项目：默认批次目录一批动作 SQL + 假 sqlcmd（存在集合按用例给定），返回假 sqlcmd 路径
function setup(dir, existsList) {
  const batch = path.join(dir, 'wiki', '数据维护', 'schema变更', '2026-01-01-demo');
  fs.mkdirSync(batch, { recursive: true });
  fs.writeFileSync(path.join(batch, '01-columns.sql'),
    'ALTER TABLE dbo.T_Order ADD Qty INT, Note NVARCHAR(50);\nALTER TABLE dbo.T_Ship DROP COLUMN Cost;\n');
  fs.writeFileSync(path.join(dir, 'fake-exists.json'), JSON.stringify(existsList));
  fs.writeFileSync(path.join(dir, 'fake-sqlcmd.mjs'), FAKE_SOURCE.trimStart());
  return path.join(dir, 'fake-sqlcmd.mjs');
}

function run(dir, fake, args) {
  const env = { ...process.env, SQLCMD_BIN: fake };
  delete env.SCHEMA_RESIDUE_CONN;   // 防宿主机环境串场
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env });
}

const readLog = (dir) => fs.readFileSync(path.join(dir, 'sqlcmd-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('no connection source exits 2 with usage hint', () => {
  const dir = makeTmp('fk-schema-residue-');
  const fake = setup(dir, []);
  const r = run(dir, fake, []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--conn/);
  assert.match(r.stderr, /SCHEMA_RESIDUE_CONN/);
  assert.match(r.stderr, /--appsettings/);
});

test('appsettings connection feeds -S/-d/-U/-P to sqlcmd', () => {
  const dir = makeTmp('fk-schema-residue-');
  const fake = setup(dir, ['T_Order.Qty', 'T_Order.Note']);
  fs.writeFileSync(path.join(dir, 'appsettings.json'), JSON.stringify({ DBConnParameter: CONN }));
  const r = run(dir, fake, ['--appsettings', 'appsettings.json']);
  assert.equal(r.status, 0);
  const log = readLog(dir);
  assert.ok(log.length > 0);
  for (const argv of log) {
    const at = (flag) => argv.indexOf(flag);
    assert.equal(argv[at('-S') + 1], 'fake-srv');
    assert.equal(argv[at('-d') + 1], 'fake-db');
    assert.equal(argv[at('-U') + 1], 'fake-user');
    assert.equal(argv[at('-P') + 1], 'fake-pw');
  }
});

test('added-but-missing column exits 1 and reports 缺失', () => {
  const dir = makeTmp('fk-schema-residue-');
  const fake = setup(dir, []);
  const r = run(dir, fake, ['--conn', CONN]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /缺失/);
  assert.match(r.stdout, /T_Order\.Qty/);
});

test('dropped-but-existing column exits 1 and reports 残留', () => {
  const dir = makeTmp('fk-schema-residue-');
  const fake = setup(dir, ['T_Ship.Cost']);
  const r = run(dir, fake, ['--conn', CONN]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /残留/);
  assert.match(r.stdout, /T_Ship\.Cost/);
});

test('exempt applies per direction only', () => {
  const dir = makeTmp('fk-schema-residue-');
  const fake = setup(dir, ['T_Ship.Cost']);
  const exempt = [
    { table: 'T_Order', column: 'Qty', direction: 'missing', reason: '已人工核实：更晚批次已删' },
    { table: 'T_Order', column: 'Note', direction: 'missing', reason: '已人工核实：更晚批次已删' },
    { table: 'T_Ship', column: 'Cost', direction: 'residue', reason: '已人工核实：实体确实声明该列' },
  ];
  fs.writeFileSync(path.join(dir, 'exempt.json'), JSON.stringify(exempt));
  const ok = run(dir, fake, ['--conn', CONN, '--exempt', 'exempt.json']);
  assert.equal(ok.status, 0);

  const swapped = exempt.map((e) => ({ ...e, direction: e.direction === 'missing' ? 'residue' : 'missing' }));
  fs.writeFileSync(path.join(dir, 'exempt-swapped.json'), JSON.stringify(swapped));
  const bad = run(dir, fake, ['--conn', CONN, '--exempt', 'exempt-swapped.json']);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /T_Order\.Qty/);   // 方向不对 → 豁免不生效，照常报警
});

test('fully consistent ledger and database exits 0', () => {
  const dir = makeTmp('fk-schema-residue-');
  const fake = setup(dir, ['T_Order.Qty', 'T_Order.Note']);
  const r = run(dir, fake, ['--conn', CONN]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /残留（批次已删仍存在）0 项/);
});

test('missing batch base directory exits 2', () => {
  const dir = makeTmp('fk-schema-residue-');
  const fake = setup(dir, []);
  const r = run(dir, fake, ['--conn', CONN, '--base', path.join('wiki', '数据维护', 'schema变更', '不存在')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /批次目录不存在/);
});

test('invalid exempt file exits 2', () => {
  const dir = makeTmp('fk-schema-residue-');
  const fake = setup(dir, []);
  fs.writeFileSync(path.join(dir, 'not-array.json'), JSON.stringify({ table: 'T_Order' }));
  const notArray = run(dir, fake, ['--conn', CONN, '--exempt', 'not-array.json']);
  assert.equal(notArray.status, 2);
  assert.match(notArray.stderr, /须为 JSON 数组/);

  fs.writeFileSync(path.join(dir, 'bad-direction.json'),
    JSON.stringify([{ table: 'T_Order', column: 'Qty', direction: 'both', reason: 'x' }]));
  const badDirection = run(dir, fake, ['--conn', CONN, '--exempt', 'bad-direction.json']);
  assert.equal(badDirection.status, 2);
  assert.match(badDirection.stderr, /第 1 项非法/);
});
