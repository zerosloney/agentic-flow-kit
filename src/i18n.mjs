import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '..');
const LOCALES = path.join(KIT, 'locales');
const FALLBACK = 'zh-CN';

const cache = new Map();
export function loadCatalog(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const file = path.join(LOCALES, lang, 'installer.json');
  let cat = {};
  try {
    cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    if (lang !== FALLBACK) return loadCatalog(FALLBACK);
    throw new Error(`missing installer locale: ${file}`);
  }
  cache.set(lang, cat);
  return cat;
}

export function makeT(lang) {
  const cat = loadCatalog(lang);
  const fallback = lang === FALLBACK ? cat : loadCatalog(FALLBACK);
  return (key, vars = {}) => {
    const raw = cat[key] ?? fallback[key] ?? key;
    return String(raw).replace(/\{\{(\w+)\}\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  };
}
