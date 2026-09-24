// flow-kit add-gate <门禁>：装门禁模块到 .agents/hooks/ 并接线 local-pre-commit 挂载点。
// 模块约定：modules/gates/<gate>/ 下源文件拷入 .agents/hooks/（平铺，README.md 与 local-pre-commit.line 为包内元数据不拷）；
// local-pre-commit.line 内容 = 需追加进 .agents/hooks/local-pre-commit 的挂载行（存在同名行则不重复追加，幂等）。
// 门禁装后归项目所有：入 owned 台账，sync 永不覆盖（改红线/删不适用条目自行编辑——见各模块 README）。
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './render.mjs';

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

const META = new Set(['README.md', 'local-pre-commit.line']); // 包内文档/接线元数据，不装进项目

export function addGate(args, pkgRoot) {
  const gatesRoot = path.join(pkgRoot, 'modules', 'gates');
  const available = fs.existsSync(gatesRoot) ? fs.readdirSync(gatesRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  const gate = args[0];
  if (!gate || gate.startsWith('--')) fail(`缺少门禁参数（可选：${available.join(' | ') || '无'}）`);
  if (!available.includes(gate)) fail(`未知门禁：${gate}（可选：${available.join(' | ') || '无'}）`);

  let target = process.cwd();
  let force = false;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--dir') target = path.resolve(args[++i] || fail('--dir 缺少值'));
    else if (args[i] === '--force') force = true;
    else fail(`未知选项：${args[i]}`);
  }

  const kitPath = path.join(target, '.agents', 'kit.json');
  if (!fs.existsSync(kitPath)) fail(`${target} 无 .agents/kit.json——先 flow-kit init`);
  const kit = JSON.parse(fs.readFileSync(kitPath, 'utf8'));

  const srcRoot = path.join(gatesRoot, gate);
  const hooksDir = path.join(target, '.agents', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  console.log(`▶ flow-kit add-gate ${gate} → ${target}`);

  const installed = [], skipped = [];
  let wireLine = null;
  for (const entry of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) fail(`门禁模块含子目录（${entry.name}）——平铺约定不支持，请检查模块内容`);
    if (entry.name === 'local-pre-commit.line') { wireLine = fs.readFileSync(path.join(srcRoot, entry.name), 'utf8').trim(); continue; }
    if (META.has(entry.name)) continue;
    const dst = path.join(hooksDir, entry.name);
    if (fs.existsSync(dst) && !force) { skipped.push(entry.name); continue; }
    fs.copyFileSync(path.join(srcRoot, entry.name), dst);
    installed.push(entry.name);
  }
  console.log(installed.length ? `  安装到 .agents/hooks/：${installed.join('、')}` : '  无新文件');
  if (skipped.length) console.log(`  跳过（已存在，--force 覆盖）：${skipped.join('、')}`);

  // 接线 local-pre-commit（幂等：挂载行已存在不重复；旧装态尾部 exit 0 会吞掉其后门禁的失败——归一化剥掉）
  let wiredLp = false;
  if (wireLine) {
    const lpPath = path.join(hooksDir, 'local-pre-commit');
    const cur = fs.existsSync(lpPath) ? fs.readFileSync(lpPath, 'utf8') : '';
    if (cur.split(/\r?\n/).some((l) => l.trim() === wireLine)) {
      console.log('  local-pre-commit 已接线（幂等跳过）');
    } else {
      let lines = cur.split(/\r?\n/);
      while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
      if (lines.length && lines[lines.length - 1].trim() === 'exit 0') {
        lines.pop();
        console.log('  local-pre-commit 归一化：剥掉尾部 exit 0（旧装态，会吞掉其后门禁的失败）');
      }
      const body = lines.length ? `${lines.join('\n')}\n` : '#!/bin/sh\nset -e\n';
      fs.writeFileSync(lpPath, `${body}${wireLine}\n`);
      console.log(`  local-pre-commit 接线：+ ${wireLine}`);
      wiredLp = true;
    }
  }

  // owned 台账补记（归项目所有，sync 永不覆盖）。接线改写了 local-pre-commit（init 时按模板态记账）——
  // 须同步刷新其 owned 哈希，否则台账停在模板态（Shipyard 回流发现的漂移根因，2026-09-24）
  const ownedLedger = new Map((kit.owned || []).map((f) => [f.rel, f]));
  for (const name of installed) {
    const rel = `.agents/hooks/${name}`;
    ownedLedger.set(rel, { rel, sha256: sha256(fs.readFileSync(path.join(hooksDir, name))) });
  }
  if (wiredLp) {
    const lpRel = '.agents/hooks/local-pre-commit';
    ownedLedger.set(lpRel, { rel: lpRel, sha256: sha256(fs.readFileSync(path.join(hooksDir, 'local-pre-commit'))) });
  }
  kit.owned = [...ownedLedger.values()].sort((a, b) => a.rel.localeCompare(b.rel));
  fs.writeFileSync(kitPath, `${JSON.stringify(kit, null, 2)}\n`);

  console.log('✅ 门禁已装（归项目所有，sync 不覆盖）。装后首个 commit 前先核对脚本头部 CONFIG 的目录/类型名——门禁 fail-closed，目标缺失会拦截提交。');
}
