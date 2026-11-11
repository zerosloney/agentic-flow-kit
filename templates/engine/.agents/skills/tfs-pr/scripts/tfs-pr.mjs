#!/usr/bin/env node
// tfs-pr.mjs — 内网 TFS / Azure DevOps Server PR 工具（REST + PAT）
//
// 目标：任意内网 TFS 仓库都能用。collection/project/repo 从当前 git 仓库的 remote 推导，
//   也可用 --base / --project / --repo 或 TFS_BASE / TFS_PROJECT / TFS_REPO 覆盖。
// 凭据：PAT 只从 env 读取：多台服务器可按 base 主机名分存 TFS_PAT_<HOST>（非字母数字转 _ 大写，命中优先），
//   回落全局 TFS_PAT；兜底 --pat-file <path>。不打印、不落盘。
// 响应：先判 status / content-type 再 JSON.parse；认证失败常见形态是 401 + text/html。
// 命令：target | setup | whoami | list | get | context | create | desc | conflicts
// 退出：0 成功（含 EXISTING 幂等命中）；1 HTTP/API/网络错误；2 用法/配置错误。
//
// 用法：node tfs-pr.mjs target                 # 只解析并打印 base/project/repo/remote
//       node tfs-pr.mjs setup                  # PAT 配置指引（门户地址由 base 推导）
//       node tfs-pr.mjs whoami                 # 验证 PAT
//       node tfs-pr.mjs list [--source b] [--target b] [--status active|all] [--json]
//       node tfs-pr.mjs get <id> [--json]
//       node tfs-pr.mjs context [--source b] [--target b] [--no-fetch] [--patch] [--json]
//       node tfs-pr.mjs create [--source b] [--target b] --title t --body-file f|- [--dry-run]
//       node tfs-pr.mjs desc <id> --body-file f|- [--dry-run]
//       node tfs-pr.mjs conflicts <id> [--no-fetch] [--json]
//       node tfs-pr.mjs conflicts --source b --target b [--no-fetch] [--json]
// 测试：node tfs-pr.test.mjs（本地 http 桩 + 临时 git 仓库，不触真实服务）
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : '';

class UsageError extends Error {}

function flag(key) {
  return argv.includes(key);
}

function opt(key) {
  const prefix = `${key}=`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === key) {
      const v = argv[i + 1];
      // 缺值不静默回落（2026-10-24 复核 m4）：`--source --title x` 曾把空串当取值，
      // 于是静默用当前分支/远端默认建 PR——建到错分支且无任何提示。缺值即用法错。
      if (v === undefined || v.startsWith('--')) {
        throw new UsageError(`${key} 缺少取值（后随「${v === undefined ? '（无）' : v}」）——用 ${key} <值> 或 ${key}=<值>`);
      }
      return v;
    }
    if (argv[i].startsWith(prefix)) return argv[i].slice(prefix.length);
  }
  return '';
}

const json = flag('--json');
const apiVersion = opt('--api-version') || process.env.TFS_API_VERSION || '6.0';
const scriptPath = process.argv[1] || 'tfs-pr.mjs';

class ApiError extends Error {
  constructor(message, { status = 0, hint = '' } = {}) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

const die = (msg, code = 2) => {
  console.error(`tfs-pr: ${msg}`);
  process.exit(code);
};

const decodeEntities = (s) =>
  s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const decodeSafe = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripRef = (b) => String(b || '').replace(/^refs\/heads\//, '');
const refOf = (b) => (String(b).startsWith('refs/') ? String(b) : `refs/heads/${b}`);
const printJson = (v) => console.log(JSON.stringify(v, null, 2));

// ---------- git / remote ----------
function gitRun(args, { allowFail = false, cwd } = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd });
  if (r.error) {
    if (allowFail) return r;
    throw new UsageError(`无法执行 git：${r.error.message}`);
  }
  if (r.status !== 0 && !allowFail) {
    const detail = (r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(0, 3).join(' ');
    throw new UsageError(`git ${args.join(' ')} 失败${detail ? `：${detail}` : ''}`);
  }
  return r;
}

const asText = (v) => String(v || '');
const gitOut = (args, opts) => asText(gitRun(args, opts).stdout).replace(/\r\n/g, '\n').trim();

function gitConfig(key) {
  const r = gitRun(['config', '--get', key], { allowFail: true });
  return r.status === 0 ? asText(r.stdout).trim() : '';
}

function isGitWorkTree() {
  const r = gitRun(['rev-parse', '--is-inside-work-tree'], { allowFail: true });
  return r.status === 0 && asText(r.stdout).trim() === 'true';
}

function currentBranch() {
  const r = gitRun(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true });
  return r.status === 0 ? asText(r.stdout).trim() : '';
}

