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

export function normalizeModelFamily(model) {
  const m = String(model || '').toLowerCase().trim();
  if (!m) return 'unknown';
  if (/claude|anthropic/.test(m)) return 'claude';
  if (/gpt|o1|o3|o4|openai/.test(m)) return 'openai';
  if (/gemini|google/.test(m)) return 'gemini';
  if (/deepseek/.test(m)) return 'deepseek';
  if (/qwen|alibaba/.test(m)) return 'qwen';
  if (/llama|meta/.test(m)) return 'llama';
  if (/mistral|codestral/.test(m)) return 'mistral';
  return m.replace(/[-_.:0-9].*$/, '') || m;
}

export function isHeterogeneousModel(modelA, modelB) {
  if (!modelA || !modelB) return true; // 未标注或无法识别时放行（降级宽容准则）
  const famA = normalizeModelFamily(modelA);
  const famB = normalizeModelFamily(modelB);
  if (famA === 'unknown' || famB === 'unknown') return true;
  return famA !== famB;
}

export const NEGATIVE_CONCLUSION_RE = /(?:未|不|未能|不予|无法|暂不|尚不)通过|驳回|未批准|拒绝|不认可|否决|退回|不同意|disapproved?|fail(?:ed)?|reject(?:ed)?|nack|not\s+(?:approved?|ok|lgtm|pass(?:ed)?)/i;

