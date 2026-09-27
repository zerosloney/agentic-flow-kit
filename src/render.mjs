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

export function renderTree(srcRoot, targetRoot, vars, { force = false } = {}) {
  const written = [];   // { rel, sha256 }
  const skipped = [];   // rel（已存在，保守跳过）
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
      const target = path.join(targetRoot, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target) && !force) {
        skipped.push(rel);
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
      fs.writeFileSync(target, out);
      written.push({ rel: rel.split(path.sep).join('/'), sha256: sha256(out) });
    }
  })(srcRoot);

  return { written, skipped, warnings, dirs };
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
      out.push(relOf(abs, srcRoot).split(path.sep).join('/'));
    }
  })(srcRoot);
  return out;
}

export { sha256 };
