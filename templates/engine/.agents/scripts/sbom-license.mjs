#!/usr/bin/env node
// sbom-license：SBOM 生成 + 许可证策略检查（R3-8 供应链第二片；零依赖零网络）。
// 动机：R3-8「沙箱与供应链」——密钥扫描门（check-secrets）管「带进来的秘密」，
//   本门管「带进来的依赖」：项目用了哪些第三方包、什么版本、什么许可证，违规即红。
// 数据源 = lockfile（package-lock.json v2/v3 锁定树；npm ls --json 兜底），不联网。
//   锁文件缺失时**不猜**：直接退出 2（fail-closed），避免「没装依赖 = 绿行」的假担保。
// SBOM 输出：SPDX 2.3 JSON（spdx.json）——documentDescribes 根包、packages 数组带
//   licenseConcluded / checksums（sha256 取自 lockfile integrity，base64→hex 转写）。
// 许可证策略：.agents/config/license-policy.json（schema schemas/license-policy.schema.json）：
//   {
//     "version": 1,
//     "allow": ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0", "Unlicense", "Python-2.0"],
//     "deny": ["AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later", "SSPL-1.0", "GPL-3.0", "GPL-2.0", "EPL-1.0"],
//     "exceptions": { "<pkg>@<version>": "理由：评审记录/工单链接" },
//     "unknownAction": "deny"   // deny = 未知/缺声明按违规；warn = 只告警（仍非零退出由 failOn 控制）
//     "failOn": "deny"          // deny = 只有 deny/未知(unknownAction=deny) 非零；any = warn 也非零
//   }
// allow/deny 都支持 SPDX 表达式片段（如 "MIT OR Apache-2.0"）：按 OR 拆分后逐项判定，
//   任一分支命中 allow 且无分支命中 deny → 允许。
// 退出码：0 无违规；1 发现违规；2 配置/lockfile 失守。
// 用法：flow-kit run sbom-license.mjs [--check | --report <dir>] [--json]
//   缺省     = 生成 SBOM 到 .agents/sbom/spdx.json + 许可证检查
//   --check  = 只读：SBOM 与磁盘一致 + 许可证检查都过才 0（CI / verify 门用）
//   --report = SBOM 另写一份到指定目录（artifact 归档），主判定不变
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.FLOW_KIT_PROJECT_ROOT || path.join(SCRIPT_DIR, '..', '..'));
const POLICY_REL = '.agents/config/license-policy.json';
const SBOM_DIR = '.agents/sbom';
const SBOM_REL = `${SBOM_DIR}/spdx.json`;

const DEFAULT_POLICY = {
  version: 1,
  allow: ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0', 'Unlicense', 'Python-2.0'],
  deny: ['AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0', 'EPL-1.0'],
  exceptions: {},
  unknownAction: 'deny',
  failOn: 'deny',
};

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const jsonOut = args.includes('--json');
const reportIndex = args.indexOf('--report');
const reportDir = reportIndex >= 0 && args[reportIndex + 1] ? path.resolve(ROOT, args[reportIndex + 1]) : null;
const knownArgs = new Set(['--check', '--json', '--report']);
const unknownArgs = args.filter((a, i) => !knownArgs.has(a) && !(a === reportDir && i === reportIndex + 1 && reportDir) && args[i - 1] !== '--report');
if (reportIndex >= 0 && !reportDir) {
  console.error('sbom-license: --report 需要一个目录参数');
  process.exit(2);
}
if (unknownArgs.length) {
  console.error(`sbom-license: 未知参数：${unknownArgs.join(' ')}（用法：flow-kit run sbom-license.mjs [--check] [--report <dir>] [--json]）`);
  process.exit(2);
}

function readJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

