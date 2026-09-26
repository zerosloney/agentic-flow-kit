#!/usr/bin/env node
// confirm-doc — 用户确认门（2026-09-26 confirm-gate-machine）
// 唯一确认入口：workflow/{intents,specs,plans} 文档的状态确认跳转（draft→approved 起草确认 /
//   approved→done 关单确认）。AI 不得直接改状态字段做确认跳转——check-loop 检查 15 按「确认指纹 +
//   台账配对」对账，无记录即 hard-block。
// 核心防线（TTY 门）：非交互环境直接拒绝——AI 会话的 spawnSync 无 TTY，本脚本在 AI 手里跑不起来；
//   确认事件（终端键入「可以」）只能由用户在真实终端亲手产生。
// 台账：.agents/confirmations.jsonl（入 git、追加式）——每行 {ts, doc, stage, fingerprint(64位), prev}。
// 指纹：内容 CRLF 归一 → 剔除「确认指纹:」行（防自引用）→ sha256；frontmatter 存前 16 位，台账存全量。
// 用法：node .agents/scripts/confirm-doc.mjs <workflow/intents|x.md> [<doc2>...]   [--root <仓库根>]
//   多文档一次传入，逐份打印全文过目、逐份键入「可以」、逐份落态记账。
// 测试：node templates/_agents/scripts/confirm-doc.test.mjs（纯函数逐项 + 非 TTY spawn 拒绝断言）
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// computeFingerprint(text)：CRLF 归一 → 剔指纹行 → sha256 hex（64 位）
export function computeFingerprint(text) {
  const norm = String(text).replace(/\r\n/g, '\n').split('\n')
    .filter((l) => !/^确认指纹:/.test(l))
    .join('\n');
  return createHash('sha256').update(norm, 'utf8').digest('hex');
}

// nextStage(status)：唯一合法前向跳转；其余（done/superseded/cancelled/缺失）返回 null
export function nextStage(status) {
  if (status === 'draft') return 'approved';
  if (status === 'approved') return 'done';
  return null;
}

// applyTransition(text, targetStage, fingerprint16)：frontmatter 内只改「状态:」行值 + 增/换「确认指纹:」行，
// 其余字节原样保留；无 frontmatter（首行非 ---）或未闭合 → 返回 null（调用方跳过不写）
export function applyTransition(text, targetStage, fingerprint16) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  if (!/^---\s*$/.test(lines[0] || '')) return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) { end = i; break; }
  }
  if (end === -1) return null;
  let hasStatus = false;
  let hasFp = false;
  for (let i = 1; i < end; i++) {
    if (!hasStatus && /^状态:/.test(lines[i])) { lines[i] = `状态: ${targetStage}`; hasStatus = true; }
    else if (!hasFp && /^确认指纹:/.test(lines[i])) { lines[i] = `确认指纹: ${fingerprint16}`; hasFp = true; }
  }
  const fm = lines.slice(1, end);
  if (!hasStatus) fm.unshift(`状态: ${targetStage}`); // 防御：无状态键本应被 nextStage 拦，不至此
  if (!hasFp) fm.push(`确认指纹: ${fingerprint16}`);
  return [lines[0], ...fm, ...lines.slice(end)].join('\n');
}

// appendLedger(root, entry)：追加一行 JSON（目录不存在自动建；只 append 不重写）
export function appendLedger(root, entry) {
  const p = path.join(root, '.agents', 'confirmations.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(entry) + '\n');
  return p;
}

const DOC_RE = /^workflow\/(intents|specs|plans)\/[^/]+\.md$/;

const isMain = process.argv[1] && process.argv[1].endsWith('confirm-doc.mjs');
if (isMain) {
  // TTY 门最先（先于参数校验）：AI 会话内任何调用形态一律拒绝
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('确认门须由用户在终端亲手运行（node .agents/scripts/confirm-doc.mjs <workflow/文档>...）——AI 会话内不可代确认');
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  let root = process.cwd();
  const docs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else docs.push(argv[i].replace(/\\/g, '/'));
  }
  if (!docs.length) {
    console.error('用法：node .agents/scripts/confirm-doc.mjs <workflow/intents|specs|plans/x.md> [...]  [--root <仓库根>]');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));
  let confirmed = 0;
  for (const doc of docs) {
    if (!DOC_RE.test(doc)) {
      console.error(`跳过 ${doc}：路径须匹配 workflow/{intents,specs,plans}/<文件>.md`);
      continue;
    }
    const abs = path.join(root, doc);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); }
    catch { console.error(`跳过 ${doc}：文件不可读`); continue; }
    // 状态键只在 frontmatter 区（首 --- 至闭合 ---）取——防正文误命中
    const nl = text.replace(/\r\n/g, '\n').split('\n');
    let st = '';
    if (/^---\s*$/.test(nl[0] || '')) {
      for (let i = 1; i < nl.length && !/^---\s*$/.test(nl[i]); i++) {
        const m = nl[i].match(/^状态:\s*(.*)$/);
        if (m) { st = m[1].trim(); break; }
      }
    }
    const target = nextStage(st);
    if (!target) {
      console.error(`跳过 ${doc}：当前状态「${st || '缺失'}」无合法前向跳转（仅 draft→approved / approved→done）`);
      continue;
    }
    const fp = computeFingerprint(text);
    console.log('\n'.repeat(3) + '='.repeat(72));
    console.log(`文档：${doc}    状态：${st} → ${target}    指纹：${fp.slice(0, 16)}`);
    console.log('='.repeat(72));
    console.log(text);
    console.log('='.repeat(72));
    const ans = (await ask(`键入"可以"确认本份（${st} → ${target}），其他任意输入跳过：`)).trim();
    if (ans !== '可以') {
      console.log(`× 已跳过 ${doc}（未落状态）`);
      continue;
    }
    fs.writeFileSync(abs, applyTransition(text, target, fp.slice(0, 16)));
    appendLedger(root, { ts: new Date().toISOString(), doc, stage: target, fingerprint: fp, prev: st });
    console.log(`✓ ${doc} → ${target}（指纹 ${fp.slice(0, 16)}，台账已记）`);
    confirmed++;
  }
  rl.close();
  console.log(`\n完成：确认 ${confirmed} 份 / 跳过 ${docs.length - confirmed} 份`);
  process.exit(0);
}
export default { computeFingerprint, nextStage, applyTransition, appendLedger };
