#!/usr/bin/env node
// append-compensation.mjs — 关单后裁定回填补偿行生成器（maintain.md §4；2026-10-25 source-port-batch-2，自源仓 d134be8f 回灌适配）
// 背景：终态文档（done/closed 等）确需回填裁定时，补偿行指纹若按「直接哈希当前内容」手搓，会被
//   检查 15「确认内容漂移」HARD-BLOCK（源仓 2026-10-24 实证踩坑）——正确口径 = bindingSha256：
//   状态行回填 prev 后再哈希。本工具把口径收口为单源，手搓通道退役。
// 判据单源（三处全部复用既有权威实现，禁手搓）：
//   - 指纹 = check-loop.mjs 的 bindingSha256（与检查 15 校验端同一函数）
//   - prev = 该 doc 末次同 stage 台账行的 prev（「prev 沿用原行」——补偿不改变跳转前态）
//   - 写入 = confirm-doc.mjs 的 appendLedger（分片/主台账口径与确认门同一出口，doc 链自维护）
// 拒绝面（fail-loud；防把检查 15 的绑定降级路径改造成失配 hard）：
//   - 文档非终态（approved/open 等）→ 前向跳转走 confirm-doc，无补偿面
//   - 台账无该 doc+stage 行 / 末次行缺 prev（schema 演进前存量）→ 无补偿基底，追加反而制造失配
//   - 内容未变（与末次确认行指纹一致）→ 无可补偿的漂移
//   - 缺 --quote → 用户裁定原话是补偿行的法律依据，禁空
// 用法：node .agents/scripts/append-compensation.mjs <doc...> --quote "<用户原话>"
// 测试：node .agents/scripts/append-compensation.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { bindingSha256 } from './check-loop.mjs';
import { readLedgerRows } from './ledger-loader.mjs';
import { appendLedger } from './confirm-doc.mjs';
import { loadKitPolicy, ledgerDocChainActive } from './policy.mjs';

export const TERMINAL_STAGES = ['done', 'closed', 'superseded', 'cancelled'];

// pickLastRow(rows, rel, stage)：该 doc 指定 stage 的末次台账行（append-only 末次生效，与检查 15 同口径）
export function pickLastRow(rows, rel, stage) {
  const hits = rows.filter((e) => e && e.doc === rel && e.stage === stage && typeof e.fingerprint === 'string');
  return hits.length ? hits[hits.length - 1] : null;
}

// buildCompensation(lines, stage, lastRow, quote, ts)：纯函数——产出补偿行或拒绝原因
export function buildCompensation(lines, stage, lastRow, quote, ts) {
  if (!TERMINAL_STAGES.includes(stage)) {
    return { ok: false, reason: `非终态（${stage}）——前向跳转走 confirm-doc，无补偿面` };
  }
  if (!lastRow) {
    return { ok: false, reason: `台账无 stage=${stage} 行——未经确认门落态，无补偿基底` };
  }
  if (!lastRow.prev) {
    return { ok: false, reason: `末次 stage=${stage} 行缺 prev（schema 演进前存量）——检查 15 本就绑定降级，追加补偿行反而制造失配` };
  }
  const fp = bindingSha256(lines, lastRow.prev);
  if (fp === lastRow.fingerprint) {
    return { ok: false, reason: '内容与末次确认行一致——无可补偿的漂移（先改正文再跑本工具）' };
  }
  return {
    ok: true,
    row: {
      ts, doc: lastRow.doc, stage, fingerprint: fp, prev: lastRow.prev,
      source: 'chat-delegated', quote, quoteGrounding: 'verbatim',
      batch: randomBytes(3).toString('hex'), seq: 1, of: 1,
    },
  };
}

// fmStatusOf(lines)：frontmatter（首 --- 块）内「状态:」值；无 frontmatter/键 → ''
export function fmStatusOf(lines) {
  if (!/^---\s*$/.test(lines[0] || '')) return '';
  const end = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
  for (let i = 1; i > 0 && i < (end === -1 ? lines.length : end); i++) {
    const m = lines[i].match(/^状态:\s*(\S+)/);
    if (m) return m[1];
  }
  return '';
}

function main() {
  const args = process.argv.slice(2);
  const docs = [];
  let quote = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--quote') quote = args[++i] ?? '';
    else docs.push(args[i]);
  }
  if (!docs.length || !quote) {
    console.error('用法：node .agents/scripts/append-compensation.mjs <doc...> --quote "<用户原话>"');
    console.error('  done/closed 等终态文档改正文后，按 maintain.md §4 同批补重确认补偿行（指纹=bindingSha256 单源口径）');
    process.exit(2);
  }
  const root = process.cwd();
  const ledger = readLedgerRows(root);
  let fail = 0;
  for (const p of docs) {
    const rel = path.relative(root, path.resolve(p)).split(path.sep).join('/');
    let lines;
    try {
      lines = fs.readFileSync(path.resolve(p), 'utf8').split(/\r?\n/);
    } catch {
      console.error(`✗ ${rel}：文件不可读`);
      fail++;
      continue;
    }
    const stage = fmStatusOf(lines);
    const lastRow = pickLastRow(ledger, rel, stage);
    const r = buildCompensation(lines, stage, lastRow, quote, new Date().toISOString());
    if (!r.ok) {
      console.error(`✗ ${rel}：${r.reason}`);
      fail++;
      continue;
    }
    // 写入口径与 confirm-doc 生产侧单源（2026-10-25 修正）：分片默认（CONFIRM_SHARDED=0 回退主台账）
    // 且 doc 链激活（policyVersion ≥ 8）才落分片——补偿行须与该 doc 既有确认行同域，错落主台账会
    // 造成 doc 链时序倒挂（链断裂）与检查 15 末次行误取。夹具无 kit.json → v1 → 自动回退主台账。
    const shardWrite = process.env.CONFIRM_SHARDED !== '0' && ledgerDocChainActive(loadKitPolicy(root));
    appendLedger(root, r.row, { shard: shardWrite });
    console.log(`✓ ${rel} ${stage} 补偿行（prev=${r.row.prev}，指纹 ${r.row.fingerprint.slice(0, 16)}，quote=「${quote}」）`);
  }
  if (fail) console.error(`完成：${docs.length - fail} 成功 / ${fail} 拒绝`);
  process.exitCode = fail ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
