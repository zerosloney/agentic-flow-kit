// yaml — 零依赖 YAML 解析器与生成器（针对工作流与规则模型优化）
// 规则包由开发者或 AI 频繁编辑与维护；提供对字典、列表、标量、多行块、注释及行内结构的原生支持。
import { RulesConfigError } from './model.mjs';

function failYaml(rel, lineNum, msg) {
  const loc = rel ? `${rel} (line ${lineNum})` : `line ${lineNum}`;
  throw new RulesConfigError(`${loc}: ${msg}`);
}

/** 剥离行尾注释，保留引号内的 # 字符 */
export function stripYamlComment(raw) {
  let inDouble = false;
  let inSingle = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inDouble) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (raw[i + 1] === "'") i += 1; // 单引号转义 ''
        else inSingle = false;
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '#') {
      // 必须是独立注释（前面是空格或位于行首）
      if (i === 0 || /\s/.test(raw[i - 1])) {
        return raw.slice(0, i).trimEnd();
      }
    }
  }
  return raw.trimEnd();
}

/** 计算缩进（空格数，制表符展开为 2 空格） */
function getIndent(raw) {
  let indent = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === ' ') indent += 1;
    else if (raw[i] === '\t') indent += 2;
    else break;
  }
  return indent;
}

/** 解析 flow sequence: [a, "b, c", 123] */
function parseFlowSequence(text, rel, lineNum) {
  const content = text.slice(1, -1).trim();
  if (!content) return [];
  const items = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;
  let escape = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inDouble) {
      current += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (content[i + 1] === "'") { current += "'"; i += 1; }
        else inSingle = false;
      }
      continue;
    }
    if (ch === '"') { inDouble = true; current += ch; continue; }
    if (ch === "'") { inSingle = true; current += ch; continue; }
    if (ch === ',') {
      items.push(parseYamlScalar(current.trim(), rel, lineNum));
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(parseYamlScalar(current.trim(), rel, lineNum));
  return items;
}

/** 解析 flow mapping: { a: 1, b: "foo" } */
function parseFlowMapping(text, rel, lineNum) {
  const content = text.slice(1, -1).trim();
  if (!content) return {};
  const obj = {};
  let current = '';
  let inDouble = false;
  let inSingle = false;
  let escape = false;
  const pairs = [];
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inDouble) {
      current += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (content[i + 1] === "'") { current += "'"; i += 1; }
        else inSingle = false;
      }
      continue;
    }
    if (ch === '"') { inDouble = true; current += ch; continue; }
    if (ch === "'") { inSingle = true; current += ch; continue; }
    if (ch === ',') {
      pairs.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) pairs.push(current.trim());

  for (const pair of pairs) {
    const colonIdx = findColon(pair);
    if (colonIdx < 0) failYaml(rel, lineNum, `flow mapping 语法错误: ${pair}`);
    const k = parseYamlScalar(pair.slice(0, colonIdx).trim(), rel, lineNum);
    const v = parseYamlScalar(pair.slice(colonIdx + 1).trim(), rel, lineNum);
    const key = String(k);
    if (Object.prototype.hasOwnProperty.call(obj, key)) failYaml(rel, lineNum, `重复键「${key}」`);
    obj[key] = v;
  }
  return obj;
}

/** 寻找键值冒号（不在引号内，且后随空格或处于行尾） */
function findColon(str) {
  let inDouble = false;
  let inSingle = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inDouble) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (str[i + 1] === "'") i += 1;
        else inSingle = false;
      }
      continue;
    }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === ':') {
      if (i === str.length - 1 || /\s/.test(str[i + 1])) {
        return i;
      }
    }
  }
  return -1;
}

/** 解析 YAML 标量值 */
export function parseYamlScalar(val, rel = '', lineNum = 0) {
  if (val === '' || val === undefined) return null;
  const s = val.trim();
  if (s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE' || s === 'yes' || s === 'Yes' || s === 'YES' || s === 'on' || s === 'On') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE' || s === 'no' || s === 'No' || s === 'NO' || s === 'off' || s === 'Off') return false;

  // flow sequence & flow mapping
  if (s.startsWith('[') && s.endsWith(']')) {
    return parseFlowSequence(s, rel, lineNum);
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    return parseFlowMapping(s, rel, lineNum);
  }

  // 双引号字符串
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try {
      return JSON.parse(s);
    } catch {
      // 容错处理
      return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }

  // 单引号字符串
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }

  // 数字判断
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s)) {
    const num = Number(s);
    if (!Number.isNaN(num)) return num;
  }

  return s;
}

