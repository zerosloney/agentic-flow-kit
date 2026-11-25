// glob — 规则包用的最小 glob（** / * / ?），零依赖。
// **/ 匹配零或多级目录；* 与 ? 不跨 /。与模板脚本里的 globToRegExp 同形语义。
const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

export function globToRegExp(glob) {
  const g = String(glob || '').replace(/\\/g, '/');
  let re = '^';
  for (let i = 0; i < g.length; i += 1) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      re += '[^/]';
      continue;
    }
    re += escapeRe(ch);
  }
  return new RegExp(`${re}$`);
}

export const hasGlobMeta = (p) => /[*?]/.test(String(p || ''));

export const staticPrefix = (glob) => {
  const g = String(glob || '').replace(/\\/g, '/');
  const i = g.search(/[*?]/);
  if (i < 0) return g;
  const slash = g.lastIndexOf('/', i);
  return slash < 0 ? '' : g.slice(0, slash + 1);
};
