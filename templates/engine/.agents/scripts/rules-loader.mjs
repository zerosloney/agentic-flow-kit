// rules-loader.mjs — 统一规则感知与装配辅助器（运行时与脚本专用，零外部依赖）。
// 供 verify.mjs, verify-scope.mjs, faces.mjs, check-local-gate-config.mjs 共享：
// 识别项目根目录下的声明式规则中心（flow-rules.yml / .agents/rules.yml 等），
// 提供轻量 YAML/JSON 解析，提取产品面配置、技术栈标识与阶段命令门禁。

import fs from 'node:fs';
import path from 'node:path';

export const PROJECT_RULE_FILES = [
  'flow-rules.yml',
  'flow-rules.yaml',
  '.agents/rules.yml',
  '.agents/rules.yaml',
  '.agents/rules/project.json',
  '.agents/rules/project.yml',
  '.agents/rules/project.yaml',
];

/** 寻找项目规则文件相对路径（若无返回 null） */
export function findProjectRulesFile(root) {
  for (const rel of PROJECT_RULE_FILES) {
    if (fs.existsSync(path.join(root, rel))) return rel;
  }
  return null;
}

// ── 轻量 YAML/JSON 解析（零外部依赖） ─────────────────────────────────────

function stripComment(raw) {
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
        if (raw[i + 1] === "'") i += 1;
        else inSingle = false;
      }
      continue;
    }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '#') {
      if (i === 0 || /\s/.test(raw[i - 1])) return raw.slice(0, i).trimEnd();
    }
  }
  return raw.trimEnd();
}

function getIndent(raw) {
  let indent = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === ' ') indent += 1;
    else if (raw[i] === '\t') indent += 2;
    else break;
  }
  return indent;
}

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
      if (i === str.length - 1 || /\s/.test(str[i + 1])) return i;
    }
  }
  return -1;
}

function parseFlowSeq(text) {
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
      items.push(parseScalar(current.trim()));
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(parseScalar(current.trim()));
  return items;
}

function parseScalar(val) {
  if (val === '' || val === undefined) return null;
  const s = val.trim();
  if (s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE' || s === 'yes' || s === 'Yes' || s === 'on') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE' || s === 'no' || s === 'No' || s === 'off') return false;
  if (s.startsWith('[') && s.endsWith(']')) return parseFlowSeq(s);
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1).replace(/\\"/g, '"'); }
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'");
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s)) {
    const num = Number(s);
    if (!Number.isNaN(num)) return num;
  }
  return s;
}

class FastYamlReader {
  constructor(text) {
    const rawLines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    this.lines = [];
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      const stripped = stripComment(raw);
      const trimmed = stripped.trim();
      if (!trimmed) continue;
      this.lines.push({ indent: getIndent(raw), raw, text: trimmed, lineNum: i + 1 });
    }
    this.pos = 0;
  }
  peek() { return this.lines[this.pos] || null; }
  next() { return this.lines[this.pos++] || null; }
}

