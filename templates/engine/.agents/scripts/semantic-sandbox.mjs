import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gitOut } from './git-core.mjs';

// 语义沙箱支持符号级分析的语言闭集；其余扩展名一律 fail-closed。
export const SUPPORTED_SANDBOX_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.jsx', '.py', '.go'];
const JS_TS_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.jsx'];

// ── 签名与指纹规范化 ────────────────────────────────────────────────────────

export function normalizeSignature(sig) {
  return String(sig || '')
    .replace(/\s*\{?\s*$/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(){}[\]:,;=])\s*/g, '$1')
    .replace(/([,;])\s*/g, '$1 ')
    .trim();
}

export function computeSymbolDigest(body) {
  const norm = String(body || '').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

// ── 括号块与文本扫描器 ──────────────────────────────────────────────────────

function extractBraceBlock(source, openBraceIdx) {
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let i = openBraceIdx; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
    } else {
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return {
            body: source.slice(openBraceIdx, i + 1),
            endIdx: i + 1,
          };
        }
      }
    }
  }
  return {
    body: source.slice(openBraceIdx),
    endIdx: source.length,
  };
}

function lineNumberOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function endOfLineAt(source, index) {
  const nl = source.indexOf('\n', Math.max(0, index));
  return nl === -1 ? source.length : nl;
}

function computeLineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

// ── 多语言符号提取器 (AST / Symbol Extractor) ──────────────────────────────

export function extractSymbols(source, ext = '.js', filePath = '') {
  const code = String(source || '');
  if (!code.trim()) return [];

  const effectiveExt = (ext || path.extname(filePath) || '.js').toLowerCase();

  if (JS_TS_EXTS.includes(effectiveExt)) {
    return extractJsTsSymbols(code);
  }
  if (effectiveExt === '.py') {
    return extractPythonSymbols(code);
  }
  if (effectiveExt === '.go') {
    return extractGoSymbols(code);
  }

  return [];
}

