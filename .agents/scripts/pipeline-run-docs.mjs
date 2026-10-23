// pipeline-run-docs.mjs — 文档纯函数层（2026-10-08 engine-quality-batch，L2 自 pipeline-run.mjs 拆出）
// fmGet / placeholdersIn / sectionBody / validateDraftContent / closeoutComplete / summarizeDoc——
// 零 IO、零 process 依赖、单向被 pipeline-run.mjs（CLI 编排层）消费；判据注释随函数原样迁入。
// export 面 = 原主文件具名导出（placeholdersIn/validateDraftContent/closeoutComplete）+ 层内消费三函数；
// 主文件经 re-export 保持对外导出面不变（workflow-board-server 等消费方零改动）。
export function fmGet(text, key) {
  const m = text.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  return m ? m.slice(key.length + 1).trim() : null;
}

// 占位符判定（复核 P1-3 收窄，2026-10-02）：先剔除 code span（`…`）与引号串（"…"）——
// 正文合法的命令语法占位（如 `next --delegated "<原话>"`）几乎总在 code span 内，
// 模板实占位符（如 <为什么做；写明需求来源…>）从不包 code span；再匹配剩余裸尖括号。
export function placeholdersIn(text) {
  const stripped = String(text)
    .replace(/^```[\s\S]*?^```$/gm, '') // 复核 P2-B：跨行 code fence 整块剔除（围栏内命令示例占位不属模板占位符）
    .replace(/`[^`\n]*`/g, '')
    .replace(/"[^"\n]*"/g, '');
  const hits = [];
  for (const re of [/<[^>\n]{1,60}>/g, /YYYY-MM-DD 用户/g]) {
    let m; while ((m = re.exec(stripped))) hits.push(m[0]);
  }
  return [...new Set(hits)].slice(0, 5);
}

export function sectionBody(text, title) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === `## ${title}` || l.trim() === `## ${title}（L1 微改动无实质内容可删本节，不硬填）` || l.trim().startsWith(`## ${title}`));
  if (i < 0) return null;
  const body = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^##\s/.test(lines[j])) break;
    body.push(lines[j]);
  }
  return body.join('\n').trim();
}

export function validateDraftContent(text, kind, level) {
  const problems = [];
  if (!text) return ['文件不存在或为空'];
  const state = fmGet(text, '状态');
  if (!state) problems.push('frontmatter 缺「状态:」行');
  if (kind !== 'incident' && !fmGet(text, '级别')) problems.push('frontmatter 缺「级别:」行');
  const ph = placeholdersIn(text);
  if (ph.length) problems.push(`模板占位符残留：${ph.join('、')}`);
  const required = {
    intent: level === 'L1' ? ['背景与问题', '目标', '验收标准'] : ['背景与问题', '历史教训/防复发', '目标', '非目标', '约束', '验收标准'],
    spec: ['功能行为', '数据流', '系统改动', '约束遵守映射'],
    plan: level === 'L1' ? ['改动方案', '约束与风险', '验证计划'] : ['改动方案', '任务拆解', '执行顺序', '验证计划'],
    incident: ['时间线', '根因', '复盘三件套'],
  }[kind] || [];
  for (const sec of required) {
    const b = sectionBody(text, sec);
    if (b === null) { if (!(level === 'L1' && ['非目标', '约束', '任务拆解', '执行顺序'].includes(sec))) problems.push(`缺节：## ${sec}`); }
    else if (!b) problems.push(`节为空：## ${sec}`);
  }
  return problems;
}

export function closeoutComplete(text) {
  const body = sectionBody(text, '验收标准');
  if (body === null) return { ok: false, problems: ['缺「## 验收标准」节'] };
  const lines = body.split(/\r?\n/);
  const open = lines.filter((l) => /^\s*-\s\[\s\]\s/.test(l));
  // 复核 P2-6：证据冒号后须直接跟内容（非空白、非收括号）——「（证据：）」空值不算过
  const checkedNoEv = lines.filter((l) => /^\s*-\s\[x\]\s/.test(l) && !/证据[:：][^）\s]/.test(l));
  const problems = [];
  if (open.length) problems.push(`未勾验收 ${open.length} 条`);
  if (checkedNoEv.length) problems.push(`已勾缺证据 ${checkedNoEv.length} 条`);
  return { ok: problems.length === 0, problems };
}

export function summarizeDoc(text) {
  const body = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('---') && !/^状态:|^级别:|^日期:|^模块:|^备注:|^risk_level:/.test(l));
  return body.slice(0, 3).join(' / ').slice(0, 200);
}
