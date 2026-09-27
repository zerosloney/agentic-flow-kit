#!/usr/bin/env node
// gate-dotnet-ca.test.mjs — dotnet-ca 门禁模块判定回归（2026-09-27 host-gates-p1，incident 三件套「防复发验证」落点）
// 方法：fixture 临时 git 仓构造 CONFIG 指向的最小目录树，复制包源 check-architecture.sh 并按场景改 CONFIG，
//       spawn sh 跑门禁断言 exit 码与输出。三场景对位三个 P1：
//       ①豁免清单多值生效（P1-B1：旧 tr ':' '|' 造 "A|B" BRE 字面量永不命中）
//       ②CONTROLLERS_DIR 缺失 fail-closed（P1-B3：旧 2>/dev/null 静默放行）
//       ③csproj 缺失 fail-closed（随 B3：旧 glob 展开失败静默放行）
// 用法：node src/gate-dotnet-ca.test.mjs（npm test 随跑）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (desc, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${desc}`); }
  else { fail++; console.log(`FAIL  ${desc}${detail ? `\n${detail}` : ''}`); }
};

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE_SRC = path.join(PKG_ROOT, 'modules', 'gates', 'dotnet-ca', 'check-architecture.sh');

// mkfixture：最小 dotnet 目录树（Application/API/Domain/Infrastructure/Controllers）+ 可覆盖 CONFIG
function mkfixture(configOverride = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-ca-test-'));
  const dirs = {
    APP_DIR: 'backend/src/App.Application',
    API_DIR: 'backend/src/App.API',
    DBCTX_FILE: 'backend/src/App.Infrastructure/Data/AppDbContext.cs',
    DOMAIN_ENTITIES_DIR: 'backend/src/App.Domain/Entities',
    CONTROLLERS_DIR: 'backend/src/App.API/Controllers',
  };
  for (const rel of Object.values(dirs)) fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); // 文件型键取父目录；目录型键随后显式建
  fs.mkdirSync(path.join(root, dirs.APP_DIR), { recursive: true });
  fs.mkdirSync(path.join(root, dirs.API_DIR), { recursive: true });
  fs.mkdirSync(path.join(root, dirs.DOMAIN_ENTITIES_DIR), { recursive: true });
  fs.mkdirSync(path.join(root, dirs.CONTROLLERS_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, dirs.DBCTX_FILE), 'class AppDbContext { }\n');
  const cfg = {
    ...Object.fromEntries(Object.entries(dirs).map(([k, v]) => [k, v])),
    DBCTX_CLASS: 'AppDbContext',
    INFRA_USING: 'using App.Infrastructure',
    EXEMPT_CTRL: 'ExemptedA:ExemptedB',
    SHARED_TYPES: '',
    ...configOverride,
  };
  // 包源脚本 CONFIG 段替换：按「^KEY=" 任意到行尾」整行重写（值含 / 且行尾带注释——不用值内正则）；
  // EXEMPT_CTRL/SHARED_TYPES 行尾有注释，重写时保留注释语义（测试值自带说明则省略）
  let script = fs.readFileSync(GATE_SRC, 'utf8');
  for (const [k, v] of Object.entries(cfg)) {
    script = script.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}="${v}"`);
  }
  const scriptPath = path.join(root, 'check-architecture.sh');
  fs.writeFileSync(scriptPath, script);
  // fixture 需为 git 仓（脚本首行 git rev-parse --show-toplevel）
  spawnSync('git', ['init', '-q', '.'], { cwd: root });
  return { root, scriptPath, dirs };
}
const runGate = (root, scriptPath) => spawnSync('sh', [scriptPath], { cwd: root, encoding: 'utf8' });
// ctrlWrite：往 fixture 的 Controllers 目录写文件（目录可能尚未创建）
const ctrlWrite = (root, dirs, name, content) => {
  fs.mkdirSync(path.join(root, dirs.CONTROLLERS_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, dirs.CONTROLLERS_DIR, name), content);
};
// addCsproj：补干净 csproj（fail-closed 后红线 1 先查 csproj——不写则走不到目标断言）
const addCsproj = (root, dirs) => fs.writeFileSync(path.join(root, dirs.APP_DIR, 'App.Application.csproj'), '<Project Sdk="Microsoft.NET.Sdk" />\n');

// ---- ① 豁免清单多值（P1-B1）----
{
  const { root, scriptPath, dirs } = mkfixture();
  addCsproj(root, dirs);
  // API 层两处 DbContext 引用：一个在豁免 Controller 文件、一个在普通 Controller——豁免只应放过前者
  ctrlWrite(root, dirs, 'ExemptedAController.cs', '// AppDbContext 直接引用（豁免）\n');
  ctrlWrite(root, dirs, 'OrdersController.cs', '// AppDbContext 直接引用（应拦）\n');
  const r = runGate(root, scriptPath);
  check('①多值豁免生效：ExemptedA 文件行不出现、Orders 行出现（违例 exit 1）',
    r.status === 1 && !r.stderr.includes('ExemptedAController') && r.stderr.includes('OrdersController'),
    `exit=${r.status}\n${r.stdout}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}
// ①附：干净树（豁免命中全部 DbContext 引用）→ 红线 3 不拦（整体 exit 0 需其余红线干净）
{
  const { root, scriptPath, dirs } = mkfixture();
  addCsproj(root, dirs);
  ctrlWrite(root, dirs, 'ExemptedAController.cs', '// AppDbContext\n');
  ctrlWrite(root, dirs, 'ExemptedBController.cs', '// AppDbContext\n');
  const r = runGate(root, scriptPath);
  check('①两个豁免 Controller 全命中 → 红线 3 零输出 exit 0', r.status === 0 && !r.stderr, `exit=${r.status}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- ② CONTROLLERS_DIR 缺失 fail-closed（P1-B3）----
{
  const { root, scriptPath, dirs } = mkfixture({ CONTROLLERS_DIR: 'backend/src/App.API/NotThere' });
  addCsproj(root, dirs);
  const r = runGate(root, scriptPath);
  check('②Controllers 目录缺失 → fail-closed exit 1 点名目标（旧代码静默放行）',
    r.status === 1 && r.stderr.includes('NotThere') && r.stderr.includes('fail-closed'),
    `exit=${r.status}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- ③ csproj 缺失 fail-closed（随 B3）----
{
  const { root, scriptPath } = mkfixture();
  // Application 目录存在但无 .csproj（glob 展开失败形态）
  const r = runGate(root, scriptPath);
  check('③Application 无 csproj → fail-closed exit 1（旧代码静默放行）',
    r.status === 1 && r.stderr.includes('csproj') && r.stderr.includes('fail-closed'),
    `exit=${r.status}\n${r.stderr}`);
  fs.rmSync(root, { recursive: true, force: true });
}
// ③附：有 csproj 且干净 → 过红线 1
{
  const { root, scriptPath, dirs } = mkfixture();
  fs.writeFileSync(path.join(root, dirs.APP_DIR, 'App.Application.csproj'), '<Project Sdk="Microsoft.NET.Sdk" />\n');
  const r = runGate(root, scriptPath);
  check('③干净 csproj 存在 → 整体 exit 0', r.status === 0, `exit=${r.status}\n${r.stderr}`);  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