class YamlLineReader {
  constructor(text, rel) {
    this.rel = rel;
    const rawLines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    this.rawLines = rawLines;
    this.lines = [];
    for (let i = 0; i < rawLines.length; i++) {
      const lineNum = i + 1;
      const raw = rawLines[i];
      const stripped = stripYamlComment(raw);
      const indent = getIndent(raw);
      const trimmed = stripped.trim();
      if (!trimmed) continue; // 跳过空行或纯注释行
      this.lines.push({ lineNum, indent, raw, text: trimmed });
    }
    this.pos = 0;
  }

  peek() {
    return this.lines[this.pos] || null;
  }

  next() {
    return this.lines[this.pos++] || null;
  }
}

/** 收集多行字面块（| 或 >）：按原始行收集，保留空行与 # 行 */
function collectBlockScalar(reader, keyLineNum, baseIndent, kind) {
  const rawLines = reader.rawLines;
  const content = [];
  let blockIndent = -1;
  let end = keyLineNum; // 已收集原始行的下一个下标（0 基）
  for (let i = keyLineNum; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const blank = raw.trim() === '';
    if (!blank && !raw.trimStart().startsWith('#') && getIndent(raw) <= baseIndent) break;
    end = i + 1;
    if (blank) {
      content.push('');
      continue;
    }
    const indent = getIndent(raw);
    if (blockIndent < 0) blockIndent = indent;
    content.push(raw.slice(Math.min(indent, blockIndent)));
  }
  // clip：块内容以最后一个非空行结束
  while (content.length > 0 && content[content.length - 1] === '') content.pop();
  // 读取器停在块后的第一条逻辑行
  while (reader.peek() && reader.peek().lineNum - 1 < end) reader.next();
  if (kind === '|') {
    return content.join('\n');
  }
  // '>' 折叠块标量：连续非空行折成空格，空行折成换行
  let folded = '';
  let pendingBreaks = 0;
  let started = false;
  for (const line of content) {
    if (line === '') {
      pendingBreaks += 1;
      continue;
    }
    if (started) folded += pendingBreaks > 0 ? '\n'.repeat(pendingBreaks) : ' ';
    else folded += '\n'.repeat(pendingBreaks);
    folded += line;
    started = true;
    pendingBreaks = 0;
  }
  return folded;
}

/** 解析 YAML 节点（递归块） */
function parseNode(reader, minIndent) {
  const current = reader.peek();
  if (!current || current.indent < minIndent) return null;

  // 判断是否为列表项（以 '- ' 或 '-' 开头）
  if (current.text.startsWith('- ') || current.text === '-') {
    return parseList(reader, current.indent);
  }

  // 否则尝试解析为 Mapping
  const colonIdx = findColon(current.text);
  if (colonIdx > 0) {
    return parseMapping(reader, current.indent);
  }

  // 标量行
  reader.next();
  return parseYamlScalar(current.text, reader.rel, current.lineNum);
}

