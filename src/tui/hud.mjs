import fs from 'node:fs';
import path from 'node:path';
import { readManifest } from '../install/manifest.mjs';
import { readKitVersion } from '../commands/install.mjs';
import { runGateChecks } from '../ci/gate.mjs';
import { listHandoffFiles, verifyHandoffEnvelope } from '../install/handoff.mjs';
import { findSkillDatasets } from '../skills/eval-harness.mjs';
import { computeAiDoraMetrics } from '../install/metrics.mjs';
import { box, cyan, green, red, yellow, bold, dim, magenta } from './ansi.mjs';

/**
 * 汇总当前项目的全景运行时状态数据（用于终端实时多智能体看板）
 */
export function gatherHudState(target, t) {
  const absTarget = path.resolve(target || process.cwd());
  const manifest = readManifest(absTarget) || {};
  let kitVersion = 'unknown';
  try {
    kitVersion = readKitVersion();
  } catch {
    // fallback
  }

  // 1. 宿主与模型网格信息
  let modelRoles = { primary: 'auto', worker: 'auto', fast: 'auto' };
  const localRolesPath = path.join(absTarget, '.agents', 'config', 'model-roles.local.json');
  const baseRolesPath = path.join(absTarget, '.agents', 'config', 'model-roles.json');

  if (fs.existsSync(localRolesPath)) {
    try {
      modelRoles = { ...modelRoles, ...JSON.parse(fs.readFileSync(localRolesPath, 'utf8')) };
    } catch {}
  } else if (fs.existsSync(baseRolesPath)) {
    try {
      modelRoles = { ...modelRoles, ...JSON.parse(fs.readFileSync(baseRolesPath, 'utf8')) };
    } catch {}
  }

  const hosts = manifest.hosts || [];
  const engineInfo = {
    projectName: manifest.projectName || path.basename(absTarget),
    target: absTarget,
    kitVersion,
    manifestVersion: manifest.version || 'unversioned',
    language: manifest.language || 'zh-CN',
    tier: manifest.tier || 'standard',
    hardened: Boolean(manifest.hardened),
    hosts,
    models: modelRoles,
  };

  // 2. 零信任质量门禁与哨兵状态
  const gateResult = runGateChecks({ target: absTarget, strict: false, t });

  // 3. 多智能体交接网格 (Handoff Mesh)
  let handoffs = [];
  let tamperedHandoffs = 0;
  const pubKeyPath = path.join(absTarget, '.agents', 'notary', 'public.pem');
  const pubKey = fs.existsSync(pubKeyPath) ? fs.readFileSync(pubKeyPath, 'utf8') : null;

  try {
    handoffs = listHandoffFiles(absTarget);
    for (const h of handoffs) {
      const v = verifyHandoffEnvelope({ target: absTarget, envelope: h.envelope, publicKeyPem: pubKey });
      if (!v.ok) tamperedHandoffs += 1;
    }
  } catch {}

  const handoffStats = {
    total: handoffs.length,
    pending: handoffs.filter((h) => h.envelope?.status === 'pending').length,
    accepted: handoffs.filter((h) => h.envelope?.status === 'accepted').length,
    completed: handoffs.filter((h) => h.envelope?.status === 'completed').length,
    rejected: handoffs.filter((h) => h.envelope?.status === 'rejected').length,
    tampered: tamperedHandoffs,
    clean: tamperedHandoffs === 0,
  };

  // 4. 技能套件评测基准 (Skills Benchmark)
  let installedSkillsCount = 0;
  const skillsDir = path.join(absTarget, '.agents', 'skills');
  if (fs.existsSync(skillsDir)) {
    try {
      installedSkillsCount = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
    } catch {}
  }

  const datasets = findSkillDatasets(absTarget);
  let evalLogStats = { total: 0, passed: 0, failed: 0, passRate: null };
  const evalLogPath = path.join(absTarget, '.agents', 'evals', 'eval-log.json');
  if (fs.existsSync(evalLogPath)) {
    try {
      const evalLog = JSON.parse(fs.readFileSync(evalLogPath, 'utf8'));
      const entries = evalLog.entries || [];
      const passed = entries.filter((e) => e.outcome === 'pass').length;
      const failed = entries.filter((e) => e.outcome === 'fail').length;
      evalLogStats = {
        total: entries.length,
        passed,
        failed,
        passRate: entries.length > 0 ? Math.round((passed / entries.length) * 1000) / 10 : null,
      };
    } catch {}
  }

  const skillsBenchmark = {
    installedSkillsCount,
    datasetsCount: datasets.length,
    evals: evalLogStats,
  };

  // 5. AI-DORA 质量效能遥测
  let doraMetrics = null;
  try {
    doraMetrics = computeAiDoraMetrics(absTarget, { days: 30 });
  } catch {
    doraMetrics = { dora: { tier: 'N/A', cfr: 0, mttrSec: null, passRate: null } };
  }

  return {
    engine: engineInfo,
    gate: gateResult,
    handoffs: handoffStats,
    skills: skillsBenchmark,
    dora: doraMetrics,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 格式化渲染 HUD 看板视图 (ANSI 字符高亮与圆角卡片)
 */
export function renderHudView(state, t) {
  const { engine, gate, handoffs, skills, dora } = state;
  const out = [];

  // 顶层 Header
  const titleText = `${bold(cyan('🛰️  AGENTIC FLOW KIT'))} ${dim('│')} ${bold('LIVE MULTI-AGENT & SHIELD HUD')} ${dim(`v${engine.kitVersion}`)}`;
  const timeStr = dim(new Date(state.updatedAt).toLocaleTimeString());
  out.push(`\n${titleText}  ${timeStr}\n`);

  // Panel 1: Engine Core & Model Roles
  const hostsStr = engine.hosts.length ? engine.hosts.map((h) => cyan(h)).join(', ') : dim('(none)');
  const modeStr = engine.hardened ? red('🔒 hardened') : green('standard');
  const engineLines = [
    `Project : ${bold(engine.projectName)} ${dim(`(${engine.target})`)}`,
    `Engine  : Tier: ${bold(engine.tier)}  ${dim('│')}  Mode: ${modeStr}  ${dim('│')}  Hosts: ${hostsStr}`,
    `Models  : ${cyan('[primary]')} ${engine.models.primary || 'auto'}  ${dim('│')}  ${cyan('[worker]')} ${engine.models.worker || 'auto'}  ${dim('│')}  ${cyan('[fast]')} ${engine.models.fast || 'auto'}`,
  ];
  out.push(...box(bold('AI Engine & Model Mesh'), engineLines));
  out.push('');

  // Panel 2: Guard Rails (7 Sentinels)
  const guardLines = [];
  for (const g of gate.guards) {
    let icon = green('✔');
    let tag = green('[PASS]');
    if (g.status === 'failed') {
      icon = red('✖');
      tag = red('[FAIL]');
    } else if (g.status === 'warned') {
      icon = yellow('⚠');
      tag = yellow('[WARN]');
    } else if (g.status === 'skipped') {
      icon = dim('○');
      tag = dim('[SKIP]');
    }
    const titlePadded = g.title.padEnd(32, ' ');
    guardLines.push(`${icon} ${tag} ${titlePadded} : ${g.reason || ''}`);
  }
  const gateVerdict = gate.passed ? green('● APPROVED') : red('● REJECTED');
  out.push(...box(`${bold('Zero-Trust Guard Rails')} ${dim('│')} ${gateVerdict}`, guardLines));
  out.push('');

  // Panel 3: Active Multi-Agent Mesh & Hand-offs
  const contamStatus = handoffs.clean
    ? green('✔ Clean (0 tampered envelopes)')
    : red(`✖ Compromised (${handoffs.tampered} tampered envelopes detected!)`);
  const handoffLines = [
    `Envelopes : ${bold(handoffs.total)} total  ${dim('│')}  Pending: ${yellow(handoffs.pending)}  ${dim('│')}  Accepted: ${green(handoffs.accepted)}  ${dim('│')}  Completed: ${cyan(handoffs.completed)}`,
    `Integrity : ${contamStatus}`,
  ];
  out.push(...box(bold('🤝 Multi-Agent Task Mesh & Handoffs'), handoffLines));
  out.push('');

  // Panel 4: Skills Benchmark & Regression
  const passRateStr = skills.evals.passRate != null
    ? (skills.evals.passRate >= 80 ? green(`${skills.evals.passRate}%`) : red(`${skills.evals.passRate}%`))
    : dim('N/A (No eval log)');
  const skillLines = [
    `Registered Skills : ${bold(skills.installedSkillsCount)} installed  ${dim('│')}  Datasets: ${bold(skills.datasetsCount)} defined`,
    `Eval Benchmark    : ${bold(skills.evals.total)} evaluated  ${dim('│')}  Passed: ${green(skills.evals.passed)}  ${dim('│')}  Failed: ${red(skills.evals.failed)}  ${dim('│')}  Pass Rate: ${passRateStr}`,
  ];
  out.push(...box(bold('🧪 Skills Benchmark & Eval Suite'), skillLines));
  out.push('');

  // Panel 5: AI-DORA Telemetry
  const d = dora.dora || {};
  let tierBadge = bold(d.tier || 'N/A');
  if (d.tier === 'Elite') tierBadge = bold(green('⭐ Elite'));
  else if (d.tier === 'High') tierBadge = bold(cyan('High'));
  else if (d.tier === 'Medium') tierBadge = bold(yellow('Medium'));
  else if (d.tier === 'Low') tierBadge = bold(red('Low'));

  const cfrStr = d.cfr != null ? (d.cfr === 0 ? green(`${d.cfr}%`) : red(`${d.cfr}%`)) : dim('N/A');
  const mttrStr = d.mttrSec != null ? `${d.mttrSec}s` : dim('N/A');
  const pipePassStr = d.passRate != null ? (d.passRate >= 80 ? green(`${d.passRate}%`) : red(`${d.passRate}%`)) : dim('N/A');

  const doraLines = [
    `Quality Tier  : ${tierBadge}  ${dim('│')}  Change Failure Rate (CFR): ${cfrStr}`,
    `MTTR Recovery : ${mttrStr}  ${dim('│')}  Pipeline Pass Rate: ${pipePassStr}`,
  ];
  out.push(...box(bold('📊 AI-DORA Telemetry & Resilience (30 Days)'), doraLines));

  // 底部提示
  out.push(`\n${dim('────────────────────────────────────────────────────────────────────────────')}`);
  out.push(`${dim('  Controls: Press [q] or [Ctrl+C] to quit live view  │  Status: ')}${gateVerdict}\n`);

  return out.join('\n');
}

/**
 * 终端交互实时刷新循环 (Watch Mode)
 */
export async function hudWatchLoop({
  target,
  t,
  lang = 'zh-CN',
  interval = 2,
  inputStream = process.stdin,
  outputStream = process.stdout,
}) {
  // 非 TTY 或重定向输出时降级为快照输出
  if (!inputStream.isTTY || !outputStream.isTTY) {
    const state = gatherHudState(target, t);
    outputStream.write(renderHudView(state, t) + '\n');
    return 0;
  }

  let running = true;
  let timer = null;

  const cleanup = () => {
    running = false;
    if (timer) clearInterval(timer);
    if (inputStream.isTTY && typeof inputStream.setRawMode === 'function') {
      try {
        inputStream.setRawMode(false);
        inputStream.pause();
      } catch {}
    }
    outputStream.write('\x1b[?25h\n'); // 恢复显示终端光标
  };

  const redraw = () => {
    if (!running) return;
    try {
      const state = gatherHudState(target, t);
      const view = renderHudView(state, t);
      // 清全屏并重置光标到左上角，隐藏光标防抖动
      outputStream.write('\x1b[2J\x1b[H\x1b[?25l' + view + '\n');
    } catch {
      // 容错防崩
    }
  };

  // 首帧立即渲染
  redraw();
  timer = setInterval(redraw, Math.max(1, interval) * 1000);

  // 监听按键退出：q / Q / ESC / Ctrl+C
  return new Promise((resolve) => {
    const onData = (data) => {
      const str = String(data);
      if (str === 'q' || str === 'Q' || str === '\x03' || str === '\x1b') {
        cleanup();
        inputStream.removeListener('data', onData);
        resolve(0);
      }
    };

    if (inputStream.isTTY && typeof inputStream.setRawMode === 'function') {
      try {
        inputStream.setRawMode(true);
        inputStream.resume();
        inputStream.on('data', onData);
      } catch {
        cleanup();
        resolve(0);
      }
    } else {
      resolve(0);
    }
  });
}
