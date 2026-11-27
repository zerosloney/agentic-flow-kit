#!/usr/bin/env node
// ci-install-gitleaks — CI agent 尽力装机 gitleaks 至 .agents/tools/（2026-10-15 papercut 消债；
//   2026-10-29 改「尽力而为」：装不上不再拦 build）。
// 背景：verify 安全段 secrets-scan（check-secrets.mjs）解析序 = GITLEAKS_BIN → PATH → .agents/tools/。
//   2026-10-29 起三处皆缺时不再 loud-skip，而是自动接续纯 Node 兜底扫描（check-secrets-lite.mjs）。
//   故 CI 装机失败不再等于「密钥门不设防」——只等于「执法者降级为 lite」，不该拦整条流水线。
// 行为：
//   ① PATH 上已有匹配版本 → 幂等直过；② .agents/tools/ 已有匹配版本 → 幂等直过；
//   ③ 否则从 GitHub releases 下产物：版本与 SHA-256 双固定（官方 gitleaks_<version>_checksums.txt），
//      校验不符/重定向目标不受信即放弃装机（下载 20s 超时、解压/核验失败均不阻断）；
//   ④ 任何失败 = exit 0 + 醒目告警（交由 check-secrets 的 lite 兜底），只有提示信息写日志。
// 需要「装不上就红」的场合：设 SECRETS_SCAN_REQUIRE_GITLEAKS=1（check-secrets 会 fail-closed exit 2）。
// 版本锚 8.30.1：与本机及基线生成口径一致（runtime-env §6.3）。agent = 自托管 Windows（池 JAMTC），
//   解压走 PowerShell Expand-Archive；非 win32 回退 tar -xf（bsdtar 可解 tar.gz），供他日换池。
// checkout clean:true 每跑重装（.agents/tools/ 在工作区内随清）——~10MB/跑 换确定性，缓存化留待再登记。
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERSION = '8.30.1';
const win = process.platform === 'win32';
const plat = win ? 'windows_x64' : 'linux_x64';
// 审计修复 2026-11-27：下载产物必须按官方 checksums 固定 SHA-256 后才解压/执行；
// linux 官方只发 tar.gz（zip 资产不存在，旧 URL 404）。测试/镜像可用 GITLEAKS_RELEASE_BASE 覆盖，
// 内容仍受下面的 SHA-256 锚定。
const ASSETS = {
  windows_x64: { file: `gitleaks_${VERSION}_windows_x64.zip`, sha256: 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e' },
  linux_x64: { file: `gitleaks_${VERSION}_linux_x64.tar.gz`, sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb' },
};
const ASSET = ASSETS[plat];
const RELEASE_BASE = process.env.GITLEAKS_RELEASE_BASE || `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}`;
const DOWNLOAD_URL = `${RELEASE_BASE}/${ASSET.file}`;
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const toolsDir = process.env.GITLEAKS_TOOLS_DIR || path.join(ROOT, '.agents', 'tools');
const bin = path.join(toolsDir, win ? 'gitleaks.exe' : 'gitleaks');

const ok = (cmd) => spawnSync(cmd, ['version'], { encoding: 'utf8' });
const skip = (why) => {
  console.log(`[ci-install-gitleaks] ⏭️ ${why}——密钥门执法者降级为 lite（纯 Node 兜底扫描，仍执法）；需要强执法面请把 gitleaks 预装到 agent PATH（runtime-env §6.3）`);
  process.exit(0);
};

// ① PATH 上已有（运维预装的退路）
const onPath = ok('gitleaks');
if (onPath.status === 0 && String(onPath.stdout).includes(VERSION)) {
  console.log(`[ci-install-gitleaks] 已装于 PATH（${VERSION}）——幂等跳过下载`);
  process.exit(0);
}

// ② 工作区工具目录已有
if (fs.existsSync(bin)) {
  const p = ok(bin);
  if (p.status === 0 && String(p.stdout).includes(VERSION)) {
    console.log(`[ci-install-gitleaks] 已装机 ${VERSION}（${bin}）——幂等跳过下载`);
    process.exit(0);
  }
  console.error('[ci-install-gitleaks] 既有二进制版本核验异常，尝试重装覆盖');
}

fs.mkdirSync(toolsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitleaks-ci-'));
const zip = path.join(tmp, 'gitleaks.zip');
console.log(`[ci-install-gitleaks] 下载 ${DOWNLOAD_URL}`);

// 重定向不盲从：逐跳只允许 https + GitHub 资产域名（release 下载会 302 到签名 URL）。
const REDIRECT_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
function nextHop(from, location) {
  const next = new URL(location, from);
  if (next.protocol !== 'https:' || !REDIRECT_HOSTS.has(next.hostname)) {
    throw new Error(`重定向目标不受信：${next.href}`);
  }
  return next.href;
}
async function download(url) {
  let current = url;
  for (let hop = 0; hop <= 3; hop += 1) {
    const res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`HTTP ${res.status} 缺少 Location`);
      current = nextHop(current, location);
      continue;
    }
    return res;
  }
  throw new Error('重定向次数过多');
}

let buf;
try {
  const res = await download(DOWNLOAD_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // body 读取同样受 20s 超时约束：超时/断开都必须落到 skip（exit 0），不能抛到顶层。
  buf = Buffer.from(await res.arrayBuffer());
} catch (e) {
  skip(`下载失败（${e.name === 'TimeoutError' ? '20s 超时' : e.code || e.message}；agent 可能不通外网）`);
}
const digest = createHash('sha256').update(buf).digest('hex');
if (digest !== ASSET.sha256) {
  skip(`SHA-256 不匹配（期望 ${ASSET.sha256}，实得 ${digest}）——拒绝解压/执行未核验产物`);
}
fs.writeFileSync(zip, buf);

const extract = win
  ? spawnSync('powershell', ['-NoProfile', '-Command', 'Expand-Archive', '-Path', zip, '-DestinationPath', tmp, '-Force'], { encoding: 'utf8' })
  : spawnSync('tar', ['-xf', zip, '-C', tmp], { encoding: 'utf8' });
if (extract.status !== 0) skip(`解压失败：${extract.stderr || '(无 stderr)'}`);
const inner = path.join(tmp, win ? 'gitleaks.exe' : 'gitleaks');
if (!fs.existsSync(inner)) skip(`解压产物缺 ${inner}（产物结构变更？）`);
fs.copyFileSync(inner, bin);
fs.rmSync(tmp, { recursive: true, force: true });

const p = ok(bin);
if (p.status !== 0 || !String(p.stdout).includes(VERSION)) skip(`装机后版本核验失败（exit ${p.status}，out：${p.stdout}）`);
console.log(`[ci-install-gitleaks] ✅ gitleaks ${VERSION} 装机完成：${bin}——check-secrets 将用 gitleaks 强执法`);
