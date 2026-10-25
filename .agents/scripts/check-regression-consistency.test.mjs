// check-regression-consistency.test.mjs — 回归清单引用一致性纯函数 + 夹具回归
// 覆盖：提取（最长优先不截断 / workflow 归 doc 面 / 易失前缀 / 注释不计 / 裸词不抓）+
//       扫描（悬空分类 / 分片参与 / 无台账零数据）+ CLI（exit 1 点名 / exit 0）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractRefs, scanRegressionRefs } from './check-regression-consistency.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-regression-consistency.mjs');
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` —— ${detail}` : ''}`); }
};

// ---- 纯函数：extractRefs ----
{
  const r = extractRefs('守卫在 src/guard.test.mjs；快照 workflow/evidence/ui-results.json；步骤见 tmp/probe.mjs；说明文档 workflow/specs/2026-10-19-x.md');
  check('提取：代码路径与 .json 不截断（最长优先）', r.codePaths.includes('src/guard.test.mjs') && r.codePaths.includes('workflow/evidence/ui-results.json'), JSON.stringify(r));
  check('提取：workflow/**.md 归 docRefs 不进 codePaths', r.docRefs.includes('workflow/specs/2026-10-19-x.md') && !r.codePaths.includes('workflow/specs/2026-10-19-x.md'), JSON.stringify(r));
  check('提取：tmp/ 前缀归易失面', r.volatilePaths.includes('tmp/probe.mjs') && !r.codePaths.includes('tmp/probe.mjs'), JSON.stringify(r));
}
{
  const r = extractRefs('<!-- 模板说明：src/example.mjs 是示例 -->IntegrationTests 审计与 OrdersController 无路径；判定单源 `check-regression-consistency.mjs` 为裸名提及');
  check('提取：HTML 注释不计 + 裸标识符不抓 + 裸文件名不抓（自举首捉误报面）', r.codePaths.length === 0, JSON.stringify(r));
}

// ---- 夹具：scanRegressionRefs ----
const mkfix = () => fs.mkdtempSync(path.join(os.tmpdir(), 'regr-cons-'));
{
  const T = mkfix();
  fs.mkdirSync(path.join(T, 'workflow'), { recursive: true });
  fs.mkdirSync(path.join(T, 'src'), { recursive: true });
  fs.writeFileSync(path.join(T, 'src', 'guard.test.mjs'), '// ok');
  fs.writeFileSync(path.join(T, 'workflow', 'regression-checklist.md'), [
    '# 回归清单', '',
    '| incident | 条目 | 落点 | 执法者 |', '|---|---|---|---|',
    '| 2026-10-20-x | 守卫拒绝超量 | src/guard.test.mjs | guard 用例 |',
    '| 2026-10-20-x | 已删脚本的旧条目 | scripts/old-tool.mjs | [prompt-only] |',
    '| 2026-10-20-x | 文档引用 | workflow/plans/2026-10-19-x.md | plan |',
    '| 2026-10-20-x | 易失探针 | tmp/probe.mjs | 人工 |',
    '', ''].join('\n'));
  const r = scanRegressionRefs(T);
  check('扫描：存在路径不报、悬空路径与悬空文档分别点名', r.danglingPaths.includes('scripts/old-tool.mjs') && !r.danglingPaths.includes('src/guard.test.mjs') && r.danglingDocs.includes('workflow/plans/2026-10-19-x.md') && r.missingVolatile.includes('tmp/probe.mjs'), JSON.stringify(r));
  // 修复：删过时行 → 干净
  fs.writeFileSync(path.join(T, 'workflow', 'regression-checklist.md'), '# 回归清单\n\n| incident | 条目 | 落点 | 执法者 |\n|---|---|---|---|\n| 2026-10-20-x | 守卫拒绝超量 | src/guard.test.mjs | guard 用例 |\n');
  const r2 = scanRegressionRefs(T);
  check('扫描：清掉过时行后零悬空', r2.danglingPaths.length === 0 && r2.danglingDocs.length === 0, JSON.stringify(r2));
  fs.rmSync(T, { recursive: true, force: true });
}
{
  const T = mkfix(); // 无 workflow/ 目录
  const r = scanRegressionRefs(T);
  check('扫描：台账目录缺失 = 合法零数据', r.danglingPaths.length === 0 && r.danglingDocs.length === 0 && r.missingVolatile.length === 0, JSON.stringify(r));
  fs.rmSync(T, { recursive: true, force: true });
}
{
  // 分片参与：引用只写在当月分片 → 读侧合并后可检
  const T = mkfix();
  fs.mkdirSync(path.join(T, 'workflow', 'regression-checklist.d'), { recursive: true });
  fs.writeFileSync(path.join(T, 'workflow', 'regression-checklist.md'), '# 回归清单\n');
  fs.writeFileSync(path.join(T, 'workflow', 'regression-checklist.d', '2026-10.md'), '| 2026-10-20-y | 老条目 | src/gone.ts | x |\n');
  const r = scanRegressionRefs(T);
  check('扫描：分片引用参与（ledger-shards 读侧合并）', r.danglingPaths.includes('src/gone.ts'), JSON.stringify(r));
  fs.rmSync(T, { recursive: true, force: true });
}

// ---- CLI ----
{
  const T = mkfix();
  fs.mkdirSync(path.join(T, 'workflow'), { recursive: true });
  fs.writeFileSync(path.join(T, 'workflow', 'regression-checklist.md'), '# 回归清单\n\n| i | 条目 | 落点 | 执法者 |\n|---|---|---|---|\n| x | 老条目 | src/missing.vue | y |\n');
  const r1 = spawnSync(process.execPath, [CLI, '--root', T], { encoding: 'utf8' });
  check('CLI：悬空引用 → exit 1 + 点名路径', r1.status === 1 && r1.stderr.includes('src/missing.vue'), JSON.stringify({ s: r1.status, e: r1.stderr }));
  fs.writeFileSync(path.join(T, 'workflow', 'regression-checklist.md'), '# 回归清单\n');
  const r2 = spawnSync(process.execPath, [CLI, '--root', T], { encoding: 'utf8' });
  check('CLI：清单干净 → exit 0', r2.status === 0 && r2.stdout.includes('引用一致'), JSON.stringify({ s: r2.status }));
  fs.rmSync(T, { recursive: true, force: true });
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