function getRemoteName() {
  const explicit = opt('--remote') || process.env.TFS_REMOTE || gitConfig('tfs-pr.remote');
  if (explicit) return explicit;
  if (!isGitWorkTree()) return '';
  const r = gitRun(['remote'], { allowFail: true });
  const names = r.status === 0 ? asText(r.stdout).trim().split(/\s+/).filter(Boolean) : [];
  if (names.length <= 1) return names[0] || '';
  // 多 remote 消歧（2026-10-24 复核 M5）：原口径「有 origin 就 origin，否则取第一个」——
  // origin 指向另一 TFS 仓（或 fork）时会静默推导出错误的 project/repo，PR 建到别的仓。
  // 现：origin 可解析为 TFS 才用它；否则在「可解析为 TFS 的 remote」中取唯一者；仍多于一个即报歧义。
  const tfsRemotes = names.filter((n) => {
    const u = gitRun(['remote', 'get-url', n], { allowFail: true });
    return u.status === 0 && !!parseRemoteUrl(asText(u.stdout).trim(), n);
  });
  if (tfsRemotes.length === 1) return tfsRemotes[0];
  if (tfsRemotes.length > 1) {
    // 多个 TFS remote（如 origin + upstream 镜像）时不再默认取 origin——猜错的代价是把 PR 建到别的仓，
    // 而代价更低的动作是让用户显式指定一次。
    throw new UsageError(`多 remote 无法消歧（可解析为 TFS 的有：${tfsRemotes.join('、')}）——用 --remote <name> 或 TFS_REMOTE 显式指定`);
  }
  return names[0] || '';
}

function sanitizeRemote(url) {
  return String(url || '').replace(/^([a-z]+:\/\/)(?:[^@/]+)@/i, '$1***@');
}

function parseRemoteUrl(input, remoteName) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let scheme = '';
  let host = '';
  let port = '';
  let path = '';

  let m = /^(https?|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::(\d+))?\/(.+)$/i.exec(raw);
  if (m) {
    scheme = m[1].toLowerCase();
    host = m[2];
    port = m[3] || '';
    path = m[4];
  } else {
    // scp-like: git@host:tfs/COLL/PROJ/_git/REPO
    m = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(raw);
    if (!m) return null;
    scheme = 'ssh';
    host = m[1];
    port = '22';
    path = m[2];
  }

  path = path.replace(/\/+$/, '');
  let seg = path.split('/').filter(Boolean);
  const tfsPrefix = seg[0] === 'tfs';
  if (tfsPrefix) seg = seg.slice(1);
  const gi = seg.indexOf('_git');
  if (gi < 1 || gi === seg.length - 1) return null;

  let collection = '';
  let project = '';
  if (gi === 1) {
    // Azure DevOps Services（dev.azure.com）必须带 project 段：`/<org>/_git/<repo>` 不是合法克隆地址，
    // 按「project==collection」硬解会拼出 /<org>/<org>/_apis/… → 404（2026-10-24 复核 m7）
    if (/^dev\.azure\.com$/i.test(host)) return null;
    if (tfsPrefix || !/\.visualstudio\.com$/i.test(host)) {
      // 内网自托管短形态（project==collection）：/tfs/COLL/_git/R 或根挂载 /COLL/_git/R，base 必须含 collection
      collection = decodeSafe(seg[0]);
      project = collection;
    } else {
      // Azure DevOps Services 旧式：https://org.visualstudio.com/project/_git/repo（collection 即主机）
      project = decodeSafe(seg[0]);
    }
  } else {
    collection = decodeSafe(seg[0]);
    project = decodeSafe(seg.slice(1, gi).join('/'));
  }
  let repo = decodeSafe(seg.slice(gi + 1).join('/')).replace(/\.git$/i, '');
  if (!project || !repo) return null;

  const webScheme = process.env.TFS_WEB_SCHEME || (scheme === 'ssh' ? 'http' : scheme);
  const webPort = scheme === 'ssh' ? (process.env.TFS_WEB_PORT ?? '8080') : port;
  const basePath = collection ? (tfsPrefix ? `/tfs/${collection}` : `/${collection}`) : '';
  const base = `${webScheme}://${host}${webPort ? `:${webPort}` : ''}${basePath}`;

  return {
    base,
    project,
    repo,
    collection,
    remote: remoteName || '',
    remoteUrl: sanitizeRemote(raw),
    scheme,
  };
}

function parseRemote() {
  const name = getRemoteName();
  if (!name) return null;
  const r = gitRun(['remote', 'get-url', name], { allowFail: true });
  if (r.status !== 0) return null;
  const raw = asText(r.stdout).trim();
  const parsed = parseRemoteUrl(raw, name);
  // dev.azure.com 形态缺 project 段（2026-10-24 复核 m7）：`https://dev.azure.com/<org>/_git/<repo>`
  // 不是合法克隆地址——原实现把 org 当 project，拼出 /<org>/<org>/_apis/… 后 404。此处提前点名，
  // 不让用户对着「无法识别内网 TFS 地址」猜。
  if (!parsed && /^https?:\/\/dev\.azure\.com\/[^/]+\/_git\//i.test(raw)) {
    throw new UsageError(
      `远端 ${sanitizeRemote(raw)} 缺 project 段：Azure DevOps 形态须为 https://dev.azure.com/<org>/<project>/_git/<repo>；`
      + '请修正 remote URL，或用 --project/--repo 显式指定'
    );
  }
  return parsed;
}

