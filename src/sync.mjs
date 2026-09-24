// flow-kit sync：按 .agents/kit.json 台账升级 managed 文件。
// 三态：未改动（磁盘 sha==台账）→ 覆盖新版；本地已改 → 跳过并报告（--force 覆盖；台账保持包侧基线，
//       每次持续报告直至 --force 或本地对齐新版——防跳过一次后下次升级被静默覆盖，2026-09-24 语义修正）；
//       生成器目标（INDEX.md / wiki 看板）→ 不比对，收尾重跑生成器走锚点重写。
// 附带：包内新增 managed 文件 → 安装；包内已删 → 仅报告不删盘、出台账；managed 缺失 → 恢复。
// owned 文件永不触碰（两态模型，见 profiles.isOwned）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { renderTree, sha256 } from './render.mjs';
import { HOSTS, pickStackVars, isOwned } from './profiles.mjs';
import { doctor } from './doctor.mjs';

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function runNode(target, script, args = []) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: target, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

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
    const updated = [], skipped = [], restored = [], added = [], removed = [], newOwned = [];
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
      const diskSha = fs.existsSync(disk) ? sha256(fs.readFileSync(disk)) : null;
      if (diskSha === null) {
        fs.copyFileSync(freshFile.abs, disk);
        restored.push(rel);
        managedNew.push({ rel, sha256: freshFile.sha });
        continue;
      }
      if (diskSha === ledgerSha) {
        if (freshFile.sha === ledgerSha) { unchanged++; managedNew.push({ rel, sha256: ledgerSha }); }
        else { fs.copyFileSync(freshFile.abs, disk); updated.push(rel); managedNew.push({ rel, sha256: freshFile.sha }); }
        continue;
      }
      // 本地已改
      if (freshFile.sha === diskSha) { unchanged++; managedNew.push({ rel, sha256: diskSha }); continue; } // 改动恰好等于新版
      if (force) { fs.copyFileSync(freshFile.abs, disk); updated.push(`${rel}（--force 覆盖本地改动）`); managedNew.push({ rel, sha256: freshFile.sha }); }
      else { skipped.push(rel); managedNew.push({ rel, sha256: ledgerSha }); } // 台账保持包侧基线：持续报告「本地已改」，直到 --force 或本地对齐新版
    }

    // 台账外的新文件：managed 类安装；owned 类只对「盘上缺失」的起步文档报告（已装的不动不报）
    for (const [rel, freshFile] of fresh) {
      if (ledger.has(rel)) continue;
      if (isOwned(rel)) {
        if (!fs.existsSync(path.join(target, rel))) newOwned.push(rel);
        continue;
      }
      const disk = path.join(target, rel);
      if (fs.existsSync(disk) && !force) { skipped.push(`${rel}（已存在未入台账）`); continue; }
      fs.mkdirSync(path.dirname(disk), { recursive: true });
      fs.copyFileSync(freshFile.abs, disk);
      added.push(rel);
      managedNew.push({ rel, sha256: freshFile.sha });
    }

    const list = (label, arr) => { if (arr.length) console.log(`  ${label}（${arr.length}）：${arr.join('、')}`); };
    list('覆盖更新', updated);
    list('恢复缺失', restored);
    list('新增安装', added);
    list('本地已改，跳过', skipped);
    if (skipped.some((s) => !s.includes('未入台账'))) console.log('    ↑ --force 覆盖本地改动；git diff 自查差异；台账保持包侧基线，后续 sync 持续报告直至处理');
    list('包内已移除（文件保留在盘上，可手动删除）', removed);
    list('新增 owned 起步文档（项目自持，未自动安装）', newOwned);
    if (!updated.length && !restored.length && !added.length && !removed.length && !skipped.length && !newOwned.length) {
      console.log(`  已是最新（${unchanged} 份 managed 无变化）`);
    } else {
      console.log(`  无变化 ${unchanged} 份`);
    }

    // 台账重写：版本对齐当前包；removed 出册；skipped 盘面基线化
    kit.managed = managedNew.sort((a, b) => a.rel.localeCompare(b.rel));
    kit.version = pkg.version;
    fs.writeFileSync(kitPath, `${JSON.stringify(kit, null, 2)}\n`);

    // 生成器目标走锚点重写（不参与 sha 比对）
    const genIndex = runNode(target, '.agents/scripts/gen-workflow-index.mjs');
    if (genIndex.ok || fs.existsSync(path.join(target, '.agents/scripts/gen-workflow-index.mjs'))) {
      console.log(genIndex.ok ? '  已重生成 workflow/INDEX.md（锚点内重写）' : `  ⚠️ gen-workflow-index 失败：${genIndex.out.split('\n')[0]}`);
    }
    const genBoard = runNode(target, '.agents/scripts/gen-wiki-board.mjs');
    if (genBoard.ok || fs.existsSync(path.join(target, '.agents/scripts/gen-wiki-board.mjs'))) {
      console.log(genBoard.ok ? '  已重生成 wiki 速览与看板 DATA（锚点内重写）' : `  ⚠️ gen-wiki-board 失败：${genBoard.out.split('\n')[0]}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('▶ flow-kit doctor');
  doctor(['--dir', target], pkgRoot);
}
