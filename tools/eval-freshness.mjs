#!/usr/bin/env node
// eval-freshness — 引擎侧（BACKLOG #30）定时复算「出厂行为评测凭证」的新鲜度（确定性漂移检测）。
// 口径：临时目录 git init 后装 claude/node zh（默认）+ en 两棵新装树，分别跑 agent-eval 的 treeSignature，
//       与 BACKLOG.md 最后一次「签名定型 <hex>[/<hex>]」逐树比对；定型日取该处向上最近的「（YYYY-MM-DD」
//       （含同行后缀；找不到 → age=unknown）；漂移或 age 超有效期（loadConfig/DEFAULT_CONFIG.maxAgeDays，
//       不自造数字）→ action-needed。
// 假设与边界：凭证假设 = claude/node 双语安装树（多 profile 矩阵不做）；签名只覆盖 .agents 敏感面、与宿主
//       无关；定型值按仓内惯例记全量签名的前缀，比对按「记录值是 computed 签名前缀」判等。
// advisory：drift / stale / 无基线一律 exit 0 + 明显 WARN/OK 行，不判红；只有真实异常（安装失败、BACKLOG
//       读不到、--check 参数坏）exit 1。
// 闭环：行为双臂重评需模型运行时，CI 不具备——本工具只做确定性检测、不复跑行为评测；漂移 → issue →
//       人工重评 → 新「签名定型 <zh>/<en>」写入 BACKLOG.md → 下周复绿。
// 用法：node tools/eval-freshness.mjs [--json] [--backlog <file>] [--check <zhHex>[/<enHex>]]
//       --json stdout 纯 JSON（供工作流拼 issue 正文）；--check 跳过安装直接比对给定签名（测试口/手工口）；
//       --backlog 以指定文件替代仓库 BACKLOG.md（合成基线测试口）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { treeSignature, loadConfig, DEFAULT_CONFIG } from '../templates/engine/.agents/scripts/agent-eval.mjs';

const KIT = path.resolve(import.meta.dirname, '..');
const BIN = path.join(KIT, 'bin', 'flow-kit.mjs');
const SIG_TOKEN = '签名定型';
const DATE_RE = /（(\d{4}-\d{2}-\d{2})/g;
const HEX_RE = /^[0-9a-f]{8,64}$/;

// 向上（含签名行同行后缀）找最近的「（YYYY-MM-DD」；before 内取最后一个，同行 after 有则覆盖。
function nearestDate(before, after) {
  let last = null;
  let m;
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(before))) last = m[1];
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(after))) last = m[1];
  return last;
}

