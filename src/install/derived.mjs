// 派生工件语义单源（issue #86）：哪些文件由生成器产出、生成器怎么重写它们。
//
// mode 'anchor'：生成器只重写 GENERATED 锚点区，锚点外是用户可写区
//                 → 安装器保留磁盘原文是安全的（workflow/INDEX.md）。
// mode 'whole' ：生成器整文件重写，文件里没有「用户区」
//                 → 安装器不盲写静态模板；磁盘内容既非生成器输出、又未提交 git（覆盖后找不回）时
//                   才保留现状并跳过重生成，其余情况照常交给生成器重写（effective-policy / engine-map）。
//
// 派生工件是「生成物」，静态模板只是新装户占位：安装器对它们一律不写模板，
// 否则用户写在锚点外的手工说明会被永久覆盖且 --check/diff/verify 全绿查不出来。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { RUNTIME_SCRIPTS } from '../commands/runtime.mjs';
import { sha256Text } from './manifest.mjs';
import { writeBaseline } from './baseline.mjs';

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

/** 样板比对口径：行尾归一 + 末尾空白不计（生成器在整份模板后追加生成区前会补一个空行）。 */
const normBoilerplate = (text) => normEol(text).trimEnd();

/**
 * 模板的「锚点外样板」：模板自带锚点时取锚点之前的文本；模板自身没有锚点时整份模板就是样板
 * （英文覆盖模板 locales/en/overrides/ 就是这种——生成器首次运行时才在整份模板后追加生成区）。
 */
function templateBoilerplate(templateText) {
  const tpl = splitAnchorRegion(templateText);
  return tpl ? tpl.before : String(templateText || '');
}

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
 * 「样板」不依赖模板自带锚点：英文覆盖模板（locales/en/overrides/）没有锚点，
 * 整份模板就是锚点外样板，凭它一样能检出旧版安装的覆盖。
 */
export function detectAnchorTextOverwritten({ target, rel, diskText, templateText }) {
  const boilerplate = normBoilerplate(templateBoilerplate(templateText));
  if (!boilerplate) return null;
  const disk = splitAnchorRegion(diskText);
  if (!disk) return null;
  if (normBoilerplate(disk.before) !== boilerplate) return null;
  const head = readGitHeadFile(target, rel);
  if (head == null) return null;
  const prev = splitAnchorRegion(head);
  if (!prev) return null;
  if (normBoilerplate(prev.before) === boilerplate) return null;
  return { rel, headBefore: prev.before };
}

/**
 * 整文件派生工件的磁盘内容状态（安装器的升级守卫与 check-engine-artifacts.mjs 的自愈门共用同一条规则）：
 *   generated   —— 磁盘内容就是生成器输出（生成器 --check 通过）；
 *   recoverable —— 当前内容已提交进 git，覆盖后可用 git show HEAD:<rel> 找回。
 * 只有「不是生成器输出，且未提交」才是覆盖后找不回的内容。生成器或 git 不可用一律按最坏情况算。
 * 自愈门另把 .agents/install-manifest.json 记录的那份安装器产物算作生成内容（装完尚未提交的纯生成
 * 内容）；安装器这边不需要该判断——调用点的 managedHash !== currentHash 前置条件已把原样产物排除。
 */
export function inspectWholeDerived(target, rel) {
  const artifact = DERIVED_ARTIFACTS.find((d) => d.rel === rel && d.mode === 'whole');
  let generated = false;
  if (artifact) {
    try {
      const res = spawnSync(process.execPath, [path.join(RUNTIME_SCRIPTS, artifact.script), '--check'], {
        cwd: target,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
        env: { ...process.env, FLOW_KIT_PROJECT_ROOT: target },
      });
      generated = !res.error && res.status === 0;
    } catch {
      generated = false;
    }
  }
  let recoverable = false;
  try {
    // 未跟踪、已暂存未提交、已修改、非 git 仓、git 不可用 → 都算未提交（覆盖后找不回）。
    const res = spawnSync('git', ['status', '--porcelain', '--', rel], {
      cwd: target,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
    });
    recoverable = !res.error && res.status === 0 && String(res.stdout || '').trim() === '';
  } catch {
    recoverable = false;
  }
  return { generated, recoverable };
}

// 派生工件（索引/生效策略/引擎地图）从单源现场取数生成，不能静态随模板漂移。
// 运行时实现已随包分发，因此从包内脚本执行，只把 cwd/根指向目标项目。
// 只重生成「本次已装进目标」的产物：--scaffold none 时目标没有 workflow/ 面，
// 生成器若照跑会凭空造出 workflow/ 目录（破坏「无脚手架即无 workflow」契约）。
// skip：安装器判定「用户改过、保留现状」的产物——整文件生成的产物被跳过时，
// 生成器不得再覆盖用户的改动（issue #86 静默吃数据）。
export function generateDerivedArtifacts(target, { skip = new Set() } = {}) {
  for (const { script, rel } of DERIVED_ARTIFACTS) {
    if (!fs.existsSync(path.join(target, rel))) continue; // 未装该产物 → 不生成（保持脚手架档语义）
    if (skip.has(rel)) continue; // 用户改过且已保留现状 → 不重生成
    const abs = path.join(RUNTIME_SCRIPTS, script);
    if (!fs.existsSync(abs)) continue;
    try {
      spawnSync(process.execPath, [abs], {
        cwd: target,
        stdio: 'ignore',
        windowsHide: true,
        timeout: 30000,
        env: { ...process.env, FLOW_KIT_PROJECT_ROOT: target },
      });
    } catch { /* 派生工件失败不阻断安装；verify/dream 会报漂移 */ }
  }
}

// 派生工件会改写已写入的托管文件（如 workflow/INDEX.md）；重算这些文件的哈希，
// 否则 manifest 记录的是生成前的文本，fresh install 会立刻显示为漂移。
// 被生成器改写的文件登记到 derived，diff 不对其做静态模板比对。
export function rehashDerivedArtifacts({ target, result, derived, beforeDerived, baselineEnabled, warn, claimed = [] }) {
  const claimedSet = new Set(claimed);
  for (const rel of result.written || []) {
    // 三方合并冲突/合并文件保留旧哈希，供 diff / doctor 继续提示未解决。
    if ((result.skipRehash || []).includes(rel)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(target, rel), 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') {
        /* 生成器删除的文件不保留 manifest 记录 */
        delete result.files[rel];
        derived.delete(rel);
      } else {
        // 瞬时读错误（Windows EBUSY/EPERM，杀毒/索引服务常见）：写入已成功、记录是写入文本的哈希，
        // 保留记录留下可见漂移（doctor 可检出）而非静默失忆（升级永久 skip / uninstall 不清理）；
        // 不 fail-loud，避免把瞬时错误放大成重跑半安装。
        warn?.(`${rel}（读取失败 ${err?.code || err}，保留 manifest 记录）`);
      }
      continue;
    }
    const nextHash = sha256Text(text);
    result.files[rel] = nextHash;
    // 认领的派生工件即使本次生成器未改字节，也必须留在 derived 集合（issue #86：
    // 否则 diff 拿静态模板比对，存量仓永久假漂移）。
    if (beforeDerived[rel] !== nextHash || claimedSet.has(rel)) {
      derived.add(rel);
      // 派生工件在安装期重写，基线同步为最终文本，避免下次升级误判。
      if (baselineEnabled) writeBaseline(target, rel, text);
    } else derived.delete(rel);
  }
}
