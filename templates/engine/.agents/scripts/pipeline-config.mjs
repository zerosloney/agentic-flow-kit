// pipeline-config.mjs — 流水线配置加载（fail-closed）与上下文预算校准
// 解析策略：先按严格 JSON 解析；失败时容忍 JSONC 行注释再试一次（存量项目升级前常见
// 人工部署注释），仍失败才抛 BAD_CONFIG——真畸形 JSON 照样拒，带注释的旧配置不再砖。
import fs from 'node:fs';
import path from 'node:path';

// 剥离字符串字面量之外的 `//` 行尾注释：逐行状态机跟踪是否在 " 内与转义 \。
// 不认 /* */ 块注释：只做逐行判断，避免跨行块边界猜错而吞掉真实内容；
// 字符串内的 // 原样保留（如 "url": "http://x//y"）。
function stripTrailingLineComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inString) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

// JSONC 注释剥离（仅整行 // / # 与字符串外的行尾 //）。规则故意从严：剥离后仍 parse 失败
// 就照旧抛 BAD_CONFIG，真畸形 JSON 依旧被拒，fail-closed 合同不破。
function stripJsoncComments(raw) {
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    out.push(stripTrailingLineComment(line));
  }
  return out.join('\n');
}

function readJsonStrict(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const e = new Error(`${label} 读取失败 (${file}): ${err.message}`);
    e.code = 'BAD_CONFIG';
    throw e;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // 本仓模板生成的 pipeline.json 不含注释，但存量项目升级前常见人工加的部署注释；
    // 旧加载器对解析失败静默降级 {}，新版 fail-closed 直接抛会让这些项目每次
    // start/next/resume 都挂。故先剥离注释重试一次，仍失败才按原错误报 BAD_CONFIG。
    try {
      parsed = JSON.parse(stripJsoncComments(raw));
    } catch {
      const e = new Error(`${label} JSON 解析失败 (${file}): ${err.message}`);
      e.code = 'BAD_CONFIG';
      throw e;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const e = new Error(`${label} 顶层必须为 JSON 对象 (${file})`);
    e.code = 'BAD_CONFIG';
    throw e;
  }
  return parsed;
}

// 阶段产物契约（R3-5）：文件缺失时返回 {}，文件存在但损坏时 fail-closed 报错。
export function loadPipelineConfig(root) {
  const file = path.join(root, '.agents', 'config', 'pipeline.json');
  if (!fs.existsSync(file)) return {};
  return readJsonStrict(file, 'pipeline.json');
}

// 派发与预算配置：文件缺失时返回 {}，文件存在但损坏时 fail-closed 报错。
export function loadDispatchConfig(root) {
  const file = path.join(root, '.agents', 'config', 'dispatch.json');
  if (!fs.existsSync(file)) return {};
  return readJsonStrict(file, 'dispatch.json');
}

// 模型角色映射配置：优先 .agents/config/model-roles.local.json，回退 model-roles.json；存在但损坏时 fail-closed 报错。
export function loadModelRolesConfig(root) {
  const localFile = path.join(root, '.agents', 'config', 'model-roles.local.json');
  if (fs.existsSync(localFile)) {
    return readJsonStrict(localFile, 'model-roles.local.json');
  }
  const defaultFile = path.join(root, '.agents', 'config', 'model-roles.json');
  if (fs.existsSync(defaultFile)) {
    return readJsonStrict(defaultFile, 'model-roles.json');
  }
  return {};
}

/**
 * 中英文混合文本的上下文等效单位估算（P2 校准）：
 * 中文字符信息/Token 密度高于英文（约 1.5~2 倍），纯按字符数截断会过度裁剪英文工单。
 * CJK 字符按 1.5 权重、其余字符按 0.5 权重估算（纯英文 1200 字符 ≈ 600 单位，纯中文 800 字 ≈ 1200 单位）。
 */
export function estimateContextUnits(text) {
  const s = String(text || '');
  if (!s) return 0;
  let units = 0;
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    const isCjk = (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
    units += isCjk ? 1.5 : 0.5;
  }
  return Math.ceil(units);
}

