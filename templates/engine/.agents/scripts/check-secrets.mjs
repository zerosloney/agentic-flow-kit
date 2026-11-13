#!/usr/bin/env node
// check-secrets：密钥扫描门（2026-10-14 决定 4 / G5 安全插队；机制台账已登记）
// 用法：flow-kit run check-secrets.mjs [--staged] [--lite]
//   默认     = 全量历史：gitleaks detect --baseline-path .gitleaks-baseline.json（基线外新泄漏 exit 1）
//   --staged = 提交增量：gitleaks protect --staged（只看暂存内容，历史存量不触；原 pre-commit 消费——
//              2026-10-21 owner 指令「密钥本地不扫」退役该腿，旗标保留供手动/测试）
//   SECRETS_SCAN_BASE=<sha>（2026-10-29 secrets-incr，verify 默认档注入）= 范围增量：只扫 <sha>..HEAD
//     新提交（锚点 = 最近绿行头，经 verify 的祖先校验——历史被 rebase 改写则锚失效回落全量）；
//     覆盖链 = 每次绿行扫过锚..当刻，逐次滚动；全量兜底仍由 --full 本地档与 CI main 重档承担。
//     基线（存量豁免）在两种模式下同样适用。sha 解析不出 → loud WARN + 回退全量（fail-safe）。
// 二进制解析序（机理登记 = .agents/notes/runtime-env.md §6.3 gitleaks 条）：
//   GITLEAKS_BIN 环境变量（.mjs/.js 结尾经本进程 node 直跑——测试注缝）→ PATH 上 gitleaks
//   → .agents/tools/gitleaks(.exe)（git-ignore，机器本地）。
// **2026-10-29 兜底（owner 口径「装不上也要扫」）**：三处皆缺（典型 = CI agent 无外网/无法落二进制），
//   改走纯 Node 轻量扫描 check-secrets-lite.mjs（零二进制零网络，复用同一份基线做文件级豁免）——
//   **不再 loud-skip**：密钥门从此恒执法，只是执法者按环境降级（gitleaks → lite）。
//   强制指定：SECRETS_SCAN_LITE=1 或 --lite 跳过 gitleaks；SECRETS_SCAN_REQUIRE_GITLEAKS=1 则缺二进制即
//   fail-closed（exit 2，供需要强执法面的场合）。降级事实在输出首行标明「执法者=lite」，绿行 envSkips 不再登记。
// 基线：.gitleaks-baseline.json = 2026-10-14 历史全量 1221 处存量豁免（--redact 生成；用户拍板
//   「豁免清单」，真实有效密钥的作废轮换另行处置，不因基线豁免）。2026-10-15 同口径重生成扩至 1227 处：
//   追加 7bd06ebb（新大洋-物资需求提报原始动作脚本）6 处「权限Key」uuid——用户确认系旧系统权限条目
//   标识符非凭证，与既有 wiki 产品需求采集物同类同处置。2026-10-24 再生成扩至 1230 处：追加
//   e6f33915/919e7084 私有 npm 源 _auth 3 处（frontend/.npmrc ×2 + 文档抄录 ×1，同凭据家族）——
//   用户拍板「公司私有 npm 源（101.101.118.58:8089）Basic 认证凭据豁免，不作废轮换，下次不再扫」。
//   2026-10-31 再扩至 1236 处：追加 9ce8649e 的 5 处「rowKey」GUID（workflow/evidence/2026-10-31-username-caliber/probe.json
//   ——前后端 UI 实测证据里人员表格的行 key = BasicConfig_Staff.ID）——**用户拍板「追加基线豁免 5 条（与 2026-10-15 先例同口径）」**，
//   确认系人员标识符非凭证（同文件另有 177 个 GUID 因字段名不含 key 未被判，属规则按字段名启发式命中）。
//   前向已把该字段值掩码为 <uuid> 并补 rowKeyKind 声明（5ace48f1）；本次豁免用于让范围基线 9b8bc5cd..HEAD 内的历史提交 9ce8649e 不再命中。
//   detect 模式基线缺失 = exit 2
//   （配置失守 fail-closed——静默无基线会让存量全量爆红，与拍板相反）。
// 测试面已随引擎减重退役（2026-10-28，owner 决策），本脚本现无测试兜底
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main as liteMain } from './check-secrets-lite.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOW_KIT_PROJECT_ROOT || process.env.CHECK_SECRETS_ROOT || path.resolve(SCRIPT_DIR, '..', '..');
const STAGED = process.argv.includes('--staged');
const FORCE_LITE = process.argv.includes('--lite') || process.env.SECRETS_SCAN_LITE === '1';
const BASELINE = path.join(ROOT, '.gitleaks-baseline.json');

