// 派生工件语义单源（issue #86）：哪些文件由生成器产出、生成器怎么重写它们。
//
// mode 'anchor'：生成器只重写 GENERATED 锚点区，锚点外是用户可写区
//                 → 安装器保留磁盘原文是安全的（workflow/INDEX.md）。
// mode 'whole' ：生成器整文件重写，文件里没有「用户区」
//                 → 安装器既不盲写静态模板，也不在用户改过文件时让生成器覆盖（effective-policy / engine-map）。
//
// 派生工件是「生成物」，静态模板只是新装户占位：安装器对它们一律不写模板，
// 否则用户写在锚点外的手工说明会被永久覆盖且 --check/diff/verify 全绿查不出来。
import { spawnSync } from 'node:child_process';

export const DERIVED_ARTIFACTS = [
  { rel: 'workflow/INDEX.md', mode: 'anchor', script: 'gen-workflow-index.mjs' },
  { rel: 'workflow/effective-policy.md', mode: 'whole', script: 'gen-effective-policy.mjs' },
  { rel: '.agents/notes/engine-map.md', mode: 'whole', script: 'gen-engine-map.mjs' },
];

export const DERIVED_RELS = new Set(DERIVED_ARTIFACTS.map((d) => d.rel));

/** 派生工件的重写模式；非派生工件返回 null。 */
export function derivedModeOf(rel) {
  const found = DERIVED_ARTIFACTS.find((d) => d.rel === rel);
  return found ? found.mode : null;
}

const GENERATED_BEGIN_RE = /<!-- GENERATED:BEGIN[^>]*-->/;
const GENERATED_END = '<!-- GENERATED:END -->';

/** 切分锚点区：{ before, inner, after }；没有成对锚点返回 null。 */
export function splitAnchorRegion(text) {
  const src = String(text || '');
  const begin = src.match(GENERATED_BEGIN_RE);
  if (!begin) return null;
  const beginEnd = begin.index + begin[0].length;
  const endIdx = src.indexOf(GENERATED_END, beginEnd);
  if (endIdx < 0) return null;
  return {
    before: src.slice(0, begin.index),
    inner: src.slice(beginEnd, endIdx),
    after: src.slice(endIdx + GENERATED_END.length),
  };
}

function countNonEmptyLines(text) {
  return String(text || '').split(/\r?\n/).filter((line) => line.trim()).length;
}

/** 锚点外非空行数（anchor 模式的用户可写区行数）。 */
export function countOutsideAnchorLines(text) {
  const region = splitAnchorRegion(text);
  if (!region) return 0;
  return countNonEmptyLines(`${region.before}\n${region.after}`);
}

/** --force 覆盖派生工件时会被丢弃的「非生成内容」行数。 */
export function countDiscardableLines(text, mode) {
  return mode === 'whole' ? countNonEmptyLines(text) : countOutsideAnchorLines(text);
}

const normEol = (text) => String(text || '').replace(/\r\n/g, '\n');

/** 读目标仓 git HEAD 里的文件内容；无 git / 该文件未提交 → null。 */
function readGitHeadFile(target, rel) {
  try {
    const res = spawnSync('git', ['show', `HEAD:${rel}`], {
      cwd: target,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (res.error || res.status !== 0) return null;
    return res.stdout;
  } catch {
    return null;
  }
}

/**
 * 检测「锚点外原文被旧版安装覆盖」（issue #86）。
 *
 * 只有两条证据同时成立才判定为受损，单靠文件内容判不出来——正常新装户的锚点外
 * 同样是模板样板（scaffold 模板里就写着占位头），与被覆盖后的形态逐字节相同：
 *   1. 当前磁盘锚点外 == 模板锚点外（说明现在只剩样板，没有任何用户内容）；
 *   2. git HEAD 里的锚点外 != 模板锚点外（说明用户原本写过手工说明并已提交）。
 * 证据不足（没 git / 没提交过 / HEAD 里也是样板）一律不报——宁可漏报也不误报，
 * 否则每个健康新装户都会被提示「手工区被覆盖」。
 */
export function detectAnchorTextOverwritten({ target, rel, diskText, templateText }) {
  const disk = splitAnchorRegion(diskText);
  const tpl = splitAnchorRegion(templateText);
  if (!disk || !tpl) return null;
  if (normEol(disk.before) !== normEol(tpl.before)) return null;
  const head = readGitHeadFile(target, rel);
  if (head == null) return null;
  const prev = splitAnchorRegion(head);
  if (!prev) return null;
  if (normEol(prev.before) === normEol(tpl.before)) return null;
  return { rel, headBefore: prev.before };
}
