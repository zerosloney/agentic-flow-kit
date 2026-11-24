#!/usr/bin/env node
/**
 * check-schema-residue.mjs — 「已删列/新增列 vs 实库」残留审计（只读，手动工具，不接门禁）
 *
 * 用途：批次（--base 目录，默认 wiki/数据维护/schema变更）登记的列变更与实库比对，
 *       找出「批次已删却仍在」（残留＝带外加列/批次语句静默失效）
 *       与「批次已加却不存在」（缺失＝带外删列）两类漂移。
 *
 * 口径：
 *   - 取各批次 `0N-*.sql` 中**动作类**脚本：排除 `99-*`（回滚）、`*rollback*`（语义反转）、`*verify*`（核验脚本非动作）；
 *   - 逐条 `ALTER TABLE` 语句内扫描 `ADD [COLUMN]` / `DROP [COLUMN]` 的**多列清单**（顶层逗号切分；跳过 CONSTRAINT/PRIMARY/UNIQUE/… 等约束子句）；
 *   - 同（表,列）以批次目录名排序取**最后一次**动作；
 *   - `ADD` 后缺失 → 缺失；`DROP` 后仍存在 → 残留；
 *   - `LINENO` 一类 T-SQL 关键字与列名同名会让 `DROP COLUMN` 静默不生效——本脚本可一次扫出该类。
 *
 * 已知盲区（人工兜底，勿当全量证明）：
 *   - 动态 SQL（`EXEC(N'ALTER TABLE … DROP COLUMN …')`）解析不可见；
 *   - `sp_rename` 改列名解析不可见（只见旧 ADD，按缺失报）；
 *   - 同目录内名为 `0N-rollback-*.sql` 的回滚脚本按文件名排除（其语义为撤销 01，判定会反转）。
 *
 * 豁免（--exempt <JSON>）：数组，每项 { "table", "column", "direction": "missing"|"residue", "reason" }，
 *   **带方向**的已判定项——只在登记的该方向上豁免，反方向仍照常报警：
 *   - direction 'missing'：批次已加但实库不存在，且已人工核实为台账侧过时（如更晚批次已删）；
 *   - direction 'residue'：批次已删但实库仍在，且已人工核实为实体确实声明该列（台账注释过时）。
 *   豁免清单与连接配置同属被扫项目自己的数据，不随本脚本分发。
 *
 * 依赖：sqlcmd（未设 SQLCMD_BIN 时取 PATH 上的；测试注缝：SQLCMD_BIN 指定替身——.mjs/.js 结尾经本进程
 *   node 直跑、其余按可执行文件直跑，与 check-secrets.mjs 的 GITLEAKS_BIN 约定一致）。
 * 连接（优先级从高到低）：--conn <ADO.NET 连接串> → 环境变量 SCHEMA_RESIDUE_CONN
 *   → --appsettings <JSON 文件路径> [--key <键名>]（默认 DBConnParameter）。
 * 用法：flow-kit run check-schema-residue.mjs [--base <批次目录>] [--conn <连接串> | SCHEMA_RESIDUE_CONN | --appsettings <json> [--key <键>]] [--exempt <json>] [--verbose] [--dump <正则>]
 * 退出码：0 = 无未解释残留/缺失；1 = 有；2 = 前置缺失（连接来源 / 批次目录 / 豁免文件）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { t as tr } from './lang.mjs';

const root = process.cwd();
const opt = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const base = path.resolve(root, opt('--base') ?? path.join('wiki', '数据维护', 'schema变更'));
const verbose = process.argv.includes('--verbose');
const SKIP = new Set(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'INDEX', 'CHECK', 'FOREIGN', 'NONCLUSTERED', 'CLUSTERED', 'KEY', 'COLUMN', 'ADD', 'DROP']);

// 连接串三来源按优先级取一个；三者皆缺 → stderr 说明用法后前置缺失退出
const appsettingsArg = opt('--appsettings');
let conn = opt('--conn') ?? process.env.SCHEMA_RESIDUE_CONN;
if (!conn && appsettingsArg) {
  const file = path.resolve(root, appsettingsArg);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(tr(`[schema-residue] ❌ appsettings 读不了或非合法 JSON：${file}`, `[schema-residue] ❌ appsettings unreadable or not valid JSON: ${file}`));
    process.exit(2);
  }
  const key = opt('--key') ?? 'DBConnParameter';
  conn = json[key];
  if (!conn) {
    console.error(tr(`[schema-residue] ❌ ${file} 缺键 ${key}（--key 可指定，默认 DBConnParameter）`, `[schema-residue] ❌ ${file} is missing key ${key} (override with --key; default DBConnParameter)`));
    process.exit(2);
  }
}
if (!conn) {
  console.error(tr('[schema-residue] ❌ 未提供数据库连接。三种方式（优先级从高到低）：', '[schema-residue] ❌ no database connection provided. Three ways (highest priority first):'));
  console.error(tr('  1) --conn <ADO.NET 连接串>', '  1) --conn <ADO.NET connection string>'));
  console.error(tr('  2) 环境变量 SCHEMA_RESIDUE_CONN', '  2) environment variable SCHEMA_RESIDUE_CONN'));
  console.error(tr('  3) --appsettings <JSON 文件路径> [--key <键名>]（默认 DBConnParameter）', '  3) --appsettings <JSON file path> [--key <key name>] (default DBConnParameter)'));
  process.exit(2);
}

// 豁免清单：带方向的已判定项（人工核过，只在登记方向上豁免）；不传则没有豁免
const exemptFile = opt('--exempt');
const EXEMPT = new Map();
if (exemptFile) {
  const file = path.resolve(root, exemptFile);
  let list;
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(tr(`[schema-residue] ❌ 豁免文件读不了或非合法 JSON：${file}`, `[schema-residue] ❌ exempt file unreadable or not valid JSON: ${file}`));
    process.exit(2);
  }
  if (!Array.isArray(list)) {
    console.error(tr(`[schema-residue] ❌ 豁免文件须为 JSON 数组：${file}`, `[schema-residue] ❌ exempt file must be a JSON array: ${file}`));
    process.exit(2);
  }
  for (const [i, e] of list.entries()) {
    const ok = e && typeof e === 'object' && e.table && e.column && e.reason && ['missing', 'residue'].includes(e.direction);
    if (!ok) {
      console.error(tr(`[schema-residue] ❌ 豁免清单第 ${i + 1} 项非法（需 { "table", "column", "direction": "missing"|"residue", "reason" }）：${JSON.stringify(e)}`, `[schema-residue] ❌ exemption entry ${i + 1} is invalid (expected { "table", "column", "direction": "missing"|"residue", "reason" }): ${JSON.stringify(e)}`));
      process.exit(2);
    }
    EXEMPT.set(`${e.table}.${e.column}`, { direction: e.direction, reason: e.reason });
  }
}

// 批次目录缺失此前会直接抛未捕获异常；统一收敛为 stderr + exit 2 的前置缺失口径
if (!fs.statSync(base, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(tr(`[schema-residue] ❌ 批次目录不存在：${base}（--base 可指定，默认 wiki/数据维护/schema变更）`, `[schema-residue] ❌ batch directory not found: ${base} (override with --base; default wiki/数据维护/schema变更)`));
  process.exit(2);
}

const pick = (k) => (conn.match(new RegExp(`(?:^|;)\\s*${k}\\s*=\\s*([^;]+)`, 'i')) || [])[1];
const sqlcmdArgs = ['-S', pick('Server'), '-d', pick('Database'), '-U', pick('User Id'), '-P', pick('Password'), '-h', '-1', '-W', '-f', '65001'];

// sqlcmd 替身注缝（测试）：SQLCMD_BIN 以 .mjs/.js 结尾经本进程 node 直跑，否则按可执行文件直跑；未设置用 PATH 上的 sqlcmd
const seam = process.env.SQLCMD_BIN;
const seamIsNodeScript = !!seam && /\.(mjs|js)$/i.test(seam);
const sqlcmd = (query) => execFileSync(
  seamIsNodeScript ? process.execPath : (seam || 'sqlcmd'),
  [...(seamIsNodeScript ? [seam] : []), ...sqlcmdArgs, '-Q', query],
  { encoding: 'utf8' },
);

/** 顶层逗号切分（忽略括号内逗号） */
function splitTopLevel(text) {
  const parts = []; let depth = 0; let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** 取一条 ALTER 语句体里的目标列标识符（多列清单 + 跳过约束子句） */
function targetsOf(body) {
  const out = [];
  for (const m of body.matchAll(/\b(ADD|DROP)\s+(?:COLUMN\s+)?/gi)) {
    const tail = body.slice(m.index + m[0].length);
    for (const seg of splitTopLevel(tail)) {
      const cleaned = seg.replace(/^\s*COLUMN\s+/i, '');   // `ADD COLUMN a INT, COLUMN b INT` 的第二段
      const id = /^\s*\[?(\w+)\]?/.exec(cleaned);
      if (!id) continue;
      const name = id[1];
      if (SKIP.has(name.toUpperCase())) continue;
      out.push({ action: m[1].toUpperCase(), name });
    }
  }
  return out;
}

// 1) 解析批次登记动作（表 | 列 → 最后动作）
const acts = new Map();
const isActionFile = (x) => /^0\d-.*\.sql$/i.test(x) && !/^99-/.test(x) && !/rollback/i.test(x) && !/verify/i.test(x);
for (const d of fs.readdirSync(base, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
  for (const f of fs.readdirSync(path.join(base, d)).filter(isActionFile).sort()) {
    const raw = fs.readFileSync(path.join(base, d, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split(/\r?\n/).map((l) => l.replace(/--.*$/, '')).join('\n');
    // 语句体边界：分号 **或** 下一条 ALTER TABLE 起（防「无分号 + GO」写法把列记到前一张表名下）
    for (const m of raw.matchAll(/ALTER\s+TABLE\s+(?:\[?dbo\]?\.)?\[?(\w+)\]?\s+([\s\S]*?)(?=;|\bALTER\s+TABLE\b|$)/gi)) {
      const [, table, body] = m;
      for (const { action, name } of targetsOf(body)) {
        const key = `${table}|${name}`;
        const cur = acts.get(key);
        if (!cur || d >= cur.order) acts.set(key, { order: d, action, src: `${d}/${f}` });
      }
    }
  }
}

// 2) 与实库比对
const exists = (t, c) => sqlcmd(`SET NOCOUNT ON; SELECT CASE WHEN EXISTS(SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.${t}') AND name='${c}') THEN 'Y' ELSE 'N' END;`).split(/\r?\n/)[0].trim() === 'Y';
const residue = []; const missing = []; const exempted = [];
for (const [key, v] of acts) {
  const [t, c] = key.split('|');
  if (!/^[A-Za-z_]\w*$/.test(t) || !/^[A-Za-z_]\w*$/.test(c)) continue;
  const dir = v.action === 'ADD' ? 'missing' : 'residue';
  const bad = dir === 'missing' ? !exists(t, c) : exists(t, c);
  if (!bad) continue;
  const ex = EXEMPT.get(`${t}.${c}`);
  if (ex && ex.direction === dir) exempted.push([`${t}.${c}`, dir, ex.reason]);
  else (dir === 'missing' ? missing : residue).push([t, c, v.src]);
}

console.log(tr(`[schema-residue] 扫描批次动作 ${acts.size} 项（${base}；排除 99-rollback / *rollback* / *verify*）`, `[schema-residue] scanned ${acts.size} batch actions (${base}; excluding 99-rollback / *rollback* / *verify*)`));
console.log(tr(`[schema-residue] 残留（批次已删仍存在）${residue.length} 项 / 缺失（批次已加不存在）${missing.length} 项 / 已豁免 ${exempted.length} 项（按方向）`, `[schema-residue] residue (dropped by batch, still present) ${residue.length} / missing (added by batch, absent) ${missing.length} / exempted ${exempted.length} (per direction)`));
for (const [t, c, s] of residue) console.log(tr(`  ⚠ 残留 ${t}.${c}  ← ${s}`, `  ⚠ residue ${t}.${c}  ← ${s}`));
for (const [t, c, s] of missing) console.log(tr(`  ⚠ 缺失 ${t}.${c}  ← ${s}`, `  ⚠ missing ${t}.${c}  ← ${s}`));
if (process.argv.includes('--dump')) {
  const filter = process.argv[process.argv.indexOf('--dump') + 1];
  const re = new RegExp(filter ?? '.', 'i');
  console.log(tr(`[schema-residue] --dump ${filter ?? '.'} 命中：`, `[schema-residue] --dump ${filter ?? '.'} matches:`));
  for (const [k, v] of acts) if (re.test(k)) console.log(`  · ${k} ${v.action} ← ${v.src}`);
}
if (verbose) {
  console.log(tr('[schema-residue] 豁免明细（带方向；反方向仍会报警）：', '[schema-residue] exemption details (directional; the opposite direction still reports):'));
  for (const [k, dir, reason] of exempted) console.log(`  · [${dir}] ${k} — ${reason}`);
}
process.exit(residue.length || missing.length ? 1 : 0);