function extractJsTsSymbols(source) {
  const symbols = [];
  // 同名声明按出现顺序全部保留（函数重声明、TS interface/class 合并），不按名去重
  const symbolMap = new Map();
  const addSymbol = (name, sym) => {
    const list = symbolMap.get(name);
    if (list) list.push(sym);
    else symbolMap.set(name, [sym]);
  };

  // 1. 常规函数声明: export [async] function name(...) { ... }
  const funcDeclRe = /(?:^|\n)[ \t]*(export\s+(?:default\s+)?)?(async\s+)?function\s*([A-Za-z0-9_$]+)\s*(\([^)]*\))/g;
  let m;
  while ((m = funcDeclRe.exec(source)) !== null) {
    const isExported = Boolean(m[1]);
    const isAsync = Boolean(m[2]);
    const name = m[3];
    const params = m[4];
    const startIdx = m.index;
    const sigRaw = `${isExported ? 'export ' : ''}${isAsync ? 'async ' : ''}function ${name}${params}`;
    const braceIdx = source.indexOf('{', m.index + m[0].length);
    let body = '';
    let endIdx = endOfLineAt(source, m.index + m[0].length);
    if (braceIdx !== -1 && braceIdx - (m.index + m[0].length) < 50) {
      const block = extractBraceBlock(source, braceIdx);
      body = block.body;
      endIdx = block.endIdx;
    }
    const sym = {
      name,
      kind: 'function',
      isExported,
      signature: normalizeSignature(sigRaw),
      bodyDigest: computeSymbolDigest(body || sigRaw),
      line: lineNumberOf(source, startIdx),
      start: m.index + (m[0].length - m[0].trimStart().length),
      end: endIdx,
    };
    addSymbol(name, sym);
  }

  // 2. 变量赋值函数: export const name = [async] (...) => { ... }
  const arrowRe = /(?:^|\n)[ \t]*(export\s+)?(const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?(?:\(([^)]*)\)|([A-Za-z0-9_$]+))\s*=>/g;
  while ((m = arrowRe.exec(source)) !== null) {
    const isExported = Boolean(m[1]);
    const keyword = m[2];
    const name = m[3];
    const isAsync = Boolean(m[4]);
    const params = m[5] != null ? `(${m[5]})` : `(${m[6]})`;
    const startIdx = m.index;
    const sigRaw = `${isExported ? 'export ' : ''}${keyword} ${name} = ${isAsync ? 'async ' : ''}${params} =>`;
    const rest = source.slice(m.index + m[0].length).trimStart();
    const bodyStart = m.index + m[0].length;
    let body = '';
    let endIdx = source.length;
    if (rest.startsWith('{')) {
      const braceIdx = source.indexOf('{', m.index + m[0].length);
      const block = extractBraceBlock(source, braceIdx);
      body = block.body;
      endIdx = block.endIdx;
    } else {
      const endOfStmt = source.slice(m.index + m[0].length).search(/[;\n]/);
      body = endOfStmt !== -1
        ? source.slice(m.index + m[0].length, m.index + m[0].length + endOfStmt)
        : source.slice(m.index + m[0].length);
      endIdx = endOfStmt === -1
        ? source.length
        : bodyStart + endOfStmt + (source[bodyStart + endOfStmt] === ';' ? 1 : 0);
    }
    const sym = {
      name,
      kind: 'function',
      isExported,
      signature: normalizeSignature(sigRaw),
      bodyDigest: computeSymbolDigest(body),
      line: lineNumberOf(source, startIdx),
      start: m.index + (m[0].length - m[0].trimStart().length),
      end: endIdx,
    };
    addSymbol(name, sym);
  }

  // 3. 类声明: export class Name [extends Base] { ... }
  const classRe = /(?:^|\n)[ \t]*(export\s+(?:default\s+)?)?class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$.]+))?/g;
  while ((m = classRe.exec(source)) !== null) {
    const isExported = Boolean(m[1]);
    const name = m[2];
    const extClass = m[3];
    const startIdx = m.index;
    const sigRaw = `${isExported ? 'export ' : ''}class ${name}${extClass ? ` extends ${extClass}` : ''}`;
    const braceIdx = source.indexOf('{', m.index + m[0].length);
    let body = '';
    let endIdx = endOfLineAt(source, m.index + m[0].length);
    if (braceIdx !== -1 && braceIdx - (m.index + m[0].length) < 50) {
      const block = extractBraceBlock(source, braceIdx);
      body = block.body;
      endIdx = block.endIdx;
    }
    const sym = {
      name,
      kind: 'class',
      isExported,
      signature: normalizeSignature(sigRaw),
      bodyDigest: computeSymbolDigest(body || sigRaw),
      line: lineNumberOf(source, startIdx),
      start: m.index + (m[0].length - m[0].trimStart().length),
      end: endIdx,
    };
    addSymbol(name, sym);
  }

  // 4. TS 接口与类型: export interface Name / export type Name
  const interfaceRe = /(?:^|\n)[ \t]*(export\s+)?interface\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([^{]+))?/g;
  while ((m = interfaceRe.exec(source)) !== null) {
    const isExported = Boolean(m[1]);
    const name = m[2];
    const extClause = m[3] ? m[3].trim() : '';
    const startIdx = m.index;
    const sigRaw = `${isExported ? 'export ' : ''}interface ${name}${extClause ? ` extends ${extClause}` : ''}`;
    const braceIdx = source.indexOf('{', m.index + m[0].length);
    let body = '';
    let endIdx = endOfLineAt(source, m.index + m[0].length);
    if (braceIdx !== -1 && braceIdx - (m.index + m[0].length) < 50) {
      const block = extractBraceBlock(source, braceIdx);
      body = block.body;
      endIdx = block.endIdx;
    }
    const sym = {
      name,
      kind: 'interface',
      isExported,
      signature: normalizeSignature(sigRaw),
      bodyDigest: computeSymbolDigest(body || sigRaw),
      line: lineNumberOf(source, startIdx),
      start: m.index + (m[0].length - m[0].trimStart().length),
      end: endIdx,
    };
    addSymbol(name, sym);
  }

  const typeRe = /(?:^|\n)[ \t]*(export\s+)?type\s+([A-Za-z0-9_$]+)(?:<[^>]+>)?\s*=\s*([^;\n]+)/g;
  while ((m = typeRe.exec(source)) !== null) {
    const isExported = Boolean(m[1]);
    const name = m[2];
    const typeDef = m[3].trim();
    const startIdx = m.index;
    const sigRaw = `${isExported ? 'export ' : ''}type ${name} = ${typeDef}`;
    let endIdx = m.index + m[0].length;
    if (source[endIdx] === ';') endIdx += 1;
    const sym = {
      name,
      kind: 'type',
      isExported,
      signature: normalizeSignature(sigRaw),
      bodyDigest: computeSymbolDigest(typeDef),
      line: lineNumberOf(source, startIdx),
      start: m.index + (m[0].length - m[0].trimStart().length),
      end: endIdx,
    };
    addSymbol(name, sym);
  }

  // 5. 命名导出捕获: export { a, b as c }
  const namedExportRe = /(?:^|\n)[ \t]*export\s*\{\s*([^}]+)\s*\}/g;
  while ((m = namedExportRe.exec(source)) !== null) {
    const list = m[1].split(',');
    for (const item of list) {
      const parts = item.trim().split(/\s+as\s+/);
      const original = parts[0].trim();
      if (symbolMap.has(original)) {
        for (const s of symbolMap.get(original)) s.isExported = true;
      } else if (original) {
        let exportEnd = m.index + m[0].length;
        while (exportEnd < source.length && source[exportEnd] !== ';' && source[exportEnd] !== '\n') exportEnd++;
        if (source[exportEnd] === ';') exportEnd += 1;
        addSymbol(original, {
          name: original,
          kind: 'export',
          isExported: true,
          signature: `export { ${original} }`,
          bodyDigest: computeSymbolDigest(original),
          line: lineNumberOf(source, m.index),
          start: m.index + (m[0].length - m[0].trimStart().length),
          end: exportEnd,
        });
      }
    }
  }

  for (const list of symbolMap.values()) {
    for (const s of list) symbols.push(s);
  }
  symbols.sort((a, b) => a.line - b.line);
  return symbols;
}

