// wiki 协议名（kit 侧单源）：zh-CN 是模板的物理路径；en 给出对应英文名。安装期 plan 按语言翻译脚手架目标路径、
// buildVars 把协议名写进 engine.json 的 options.wiki（仅非中文安装写入——中文安装逐字节不变）并提供文档占位符。
export const WIKI_NAMES = {
  requirements: { 'zh-CN': '产品需求', en: 'requirements' },
  designs: { 'zh-CN': '开发方案', en: 'designs' },
  testReports: { 'zh-CN': '测试报告', en: 'test-reports' },
  features: { 'zh-CN': '用户功能', en: 'features' },
  conventions: { 'zh-CN': '项目规范', en: 'conventions' },
  maintenance: { 'zh-CN': '数据维护', en: 'data-maintenance' },
  board: { 'zh-CN': '知识沉淀总览.html', en: 'knowledge-overview.html' },
  schemaBatch: { 'zh-CN': 'schema变更', en: 'schema-changes' },
  dataFixBatch: { 'zh-CN': '数据修复', en: 'data-fixes' },
};

// 六个主题目录的 key（看板文件不在内）：doctor 用它检出另一语言遗留的旧命名目录。
export const WIKI_TOPIC_KEYS = ['requirements', 'designs', 'testReports', 'features', 'conventions', 'maintenance'];

// 目标路径需要翻译的七项：六个主题目录 + 看板文件。批次目录嵌在数据维护主题内，由引擎脚本按协议名自行取名。
const LOCALIZABLE_KEYS = [...WIKI_TOPIC_KEYS, 'board'];

function resolveLang(lang) {
  return Object.prototype.hasOwnProperty.call(WIKI_NAMES.board, lang) ? lang : 'zh-CN';
}

export function wikiName(key, lang) {
  const names = WIKI_NAMES[key];
  return names ? names[resolveLang(lang)] : undefined;
}

export function localizePath(rel, lang) {
  const target = resolveLang(lang);
  if (target === 'zh-CN') return rel;
  const p = String(rel).replace(/\\/g, '/');
  for (const key of LOCALIZABLE_KEYS) {
    const zhPrefix = `wiki/${WIKI_NAMES[key]['zh-CN']}`;
    if (p !== zhPrefix && !p.startsWith(`${zhPrefix}/`)) continue;
    return `wiki/${WIKI_NAMES[key][target]}${p.slice(zhPrefix.length)}`;
  }
  return p;
}

// 写进目标项目 engine.json options.wiki 的协议名（不带 wiki/ 前缀）。
export function wikiProtocolNames(lang) {
  const target = resolveLang(lang);
  return {
    board: WIKI_NAMES.board[target],
    maintenance: WIKI_NAMES.maintenance[target],
    schemaBatch: WIKI_NAMES.schemaBatch[target],
    dataFixBatch: WIKI_NAMES.dataFixBatch[target],
  };
}

// 文档占位符：路径 token 形如 wiki/data-maintenance（无尾斜杠）；名称 token 只给协议名。
export function wikiTokens(lang) {
  const target = resolveLang(lang);
  const n = (key) => WIKI_NAMES[key][target];
  return {
    wikiRequirements: `wiki/${n('requirements')}`,
    wikiDesigns: `wiki/${n('designs')}`,
    wikiTestReports: `wiki/${n('testReports')}`,
    wikiFeatures: `wiki/${n('features')}`,
    wikiConventions: `wiki/${n('conventions')}`,
    wikiMaintenance: `wiki/${n('maintenance')}`,
    wikiBoard: `wiki/${n('board')}`,
    wikiSchemaBatch: `wiki/${n('maintenance')}/${n('schemaBatch')}`,
    wikiDataFixBatch: `wiki/${n('maintenance')}/${n('dataFixBatch')}`,
    wikiMaintenanceName: n('maintenance'),
    wikiBoardName: n('board'),
    wikiSchemaBatchName: n('schemaBatch'),
    wikiDataFixBatchName: n('dataFixBatch'),
  };
}