function resolveTarget() {
  const remote = parseRemote();
  // base 内嵌 userinfo（user:pass@）时剥除：WHATWG fetch 禁止带凭据 URL（直接 TypeError），
  // 且认证一律走 PAT——凭据只影响分存键推导（2026-10-24 复核 E3）
  const base = (opt('--base') || process.env.TFS_BASE || gitConfig('tfs-pr.base') || (remote && remote.base) || '')
    .replace(/\/+$/, '')
    .replace(/^(https?:\/\/)[^/@]+@/i, '$1');
  if (!base) {
    throw new UsageError(
      '无法识别内网 TFS 地址：请确认当前目录是 git 仓库且远端指向 TFS；' +
      '或显式指定 --base <集合地址，如 http://host:8080/tfs/COLLECTION>、--project、--repo。'
    );
  }
  const project = opt('--project') || process.env.TFS_PROJECT || (remote && remote.project) || '';
  const repo = opt('--repo') || process.env.TFS_REPO || (remote && remote.repo) || '';
  if (!project) {
    throw new UsageError('缺少 project：用 --project / TFS_PROJECT 指定，或检查远端地址是否包含 /<project>/_git/<repo>。');
  }
  if (!repo) {
    throw new UsageError('缺少 repo：用 --repo / TFS_REPO 指定，或检查远端地址是否包含 /_git/<repo>。');
  }
  return {
    base,
    project,
    repo,
    collection: (remote && remote.collection) || '',
    remote: (remote && remote.remote) || '',
    remoteUrl: (remote && remote.remoteUrl) || '',
    tokenUrl: `${base}/_usersSettings/tokens`,
    prPage: `${base}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequests`,
  };
}

// ---------- 凭据 / 正文 ----------
// PAT 环境变量查找顺序：按 base 主机名分存的 TFS_PAT_<HOST>（非字母数字转 _、大写）优先，回落全局 TFS_PAT。
function patEnvKeys(target) {
  // host 提取前先剥 scheme 与 userinfo（user:pass@ 形态）——否则分存键静默错位（2026-10-24 复核 E3）
  const host = String(target && target.base ? target.base : '')
    .replace(/^https?:\/\//, '')
    .replace(/^[^/]*@/, '')
    .split(/[/:]/)[0];
  return host ? [`TFS_PAT_${host.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`, 'TFS_PAT'] : ['TFS_PAT'];
}

function resolvePat(target, { optional = false } = {}) {
  const keys = patEnvKeys(target);
  const fromEnv = () => keys.map((k) => process.env[k]).find(Boolean) || '';
  if (optional) return fromEnv();
  const file = opt('--pat-file');
  let pat = fromEnv();
  if (!pat && file) {
    if (!fs.existsSync(file)) throw new UsageError(`--pat-file 不存在：${file}`);
    pat = fs.readFileSync(file, 'utf8');
  }
  pat = pat.replace(/^\uFEFF/, '').trim();
  if (!pat) {
    throw new UsageError(
      `缺少 PAT（${keys.join(' / ')} 均未配置）。到 ${target.tokenUrl} 生成 Personal Access Token，` +
      'scopes 勾 Code (Read & Write) + Pull Request (Read & Write)；' +
      `Windows 持久化：setx ${keys[0]} "<PAT>"（多台服务器按主机分存，单台用 TFS_PAT；新开终端生效）；` +
      'Linux/macOS：在 shell profile 中 export；' +
      `自检：node "${scriptPath}" whoami。` +
      'PAT 不要粘贴到对话或命令行；兜底可用 --pat-file <临时文件>。'
    );
  }
  return pat;
}

function readBodyFile() {
  const f = opt('--body-file');
  if (!f) throw new UsageError('缺少 --body-file（UTF-8 正文文件；传 - 从 stdin 读取）');
  let raw;
  if (f === '-') {
    raw = fs.readFileSync(0, 'utf8');
  } else {
    if (!fs.existsSync(f)) throw new UsageError(`--body-file 不存在：${f}`);
    raw = fs.readFileSync(f, 'utf8');
  }
  raw = raw.replace(/^\uFEFF/, '');
  if (!raw.trim()) throw new UsageError('--body-file 为空');
  return raw;
}

// ---------- HTTP ----------
const authHeader = (pat) => `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;

const authHint = (status, target) => {
  if (status === 401 || status === 403) {
    return `认证失败：PAT 无效/过期/scope 不足（Code R&W + Pull Request R&W）。` +
      `到 ${target.tokenUrl} 重新生成，并确认 ${patEnvKeys(target).join(' 或 ')} 已在新进程生效。`;
  }
  if (status === 404) {
    return '404：确认 base 是集合地址（如 http://host:8080/tfs/COLLECTION）、project/repo 拼写正确。' +
      '先运行 target 子命令核对；若 API 在 8080 而 base 指向 80，用 --base 覆盖。';
  }
  return '';
};

async function request(target, pat, method, path, body, { projectLevel = true } = {}) {
  const url = projectLevel
    ? `${target.base}/${encodeURIComponent(target.project)}${path}`
    : `${target.base}${path}`;
  // URL 输出一律过 sanitizeRemote——base 内嵌 userinfo（user:pass@）时凭据不露终端（2026-10-24 复核 E3）
  if (flag('--verbose')) console.log(`> ${method} ${sanitizeRemote(url)}`);
  const headers = { Authorization: authHeader(pat), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';

  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(`请求失败 ${method} ${sanitizeRemote(url)}：${e.message}`, {
      hint: '检查 base 地址、网络/证书、代理设置。',
    });
  }

  const text = await res.text();
  const ctype = res.headers.get('content-type') || '';
  if (!/json/i.test(ctype)) {
    const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || text.slice(0, 200).replace(/\s+/g, ' ');
    throw new ApiError(`HTTP ${res.status} ${ctype || '(无 content-type)'} — ${decodeEntities(title).trim()}`, {
      status: res.status,
      hint: authHint(res.status, target) || '非 JSON 响应：确认 base / project / repo 与 api-version。',
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(`HTTP ${res.status} — 响应声明 JSON 但解析失败：${text.slice(0, 200)}`, { status: res.status });
  }
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status}: ${data.message || JSON.stringify(data).slice(0, 300)}`, {
      status: res.status,
      hint: authHint(res.status, target),
    });
  }
  return data;
}