function loadPolicy() {
  const raw = readJson(path.join(ROOT, POLICY_REL));
  if (raw == null) return { ...DEFAULT_POLICY, exceptions: {} };
  if (raw.version !== 1) {
    console.error(`sbom-license: ${POLICY_REL} version 必须为 1`);
    process.exit(2);
  }
  const policy = {
    ...DEFAULT_POLICY,
    ...raw,
    allow: Array.isArray(raw.allow) ? raw.allow.map(String) : DEFAULT_POLICY.allow,
    deny: Array.isArray(raw.deny) ? raw.deny.map(String) : DEFAULT_POLICY.deny,
    exceptions: raw.exceptions && typeof raw.exceptions === 'object' && !Array.isArray(raw.exceptions)
      ? Object.fromEntries(Object.entries(raw.exceptions).map(([k, v]) => [String(k), String(v)]))
      : {},
    unknownAction: raw.unknownAction === 'warn' ? 'warn' : 'deny',
    failOn: raw.failOn === 'any' ? 'any' : 'deny',
  };
  return policy;
}

// lockfile → [{ name, version, license, integrity }]
export function packagesFromLockfile(lock) {
  const out = new Map();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [name, info] of Object.entries(node.dependencies || {})) {
      if (!info || typeof info !== 'object') continue;
      // lockfile v1：依赖树嵌套（name 在 key 上）；v2/v3：packages 映射（name 在 node_modules/<name> key 上）。
      const version = info.version || (info.requires && info.requires.version) || '';
      if (version && !out.has(`${name}@${version}`)) {
        out.set(`${name}@${version}`, {
          name,
          version: String(version),
          license: info.license != null ? String(info.license) : null,
          integrity: info.integrity != null ? String(info.integrity) : null,
          dev: Boolean(info.dev),
        });
      }
      visit(info);
    }
  };
  visit(lock);
  // v2/v3：packages["node_modules/<name>"] 平铺条目
  for (const [key, info] of Object.entries(lock?.packages || {})) {
    const match = /^node_modules\/(.+)$/.exec(key);
    if (!match || !info || typeof info !== 'object' || !info.version) continue;
    const name = match[1];
    if (out.has(`${name}@${info.version}`)) continue;
    out.set(`${name}@${info.version}`, {
      name,
      version: String(info.version),
      license: info.license != null ? String(info.license) : null,
      integrity: info.integrity != null ? String(info.integrity) : null,
      dev: Boolean(info.dev),
    });
  }
  return [...out.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

// npm ls --json 兜底：lockfile 缺失但 node_modules 已安装时仍可出 SBOM（CI 装完才跑门的场景）。
export function packagesFromNpmLs(tree) {
  const out = new Map();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [name, info] of Object.entries(node.dependencies || {})) {
      if (info && typeof info === 'object' && info.version && !out.has(`${name}@${info.version}`)) {
        out.set(`${name}@${info.version}`, {
          name,
          version: String(info.version),
          license: info.license != null ? String(info.license) : null,
          integrity: null,
          dev: Boolean(info.dev),
        });
      }
      visit(info);
    }
  };
  visit(tree);
  return [...out.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

// SPDX 表达式片段级判定。语序约定与 npm 生态一致：(A OR B) AND C、A AND (B OR C)；
// 先按顶层 OR 拆分支，AND 内逐项判。剥括号会把 AND(A, OR(B,C)) 错展开成 OR(AND(A,B), C)，
// 因此 AND 分支里出现 OR 时按「存在未知项」保守处理（unknown 而非误放行）。
function splitExpression(expr) {
  return String(expr)
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .map((part) => part.split(/\s+AND\s+/i).map((p) => p.trim()).filter(Boolean))
    .filter((branch) => branch.length);
}

function idMatches(list, id) {
  return list.some((entry) => entry === id || entry === `${id}-only` || entry === `${id}-or-later`
    || id === entry || id === `${entry}-only` || id === `${entry}-or-later`);
}

// 判定单个包：返回 'allow' | 'deny' | 'unknown'
export function judgeLicense(pkg, policy) {
  const exceptionKey = Object.keys(policy.exceptions).find((key) => {
    const at = key.indexOf('@');
    if (at <= 0) return key === pkg.name;
    const [name, version] = [key.slice(0, at), key.slice(at + 1)];
    return name === pkg.name && (version === '*' || version === pkg.version);
  });
  if (exceptionKey) return 'allow';
  if (!pkg.license || pkg.license === 'UNKNOWN' || pkg.license === 'UNLICENSED') return 'unknown';
  const branches = splitExpression(pkg.license);
  // AND 分支里只要有一项不在 allow 闭集，整分支不放行；deny 命中任一项即拒绝（deny 优先于 allow）。
  // AND 与 OR 混用（如 MIT AND (X OR ISC)）无法用剥括号的平铺分支可靠判定——探测到混用即保守降级
  // unknown，不误放行也不误拒（该形态在 npm 依赖声明里罕见，保守是对的）。
  const hasAnd = /\sAND\s/i.test(pkg.license);
  const hasOr = /\sOR\s/i.test(pkg.license);
  const conservative = hasAnd && hasOr;
  const anyDeny = branches.some((branch) => branch.some((id) => idMatches(policy.deny, id)));
  const anyAllow = !conservative && branches.some((branch) => branch.every((id) => idMatches(policy.allow, id)));
  if (anyDeny) return 'deny';
  if (anyAllow) return 'allow';
  return 'unknown';
}

function integrityToChecksum(integrity) {
  const match = /^(sha256|sha512)-([A-Za-z0-9+/=]+)$/.exec(String(integrity || ''));
  if (!match) return null;
  const hex = Buffer.from(match[2], 'base64').toString('hex');
  return { algorithm: match[1] === 'sha256' ? 'SHA256' : 'SHA512', checksumValue: hex };
}

export function buildSpdx({ rootName, rootVersion, packages, generatedAt }) {
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: rootName,
    documentNamespace: `https://spdx.org/spdxdocs/${rootName}-${createHash('sha256').update(`${rootName}@${rootVersion}`).digest('hex').slice(0, 12)}`,
    creationInfo: {
      created: generatedAt,
      creators: ['Tool: agentic-flow-kit'],
      licenseListVersion: '3.25',
    },
    documentDescribes: ['SPDXRef-Root'],
    packages: [
      {
        SPDXID: 'SPDXRef-Root',
        name: rootName,
        versionInfo: rootVersion,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: 'NOASSERTION',
        copyrightText: 'NOASSERTION',
      },
      ...packages.map((pkg) => ({
        SPDXID: `SPDXRef-Package-${(createHash('sha256').update(`${pkg.name}@${pkg.version}`).digest('hex').slice(0, 12))}`,
        name: pkg.name,
        versionInfo: pkg.version,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: pkg.license || 'NOASSERTION',
        checksums: (() => { const c = integrityToChecksum(pkg.integrity); return c ? [c] : undefined; })(),
        copyrightText: 'NOASSERTION',
      })),
    ],
    relationships: [
      { spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: 'SPDXRef-Root' },
      ...packages.map((pkg) => ({
        spdxElementId: 'SPDXRef-Root',
        relationshipType: 'DEPENDS_ON',
        relatedSpdxElement: `SPDXRef-Package-${(createHash('sha256').update(`${pkg.name}@${pkg.version}`).digest('hex').slice(0, 12))}`,
      })),
    ],
  };
}

