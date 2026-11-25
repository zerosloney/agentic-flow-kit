// jsonc — 零依赖 JSONC：剥离 // 与 /* */ 注释、容忍尾逗号（字符串内的内容原样保留）。
// 规则包长期被手改，注释价值高于「严格 JSON」的形式洁癖；解析失败仍 fail-closed。
export function stripJsonc(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  let out = '';
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (src[j] === '}' || src[j] === ']') {
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function parseJsonc(text, file = '') {
  try {
    return JSON.parse(stripJsonc(text));
  } catch (e) {
    const err = new Error(`${file ? `${file}: ` : ''}JSONC 解析失败：${e.message}`);
    err.code = 'BAD_JSONC';
    throw err;
  }
}