const repoPath = (t) => `/_apis/git/repositories/${encodeURIComponent(t.repo)}/pullrequests`;
const prUrl = (t, id) =>
  `${t.base}/${encodeURIComponent(t.project)}/_git/${encodeURIComponent(t.repo)}/pullrequest/${id}`;

// ---------- 分支解析 ----------
function resolveSourceBranch() {
  const explicit = opt('--source') || process.env.TFS_SOURCE || gitConfig('tfs-pr.source');
  if (explicit) return stripRef(explicit);
  const cur = currentBranch();
  if (!cur) throw new UsageError('当前处于 detached HEAD，无法推断源分支；请用 --source 指定。');
  return cur;
}

function resolveTargetBranch() {
  const explicit = opt('--target') || process.env.TFS_TARGET || gitConfig('tfs-pr.target');
  if (explicit) return stripRef(explicit);
  const remote = getRemoteName() || 'origin';
  const r = gitRun(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], { allowFail: true });
  if (r.status === 0 && asText(r.stdout).trim()) {
    const ref = asText(r.stdout).trim();
    return stripRef(ref.replace(new RegExp(`^${escapeRegex(remote)}/`), ''));
  }
  throw new UsageError(
    `无法确定目标分支：${remote}/HEAD 未设置。` +
    '用 --target <branch> 指定，或固化：git config tfs-pr.target <branch>。'
  );
}

function refExists(ref) {
  if (!ref) return false;
  const r = gitRun(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true });
  return r.status === 0;
}

function fetchBranches(remote, branches) {
  const unique = [...new Set(branches.map(stripRef).filter(Boolean))];
  if (!unique.length) return;
  const refspecs = unique.map((b) => `+refs/heads/${b}:refs/remotes/${remote}/${b}`);
  const args = ['fetch', ...(flag('--verbose') ? [] : ['--quiet']), remote, ...refspecs];
  const r = gitRun(args, { allowFail: true });
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(0, 3).join(' ');
    throw new UsageError(
      `拉取 ${unique.join(', ')} 失败${detail ? `：${detail}` : ''}。` +
      '确认分支已推送、remote 可访问；若 PR 源分支来自 fork/其他仓库，请在对应仓库中操作。' +
      '也可加 --no-fetch 使用本地已有 refs。'
    );
  }
}

function mergeTree(a, b) {
  const r = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', a, b], { encoding: 'utf8' });
  if (r.error) return { supported: false, files: [], error: r.error.message };
  if (r.status === 0) {
    return { supported: true, files: [], tree: (r.stdout || '').split(/\r?\n/)[0] || '' };
  }
  if (r.status === 1) {
    const lines = (r.stdout || '').split(/\r?\n/).filter(Boolean);
    return { supported: true, files: lines.slice(1), tree: lines[0] || '' };
  }
  return {
    supported: false,
    files: [],
    error: ((r.stderr || r.stdout || '').trim().split(/\r?\n/)[0]) || `exit ${r.status}`,
  };
}

function analyzeRefs(sourceRef, targetRef) {
  const mb = gitOut(['merge-base', sourceRef, targetRef], { allowFail: true });
  if (!mb) throw new UsageError(`找不到 ${sourceRef} 与 ${targetRef} 的共同祖先，无法比较。`);
  const diffNames = (ref) => gitOut(['diff', '--name-only', mb, ref]).split(/\r?\n/).filter(Boolean);
  const sourceChanged = diffNames(sourceRef);
  const targetChanged = diffNames(targetRef);
  const targetSet = new Set(targetChanged);
  const overlap = sourceChanged.filter((f) => targetSet.has(f));
  const conflicts = mergeTree(sourceRef, targetRef);
  return { mergeBase: mb, sourceChanged, targetChanged, overlap, conflicts };
}

function pushState(remote, sourceRef) {
  const branch = currentBranch();
  if (!branch) {
    return { branch: '', remote, upstream: '', ahead: null, behind: null, unpushed: null, note: 'detached HEAD，未比较推送状态' };
  }
  const upstream = `refs/remotes/${remote}/${branch}`;
  if (sourceRef !== 'HEAD') {
    return { branch, remote, upstream: `${remote}/${branch}`, ahead: null, behind: null, unpushed: null, note: '源 ref 不是当前 HEAD，未比较推送状态' };
  }
  if (!refExists(upstream)) {
    return { branch, remote, upstream: `${remote}/${branch}`, ahead: null, behind: null, unpushed: true, note: '远端还没有该分支（需要 push）' };
  }
  const counts = gitOut(['rev-list', '--left-right', '--count', `${upstream}...HEAD`]).split(/\s+/).map(Number);
  const behind = counts[0] || 0;
  const ahead = counts[1] || 0;
  return { branch, remote, upstream: `${remote}/${branch}`, ahead, behind, unpushed: ahead > 0, note: '' };
}

