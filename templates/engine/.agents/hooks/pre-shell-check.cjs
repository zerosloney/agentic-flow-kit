#!/usr/bin/env node
/**
 * PreToolUse(终端命令) hook — 两道关卡：
 * 1) deny/ask 命令门禁（清单单源 = 同级 gates.json，镜像 .agents/settings.json 的 deny/ask 策略）
 * 2) git commit / git push 门卫在岗探针（2026-11-08 减重档 1-A：整链重跑改为探针，去双跑）
 *
 * 为什么只探针不重跑：.githooks/* 是项目唯一的门禁权威（pre-commit 门禁链 + pre-push 闭环断档）。
 * 本钩子原是**宿主侧冗余**——core.hooksPath 漏配时 git 侧门禁静默失效（2026-09-16 宿主侧缺档事故实证），
 * 于是在命令执行前整链重跑 .githooks/pre-commit / pre-push；但 hooksPath 正常时 git 随后还会原生
 * 执行同一份钩子 = 双跑（build / 闭环扫描预算白烧一遍）。现改为毫秒级「门卫在岗探针」：
 * hooksPath 指向 .githooks 且本命令涉及的钩子文件存在可执行 → 放行（门禁由 git 原生钩子执行）；
 * 不在岗 → fail-loud 拦截（宿主侧兜底语义不变，不是放空），修复入口 check-local-gates --fix。
 *
 * 单源纪律（2026-10-29 owner 指示）：hook 实现只养在 .agents/hooks/，宿主壳（.trae/hooks.json /
 * .zcode/config.json / .codebuddy/settings.json）只留接线配置指向本文件，禁止在宿主层复制脚本。
 *
 * 宿主事实（跨宿主实测，非文档推断）：
 *   - Trae 终端工具规范化名 RunCommand；CodeBuddy 实测 **Bash**（主通道）+ **PowerShell**（Windows
 *     次通道，见 ~/.codebuddy/projects/<project-id>/*.jsonl 的 function_call.name）。
 *     matcher 与本文件工具名正则须同列全部通道，漏任一即形成绕过口（2026-10-22 修 PowerShell 缺列）。
 *   - matcher 是正则、区分大小写、子串包含；timeout 单位是**秒**（command 默认 60s）。
 *   - stdin 官方字段：{ session_id, transcript_path, cwd, permission_mode, hook_event_name, tool_name,
 *     tool_input }；另兼容 llm_tool_name / workspace_roots（非官方字段，跨宿主兜底，缺失不报错）。
 *   - stdout: hookSpecificOutput.permissionDecision = allow / deny / ask；无输出 = 放行。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- 读取 stdin ---
let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0); // 无 stdin，放行
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0); // JSON 解析失败，放行（不阻塞正常工作流）
}

// 工具名兼容：CodeBuddy 实测为 Bash / PowerShell，Trae 为 RunCommand；保留 Shell/Terminal/execute* 别名防宿主差异
// （2026-10-22 修：原正则缺 powershell——matcher 即便命中，脚本也会自行 exit(0) 放行，形成 PowerShell 绕过口）
// run_terminal_command（Grok）含 terminal，能命中；toolName 补 camelCase，避免只送 toolName 时漏判。
// Command Code：shell_command（matcher 目标 SHELL）/ monitor_command（MONITOR）——monitor 是后台执行通道的
// 同类命令执行口，不列即形成旁路（2026-11-11）。只认 monitor_command 本体，monitor_events 是只读取输出口。
const toolName = `${data.tool_name || ''} ${data.toolName || ''} ${data.llm_tool_name || ''}`;
if (!/runcommand|bash|powershell|shell|terminal|executecommand|monitor_command/i.test(toolName)) {
  process.exit(0);
}
if (!data.tool_input && data.toolInput) data.tool_input = data.toolInput;

// 取命令文本：优先约定的 command 字段；字段名缺失时退回扫描 tool_input 的字符串值
// （信任边界上的宿主 payload，字段名跨版本可能不同——漏读会让门禁静默失效，故兜底扫描）
// Command Code 把剩余参数放 args 数组（{command:"git",args:["reset","--hard"]}）——只读 command 会让
// 红线命令整体以 argv 形态绕过（2026-11-11 实测）；含空白的 argv 项按 shell 语义补引号，防分词错位。
function extractCommand(input) {
  if (!input || typeof input !== 'object') return '';
  const parts = [];
  if (typeof input.command === 'string' && input.command) parts.push(input.command);
  if (Array.isArray(input.args)) {
    parts.push(...input.args.filter(v => typeof v === 'string').map(v => (/\s/.test(v) ? JSON.stringify(v) : v)));
  }
  if (parts.length > 0) return parts.join(' ');
  return Object.values(input).filter(v => typeof v === 'string').join('\n');
}

const command = extractCommand(data.tool_input).replace(/\\\r?\n/g, '');
// 第八轮整改：剥除反斜杠-换行续行（shell 执行时会拼回完整 token，文本检查若按含续行原文扫
// 会被 core.hoo\<LF>ksPath= / --no-ver\<LF>ify 类拼接击穿）——在提取口统一归一，全下游继承。
if (!command) {
  process.exit(0);
}

const projectRoot = data.cwd || (Array.isArray(data.workspace_roots) && data.workspace_roots[0]) || process.cwd();

function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

function ask(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
}

// ── 1) deny/ask 命令门禁 ──────────────────────────────
// 清单单源 = 同级 gates.json（2026-10-22 自脚本内抽出；2026-10-29 随脚本一并迁入 .agents/hooks/）。
// gates.json 的 mirrorOf 指 .agents/settings.json 的 permissions，exempt 登记刻意缺省项
// （dotnet ef 属 dotnet-ca 门禁域；强推由 isForcePush 的 token 化判定覆盖，强于子串匹配）。
// 清单变更须三处同步：settings.json → gates.json → FALLBACK_GATES。
// 读取失败 → 回退内置清单（fail-safe：绝不因配置读取失败而放空门禁）+ stderr 告警。
const FALLBACK_GATES = {
  deny: [
    { pat: 'git reset --hard', reason: '禁破坏性重置' },
    { pat: 'drop database', reason: '禁删库' },
    { pat: '--no-verify', reason: '禁绕过 git 钩子' }
  ],
  ask: [
    { pat: 'git checkout', reason: '可能切换/丢弃工作区改动' },
    { pat: 'git clean', reason: '可能删除未跟踪文件' },
    { pat: 'git branch -D', reason: '可能删除未合并分支' },
    { pat: 'rm -rf', reason: '可能递归删除文件' }
  ]
};
let gates = FALLBACK_GATES;
try {
  // 包内运行时执行时，清单仍以项目声明为准；直接执行安装副本时回退同级文件。
  const gatesFile = process.env.FLOW_KIT_PROJECT_ROOT
    ? path.join(process.env.FLOW_KIT_PROJECT_ROOT, '.agents', 'hooks', 'gates.json')
    : path.join(__dirname, 'gates.json');
  gates = JSON.parse(fs.readFileSync(gatesFile, 'utf8'));
} catch (e) {
  console.error(`[pre-shell-check] gates.json 不可读，已回退内置清单：${e.message}`);
}
const denyList = Array.isArray(gates.deny) ? gates.deny : FALLBACK_GATES.deny;
const askList = Array.isArray(gates.ask) ? gates.ask : FALLBACK_GATES.ask;

// stripMessages：剥 -c/-m 的值（含引号整段）——deny/ask 门与强推检测共用，防 commit 消息字样误触发
function stripMessages(cmd) {
  return cmd
    .replace(/(^|\s)-[cm]\s+"[^"]*"(?=\s|$)/g, ' ')
    .replace(/(^|\s)-[cm]\s+'[^']*'(?=\s|$)/g, ' ')
    .replace(/(^|\s)-[cm]\s+\S+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// 强推检测 token 化（host-gates-p1 P1-B2）：子串模式 'git push --force' 挡不住换序
// （git push origin main --force）与 +refspec 变体（git push origin +main）——改为 token 级判定。
// 复核 P2 收窄（同日）：①按 &&/||/;/| 分段，--force 只在 push 段内计数（dotnet build --force 不误并）；
// ②组合短旗标（-vf）与 -f 同为 force；③--force-with-lease 是带尾巴的独立 token 不匹配。
// p2-batch2 补：先剥 commit 消息（引号感知）再分段——"git commit -m "修 push --force"" 曾被误拦。
// 本钩子是 core.hooksPath 漏配时的主要强推执行点，语义必须完整。
function isForcePush(cmd) {
  const stripped = stripMessages(cmd);
  return stripped.split(/&&|\|\||;|\|/).some((seg) => {
    const tokens = seg.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!tokens.includes('push')) return false;
    return tokens.some((t) => t === '--force'
      || (t.startsWith('-') && !t.startsWith('--') && /^-[a-zA-Z]*f/.test(t))
      || (t.startsWith('+') && t.length > 1));
  });
}

// hasExpansion：命令是否含 shell 展开/转义（$ / 反引号）。commit 消息惯用法 `$(cat <<'EOF'…)`
// 的替换体是纯文本 heredoc、不可执行，按既有口径豁免；其余 $/反引号一律视为展开痕迹。
function hasExpansion(cmd) {
  return /[$`]/.test(cmd.replace(/\$\(cat\s+<</g, '<<').replace(/["']/g, ''));
}

// expansionWords / expansionHits：deny/ask 面的展开门（E9-H1）。字面门只吃文本，
// `git reset --$(echo hard)` 与 `git$IFS reset --hard` 均不含红线字样。这里按 shell 词法
// 取每个词的**字面骨架**（展开段剥掉，dyn 标记该词含展开）：
//   - 引号只去壳，引号内空格不断词（`echo "git reset --hard"` 不误判）；
//   - $(…)/${…}/$VAR 整段剥出骨架；
//   - 反引号有配对按命令替换剥出骨架，无配对按 PowerShell 转义前缀只丢反引号本身（头注宿主通道）。
// 规则模式与词块逐 token 对齐：含展开的词可以补全当前 token（`--$(echo hard)` 的骨架 `--`
// 命中 `--hard`），也可以整体展开为空（`git $IFS reset`）。展开命中一律 deny（fail-closed，
// 内联展开值后重试即过；与 commit/merge/push 展开门同一裁定）。
function skipExpansion(cmd, i) {
  if (cmd[i] === '$' && cmd[i + 1] === '(') {
    let depth = 1;
    let j = i + 1;
    for (j = i + 2; j < cmd.length; j += 1) {
      if (cmd[j] === '(') depth += 1;
      else if (cmd[j] === ')' && --depth === 0) break;
    }
    return j; // 未闭合吞到行尾（残缺命令，剩余文本不进骨架）
  }
  if (cmd[i] === '$' && cmd[i + 1] === '{') {
    const end = cmd.indexOf('}', i + 2);
    return end === -1 ? cmd.length - 1 : end;
  }
  if (cmd[i] === '`') {
    const end = cmd.indexOf('`', i + 1);
    return end === -1 ? i : end; // 无配对 = PowerShell 转义前缀
  }
  const m = /^[A-Za-z_][A-Za-z0-9_]*|^[0-9@*#?$!-]/.exec(cmd.slice(i + 1));
  return m ? i + m[0].length : i;
}

function expansionWords(cmd) {
  const words = [];
  let lit = '';
  let dyn = false;
  let quote = '';
  const flush = () => {
    if (lit || dyn) words.push({ lit, dyn });
    lit = '';
    dyn = false;
  };
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    const inQuote = quote !== '';
    if (inQuote) {
      if (ch === quote) { quote = ''; continue; }
      if (ch !== '$' && ch !== '`') { lit += ch; continue; }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    // ${IFS}/$IFS（大小写不敏感）是 bash 的词分隔符：按空白处理——flush 当前词，不并入骨架。
    // 该处词边界由展开决定，故紧随其后的词记 dyn：expansionHits 只对含 dyn 词的骨架判命中，
    // 若两侧全成字面词，`git${IFS}reset${IFS}--hard` 会退化成无展开痕迹的骨架而漏过（fail-closed）。
    if (!inQuote && ch === '$') {
      const ifs = /^(?:\$\{IFS\}|\$IFS(?![\w]))/i.exec(cmd.slice(i));
      if (ifs) {
        flush();
        dyn = true;
        i += ifs[0].length - 1;
        continue;
      }
    }
    if (ch === '$' || ch === '`') {
      dyn = true;
      i = skipExpansion(cmd, i);
      continue;
    }
    if (!inQuote && (/\s/.test(ch) || ch === ';' || ch === '|' || ch === '&')) { flush(); continue; }
    lit += ch;
  }
  flush();
  return words;
}

function expansionHits(pat, words) {
  const tokens = pat.split(/\s+/).filter((t) => t && !/^\*+$/.test(t)).map((t) => t.replace(/^\*+|\*+$/g, ''));
  // 旗标级条目（`--no-verify` / `* --no-verify*`）在展开面由 isNoVerify 扁平域执法；
  // 只靠一个纯展开词就能「凭空」命中旗标会把 `echo $HOME` 一类普通命令全判死，故不在此对齐。
  if (!tokens.length || tokens.some((t) => !t) || tokens[0].startsWith('-')) return false;
  const walk = (wi, pi, dynHit) => {
    if (pi === tokens.length) return dynHit;
    if (wi === words.length) return false;
    const w = words[wi];
    if (!w.dyn) return w.lit === tokens[pi] && walk(wi + 1, pi + 1, dynHit);
    if (!w.lit && walk(wi + 1, pi, true)) return true;
    return tokens[pi].startsWith(w.lit) && walk(wi + 1, pi + 1, true);
  };
  // 起点必须锚在字面骨架上（模式首 token 的前缀）：纯展开词不得凭空开启匹配，
  // 否则 `cp $SRC $DST` 一类普通命令会被 `dotnet ef` 两 token 全吞。
  for (let j = 0; j < words.length; j += 1) {
    const head = words[j];
    if (head.lit && tokens[0].startsWith(head.lit) && walk(j, 0, false)) return true;
  }
  return false;
}

// gateMatch：比裸 includes 收紧三处（2026-09-24；p2-batch2 补 ③）——
//   ① token 边界：'git checkout' 不再误吃 'git commit-msg'
//   ② 剥离 git 全局参 -c <k=v> 与 -m <msg> 后以剥后文本为准——堵 'git -c x=y reset --hard' 绕过
//   ③ 消息字样误触（p2-batch2）：带引号多词消息（-m "修 git push --force 误拦"）单 token 剥不净——
//     剥离逻辑收敛到 stripMessages 单源（引号感知）
function gateMatch(cmd, pat) {
  // 2026-11-27：改大小写不敏感（SQL/命令名单词大小写拼法一致放行会漏拦，如 DROP DATABASE）。
  // fail-closed 取向：POSIX 上大写命令本就多半执行不了，多拦零代价；命中按清单原文报理由。
  const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])', 'i');
  const norm = stripMessages(cmd);
  return norm !== cmd ? re.test(norm) : re.test(cmd);
}

// dequotedMatch：去引号骨架视图（D7 复核 2）。shell 里 `git "reset" --hard` 与 `g''it reset --hard`
// 都是 `git reset --hard` 这个 argv，引号不参与命令语义；空引号对在骨架里自然消失。
// 提交消息先按 stripMessages 剥除（与 gateMatch 同源），保住「prose 里的红线字样不拦」的既有口径。
// fail-closed 边界：`echo "git reset --hard"` 这类纯引号内字样同样按红线判（与既有展开门同一取舍，
// 改写/内联即过）——不区分「引号里是执行还是散文」，静态文本无法区分。
function dequotedMatch(cmd, pat) {
  return gateMatch(stripMessages(cmd).replace(/["']/g, ''), pat);
}

// 清单匹配视图束（2026-11-27）：shell 各层转义只改文本、不改 argv——POSIX 反斜杠（`g\it` → git）、
// PowerShell 反引号（`re`se`t` → reset）、cmd.exe 脱字符（`re^set` → reset）在各自壳里执行的都是
// 去转义后的字面量。只比对原文时，一个转义符就能把红线命令拆成不含清单字样的文本。
// git 全局选项（--no-pager / -C . / -c k=v）插在子命令前同样不改变 argv 子命令语义，剥掉后与清单对齐。
// fail-closed：原文与任一视图命中即拦（误拦改写命令即过），与 dequotedMatch 同一取舍。
const GIT_GLOBAL_OPTS_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path']);
const GIT_GLOBAL_STRIP_RE = new RegExp(
  '(^|[\\s;|&])git\\s+(?:(?:' + [...GIT_GLOBAL_OPTS_WITH_ARG].join('|')
    + ')(?:\\s*=\\s*|[\\s]+)(?:"[^"]*"|\'[^\']*\'|\\S+)\\s+|--?[A-Za-z][\\w-]*\\s+)*',
  'gi'
);
function gitBareView(cmd) {
  return cmd.replace(GIT_GLOBAL_STRIP_RE, '$1git ');
}
function shellViews(cmd) {
  const noBs = cmd.replace(/\\(.)/g, '$1');
  const noTicks = noBs.replace(/[`^]/g, '');
  const out = [];
  for (const v of [cmd, noBs, noTicks]) {
    for (const w of [v, gitBareView(v)]) {
      if (!out.includes(w)) out.push(w);
    }
  }
  return out;
}
function listMatch(cmd, pat) {
  return shellViews(cmd).some((v) => gateMatch(v, pat) || dequotedMatch(v, pat));
}

// interpreterPayloads：解释器包裹（bash/sh/zsh/dash/ksh 的 -c / -lc / -l -c 等形态）的 payload。
// agent 把命令交给解释器执行时，payload 就是将被执行的内容——红线字样在 payload 里等同红线在命令里。
// 双引号/单引号/裸串（到段末）都取；`/bin/bash`、`sudo bash` 等前缀一并认。payload 内出现 deny/ask
// 清单字样即按清单判定（fail-closed：`bash -c "echo git reset --hard"` 也拦，改写即过）。
function interpreterPayloads(cmd) {
  const re = /(?:^|[\s;&|(\\/])(?:bash|sh|zsh|dash|ksh)(?:\s+-[A-Za-z]+)*\s+-[A-Za-z]*c[A-Za-z]*\s+(?:"([^"]*)"|'([^']*)'|([^;&|\r\n]+))/g;
  const out = [];
  for (const m of cmd.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3] ?? '').trim());
  return out.filter(Boolean);
}

// 2026-11-27：强推判定同样吃转义视图——`git push origin --forc\e` 的 argv 是 --force，
// token 化判定只吃原文会漏；shellViews 已含去反斜杠/反引号/脱字符形态。
if (shellViews(command).some(isForcePush)) {
  deny('禁止执行: git push 强制推送（--force / -f / +refspec；项目红线：禁强制推送）');
}
// 1d) 解锁标记的 shell 通道（D8b 残口）：pre-write-check 已封死写工具侧创建/改写
// .agents/tmp/write-gate-until，并让 --unlock 必须走终端；但 shell 允许清单含 node，echo/tee/cp/mv/touch
// 与 node -e 仍能写出标记，标记存在即解锁受保护接线。命令文本只要出现标记名即 deny——
// 大小写、正/反斜杠、绝对/相对路径、引号/反引号拆分一并归一；读、删同判（读可探测门禁状态，
// 删亦属改动执法面）。变量拼接出的拼法（'write-'+'gate-until'）不在本门范围。
if (command.toLowerCase().replace(/["'`\\]/g, '').includes('write-gate-until')) {
  deny('禁止执行: 命令提及写入门禁解锁标记 .agents/tmp/write-gate-until（写、读、删一律禁——标记存在即绕过执法面自保护，读取可用于探测门禁状态；确需临时放行由用户执行 pre-write-check.cjs --unlock <分钟>）。项目红线：禁绕过门禁');
}
// PowerShell -EncodedCommand：base64(UTF-16LE) 载荷在命令文本层不可见，静态无法核对门禁；
// 与 write-gate-until 同为代码级 fail-closed deny 先例（解码依赖系统 base64/码页，跨宿主不可靠）。
if (/-encodedcommand/i.test(command)) {
  deny('禁止执行: PowerShell -EncodedCommand（编码载荷文本层不可见，无法核对门禁；请改用明文命令后重试。项目红线：禁以编码载荷绕过门禁）');
}
for (const d of denyList) {
  if (listMatch(command, d.pat)) {
    deny(`禁止执行: ${d.pat}（项目红线：${d.reason}）`);
  }
}
for (const a of askList) {
  if (listMatch(command, a.pat)) {
    ask(`需确认: ${a.pat}（项目 ask 策略：${a.reason}）`);
  }
}

// ── 1b) 命令级/环境 hooksPath 覆盖（2026-11-08 第七轮收敛，枚举 git 配置注入面）──────
// ① 环境注入：钩子与用户命令同环境，直接查宿主进程 env 的 GIT_CONFIG_KEY_n 指向 hooksPath；
// ② 命令文本：剥除全部引号后扫 -c（含引号/紧贴/空值/布尔形态）与 --config-env、行内
//    GIT_CONFIG_KEY_n= 赋值；只放行值恰为 .githooks 的 -c。fail-closed。
// 已知可接受误拦：提交消息含字面 "-c core.hooksPath=…"（改写即过）。
// 2026-11-27：收成函数供解释器 payload 复用；flat 视图连反斜杠一并剥除（`core.hoo\ksPath` 是同一键的
// 另一种 shell 拼法，剥引号不剥反斜杠会让键名躲过正则）。
function hooksPathOverride(cmd) {
  const normP = (p) => path.resolve(projectRoot, p || '.').replace(/[\\/]+$/, '').toLowerCase();
  const envHit = Object.entries(process.env).some(([k, v]) => {
    if (!/^GIT_CONFIG_KEY_\d+$/.test(k) || !/^core\.hooksPath$/i.test(String(v || ''))) return false;
    // 第八轮整改：合法形态 KEY=hooksPath + VALUE=.githooks 不拦（只看 KEY 会误拒全部命令）；
    // VALUE 缺失或非 .githooks 即拦。
    const idx = k.slice('GIT_CONFIG_KEY_'.length);
    const val = String(process.env[`GIT_CONFIG_VALUE_${idx}`] || '');
    return normP(val) !== normP('.githooks');
  });
  // 第八轮整改：① 剥 ANSI-C 引号前缀（$'…' → '…'）再剥引号，防 $'-c' 形态逃逸边界；
  // ② -c 多次出现按 git last-wins 语义，任一 hooksPath 值非 .githooks 即拒（fail-closed）。
  const flat = cmd.replace(/\$(['"])/g, '$1').replace(/["'\\]/g, '');
  const all = flat.match(/(?:^|[\s;|&])-c\s*=?\s*core\.hooksPath(?:=(\S*))?/gi) || [];
  const cfgEnv = /(?:^|[\s;|&])--config-env[=\s]+core\.hooksPath(?!\w)/i.test(flat);
  const inlineEnv = /GIT_CONFIG_KEY_\d+=\s*core\.hooksPath(?![\w=])/i.test(flat);
  const badVal = all.some((s) => {
    const v = (s.match(/core\.hooksPath(?:=(\S*))?/i)?.[1] ?? '');
    return normP(v) !== normP('.githooks');
  });
  const val = all.length ? ((all[all.length - 1].match(/=(\S*)/) || [null, ''])[1] ?? '') : null;
  if (envHit || cfgEnv || inlineEnv || (all.length > 0 && badVal)) {
    const why = envHit ? 'GIT_CONFIG_KEY 环境注入' : cfgEnv ? '--config-env' : inlineEnv ? '行内 GIT_CONFIG 赋值' : `值=${val || '(空/布尔)'}`;
    return `命令级/环境 hooksPath 覆盖（${why}，非 .githooks）`;
  }
  return '';
}
const hpWhy = hooksPathOverride(command);
if (hpWhy) {
  deny(`禁止执行: ${hpWhy}——钩子将被整体跳过（项目红线：禁绕过 git 钩子）`);
}

// ── 2) git commit / git push 前置检查 ──────────────────
// 2026-11-06（P1-2）：原判据 `/git\s+commit/`、`/git\s+push/` 直接跑在**整条命令原文**上，双向失准——
//   误伤：`echo "git push"` / `git log --grep="git push"` / `git commit -m "…git push…"` 会误跑门禁腿；
//   漏拦：`git -C . push` / `git --no-pager push` / `git -c k=v push` 因全局选项夹在中间而漏跑门禁腿。
// 修法：① 先走 stripMessages()（剥离 -c/-m 值，与强推检测同源）；② 按命令分隔符分段；
//       ③ 引号感知分词后取首个恰为 `git` 的 token，再穿透 git 全局选项前缀取其子命令
//          （`echo "git push"` 的 `"git push"` 是单个 token，天然不命中）。
// 已知局限：`pwsh -c "git push"` 这类**嵌套 shell** 不命中——与 `echo "git push"` 文本同形，
//   取「不误伤」一侧；core.hooksPath 正常时 git 自身仍会触发 pre-push。
function gitSubcommand(seg) {
  const tokens = seg.match(/"[^"]*"|'[^']*'|\S+/g) || []; // 引号感知：带空格的引号段=单 token（-C "a b"）
  // 2026-11-08 三轮整改：裸/大写 git(.exe) 与路径前缀形态一并认（此前精确 'git' 漏 git.exe / GIT；
  // 探针的 commit/push 判定与 no-verify 拦截共用本函数，同步受益）。
  // 十轮整改：token 剥引号后再比（git "commit" / git "-C" 形态不再失明——引号仅 shell 语义）
  const bare = (t) => t.replace(/^["']|["']$/g, '');
  const i = tokens.findIndex((t) => bare(t) === 'git'
    || /(?:^|[\\/])git(?:\.exe)?$/i.test(t.replace(/["']/g, '')));
  if (i === -1) return '';
  for (let j = i + 1; j < tokens.length; j++) {
    const tok = bare(tokens[j]);
    if (tok === '\u0000') continue; // 占位符（被惰化的引号值）不可能是子命令
    if (GIT_GLOBAL_OPTS_WITH_ARG.has(tok)) { j++; continue; } // 带参全局选项：连同其值一起跳过（剥引号口径）
    if (tok.startsWith('-')) continue; // 无参全局旗标（--no-pager / -p / --paginate …）
    return tok;
  }
  return '';
}
// 2026-11-08 终二轮整改：分段改在**原始命令**上（含 \r\n）；2026-11-09 十四轮整改：先做
// **物化预处理**——无空格引号段按 shell 词内拼接语义原地替换（'comm''it'→commit、-'n'→-n），
// 分隔符序列中和为 \u0001（引号内是数据）；含空格引号段占位为 \u0000（消息值/带空格路径惰化）。
// 子命令判定与短旗标腿同源消费本物化文本；探针腿同步受益（引号子命令不再失明）。
const materializeShQuotes = (cmd) => cmd.replace(/(\$'[^']*'|\$"[^"]*"|"[^"]*"|'[^']*')/g, (m) => {
  const ansi = m.startsWith('$');
  let inner = ansi ? m.slice(2, -1) : m.slice(1, -1);
  // 十五轮修正：$'…' ANSI-C 转义（\x6e 等）先解码（shell 会展开成真实字符）再物化
  if (ansi) {
    inner = inner
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\U([0-9a-fA-F]{8})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\n/g, String.fromCharCode(10))
      .replace(/\\t/g, String.fromCharCode(9))
      .replace(/\\(.)/g, '$1');
  }
  if (/\s/.test(inner)) return ' \u0000 ';
  return inner.replace(/&&|\|\||[;|\r\n|]/g, '\u0001');
});
const commandMat = materializeShQuotes(command);
const gitSubcommands = commandMat.split(/&&|\|\||[;|\r\n]/).map(gitSubcommand);
const isCommit = gitSubcommands.includes('commit');
const isPush = gitSubcommands.includes('push');

// 1c) 展开携带红线（E9-H1 / D7 复核）：字面门只吃文本——`git reset --$(echo hard)` /
// `git$IFS reset --hard` / PowerShell 反引号转义 `git re`set --hard` 均不含红线字样。
// 判定**逐段**：只有本段自身含展开时才用它的骨架对齐，跨段展开不得拿来补全另一段的模式
// （`git push && echo $HOME` 的 $HOME 曾被拿来补全 --force）。仅 deny 清单 escalate 为 deny
// （与 commit/merge/push 展开门同一裁定）；ask 清单的展开命中保持 ask，把决定权留给用户。
// 无展开命令不进入本门，判定与既有行为完全一致。返回首个命中的清单条目。
function expansionHitIn(cmd, list) {
  for (const seg of cmd.split(/&&|\|\||[;|\r\n]/)) {
    if (!hasExpansion(seg)) continue;
    const words = expansionWords(stripMessages(seg));
    const mat = materializeShQuotes(seg);
    const hit = list.find((g) => expansionHits(g.pat, words) || gateMatch(mat, g.pat));
    if (hit) return hit;
  }
  return null;
}
const red = expansionHitIn(command, denyList);
if (red) {
  deny(`禁止执行: ${red.pat}（命令含 shell 展开/转义，展开值文本层不可见，请内联展开值后重试。项目红线：禁以展开绕过门禁）`);
}
const need = expansionHitIn(command, askList);
if (need) {
  ask(`需确认: ${need.pat}（命令含 shell 展开/转义，展开值文本层不可见，请确认展开值后再执行。项目 ask 策略：${need.reason}）`);
}

// 1e) 解释器包裹 payload（D7 复核 2）：`bash -c "git reset --hard"` 的 payload 就是被执行内容，
// stripMessages 会把包裹的 -c 值当 git 配置剥掉，所以字面门看不见它——这里单独取 payload 再判。
// 仍逐条按 deny→ask 判定；payload 内的展开走同一逐段骨架门。
// 2026-11-27：payload 是独立命令文本，代码层守卫（isNoVerify / hooksPath 覆盖）必须逐 payload 过——
// 外层命令的物化/扁平视图未必能代表 payload 的 argv（如 `sh -c "git commit -n"` 的短旗标只按段判定）。
const payloads = interpreterPayloads(command);
if (payloads.length) {
  let pNeed = null;
  for (const payload of payloads) {
    if (isNoVerify(payload)) {
      deny('禁止执行: 解释器包裹命令中的绕钩旗标（payload 文本即被执行内容。项目红线：commit/merge/push 三处一律禁绕过 git 钩子）');
    }
    const pHp = hooksPathOverride(payload);
    if (pHp) {
      deny(`禁止执行: ${pHp}（解释器 payload 文本即被执行内容）——钩子将被整体跳过（项目红线：禁绕过 git 钩子）`);
    }
    const pRed = denyList.find((g) => listMatch(payload, g.pat))
      || expansionHitIn(payload, denyList);
    if (pRed) {
      deny(`禁止执行: 解释器包裹命令中的 ${pRed.pat}（payload 文本即被执行内容。项目红线：${pRed.reason}）`);
    }
    pNeed = pNeed || askList.find((g) => listMatch(payload, g.pat))
      || expansionHitIn(payload, askList);
  }
  if (pNeed) {
    ask(`需确认: 解释器包裹命令中的 ${pNeed.pat}（payload 文本即被执行内容。项目 ask 策略：${pNeed.reason}）`);
  }
}

// no-verify 旗标拦截（2026-11-08 评审三轮整改收敛版，取代逐形态补丁）。设计三条：
//   ① 子命令判定在原始命令上分段（与 gitSubcommands 同式同源：含 \r\n、认路径前缀/裸或大写 git(.exe)/全局选项）；
//   ② 旗标判定在整条命令上引号感知分词（不走 stripMessages——其 -m 剥离会吞尾部引号破坏配对，
//     实测误拦测试类命令）；先拆 `-m"…"` / `--opt="…"` 等号/紧贴引号形态为空格分隔，使消息值
//     整体成单 token（值内旗标不误拦）；
//   ③ 长旗标 commit/merge/push 皆拦（根 AGENTS.md §2 三处禁令）；含 n 短旗标簇仅 commit 语义
//     （push 的 -n 是 --dry-run、merge 的 -n 是 --no-stat）。
// 已知可接受误拦（fail-closed 取向，改写命令即过）：与 commit/merge/push 并列段落里的整词旗标
// （echo "--no-verify" 类）、消息恰好整词为旗标、commit+push 混合命令中的 push -n。
// 执法单源在本代码层（isForcePush 同 precedent），不入三处清单；owner 如需清单镜像/exempt 登记自行补基线。
function isNoVerify(cmd) {
  // 终极收敛（2026-11-09 第十二轮后）：长旗标改**规范化扁平子串**判定——小写后删全部引号/反斜杠/
  // 空白，含 'no-veri' 即拒。无 token 化、无引号配对、无段切分，任何引号/紧贴/转义/拼接组合在扁平域
  // 必然拼回该子串（此前八~十二轮的 token 化路线每修一处就派生新的配对破坏组合，结构性无终点）。
  // 'no-veri' 与合法选项 'no-verbose'（no-verb…）在第 5 字符分岔，子串判据无碰撞；git 自身拒绝
  // 更短歧义前缀（--no-v/--no-ve/--no-ver 报 ambiguous），能生效的拼写全数落入该子串。
  // 误拦代价（fail-closed）：commit/merge/push 命令中任何位置文本含 no-veri（含提交消息）即拒，
  // 改写即过。短旗标簇仍走段级 token 判定（物化=shell 词内拼接语义、无空格、分隔符中和，$'…'
  // ANSI-C 转义先解码）。**静态边界收口（十五轮裁定）**：shell 变量/命令替换展开的旗标文本层不可
  // 见——含展开的 commit/merge/push 段一律拒（fail-closed，内联值即过）；CI/脚本不经本门。混合
  // 命令 push 干跑旗标/消息恰为整词短旗标/消息含美元数字（$5）为已知边界。
  // 2026-11-27：改为显式传参——解释器 payload 是独立命令文本，守卫必须能按 payload 重算子命令与物化视图
  // （此前读全局 command/commandMat，payload 循环无法复用）。
  const cmdMat = materializeShQuotes(cmd);
  const subs = cmdMat.split(/&&|\|\||[;|\r\n]/).map(gitSubcommand);
  // 十七轮补口（先于守卫判定）：一次性别名间接——`-c alias.ci='commit …'` 使真实子命令对守卫不可见，
  // 含 -c alias.* 的 git 命令一律拒（fail-closed，罕见合法形态去掉别名即过）。
  // E9-H2：短选项可紧贴取值（`-calias.ci=commit` 与 `-c=alias.…`），空白不是必要条件——只认空格形态
  // 会让紧贴写法把别名带过守卫（git 照常展开 alias ci → commit -n）。
  // 取值域双源：去引号原文（保住带空格引号值里的 alias. 字样）+ 物化文本（ANSI-C 空格解码后的
  // 占位符折算为空白），$IFS/${IFS}/反斜杠转义的空格一并折算。
  const aliasView = (t) => t.replace(/["']/g, '').replace(/\u0000/g, ' ').replace(/\$\{?IFS\}?/g, ' ').replace(/\\(\s)/g, '$1');
  const aliasPat = /(?:^|[\s;|&])-c\s*=?\s*alias\./i;
  if (aliasPat.test(aliasView(cmd)) || aliasPat.test(aliasView(cmdMat))) return true;
  if (!subs.some((s) => s === 'commit' || s === 'merge' || s === 'push')) return false;
  // 十六轮统一收敛：三条腿各吃各的规范化文本，不再共用单一形态——
  //   ① 展开检测吃**去引号原文**（内容保留、$ 与反引号痕迹不被占位符抹除；十六轮实测物化文本
  //      会把 "$(…)" 抹成占位符致漏判），按「守卫子命令存在 + 命令任意位置含 $/反引号」门控——
  //      简化为字符级（覆盖 ${}/$()/$VAR/反引号全部形态），误拦（如消息含美元符号）改写即过；
  //   ② 长旗标扁平域改吃**物化文本**（含 ANSI-C 解码与词内拼接）——解码结果此前无消费者，
  //      `--no-ver$'\x69'fy` 类混合拼接形态在物化扁平域必然拼回 no-veri 子串；
  //   ③ 短旗标维持物化文本段级判定。
  // 惯用法豁免：`$(cat <<'EOF'…)` 是本仓提交消息标准写法，替换体为纯文本 heredoc。内容仍完整留在
  // 命令文本里——长旗标扁平域对**原始命令与物化文本双源取并集**（十七轮：物化域的占位符会抹除
  // heredoc 体内的旗标字样，而 bash 会把它替换进 argv），其余 $/反引号照拦。
  if (hasExpansion(cmd)) return true;
  const flat = (t) => t.toLowerCase().replace(/["'\\\s\u0000\u0001]/g, '');
  if (flat(cmd).includes('no-veri') || flat(cmdMat).includes('no-veri')) return true;
  // 十七轮补口：大括号展开（--no-ver{ify,ify} / -{n,m}）与一次性别名（alias.ci）不需 $ 即可拼出
  // 真旗标/真子命令——守卫段内含大括号展开形态或 -c alias.* 一律拒（fail-closed，罕见合法形态改写即过）。
  if (/\{[^}]*,[^}]*\}/.test(cmd) && subs.length) return true;
  return subs.includes('commit') && (() => {
    return cmdMat.split(/&&|\|\||[;|\r\n]/).some((seg) => {
      if (gitSubcommand(seg) !== 'commit') return false;
      return seg.split(/\s+/).some((t) => /^-[a-z]*n[a-z]*$/i.test(t.replace(/["']/g, '')));
    });
  })();
}
if (isNoVerify(command)) {
  deny('禁止执行: 绕钩旗标（长/短旗标，或 commit/merge/push 段含 shell 变量/命令替换——展开值文本层不可见，请内联展开后重试。项目红线：commit/merge/push 三处一律禁绕过 git 钩子）');
}

if (!isCommit && !isPush) {
  process.exit(0); // 非 commit/push，放行
}

// .githooks/pre-commit / pre-push 为 node 脚本，由 git 原生钩子机制执行（core.hooksPath 在岗时）；
// 本门不再代跑（见头注 2026-11-08 减重档 1-A：git 随后还会再跑同一份 = 双跑），只验「门卫在岗」。

// probeFailure：毫秒级在岗探针——①core.hooksPath 读取并指向 .githooks；②本命令涉及的钩子文件
// 存在且可执行。返回空串 = 在岗（放行，门禁由 git 原生执行）；否则返回 fail-loud 原因文本。
function probeFailure() {
  let hooksPath = '';
  try {
    hooksPath = execFileSync('git', ['config', 'core.hooksPath'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch {
    return 'core.hooksPath 不可读（git 异常）';
  }
  const norm = (p) => path.resolve(projectRoot, p || '.').replace(/[\\/]+$/, '').toLowerCase();
  if (norm(hooksPath) !== norm('.githooks')) {
    return `core.hooksPath = "${hooksPath || '(空)'}"，未指向 .githooks`;
  }
  const needed = [isCommit && '.githooks/pre-commit', isCommit && '.githooks/commit-msg', isPush && '.githooks/pre-push'].filter(Boolean);
  for (const hook of needed) {
    try {
      fs.accessSync(path.join(projectRoot, hook), fs.constants.X_OK);
    } catch {
      return `钩子缺失或不可执行：${hook}`;
    }
  }
  return '';
}

const probeFail = probeFailure();
if (probeFail) {
  deny(`钩子未挂载，先跑 flow-kit run check-local-gates.mjs --fix（${probeFail}）——本门只做在岗探针，门禁链由 git 原生执行`);
}

// 探针通过：放行，钩子由 git 自己跑（commit → pre-commit + commit-msg，push → pre-push）
process.exit(0);
