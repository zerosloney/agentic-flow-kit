// wiki 协议名（随安装语言而变：看板文件名 / 数据维护主题目录 / 两个批次子目录）——单一来源是
// 目标项目的 .agents/config/engine.json options.wiki（安装期由 kit 按语言写入）。无该键 = 中文缺省
// （既有项目与全部中文安装行为不变）。引擎脚本一律经本模块取名，禁止再硬编码中文字面量。
// 读取失败 / 非法一律回退缺省；不缓存——脚本短生命周期，每次读一次文件即可。
import fs from 'node:fs';
import path from 'node:path';

export const WIKI_NAME_DEFAULTS = Object.freeze({
  board: '知识沉淀总览.html',   // 看板文件（wiki/ 下）
  maintenance: '数据维护',      // 数据维护主题目录
  schemaBatch: 'schema变更',    // 数据维护下的 schema 批次目录
  dataFixBatch: '数据修复',     // 数据维护下的数据修复批次目录
});

export function loadWikiNames(root = process.cwd()) {
  const names = { ...WIKI_NAME_DEFAULTS };
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'config', 'engine.json'), 'utf8'));
  } catch {
    return names;
  }
  const options = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg.options : null;
  const wiki = options && typeof options === 'object' && !Array.isArray(options) ? options.wiki : null;
  if (!wiki || typeof wiki !== 'object' || Array.isArray(wiki)) return names;
  for (const key of Object.keys(WIKI_NAME_DEFAULTS)) {
    const v = wiki[key];
    if (typeof v === 'string' && v.length > 0) names[key] = v;
  }
  return names;
}
