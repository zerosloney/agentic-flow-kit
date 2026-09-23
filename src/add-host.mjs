// flow-kit add-host <宿主>：init 后补装宿主适配层。
// 渲染 modules/hosts/<h> → HOSTS[h].dir → managed 台账按 rel 去重补记 → options.hosts 补记
// → localOnly 宿主（zcode/omp）.gitignore 追加 → doctor
import fs from 'node:fs';
import path from 'node:path';
import { renderTree } from './render.mjs';
import { HOSTS, pickStackVars } from './profiles.mjs';
import { doctor } from './doctor.mjs';

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

export function addHost(args, pkgRoot) {
  const host = args[0];
  if (!host || host.startsWith('--')) fail(`缺少宿主参数（可选 ${Object.keys(HOSTS).join(' | ')}）`);
  if (!HOSTS[host]) fail(`未知宿主：${host}（可选 ${Object.keys(HOSTS).join(' | ')}）`);

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
  kit.options = kit.options || {};
  const already = Array.isArray(kit.options.hosts) && kit.options.hosts.includes(host);
  if (already && !force) fail(`${host} 已安装（options.hosts 在册）。覆盖更新用 --force`);

  const vars = { BOARD_PORT: String(kit.options.boardPort || '8933'), ...pickStackVars(kit.options.stack) };
  console.log(`▶ flow-kit add-host ${host} → ${target}${already ? '（--force 覆盖更新）' : ''}`);

  // 宿主层渲染（已存在保守跳过；--force 覆盖）
  const r = renderTree(path.join(pkgRoot, 'modules', 'hosts', host), path.join(target, HOSTS[host].dir), vars, { force });
  if (!r.written.length && r.skipped.length) console.log('  跳过（已存在，未覆盖）：' + r.skipped.join('、'));
  else console.log(`  安装 ${r.written.length} 份${r.skipped.length ? `，跳过已存在 ${r.skipped.length} 份` : ''}`);

  // managed 台账按 rel 去重补记
  const ledger = new Map((kit.managed || []).map((f) => [f.rel, f]));
  for (const f of r.written) ledger.set(`${HOSTS[host].dir}/${f.rel}`, { rel: `${HOSTS[host].dir}/${f.rel}`, sha256: f.sha256 });
  kit.managed = [...ledger.values()].sort((a, b) => a.rel.localeCompare(b.rel));
  if (!already) kit.options.hosts = [...(kit.options.hosts || []), host];
  fs.writeFileSync(kitPath, `${JSON.stringify(kit, null, 2)}\n`);

  // localOnly 宿主进 .gitignore（缺才补）
  if (HOSTS[host].localOnly) {
    const giPath = path.join(target, '.gitignore');
    const line = `${HOSTS[host].dir}/`;
    const giText = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
    if (!giText.split(/\r?\n/).some((x) => x.trim() === line)) {
      fs.writeFileSync(giPath, (giText.endsWith('\n') || giText === '' ? giText : giText + '\n') + line + '\n');
      console.log(`  .gitignore 追加：${line}`);
    }
  }

  console.log('▶ flow-kit doctor');
  doctor(['--dir', target], pkgRoot);
}
