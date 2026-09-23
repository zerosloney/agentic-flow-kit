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
    '.agents/rule-budgets.txt',
    '.agents/settings.json',
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

  // 7. check-loop
  const cl = spawnSync('sh', ['.agents/scripts/check-loop.sh'], { cwd: target, encoding: 'utf8' });
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
      ? `ℹ️  看板端口 ${port} 已有监听（ensure-board 探活复用；他人进程不 kill，见 workflow/README.md）`
      : `ℹ️  看板端口 ${port} 空闲（看板默认不拉起；需要时手动 .agents/scripts/ensure-board.ps1 或 node .agents/scripts/workflow-board-server.mjs）`);
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
