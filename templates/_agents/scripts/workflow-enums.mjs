// workflow-enums 读取器——.agents/workflow-enums.txt 单源（2026-09-25 enum-single-source）
// 消费方：workflow-board-server.mjs / kb-search.mjs / gen-workflow-index.mjs / fill-{intent,plan,spec}.mjs
//   （check-loop.sh 为 POSIX sh，自行 sed 读取同文件，口径同本读取器的键）。
// fail-loud 无 fallback：kit 自带该文件，缺失/坏数据属安装破损——直接抛错崩得可见，
//   doctor §2 布局门同时把关文件存在性。禁止在任何消费方内再抄一份枚举字面量。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENUMS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workflow-enums.txt');

// parseEnums(text)：`key=a b` 行 → { key: ['a','b'] }；非法行/重复键/重复值抛错（单源纪律）
export function parseEnums(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-z][a-z0-9.]*)=(\S.*)$/);
    if (!m) throw new Error('workflow-enums 行格式非法（须 key=value value）: ' + line);
    if (m[1] in out) throw new Error('workflow-enums 键重复: ' + m[1]);
    const vals = m[2].trim().split(/\s+/);
    if (new Set(vals).size !== vals.length) throw new Error('workflow-enums 值重复: ' + line);
    out[m[1]] = vals;
  }
  return out;
}

const NEED_KEYS = [
  'doc.status.all', 'doc.status.confirmed', 'doc.status.active', 'doc.status.terminal', 'doc.status.abandoned',
  'incident.status.all', 'incident.status.active', 'level.all',
];

// validateEnums(enums)：跨键不变量（子集关系 + 活跃/终态互斥 + 关键态在位）——坏数据尽早抛错
export function validateEnums(e) {
  for (const k of NEED_KEYS) {
    if (!Array.isArray(e[k]) || !e[k].length) throw new Error('workflow-enums 缺键或空值: ' + k);
  }
  const sub = (a, b) => {
    for (const v of e[a]) if (!e[b].includes(v)) throw new Error(`workflow-enums 不变量破: ${a} 含 ${b} 外的值 ${v}`);
  };
  sub('doc.status.confirmed', 'doc.status.all');
  sub('doc.status.active', 'doc.status.all');
  sub('doc.status.terminal', 'doc.status.all');
  sub('doc.status.abandoned', 'doc.status.all');
  sub('doc.status.abandoned', 'doc.status.terminal');
  sub('incident.status.active', 'incident.status.all');
  if (e['doc.status.active'].some((v) => e['doc.status.terminal'].includes(v))) {
    throw new Error('workflow-enums 不变量破: doc.status.active 与 doc.status.terminal 重叠');
  }
  if (!e['doc.status.confirmed'].includes('approved') || !e['doc.status.terminal'].includes('done')) {
    throw new Error('workflow-enums 不变量破: approved 须在 confirmed、done 须在 terminal（确认/关单语义锚点）');
  }
  return e;
}

// loadEnums(file = 单源标准位置)：读文件 → parse → validate；缺文件抛错（fail-loud）
export function loadEnums(file = ENUMS_FILE) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error('workflow-enums 单源文件不可读（kit 自带，跑 flow-kit sync 恢复）: ' + file + ' — ' + err.message);
  }
  return validateEnums(parseEnums(text));
}

// 模块级常量：import 即加载即校验（标准位置）
export const ENUMS = loadEnums();
export default ENUMS;
