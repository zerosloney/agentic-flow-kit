// check-audit-fields.mjs：项目配置驱动（.agents/hooks/audit-fields.json）的审计字段门禁。
// 覆盖：未配置 SKIP、暂存区 / --range 两模式判定一致、allowFiles/allowLines 豁免、
//       自定义 ext+fields、配置错配 exit 2、干净与无改动静默通过。
import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'check-audit-fields.mjs');
const CONFIG = '.agents/hooks/audit-fields.json';

// 临时仓内 git：-c 内联身份，不依赖机器全局配置（与 check-scope-range-deleted-plan 同款）
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败: ${r.stderr}`);
  return r.stdout.trim();
};

function tmpRepo() {
  const dir = makeTmp('flow-kit-audit-');
  git(dir, 'init', '-q');
  return dir;
}

function write(dir, rel, text) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function writeConfig(dir, config) {
  write(dir, CONFIG, `${JSON.stringify(config, null, 2)}\n`);
}

const stage = (dir, ...rels) => git(dir, 'add', '--', ...rels);
const commit = (dir, message) => git(dir, 'commit', '-q', '-m', message);

function runHook(dir, rangeArgs = []) {
  return spawnSync(process.execPath, [HOOK, ...rangeArgs], { cwd: dir, encoding: 'utf8' });
}

test('未配置：配置文件不存在 → SKIP、exit 0、stdout 为空', () => {
  const dir = tmpRepo();
  const r = runHook(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /SKIP 未配置审计字段守卫/);
  assert.match(r.stderr, /audit-fields\.json 不存在/);
});

test('暂存区模式：手工赋值判违例，同名拷贝（DTO 映射）不报', () => {
  const dir = tmpRepo();
  write(dir, 'src/OrderService.cs', 'entity.CreatedBy = "x";\nentity.Operator = dto.Operator;\n');
  writeConfig(dir, { fields: ['Operator', 'CreatedBy'] });
  stage(dir, 'src/OrderService.cs');
  const r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /审计字段红线违例/);
  assert.ok(r.stderr.includes('src/OrderService.cs:entity.CreatedBy = "x";'), r.stderr);
  assert.doesNotMatch(r.stderr, /dto\.Operator/);
});

test('allowFiles / allowLines 各自豁免生效', () => {
  const dir = tmpRepo();
  write(dir, 'src/AuditWriter.cs', 'entity.CreatedBy = "system";\n');
  write(dir, 'src/OrderService.cs', 'entity.CreatedBy = "x";\nset => CreatedTime = value;\n');
  stage(dir, 'src/AuditWriter.cs', 'src/OrderService.cs');
  const hitAudit = 'src/AuditWriter.cs:entity.CreatedBy = "system";';
  const hitManual = 'src/OrderService.cs:entity.CreatedBy = "x";';
  const hitBridge = 'src/OrderService.cs:set => CreatedTime = value;';

  // 无豁免：三行全报
  writeConfig(dir, { fields: ['CreatedBy', 'CreatedTime'] });
  let r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  for (const hit of [hitAudit, hitManual, hitBridge]) assert.ok(r.stderr.includes(hit), hit);

  // allowFiles：统一写入器整文件豁免
  writeConfig(dir, { fields: ['CreatedBy', 'CreatedTime'], allowFiles: ['src/AuditWriter.cs'] });
  r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes(hitManual) && r.stderr.includes(hitBridge), r.stderr);
  assert.ok(!r.stderr.includes(hitAudit));

  // allowFiles + allowLines：桥接 setter 行豁免
  writeConfig(dir, { fields: ['CreatedBy', 'CreatedTime'], allowFiles: ['src/AuditWriter.cs'], allowLines: ['set => CreatedTime = value'] });
  r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes(hitManual), r.stderr);
  assert.ok(!r.stderr.includes(hitBridge) && !r.stderr.includes(hitAudit));

  // 只配 allowLines：桥接行仍豁免，其余照报——两类豁免互不依赖
  writeConfig(dir, { fields: ['CreatedBy', 'CreatedTime'], allowLines: ['set => CreatedTime = value'] });
  r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes(hitAudit) && r.stderr.includes(hitManual), r.stderr);
  assert.ok(!r.stderr.includes(hitBridge));
});

test('--range 模式与暂存区判定一致：违例行报、同名拷贝与豁免文件不报', () => {
  const dir = tmpRepo();
  writeConfig(dir, { fields: ['Operator', 'CreatedBy'], allowFiles: ['src/AuditWriter.cs'] });
  write(dir, 'src/OrderService.cs', 'repo.Load(order);\n');
  write(dir, 'src/AuditWriter.cs', 'entity.CreatedBy = "init";\n');
  stage(dir, 'src/OrderService.cs', 'src/AuditWriter.cs');
  commit(dir, 'baseline');
  // 基线行保持不变，违例行与同名拷贝行都作为范围内【新增行】出现，两条例外都真被判定到
  write(dir, 'src/OrderService.cs', 'repo.Load(order);\nentity.Operator = "system";\nentity.CreatedBy = dto.CreatedBy;\n');
  write(dir, 'src/AuditWriter.cs', 'entity.CreatedBy = "init";\nentity.CreatedBy = "seed";\n');
  stage(dir, 'src/OrderService.cs', 'src/AuditWriter.cs');
  commit(dir, 'manual write');
  const r = runHook(dir, ['--range', 'HEAD~1..HEAD']);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, '');
  assert.ok(r.stderr.includes('src/OrderService.cs:entity.Operator = "system";'), r.stderr);
  assert.doesNotMatch(r.stderr, /dto\.CreatedBy/);
  assert.ok(!r.stderr.includes('src/AuditWriter.cs'));
});

test('自定义 ext 与 fields：扫 .java、字段 updatedBy，默认 .cs 不再扫', () => {
  const dir = tmpRepo();
  write(dir, 'src/OrderService.java', 'entity.updatedBy = "x";\n');
  write(dir, 'src/OrderService.cs', 'entity.CreatedBy = "y";\n');
  writeConfig(dir, { fields: ['updatedBy'], ext: ['.java'] });
  stage(dir, 'src/OrderService.java', 'src/OrderService.cs');
  const r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes('src/OrderService.java:entity.updatedBy = "x";'), r.stderr);
  assert.doesNotMatch(r.stderr, /OrderService\.cs/);
  assert.doesNotMatch(r.stderr, /CreatedBy/);
});

test('配置非法：JSON 坏 / fields 空 / 未知顶层键 / 字段名非标识符 / 元素非字符串 → exit 2', () => {
  const dir = tmpRepo();
  write(dir, 'src/OrderService.cs', 'entity.CreatedBy = "x";\n');
  stage(dir, 'src/OrderService.cs');
  const cases = [
    ['{ not json', /不是合法 JSON/],
    [{ fields: [] }, /fields/],
    [{ fields: ['CreatedBy'], unknownKey: [] }, /未知顶层键/],
    [{ fields: ['1bad'] }, /不是合法标识符/],
    [{ fields: ['CreatedBy'], allowFiles: [42] }, /allowFiles/],
    [{ fields: ['CreatedBy'], ext: '.cs' }, /ext/],
  ];
  for (const [config, pattern] of cases) {
    if (typeof config === 'string') write(dir, CONFIG, config);
    else writeConfig(dir, config);
    const r = runHook(dir);
    assert.equal(r.status, 2, JSON.stringify(config));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /配置错误/);
    assert.match(r.stderr, pattern);
  }
});

test('已配置且干净 / 无改动文件 → exit 0、stderr 无违例输出', () => {
  const dir = tmpRepo();
  write(dir, 'src/OrderService.cs', 'entity.CreatedBy = dto.CreatedBy;\nrepo.Save(order);\n');
  writeConfig(dir, { fields: ['Operator', 'CreatedBy'] });
  stage(dir, 'src/OrderService.cs');
  let r = runHook(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');

  // 已配置但暂存区无改动：同样安静通过
  const empty = tmpRepo();
  writeConfig(empty, { fields: ['CreatedBy', 'CreatedTime'] });
  r = runHook(empty);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});

test('--range 参数缺失或 range 无效 → usage、exit 2；不在 git 仓库内 → exit 1', () => {
  const dir = tmpRepo();
  writeConfig(dir, { fields: ['CreatedBy', 'CreatedTime'] });
  let r = runHook(dir, ['--range']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /用法/);
  r = runHook(dir, ['--range', 'not-a-range..ghost']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /无效 git range/);

  const noGit = makeTmp('flow-kit-audit-nogit-');
  r = runHook(noGit);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /不在 git 仓库内/);
});
