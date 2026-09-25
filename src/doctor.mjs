// flow-kit doctor：安装体检——布局 / git 钩子 / managed 台账 / 占位符残留 / 索引漂移 / check-loop
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import net from 'node:net';
import { createHash } from 'node:crypto';

function sh(cmd, cwd) {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '')) };
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port: Number(port), host: '127.0.0.1', timeout: 400 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

export function doctor(args, pkgRoot) {
  let target = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') target = path.resolve(args[++i]);
  }
  const results = []; // {level:'PASS'|'WARN'|'FAIL', msg}
  const add = (level, msg) => results.push({ level, msg });

  // 1. Node 版本
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) add('PASS', `Node ${process.versions.node}（≥18）`);
  else add('FAIL', `Node ${process.versions.node} 过低（引擎脚本需 ≥18）`);

  // 2. 目录布局
  const required = [
    'AGENTS.md',
    '.agents/commands/new-task.md',
    '.agents/roles/implementer.md',
    '.agents/roles/independent-reviewer.md',
    '.agents/roles/ui-verifier.md',
    '.agents/scripts/check-loop.sh',
    '.agents/scripts/kb-search.mjs',
    '.agents/scripts/gen-workflow-index.mjs',
    '.agents/scripts/gen-wiki-board.mjs',
    '.agents/scripts/workflow-board-server.mjs',
    '.agents/board/index.html',
    '.agents/hooks/commit-check.cjs',
    '.agents/workflow-modules.txt',
    '.agents/workflow-enums.txt',
    '.agents/rule-budgets.txt',
    '.agents/settings.json',
    '.agents/workflows/_TEMPLATE.md',
    '.agents/scripts/check-loop.mjs',
    '.githooks/pre-commit',
    '.githooks/pre-push',
    '.githooks/commit-msg',
    '.githooks/post-commit',
    '.githooks/pre-merge-commit',
    'workflow/README.md',
    'workflow/intents/_TEMPLATE.md',
    'workflow/specs/_TEMPLATE.md',
    'workflow/plans/_TEMPLATE.md',
    'workflow/incidents/_TEMPLATE.md',
    'wiki/INDEX.md',
  ];
  const missing = required.filter((p) => !fs.existsSync(path.join(target, p)));
  if (missing.length === 0) add('PASS', `目录布局完整（${required.length} 个关键路径）`);
  else add('FAIL', `布局缺失：${missing.join('、')}`);

  // 3. git 仓库与钩子
  const isRepo = sh('git rev-parse --git-dir', target).ok;
  if (isRepo) {
    const hp = sh('git config core.hooksPath', target);
    if (hp.ok && hp.out.trim() === '.githooks') add('PASS', 'core.hooksPath=.githooks（钩子已挂载）');
    else add('FAIL', `core.hooksPath 当前为「${(hp.ok ? hp.out : '').trim() || '未设置'}」——执行 git config core.hooksPath .githooks`);
  } else {
    add('WARN', '不在 git 仓库内——钩子未挂载（git init 后执行 git config core.hooksPath .githooks）');
  }

  // 4. kit.json managed 台账（sha 校验：本地改动 → WARN，缺失 → FAIL）
  const kitPath = path.join(target, '.agents', 'kit.json');
  if (!fs.existsSync(kitPath)) {
    add('WARN', '无 .agents/kit.json（非 flow-kit 安装或旧版手动安装）');
  } else {
    try {
      const kit = JSON.parse(fs.readFileSync(kitPath, 'utf8'));
      let ok = 0;
      let modified = 0;
      const gone = [];
      for (const f of kit.managed || []) {
        const p = path.join(target, f.rel);
        if (!fs.existsSync(p)) { gone.push(f.rel); continue; }
        const h = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        if (h === f.sha256) ok++; else modified++;
      }
      add('PASS', `kit.json v${kit.version}：managed ${ok + modified} 份校验通过`);
      if (modified) add('WARN', `managed 本地改动 ${modified} 份（升级时 flow-kit sync 会要求合并）`);
      if (gone.length) add('FAIL', `managed 文件缺失：${gone.join('、')}`);
    } catch (e) {
      add('FAIL', `kit.json 解析失败：${e.message}`);
    }
  }

  // 5. 占位符残留
  const phFiles = ['AGENTS.md', 'workflow/README.md', '.agents/notes/runtime-env.md']
    .concat(fs.existsSync(path.join(target, '.agents/commands')) ? fs.readdirSync(path.join(target, '.agents/commands')).filter((f) => f.endsWith('.md')).map((f) => `.agents/commands/${f}`) : []);
  const phHits = [];
  for (const rel of phFiles) {
    const p = path.join(target, rel);
    if (!fs.existsSync(p)) continue;
    const txt = fs.readFileSync(p, 'utf8');
    for (const m of txt.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)) phHits.push(`${rel}: {{${m[1]}}}`);
  }
  if (phHits.length === 0) add('PASS', '无占位符残留');
  else add('WARN', `占位符残留 ${phHits.length} 处（init 变量缺失或需手改）：${phHits.slice(0, 5).join('；')}${phHits.length > 5 ? ' …' : ''}`);

  // 6. workflow 索引漂移
  const idx = spawnSync(process.execPath, ['.agents/scripts/gen-workflow-index.mjs', '--check'], { cwd: target, encoding: 'utf8' });
  if (idx.status === 0) add('PASS', 'workflow/INDEX.md 无漂移');
  else add('WARN', `workflow/INDEX.md 漂移——跑 node .agents/scripts/gen-workflow-index.mjs 重生成`);

  // 6.5 delegations 台账结构（量化层非门禁：结构漂移曾静默吞掉全部记录，2026-09-24）
  if (fs.existsSync(path.join(target, '.agents/scripts/agg-delegations.cjs'))) {
    const agg = spawnSync(process.execPath, ['.agents/scripts/agg-delegations.cjs'], { cwd: target, encoding: 'utf8' });
    if (agg.status === 0) add('PASS', 'delegations 台账结构有效（agg 可解析）');
    else add('WARN', `delegations 台账结构漂移——${String(agg.stderr || agg.stdout || '').split('\n')[0]}`);
  }

  // 6.6 owned 漂移校验（kit.owned 列表盘面 sha 不一致；engine 双源纪律对 owned 走「项目自持 + 哈希记账不约束」，
  //     漂移信号靠本校验给装户可见性。2026-09-25 wf-runtime 复盘：包源改了装副本未同步 = 漂移但 sync 不报。）
  const ownedRes = checkOwnedDrift(target);
  if (ownedRes.error) {
    add('WARN', `owned 校验跳过（kit.json 解析失败：${ownedRes.error}）`);
  } else if (ownedRes.skipped) {
    add('PASS', 'owned 校验跳过（kit.json 无 owned 条目）');
  } else if (ownedRes.total === 0) {
    add('PASS', 'owned 校验跳过（kit.json 无 owned 条目）');
  } else if (ownedRes.drift === 0 && ownedRes.gone.length === 0) {
    add('PASS', `owned ${ownedRes.total} 份无漂移（装副本与台账 sha 对齐）`);
  } else {
    // owned 漂移已严化为 FAIL（2026-09-25 doctor-owned-drift-strict 复盘；首次引入用 WARN，installed 装户吃过警告后升级）
    if (ownedRes.drift) add('FAIL', `owned 漂移 ${ownedRes.drift} 份——装副本手改未跑 sync 刷台账 / 包源改了装副本未同步；须手动同步装副本后跑 node bin/flow-kit.mjs sync 刷台账（见 incidents/2026-09-25-wf-runtime 复盘）`);
    if (ownedRes.gone.length) add('FAIL', `owned 文件缺失：${ownedRes.gone.join('、')}——sync 恢复或手动恢复`);
  }

  // 6.7 跨宿主薄适配正文段漂移校验（2026-09-25 cross-host-sync，参见 workflows/intents/2026-09-25-cross-host-sync.md）
  //     装户侧视角：.agents/{commands,roles}/*.md 是权威源；4 宿主目录（.zcode/.omp/.opencode/.trae）下的
  //     {agents,commands}/*.md 是薄适配。按正文段 sha 比对（B-b 语义，frontmatter 不计入漂移），
  //     trae commands 加 wf- 前缀映射。首次引入为 WARN（沿用 wf-runtime 复盘「先 WARN 升级 FAIL」路径），
  //     待装户升级视反馈升级 FAIL。包源侧对应工具是 flow-kit sync-hosts（src/sync-hosts.mjs）。
  const adapterRes = checkAdapterDrift(target);
  if (adapterRes.skipped) {
    add('PASS', `跨宿主薄适配校验跳过（${adapterRes.note || '权威源目录不存在'}）`);
  } else if (adapterRes.drift === 0) {
    add('PASS', `跨宿主薄适配 ${adapterRes.total} 对无正文漂移（装副本引擎 vs 4 宿主薄适配，B-b 语义）`);
  } else {
    add('WARN', `跨宿主薄适配正文漂移 ${adapterRes.drift} 对——权威源与薄适配正文段 sha 不一致；按 .agents/commands/sync-hosts.md 跑 flow-kit sync-hosts --apply 单向同步薄适配正文（frontmatter 不动）；装户可在 bin/flow-kit.mjs sync 时一并修复`);
  }

  // 6.8 workflows 编排脚本 lint（stages 表解析校验：role/step/after 引用、无环、三形态互斥、数值枚举；
  //     2026-09-25 workflows-linter 把 _TEMPLATE.md「解析校验先行」从 prose 变机器门。首次引入 WARN
  //     （沿用 wf-runtime 复盘「先 WARN 升级 FAIL」渐进路径），装户吃过警告后可升 FAIL。
  //     旧版装户 sync 前 .agents/scripts/workflows-check.mjs 不存在 → 自然跳过不误报）
  if (fs.existsSync(path.join(target, '.agents/scripts/workflows-check.mjs')) && fs.existsSync(path.join(target, '.agents/workflows'))) {
    const wf = spawnSync(process.execPath, ['.agents/scripts/workflows-check.mjs'], { cwd: target, encoding: 'utf8' });
    if (wf.status === 0) {
      const warnN = (String(wf.stdout || '').match(/- ⚠️ W\d/g) || []).length;
      add('PASS', `workflows 编排脚本 lint 干净${warnN ? `（${warnN} 条 advisory 告警）` : ''}`);
    } else {
      const firstHit = String(wf.stdout || wf.stderr || '').split('\n').find((l) => / E\d/.test(l)) || `exit ${wf.status}`;
      add('WARN', `workflows 编排脚本 lint 未过——${firstHit.trim()}；修 .agents/workflows/ 编排脚本（role/step/after 引用、三形态、retries）后重跑`);
    }
  }

  // 7. check-loop——2026-09-26 check-loop-node 起 node 实现直跑（sh 版曾需先探 sh 可用性：Windows
  //    PowerShell 常无 sh，ENOENT 曾被吞进 hard-block 分支报成空原因假警报，incident 2026-09-24-doctor-sh-enoent；
  //    迁移后无 sh 依赖，探针退役。check-loop.sh 为兼容 shim，pre-push 钩子路径照常）
  const cl = spawnSync(process.execPath, ['.agents/scripts/check-loop.mjs'], { cwd: target, encoding: 'utf8' });
  if (cl.status === 0) {
    const warnTxt = String(cl.stderr || '').trim();
    add('PASS', `check-loop 干净${warnTxt ? `（${warnTxt.split('\n').filter((l) => l.includes('WARN')).length} 条 advisory 警告）` : ''}`);
  } else {
    add('FAIL', `check-loop 有 hard-block：\n${String(cl.stderr || '').split('\n').slice(0, 8).join('\n')}`);
  }

  // 8. 看板端口（信息级）
  const kit = fs.existsSync(kitPath) ? JSON.parse(fs.readFileSync(kitPath, 'utf8')) : null;
  const port = kit?.options?.boardPort || '8933';
  portInUse(port).then((inUse) => {
    print(results);
    console.log(inUse
      ? `ℹ️  看板端口 ${port} 已有监听（ensure-board 探活：本项目看板复用/旧代码重启，他人进程不 kill 自动上探，见 workflow/README.md）`
      : `ℹ️  看板端口 ${port} 空闲（看板默认不拉起；需要时手动 .agents/scripts/ensure-board.mjs（跨平台）或 node .agents/scripts/workflow-board-server.mjs）`);
    process.exit(results.some((r) => r.level === 'FAIL') ? 1 : 0);
  });
}

