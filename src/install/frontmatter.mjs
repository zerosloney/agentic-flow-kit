// 无依赖 frontmatter 读写：只处理单行 key: value，够用于宿主 agent / skill 头部。
// 不引入 YAML 解析器；description 等含空格/冒号的值在写入时用 JSON 双引号转义（YAML 合法）。

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function eolOf(text) {
  return String(text).includes('\r\n') ? '\r\n' : '\n';
}

function unquote(value) {
  const v = String(value).trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

export function splitFrontmatter(text) {
  const s = String(text ?? '');
  const m = FRONTMATTER_RE.exec(s);
  if (!m) return { has: false, frontmatter: '', body: s, eol: eolOf(s) };
  const eol = eolOf(s);
  return { has: true, frontmatter: m[1], body: s.slice(m[0].length), eol };
}

export function parseFrontmatter(text) {
  const { frontmatter } = splitFrontmatter(text);
  const out = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(':');
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    if (!key) continue;
    out[key] = unquote(t.slice(i + 1).trim());
  }
  return out;
}

export function getField(text, key) {
  return parseFrontmatter(text)[key];
}

// 写/替换/删除单行字段；无 frontmatter 时在文首新建。value 为 null/undefined 表示删除。
export function setField(text, key, value) {
  const s = String(text ?? '');
  const { has, frontmatter, body, eol } = splitFrontmatter(s);
  const lines = has ? frontmatter.split(/\r?\n/) : [];
  const idx = lines.findIndex((line) => new RegExp(`^\\s*${escapeRe(key)}\\s*:`).test(line));

  if (value == null) {
    if (!has || idx < 0) return s;
    lines.splice(idx, 1);
  } else {
    const line = `${key}: ${yamlScalar(value)}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }

  if (!has) return `---${eol}${lines.join(eol)}${eol}---${eol}${eol}${s}`;
  return `---${eol}${lines.join(eol)}${eol}---${eol}${body}`;
}

export function yamlScalar(value) {
  const s = String(value);
  if (s === '') return '""';
  // 安全裸值：字母数字 + 常见模型 ID 标点；排除 YAML 布尔/空值/数字
  if (/^[A-Za-z0-9_./:@+~=-]+$/.test(s)
    && !/^(true|false|null|yes|no|on|off|~)$/i.test(s)
    && !/^-?\d+(\.\d+)?$/.test(s)) {
    return s.includes('#') ? JSON.stringify(s) : s;
  }
  return JSON.stringify(s);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
