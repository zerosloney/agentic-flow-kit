// commit-check: git commit 前置验证（agentic-flow-kit 通用版）
// 1) 敏感信息扫描（暂存区新增行含疑似密钥 -> BLOCK）
// 2) 条件构建验证（按 .agents/hooks/commit-check.config.json 的 builds 配置；--full 全跑）
// 3) 质量检测（config.checks：lint / 类型检查 / vet 等秒级确定性检查；--full 全跑）
// config 由 flow-kit init 按技术栈生成初值，项目可自行增改；缺失或无 builds/checks 时跳过对应段。
// 配置示例（.agents/hooks/commit-check.config.json）：
//   {
//     "knownPatterns": ["admin\\/123", "my-project-seed"],       // 项目已知种子/代码标识符白名单（正则源，i 标志）
//     "builds": [
//       { "name": "backend",  "command": "dotnet build", "ext": [".cs", ".sln", ".csproj"] },
//       { "name": "frontend", "command": "npm run build", "ext": [".ts", ".tsx", ".vue", ".js", ".jsx"],
//         "cwd": "frontend",
//         "lockPattern": "MSB3026|MSB3027",                        // 可选：命中时按 lockHint 提示（文件锁类「与代码无关」失败）
//         "lockHint": "构建被文件锁拦下——本地运行中的进程正占用产物，停进程后重试" }
//     ],
//     "checks": [
//       { "name": "typecheck", "command": "npx tsc --noEmit", "ext": [".ts", ".tsx"], "when": ["tsconfig.json"] },
//       { "name": "lint",      "command": "npx eslint .", "ext": [".ts", ".js"], "when": ["eslint.config.js", ".eslintrc.json"] }
//     ]
//   }
// checks.when：路径数组，任一存在才启用（元素支持尾部 * 一层通配，如 "*.sln"）——
//   没有对应配置的项目自动跳过并提示，不 fail-closed 误拦；无 when 字段 = 无条件启用。
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

process.chdir(path.resolve(__dirname, '../..'));

function sh(cmd, cwd) {
  try {
    execSync(cmd, { stdio: 'pipe', encoding: 'utf8', cwd: cwd || undefined });
    return { ok: true, out: '' };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '')) };
  }
}

