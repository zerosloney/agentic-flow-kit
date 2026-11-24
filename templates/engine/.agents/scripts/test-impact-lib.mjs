#!/usr/bin/env node
/* test-impact-lib: 影响面选测的唯一实现（config + 匹配 + 选类 + 滤器）
 *
 * 口径单源：.agents/config/test-impact-map.json
 *   namespace = 测试命名空间（生成 vstest filter）
 *   dirs   = 目录面：test / unit / fullchain（项目自填；未声明 = 无法裁定，回退全量）
 *   faces  = 代码面：code / sql（项目自填；未声明 = 未知路径回退全量）
 *   areas  = 测试类 → 业务域（同一测试类可跨域）
 *   always = 任何集成子集都必跑的基建/冒烟类
 *   paths  = 生产文件 → 业务域，按序首命中；未命中或 area 含 "*" = 回退全量
 *
 *   runner = 测试执行器（可选）：kind=vstest|generic（缺省 vstest，保持 dotnet 口径）；
 *            project/list/listNamePattern/filter 覆盖集成工程定位、列名命令、用例行正则与 filter 模板。
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

const BUILD_FILE_RE = /\.(sln|csproj|props|targets)$/i;
const SQL_RE = /\.sql$/i;
const AREA_RE = /^[a-z][a-z0-9-]*$/;
const CLASS_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const normalizePath = (p) =>
  String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();

const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

const normDir = (value) => {
  const s = normalizePath(String(value || '')).toLowerCase();
  if (!s) return '';
  return s.endsWith('/') ? s : `${s}/`;
};

/** 目录/面口径（dirs / faces）：项目级唯一来源，缺省即未声明（选测回退全量）。 */
export function mapDirs(map) {
  const d = (map && typeof map.dirs === 'object' && map.dirs) || {};
  return { test: normDir(d.test), unit: normDir(d.unit), fullchain: normDir(d.fullchain) };
}

export function mapFaces(map) {
  const f = (map && typeof map.faces === 'object' && map.faces) || {};
  const arr = (v) => (Array.isArray(v) ? v.map(normDir).filter(Boolean) : []);
  return { code: arr(f.code), sql: arr(f.sql) };
}

/** 执行器口径：缺省 vstest（dotnet 行为不变）；generic 需项目提供 filter 模板。 */
export function mapRunner(map) {
  const r = (map && typeof map.runner === 'object' && !Array.isArray(map.runner) && map.runner) || {};
  return {
    kind: r.kind === 'generic' ? 'generic' : 'vstest',
    project: typeof r.project === 'string' ? normalizePath(r.project) : '',
    list: Array.isArray(r.list) ? r.list.map((x) => String(x)) : null,
    listNamePattern: typeof r.listNamePattern === 'string' ? r.listNamePattern : '',
    filter: typeof r.filter === 'string' ? r.filter : '',
  };
}

const DEFAULT_LIST_NAME_PATTERN = '^\\s+[A-Za-z_][A-Za-z0-9_.]*\\.';

/** dirs.test 派生集成工程路径（旧口径：<testDir>/<basename>.csproj）。 */
const projectFromDirs = (dirs) => {
  const rel = dirs.test.endsWith('/') ? dirs.test.slice(0, -1) : dirs.test;
  return `${rel}/${path.posix.basename(rel)}.csproj`;
};

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
  if (map.dirs !== undefined) {
    if (!map.dirs || typeof map.dirs !== 'object' || Array.isArray(map.dirs)) {
      errors.push('dirs 必须是对象');
    } else {
      for (const key of ['test', 'unit', 'fullchain']) {
        const v = map.dirs[key];
        if (v !== undefined && typeof v !== 'string') errors.push(`dirs.${key} 必须是字符串`);
      }
    }
  }
  if (map.faces !== undefined) {
    if (!map.faces || typeof map.faces !== 'object' || Array.isArray(map.faces)) {
      errors.push('faces 必须是对象');
    } else {
      for (const key of ['code', 'sql']) {
        const v = map.faces[key];
        if (v !== undefined && !Array.isArray(v)) errors.push(`faces.${key} 必须是数组`);
        else if (Array.isArray(v) && v.some((x) => typeof x !== 'string' || !x.trim())) {
          errors.push(`faces.${key} 只能是非空字符串`);
        }
      }
    }
  }
  if (map.runner !== undefined) {
    const r = map.runner;
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      errors.push('runner 必须是对象');
    } else {
      const allowed = ['kind', 'project', 'list', 'filter', 'listNamePattern'];
      for (const key of Object.keys(r)) {
        if (!allowed.includes(key)) errors.push(`runner 未知键：${key}`);
      }
      if (r.kind !== undefined && r.kind !== 'vstest' && r.kind !== 'generic') {
        errors.push('runner.kind 只能是 vstest 或 generic');
      }
      if (r.project !== undefined && (typeof r.project !== 'string' || !r.project.trim())) {
        errors.push('runner.project 必须是非空字符串');
      }
      if (r.list !== undefined) {
        if (!Array.isArray(r.list) || r.list.length === 0
          || r.list.some((x) => typeof x !== 'string' || !x.trim())) {
          errors.push('runner.list 必须是非空字符串数组');
        }
      }
      if (r.filter !== undefined && (typeof r.filter !== 'string' || !r.filter.trim())) {
        errors.push('runner.filter 必须是非空字符串');
      }
      if (r.listNamePattern !== undefined) {
        if (typeof r.listNamePattern !== 'string' || !r.listNamePattern.trim()) {
          errors.push('runner.listNamePattern 必须是非空字符串');
        } else {
          try {
            new RegExp(r.listNamePattern);
          } catch {
            errors.push('runner.listNamePattern 不是合法正则');
          }
        }
      }
    }
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
 * Count integration tests matched by the runner's list command.
 * `dotnet test --list-tests` exits 0 even when nothing matches, so the caller
 * must use this count to fail closed instead of trusting the exit code.
 * runner.list 给定时按模板执行（args 数组，不经 shell；{project}/{filter} 替换）；
 * 缺省保持 dotnet --list-tests 旧口径。runner.listNamePattern 覆盖用例行正则。
 */