function parseBlock(reader, expectedIndent) {
  const first = reader.peek();
  if (!first) return null;
  const actualIndent = first.indent;
  if (expectedIndent !== undefined && actualIndent < expectedIndent) return null;

  if (first.text.startsWith('- ') || first.text === '-') {
    const list = [];
    while (reader.peek()) {
      const cur = reader.peek();
      if (cur.indent < actualIndent) break;
      if (cur.indent > actualIndent) {
        throw new Error(`第 ${cur.lineNum} 行列表缩进不一致`);
      }
      if (!cur.text.startsWith('- ') && cur.text !== '-') break;
      reader.next();
      const rest = cur.text.slice(1).trim();
      if (!rest) {
        const child = parseBlock(reader, actualIndent + 1);
        list.push(child);
      } else {
        const colonIdx = findColon(rest);
        if (colonIdx > 0) {
          const k = parseScalar(rest.slice(0, colonIdx).trim());
          const vStr = rest.slice(colonIdx + 1).trim();
          const itemObj = {};
          if (vStr) {
            itemObj[String(k)] = parseScalar(vStr);
          } else {
            const nested = parseBlock(reader, cur.indent + 2);
            itemObj[String(k)] = nested;
          }
          while (reader.peek() && reader.peek().indent > actualIndent && !reader.peek().text.startsWith('-')) {
            const sibling = reader.peek();
            const sColon = findColon(sibling.text);
            if (sColon > 0) {
              reader.next();
              const sk = parseScalar(sibling.text.slice(0, sColon).trim());
              const sv = sibling.text.slice(sColon + 1).trim();
              if (sv) itemObj[String(sk)] = parseScalar(sv);
              else itemObj[String(sk)] = parseBlock(reader, sibling.indent + 1);
            } else break;
          }
          list.push(itemObj);
        } else {
          list.push(parseScalar(rest));
        }
      }
    }
    return list;
  }

  const obj = {};
  while (reader.peek()) {
    const cur = reader.peek();
    if (cur.indent < actualIndent) break;
    if (cur.indent > actualIndent) {
      throw new Error(`第 ${cur.lineNum} 行缩进错误`);
    }
    const colonIdx = findColon(cur.text);
    if (colonIdx <= 0) break;
    reader.next();
    const key = parseScalar(cur.text.slice(0, colonIdx).trim());
    const valStr = cur.text.slice(colonIdx + 1).trim();
    if (valStr === '|' || valStr === '>') {
      const blockLines = [];
      let bIndent = -1;
      while (reader.peek()) {
        const nextL = reader.peek();
        if (nextL.indent <= cur.indent) break;
        if (bIndent < 0) bIndent = nextL.indent;
        reader.next();
        blockLines.push(nextL.raw.slice(bIndent));
      }
      obj[String(key)] = valStr === '|' ? blockLines.join('\n') : blockLines.join(' ');
    } else if (valStr) {
      obj[String(key)] = parseScalar(valStr);
    } else {
      const child = parseBlock(reader, cur.indent + 1);
      obj[String(key)] = child;
    }
  }
  return obj;
}

export function parseYamlSimple(text) {
  const reader = new FastYamlReader(text);
  if (!reader.peek()) return {};
  if (reader.peek().indent > 0) throw new Error('顶层元素缩进错误');
  return parseBlock(reader, 0) || {};
}

// ── 规则加载与归一化 ────────────────────────────────────────────────────────

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

/** 寻找本地已安装的栈规则文件（.agents/rules/stack.<stack>.(json|ya?ml)） */
export function findStackRulesFiles(root) {
  const dir = path.join(root, '.agents', 'rules');
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => /^stack\.[A-Za-z0-9_-]+\.(json|ya?ml)$/i.test(f))
      .sort()
      .map((f) => `.agents/rules/${f}`);
  } catch {
    return [];
  }
}

function parseRulesFileData(abs) {
  const text = fs.readFileSync(abs, 'utf8');
  if (abs.endsWith('.json')) {
    return JSON.parse(text);
  }
  return parseYamlSimple(text);
}

/** 加载项目规则（级联项目层与栈规则层），返回解析后的对象；无规则文件返回 null；解析失败抛错 */
export function loadProjectRules(root) {
  const rel = findProjectRulesFile(root);
  const stackRels = findStackRulesFiles(root);
  if (!rel && !stackRels.length) return null;

  let projectData = null;
  if (rel) {
    const abs = path.join(root, rel);
    projectData = parseRulesFileData(abs);
    if (projectData && typeof projectData === 'object') {
      projectData._file = rel;
    }
  }

  // 装载栈规则层
  const stackRules = [];
  for (const sRel of stackRels) {
    const abs = path.join(root, sRel);
    try {
      const data = parseRulesFileData(abs);
      if (data && Array.isArray(data.rules)) {
        stackRules.push(...data.rules);
      }
    } catch {
      // 容错异常的栈规则文件
    }
  }

  if (!projectData) {
    return {
      version: 1,
      _file: stackRels[0],
      rules: stackRules,
      waivers: [],
    };
  }

  // 若既有栈层又有项目层：按 rule.id 合并（项目层同 id 覆盖栈层，无 id 规则追加）
  const mergedRulesMap = new Map();
  const unkeyedRules = [];
  for (const r of stackRules) {
    if (r && r.id) mergedRulesMap.set(r.id, r);
    else if (r) unkeyedRules.push(r);
  }
  if (Array.isArray(projectData.rules)) {
    for (const r of projectData.rules) {
      if (r && r.id) mergedRulesMap.set(r.id, r);
      else if (r) unkeyedRules.push(r);
    }
  }

  return {
    ...projectData,
    rules: [...mergedRulesMap.values(), ...unkeyedRules],
  };
}