/** 解析列表；allowSameIndentSibling 用于与父键同缩进的不缩进序列 */
function parseList(reader, listIndent, allowSameIndentSibling = false) {
  const list = [];
  while (reader.peek()) {
    const line = reader.peek();
    if (line.indent < listIndent) break;
    if (line.indent > listIndent) {
      failYaml(reader.rel, line.lineNum, `意外的缩进: ${line.text}`);
    }
    if (!line.text.startsWith('- ') && line.text !== '-') {
      if (allowSameIndentSibling) break;
      failYaml(reader.rel, line.lineNum, `列表项格式错误，必须以 '-' 开头: ${line.text}`);
    }

    reader.next();
    const itemContent = line.text === '-' ? '' : line.text.slice(2).trim();

    if (!itemContent) {
      // 换行后的子内容
      const child = parseNode(reader, listIndent + 1);
      list.push(child);
      continue;
    }

    // 检查 itemContent 是否包含键值对，形如 `- id: rule-1`
    const colonIdx = findColon(itemContent);
    if (colonIdx > 0) {
      const key = itemContent.slice(0, colonIdx).trim();
      const valStr = itemContent.slice(colonIdx + 1).trim();

      const itemObj = {};
      const childIndent = line.indent + 2;
      const itemKey = String(key);
      if (Object.prototype.hasOwnProperty.call(itemObj, itemKey)) {
        failYaml(reader.rel, line.lineNum, `重复键「${itemKey}」`);
      }

      if (valStr === '|' || valStr === '>') {
        itemObj[itemKey] = collectBlockScalar(reader, line.lineNum, childIndent, valStr);
      } else if (valStr !== '') {
        itemObj[itemKey] = parseYamlScalar(valStr, reader.rel, line.lineNum);
      } else {
        // 紧接着更深缩进的子项；与键同缩进的序列视作该键的列表
        const next = reader.peek();
        if (next && next.indent > line.indent) {
          if (next.indent === childIndent && (next.text.startsWith('- ') || next.text === '-')) {
            itemObj[itemKey] = parseList(reader, next.indent, true);
          } else {
            itemObj[itemKey] = parseNode(reader, next.indent);
          }
        } else {
          itemObj[itemKey] = null;
        }
      }

      // 继续收集属于该对象的同级后续属性（缩进等于 childIndent 或与此列表项同级的属性）
      while (reader.peek()) {
        const next = reader.peek();
        if (next.indent < childIndent) break;
        if (next.indent === childIndent && (next.text.startsWith('- ') || next.text === '-')) break;

        const nextColon = findColon(next.text);
        if (nextColon < 0) {
          failYaml(reader.rel, next.lineNum, `对象属性格式错误，缺少冒号分隔符: ${next.text}`);
        }
        reader.next();

        const propKey = next.text.slice(0, nextColon).trim();
        const propValStr = next.text.slice(nextColon + 1).trim();
        if (Object.prototype.hasOwnProperty.call(itemObj, propKey)) {
          failYaml(reader.rel, next.lineNum, `重复键「${propKey}」`);
        }

        if (propValStr === '|' || propValStr === '>') {
          itemObj[propKey] = collectBlockScalar(reader, next.lineNum, next.indent, propValStr);
        } else if (propValStr !== '') {
          itemObj[propKey] = parseYamlScalar(propValStr, reader.rel, next.lineNum);
        } else {
          const sub = reader.peek();
          if (sub && sub.indent === next.indent && (sub.text.startsWith('- ') || sub.text === '-')) {
            itemObj[propKey] = parseList(reader, sub.indent, true);
          } else if (sub && sub.indent > next.indent) {
            itemObj[propKey] = parseNode(reader, sub.indent);
          } else {
            itemObj[propKey] = null;
          }
        }
      }

      list.push(itemObj);
    } else {
      // 普通标量列表项
      list.push(parseYamlScalar(itemContent, reader.rel, line.lineNum));
    }
  }
  return list;
}

/** 解析键值映射（Mapping） */
function parseMapping(reader, mappingIndent) {
  const map = {};
  while (reader.peek()) {
    const line = reader.peek();
    if (line.indent < mappingIndent) break;
    if (line.indent > mappingIndent) {
      failYaml(reader.rel, line.lineNum, `格式错误，缩进不匹配: ${line.text}`);
    }

    const colonIdx = findColon(line.text);
    if (colonIdx < 0) {
      failYaml(reader.rel, line.lineNum, `键值对格式错误，缺少冒号分隔符: ${line.text}`);
    }

    reader.next();
    const key = parseYamlScalar(line.text.slice(0, colonIdx).trim(), reader.rel, line.lineNum);
    const keyStr = String(key);
    if (Object.prototype.hasOwnProperty.call(map, keyStr)) {
      failYaml(reader.rel, line.lineNum, `重复键「${keyStr}」`);
    }
    const valStr = line.text.slice(colonIdx + 1).trim();

    if (valStr === '|' || valStr === '>') {
      map[keyStr] = collectBlockScalar(reader, line.lineNum, line.indent, valStr);
    } else if (valStr !== '') {
      map[keyStr] = parseYamlScalar(valStr, reader.rel, line.lineNum);
    } else {
      // 值的缩进在下一行；与键同缩进的序列项视作该键的列表
      const next = reader.peek();
      if (next && next.indent === line.indent && (next.text.startsWith('- ') || next.text === '-')) {
        map[keyStr] = parseList(reader, line.indent, true);
      } else if (next && next.indent > line.indent) {
        map[keyStr] = parseNode(reader, next.indent);
      } else {
        map[keyStr] = null;
      }
    }
  }
  return map;
}