function extractPythonSymbols(source) {
  const symbols = [];
  const lines = source.split(/\r?\n/);
  const lineStarts = computeLineStarts(source);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const funcMatch = line.match(/^[ \t]*(async\s+)?def\s+([A-Za-z0-9_]+)\s*(\([^)]*\))/);
    if (funcMatch) {
      const isAsync = Boolean(funcMatch[1]);
      const name = funcMatch[2];
      const params = funcMatch[3];
      const isExported = !name.startsWith('_');
      const sigRaw = `${isAsync ? 'async ' : ''}def ${name}${params}`;
      // 提取同一缩进下的函数体
      const indent = line.match(/^[ \t]*/)[0].length;
      const bodyLines = [];
      let endLine = i;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (!nextLine.trim()) continue;
        const nextIndent = nextLine.match(/^[ \t]*/)[0].length;
        if (nextIndent <= indent) break;
        bodyLines.push(nextLine);
        endLine = j;
      }
      symbols.push({
        name,
        kind: 'function',
        isExported,
        signature: normalizeSignature(sigRaw),
        bodyDigest: computeSymbolDigest(bodyLines.join('\n')),
        line: i + 1,
        start: lineStarts[i],
        end: lineStarts[endLine] + lines[endLine].length,
      });
      continue;
    }

    const classMatch = line.match(/^[ \t]*class\s+([A-Za-z0-9_]+)(?:\(([^)]*)\))?:/);
    if (classMatch) {
      const name = classMatch[1];
      const base = classMatch[2] ? `(${classMatch[2]})` : '';
      const isExported = !name.startsWith('_');
      const sigRaw = `class ${name}${base}`;
      const indent = line.match(/^[ \t]*/)[0].length;
      const bodyLines = [];
      let endLine = i;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (!nextLine.trim()) continue;
        const nextIndent = nextLine.match(/^[ \t]*/)[0].length;
        if (nextIndent <= indent) break;
        bodyLines.push(nextLine);
        endLine = j;
      }
      symbols.push({
        name,
        kind: 'class',
        isExported,
        signature: normalizeSignature(sigRaw),
        bodyDigest: computeSymbolDigest(bodyLines.join('\n')),
        line: i + 1,
        start: lineStarts[i],
        end: lineStarts[endLine] + lines[endLine].length,
      });
    }
  }
  return symbols;
}