/**
 * 提取 verify 阶段的命令门（用于 verify 编排器运行）
 * 扫描 phase === 'verify' 且断言为 command 的规则，
 * 转化为 verify.mjs 中的 gate 规范：{ id, cohort, name, cmd, folder, type, deps, env, when, timeoutMs }
 */
export function extractVerifyCommandGates(projectRules, root) {
  if (!projectRules || !Array.isArray(projectRules.rules)) return [];
  const gates = [];
  const seenIds = new Set();

  for (const rule of projectRules.rules) {
    if (!rule || typeof rule !== 'object') continue;
    if (rule.enabled === false) continue;

    const phase = rule.phase || 'verify';
    if (phase !== 'verify' && phase !== 'always') continue;

    // 断言判断：支持 assert: { kind: 'command', args } 与简写 check: { primitive: 'command', run }
    const assertKind = rule.assert?.kind || rule.check?.primitive || (rule.command || rule.run ? 'command' : null);
    if (assertKind !== 'command') continue;

    const rawId = String(rule.id || '').trim();
    if (!rawId) continue;

    // 门 id 映射：如果是 product.<name>，短 id 映射为 <name>；否则取 rawId
    const gateId = rawId.startsWith('product.') ? rawId.slice(8) : rawId;
    if (seenIds.has(gateId)) continue;
    seenIds.add(gateId);

    const name = rule.name
      || (rule.message && typeof rule.message === 'object' ? (rule.message.zh || rule.message.en) : rule.message)
      || gateId;

    const runCmd = rule.assert?.args?.run || rule.check?.run || rule.command || rule.run;
    const folder = rule.assert?.args?.cwd || rule.check?.cwd || rule.folder || '.';
    const env = rule.assert?.args?.env || rule.check?.env || rule.env || undefined;
    const deps = rule.assert?.args?.deps || rule.check?.deps || rule.deps || undefined;
    const when = rule.when !== undefined ? rule.when : (rule.check?.when !== undefined ? rule.check.when : undefined);
    const timeoutMs = rule.timeoutMs !== undefined ? rule.timeoutMs : (rule.check?.timeoutMs !== undefined ? rule.check.timeoutMs : undefined);

    // 契约：产品门委托 rules 引擎执行
    const fullRuleId = rawId.startsWith('product.') ? rawId : `product.${slug(gateId)}`;
    const execCmd = `flow-kit rules check --with-commands --prefix ${fullRuleId}`;

    gates.push({
      id: gateId,
      cohort: 'product',
      name: String(name),
      cmd: execCmd,
      rawCmd: runCmd,
      folder: typeof folder === 'string' && folder.trim() ? folder : '.',
      type: 'shell',
      when,
      timeoutMs: timeoutMs ?? null,
      ...(Array.isArray(deps) && deps.length ? { deps: deps.map((d) => (d.startsWith('product.') ? d.slice(8) : d)) } : {}),
      ...(env && typeof env === 'object' && !Array.isArray(env) ? { env: { ...env } } : {}),
    });
  }

  return gates;
}

/** 从规则配置中探测技术栈（如 dotnet, node, rust 等） */
export function detectStackFromRules(root) {
  const pr = loadProjectRules(root);
  const stacks = new Set();
  if (pr) {
    if (typeof pr.stack === 'string') stacks.add(pr.stack);
    if (Array.isArray(pr.stacks)) pr.stacks.forEach((s) => stacks.add(s));
    if (Array.isArray(pr.extends)) {
      for (const item of pr.extends) {
        const m = String(item).match(/(?:preset:)?(?:stack\/)?([A-Za-z0-9_-]+)/);
        if (m && m[1]) stacks.add(m[1]);
      }
    }
  }
  // 从存在的栈规则文件名推导（如 .agents/rules/stack.dotnet.json -> dotnet）
  for (const sRel of findStackRulesFiles(root)) {
    const m = path.basename(sRel).match(/^stack\.([A-Za-z0-9_-]+)\.(json|ya?ml)$/i);
    if (m && m[1]) stacks.add(m[1]);
  }
  return [...stacks];
}