/** 解析 YAML 文本 */
export function parseYaml(text, rel = '') {
  const reader = new YamlLineReader(text, rel);
  const first = reader.peek();
  if (!first) return {};
  if (first.indent > 0) {
    failYaml(rel, first.lineNum, '顶层元素缩进错误（顶层不得包含前置空格）');
  }
  const res = parseNode(reader, 0);
  if (reader.peek()) {
    const remaining = reader.peek();
    failYaml(rel, remaining.lineNum, `无法解析的未识别内容或语法错误: ${remaining.text}`);
  }
  return res ?? {};
}

/** 安全格式化 YAML 标量值 */
function formatScalar(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);

  const s = String(val);
  if (s === '') return "''";

  // 判断是否需要双引号：
  // 包含特殊符号，或以特定字符开头，或与 true/false/null/数字冲突
  const needsQuotes = /[:#\[\]{},*&?!|>'"%@`\\]/.test(s)
    || /[\n\r\t]/.test(s)
    || /^\s|\s$/.test(s)
    || /^(true|false|null|~|yes|no|on|off)$/i.test(s)
    || /^-?\d+(\.\d+)?$/.test(s);

  if (needsQuotes) {
    return JSON.stringify(s);
  }
  return s;
}

/** 序列化 JS 值为规范 YAML */
export function stringifyYaml(data, indentLevel = 0) {
  const indent = '  '.repeat(indentLevel);

  if (data === null || data === undefined) return `${indent}null\n`;
  if (typeof data !== 'object') return `${indent}${formatScalar(data)}\n`;

  if (Array.isArray(data)) {
    if (data.length === 0) return `${indent}[]\n`;
    let out = '';
    for (const item of data) {
      if (item === null || typeof item !== 'object') {
        out += `${indent}- ${formatScalar(item)}\n`;
      } else if (Array.isArray(item)) {
        out += `${indent}-\n${stringifyYaml(item, indentLevel + 1)}`;
      } else {
        // 对象数组项：第一项拼接在 - 后面
        const keys = Object.keys(item);
        if (keys.length === 0) {
          out += `${indent}- {}\n`;
          continue;
        }
        const firstKey = keys[0];
        const firstVal = item[firstKey];
        if (firstVal !== null && typeof firstVal === 'object') {
          out += `${indent}- ${firstKey}:\n${stringifyYaml(firstVal, indentLevel + 2)}`;
        } else {
          out += `${indent}- ${firstKey}: ${formatScalar(firstVal)}\n`;
        }
        for (let i = 1; i < keys.length; i++) {
          const k = keys[i];
          const v = item[k];
          if (v !== null && typeof v === 'object') {
            out += `${indent}  ${k}:\n${stringifyYaml(v, indentLevel + 2)}`;
          } else {
            out += `${indent}  ${k}: ${formatScalar(v)}\n`;
          }
        }
      }
    }
    return out;
  }

  // 对象映射
  const keys = Object.keys(data);
  if (keys.length === 0) return `${indent}{}\n`;
  let out = '';
  for (const k of keys) {
    const v = data[k];
    if (k === '_note' && typeof v === 'string') {
      out += `${indent}# ${v}\n`;
      continue;
    }
    if (v === null || v === undefined) {
      out += `${indent}${k}: null\n`;
    } else if (typeof v !== 'object') {
      out += `${indent}${k}: ${formatScalar(v)}\n`;
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        out += `${indent}${k}: []\n`;
      } else {
        out += `${indent}${k}:\n${stringifyYaml(v, indentLevel + 1)}`;
      }
    } else {
      if (Object.keys(v).length === 0) {
        out += `${indent}${k}: {}\n`;
      } else {
        out += `${indent}${k}:\n${stringifyYaml(v, indentLevel + 1)}`;
      }
    }
  }
  return out;
}