function extractGoSymbols(source) {
  const symbols = [];
  const lines = source.split(/\r?\n/);
  const lineStarts = computeLineStarts(source);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const funcMatch = line.match(/^func\s*(?:\(([^)]+)\)\s*)?([A-Za-z0-9_]+)\s*(\([^)]*\))/);
    if (funcMatch) {
      const receiver = funcMatch[1] ? `(${funcMatch[1]}) ` : '';
      const name = funcMatch[2];
      const params = funcMatch[3];
      const isExported = /^[A-Z]/.test(name);
      const sigRaw = `func ${receiver}${name}${params}`;
      const braceIdx = source.indexOf('{', lineStarts[i]);
      let body = '';
      let endIdx = lineStarts[i] + line.length;
      if (braceIdx !== -1) {
        const block = extractBraceBlock(source, braceIdx);
        body = block.body;
        endIdx = block.endIdx;
      }
      symbols.push({
        name,
        kind: 'function',
        isExported,
        signature: normalizeSignature(sigRaw),
        bodyDigest: computeSymbolDigest(body || sigRaw),
        line: i + 1,
        start: lineStarts[i] + (line.length - line.trimStart().length),
        end: endIdx,
      });
      continue;
    }

    const typeMatch = line.match(/^type\s+([A-Za-z0-9_]+)\s+(struct|interface)/);
    if (typeMatch) {
      const name = typeMatch[1];
      const kind = typeMatch[2];
      const isExported = /^[A-Z]/.test(name);
      const sigRaw = `type ${name} ${kind}`;
      const braceIdx = source.indexOf('{', lineStarts[i]);
      let body = '';
      let endIdx = lineStarts[i] + line.length;
      if (braceIdx !== -1) {
        const block = extractBraceBlock(source, braceIdx);
        body = block.body;
        endIdx = block.endIdx;
      }
      symbols.push({
        name,
        kind,
        isExported,
        signature: normalizeSignature(sigRaw),
        bodyDigest: computeSymbolDigest(body || sigRaw),
        line: i + 1,
        start: lineStarts[i] + (line.length - line.trimStart().length),
        end: endIdx,
      });
    }
  }
  return symbols;
}

// ── 符号差异比对器 (Symbol Diff Analyzer) ───────────────────────────────────

export function diffSymbols(baseSymbols = [], targetSymbols = []) {
  const groupByName = (symbols) => {
    const map = new Map();
    for (const s of symbols) {
      if (!s || !s.name) continue;
      const list = map.get(s.name);
      if (list) list.push(s);
      else map.set(s.name, [s]);
    }
    return map;
  };
  const baseMap = groupByName(baseSymbols);
  const targetMap = groupByName(targetSymbols);

  const added = [];
  const removed = [];
  const signatureChanged = [];
  const bodyChanged = [];
  const unchanged = [];
  const declarationCountChanged = [];

  // 同名声明仅在数量一致时按出现顺序配对；数量变化单独报告，避免错位配对
  for (const [name, targets] of targetMap.entries()) {
    const bases = baseMap.get(name) || [];
    if (bases.length !== targets.length) {
      if (bases.length === 0) {
        added.push(...targets);
      } else {
        declarationCountChanged.push({
          name,
          kind: targets[0].kind,
          isExported: targets.some((s) => s.isExported) || bases.some((s) => s.isExported),
          baseCount: bases.length,
          targetCount: targets.length,
        });
      }
      continue;
    }
    for (let i = 0; i < targets.length; i++) {
      const base = bases[i];
      const target = targets[i];
      const sigSame = normalizeSignature(base.signature) === normalizeSignature(target.signature);
      const bodySame = base.bodyDigest === target.bodyDigest;

      if (!sigSame) {
        signatureChanged.push({
          name,
          kind: target.kind,
          isExported: Boolean(target.isExported || base.isExported),
          baseSignature: base.signature,
          targetSignature: target.signature,
          base,
          target,
        });
      } else if (!bodySame) {
        bodyChanged.push({
          name,
          kind: target.kind,
          isExported: target.isExported,
          signature: target.signature,
          baseDigest: base.bodyDigest,
          targetDigest: target.bodyDigest,
          base,
          target,
        });
      } else {
        unchanged.push(target);
      }
    }
  }

  for (const [name, bases] of baseMap.entries()) {
    if (targetMap.has(name)) continue;
    removed.push(...bases);
  }

  return {
    added,
    removed,
    signatureChanged,
    bodyChanged,
    unchanged,
    declarationCountChanged,
  };
}

