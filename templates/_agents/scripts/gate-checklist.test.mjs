// gate-checklist.test.mjs — gate-checklist 工具测试（2026-09-25 gate-checklist）
// 方法：fixture mini doctor.mjs + check-loop.sh，调 gateChecklist() 拿结构化结果（不依赖真实仓库文件）
// 判据：① fixture 场景全过  ② 真实仓库扫读 PASS（doctor ≥7 项 / check-loop ≥11 项）
// 用法：node .agents/scripts/gate-checklist.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateChecklist } from './gate-checklist.mjs';

let pass = 0, failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { failCount++; console.log('FAIL ' + name + (detail ? '——' + detail : '')); }
}

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// fixture：最小可识别 doctor 源码（3 个检查主题 × 多 level 分支）+ check-loop（3 项）
// 设计：PASS / FAIL / WARN 分支用相同概念前缀，方便聚类算法合并
const FIXTURE_DOCTOR = `// doctor.mjs fixture
function fake() {
  const r = [];
  const add = (l, m) => r.push({ l, m });
  // 主题 1：Node 版本（PASS / FAIL 双分支）
  if (major >= 18) add('PASS', \`Node \${process.versions.node}（≥18）\`);
  else add('FAIL', \`Node \${process.versions.node} 过低\`);
  // 主题 2：目录布局（PASS / FAIL 双分支）—— PASS / FAIL 共享概念词「目录布局」
  if (missing.length === 0) add('PASS', \`目录布局（完整：\${required.length} 个关键路径）\`);
  else add('FAIL', \`目录布局（缺失：\${missing.join('、')}）\`);
  // 主题 3：占位符残留（PASS / WARN 双分支）—— PASS / WARN 共享概念词「占位符」
  if (phHits.length === 0) add('PASS', '占位符（无残留）');
  else add('WARN', \`占位符（残留 \${phHits.length} 处）\`);
  return r;
}
`;

const FIXTURE_CL = `#!/bin/sh
# 1. Node 版本检查（advisory）
# 2. 占位符残留 [warning]
# 3. 独有项：文件名 kebab-case [warning]
`;

// ---- 场景 1：fixture 上识别 3 个 doctor 主题（Node / 目录布局 / 占位符残留）----
{
  const r = gateChecklist({ doctorSrc: FIXTURE_DOCTOR, checkLoopSrc: FIXTURE_CL });
  check('S1 fixture doctor 聚类后 3 个主题（PASS/FAIL 分支合并）', r.doctorCount === 3, JSON.stringify({ count: r.doctorCount, concepts: r.doctor.map((d) => d.concept) }));
}

// ---- 场景 2：fixture check-loop 识别 3 项（#1-#3）----
{
  const r = gateChecklist({ doctorSrc: FIXTURE_DOCTOR, checkLoopSrc: FIXTURE_CL });
  check('S2 fixture check-loop 3 项', r.checkLoopCount === 3, JSON.stringify({ count: r.checkLoopCount }));
}

// ---- 场景 3：关键字匹配——Node 主题 ↔ #1 Node 版本检查----
{
  const r = gateChecklist({ doctorSrc: FIXTURE_DOCTOR, checkLoopSrc: FIXTURE_CL });
  const matched = r.matched.find((m) => m.doctor.concept.includes('Node'));
  check('S3 Node 主题与 #1 Node 检查匹配', matched !== undefined && matched.cl.id === '1', JSON.stringify(r.matched.map((m) => m.cl.id)));
}

// ---- 场景 4：关键字匹配——占位符 ↔ #2 占位符残留----
{
  const r = gateChecklist({ doctorSrc: FIXTURE_DOCTOR, checkLoopSrc: FIXTURE_CL });
  const matched = r.matched.find((m) => m.doctor.concept.includes('占位符'));
  check('S4 占位符主题与 #2 占位符残留匹配', matched !== undefined && matched.cl.id === '2', JSON.stringify(r.matched.map((m) => m.cl.id)));
}

// ---- 场景 5：缺点告警——fixture 目录布局 doctor 有、check-loop 无对应----
{
  const r = gateChecklist({ doctorSrc: FIXTURE_DOCTOR, checkLoopSrc: FIXTURE_CL });
  const doctorOnlyGaps = r.gaps.filter((g) => g.kind === 'doctor-only');
  check('S5 医生独有项报告（目录布局）', doctorOnlyGaps.some((g) => g.item.concept.includes('目录布局')));
}

// ---- 场景 6：缺点告警——check-loop 独有（文件名 kebab-case）----
{
  const r = gateChecklist({ doctorSrc: FIXTURE_DOCTOR, checkLoopSrc: FIXTURE_CL });
  const clOnlyGaps = r.gaps.filter((g) => g.kind === 'cl-only');
  check('S6 check-loop 独有项报告（文件名 kebab-case）', clOnlyGaps.some((g) => g.item.id === '3'));
}

// ---- 场景 7：实际仓库扫描——doctor §检查项 ≥ 7（与既有 incident 复盘一致）----
{
  const doctorSrc = fs.readFileSync(path.join(SRC_ROOT, 'src', 'doctor.mjs'), 'utf8');
  const clSrc = fs.readFileSync(path.join(SRC_ROOT, '.agents', 'scripts', 'check-loop.sh'), 'utf8');
  const r = gateChecklist({ doctorSrc, checkLoopSrc: clSrc });
  check('S7 实际仓库 doctor §检查项 ≥ 7（验收 baseline）', r.doctorCount >= 7, '实际 ' + r.doctorCount);
}

// ---- 场景 8：实际仓库扫描——check-loop §检查项 ≥ 11（注释 #1-#13）----
{
  const doctorSrc = fs.readFileSync(path.join(SRC_ROOT, 'src', 'doctor.mjs'), 'utf8');
  const clSrc = fs.readFileSync(path.join(SRC_ROOT, '.agents', 'scripts', 'check-loop.sh'), 'utf8');
  const r = gateChecklist({ doctorSrc, checkLoopSrc: clSrc });
  check('S8 实际仓库 check-loop §检查项 ≥ 11（验收 baseline）', r.checkLoopCount >= 11, '实际 ' + r.checkLoopCount);
}

// ---- 场景 9：result 结构完整（doctor / checkLoop / matched / gaps 字段）----
{
  const r = gateChecklist({ doctorSrc: FIXTURE_DOCTOR, checkLoopSrc: FIXTURE_CL });
  check('S9 result 含 doctor / checkLoop / matched / gaps 字段',
    Array.isArray(r.doctor) && Array.isArray(r.checkLoop) && Array.isArray(r.matched) && Array.isArray(r.gaps));
}

// ---- 场景 10：边界——空字符串不崩----
{
  const r = gateChecklist({ doctorSrc: '', checkLoopSrc: '' });
  check('S10 空字符串 fixture 不崩（0/0）', r.doctorCount === 0 && r.checkLoopCount === 0);
}

console.log('\n合计: PASS ' + pass + ' / FAIL ' + failCount);
process.exit(failCount ? 1 : 0);