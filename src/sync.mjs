// flow-kit sync：按 .agents/kit.json 台账升级 managed 文件。
// 三态：未改动（磁盘 sha==台账）→ 覆盖新版；本地已改 → 跳过并报告（--force 覆盖；台账保持包侧基线，
//       每次持续报告直至 --force 或本地对齐新版——防跳过一次后下次升级被静默覆盖，2026-09-24 语义修正）；
//       生成器目标（INDEX.md / wiki 看板）→ 不比对，收尾重跑生成器走锚点重写。
// 附带：包内新增 managed 文件 → 安装；包内已删 → 仅报告不删盘、出台账；managed 缺失 → 恢复。
// 台账外文件收养（2026-09-26 managed-ledger-adopt）：盘上存在但台账无该 rel 的 managed 类文件，
//       若内容恰好等于新版渲染 sha（diskSha === fresh.sha）则收养登记——判据与台账内「改动恰好等于新版」
//       分支同源，不存在本地独有信息可被破坏；内容不等（本地真改动）仍保守跳过且台账不登记（持续报告）。
// owned 文件永不触碰（两态模型，见 profiles.isOwned）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { renderTree, sha256, scriptTrusted } from './render.mjs';
import { HOSTS, pickStackVars, isOwned, srcTemplatePath, templateDriftOf, TEMPLATE_DRIFT_EXCLUDE } from './profiles.mjs';
import { doctor } from './doctor.mjs';

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function runNode(target, script, args = []) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: target, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

// shaText：文本件 LF 归一哈希（managed 记账与比对统一口径，2026-09-27 closing-coverage——跨 checkout
// 字节稳定：CRLF 盘面（autocrlf 检出/Edit 工具写入）与 LF 克隆同值；renderTree 写盘本为 LF，
// fresh sha 天然归一，故 ledger 记 fresh sha 后两侧自洽）
const shaText = (p) => sha256(Buffer.from(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), 'utf8'));

// 钩子文件落盘补执行位（init-p1-batch P1-1）：copyFileSync 不携带 mode，POSIX 装户 git 对不可执行钩子
// 静默跳过；FAT/网络盘 chmod 不支持时降级不中断安装
const safeChmod = (p) => { try { fs.chmodSync(p, 0o755); } catch { /* 降级 */ } };
const copyManaged = (freshFile, disk, rel) => {
  fs.copyFileSync(freshFile.abs, disk);
  if (rel.startsWith('.githooks/')) safeChmod(disk);
};

