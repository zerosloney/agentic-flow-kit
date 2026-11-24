// commit-check: git commit 前置验证（本仓自有维护——decouple-flow-kit 起，原 agentic-flow-kit 通用版）
// 1) 条件构建验证（按 .agents/hooks/commit-check.config.json 的 builds 配置；--full 不做 ext/prefix 裁剪，仍尊重 when）
// 2) 质量检测（config.checks：lint / 类型检查 / vet 等秒级确定性检查；--full 不做 ext/prefix 裁剪，仍尊重 when）
// 3) 推送前测试（config.pushTests：仅 --range 推送范围模式执行——pre-push 专段，提交/合并路径不跑）
// （敏感信息扫描段已退役——2026-10-21 owner 指令「密钥本地不扫」：本地双腿（本段正则 + pre-commit gitleaks
//   protect 门）同批撤除，误报 papercut ×4 消债；执法收敛 verify 安全段 secrets-scan 关单/CI）
// 旗标（2026-10-15 构建门后移 pre-push）：
//   --no-build：跳过段 1 条件构建——pre-commit 常规提交用（提交内环提速）；构建在 pre-push 按推送范围
//               执法，合并提交仍走 --full 全量构建（合并结果是没人验证过的新状态）。
//   --range <old> <new>：推送范围模式（pre-push 用）——文件面取 git diff --name-only old new；
//               old 为全零 sha（新分支首推）= 全量匹配语义（等价 --full 的构建面）。默认（无旗标）暂存区模式行为不变。
//               pushTests 仅在此模式下执行（推送前测试的执法点在 pre-push，提交内环不跑）。
// config（.agents/hooks/commit-check.config.json）为本仓自有件（engine 面豁免三件套）；缺失或无 builds/checks 时跳过对应段。
// 配置示例（.agents/hooks/commit-check.config.json）：
//   {
//     "builds": [
//       { "name": "backend",  "command": "dotnet build", "ext": [".cs", ".sln", ".csproj"] },
//       { "name": "frontend", "command": "npm run build", "ext": [".ts", ".tsx", ".vue", ".js", ".jsx"],
//         "cwd": "frontend",
//         "lockPattern": "MSB3026|MSB3027",                        // 可选：命中时按 lockHint 提示（文件锁类「与代码无关」失败）
//         "lockHint": "构建被文件锁拦下——本地运行中的进程正占用产物，停进程后重试" },
//       { "name": "docs-site", "command": "npm run build", "prefix": "docs/", "cwd": "docs" }   // prefix 可选：路径前缀触发
//     ],
//     "checks": [
//       { "name": "typecheck", "command": "npx tsc --noEmit", "ext": [".ts", ".tsx"], "when": ["tsconfig.json"] },
//       { "name": "lint",      "command": "npx eslint .", "ext": [".ts", ".js"], "when": ["eslint.config.js", ".eslintrc.json"] }
//     ],
//     "pushTests": [                                                     // 推送前测试：仅 --range 模式（pre-push）执行
//       { "name": "backend-tests", "command": "node scripts/run-backend-tests.mjs --range {old} {new}",
//         "prefix": ["backend/", "tests/", "scripts/verify/backend/"],   // prefix 可为字符串或字符串数组（任一命中即触发）
//         "when": ["scripts/run-backend-tests.mjs"],                     // 脚本存在才启用——没有对应脚本的项目自动 SKIP 不误拦
//         "whenEnv": "RUN_PUSH_TESTS=1",                                 // 可选：环境开关，仅取值相等才启用（不满足不执行不打印）
//         "timeoutMs": 600000 }                                          // 可选：单条墙钟上限（毫秒；缺省用全局上限）
//     ]
//   }
// builds/checks 触发判定（对暂存文件；builds 不计 .agents/ 与 .githooks/ 自身变更，checks 不计 .githooks/——引擎脚本变更照跑秒级检查）：`ext 任一匹配 OR prefix 前缀命中`。
//   - 只有 ext：按扩展名全局触发（跨目录，适合语言型触发——仓库里该扩展名基本只属于该构建）；
//   - 只有 prefix：该前缀下任何文件触发（目录型触发——如 monorepo 子包，仓库其他位置的相同扩展名不触发）；
//   - 两者同配为 OR 并集而非 AND 交集——要「前缀内的特定扩展名」请只配 prefix（目录内文档变更多跑一次构建，方向安全）。
// when（builds、checks 与 pushTests 共用）：数组任一满足才启用，无 when 字段 = 无条件启用。
//   - 路径或尾部 * 一层通配（如 "*.sln"）：相对仓库根做存在性判断；
//   - pkg:<点分路径>（如 pkg:scripts.build）：读该项 cwd（缺省仓库根）的 package.json，
//     沿路径取值，非空字符串才算满足。
//   没有对应配置的项目自动跳过并提示，不 fail-closed 误拦。--full 同样尊重 when。
// pushTests 触发与执行口径（仅 --range 模式）：文件面同 builds（不计 .agents/ 与 .githooks/ 自身变更），
//   ext 任一命中或 prefix 任一前缀命中（prefix 支持字符串数组——真实触发面常跨多个目录，单字符串
//   得配多条重复命令）。command 中的 {old} / {new} 替换为 --range 已校验的两个 sha。
//   whenEnv 是环境开关门槛而非能力缺失——不满足不执行也不打印（与 when 的 SKIP 提示区分开）。
//   失败即 BLOCK exit 1；范围无命中打一行 SKIP；未配置 pushTests 时本段完全不产生输出。
// 条件构建执行器（2026-10-07 L31：execSync → spawnSync + 显式 timeout）
// 症状：托管 Node 22 下 execSync('cd frontend && npm run build') **永不返回**——
//   vite 8 / rolldown 在 Windows 泄漏 stdout 管道句柄，构建产物实际已写完，但父进程
//   的读端等不到 EOF → pre-commit 永久挂起，任何含 frontend/ 的提交都卡死
//   （实测换系统 Node 24 后同一命令 12.6s 正常返回）。
// 修法：spawnSync 传 timeout，到点判失败而非无限等；spawnSync.error 的 ETIMEDOUT
//   即超时信号。stdio 沿用 'pipe'（须收 stdout 供失败时打错误行），但 spawnSync 的
//   pipe 不依赖子进程主动关闭——父进程按固定长度读，泄漏句柄不再导致挂死。
// 契约不变：返回 { ok, out }，调用方（128/155 行）按字符串消费 out。
// 可选第三参 timeoutMs：单条命令的墙钟上限覆盖（pushTests 单条慢测用；缺省仍取全局上限）。
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 构建类命令的墙钟上限（毫秒）。npm run build 实测 12.6s / dotnet build 数十秒，
// 取 10 分钟兼顾慢机与「本该 90 秒内结束」的挂起场景——远小于原来的永不返回。
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