export function countListedIntegrationTests(filter, opts = {}) {
  const { cwd = ROOT } = opts;
  // 显式 cspoj 的老调用不依赖映射文件：映射不可读时保持旧 dotnet 路径，不新增失败面。
  let map = opts.map;
  if (!map) {
    try {
      map = loadMap();
    } catch (e) {
      if (!opts.cspoj) throw e;
      map = null;
    }
  }
  const runner = mapRunner(map);
  let project = opts.cspoj || runner.project;
  if (!project) {
    const dirs = mapDirs(map);
    if (!dirs.test) {
      throw new Error('test-impact-map 缺 dirs.test（无法定位集成测试工程；在 .agents/config/test-impact-map.json 的 dirs.test 登记）');
    }
    project = projectFromDirs(dirs);
  }
  if (runner.list) {
    const [bin, ...args] = runner.list.map((a) => a
      .replaceAll('{project}', project)
      .replaceAll('{filter}', String(filter ?? '')));
    const r = spawnSync(bin, args, { cwd, encoding: 'utf8', shell: false, maxBuffer: 8 * 1024 * 1024 });
    if (r.status !== 0) {
      throw new Error(`集成用例预检失败（${bin} exit ${r.status}）：${(r.stderr || '').trim()}`);
    }
    let countRe;
    try {
      countRe = new RegExp(runner.listNamePattern || DEFAULT_LIST_NAME_PATTERN, 'gm');
    } catch (e) {
      throw new Error(`runner.listNamePattern 不是合法正则：${runner.listNamePattern}（${e.message}）`);
    }
    return ((r.stdout || '').match(countRe) || []).length;
  }
  const r = spawnSync(
    'dotnet',
    [
      'test',
      project,
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
  return (r.stdout.match(new RegExp(DEFAULT_LIST_NAME_PATTERN, 'gm')) || []).length;
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
  const dirs = mapDirs(map);
  const faces = mapFaces(map);
  const runner = mapRunner(map);
  // glob 与变更路径统一小写后匹配：map 里 glob 可能含大写，
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
    // SQL：faces.sql 声明的面（schema 变更/数据修复）会影响集成 → 全量；
    // 未声明 faces.sql 时无法判定，仍回退全量（保守）；声明面之外的 SQL 不触发。
    if (SQL_RE.test(file)) {
      if (faces.sql.length === 0 || faces.sql.some((p) => f.startsWith(p))) {
        forceFull = true;
        warnings.push(`${file} → schema/数据修复 SQL，回退全量`);
      }
      continue;
    }
    // 单测面：集成无需重跑
    if (dirs.unit && f.startsWith(dirs.unit)) continue;
    // 全链路目录默认不编译，不参与默认档
    if (dirs.fullchain && f.startsWith(dirs.fullchain)) continue;
    // 集成测试自身：只跑该文件里的测试类；测试基建无法判定则全量
    if (dirs.test && f.startsWith(dirs.test)) {
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
    // 生产代码面（faces.code）：按序首命中
    if (faces.code.some((p) => f.startsWith(p))) {
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
    // 未声明代码面：任何未知路径都可能影响集成 → 回退全量（fail-safe，不静默跳过）
    if (faces.code.length === 0) {
      forceFull = true;
      warnings.push(`${file} → 未声明 faces.code，回退全量`);
    }
    // 其余（声明面之外的文档/workflow/.agents/前端等）：不触发集成
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
  // generic 执行器没有内建 vstest 表达式：未给 filter 模板时无法安全裁剪 → 全量。
  if (runner.kind === 'generic' && !runner.filter) {
    return {
      mode: 'full',
      reason: 'generic runner 未配置 filter 模板，回退全量',
      areas: [...areas].sort(),
      classes: [...allClasses].sort(),
      filter: null,
      warnings,
      changedFiles,
      totalClasses: allClasses.size,
    };
  }
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

  const vstestFilter = sorted
    .map((cls) => `FullyQualifiedName~${map.namespace}.${cls}.`)
    .join('|');
  // generic：项目 filter 模板；{classes} = 已拼好的 FQN（| 连接）。vstest 走旧表达式逐字节不变。
  const filter = runner.kind === 'generic'
    ? runner.filter.replaceAll('{classes}', sorted.map((cls) => `${map.namespace}.${cls}`).join('|'))
    : vstestFilter;
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
