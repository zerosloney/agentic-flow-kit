#!/usr/bin/env node
/* test-impact-lib: 影响面选测的唯一实现（config + 匹配 + 选类 + 滤器）
 *
 * 口径单源：.agents/config/test-impact-map.json
 *   areas  = 测试类 → 业务域（同一测试类可跨域）
 *   always = 任何集成子集都必跑的基建/冒烟类
 *   paths  = 生产文件 → 业务域，按序首命中；未命中或 area 含 "*" = 回退全量
 *
 * 失败语义（故意保守）：任何无法判定的输入都返回 full，绝不静默跳过。
 * 新增测试类未登记时：selector 回退全量；check-test-impact-map.mjs 在 CI 重档硬红。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.FLOW_KIT_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MAP_PATH = path.join(ROOT, '.agents', 'config', 'test-impact-map.json');

const TEST_DIR = 'tests/Shipyard.Material.IntegrationTests/';
const UNIT_DIR = 'tests/Shipyard.Material.Tests/';
const FULLCHAIN_DIR = `${TEST_DIR}FullChain/`;
// 选测匹配统一小写键（P1 修复 2026-11-06）——startswith 判据须用小写常量。
const TEST_DIR_LC = TEST_DIR.toLowerCase();
const UNIT_DIR_LC = UNIT_DIR.toLowerCase();
const FULLCHAIN_DIR_LC = FULLCHAIN_DIR.toLowerCase();
const BUILD_FILE_RE = /\.(sln|csproj|props|targets)$/i;
const SQL_RE = /\.sql$/i;
const BACKEND_TEST_FACE_RE = /^(backend|tests|scripts)\//i;
const SCHEMA_CHANGE_SQL_RE = /^wiki\/数据维护\/schema变更\//i;
const DATA_REPAIR_SQL_RE = /^wiki\/数据维护\/数据修复\//i;
const AREA_RE = /^[a-z][a-z0-9-]*$/;
const CLASS_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const normalizePath = (p) =>
  String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();

const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** 受控 glob：支持 **、*、?、{a,b}；只用于本仓 manifest，不追求通用语义。 */
export function globToRegExp(glob) {
  const g = normalizePath(glob);
  let re = '^';
  for (let i = 0; i < g.length; ) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else if (ch === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i += 1;
      } else {
        const options = g.slice(i + 1, end).split(',').map((x) => escapeRe(x));
        re += `(?:${options.join('|')})`;
        i = end + 1;
      }
    } else {
      re += escapeRe(ch);
      i += 1;
    }
  }
  re += '$';
  return new RegExp(re);
}

export function validateMap(map) {
  const errors = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error('test-impact-map: 顶层必须是对象');
  }
  if (typeof map.namespace !== 'string' || !map.namespace.trim()) {
    errors.push('namespace 缺失');
  }
  if (!map.areas || typeof map.areas !== 'object' || Array.isArray(map.areas)) {
    errors.push('areas 缺失或不是对象');
  }
  const areaNames = new Set(Object.keys(map.areas || {}));
  const classAreas = new Map();
  for (const [area, classes] of Object.entries(map.areas || {})) {
    if (!AREA_RE.test(area)) errors.push(`area 名不合法：${area}`);
    if (!Array.isArray(classes) || classes.length === 0) {
      errors.push(`area ${area} 没有测试类`);
      continue;
    }
    const local = new Set();
    for (const cls of classes) {
      if (typeof cls !== 'string' || !CLASS_RE.test(cls)) {
        errors.push(`area ${area} 类名不合法：${cls}`);
        continue;
      }
      if (local.has(cls)) errors.push(`area ${area} 重复登记：${cls}`);
      local.add(cls);
      if (!classAreas.has(cls)) classAreas.set(cls, new Set());
      classAreas.get(cls).add(area);
    }
  }
  if (!Array.isArray(map.always)) {
    errors.push('always 必须是数组');
  } else {
    for (const cls of map.always) {
      if (!classAreas.has(cls)) errors.push(`always 类未在 areas 登记：${cls}`);
    }
  }
  if (!Array.isArray(map.paths) || map.paths.length === 0) {
    errors.push('paths 必须是非空数组');
  } else {
    map.paths.forEach((rule, idx) => {
      if (!rule || typeof rule !== 'object') {
        errors.push(`paths[${idx}] 不是对象`);
        return;
      }
      if (typeof rule.glob !== 'string' || !rule.glob.trim()) {
        errors.push(`paths[${idx}] 缺 glob`);
      } else {
        try {
          globToRegExp(rule.glob);
        } catch (e) {
          errors.push(`paths[${idx}] glob 无法解析：${rule.glob}`);
        }
      }
      if (!Array.isArray(rule.areas) || rule.areas.length === 0) {
        errors.push(`paths[${idx}] 缺 areas`);
        return;
      }
      for (const area of rule.areas) {
        if (area !== '*' && !areaNames.has(area)) {
          errors.push(`paths[${idx}] 引用未知 area：${area}`);
        }
      }
    });
  }
  if (errors.length) {
    const err = new Error(`test-impact-map 校验失败：\n- ${errors.join('\n- ')}`);
    err.errors = errors;
    throw err;
  }
  return map;
}

