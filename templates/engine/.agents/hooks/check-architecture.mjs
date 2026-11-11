#!/usr/bin/env node
// check-architecture: AGENTS.md 架构红线门禁
// 红线：Application 禁引用 Infrastructure 项目 / 禁出现 DbContext；EF 模型层解耦（禁关系映射 / Include / 导航属性）；
//       Controller 禁透传 InnerException。
// 约定：违例输出到 stderr 并 exit 1；干净无输出 exit 0（stdout 保持为空，兼容 agent hook JSON 解析）
// 自 check-architecture.sh 移植 node（2026-10-08 门禁去 sh 化第二批）——语义逐条对齐；
// 红线 4.3 自 Python heredoc 改 node 原生实现：不再依赖 python 存在（sh 版缺 python 时 fail-closed 报警，node 版恒可跑）。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (gitRoot.error || gitRoot.status !== 0) {
  console.error('check-architecture: 不在 git 仓库内,门禁 fail-closed,不静默放行');
  process.exit(1);
}
process.chdir(gitRoot.stdout.trim());

const requireTarget = (p) => {
  if (!fs.existsSync(p)) {
    console.error(`check-architecture: 门禁目标缺失（${p}）——fail-closed,不静默放行`);
    process.exit(1);
  }
};

const APP = 'backend/material/Shipyard.Material.Application';
const API = 'backend/material/Shipyard.Material.API';
requireTarget(APP);
requireTarget(API);

const readLines = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
// 目录递归收集（排除 /obj/ /bin/），posix 相对路径，与 sh 版 grep -rn 输出行格式 `path:line:content` 对齐
const csFiles = (dir) => {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/[\\/]obj[\\/]|[\\/]bin[\\/]/.test(p)) walk(p); }
      else if (e.name.endsWith('.cs')) out.push(p.replace(/\\/g, '/'));
    }
  };
  walk(dir);
  return out;
};

let violations = '';

// 红线 1：Application csproj 不得引用 Infrastructure 项目
for (const f of fs.readdirSync(APP).filter((f) => f.endsWith('.csproj')).map((f) => path.join(APP, f))) {
  if (fs.readFileSync(f, 'utf8').includes('Infrastructure')) {
    violations += '\n- csproj 引用了 Infrastructure 项目（Application 只允许依赖 Domain 与 shared）';
    break;
  }
}

// 红线 2：Application 代码不得出现 DbContext / Infrastructure 命名空间
const appHits = csFiles(APP).flatMap((f) => readLines(f).map((c, i) => ({ f, i: i + 1, c })))
  .filter(({ c }) => c.includes('MaterialDbContext') || c.includes('using Shipyard.Material.Infrastructure'))
  .map(({ f, i, c }) => `${f}:${i}:${c}`);
if (appHits.length > 0) {
  violations += `\n- Application 代码出现 DbContext / Infrastructure 引用：\n${appHits.join('\n')}`;
}

// 红线 3：API 层 Controller 禁直接注入 MaterialDbContext（豁免：MaterialCodesController 分类树原生 LINQ）
const apiHits = csFiles(API).flatMap((f) => readLines(f).map((c, i) => ({ f, i: i + 1, c })))
  .filter(({ f, c }) => f.includes('MaterialCodesController') === false && c.includes('MaterialDbContext'))
  .map(({ f, i, c }) => `${f}:${i}:${c}`);
if (apiHits.length > 0) {
  violations += `\n- API 层出现 DbContext 直接引用（应走 IRepository/IUnitOfWork，豁免仅 MaterialCodesController）：\n${apiHits.join('\n')}`;
}

// 红线 4：EF 模型层解耦（2026-09-14，intent 2026-09-14-remove-ef-relationships）
const CTX = 'backend/material/Shipyard.Material.Infrastructure/Data/MaterialDbContext.cs';
requireTarget(CTX);
// 4.1 MaterialDbContext 禁关系映射配置
const relHits = readLines(CTX).map((c, i) => ({ i: i + 1, c }))
  .filter(({ c }) => /HasOne|HasMany|WithOne|WithMany|HasForeignKey|OnDelete/.test(c))
  .map(({ i, c }) => `${i}:${c}`);
