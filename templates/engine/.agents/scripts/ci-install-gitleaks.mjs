#!/usr/bin/env node
// ci-install-gitleaks — CI agent 尽力装机 gitleaks 至 .agents/tools/（2026-10-15 papercut 消债；
//   2026-10-29 改「尽力而为」：装不上不再拦 build）。
// 背景：verify 安全段 secrets-scan（check-secrets.mjs）解析序 = GITLEAKS_BIN → PATH → .agents/tools/。
//   2026-10-29 起三处皆缺时不再 loud-skip，而是自动接续纯 Node 兜底扫描（check-secrets-lite.mjs）。
//   故 CI 装机失败不再等于「密钥门不设防」——只等于「执法者降级为 lite」，不该拦整条流水线。
// 行为：
//   ① PATH 上已有匹配版本 → 幂等直过；② .agents/tools/ 已有匹配版本 → 幂等直过；
//   ③ 否则从 GitHub releases 下 zip 解压（下载 20s 超时、解压/核验失败均不阻断）；
//   ④ 任何失败 = exit 0 + 醒目告警（交由 check-secrets 的 lite 兜底），只有提示信息写日志。
// 需要「装不上就红」的场合：设 SECRETS_SCAN_REQUIRE_GITLEAKS=1（check-secrets 会 fail-closed exit 2）。
// 版本锚 8.30.1：与本机及基线生成口径一致（runtime-env §6.3）。agent = 自托管 Windows（池 JAMTC），
//   解压走 PowerShell Expand-Archive；非 win32 回退 tar -xf（bsdtar 可解 zip），供他日换池。
// checkout clean:true 每跑重装（.agents/tools/ 在工作区内随清）——~10MB/跑 换确定性，缓存化留待再登记。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERSION = '8.30.1';
const win = process.platform === 'win32';
const plat = win ? 'windows_x64' : 'linux_x64';
const URL = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_${plat}.zip`;
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
console.log(`[ci-install-gitleaks] 下载 ${URL}`);
let res;
try {
  res = await fetch(URL, { signal: AbortSignal.timeout(20000) });
} catch (e) {
  skip(`下载失败（${e.name === 'TimeoutError' ? '20s 超时' : e.code || e.message}；agent 可能不通外网）`);
}
if (!res.ok) skip(`下载失败 HTTP ${res.status}`);
fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

const extract = win
  ? spawnSync('powershell', ['-NoProfile', '-Command', 'Expand-Archive', '-Path', zip, '-DestinationPath', tmp, '-Force'], { encoding: 'utf8' })
  : spawnSync('tar', ['-xf', zip, '-C', tmp], { encoding: 'utf8' });
if (extract.status !== 0) skip(`解压失败：${extract.stderr || '(无 stderr)'}`);
const inner = path.join(tmp, win ? 'gitleaks.exe' : 'gitleaks');
if (!fs.existsSync(inner)) skip(`解压产物缺 ${inner}（zip 结构变更？）`);
fs.copyFileSync(inner, bin);
fs.rmSync(tmp, { recursive: true, force: true });

const p = ok(bin);
if (p.status !== 0 || !String(p.stdout).includes(VERSION)) skip(`装机后版本核验失败（exit ${p.status}，out：${p.stdout}）`);
console.log(`[ci-install-gitleaks] ✅ gitleaks ${VERSION} 装机完成：${bin}——check-secrets 将用 gitleaks 强执法`);