function resolveBin() {
  if (FORCE_LITE) return null;
  const envBin = process.env.GITLEAKS_BIN;
  if (envBin) {
    if (!fs.existsSync(envBin)) return null;
    return /\.(mjs|js)$/i.test(envBin) ? { node: envBin } : { raw: envBin };
  }
  const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
  if (probe.status === 0) return { raw: 'gitleaks' };
  const local = path.join(ROOT, '.agents', 'tools', process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  if (fs.existsSync(local)) return { raw: local };
  return null;
}

// 扫描范围（2026-10-29 secrets-incr）：SECRETS_SCAN_BASE 给定且可解析 → 只扫 base..HEAD；
// 未给定 / 解析不出 → 全量（后者加 loud WARN，fail-safe 不静默）。
let range = null;
if (!STAGED && process.env.SECRETS_SCAN_BASE) {
  const base = process.env.SECRETS_SCAN_BASE;
  const probe = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { cwd: ROOT, encoding: 'utf8' });
  if (probe.status === 0) {
    range = `${base.trim()}..HEAD`;
  } else {
    console.error(`[check-secrets] ⚠️ SECRETS_SCAN_BASE="${base}" 解析不出（非本仓提交/被改写？）——回退全量历史扫描`);
  }
}

const scanRangeNote = STAGED ? '暂存增量' : range ? `增量范围 ${range}` : '全量';

const bin = resolveBin();
if (!bin) {
  if (process.env.SECRETS_SCAN_REQUIRE_GITLEAKS === '1' && !FORCE_LITE) {
    console.error('[check-secrets] ❌ SECRETS_SCAN_REQUIRE_GITLEAKS=1 但 gitleaks 三处解析皆缺——按配置 fail-closed 拦下（装机见 .agents/notes/runtime-env.md §6.3）');
    process.exit(2);
  }
  if (!STAGED && !fs.existsSync(BASELINE)) {
    console.error(`[check-secrets] ❌ 基线缺失 ${BASELINE}——轻量扫描同样依赖豁免清单，拒跑。重建：gitleaks detect --redact 全量报告存为该文件（口径见 runtime-env §6.3）`);
    process.exit(2);
  }
  console.error(`[check-secrets] ℹ️ 执法者=lite（gitleaks 不可用${FORCE_LITE ? '／已强制 --lite' : '——未装或 CI 无外网'}）：纯 Node 轻量规则 + 同一基线文件级豁免；强执法面（全史逐行模式匹配）请装 gitleaks（runtime-env.md §6.3）`);
  const liteArgs = STAGED ? ['--staged'] : range ? ['--range', range] : [];
  process.exit(liteMain(liteArgs, ROOT));
}

if (!STAGED && !fs.existsSync(BASELINE)) {
  console.error(`[check-secrets] ❌ 基线缺失 ${BASELINE}——detect 无基线 = 存量豁免失效全量爆红，拒跑。重建：gitleaks detect --redact 全量报告存为该文件（口径见 runtime-env §6.3）`);
  process.exit(2);
}
console.log(`[check-secrets] 执法者=gitleaks（${bin.raw || bin.node}）`);
const args = STAGED
  ? ['protect', '--staged', '--redact', '--no-banner']
  : ['detect', '--source', '.', '--baseline-path', BASELINE, '--redact', '--no-banner',
    ...(range ? ['--log-opts', range] : [])];
const r = bin.node
  ? spawnSync(process.execPath, [bin.node, ...args], { stdio: 'inherit' })
  : spawnSync(bin.raw, args, { stdio: 'inherit' });
if (r.status !== 0) {
  console.error(`[check-secrets] ❌ ${STAGED ? '暂存内容' : range ? `增量范围（${range}，基线外）` : '历史（基线外）'}发现密钥泄漏（gitleaks exit ${r.status}）——上方为 redacted 明细；新泄漏修法：删除该密钥或作废轮换，禁改基线豁免`);
  process.exit(r.status ?? 1);
}
console.log(`[check-secrets] ✅ 执法者=gitleaks｜${scanRangeNote}（基线外）无泄漏`);
