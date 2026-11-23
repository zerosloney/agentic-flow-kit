// 定级闭集、复核 id、改动方案路径。pipeline-run 与 check-loop §1 共用。
const RANK = { L0: 0, L1: 1, L2: 2, L3: 3 };

const TOUCH = [
  { min: 'L3', terms: ['schema', '迁移 SQL', 'DI 链', '认证与中间件管线'] },
  { min: 'L2', terms: ['编码权威', '共享契约', '既有接口语义', '全局横切口径'] },
];

function rankOf(level) {
  return Object.prototype.hasOwnProperty.call(RANK, level) ? RANK[level] : -1;
}

function isFormLine(line) {
  const t = line.trim();
  if (!t || t.startsWith('>') || t.startsWith('<!--')) return true;
  if (/^- \[ \]/.test(t)) return true;
  if (/→|\$\\rightarrow\$/.test(t) && /级别|L[23]/.test(t)) return true;
  if (/<[^>\n]{1,200}>/.test(t)) return true;
  return false;
}

export function touchProblems(text, level) {
  const have = rankOf(level);
  const hits = { L2: [], L3: [] };
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (/^- \[x\]/i.test(t)) {
      if (/级别至少\s*L3|级别\s*L3/.test(t)) hits.L3.push('红线');
      else if (/级别至少\s*L2|→\s*级别|\$\\rightarrow\$\s*级别/.test(t)) hits.L2.push('红线');
      continue;
    }
    if (isFormLine(line)) continue;
    for (const group of TOUCH) {
      for (const term of group.terms) {
        if (t.includes(term) && !hits[group.min].includes(term)) hits[group.min].push(term);
      }
    }
  }
  const problems = [];
  if (hits.L3.length && have < 3) {
    const words = hits.L3.filter((w) => w !== '红线');
    problems.push(words.length ? `触达${words.join('、')}。级别写 L3。` : '触达结构面。级别写 L3。');
  }
  if (hits.L2.length && have < 2) {
    const words = hits.L2.filter((w) => w !== '红线');
    problems.push(words.length ? `触达${words.join('、')}。级别写 L2。` : '触达红线。级别写 L2。');
  }
  return problems;
}

export function externalReviewId(text) {
  const m = String(text || '').match(/复核上下文：\s*<?([A-Za-z0-9][A-Za-z0-9._:-]{5,})/);
  if (!m) return '';
  const id = m[1].replace(/[>）)。，,；;].*$/, '');
  if (id.length < 6) return '';
  if (/^(todo|xxx|tbd|placeholder|session|subagent|id)$/i.test(id)) return '';
  return id;
}

export function parseReviewMetadata(text) {
  const str = String(text || '');
  const id = externalReviewId(str);

  let reviewerModel = '';
  const modelMatch = str.match(/(?:reviewed\s+by|复核模型|评审模型|模型|reviewer)[:：\s]+([A-Za-z0-9_.-]+)/i);
  if (modelMatch) {
    reviewerModel = modelMatch[1].trim();
  }

  let isDowngraded = false;
  let downgradeReason = '';
  // 审查遗留批 2026-11-23：降级判定收窄——复合标记（跨模型降级/跨模型不可得/自适应降级）仍按子串识别
  //（可出现在结论文行内）；裸词（评审降级/降级/downgrade/fallback）仅认行首键值式显式声明行。
  // 此前正文 prose 提及裸词即误判，spec-review/review 每次通过都重发 review-downgrade 事件，看板恒挂黄标。
  const dgMatch =
    str.match(/(?:跨模型降级|跨模型不可得|自适应降级)[:：\s]+([^\r\n；;。]+)/i) ||
    str.match(/(?:^|\r?\n)[ \t]*(?:[-*+]\s+|>)?\s*(?:评审降级|降级|downgrade|fallback)[ \t]*[:：=][ \t]*([^\r\n；;。]+)/i);
  if (dgMatch) {
    isDowngraded = true;
    downgradeReason = dgMatch[1].trim();
  } else if (/跨模型降级|跨模型不可得|自适应降级|评审降级/.test(str)) {
    isDowngraded = true;
    downgradeReason = '跨模型评审自适应降级';
  }

  return {
    id,
    reviewerModel,
    isDowngraded,
    downgradeReason,
  };
}

// 审查遗留批 2026-11-23：`=` 前缀收窄到长旗标语境（--out=x.json 旗标形态）；裸 key=value 赋值不再
// 被提取进 plan 授权面（此前会放行名为 value.json 的计划外文件，违背「偏离即停」）。`]` 保留：复选框
// 紧贴路径的清单行（- [x]src/a.mjs）仍可入选允许集。
const PATH_RE = /(?:^|[\s`'"（(*\]]|--[\w-]+=)((?:[\w.-]+\/)+[\w.-]*|[\w.-]+\.(?:mjs|cjs|js|ts|tsx|jsx|vue|cs|java|go|py|rs|sql|json|yml|yaml|md|xml|html|css))/g;

export function planPaths(section) {
  const out = new Set();
  for (const m of String(section || '').replace(/\\/g, '/').matchAll(PATH_RE)) {
    const p = m[1].replace(/[),，。；;]+$/, '').replace(/\/+$/, '');
    if (p) out.add(p);
  }
  return out;
}

export function filesOutsidePlan(files, section) {
  const allowed = [...planPaths(section)];
  return files.filter((f) => {
    const n = String(f).replace(/\\/g, '/');
    return !allowed.some((a) => n === a || n.startsWith(`${a}/`));
  });
}