if (relHits.length > 0) {
  violations += `\n- MaterialDbContext 出现关系映射（模型层已解耦，关联一律显式 JOIN/分步查询）：\n${relHits.join('\n')}`;
}
// 4.2 Application / API 禁代码级 .Include(（注释里的「原 Include(...)」无前导点，不误报）
const incHits = [...csFiles(APP), ...csFiles(API)].flatMap((f) => readLines(f).map((c, i) => ({ f, i: i + 1, c })))
  .filter(({ c }) => /\.Include\(/.test(c))
  .map(({ f, i, c }) => `${f}:${i}:${c}`);
if (incHits.length > 0) {
  violations += `\n- Application/API 出现 EF Include（导航已移除，明细/参照数据经仓储分步查询或显式 JOIN）：\n${incHits.join('\n')}`;
}
// 4.3 Domain 实体禁导航属性（按实体类名交叉扫描；枚举/标量属性不误伤）
const ENT = 'backend/material/Shipyard.Material.Domain/Entities';
requireTarget(ENT);
const entFiles = csFiles(ENT);
const names = new Set(['Staff', 'Company', 'BaseProject']);
for (const f of entFiles) {
  for (const m of readLines(f).join('\n').matchAll(/public\s+(?:sealed\s+|abstract\s+|partial\s+)*(?:class|record)\s+(\w+)/g)) names.add(m[1]);
}
const navHits = [];
for (const f of entFiles) {
  const lines = readLines(f);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*public\s+(?:virtual\s+)?([\w<>,\s.?]+?)\s+(\w+)\s*\{/.exec(lines[i]);
    if (!m) continue;
    const typ = m[1].trim();
    const mm = /(?:ICollection|List|IEnumerable|IReadOnlyCollection|IReadOnlyList)<\s*(\w+)\s*>/.exec(typ);
    const core = mm ? mm[1] : (/^\w+\??$/.test(typ) ? typ.replace(/\?$/, '') : null);
    if (core && (names.has(core))) navHits.push(`${path.basename(f)}:${i + 1} ${m[2]} : ${typ}`);
  }
}
if (navHits.length > 0) {
  violations += `\n- Domain 实体出现导航属性（模型层已解耦，关联只保留外键标量列）：\n${navHits.join('\n')}`;
}

// 红线 5：Controller 禁把 InnerException 原文透传进响应体（2026-09-18，incident 2026-09-18-db-exception-message-unify）
// 进日志不违例（MaterialCodesController 范式）：仅拦非日志行的 InnerException 引用
const CTRL = 'backend/material/Shipyard.Material.API/Controllers';
const innerHits = fs.existsSync(CTRL) ? csFiles(CTRL).flatMap((f) => readLines(f).map((c, i) => ({ f, i: i + 1, c })))
  .filter(({ c }) => c.includes('InnerException') && !/Log(Warning|Error|Information|Debug|Trace)/.test(c))
  .map(({ f, i, c }) => `${f}:${i}:${c}`) : [];
if (innerHits.length > 0) {
  violations += `\n- Controller 出现 InnerException 透传进响应（统一 ErrorHandling/DbErrorMessages 翻译；详情只许进日志）：\n${innerHits.join('\n')}`;
}

// 红线 6：订单域 Controller 并发冲突文案单源（2026-11-02，incident 2026-11-02-mto-pml-review-defects-batch2；
// 复发自 2026-10-21-order-concurrency-message-unification）。范围 = 该事件已收口的订单域 7 个控制器；
// 主数据域与库存域（Inbound/Transfer 的「库存已变动」）沿用各自既有口径，不在本红线执法面。
const ORDER_CTRL_FILES = [
  `${CTRL}/Orders/MTOOrdersController.cs`,
  `${CTRL}/Orders/MTOChangesController.cs`,
  `${CTRL}/Orders/OutboundOrdersController.cs`,
  `${CTRL}/Orders/OutboundRequestsController.cs`,
  `${CTRL}/Orders/PurchaseOrdersController.cs`,
  `${CTRL}/Orders/PurchaseRequestsController.cs`,
  `${CTRL}/Orders/PurchaseContractTemplatesController.cs`,
  `${CTRL}/Orders/PurchaseContractDraftsController.cs`,
  `${CTRL}/PML/PMLController.cs`,
].filter((f) => fs.existsSync(f));
const orderMsgHits = ORDER_CTRL_FILES.flatMap((f) => readLines(f).map((c, i) => ({ f, i: i + 1, c })))
  .filter(({ c }) => c.includes('该数据已被其他用户修改，请刷新后再试'))
  .map(({ f, i, c }) => `${f}:${i}:${c}`);
if (orderMsgHits.length > 0) {
  violations += `\n- 订单域 Controller 并发文案未走 ApiMessages.DataStateInvalid（2026-10-21 事件复发）：\n${orderMsgHits.join('\n')}`;
}
const orderCatchHits = ORDER_CTRL_FILES
  // OutboundOrders 的确认/拣货 catch 是库存域文案（「库存已变动」），2026-10-21 已裁定保留
  .filter((f) => !f.endsWith('OutboundOrdersController.cs'))
  .flatMap((f) => {
  const lines = readLines(f);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('catch (DbUpdateConcurrencyException)')) continue;
    let end = i + 1;
    while (end < lines.length && !lines[end].trim().startsWith('catch (')) end++;
    const body = lines.slice(i + 1, end).join('\n');
    if (!body.includes('ApiMessages.DataStateInvalid')) hits.push(`${f}:${i + 1}:${lines[i].trim()}`);
  }
  return hits;
});
if (orderCatchHits.length > 0) {
  violations += `\n- 订单域并发 catch 未使用 ApiMessages.DataStateInvalid：\n${orderCatchHits.join('\n')}`;
}

if (violations !== '') {
  console.error(`架构红线违例（AGENTS.md）：\n${violations}\n`);
  process.exit(1);
}
process.exit(0);
