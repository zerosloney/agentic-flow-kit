// 模板树渲染：目录名前缀 _ 映射为点目录（_agents→.agents）；文本文件做 {{KEY}} 占位符替换
// 返回写入清单（rel + sha256），供 kit.json managed 台账与 doctor 校验
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PH_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// relOf：模板内相对路径 → 目标相对路径（仅顶层 _ 前缀目录转点目录）
function relOf(absFile, srcRoot) {
  const parts = path.relative(srcRoot, absFile).split(path.sep);
  if (parts.length > 1 && parts[0].startsWith('_')) parts[0] = '.' + parts[0].slice(1);
  return parts.join('/');
}

// renderContent：单文件文本渲染（{{KEY}} 替换，未知占位符原样保留）——renderTree 与 init 的 AGENTS.md 追加补齐共用
export function renderContent(text, vars) {
  return String(text || '').replace(PH_RE, (m, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m));
}

// renderTree：模板树渲染。opts.protectOwned=true 时（init --force 路径，2026-09-27 p2-batch1），
// rel 命中 protectSet 且目标已存在 → 跳过覆盖并计入 protected 清单（owned「永不触碰」两态模型
// 在 --force 路径的对齐；此前 force 覆盖一切同名文件曾实测静默丢用户自定义内容）
export function renderTree(srcRoot, targetRoot, vars, { force = false, protectSet = null } = {}) {
  const written = [];   // { rel, sha256 }
  const skipped = [];   // rel（已存在，保守跳过）
  const protectedSkipped = []; // rel（--force 下 owned 保护跳过）
  const warnings = [];  // 未知占位符等
  const dirs = [];

  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 运行时缓存不是模板（包源跑测试会在 templates/_agents/cache/ 落盘残留）——init/sync 一律跳过
        if (relOf(abs, srcRoot) === '.agents/cache') continue;
        dirs.push(relOf(abs, srcRoot));
        walk(abs);
        continue;
      }
      const rel = relOf(abs, srcRoot);
      // 引擎基线不是模板：包源径基线的键命名空间与装户盘面不一致（见 check-engine-integrity.mjs
      // resolveLock 注释）——下发会致装户全员误报。包源跑 --update 落盘时排除，杜绝入库即污染
      if (rel === '.agents/engine-lock.json') continue;
      const target = path.join(targetRoot, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target) && !force) {
        skipped.push(rel);
        continue;
      }
      if (protectSet && protectSet.has(rel) && fs.existsSync(target)) {
        protectedSkipped.push(rel);
        continue;
      }
      const raw = fs.readFileSync(abs);
      let out = raw;
      if (raw.length < 512 * 1024 && !raw.includes(0)) {
        // 文本面 LF 归一（2026-09-27 closing-coverage）：模板盘面 CRLF（autocrlf 检出 / 编辑器写入）与
        // LF 克隆渲染出同一字节、同一 sha——fresh sha、装户落盘、kit.json 台账三方跨环境稳定；
        // sync/doctor/source-sync-check 的读取侧归一（shaText）与本处写盘归一同口径闭合
        const replaced = renderContent(raw.toString('utf8').replace(/\r\n/g, '\n'), vars);
        if (replaced.includes('{{')) {
          for (const m of replaced.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)) {
            if (!Object.prototype.hasOwnProperty.call(vars, m[1])) warnings.push(`${rel}: 未知占位符 {{${m[1]}}}（原样保留）`);
          }
        }
        out = Buffer.from(replaced, 'utf8');
      }
      fs.writeFileSync(target, out, { mode: rel.startsWith('.githooks/') ? 0o755 : 0o644 }); // 钩子带执行位（init-p1-batch P1-1：POSIX 装户 git 对不可执行钩子静默跳过）
      written.push({ rel: rel.split(path.sep).join('/'), sha256: sha256(out) });
    }
  })(srcRoot);

  return { written, skipped, protectedSkipped, warnings, dirs };
}

// renderPkgText：目标侧脚本执行防线的比对基准（2026-09-27 init-p1-batch P1-3）——读包源模板
// （templates/_agents/<rel 去掉 .agents/ 前缀>）→ LF 归一 → {{VAR}} 渲染（脚本面无占位符时即原文）。
// 返回 null = 包源无该模板或非文本面（无从校验，调用方按不可信处理）。
export function renderPkgText(pkgRoot, rel, vars) {
  if (!rel.startsWith('.agents/')) return null;
  const tmpl = path.join(pkgRoot, 'templates', '_agents', rel.slice('.agents/'.length));
  try {
    const raw = fs.readFileSync(tmpl);
    if (raw.length >= 512 * 1024 || raw.includes(0)) return null;
    return renderContent(raw.toString('utf8').replace(/\r\n/g, '\n'), vars);
  } catch {
    return null;
  }
}

// scriptTrusted：目标侧脚本是否与包源渲染值一致（LF 归一双侧 sha 比对，与 closing-coverage 六处口径同族）。
// 返回 {ok, note}——ok=false 时 note 给出原因（预置/被改动/包源无模板/不可读），调用方跳过执行并显式提示。
export function scriptTrusted({ pkgRoot, target, rel, vars }) {
  const expected = renderPkgText(pkgRoot, rel, vars);
  if (expected === null) return { ok: false, note: `包源无 ${rel} 模板，无法校验` };
  const expSha = sha256(Buffer.from(expected, 'utf8'));
  let actual;
  try {
    actual = fs.readFileSync(path.join(target, rel), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return { ok: false, note: `${rel} 不可读` };
  }
  if (sha256(Buffer.from(actual, 'utf8')) === expSha) return { ok: true, note: '' };
  return { ok: false, note: `目标侧 ${rel} 与包源渲染值不符（预置或被改动）` };
}

// listTree(srcRoot)：只枚举模板树的目标相对路径（rel），不落盘、不算 sha——供 doctor 台账覆盖率检查复用。
// 与 renderTree 完全同一套 relOf 映射（顶层 _ 前缀目录转点目录）与 .agents/cache 排除，避免两处映射漂移。
export function listTree(srcRoot) {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (relOf(abs, srcRoot) === '.agents/cache') continue;
        walk(abs);
        continue;
      }
      // 引擎基线不下发（命名空间错配会致装户全员误报——同 renderTree 排除，见 check-engine-integrity.mjs）
      if (relOf(abs, srcRoot) === '.agents/engine-lock.json') continue;
      out.push(relOf(abs, srcRoot).split(path.sep).join('/'));
    }
  })(srcRoot);
  return out;
}

export { sha256 };