function collectPackages() {
  const lock = readJson(path.join(ROOT, 'package-lock.json'));
  if (lock) return { source: 'package-lock.json', packages: packagesFromLockfile(lock) };
  // lockfile 缺失时才尝试 npm ls（只读子进程、失败不致命）
  const r = spawnSync('npm', ['ls', '--json', '--all'], { cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (r.status === 0 && r.stdout) {
    try {
      const tree = JSON.parse(r.stdout);
      const packages = packagesFromNpmLs(tree);
      if (packages.length) return { source: 'npm ls', packages };
    } catch { /* fallthrough */ }
  }
  return { source: null, packages: [] };
}

function main() {
  const pkg = readJson(path.join(ROOT, 'package.json')) || {};
  const rootName = String(pkg.name || 'unnamed-project');
  const rootVersion = String(pkg.version || '0.0.0');
  const { source, packages } = collectPackages();
  if (!source || !packages.length) {
    console.error('sbom-license: 找不到 package-lock.json 且 npm ls 无结果——无依赖清单可审计（fail-closed）。');
    console.error('  修法：在项目根执行 npm install 生成 lockfile 后重跑；本门不猜测未锁定的依赖。');
    process.exit(2);
  }

  const policy = loadPolicy();
  const violations = [];
  const warnings = [];
  for (const dep of packages) {
    const verdict = judgeLicense(dep, policy);
    if (verdict === 'deny') violations.push({ ...dep, license: dep.license, verdict });
    else if (verdict === 'unknown') {
      if (policy.unknownAction === 'deny') violations.push({ ...dep, license: dep.license || 'NOASSERTION', verdict });
      else warnings.push({ ...dep, license: dep.license || 'NOASSERTION', verdict });
    }
  }
  const failHard = policy.failOn === 'any' ? violations.length + warnings.length > 0 : violations.length > 0;

  // SBOM 的 created 取 lockfile 的 mtime（ISO）而不是 now：同一 lockfile 重复生成必须逐字节一致，
  // 否则 --check 永远漂移。mtime 不可得时回落 Unix 纪元（同样确定）。
  const lockStat = source === 'package-lock.json' ? fs.statSync(path.join(ROOT, 'package-lock.json')) : null;
  const generatedAt = (lockStat ? lockStat.mtime : new Date(0)).toISOString();
  const spdx = buildSpdx({ rootName, rootVersion, packages, generatedAt });
  const sbomAbs = path.join(ROOT, SBOM_REL);
  const sbomText = `${JSON.stringify(spdx, null, 2)}\n`;
  if (!CHECK) {
    fs.mkdirSync(path.join(ROOT, SBOM_DIR), { recursive: true });
    fs.writeFileSync(sbomAbs, sbomText, 'utf8');
  }
  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'spdx.json'), sbomText, 'utf8');
  }

  const sbomDrift = CHECK && fs.existsSync(sbomAbs) ? fs.readFileSync(sbomAbs, 'utf8') !== sbomText : false;
  const summary = {
    ok: !failHard && !sbomDrift,
    source,
    packages: packages.length,
    sbomPath: SBOM_REL,
    sbomDrift,
    violations,
    warnings,
    policy: { allow: policy.allow.length, deny: policy.deny.length, exceptions: Object.keys(policy.exceptions).length, unknownAction: policy.unknownAction, failOn: policy.failOn },
  };

  if (jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[sbom-license] 数据源=${source}；依赖 ${packages.length} 个；SBOM → ${SBOM_REL}${CHECK ? '（--check 只读）' : ''}`);
    if (violations.length) {
      console.error(`[sbom-license] ❌ 许可证违规 ${violations.length} 个：`);
      for (const v of violations) console.error(`  · ${v.name}@${v.version} — ${v.license}（${v.verdict}）`);
      console.error(`[sbom-license] 策略：${POLICY_REL}；豁免用 exceptions（写明理由）。`);
    }
    if (warnings.length) {
      console.error(`[sbom-license] ⚠ 许可证未知 ${warnings.length} 个（unknownAction=warn 只告警）：`);
      for (const w of warnings) console.error(`  · ${w.name}@${w.version} — ${w.license}`);
    }
    if (sbomDrift) console.error(`[sbom-license] ❌ ${SBOM_REL} 与当前 lockfile 不一致（重跑 flow-kit run sbom-license.mjs 刷新）。`);
    if (summary.ok) console.log('[sbom-license] ✅ 许可证策略通过');
  }
  process.exit(summary.ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