function print(results) {
  const icon = { PASS: '✅', WARN: '⚠️ ', FAIL: '❌' };
  for (const r of results) console.log(`${icon[r.level]} ${r.msg}`);
  const fails = results.filter((r) => r.level === 'FAIL').length;
  const warns = results.filter((r) => r.level === 'WARN').length;
  console.log(`\ndoctor：${results.length - fails - warns} PASS ｜ ${warns} WARN ｜ ${fails} FAIL`);
}

// owned 漂移校验（独立 export 供 doctor 主流程 + 单元测试共用；2026-09-25 wf-runtime 复盘）
// 返回：{ drift, gone, total, skipped, error? }
//   - skipped=true：kit.json 不存在或解析失败/无 owned 字段
//   - drift：盘面 sha != kit.owned sha 的文件数
//   - gone：盘面缺失的文件 rel 列表
//   - total：kit.owned 列表总文件数
export function checkOwnedDrift(target) {
  const kitPath = path.join(target, '.agents', 'kit.json');
  if (!fs.existsSync(kitPath)) return { drift: 0, gone: [], total: 0, skipped: true };
  let kit;
  try {
    kit = JSON.parse(fs.readFileSync(kitPath, 'utf8'));
  } catch (e) {
    return { drift: 0, gone: [], total: 0, skipped: true, error: e.message };
  }
  const owned = Array.isArray(kit.owned) ? kit.owned : [];
  if (owned.length === 0) return { drift: 0, gone: [], total: 0, skipped: true };
  let drift = 0;
  const gone = [];
  for (const f of owned) {
    const p = path.join(target, f.rel);
    if (!fs.existsSync(p)) { gone.push(f.rel); continue; }
    const h = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if (h !== f.sha256) drift++;
  }
  return { drift, gone, total: owned.length, skipped: false };
}