export function loadMap(mapPath = MAP_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(mapPath, 'utf8');
  } catch (e) {
    throw new Error(`test-impact-map 读取失败：${mapPath}（${e.message}）`);
  }
  let map;
  try {
    map = JSON.parse(raw);
  } catch (e) {
    throw new Error(`test-impact-map JSON 解析失败：${mapPath}（${e.message}）`);
  }
  return validateMap(map);
}

/** 返回 { files, reason }；reason 非空表示范围不可判定，调用方应回退全量。 */
export function changedFilesFromRange(oldSha, newSha) {
  const diff = (from, to) => {
    // core.quotepath=off：Git 默认会把中文路径转义成 "wiki/\346..."，选测会漏掉 schema SQL。
    // --no-renames：重命名按删除+新增处理，新旧路径都进影响面，避免只看到新路径。
    const r = spawnSync('git', ['-c', 'core.quotepath=off', 'diff', '--name-only', '--no-renames', `${from}..${to}`], {
      cwd: ROOT,
      encoding: 'utf8',
      shell: false,
    });
    if (r.status !== 0) {
      return {
        files: [],
        reason: `git diff 失败（${(r.stderr || '').trim()}），回退全量`,
      };
    }
    return {
      files: (r.stdout || '')
        .split(/\r?\n/)
        .map(normalizePath)
        .filter(Boolean),
      reason: null,
    };
  };

  // 新分支首推：远端无基线。优先与 origin/develop / origin/main 的 merge-base 比较，
  // 避免「只推前端/文档的新分支也跑全量」；找不到基线仍 fail-safe 回退全量。
  if (/^0+$/.test(oldSha || '')) {
    for (const ref of ['origin/develop', 'origin/main', 'develop', 'main']) {
      const verified = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
        cwd: ROOT,
        encoding: 'utf8',
        shell: false,
      });
      if (verified.status !== 0) continue;
      const base = spawnSync('git', ['merge-base', ref, newSha], {
        cwd: ROOT,
        encoding: 'utf8',
        shell: false,
      });
      const baseSha = (base.stdout || '').trim();
      if (base.status === 0 && baseSha) {
        return diff(baseSha, newSha);
      }
    }
    return { files: [], reason: '新分支首推且找不到本地基线，回退全量' };
  }

  return diff(oldSha, newSha);
}

/**
 * Count integration tests matched by a vstest filter. `dotnet test --list-tests`
 * exits 0 even when nothing matches, so the caller must use this count to
 * fail closed instead of trusting the exit code.
 */