// ── 工单上下文精简与 Token 预算（Option 2 + P2 中英文校准） ─────────────
export function pruneWorkOrderContext(context, budgetChars = 1200) {
  if (!context || typeof context !== 'object') {
    return {
      budget: {
        originalChars: 0,
        prunedChars: 0,
        originalUnits: 0,
        prunedUnits: 0,
        budgetChars,
        pruned: false,
        savingsPercent: 0,
      },
    };
  }
  const serialized = JSON.stringify(context);
  const originalChars = serialized.length;
  const originalUnits = estimateContextUnits(serialized);
  if (originalChars <= budgetChars) {
    return {
      ...context,
      budget: {
        originalChars,
        prunedChars: originalChars,
        originalUnits,
        prunedUnits: originalUnits,
        budgetChars,
        pruned: false,
        savingsPercent: 0,
      },
    };
  }

  const prunedContext = { ...context };

  if (Array.isArray(prunedContext.relatedDocs)) {
    prunedContext.relatedDocs = [...new Set(prunedContext.relatedDocs)].slice(0, 4);
  }

  if (Array.isArray(prunedContext.kbHits)) {
    prunedContext.kbHits = prunedContext.kbHits.slice(0, 3).map((h) => {
      const s = String(h || '');
      return s.length > 120 ? s.slice(0, 117) + '...' : s;
    });
  }

  if (typeof prunedContext.stderrTail === 'string' && prunedContext.stderrTail) {
    const lines = prunedContext.stderrTail.split(/\r?\n/).filter(Boolean);
    if (lines.length > 8) {
      const head = lines.slice(0, 3);
      const tail = lines.slice(-5);
      const skipped = lines.length - 8;
      prunedContext.stderrTail = [...head, `... [跳过 ${skipped} 行堆栈/输出] ...`, ...tail].join('\n');
    }
    if (prunedContext.stderrTail.length > 400) {
      prunedContext.stderrTail = prunedContext.stderrTail.slice(0, 397) + '...';
    }
  }

  if (prunedContext.handoff && typeof prunedContext.handoff === 'object') {
    const h = { ...prunedContext.handoff };
    if (Array.isArray(h.touchSetAllowed) && h.touchSetAllowed.length > 10) {
      h.touchSetAllowed = h.touchSetAllowed.slice(0, 10);
    }
    if (Array.isArray(h.touchSetForbidden) && h.touchSetForbidden.length > 10) {
      h.touchSetForbidden = h.touchSetForbidden.slice(0, 10);
    }
    if (typeof h.notes === 'string' && h.notes.length > 200) {
      h.notes = h.notes.slice(0, 197) + '...';
    }
    prunedContext.handoff = h;
  }

  if (prunedContext.slices && typeof prunedContext.slices === 'object') {
    const sl = { ...prunedContext.slices };
    if (typeof sl.planSlice === 'string' && sl.planSlice.length > 400) {
      sl.planSlice = sl.planSlice.slice(0, 397) + '...';
    }
    if (typeof sl.acceptanceCriteria === 'string' && sl.acceptanceCriteria.length > 400) {
      sl.acceptanceCriteria = sl.acceptanceCriteria.slice(0, 397) + '...';
    }
    if (typeof sl.changePlan === 'string' && sl.changePlan.length > 400) {
      sl.changePlan = sl.changePlan.slice(0, 397) + '...';
    }
    if (Array.isArray(sl.allowedFiles) && sl.allowedFiles.length > 10) {
      sl.allowedFiles = sl.allowedFiles.slice(0, 10);
    }
    if (Array.isArray(sl.prescriptions)) {
      sl.prescriptions = sl.prescriptions.slice(0, 5).map((p) => {
        const s = String(p || '');
        return s.length > 120 ? s.slice(0, 117) + '...' : s;
      });
    }
    prunedContext.slices = sl;
  }

  const prunedSerialized = JSON.stringify(prunedContext);
  const prunedChars = prunedSerialized.length;
  const prunedUnits = estimateContextUnits(prunedSerialized);
  const pruned = prunedChars < originalChars;
  const savingsPercent = originalChars > 0 ? Math.max(0, Math.round(((originalChars - prunedChars) / originalChars) * 100)) : 0;

  prunedContext.budget = {
    originalChars,
    prunedChars,
    originalUnits,
    prunedUnits,
    budgetChars,
    pruned,
    savingsPercent,
  };

  return prunedContext;
}