// 解析 BACKLOG 文本 → { found, zh, en, date }。多次出现取最后一次能提出 hex 的；双哈希=zh/en、
// 单哈希=仅 zh；无 → found=false（loud-skip）。容忍行内 markdown 修饰（` _ * ~ 空白）。
export function parseBaseline(text) {
  const s = String(text);
  const hits = [];
  let at = s.indexOf(SIG_TOKEN);
  while (at >= 0) {
    hits.push(at);
    at = s.indexOf(SIG_TOKEN, at + SIG_TOKEN.length);
  }
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const hit = hits[i];
    const nl = s.indexOf('\n', hit);
    const lineEnd = nl < 0 ? s.length : nl;
    const after = s.slice(hit + SIG_TOKEN.length, lineEnd);
    const hm = /^[:：]?([0-9a-fA-F]{8,64})(?:\/([0-9a-fA-F]{8,64}))?/.exec(after.replace(/[`\s*_~]/g, ''));
    if (!hm) continue;
    return {
      found: true,
      zh: hm[1].toLowerCase(),
      en: hm[2] ? hm[2].toLowerCase() : null,
      date: nearestDate(s.slice(0, hit), after),
    };
  }
  return { found: false, zh: null, en: null, date: null };
}

function stampMs(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// 判定：记录值是 computed 签名前缀 → match；未提供记录值/签名值 → null（不参与漂移判定）。
// verdict：no-baseline（loud-skip）> drift（任一树 mismatch）> stale（age 超有效期）> green。
export function decideAction({ baseline, zhSig = null, enSig = null, now = Date.now(), maxAgeDays = DEFAULT_CONFIG.maxAgeDays }) {
  const cmp = (recorded, sig) => (recorded && sig ? sig.toLowerCase().startsWith(recorded) : null);
  const zhMatch = cmp(baseline.zh, zhSig);
  const enMatch = cmp(baseline.en, enSig);
  const stamp = baseline.date ? stampMs(baseline.date) : null;
  const ageDays = stamp === null ? null : Math.max(0, Math.floor((now - stamp) / 86400000));
  const drift = zhMatch === false || enMatch === false;
  const stale = ageDays !== null && ageDays > maxAgeDays;
  const verdict = !baseline.found ? 'no-baseline' : drift ? 'drift' : stale ? 'stale' : 'green';
  return { verdict, actionNeeded: drift || stale, drift, stale, ageDays, zhMatch, enMatch };
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : '';
}

function installFresh(langArgs, label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-fresh-'));
  const g = spawnSync('git', ['init', '-q'], { cwd: tmp, encoding: 'utf8', windowsHide: true });
  if (g.status !== 0) throw new Error(`git init（${tmp}）失败：${(g.stderr || '').trim()}`);
  const r = spawnSync(process.execPath, [BIN, 'install', '--agent', 'claude', '--stack', 'node', ...langArgs, '--target', tmp], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, FLOW_KIT_TEST: '1' },
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`install ${label} exit ${r.status}：${(r.stderr || r.stdout || '').trim().slice(-400)}`);
  return tmp;
}

function main() {
  const jsonMode = process.argv.includes('--json');
  const backlogPath = path.resolve(KIT, argValue('--backlog') || 'BACKLOG.md');
  const checkPair = argValue('--check');

  let baseline;
  try {
    baseline = parseBaseline(fs.readFileSync(backlogPath, 'utf8'));
  } catch (err) {
    throw new Error(`BACKLOG 读不到（${backlogPath}）：${err.message}`);
  }

  let zhSig = null;
  let enSig = null;
  let zhRoot = null;
  const tmps = [];
  try {
    if (checkPair) {
      const parts = checkPair.split('/');
      if (parts.length > 2 || !parts.every((p) => HEX_RE.test(p))) {
        throw new Error(`--check 参数应为 <zhHex>[/<enHex>]（8–64 位 hex）：${checkPair}`);
      }
      zhSig = parts[0].toLowerCase();
      enSig = parts[1] ? parts[1].toLowerCase() : null;
    } else {
      tmps.push(installFresh([], 'zh（默认）'));
      zhRoot = tmps[0];
      zhSig = treeSignature(zhRoot).signature;
      tmps.push(installFresh(['--lang', 'en'], 'en'));
      enSig = treeSignature(tmps[1]).signature;
    }
    const maxAgeDays = zhRoot ? loadConfig(zhRoot).maxAgeDays : DEFAULT_CONFIG.maxAgeDays;
    const d = decideAction({ baseline, zhSig, enSig, maxAgeDays });
    const report = {
      assumption: 'claude/node 双语安装树；签名只覆盖 .agents 敏感面（宿主无关）',
      baseline,
      ageKnown: d.ageDays !== null,
      ageDays: d.ageDays,
      maxAgeDays,
      trees: { zh: { signature: zhSig, match: d.zhMatch }, en: { signature: enSig, match: d.enMatch } },
      drift: d.drift,
      stale: d.stale,
      verdict: d.verdict,
      actionNeeded: d.actionNeeded,
      behaviorNote: '行为双臂重评需模型运行时，CI 不具备——本工具只做确定性漂移检测；漂移/过期走人工重评，重评后把新「签名定型 <zh>/<en>」写入 BACKLOG.md，下周复绿。',
    };
    if (jsonMode) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const short = (h) => (h ? `${h.slice(0, 12)}…` : '—');
    const lines = [];
    lines.push('[eval-freshness] 出厂凭证新鲜度复算（假设 claude/node zh+en 双装树；签名面=.agents 敏感面，宿主无关）');
    if (baseline.found) {
      const ageTxt = d.ageDays === null ? 'age=unknown（定型日未记）' : `age ${d.ageDays}/${maxAgeDays} 天`;
      lines.push(`[eval-freshness] 基线：签名定型 ${baseline.zh}${baseline.en ? `/${baseline.en}` : ''}（${baseline.date ? `定型 ${baseline.date}，${ageTxt}` : ageTxt}）`);
    } else {
      lines.push('[eval-freshness] WARN loud-skip：BACKLOG 未找到「签名定型 <hex>[/<hex>]」，无基线可比（advisory，不判红）');
    }
    for (const [tree, sig, recorded, match] of [['zh', zhSig, baseline.zh, d.zhMatch], ['en', enSig, baseline.en, d.enMatch]]) {
      const verdict = match === false ? 'MISMATCH（漂移）' : match === true ? 'MATCH' : '—';
      lines.push(`[eval-freshness] ${tree}：新装 ${short(sig)} vs 定型 ${recorded ?? '—'} → ${verdict}`);
    }
    if (d.actionNeeded) {
      const why = [d.drift ? '签名漂移' : null, d.stale ? `凭证过期（>${maxAgeDays} 天）` : null].filter(Boolean).join(' + ');
      lines.push(`[eval-freshness] WARN action-needed：${why} → 人工双臂行为重评（CI 无模型运行时），重评后把新「签名定型 <zh>/<en>」写入 BACKLOG.md，下周复绿`);
    } else if (!baseline.found) {
      lines.push('[eval-freshness] OK（loud-skip）：advisory 不判红；先在 BACKLOG.md 记「签名定型 <zh>/<en>」方有复算基准');
    } else {
      lines.push('[eval-freshness] OK 全绿：双树签名与出厂定型一致、未超有效期');
    }
    console.log(lines.join('\n'));
  } finally {
    for (const dir of tmps) fs.rmSync(dir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`[eval-freshness] ERROR：${err.message}`);
    process.exitCode = 1;
  }
}