export function countListedIntegrationTests(
  filter,
  { cwd = ROOT, cspoj = 'tests/Shipyard.Material.IntegrationTests/Shipyard.Material.IntegrationTests.csproj' } = {},
) {
  const r = spawnSync(
    'dotnet',
    [
      'test',
      cspoj,
      '--list-tests',
      '--no-build',
      '--nologo',
      '-v',
      'q',
      '--filter',
      filter,
    ],
    { cwd, encoding: 'utf8', shell: false, maxBuffer: 8 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    throw new Error(
      `集成用例预检失败（dotnet test --list-tests exit ${r.status}）：${(r.stderr || '').trim()}`,
    );
  }
  return (r.stdout.match(/^\s+Shipyard\.Material\.IntegrationTests\./gm) || []).length;
}

export function assertFilterHasTests(filter, opts) {
  const count = countListedIntegrationTests(filter, opts);
  if (count === 0) {
    throw new Error('选测 filter 匹配 0 个集成用例，拒绝绿灯');
  }
  return count;
}

export function classesInTestFile(absolutePath) {
  let src;
  try {
    src = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return [];
  }
  const out = new Set();
  const re = /^public\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (const m of src.matchAll(re)) {
    if (m[1].endsWith('Tests')) out.add(m[1]);
  }
  return [...out];
}

const buildClassIndex = (map) => {
  const allClasses = new Set();
  const classAreas = new Map();
  for (const [area, classes] of Object.entries(map.areas)) {
    for (const cls of classes) {
      allClasses.add(cls);
      if (!classAreas.has(cls)) classAreas.set(cls, new Set());
      classAreas.get(cls).add(area);
    }
  }
  return { allClasses, classAreas };
};

/**
 * @param {object} map 已校验的 manifest
 * @param {string[]} files 变更文件（相对仓库根，正/反斜杠均可）
 * @returns {{mode:'full'|'none'|'filter', reason:string, areas:string[], classes:string[],
 *            filter:string|null, warnings:string[], changedFiles:string[], totalClasses:number}}
 */
export function selectForFiles(map, files) {
  const { allClasses, classAreas } = buildClassIndex(map);
  // glob 与变更路径统一小写后匹配：map 里 glob 含大写（MTO*/Shipyard.Material…），
  // 与入口判据（pre-push 带 /i）对齐，任何大小写 casing 都不漏判。
  const rules = map.paths.map((rule) => ({ ...rule, re: globToRegExp(rule.glob.toLowerCase()) }));
  const changedFiles = (files || []).map(normalizePath).filter(Boolean);
  const areas = new Set();
  const explicitClasses = new Set();
  const warnings = [];
  let forceFull = false;

  for (const file of changedFiles) {
    // P1 修复（2026-11-06）：入口判据（pre-push isBackendFaceFile 等）带 /i，而本函数的
    // startsWith/glob 匹配大小写敏感——非标大小写路径（如 Backend/…）曾被判 mode=none 静默漏跑。
    // 统一用小写键 f 做判据匹配；读文件/告警仍用原 file。
    const f = file.toLowerCase();
    // 工程文件：构建口径可能影响全部集成用例，直接全量
    if (BUILD_FILE_RE.test(file)) {
      forceFull = true;
      warnings.push(`${file} → 工程文件，回退全量`);
      continue;
    }
    // SQL：后端/测试/脚本面、schema 变更与数据修复会影响集成；其余 wiki 数据维护不触发
    if (SQL_RE.test(file)) {
      if (
        BACKEND_TEST_FACE_RE.test(f) ||
        SCHEMA_CHANGE_SQL_RE.test(f) ||
        DATA_REPAIR_SQL_RE.test(f)
      ) {
        forceFull = true;
        warnings.push(`${file} → schema/数据修复 SQL，回退全量`);
      }
      continue;
    }
    // 单测面：集成无需重跑
    if (f.startsWith(UNIT_DIR_LC)) continue;
    // FullChain 默认不编译（#if FCLocal），不参与默认档
    if (f.startsWith(FULLCHAIN_DIR_LC)) continue;
    // 集成测试自身：只跑该文件里的测试类；测试基建无法判定则全量
    if (f.startsWith(TEST_DIR_LC)) {
      const classes = classesInTestFile(path.join(ROOT, file));
      if (classes.length === 0) {
        forceFull = true;
        warnings.push(`${file} → 测试基建/未识别测试文件，回退全量`);
        continue;
      }
      for (const cls of classes) {
        const clsAreas = classAreas.get(cls);
        if (!clsAreas) {
          forceFull = true;
          warnings.push(`${file} → 未登记测试类 ${cls}，回退全量`);
        } else {
          explicitClasses.add(cls);
          for (const area of clsAreas) areas.add(area);
        }
      }
      continue;
    }
    // 后端生产面：按序首命中
    if (f.startsWith('backend/')) {
      const rule = rules.find((r) => r.re.test(f));
      if (!rule) {
        forceFull = true;
        warnings.push(`${file} → 未命中路径规则，回退全量`);
        continue;
      }
      if (rule.areas.includes('*')) {
        forceFull = true;
        warnings.push(`${file} → 命中 ${rule.glob}（全量域），回退全量`);
        continue;
      }
      for (const area of rule.areas) areas.add(area);
      continue;
    }
    // 前端 / workflow / .agents / docs / scripts：不触发后端集成
  }

  if (forceFull) {
    return {
      mode: 'full',
      reason: '存在无法安全裁剪的变更',
      areas: [],
      classes: [...allClasses].sort(),
      filter: null,
      warnings,
      changedFiles,
      totalClasses: allClasses.size,
    };
  }

  if (areas.size === 0 && explicitClasses.size === 0) {
    return {
      mode: 'none',
      reason: '变更面不涉及后端集成',
      areas: [],
      classes: [],
      filter: null,
      warnings,
      changedFiles,
      totalClasses: allClasses.size,
    };
  }

  const classes = new Set([...explicitClasses, ...map.always]);
  for (const area of areas) {
    for (const cls of map.areas[area]) classes.add(cls);
  }
  const sorted = [...classes].sort();
  if (sorted.length >= allClasses.size) {
    return {
      mode: 'full',
      reason: '选中测试类覆盖全量',
      areas: [...areas].sort(),
      classes: [...allClasses].sort(),
      filter: null,
      warnings,
      changedFiles,
      totalClasses: allClasses.size,
    };
  }

  const filter = sorted
    .map((cls) => `FullyQualifiedName~${map.namespace}.${cls}.`)
    .join('|');
  return {
    mode: 'filter',
    reason: `按影响面选中 ${sorted.length}/${allClasses.size} 个测试类`,
    areas: [...areas].sort(),
    classes: sorted,
    filter,
    warnings,
    changedFiles,
    totalClasses: allClasses.size,
  };
}

/** 供 CLI 与 run-backend-tests 共用：打印人类可读决策。 */
export function formatDecision(decision) {
  const lines = [];
  lines.push(`changed files: ${decision.changedFiles.length}`);
  if (decision.areas.length) lines.push(`areas: ${decision.areas.join(', ')}`);
  if (decision.mode === 'filter') {
    lines.push(`classes: ${decision.classes.length}/${decision.totalClasses}`);
    lines.push(`filter: ${decision.filter}`);
  } else {
    lines.push(`classes: ${decision.mode === 'full' ? decision.totalClasses : 0}/${decision.totalClasses}`);
  }
  lines.push(`mode: ${decision.mode}（${decision.reason}）`);
  for (const w of decision.warnings) lines.push(`warn: ${w}`);
  return lines.join('\n');
}