process.chdir(process.env.FLOW_KIT_PROJECT_ROOT || path.resolve(__dirname, '../..'));

function sh(cmd, cwd, timeoutMs = BUILD_TIMEOUT_MS) {
  try {
    const r = spawnSync(cmd, {
      shell: true,                       // 命令串含 && 与路径空格，沿用原 shell 语义
      encoding: 'utf8',
      cwd: cwd || undefined,
      timeout: timeoutMs,                // 到点 kill，判失败（不再无限等待）
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
    if (r.error) {
      const timedOut = r.error.code === 'ETIMEDOUT';
      return {
        ok: false,
        out: (timedOut ? `[超时] 命令超过 ${timeoutMs / 1000}s 未结束，已终止（kill 直接子进程，孙进程可能残留）：${cmd}\n` : `[spawn 失败] ${r.error.code || r.error.message}\n`)
          + String((r.stdout || '') + (r.stderr || '')),
      };
    }
    if (r.status !== 0) {
      return { ok: false, out: String((r.stdout || '') + (r.stderr || '')) };
    }
    return { ok: true, out: String(r.stdout || '') };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') + String(e.message || '') };
  }
}

// --- 模式旗标（2026-10-15 构建门后移 pre-push；sha 经 git 管道来仍做白名单校验——信任边界） ---
const NO_BUILD = process.argv.includes('--no-build');
const rangeIdx = process.argv.indexOf('--range');
const RANGE = rangeIdx >= 0 ? process.argv.slice(rangeIdx + 1, rangeIdx + 3) : null;
if (RANGE && (RANGE.length < 2 || !/^[0-9a-f]{4,40}$/i.test(RANGE[0]) || !/^[0-9a-f]{4,40}$/i.test(RANGE[1]))) {
  console.log(`BLOCK: --range 参数须为两个 git sha（现「${(RANGE || []).join(' ')}」）`);
  process.exit(1);
}
// 全零 old = 新分支首推：git diff 对全零 sha 无从执行，且本就取全量匹配语义——文件面置空即可
const RANGE_ZERO_OLD = RANGE !== null && /^0+$/.test(RANGE[0]);

let staged = [];
try {
  // 2026-11-06（P1-4 同族）：变更面读取统一带 `-c core.quotepath=off`——默认 quotepath=true 下
  // 非 ASCII 路径被转义（`"frontend/\346\226..."`），下游按路径前缀匹配的门会静默漏判。
  // （当前 frontend/ 下无中文路径，影响面暂为 0；口径与 pre-commit/pre-push/test-impact-lib 对齐。）
  const listCmd = !RANGE ? 'git -c core.quotepath=off diff --cached --name-only'
    : RANGE_ZERO_OLD ? null
    : `git -c core.quotepath=off diff --name-only ${RANGE[0]} ${RANGE[1]}`;
  staged = listCmd === null ? []
    : execSync(listCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(s => s.trim()).filter(Boolean);
} catch (e) {
  console.log('BLOCK: 无法读取变更文件面（git diff 失败）');
  process.exit(1);
}

// --- 0) 项目配置（可选） ---
let config = { builds: [] };
try {
  const raw = JSON.parse(fs.readFileSync('.agents/hooks/commit-check.config.json', 'utf8'));
  config = { ...config, ...raw };
} catch (e) { /* 无配置 = 跳过构建验证 */ }

// --- 1) 条件构建验证 ---
// --full：合并提交（pre-merge-commit / 冲突解决后手动 commit）使用——合并结果是没人验证过的新状态，
// 按 ext/prefix 裁剪可能漏掉需要重跑的一侧，故不做路径裁剪。when 仍生效：没有对应能力就不跑。
// --range 全零 old sha（新分支首推）同取全量匹配语义。
// 引擎自身文件（.agents/、.githooks/）不参与构建匹配——工作流引擎不是项目构建产物。
const FULL = process.argv.includes('--full') || RANGE_ZERO_OLD;
const stagedForBuild = staged.filter(f => !f.startsWith('.agents/') && !f.startsWith('.githooks/'));
// 质量检测面（2026-11-10 dev-tour 测试门接线）：checks 是秒级确定性检查，引擎脚本（.agents/）变更同样要过；
// builds 面维持排除引擎（工作流引擎不是项目构建产物），.githooks/ 对两者都不计。
const stagedForChecks = staged.filter(f => !f.startsWith('.githooks/'));

// whenSatisfied：任一谓词满足即启用。pkg: 读 cwd 下的 package.json；其余谓词相对仓库根。
function whenItem(w, cwd) {
  if (typeof w === 'string' && w.startsWith('pkg:')) {
    const keys = w.slice(4).split('.').filter(Boolean);
    if (!keys.length) return false;
    const pkgPath = path.join(cwd || '.', 'package.json');
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) { return false; }
    let cur = pkg;
    for (const k of keys) {
      if (cur == null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) return false;
      cur = cur[k];
    }
    return typeof cur === 'string' && cur.trim() !== '';
  }
  const star = String(w).indexOf('*');
  if (star < 0) return fs.existsSync(w);
  const suffix = w.slice(star + 1);
  const dir = path.dirname(w.slice(0, star)) || '.';
  try { return fs.readdirSync(dir).some((f) => f.endsWith(suffix)); } catch (e) { return false; }
}
function whenSatisfied(when, cwd) {
  if (!when) return true;
  const list = Array.isArray(when) ? when : [when];
  return list.some((w) => whenItem(w, cwd));
}
function skipWhen(kind, item) {
  const shown = Array.isArray(item.when) ? item.when.join(' / ') : item.when;
  console.log(`SKIP: ${item.name}（未找到 ${shown}，跳过${kind}——配置好后自动启用）`);
}

if (NO_BUILD) {
  console.log('SKIP: --no-build（2026-10-15 构建门后移 pre-push——常规提交不再构建，推送时按范围执法）');
} else {
  let consideredBuild = false;
  for (const b of (config.builds || [])) {
    if (!b || !b.command) continue;
    const exts = Array.isArray(b.ext) ? b.ext : [];
    const match = FULL || stagedForBuild.some(f => exts.some(e => f.endsWith(e)) || (b.prefix ? f.startsWith(b.prefix) : false));
    if (!match) continue;
    consideredBuild = true;
    if (!whenSatisfied(b.when, b.cwd)) { skipWhen('构建', b); continue; }
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
  if (!consideredBuild) {
    console.log(config.builds && config.builds.length
      ? 'SKIP: 无匹配的源码变更，跳过构建验证'
      : 'SKIP: 未配置 builds（.agents/hooks/commit-check.config.json），跳过构建验证');
  }
}

// --- 2) 质量检测（checks：lint / 类型检查 / vet 等秒级确定性检查；测试不放这里——关单在 stages.md Test 章阶段门） ---
let ranCheck = false;
for (const c of (config.checks || [])) {
  if (!c || !c.command) continue;
  const exts = Array.isArray(c.ext) ? c.ext : [];
  const match = FULL || stagedForChecks.some(f => exts.some(e => f.endsWith(e)) || (c.prefix ? f.startsWith(c.prefix) : false));
  if (!match) continue;
  ranCheck = true;
  if (!whenSatisfied(c.when, c.cwd)) { skipWhen('质量检查', c); continue; }
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

// --- 3) 推送前测试（pushTests：仅 --range 模式执行——pre-push 专段，提交/合并路径不进这里）。
// 前身是 pre-push 里写死的母项目后端测试段：路径面判据与脚本路径都硬编码，任何其他项目
// 只要顶层有 tests/ 就会触发 `Cannot find module` 断推——退役后由项目按自身配置声明推送前测试。
if (RANGE) {
  const entries = Array.isArray(config.pushTests) ? config.pushTests.filter(t => t && t.command) : [];
  const prefixesOf = (t) => (Array.isArray(t.prefix) ? t.prefix : (t.prefix ? [t.prefix] : []));
  const matched = entries.filter((t) => {
    const exts = Array.isArray(t.ext) ? t.ext : [];
    return FULL || stagedForBuild.some(f => exts.some(e => f.endsWith(e)) || prefixesOf(t).some(p => f.startsWith(p)));
  });
  // whenEnv：环境开关门槛（"VAR=value"）——不满足属配置意图，不执行也不打印（区别于 when 的能力缺失 SKIP）
  const whenEnvOk = (t) => {
    if (t.whenEnv == null) return true;
    const s = String(t.whenEnv);
    const eq = s.indexOf('=');
    if (eq <= 0) return false; // 配置写错（缺「=」或变量名为空）= 不启用——推送门宁可少跑不误拦
    return process.env[s.slice(0, eq)] === s.slice(eq + 1);
  };
  let ranPushTest = false;
  for (const t of matched) {
    if (!whenEnvOk(t)) continue;
    ranPushTest = true;
    if (!whenSatisfied(t.when, t.cwd)) { skipWhen('推送前测试', t); continue; }
    const cmd = String(t.command).replace('{old}', RANGE[0]).replace('{new}', RANGE[1]);
    const r = sh(cmd, t.cwd, t.timeoutMs);
    if (!r.ok) {
      console.log(`BLOCK: ${t.name} 推送前测试未通过（${cmd}）\n` + r.out.slice(0, 1500));
      process.exit(1);
    }
    console.log(`OK: ${t.name} 推送前测试通过（${cmd}）`);
  }
  if (!ranPushTest && matched.length === 0 && entries.length) {
    console.log('SKIP: 无匹配的源码变更，跳过推送前测试');
  }
}

console.log('COMMIT_CHECK_OK');