let staged = [];
try {
  staged = execSync('git diff --cached --name-only', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').map(s => s.trim()).filter(Boolean);
} catch (e) {
  console.log('BLOCK: 无法读取暂存区（git diff --cached 失败）');
  process.exit(1);
}

// --- 0) 项目配置（可选） ---
let config = { knownPatterns: [], builds: [] };
try {
  const raw = JSON.parse(fs.readFileSync('.agents/hooks/commit-check.config.json', 'utf8'));
  config = { ...config, ...raw };
} catch (e) { /* 无配置 = 敏感扫描用基线白名单 + 跳过构建验证 */ }

// --- 1) 敏感信息扫描：暂存区新增行是否含疑似密钥（只认带引号的字符串字面量；排除类型/空值关键字） ---
const SECRET = /(password|passwd|pwd|secret|token|apikey|api[_ -]?key|connectionstring|server=|bearer)["']?\s*[:=]\s*["'](?!["']?(string|number|boolean|unknown|any|never|void|object|null|undefined|true|false)\b)[^"'\r\n]{6,}["']/i;
// 判据/白名单自身的定义行长得就像密钥赋值，须自豁免
const SELF = /const (SECRET|KNOWN) = \//i;
// KNOWN：项目已知种子与代码标识符白名单（config.knownPatterns 注入；本文件基线为空——通用包不带项目种子）
let KNOWN = null;
if (Array.isArray(config.knownPatterns) && config.knownPatterns.length) {
  KNOWN = new RegExp(config.knownPatterns.join('|'), 'i');
}
let diffText = '';
try {
  diffText = execSync('git diff --cached', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) { /* 空暂存 */ }
const added = diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
const hits = added.filter(l => SECRET.test(l) && !(KNOWN && KNOWN.test(l)) && !SELF.test(l));
if (hits.length) {
  console.log('BLOCK: 暂存区疑似包含敏感信息（密钥/连接串/令牌），请检查:\n' + hits.slice(0, 5).join('\n'));
  process.exit(1);
}

// --- 2) 条件构建验证 ---
// --full：合并提交（pre-merge-commit / 冲突解决后手动 commit）使用——合并结果是没人验证过的新状态，
// 按 ext/prefix 裁剪可能漏掉需要重跑的一侧，故不做条件选择、全部 builds 都跑。
// 引擎自身文件（.agents/、.githooks/）不参与构建匹配——工作流引擎不是项目构建产物。
const FULL = process.argv.includes('--full');
const stagedForBuild = staged.filter(f => !f.startsWith('.agents/') && !f.startsWith('.githooks/'));
let ranAny = false;
for (const b of (config.builds || [])) {
  if (!b || !b.command) continue;
  const exts = Array.isArray(b.ext) ? b.ext : [];
  const match = FULL || stagedForBuild.some(f => exts.some(e => f.endsWith(e)) || (b.prefix ? f.startsWith(b.prefix) : false));
  if (!match) continue;
  ranAny = true;
  const r = sh(b.command, b.cwd);
  if (!r.ok) {
    if (b.lockPattern && new RegExp(b.lockPattern).test(r.out)) {
      console.log(`BLOCK: ${b.name} 构建被文件锁拦下（与代码无关）。${b.lockHint || '停掉占用进程后原路重试'}\n` +
        '锁冲突行：\n' + r.out.split(/\r?\n/).filter(l => new RegExp(b.lockPattern).test(l)).slice(0, 3).join('\n'));
    } else {
      console.log(`BLOCK: ${b.name} 构建失败（${b.command}）\n` + r.out.slice(0, 1500));
    }
    process.exit(1);
  }
  console.log(`OK: ${b.name} 构建通过（${b.command}）`);
}
if (!ranAny) {
  console.log(config.builds && config.builds.length
    ? 'SKIP: 无匹配的源码变更，跳过构建验证'
    : 'SKIP: 未配置 builds（.agents/hooks/commit-check.config.json），跳过构建验证');
}

// --- 3) 质量检测（checks：lint / 类型检查 / vet 等秒级确定性检查；测试不放这里——关单在 test.md 阶段门） ---
// whenSatisfied：任一路径存在即启用；元素支持尾部 * 一层通配（如 *.sln = 仓库根存在 .sln 结尾文件）
function whenSatisfied(when) {
  if (!when) return true;
  const list = Array.isArray(when) ? when : [when];
  return list.some((w) => {
    const star = w.indexOf('*');
    if (star < 0) return fs.existsSync(w);
    const suffix = w.slice(star + 1);
    const dir = path.dirname(w.slice(0, star)) || '.';
    try { return fs.readdirSync(dir).some((f) => f.endsWith(suffix)); } catch (e) { return false; }
  });
}
let ranCheck = false;
for (const c of (config.checks || [])) {
  if (!c || !c.command) continue;
  const exts = Array.isArray(c.ext) ? c.ext : [];
  const match = FULL || stagedForBuild.some(f => exts.some(e => f.endsWith(e)) || (c.prefix ? f.startsWith(c.prefix) : false));
  if (!match) continue;
  ranCheck = true;
  if (!whenSatisfied(c.when)) {
    console.log(`SKIP: ${c.name}（未找到 ${Array.isArray(c.when) ? c.when.join(' / ') : c.when}，跳过质量检查——配置好后自动启用）`);
    continue;
  }
  const r = sh(c.command, c.cwd);
  if (!r.ok) {
    console.log(`BLOCK: ${c.name} 质量检查未通过（${c.command}）\n` + r.out.slice(0, 1200));
    process.exit(1);
  }
  console.log(`OK: ${c.name} 质量检查通过（${c.command}）`);
}
if (!ranCheck && config.checks && config.checks.length) {
  console.log('SKIP: 无匹配的源码变更，跳过质量检测');
}

console.log('COMMIT_CHECK_OK');