// 跨宿主薄适配正文段漂移校验（独立 export 供 doctor 主流程 + 单元测试共用；2026-09-25 cross-host-sync）
// 装户侧视角：.agents/{commands,roles}/*.md 是权威源；4 宿主目录（zcode→.zcode、omp→.omp、
// opencode→.opencode、trae→.trae）下 {agents,commands}/*.md 是薄适配。按正文段 sha 比对
// （B-b 语义；frontmatter 不计入漂移）；trae commands 加 wf- 前缀映射。
// 返回：{ drift, total, skipped, note? }
//   - skipped=true：权威源目录不存在 / 包源环境 / 无 .md 文件
//   - drift：权威源正文段与薄适配正文段 sha 不一致的对数
//   - total：参与比对的对数（权威源文件 × 适配数）
export function checkAdapterDrift(target) {
  const authorityRoot = path.join(target, '.agents');
  if (!fs.existsSync(authorityRoot)) return { drift: 0, total: 0, skipped: true, note: '.agents 目录不存在' };
  // 包源环境检测：包源仓库同时含 templates/ 与 modules/，装户不应有；包源下跑 doctor §7.x 永远是
  // drift（装副本是历史 init 渲染产物，不会随包源改动而重渲），无信息价值——直接 skip
  if (fs.existsSync(path.join(target, 'templates', '_agents')) && fs.existsSync(path.join(target, 'modules', 'hosts'))) {
    return { drift: 0, total: 0, skipped: true, note: '包源环境（templates/ + modules/ 同时存在）——§7.x 仅在装户环境有意义' };
  }
  // 4 宿主目录映射（与 src/profiles.mjs#HOSTS 同源：装副本目录名前缀带点）
  const HOST_DIR = { zcode: '.zcode', omp: '.omp', opencode: '.opencode', trae: '.trae' };
  const splitFm = (text) => {
    const m = String(text || '').match(/^---\r?\n([\s\S]*?\r?\n)---\r?\n?([\s\S]*)$/);
    if (!m) return { fm: '', body: String(text || '') };
    return { fm: `---\n${m[1]}---\n`, body: m[2] };
  };
  const bodySha = (p) => {
    try { return createHash('sha256').update(splitFm(fs.readFileSync(p, 'utf8')).body).digest('hex'); } catch { return null; }
  };
  let total = 0;
  let drift = 0;
  const listMd = (dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  for (const sub of ['commands', 'roles']) {
    const subAbs = path.join(authorityRoot, sub);
    for (const f of listMd(subAbs)) {
      const authRel = `${sub}/${f}`;
      const authSha = bodySha(path.join(authorityRoot, authRel));
      const name = f.slice(0, -'.md'.length);
      // 构建映射：commands/* → opencode/commands/<name>.md + trae/commands/wf-<name>.md；roles/* → 4 宿主 agents/<name>.md
      const targets = [];
      if (sub === 'commands') {
        targets.push([HOST_DIR.opencode, 'commands', `${name}.md`], [HOST_DIR.trae, 'commands', `wf-${name}.md`]);
      } else {
        for (const h of Object.keys(HOST_DIR)) targets.push([HOST_DIR[h], 'agents', `${name}.md`]);
      }
      for (const [hostDir, subDir, fileName] of targets) {
        const adapterAbs = path.join(target, hostDir, subDir, fileName);
        const adapterSha = bodySha(adapterAbs);
        if (adapterSha === null) continue; // 缺失不在 drift 统计（apply 不自动创建）
        total++;
        if (authSha !== adapterSha) drift++;
      }
    }
  }
  if (total === 0) return { drift: 0, total: 0, skipped: true, note: '权威源无 commands/roles .md 文件' };
  return { drift, total, skipped: false };
}