// ── 规则解析器 (Plan & Config Parser) ───────────────────────────────────────

const PLAN_RULE_PATH_CHAR = /[A-Za-z0-9_./\\-]/;

// 线性扫描规则行：路径字符段 + "." + 扩展名 + 空白 + 括号声明。
// 回溯型正则会在长点链、缺右括号的行上退化为二次复杂度。
function matchPlanRuleLine(t) {
  const n = t.length;
  let i = 0;
  while (i < n) {
    while (i < n && !PLAN_RULE_PATH_CHAR.test(t[i])) i++;
    const start = i;
    while (i < n && PLAN_RULE_PATH_CHAR.test(t[i])) i++;
    if (i === start) continue;
    const token = t.slice(start, i);
    let j = i;
    while (j < n && /\s/.test(t[j])) j++;
    if (t[j] !== '(') continue;
    const dot = token.lastIndexOf('.');
    if (dot <= 0 || !/^[A-Za-z0-9]+$/.test(token.slice(dot + 1))) continue;
    const close = t.indexOf(')', j + 1);
    if (close === -1) return null;
    if (close === j + 1) continue;
    return { filePath: token, decl: t.slice(j + 1, close) };
  }
  return null;
}

export function parsePlanSymbolRules(planText) {
  const str = String(planText || '');
  const allowedSymbols = {};
  const frozenSymbols = {};
  const fileFreezeExports = {};

  const lines = str.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // 匹配行首路径并解析括号内的沙箱声明: - [x] src/foo.mjs (symbols: a, b; freeze: c; freeze-exports)
    const m = matchPlanRuleLine(t);
    if (m) {
      const filePath = normalizeRuleKey(m.filePath);
      const decl = m.decl;

      const symMatch = decl.match(/symbols[:：\s]+([^;)]+)/i);
      if (symMatch) {
        const syms = symMatch[1].split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
        if (syms.length) allowedSymbols[filePath] = syms;
      }

      const freezeMatch = decl.match(/freeze[:：\s]+([^;)]+)/i);
      if (freezeMatch) {
        const frz = freezeMatch[1].split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
        if (frz.length) frozenSymbols[filePath] = frz;
      }

      if (/freeze-exports|freezeExports|导出冻结|接口冻结/i.test(decl)) {
        fileFreezeExports[filePath] = true;
      }
    }
  }

  return {
    allowedSymbols,
    frozenSymbols,
    fileFreezeExports,
  };
}

export function hasSymbolRules(rules) {
  if (!rules || typeof rules !== 'object') return false;
  if (rules.freezeExports) return true;
  if (rules.allowedSymbols && Object.keys(rules.allowedSymbols).length > 0) return true;
  if (rules.frozenSymbols) {
    if (Array.isArray(rules.frozenSymbols) && rules.frozenSymbols.length > 0) return true;
    if (typeof rules.frozenSymbols === 'object' && Object.keys(rules.frozenSymbols).length > 0) return true;
  }
  if (rules.fileFreezeExports && Object.keys(rules.fileFreezeExports).length > 0) return true;
  return false;
}

// ── 沙箱文本工具：区间挖空 / 导出面 (Region & Export Surface) ────────────────

function normalizeRuleKey(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

function lookupFileRule(map, filePath) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, filePath)) return map[filePath];
  const key = normalizeRuleKey(filePath);
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  if (process.platform === 'win32') {
    const lower = key.toLowerCase();
    for (const k of Object.keys(map)) {
      if (normalizeRuleKey(k).toLowerCase() === lower) return map[k];
    }
  }
  return undefined;
}

function fileHasSymbolRule(rules, filePath) {
  const allowed = lookupFileRule(rules?.allowedSymbols, filePath);
  if (Array.isArray(allowed) && allowed.length > 0) return true;
  const scopedFrozen = lookupFileRule(rules?.frozenSymbols, filePath);
  if (Array.isArray(scopedFrozen) && scopedFrozen.length > 0) return true;
  return Boolean(lookupFileRule(rules?.fileFreezeExports, filePath));
}