export function sync(args, pkgRoot) {
  let target = process.cwd();
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') target = path.resolve(args[++i] || fail('--dir 缺少值'));
    else if (args[i] === '--force') force = true;
    else fail(`未知选项：${args[i]}（flow-kit sync --help 看全部）`);
  }

  const kitPath = path.join(target, '.agents', 'kit.json');
  if (!fs.existsSync(kitPath)) fail(`${target} 无 .agents/kit.json——先 flow-kit init（手动安装的旧项目无台账，不支持 sync）`);
  let kit;
  try {
    kit = JSON.parse(fs.readFileSync(kitPath, 'utf8'));
  } catch (e) {
    fail(`kit.json 解析失败：${e.message}`);
  }
  const opt = kit.options || {};
  const hosts = Array.isArray(opt.hosts) ? opt.hosts : [];
  const vars = { BOARD_PORT: String(opt.boardPort || '8933'), ...pickStackVars(opt.stack) };

  const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
  console.log(`▶ flow-kit sync → ${target}（台账版本 ${kit.version} → 包版本 ${pkg.version}）`);

  // 当前包内存渲染到临时目录（只读比对源；不直接写目标——三态判定必须先于落盘）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-sync-'));
  try {
    // rel → 渲染产物（新包视角的"应有文件"清单）
    const fresh = new Map();
    const t = renderTree(path.join(pkgRoot, 'templates'), tmp, vars, { force: true });
    for (const f of t.written) fresh.set(f.rel, { sha: f.sha256, abs: path.join(tmp, f.rel) });
    for (const h of hosts) {
      if (!HOSTS[h]) continue; // 台账里的宿主已不在包支持列表——只按模板层同步
      const hr = renderTree(path.join(pkgRoot, 'modules', 'hosts', h), path.join(tmp, HOSTS[h].dir), vars, { force: true });
      for (const f of hr.written) fresh.set(`${HOSTS[h].dir}/${f.rel}`, { sha: f.sha256, abs: path.join(tmp, HOSTS[h].dir, f.rel) });
    }

    const ledger = new Map((kit.managed || []).map((f) => [f.rel, f.sha256]));
    const updated = [], skipped = [], restored = [], added = [], removed = [], newOwned = [], adopted = [];
    let unchanged = 0;
    const managedNew = [];

    // 台账内文件：三方比对（台账 sha / 磁盘 sha / 新渲染 sha）
    for (const [rel, ledgerSha] of ledger) {
      const disk = path.join(target, rel);
      const freshFile = fresh.get(rel);
      if (!freshFile) {
        removed.push(rel);
        continue; // 包内已删：文件留在盘上，出台账（下次不再跟踪）
      }
      const diskSha = fs.existsSync(disk) ? shaText(disk) : null;
      if (diskSha === null) {
        fs.mkdirSync(path.dirname(disk), { recursive: true }); // 父目录可能整目录缺失（如 localOnly 宿主目录被清），copyfile 不建目录
        copyManaged(freshFile, disk, rel);
        restored.push(rel);
        managedNew.push({ rel, sha256: freshFile.sha });
        continue;
      }
      if (diskSha === ledgerSha) {
        if (freshFile.sha === ledgerSha) {
          unchanged++; managedNew.push({ rel, sha256: ledgerSha });
          if (rel.startsWith('.githooks/')) safeChmod(disk); // 存量装户 0644 死钩子升级修复（复核 P2-3）
        }
        else { copyManaged(freshFile, disk, rel); updated.push(rel); managedNew.push({ rel, sha256: freshFile.sha }); }
        continue;
      }
      // 本地已改
      if (freshFile.sha === diskSha) { unchanged++; managedNew.push({ rel, sha256: diskSha }); continue; } // 改动恰好等于新版
      if (force) { copyManaged(freshFile, disk, rel); updated.push(`${rel}（--force 覆盖本地改动）`); managedNew.push({ rel, sha256: freshFile.sha }); }
      else { skipped.push(rel); managedNew.push({ rel, sha256: ledgerSha }); } // 台账保持包侧基线：持续报告「本地已改」，直到 --force 或本地对齐新版
    }

    // 台账外的新文件：managed 类安装 / 收养；owned 类只对「盘上缺失」的起步文档报告（已装的不动不报）
    for (const [rel, freshFile] of fresh) {
      if (ledger.has(rel)) continue;
      if (isOwned(rel)) {
        if (!fs.existsSync(path.join(target, rel))) newOwned.push(rel);
        continue;
      }
      const disk = path.join(target, rel);
      if (fs.existsSync(disk)) {
        // 盘上有、台账无：内容恰好等于新版 → 收养登记（与台账内「改动恰好等于新版」同判据）；
        // 内容不等 = 本地真改动 → 默认保守跳过且不登记（下次仍报「未入台账」，不会被静默覆盖）；
        // --force 下按既有语义覆盖并登记（与台账内文件的 --force 行为一致）
        const diskSha = shaText(disk);
        if (diskSha === freshFile.sha) { adopted.push(rel); managedNew.push({ rel, sha256: diskSha }); }
        else if (force) { copyManaged(freshFile, disk, rel); added.push(rel); managedNew.push({ rel, sha256: freshFile.sha }); }
        else skipped.push(`${rel}（已存在未入台账）`);
        continue;
      }
      fs.mkdirSync(path.dirname(disk), { recursive: true });
      copyManaged(freshFile, disk, rel);
      added.push(rel);
      managedNew.push({ rel, sha256: freshFile.sha });
    }

    const list = (label, arr) => { if (arr.length) console.log(`  ${label}（${arr.length}）：${arr.join('、')}`); };
    list('覆盖更新', updated);
    list('恢复缺失', restored);
    list('新增安装', added);
    list('收养登记', adopted);
    list('本地已改，跳过', skipped);
    if (skipped.some((s) => !s.includes('未入台账'))) console.log('    ↑ --force 覆盖本地改动；git diff 自查差异；台账保持包侧基线，后续 sync 持续报告直至处理');
    list('包内已移除（文件保留在盘上，可手动删除）', removed);
    list('新增 owned 起步文档（项目自持，未自动安装）', newOwned);
    if (!updated.length && !restored.length && !added.length && !adopted.length && !removed.length && !skipped.length && !newOwned.length) {
      console.log(`  已是最新（${unchanged} 份 managed 无变化）`);
    } else {
      console.log(`  无变化 ${unchanged} 份`);
    }

    // owned 台账按盘面自愈：owned 归项目所有，哈希只是记账不是约束——手改后无须手工刷 kit.json
    // （Shipyard 回流策略，2026-09-24：曾在消费仓被迫手工刷新 owned 哈希，根因收敛到此处）。
    // sha 按 LF 归一记（与 doctor checkOwnedDrift 同口径，2026-09-27 gate-coverage：跨 checkout 字节稳定）
    const ownedSha = (p) => sha256(Buffer.from(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'), 'utf8'));
    let ownedRefreshed = 0;
    if (Array.isArray(kit.owned)) {
      kit.owned = kit.owned.map((f) => {
        const p = path.join(target, f.rel);
        if (!fs.existsSync(p)) return f;
        const disk = ownedSha(p);
        if (disk === f.sha256) return f;
        ownedRefreshed++;
        return { ...f, sha256: disk };
      });
    }
    if (ownedRefreshed) console.log(`  owned 台账哈希按盘面刷新 ${ownedRefreshed} 份（owned 归项目所有，仅记账不约束）`);

    // 模板下发感知（2026-10-06 template-downstream，advisory 恒不 hard-block）：owned 模板无下发通道，
    // 源仓演进静默陈旧（S18/S20 装户事故根因）——三方 sha 判定见 profiles.templateDriftOf 单源。
    // 锚「见过即刷新」：本次 sync 见到的包源 sha 记入 srcSha256（含旧账无锚首跑写锚——写锚不出账，
    // 不追溯）；唯一出账形态 = 源已演进且盘面未跟随。GEN_TARGETS 生成器目标不期望被跟随，排除。
    const driftList = [];
    if (Array.isArray(kit.owned)) {
      kit.owned = kit.owned.map((f) => {
        if (TEMPLATE_DRIFT_EXCLUDE.has(f.rel)) return f;
        const src = srcTemplatePath(pkgRoot, f.rel);
        if (!src) return f; // 无包源模板对应（项目配置类）不参与
        const srcCur = ownedSha(src);
        const diskPath = path.join(target, f.rel);
        const disk = fs.existsSync(diskPath) ? ownedSha(diskPath) : null;
        if (templateDriftOf({ disk, srcRecord: f.srcSha256, srcCur }) === 'stale-drift') driftList.push(f.rel);
        return srcCur === f.srcSha256 ? f : { ...f, srcSha256: srcCur };
      });
    }
    if (driftList.length) {
      console.log(`  ⚠️ 模板感知（advisory）：源仓 ${driftList.length} 份模板自上次同步后有演进且盘面未跟随：${driftList.join('、')}`);
      console.log('    owned 归项目所有，不自动覆盖；如需跟随：从包源 templates/ 拷贝对应文件；有意定制可忽略（下次 sync 起静默）');
    }

    // 台账重写：版本对齐当前包；removed 出册；skipped 保持包侧基线持续报告
    kit.managed = managedNew.sort((a, b) => a.rel.localeCompare(b.rel));
    kit.version = pkg.version;
    fs.writeFileSync(kitPath, `${JSON.stringify(kit, null, 2)}\n`);

    // 生成器目标走锚点重写（不参与 sha 比对）——执行前过供应链防线（init-p1-batch P1-3）：
    // 目标侧脚本与包源渲染值 sha 一致才执行（预置/被改动的脚本不可信，跳过并显式提示）
    const genGuard = (rel) => {
      const g = scriptTrusted({ pkgRoot, target, rel, vars });
      if (!g.ok) {
        console.log(`  ⚠️ 跳过执行 ${rel}——${g.note}（供应链防线：只执行与包源渲染值一致的目标侧脚本）`);
        return false;
      }
      return true;
    };
    if (genGuard('.agents/scripts/gen-workflow-index.mjs')) {
      const genIndex = runNode(target, '.agents/scripts/gen-workflow-index.mjs');
      if (genIndex.ok || fs.existsSync(path.join(target, '.agents/scripts/gen-workflow-index.mjs'))) {
        console.log(genIndex.ok ? '  已重生成 workflow/INDEX.md（锚点内重写）' : `  ⚠️ gen-workflow-index 失败：${genIndex.out.split('\n')[0]}`);
      }
    }
    if (genGuard('.agents/scripts/gen-wiki-board.mjs')) {
      const genBoard = runNode(target, '.agents/scripts/gen-wiki-board.mjs');
      if (genBoard.ok || fs.existsSync(path.join(target, '.agents/scripts/gen-wiki-board.mjs'))) {
        console.log(genBoard.ok ? '  已重生成 wiki 速览与看板 DATA（锚点内重写）' : `  ⚠️ gen-wiki-board 失败：${genBoard.out.split('\n')[0]}`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('▶ flow-kit doctor');
  doctor(['--dir', target], pkgRoot);
}