export function isApprovedConclusion(conclusion) {
  const c = String(conclusion || '').trim();
  if (!c) return false;
  if (NEGATIVE_CONCLUSION_RE.test(c)) {
    return false;
  }
  return /(?:通过|已通过|approved?|lgtm|ok|pass(?:ed)?)/i.test(c);
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
  // 审查严格收窄：降级判定仅认行首或括号内的键值式显式声明，严禁正文全文子串无冒号误命中
  const dgMatch =
    str.match(/(?:^|\r?\n)[ \t]*(?:[-*+]\s+|>)?\s*(?:跨模型降级|跨模型不可得|自适应降级|评审降级|降级|downgrade|fallback)[ \t]*[:：=][ \t]*([^\r\n；;。]+)/i) ||
    str.match(/[（(]\s*(?:跨模型降级|跨模型不可得|自适应降级|评审降级|降级|downgrade|fallback)[ \t]*[:：=][ \t]*([^)）\r\n]+)[)）]/i);
  if (dgMatch) {
    isDowngraded = true;
    downgradeReason = dgMatch[1].trim();
  }

  // 多复核人与双重背书提取（Dual-Review 支持，按 ID 去重防止重复计数）
  const reviewers = [];
  const seenIds = new Set();
  const lines = str.split(/\r?\n/);
  for (const line of lines) {
    const lineId = externalReviewId(line);
    if (lineId && !seenIds.has(lineId)) {
      seenIds.add(lineId);
      const lineModelMatch = line.match(/(?:reviewed\s+by|复核模型|评审模型|模型|reviewer)[:：\s]+([A-Za-z0-9_.-]+)/i);
      const lineModel = lineModelMatch ? lineModelMatch[1].trim() : (reviewers.length === 0 ? reviewerModel : '');
      const conclusionMatch = line.match(/(?:结论|独立复核|二次复核|复核\s*[12一二]|复核|评审\s*[12一二]|评审|审阅|review|verdict|conclusion)[:：\s]+([^\s,，;；)）(（]+)/i);
      // 有结论关键字取其后的结论；没有则整行出现否定词取否定短语；都没有 = 没写结论，不算通过
      const conclusion = conclusionMatch
        ? conclusionMatch[1].trim()
        : (NEGATIVE_CONCLUSION_RE.exec(line)?.[0] || '');
      reviewers.push({
        id: lineId,
        reviewerModel: lineModel,
        conclusion,
      });
    }
  }

  if (reviewers.length === 0 && id) {
    reviewers.push({
      id,
      reviewerModel,
      conclusion: '通过',
    });
  }

  const dualEndorsed =
    reviewers.length >= 2 &&
    reviewers.every((r) => isApprovedConclusion(r.conclusion));

  return {
    id,
    reviewerModel,
    isDowngraded,
    downgradeReason,
    reviewers,
    dualEndorsed,
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

// ── 结构化交接工件契约 (Handoff Sheet) ──────────────────────────────────
export function buildHandoffSheet({
  from,
  to,
  task,
  gitBaseSha = null,
  touchSetAllowed = [],
  touchSetForbidden = [],
  specDoc = null,
  notes = '',
} = {}) {
  return {
    from: String(from || '').trim(),
    to: String(to || '').trim(),
    task: String(task || '').trim(),
    gitBaseSha: gitBaseSha ? String(gitBaseSha).trim() : null,
    touchSetAllowed: Array.isArray(touchSetAllowed)
      ? [...new Set(touchSetAllowed.filter(Boolean).map((p) => String(p).trim()))]
      : typeof touchSetAllowed === 'string' && touchSetAllowed.trim()
        ? touchSetAllowed.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        : [],
    touchSetForbidden: Array.isArray(touchSetForbidden)
      ? [...new Set(touchSetForbidden.filter(Boolean).map((p) => String(p).trim()))]
      : typeof touchSetForbidden === 'string' && touchSetForbidden.trim()
        ? touchSetForbidden.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        : [],
    specDoc: specDoc ? String(specDoc).trim() : null,
    notes: notes ? String(notes).trim() : '',
  };
}

export function validateHandoffSheet(sheet) {
  const problems = [];
  if (!sheet || typeof sheet !== 'object') {
    return { ok: false, problems: ['交接单必须为对象'] };
  }
  if (!sheet.from || typeof sheet.from !== 'string' || !sheet.from.trim()) {
    problems.push('交接单缺少来源 (from)');
  }
  if (!sheet.to || typeof sheet.to !== 'string' || !sheet.to.trim()) {
    problems.push('交接单缺少去向 (to)');
  }
  if (!sheet.task || typeof sheet.task !== 'string' || !sheet.task.trim()) {
    problems.push('交接单缺少任务主题 (task)');
  }
  if (sheet.gitBaseSha != null && typeof sheet.gitBaseSha !== 'string') {
    problems.push('交接单 gitBaseSha 类型非法');
  }
  if (!Array.isArray(sheet.touchSetAllowed)) {
    problems.push('交接单 touchSetAllowed 必须为数组');
  } else {
    for (const p of sheet.touchSetAllowed) {
      if (typeof p !== 'string' || !p.trim()) {
        problems.push('交接单 touchSetAllowed 包含非字符串或空元素');
      } else if (p === '.' || p === '..' || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p)) {
        problems.push(`交接单 touchSetAllowed 包含非法路径穿越: ${p}`);
      }
    }
  }
  if (!Array.isArray(sheet.touchSetForbidden)) {
    problems.push('交接单 touchSetForbidden 必须为数组');
  } else {
    for (const p of sheet.touchSetForbidden) {
      if (typeof p !== 'string' || !p.trim()) {
        problems.push('交接单 touchSetForbidden 包含非字符串或空元素');
      } else if (p === '.' || p === '..' || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p)) {
        problems.push(`交接单 touchSetForbidden 包含非法路径穿越: ${p}`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

export function parseHandoffSheet(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // 1. JSON 解析尝试（含 Markdown 代码块提取）
  try {
    const jsonBlock = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    const candidate = jsonBlock ? jsonBlock[1].trim() : raw;
    const obj = JSON.parse(candidate);
    if (obj && typeof obj === 'object') {
      return buildHandoffSheet(obj);
    }
  } catch {}

  // 2. Markdown / YAML 键值解析
  const out = {
    from: '',
    to: '',
    task: '',
    gitBaseSha: null,
    touchSetAllowed: [],
    touchSetForbidden: [],
    specDoc: null,
    notes: '',
  };

  const lines = raw.split(/\r?\n/);
  let currentListKey = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '---' || trimmed.startsWith('<!--')) continue;

    // 列表项匹配（支持 Windows 盘符路径如 C:\... 或 c:/...）
    const listItemMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (listItemMatch && currentListKey) {
      const item = listItemMatch[1].trim();
      const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(item);
      if (item && (!item.includes(':') || isWindowsPath)) {
        out[currentListKey].push(item);
        continue;
      }
    }

    // 键值匹配
    const kvMatch = trimmed.match(/^[-*+]?\s*([^:：]+)[:：]\s*(.*)$/);
    if (kvMatch) {
      const k = kvMatch[1].trim().toLowerCase();
      const v = kvMatch[2].trim();

      if (k === 'from' || k.includes('来源')) {
        out.from = v;
        currentListKey = null;
      } else if (k === 'to' || k.includes('去向') || k.includes('目标')) {
        out.to = v;
        currentListKey = null;
      } else if (k === 'task' || k.includes('任务') || k.includes('主题')) {
        out.task = v;
        currentListKey = null;
      } else if (k === 'gitbasesha' || k === 'sha' || k.includes('基准')) {
        out.gitBaseSha = v || null;
        currentListKey = null;
      } else if (k === 'touchsetallowed' || k.includes('允许改动') || k.includes('允许文件')) {
        currentListKey = 'touchSetAllowed';
        if (v) {
          out.touchSetAllowed.push(...v.split(/[,\s]+/).filter(Boolean));
        }
      } else if (k === 'touchsetforbidden' || k.includes('禁止改动') || k.includes('禁止文件')) {
        currentListKey = 'touchSetForbidden';
        if (v) {
          out.touchSetForbidden.push(...v.split(/[,\s]+/).filter(Boolean));
        }
      } else if (k === 'specdoc' || k.includes('规格文档')) {
        out.specDoc = v || null;
        currentListKey = null;
      } else if (k === 'notes' || k.includes('备注')) {
        out.notes = v;
        currentListKey = null;
      } else {
        currentListKey = null;
      }
    }
  }

  if (!out.from && !out.to && !out.task) return null;
  return buildHandoffSheet(out);
}
