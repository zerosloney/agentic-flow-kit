// derived-placeholder — 识别「新装户占位头 + 生成区已有数据」的混合态（issue #86）。
// 混合态 = 静态模板头被写进存量仓，而 gen-*.mjs 又把真实数据写进锚点内：
// 同一文件自相矛盾，说明锚点外用户区曾被覆盖。生成器脚本随目标仓分发，不能 import 本模块，
// 故模板侧有一份同口径实现；tests/derived-placeholder.test.mjs 做双实现交叉校验防漂移。
export const PLACEHOLDER_SENTINELS = [/本文件为新装户占位/, /^## 活跃（0）$/m];
export const GENERATED_BEGIN_RE = /<!-- GENERATED:BEGIN[^>]*-->/;
export const GENERATED_END = '<!-- GENERATED:END -->';

/** 生成区内「真实数据」计数：活跃 / 任务投影 / 档案计数 任一 > 0，或出现数据行。 */
export function generatedDataCounts(inner) {
  const text = String(inner || '');
  const pick = (re) => {
    const m = text.match(re);
    return m ? Number(m[1]) : 0;
  };
  return {
    active: pick(/## 活跃（(\d+)）/),
    tasks: pick(/## 任务投影（(\d+)）/),
    archive: pick(/## 档案计数（(\d+)/),
    rows: (text.match(/^\|\s*(?:INTENT|SPEC|PLAN|INCIDENT)\s*\|/gm) || []).length,
  };
}

/** 返回 { sentinel, counts } 或 null（无锚点/无占位哨兵/生成区无数据）。 */
export function detectPlaceholderDrift(text) {
  const src = String(text || '');
  const begin = src.match(GENERATED_BEGIN_RE);
  if (!begin) return null;
  const beginEnd = begin.index + begin[0].length;
  const endIdx = src.indexOf(GENERATED_END, beginEnd);
  if (endIdx < 0) return null;
  const pre = src.slice(0, begin.index);
  const sentinel = PLACEHOLDER_SENTINELS.find((re) => re.test(pre));
  if (!sentinel) return null;
  const counts = generatedDataCounts(src.slice(beginEnd, endIdx));
  const hasData = counts.active > 0 || counts.tasks > 0 || counts.archive > 0 || counts.rows > 0;
  return hasData ? { sentinel: String(sentinel), counts } : null;
}

/** 锚点外非空行数（用于 --force 覆盖时告知丢弃了多少用户文本）；无锚点返回 0。 */
export function countOutsideAnchorLines(text) {
  const src = String(text || '');
  const begin = src.match(GENERATED_BEGIN_RE);
  if (!begin) return 0;
  const endIdx = src.indexOf(GENERATED_END, begin.index + begin[0].length);
  if (endIdx < 0) return 0;
  const outside = src.slice(0, begin.index) + src.slice(endIdx + GENERATED_END.length);
  return outside.split(/\r?\n/).filter((line) => line.trim()).length;
}