// 把已识别符号的区间替换成等长空白（保留换行），再去掉注释行与空行后返回剩余文本。
function remainderOf(source, symbols) {
  const text = String(source || '');
  if (!text) return '';
  const chars = text.split('');
  for (const s of symbols || []) {
    const start = Number.isInteger(s?.start) ? s.start : -1;
    const end = Number.isInteger(s?.end) ? s.end : -1;
    if (start < 0 || end <= start) continue;
    for (let i = start; i < end && i < chars.length; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  }
  const kept = [];
  for (const line of chars.join('').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^(?:\/\/|\/\*|\*|\*\/|#)/.test(t)) continue;
    kept.push(t);
  }
  return kept.join('\n');
}

function balanceDelta(line) {
  let delta = 0;
  for (const ch of line) {
    if (ch === '(' || ch === '{' || ch === '[') delta++;
    else if (ch === ')' || ch === '}' || ch === ']') delta--;
  }
  return delta;
}

// 新增文件：挖空已识别符号后，剩余内容只允许 import / export … from。
function scaffoldViolations(remainder, ext) {
  const lines = String(remainder || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const jsTs = JS_TS_EXTS.includes(ext);
  const py = ext === '.py';
  const go = ext === '.go';
  const isImportStart = (s) =>
    (jsTs && /^import\b/.test(s)) ||
    (py && /^(?:import|from)\b/.test(s)) ||
    (go && /^import\b/.test(s));
  const isPackageClause = (s) => go && /^package\s+[A-Za-z0-9_]+/.test(s);
  const isAllowedStatement = (s) => {
    if (isImportStart(s)) return true;
    return jsTs && /^export\b/.test(s) && /\bfrom\b/.test(s);
  };
  const bad = [];
  let pending = null;
  for (const line of lines) {
    if (!pending) {
      if (isPackageClause(line)) continue;
      if (!(isImportStart(line) || (jsTs && /^export\b/.test(line)))) {
        bad.push(line);
        continue;
      }
      pending = { text: line, depth: balanceDelta(line) };
    } else {
      pending.text += `\n${line}`;
      pending.depth += balanceDelta(line);
    }
    if (pending.depth <= 0) {
      if (!isAllowedStatement(pending.text)) bad.push(pending.text.split('\n')[0]);
      pending = null;
    }
  }
  if (pending) bad.push(pending.text.split('\n')[0]);
  return bad;
}

function exportSurfaceLines(remainder, ext) {
  const lines = String(remainder || '').split('\n').filter(Boolean);
  let re = null;
  if (JS_TS_EXTS.includes(ext)) re = /^\s*export\b|module\.exports|^\s*exports\./;
  else if (ext === '.py') re = /^\s*(?:def|class)\s+[A-Za-z]/;
  else if (ext === '.go') re = /^func\s+[A-Z]|^type\s+[A-Z]/;
  if (!re) return [];
  return lines.filter((line) => re.test(line));
}

function countLines(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  return counts;
}

// ── 语义沙箱校验引擎 (Semantic Sandbox Verifier) ────────────────────────────

export function verifySemanticSandbox({
  root = process.cwd(),
  gitBaseSha = 'HEAD',
  changedFiles = [],
  baseSourceMap = null,
  targetSourceMap = null,
  rules = {},
} = {}) {
  const violations = [];
  const diffs = {};

  const filesToCheck = changedFiles.length > 0
    ? changedFiles
    : Object.keys(targetSourceMap || {});

  for (const rawFile of filesToCheck) {
    const filePath = String(rawFile).replace(/\\/g, '/');
    let baseSource = '';
    let targetSource = '';

    if (targetSourceMap && Object.prototype.hasOwnProperty.call(targetSourceMap, filePath)) {
      targetSource = targetSourceMap[filePath];
    } else {
      const absTarget = path.join(root, filePath);
      if (fs.existsSync(absTarget) && fs.statSync(absTarget).isFile()) {
        try {
          targetSource = fs.readFileSync(absTarget, 'utf8');
        } catch {
          targetSource = '';
        }
      }
    }

    if (baseSourceMap && Object.prototype.hasOwnProperty.call(baseSourceMap, filePath)) {
      baseSource = baseSourceMap[filePath];
    } else {
      const out = gitOut(['show', `${gitBaseSha}:${filePath}`], root);
      baseSource = out != null ? out : '';
    }

    const ext = path.extname(filePath).toLowerCase();

    // 语言支持闭集：不支持的语言在命中符号级规则且内容有变化时 fail-closed
    if (
      !SUPPORTED_SANDBOX_EXTS.includes(ext) &&
      fileHasSymbolRule(rules, filePath) &&
      baseSource !== targetSource
    ) {
      violations.push({
        code: 'SANDBOX_UNSUPPORTED_LANGUAGE',
        filePath,
        message: `语义沙箱不支持该语言的符号级分析，无法确认改动仅限授权范围（文件 ${filePath}）`,
      });
      diffs[filePath] = { added: [], removed: [], signatureChanged: [], bodyChanged: [], unchanged: [] };
      continue;
    }

    const baseSymbols = extractSymbols(baseSource, ext, filePath);
    const targetSymbols = extractSymbols(targetSource, ext, filePath);
    const diff = diffSymbols(baseSymbols, targetSymbols);
    diffs[filePath] = diff;

    // 清单里声明、但提取器完全识别不出的符号：无法核验，fail-closed（同文件同名只报一次）
    const recognizedNames = new Set();
    for (const s of [...baseSymbols, ...targetSymbols]) {
      if (s && s.name) recognizedNames.add(s.name);
    }
    const reportedUnresolved = new Set();
    const flagUnresolved = (names) => {
      for (const name of names || []) {
        if (recognizedNames.has(name) || reportedUnresolved.has(name)) continue;
        reportedUnresolved.add(name);
        violations.push({
          code: 'SANDBOX_SYMBOL_UNRESOLVED',
          filePath,
          symbol: name,
          message: `语义沙箱无法识别符号 ${name}（文件 ${filePath}）——声明形式不在识别范围内（如多行签名、函数表达式），不能确认其未被修改；请改用可识别的声明形式，或不对该文件声明符号级规则`,
        });
      }
    };

    let fileFrozen = [];
    if (Array.isArray(rules?.frozenSymbols)) {
      fileFrozen = rules.frozenSymbols;
    } else {
      const scopedFrozen = lookupFileRule(rules?.frozenSymbols, filePath);
      if (Array.isArray(scopedFrozen)) fileFrozen = scopedFrozen;
    }

    // 规则 1: 符号修改白名单限制 (allowedSymbols)
    const allowed = lookupFileRule(rules?.allowedSymbols, filePath);
    if (Array.isArray(allowed) && allowed.length > 0) {
      const allowedSet = new Set(allowed);
      const mutatedSymbols = [
        ...diff.signatureChanged,
        ...diff.bodyChanged,
        ...diff.removed,
        ...diff.added,
        ...diff.declarationCountChanged,
      ];
      for (const s of mutatedSymbols) {
        if (!allowedSet.has(s.name)) {
          violations.push({
            code: 'UNAUTHORIZED_SYMBOL_MUTATION',
            filePath,
            symbol: s.name,
            message: `未授权修改符号 ${s.name}。文件 ${filePath} 仅授权修改: ${allowed.join('、')}`,
          });
        }
      }
      for (const s of diff.declarationCountChanged) {
        if (allowedSet.has(s.name)) {
          violations.push({
            code: 'SYMBOL_DECLARATION_COUNT_CHANGED',
            filePath,
            symbol: s.name,
            message: `符号 ${s.name} 的同名声明数量从 ${s.baseCount} 变为 ${s.targetCount}（文件 ${filePath}），不能按授权修改处理`,
          });
        }
      }

      flagUnresolved(allowed);
    }

    // 授权/冻结符号之外必须保持原样；新增文件只允许 import / export … from 作为脚手架
    const hasSymbolScope =
      (Array.isArray(allowed) && allowed.length > 0) || fileFrozen.length > 0;
    if (hasSymbolScope) {
      const hasBase = baseSource.trim().length > 0;
      const baseRemainder = remainderOf(baseSource, baseSymbols);
      const targetRemainder = remainderOf(targetSource, targetSymbols);
      const regionChanged = hasBase
        ? baseRemainder !== targetRemainder
        : scaffoldViolations(targetRemainder, ext).length > 0;
      if (regionChanged) {
        violations.push({
          code: 'UNAUTHORIZED_REGION_CHANGE',
          filePath,
          message: `文件 ${filePath} 的授权符号之外有改动（顶层语句 / 导入 / 未识别的声明）`,
        });
      }
    }

    // 规则 2: 冻结符号绝对保护 (frozenSymbols)
    if (Array.isArray(fileFrozen) && fileFrozen.length > 0) {
      flagUnresolved(fileFrozen);
      const frozenSet = new Set(fileFrozen);
      const mutatedSymbols = [
        ...diff.signatureChanged,
        ...diff.bodyChanged,
        ...diff.removed,
      ];
      for (const s of mutatedSymbols) {
        if (frozenSet.has(s.name)) {
          violations.push({
            code: 'FROZEN_SYMBOL_BREACH',
            filePath,
            symbol: s.name,
            message: `违反冻结保护：符号 ${s.name} 已被标记冻结，禁止任何修改或删除（在文件 ${filePath} 中）`,
          });
        }
      }
      for (const s of diff.declarationCountChanged) {
        if (frozenSet.has(s.name)) {
          violations.push({
            code: 'FROZEN_SYMBOL_BREACH',
            filePath,
            symbol: s.name,
            message: `违反冻结保护：符号 ${s.name} 的同名声明集合发生变化（${s.baseCount} → ${s.targetCount}），冻结符号禁止增删或修改（在文件 ${filePath} 中）`,
          });
        }
      }
    }

    // 规则 3: 公共接口与导出冻结 (freezeExports)
    const isExportFrozen = Boolean(
      rules?.freezeExports || lookupFileRule(rules?.fileFreezeExports, filePath)
    );
    if (isExportFrozen) {
      for (const s of diff.signatureChanged) {
        if (s.isExported) {
          violations.push({
            code: 'EXPORT_CONTRACT_BREACH',
            filePath,
            symbol: s.name,
            message: `违反公共接口冻结契约：导出符号 ${s.name} 签名变动（在文件 ${filePath} 中）`,
          });
        }
      }
      for (const s of diff.removed) {
        if (s.isExported) {
          violations.push({
            code: 'EXPORT_CONTRACT_BREACH',
            filePath,
            symbol: s.name,
            message: `违反公共接口冻结契约：导出符号 ${s.name} 被删除（在文件 ${filePath} 中）`,
          });
        }
      }
      for (const s of diff.declarationCountChanged) {
        if (s.isExported) {
          violations.push({
            code: 'EXPORT_CONTRACT_BREACH',
            filePath,
            symbol: s.name,
            message: `违反公共接口冻结契约：导出符号 ${s.name} 的声明集合发生变化（在文件 ${filePath} 中）`,
          });
        }
      }

      // 导出面比对：剩余文本里新增或消失的导出语句行（未经符号识别）
      const baseExports = exportSurfaceLines(remainderOf(baseSource, baseSymbols), ext);
      const targetExports = exportSurfaceLines(remainderOf(targetSource, targetSymbols), ext);
      const baseCounts = countLines(baseExports);
      const targetCounts = countLines(targetExports);
      const seen = new Set();
      for (const line of [...targetExports, ...baseExports]) {
        if (seen.has(line)) continue;
        seen.add(line);
        if ((baseCounts.get(line) || 0) === (targetCounts.get(line) || 0)) continue;
        violations.push({
          code: 'EXPORT_SURFACE_CHANGE',
          filePath,
          message: `导出面出现未经符号识别的变化：${line.slice(0, 80)}`,
        });
      }
    }

    // 规则 4: 禁止未授权新增导出 (allowNewExports: false)
    if (rules?.allowNewExports === false) {
      for (const s of diff.added) {
        if (s.isExported) {
          violations.push({
            code: 'UNAUTHORIZED_NEW_EXPORT',
            filePath,
            symbol: s.name,
            message: `未授权新增公共导出：符号 ${s.name}（在文件 ${filePath} 中）`,
          });
        }
      }
      for (const s of diff.declarationCountChanged) {
        if (s.targetCount > s.baseCount && s.isExported) {
          violations.push({
            code: 'UNAUTHORIZED_NEW_EXPORT',
            filePath,
            symbol: s.name,
            message: `未授权新增公共导出：符号 ${s.name} 的同名声明数量增加（在文件 ${filePath} 中）`,
          });
        }
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    diffs,
  };
}