// ---------- 子命令 ----------
async function fetchPr(target, pat, id) {
  return request(target, pat, 'GET', `${repoPath(target)}/${id}?api-version=${apiVersion}`);
}

async function fetchPrs(target, pat, { status = 'active', source = '', target: targetBranch = '' } = {}) {
  const q = new URLSearchParams();
  q.set('searchCriteria.status', status);
  if (source) q.set('searchCriteria.sourceRefName', refOf(source));
  if (targetBranch) q.set('searchCriteria.targetRefName', refOf(targetBranch));
  q.set('api-version', apiVersion);
  return request(target, pat, 'GET', `/_apis/git/pullrequests?${q}`);
}

async function listPrs(t, pat) {
  const status = opt('--status') || 'active';
  const data = await fetchPrs(t, pat, { status, source: opt('--source'), target: opt('--target') });
  const rows = (data.value || []).map((p) => ({
    id: p.pullRequestId,
    status: p.status,
    mergeStatus: p.mergeStatus,
    source: stripRef(p.sourceRefName),
    target: stripRef(p.targetRefName),
    title: p.title,
    url: prUrl(t, p.pullRequestId),
  }));
  if (json) {
    printJson(rows);
    return rows;
  }
  for (const r of rows) console.log(`#${r.id} [${r.status}/${r.mergeStatus}] ${r.source} → ${r.target}  ${r.title}`);
  console.log(`共 ${rows.length} 条（status=${status}）`);
  return rows;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPr(t, pat, id) {
  const data = await fetchPr(t, pat, id);
  if (json) {
    printJson(data);
    return data;
  }
  console.log(`#${data.pullRequestId} status=${data.status} mergeStatus=${data.mergeStatus}`);
  console.log(`  ${stripRef(data.sourceRefName)} → ${stripRef(data.targetRefName)}`);
  console.log(`  ${data.title}`);
  console.log(`  description=${String(data.description || '').length} 字符`);
  console.log(`  ${prUrl(t, data.pullRequestId)}`);
  return data;
}

async function waitMerge(t, pat, id) {
  let pr;
  for (let i = 0; i < 15; i++) {
    pr = await fetchPr(t, pat, id);
    if (pr.mergeStatus && !['queued', 'notSet'].includes(pr.mergeStatus)) return pr;
    await sleep(1000);
  }
  return pr;
}

async function createPr(t, pat) {
  const source = resolveSourceBranch();
  const target = resolveTargetBranch();
  const title = opt('--title').trim();
  if (!title) throw new UsageError('create 需要 --title');
  if (source === target) throw new UsageError(`源分支与目标分支相同：${source}`);
  const description = readBodyFile();
  const payload = {
    sourceRefName: refOf(source),
    targetRefName: refOf(target),
    title,
    description,
  };

  if (flag('--dry-run')) {
    if (json) {
      printJson({
        method: 'POST',
        url: `${t.base}/${encodeURIComponent(t.project)}${repoPath(t)}?api-version=${apiVersion}`,
        source,
        target,
        title,
        descriptionLength: description.length,
      });
      return;
    }
    console.log(`> POST ${t.base}/${encodeURIComponent(t.project)}${repoPath(t)}?api-version=${apiVersion}`);
    console.log(JSON.stringify({ ...payload, description: `<${description.length} 字符>` }, null, 2));
    return;
  }

  // 幂等查询取 all（2026-10-24 复核 m6）：原只查 status=active——上一单 completed/abandoned 时查不到，
  // 重跑即建重复单。现：active 命中照旧返回 EXISTING；仅历史命中则拒绝并提示 --force-new（显式重开一轮）。
  if (!flag('--force-new')) {
    const existing = await fetchPrs(t, pat, { status: 'all', source, target });
  const samePair = (existing.value || []).filter(
    (p) => stripRef(p.sourceRefName) === source && stripRef(p.targetRefName) === target
  );
  const hit = samePair.find((p) => p.status === 'active') || samePair[0];
  if (hit) {
    const result = {
      id: hit.pullRequestId,
      status: hit.status,
      mergeStatus: hit.mergeStatus,
      url: prUrl(t, hit.pullRequestId),
      existing: true,
    };
    if (hit.status !== 'active') {
      if (json) printJson(result);
      else console.log(`EXISTING-HISTORY #${result.id} ${result.status}/${result.mergeStatus} ${result.url}`);
      throw new UsageError(`源→目标分支已存在历史 PR #${hit.pullRequestId}（${hit.status}）——确需再开一轮请加 --force-new`);
    }
    if (json) printJson(result);
    else console.log(`EXISTING #${result.id} ${result.status}/${result.mergeStatus} ${result.url}`);
    return;
  }
  }

  const created = await request(t, pat, 'POST', `${repoPath(t)}?api-version=${apiVersion}`, payload);
  const settled = await waitMerge(t, pat, created.pullRequestId);
  const result = {
    id: settled.pullRequestId,
    status: settled.status,
    mergeStatus: settled.mergeStatus,
    url: prUrl(t, settled.pullRequestId),
    existing: false,
  };
  if (json) printJson(result);
  else console.log(`CREATED #${result.id} status=${result.status} mergeStatus=${result.mergeStatus} ${result.url}`);
}

async function updateDesc(t, pat, id) {
  const description = readBodyFile();
  if (flag('--dry-run')) {
    if (json) {
      printJson({
        method: 'PATCH',
        url: `${t.base}/${encodeURIComponent(t.project)}${repoPath(t)}/${id}?api-version=${apiVersion}`,
        descriptionLength: description.length,
      });
      return;
    }
    console.log(`> PATCH ${t.base}/${encodeURIComponent(t.project)}${repoPath(t)}/${id}?api-version=${apiVersion}`);
    console.log(JSON.stringify({ description: `<${description.length} 字符>` }, null, 2));
    return;
  }

  await request(t, pat, 'PATCH', `${repoPath(t)}/${id}?api-version=${apiVersion}`, { description });
  const back = await fetchPr(t, pat, id);
  const norm = (s) => String(s || '').replace(/\r\n/g, '\n').trim();
  if (norm(back.description) !== norm(description)) {
    throw new ApiError(`描述回读不一致：写入 ${description.length} 字符，回读 ${String(back.description || '').length} 字符`);
  }
  const result = {
    id: back.pullRequestId,
    descriptionLength: String(back.description || '').length,
    url: prUrl(t, back.pullRequestId),
    updated: true,
  };
  if (json) printJson(result);
  else console.log(`UPDATED #${result.id} description=${result.descriptionLength} 字符 ${result.url}`);
}

function buildContext(t) {
  if (!isGitWorkTree()) throw new UsageError('context 需要当前目录是 git 仓库。');
  const source = resolveSourceBranch();
  const target = resolveTargetBranch();
  if (source === target) throw new UsageError(`源分支与目标分支相同：${source}`);
  const remote = getRemoteName() || 'origin';

  if (!flag('--no-fetch')) fetchBranches(remote, [target]);
  const targetRef = `refs/remotes/${remote}/${target}`;
  if (!refExists(targetRef)) {
    throw new UsageError(`本地缺少 ${targetRef}：先 git fetch ${remote} ${target}，或去掉 --no-fetch。`);
  }

  let sourceRef = '';
  if (source === currentBranch()) sourceRef = 'HEAD';
  else if (refExists(`refs/heads/${source}`)) sourceRef = source;
  else if (refExists(`refs/remotes/${remote}/${source}`)) sourceRef = `refs/remotes/${remote}/${source}`;
  if (!sourceRef) throw new UsageError(`找不到源分支 ${source}（本地与 ${remote} 都没有）。`);

  const analysis = analyzeRefs(sourceRef, targetRef);
  const range = `${targetRef}...${sourceRef}`;
  const countRaw = Number(gitOut(['rev-list', '--count', `${targetRef}..${sourceRef}`], { allowFail: true }) || 0);
  const commitCount = Number.isFinite(countRaw) ? countRaw : 0;
  const limitRaw = Number(opt('--limit'));
  const commitLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 50;
  const commits = gitOut(['log', '--no-decorate', '--oneline', `-${commitLimit}`, `${targetRef}..${sourceRef}`])
    .split(/\r?\n/).filter(Boolean);
  const nameStatus = gitOut(['diff', '--name-status', range]).split(/\r?\n/).filter(Boolean);
  const files = nameStatus.map((line) => {
    const [status, ...rest] = line.split('\t');
    return { status, path: rest.join(' -> ') };
  });
  const stat = gitOut(['diff', '--stat', range]);
  const shortstat = gitOut(['diff', '--shortstat', range]);
  const push = pushState(remote, sourceRef);
  const dirtyFiles = gitOut(['status', '--porcelain']).split(/\r?\n/).filter(Boolean);
  const patch = flag('--patch') ? gitRun(['diff', '--no-color', range], { allowFail: true }).stdout : '';

  return {
    source,
    target,
    remote,
    sourceRef,
    targetRef,
    mergeBase: analysis.mergeBase,
    commitCount,
    commits,
    files,
    nameStatus,
    stat,
    shortstat,
    overlap: analysis.overlap,
    conflicts: analysis.conflicts,
    push,
    dirty: dirtyFiles.length > 0,
    dirtyFiles: dirtyFiles.slice(0, 50),
    patch,
  };
}

function printContext(c) {
  console.log(`source=${c.source} target=${c.target} remote=${c.remote}`);
  console.log(`merge-base=${c.mergeBase}`);
  console.log(`commits=${c.commitCount}${c.commits.length < c.commitCount ? `（仅显示最近 ${c.commits.length} 条）` : ''}`);
  for (const line of c.commits) console.log(`  ${line}`);
  console.log(`changed files=${c.files.length}`);
  for (const line of c.nameStatus) console.log(`  ${line}`);
  console.log(`overlap（双方都改过的文件）=${c.overlap.length ? c.overlap.join(', ') : '无'}`);
  console.log(
    c.conflicts.supported
      ? `conflicts=${c.conflicts.files.length ? c.conflicts.files.join(', ') : '无（merge-tree clean）'}`
      : `conflicts=无法本地预检（${c.conflicts.error}）`
  );
  if (c.push.note) console.log(`push=${c.push.note}`);
  else console.log(`push=${c.push.unpushed ? `未推送 ${c.push.ahead} 个提交（behind ${c.push.behind}）` : '已推送'}`);
  console.log(`dirty=${c.dirty ? `是（${c.dirtyFiles.length >= 50 ? '50+' : c.dirtyFiles.length} 个文件）` : '否'}`);
  console.log('diffstat:');
  console.log(c.stat || '(无变更)');
  if (c.shortstat) console.log(c.shortstat);
  if (c.patch) {
    console.log('--- patch ---');
    console.log(c.patch);
  }
}

async function conflicts(t, pat, idArg) {
  const remote = getRemoteName() || 'origin';
  let source = '';
  let target = '';
  let prStatus = '';
  let mergeStatus = '';
  let prId = null;

  if (idArg) {
    const pr = await fetchPr(t, pat, idArg);
    prId = pr.pullRequestId;
    prStatus = pr.status || '';
    mergeStatus = pr.mergeStatus || '';
    source = stripRef(pr.sourceRefName);
    target = stripRef(pr.targetRefName);
  } else {
    source = stripRef(opt('--source'));
    target = stripRef(opt('--target') || resolveTargetBranch());
    if (!source) throw new UsageError('conflicts 需要 PR id，或 --source <源分支> --target <目标分支>');
  }
  if (!source || !target) throw new UsageError('conflicts 缺少源分支或目标分支。');

  if (!flag('--no-fetch')) fetchBranches(remote, [source, target]);

  const pick = (branch, preferRemote) => {
    const remoteRef = `refs/remotes/${remote}/${branch}`;
    if (preferRemote && refExists(remoteRef)) return remoteRef;
    if (branch === currentBranch()) return 'HEAD';
    if (refExists(`refs/heads/${branch}`)) return branch;
    if (refExists(remoteRef)) return remoteRef;
    return '';
  };
  const sourceRef = pick(source, !!prId);
  const targetRef = pick(target, true);
  if (!sourceRef) throw new UsageError(`找不到源分支 ${source}（本地与 ${remote} 都没有）。`);
  if (!targetRef) throw new UsageError(`找不到目标分支 ${target}（本地与 ${remote} 都没有）。`);

  const analysis = analyzeRefs(sourceRef, targetRef);
  const result = {
    id: prId,
    status: prStatus,
    mergeStatus,
    source,
    target,
    sourceRef,
    targetRef,
    mergeBase: analysis.mergeBase,
    conflictsSupported: analysis.conflicts.supported,
    conflicts: analysis.conflicts.files,
    conflictsError: analysis.conflicts.error || '',
    overlap: analysis.overlap,
    sourceChanged: analysis.sourceChanged,
    targetChanged: analysis.targetChanged,
  };

  if (json) {
    printJson(result);
    return result;
  }

  console.log(`${prId ? `PR #${prId} ` : ''}source=${source} → target=${target}${mergeStatus ? ` mergeStatus=${mergeStatus}` : ''}`);
  console.log(`merge-base=${analysis.mergeBase}`);
  console.log(
    analysis.conflicts.supported
      ? `conflicts=${analysis.conflicts.files.length ? analysis.conflicts.files.join(', ') : '无（merge-tree clean）'}`
      : `conflicts=无法本地预检（${analysis.conflicts.error}）`
  );
  console.log(`overlap（双方都改过的文件）=${analysis.overlap.length ? analysis.overlap.join(', ') : '无'}`);
  if (analysis.overlap.length && !analysis.conflicts.files.length) {
    console.log('提示：文本可自动合并，但双方改了同一批文件，仍需人工检查语义冲突。');
  }
  if (mergeStatus === 'conflicts' && analysis.conflicts.supported && !analysis.conflicts.files.length) {
    console.log('提示：服务端仍标记 conflicts，本地预检可能基于过期 refs；重新 fetch 或等待服务端刷新。');
  }
  return result;
}

async function whoami(t, pat) {
  // 部分版本（如 ADS 2020 / api-version 6.0）的 connectionData 要求预览版 API 标志，失败自动补 -preview 重试
  const hit = (v) => request(t, pat, 'GET', `/_apis/connectionData?api-version=${v}`, undefined, {
    projectLevel: false,
  });
  let data;
  try {
    data = await hit(apiVersion);
  } catch (e) {
    if (e instanceof ApiError && e.status === 400 && /preview|预览/i.test(e.message)) {
      data = await hit(`${apiVersion}-preview`);
    } else {
      throw e;
    }
  }
  const u = data.authenticatedUser || {};
  const result = {
    id: u.id || '',
    displayName: u.displayName || u.providerDisplayName || '',
    uniqueName: u.uniqueName || '',
    base: t.base,
    project: t.project,
    repo: t.repo,
    prPage: t.prPage,
  };
  if (json) {
    printJson(result);
    return result;
  }
  console.log(`authenticated: ${result.displayName || '(未知)'} <${result.uniqueName || '?'}>`);
  console.log(`base=${result.base} project=${result.project} repo=${result.repo}`);
  console.log(`prPage=${result.prPage}`);
  return result;
}

function userEnvPresence(name) {
  if (process.platform !== 'win32') return null;
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${name}','User') -ne $null`],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) return null;
  return r.stdout.trim().toLowerCase() === 'true';
}

function setup(t) {
  const keys = patEnvKeys(t);
  const hostKey = keys.length > 1 ? keys[0] : '';
  const stateOf = (name) => {
    const user = userEnvPresence(name);
    return `${name}: 进程${process.env[name] ? 'set' : 'unset'}${user === null ? '' : ` / 用户级${user ? 'set' : 'unset'}`}`;
  };
  console.log(`target: base=${t.base} project=${t.project} repo=${t.repo}`);
  if (t.remote) console.log(`remote: ${t.remote} ${t.remoteUrl}`);
  console.log(`PAT 状态: ${stateOf('TFS_PAT')}${hostKey ? `；${stateOf(hostKey)}（${hostKey} 命中优先）` : ''}`);
  console.log(`PAT 门户: ${t.tokenUrl}`);
  console.log('scopes: Code (Read & Write) + Pull Request (Read & Write)');
  console.log(hostKey
    ? `Windows 持久化: setx ${hostKey} "<PAT>"（多台服务器按主机分存；单台也可 setx TFS_PAT "<PAT>"）——新开终端后生效`
    : 'Windows 持久化: setx TFS_PAT "<PAT>"  （新开终端后生效）');
  console.log('Linux/macOS: 在 ~/.bashrc 或 ~/.zshrc 中 export <变量名>="<PAT>"，重开终端');
  console.log(`自检: node "${scriptPath}" whoami`);
  console.log('目标分支固化（可选）: git config tfs-pr.target <branch>');
}

function usage() {
  console.log(`tfs-pr — 内网 TFS / Azure DevOps Server PR 工具

用法（脚本位于本技能目录 scripts/tfs-pr.mjs）:
  target | --print-target        解析并打印 base/project/repo/remote（不发请求）
  setup                          打印 PAT 配置指引（门户地址由 base 推导）
  whoami                         验证 PAT 并显示当前身份
  list [--source b] [--target b] [--status active|all] [--json]
  get <id> [--json]
  context [--source b] [--target b] [--no-fetch] [--patch] [--json]
  create [--source b] [--target b] --title t --body-file f|- [--dry-run] [--json]
  desc <id> --body-file f|- [--dry-run] [--json]
  conflicts <id> [--no-fetch] [--json]
  conflicts --source b --target b [--no-fetch] [--json]

通用选项: --base --project --repo --remote --api-version --verbose --pat-file
环境变量: TFS_PAT（可按主机分存 TFS_PAT_<HOST>，命中优先） TFS_BASE TFS_PROJECT TFS_REPO TFS_REMOTE TFS_WEB_PORT TFS_WEB_SCHEME TFS_API_VERSION TFS_TARGET TFS_SOURCE
退出码: 0 成功 / 1 HTTP/API/网络错误 / 2 用法或配置错误`);
}

// ---------- 入口 ----------
async function main() {
  if (flag('--help') || flag('-h')) {
    usage();
    return;
  }
  if (flag('--print-target') || cmd === 'target') {
    printJson(resolveTarget());
    return;
  }
  if (!cmd) {
    usage();
    process.exitCode = 2;
    return;
  }

  const known = new Set(['setup', 'whoami', 'list', 'get', 'create', 'desc', 'context', 'conflicts']);
  if (!known.has(cmd)) throw new UsageError(`未知子命令：${cmd}（可用：${[...known].join(', ')}）`);

  const t = resolveTarget();
  if (cmd === 'setup') {
    setup(t);
    return;
  }
  if (cmd === 'context') {
    const c = buildContext(t);
    if (json) printJson(c);
    else printContext(c);
    return;
  }

  // 位置参数 PR id：只认未被带值 flag 消费的独立数字参数——`conflicts --source 123 --target x` 的
  // 123 是 flag 值不是 id（2026-10-24 复核 E4：纯数字分支名曾被误判进 PR-id 模式发 HTTP）
  const VALUE_FLAGS = new Set(['--source', '--target', '--body-file', '--base', '--project', '--repo', '--remote', '--status', '--limit', '--api-version', '--pat-file']);
  let idArg = '';
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a) && !a.includes('=')) i++; // 空格分隔的带值 flag 连值一起跳
      continue;
    }
    if (/^\d+$/.test(a)) { idArg = a; break; }
  }
  if ((cmd === 'get' || cmd === 'desc') && !idArg) throw new UsageError(`${cmd} 需要一个数字 PR id`);

  const dryRun = flag('--dry-run') && (cmd === 'create' || cmd === 'desc');
  const localConflicts = cmd === 'conflicts' && !idArg;
  const pat = dryRun || localConflicts ? '' : resolvePat(t);

  if (cmd === 'whoami') await whoami(t, pat);
  else if (cmd === 'list') await listPrs(t, pat);
  else if (cmd === 'get') await getPr(t, pat, idArg);
  else if (cmd === 'create') await createPr(t, pat);
  else if (cmd === 'desc') await updateDesc(t, pat, idArg);
  else if (cmd === 'conflicts') await conflicts(t, pat, idArg);
}

main().catch((e) => {
  if (e instanceof UsageError) die(e.message, 2);
  if (e instanceof ApiError) {
    console.error(`tfs-pr: ${e.message}`);
    if (e.hint) console.error(`tfs-pr: ${e.hint}`);
    process.exit(1);
  }
  die(`未预期错误：${e && e.stack ? e.stack : e}`, 1);
});
