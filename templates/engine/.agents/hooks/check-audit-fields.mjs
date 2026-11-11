#!/usr/bin/env node
// check-audit-fields: AGENTS.md 审计字段红线门禁（P0 机器兜底，本地暂存区 + CI range）
// 红线：审计字段（Operator/OperatorJobNo/OperateTime）由 EFRepository<T> 统一写入；
//       创建审计（CreatedBy/CreatedByJobNo/CreatedTime）由 CreationAuditExtensions.ApplyCreationAudit 统一写入（2026-11-02 B2），
//       禁止在 Controller/Service 手工补写（见 backend/AGENTS.md「本目录适用的机器门」）
// 模式：默认扫【暂存区新增行】；可用 `--range <git-range>` 扫范围内新增行——存量违例不拦（渐进收口）
// 豁免：Infrastructure/Data/EFRepository.cs（统一审计写入）、Data/DbSeeder.cs（种子初始化无 HTTP 上下文，显式 "system" 属「显式值优先」合法用法）、tests/（测试种子需固定审计时间值测边界语义，直填实体不经 EFRepository 审计路径）
// 约定：违例输出到 stderr 并 exit 1；参数错误 exit 2；干净无输出 exit 0（对齐 check-architecture，兼容 agent hook JSON 解析）
// 自 check-audit-fields.sh 移植 node（2026-10-08 门禁去 sh 化第二批）——语义逐条对齐。
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const usage = () => console.error(`用法: ${process.argv[1].split(/[\\/]/).pop()} [--range <git-range>]`);
const args = process.argv.slice(2);
let gitRange = '';
if (args.length === 2) {
  if (args[0] !== '--range' || args[1] === '' || args[1].startsWith('-')) { usage(); process.exit(2); }
  gitRange = args[1];
} else if (args.length !== 0) { usage(); process.exit(2); }

const git = (a) => {
  const r = spawnSync('git', a, { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, out: r.stdout || '' };
};
const root = git(['rev-parse', '--show-toplevel']);
if (!root.ok) { console.error('check-audit-fields: 不在 git 仓库内,门禁 fail-closed,不静默放行'); process.exit(1); }
process.chdir(root.out.trim());

const names = gitRange === '' ? git(['diff', '--cached', '--name-only', '--', '*.cs']) : git(['diff', '--name-only', gitRange, '--', '*.cs']);
if (!names.ok) { console.error(`无效 git range: ${gitRange}`); usage(); process.exit(2); }
if (names.out.trim() === '') process.exit(0);

// 左值判定：审计字段被赋值（Operator 后跟 `=` 或 `??=`；OperatorName 等标识符、`==` 比较、`{ get; set; }` 声明天然不匹配）
const auditRe = /(Operator|OperatorJobNo|OperateTime|CreatedBy|CreatedByJobNo|CreatedTime)\s*(\?\?=|=[^=])/;
// 右值豁免：同名属性拷贝（手写 DTO 映射 `Operator = x.Operator` 是读不是补写审计）
const copyRe = /(^|[^?])=\s*[A-Za-z0-9_.]*\.(Operator|OperatorJobNo|OperateTime|CreatedBy|CreatedByJobNo|CreatedTime)\s*([;,})]|$)/;

const patch = gitRange === '' ? git(['diff', '--cached', '-U0', '--', '*.cs']) : git(['diff', '-U0', gitRange, '--', '*.cs']);
const hits = [];
let file = '';
for (const line of patch.out.split('\n')) {
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
  if (!/^\+[^+]/.test(line)) continue;
  const content = line.slice(1);
  if (!auditRe.test(content) || copyRe.test(content)) continue;
  if (/\/EFRepository\.cs:/.test(`${file}:${content}`) || /\/CreationAuditExtensions\.cs:/.test(`${file}:${content}`) || /\/DbSeeder\.cs:/.test(`${file}:${content}`) || /tests\//.test(file) || /Migrations\//.test(file)) continue;
  // ICreationAudit 显式实现桥接（实体 CreatedTime 非空列 → 接口可空）：setter 是单源写入器，不是手工补写
  if (/set => CreatedTime = value/.test(content)) continue;
  hits.push(`${file}:${content}`);
}
if (hits.length > 0) {
  console.error('审计字段红线违例（AGENTS.md）：目标 diff 新增行手工补写 Operator*/CreatedBy*，应由 EFRepository / ApplyCreationAudit 统一写入：');
  console.error(hits.join('\n'));
  process.exit(1);
}
process.exit(0);
