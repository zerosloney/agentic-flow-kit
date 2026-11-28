import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runGovernanceProbes, toGateVerdict, notaryTouches } from '../governance/probes.mjs';

export { notaryTouches };

/**
 * 解析 Git 差异变更集文件列表（用于增量卡口 / PR 范围收敛）
 */
export function resolveChangedFiles(target, { since = null } = {}) {
  const files = new Set();
  try {
    // 审查遗留批 2026-11-23：git 默认对非 ASCII 路径输出 C 转义（core.quotepath），中文文件名会被
    // 折成 "文档/\350\257\264\346\230\216.md" 漏判/错判。先例：engine scripts 的 git 调用一律加
    // -c core.quotepath=off（papercuts 2026-09 教训）。
    const diffArgs = since
      ? ['-c', 'core.quotepath=off', 'diff', '--name-only', `${since}...HEAD`]
      : ['-c', 'core.quotepath=off', 'diff', '--name-only', 'HEAD~1...HEAD'];
    let res = spawnSync('git', diffArgs, { encoding: 'utf8', cwd: target });
    if (res.status !== 0 && since) {
      res = spawnSync('git', ['-c', 'core.quotepath=off', 'diff', '--name-only', since], { encoding: 'utf8', cwd: target });
    }
    // 安全修复批 2026-11-23（fail-closed）：diff 调用失败（含浅克隆下 HEAD~1 不可达、零提交仓）
    // 时无法判定增量范围，直接返回 null 让调用方回退全量检查——不允许 porcelain 腿把
    // 「浅克隆干净检出」误判成空差异集放行全部增量守卫。
    if (res.status !== 0) return null;

    if (res.stdout) {
      for (const line of res.stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) files.add(trimmed.replace(/\\/g, '/'));
      }
    }

    // 兼顾工作区未暂存及已暂存的未提交改动（仅作为 diff 成功后的补充，不单独决定 resolved）
    const statRes = spawnSync('git', ['-c', 'core.quotepath=off', 'status', '--porcelain'], { encoding: 'utf8', cwd: target });
    if (statRes.status === 0 && statRes.stdout) {
      for (const line of statRes.stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const filePath = line.slice(3).trim();
        const actual = filePath.includes('->') ? filePath.split('->').pop().trim() : filePath;
        if (actual) files.add(actual.replace(/\\/g, '/'));
      }
    }
  } catch {
    return null;
  }
  return Array.from(files);
}

/**
 * 执行全要素零信任合流门禁卡口检测
 */
export function runGateChecks({
  target,
  strict = false,
  rules = null,
  thresholds = {},
  diff = false,
  since = null,
  t,
}) {
  const startMs = Date.now();
  let changedFiles = null;
  let diffScoping = null;
  if (diff || since) {
    changedFiles = resolveChangedFiles(target, { since });
    if (changedFiles) {
      diffScoping = {
        active: true,
        since: since || 'HEAD~1',
        changedCount: changedFiles.length,
        files: changedFiles,
      };
    } else {
      process.stderr.write(
        `${(t && t('gate.diffScopeFailed')) || 'Failed to resolve diff scope, falling back to full checks'}\n`,
      );
    }
  }

  const probeBatch = runGovernanceProbes({
    target,
    strict,
    rules,
    thresholds,
    diffScoping,
    changedFiles,
    t,
  });

  return toGateVerdict(probeBatch, {
    strict,
    diffScoping,
    durationMs: Date.now() - startMs,
  });
}

/**
 * 生成 Shields.io 徽章 / SVG / JSON 状态徽章
 */
export function generateGateBadge(result, { format = 'markdown' } = {}) {
  const isApproved = result.passed;
  let verdict = 'APPROVED';
  let color = '2ea44f'; // brightgreen
  const label = 'AI Gate';

  if (!isApproved) {
    if (result.summary.failed === 0 && result.summary.warned > 0) {
      verdict = 'WARNED';
      color = 'dfb317'; // yellow
    } else {
      verdict = 'REJECTED';
      color = 'd73a49'; // red
    }
  }

  const fmt = String(format || 'markdown').toLowerCase();
  if (fmt === 'svg') {
    const textW = verdict.length * 9 + 20;
    const totalW = 60 + textW;
    const textMid = 60 + textW / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${label}: ${verdict}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalW}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="60" height="20" fill="#555"/>
    <rect x="60" width="${textW}" height="20" fill="#${color}"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="310" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="480">${label}</text>
    <text x="310" y="140" transform="scale(.1)" fill="#fff" textLength="480">${label}</text>
    <text aria-hidden="true" x="${textMid * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)">${verdict}</text>
    <text x="${textMid * 10}" y="140" transform="scale(.1)" fill="#fff">${verdict}</text>
  </g>
</svg>`;
  }

  if (fmt === 'json') {
    return JSON.stringify({
      schemaVersion: 1,
      label,
      message: verdict,
      color,
      isError: !isApproved,
    }, null, 2);
  }

  // markdown / shields.io
  const badgeUrl = `https://img.shields.io/badge/AI--Gate-${encodeURIComponent(verdict)}-${color}?logo=shield`;
  return `[![AI Gate: ${verdict}](${badgeUrl})](https://github.com/agentic-flow-kit)`;
}

/**
 * 渲染终端高可读性 ANSI 纯文本报告
 */
export function renderGateText(result, t) {
  const isApproved = result.passed;
  const badge = isApproved ? '🛡️  [APPROVED]' : '❌ [REJECTED]';
  const lines = [
    `\n${badge} ${t('gate.title') || 'AI-Native Zero-Trust Quality Gate'}: ${result.verdict}`,
    `----------------------------------------------------------------------`,
  ];

  if (result.diffScoping?.active) {
    lines.push(`🔍 ${t('gate.diffScopingScope', { since: result.diffScoping.since, count: result.diffScoping.changedCount }) || `Scope: Incremental PR Diff (since: ${result.diffScoping.since}, ${result.diffScoping.changedCount} files modified)`}`);
    lines.push(`----------------------------------------------------------------------`);
  }

  for (const g of result.guards) {
    let icon = '✔';
    let tag = '[PASS]';
    if (g.status === 'failed') {
      icon = '✖';
      tag = '[FAIL]';
    } else if (g.status === 'warned') {
      icon = '⚠';
      tag = '[WARN]';
    } else if (g.status === 'skipped') {
      icon = '○';
      tag = '[SKIP]';
    }
    const titlePadded = g.title.padEnd(36, ' ');
    lines.push(`${icon} ${tag} ${titlePadded} : ${g.reason || ''}`);
    if (g.hint) {
      lines.push(`     └─ Hint: ${g.hint}`);
    }
  }

  lines.push(`----------------------------------------------------------------------`);
  lines.push(`${t('gate.summaryLine', {
    total: result.summary.total,
    passed: result.summary.passed,
    failed: result.summary.failed,
    warned: result.summary.warned,
    skipped: result.summary.skipped,
    ms: result.durationMs,
  }) || `Summary: ${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.warned} warned, ${result.summary.skipped} skipped (${result.durationMs}ms)`}`);

  if (!isApproved) {
    lines.push(`\n🚨 ${t('gate.rejectedVerdict') || 'Verdict: REJECTED - Code changes violate AI safety/quality baselines.'}\n`);
  } else {
    lines.push(`\n✨ ${t('gate.approvedVerdict') || 'Verdict: APPROVED - All gate checks satisfied. Ready for merge.'}\n`);
  }

  return lines.join('\n');
}

/**
 * 渲染标准 GitHub / GitLab Markdown 报告
 */
export function renderGateMarkdown(result, t) {
  const isApproved = result.passed;
  const badge = isApproved ? '🟢 **APPROVED**' : '🔴 **REJECTED**';

  const lines = [
    `# 🛡️ AI-Native Zero-Trust Quality Gate: ${badge}`,
    '',
    `> **Target:** \`${result.target}\` | **Mode:** \`${result.strict ? 'Strict' : 'Standard'}\` | **Duration:** ${result.durationMs}ms`,
  ];

  if (result.diffScoping?.active) {
    lines.push(`> **Diff Scoping:** \`${result.diffScoping.since}...HEAD\` (${result.diffScoping.changedCount} files modified)`);
  }

  lines.push('');
  lines.push(`| Status | Guardian | Verdict / Diagnosis | Remediation |`);
  lines.push(`| :---: | :--- | :--- | :--- |`);

  for (const g of result.guards) {
    let statusIcon = '✅ Pass';
    if (g.status === 'failed') statusIcon = '❌ Fail';
    else if (g.status === 'warned') statusIcon = '⚠️ Warn';
    else if (g.status === 'skipped') statusIcon = '⚪ Skip';

    const cleanReason = (g.reason || '').replace(/\|/g, '\\|');
    const cleanHint = (g.hint || '-').replace(/\|/g, '\\|');
    lines.push(`| ${statusIcon} | **${g.title}** | ${cleanReason} | ${cleanHint} |`);
  }

  lines.push('');
  lines.push(`### 📊 Summary`);
  lines.push(`- **Total Guards:** ${result.summary.total}`);
  lines.push(`- **Passed:** ${result.summary.passed}`);
  lines.push(`- **Failed:** ${result.summary.failed}`);
  lines.push(`- **Warnings:** ${result.summary.warned}`);
  lines.push(`- **Skipped:** ${result.summary.skipped}`);
  lines.push('');

  if (!isApproved) {
    lines.push(`> [!CAUTION]`);
    lines.push(`> **Pull Request Merge Blocked**: Please resolve the failing guardian checks listed above before requesting merge.`);
  } else {
    lines.push(`> [!NOTE]`);
    lines.push(`> **All Checks Passed**: The AI-Native workflow integrity and quality baselines are verified.`);
  }

  return lines.join('\n');
}

function ensureCiNotExists(filePath, relLabel, force, t) {
  if (fs.existsSync(filePath) && !force) {
    const err = new Error(t('gate.ciExists', { path: relLabel }));
    err.code = 'CONFIG_EXISTS';
    throw err;
  }
}

/**
 * 生成 CI 自动化工作流配置
 */
export function generateCiWorkflow({ provider = 'github', target, t, force = false }) {
  const normProvider = String(provider).toLowerCase();
  if (normProvider === 'gitlab') {
    const gitlabPath = path.join(target, '.gitlab-ci.yml');
    // 审查遗留批 2026-11-23：已存在的 CI 配置不再无条件覆盖（fail-closed）；--force 才允许覆盖。
    ensureCiNotExists(gitlabPath, '.gitlab-ci.yml', force, t);
    const content = `# AI-Native Zero-Trust Quality Gate
ai-gate:
  stage: test
  image: node:22-alpine
  script:
    - npx --yes agentic-flow-kit gate --strict --markdown --out gate-summary.md
  artifacts:
    paths:
      - gate-summary.md
    when: always
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
`;
    fs.writeFileSync(gitlabPath, content, 'utf8');
    return { path: gitlabPath, content, created: true };
  }

  // GitHub Actions (默认)
  const ghDir = path.join(target, '.github', 'workflows');
  const ghPath = path.join(ghDir, 'ai-gate.yml');
  ensureCiNotExists(ghPath, '.github/workflows/ai-gate.yml', force, t);
  fs.mkdirSync(ghDir, { recursive: true });
  const content = `name: AI-Native Zero-Trust Quality Gate

on:
  pull_request:
    branches: [main, master, develop]
  push:
    branches: [main, master]

jobs:
  ai-gate:
    name: Agentic Flow Quality Gate
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js (>=22)
        uses: actions/setup-node@v4
        with:
          node-version: '>=22'

      - name: Run AI-Native Quality Gatekeeper
        run: |
          npx --yes agentic-flow-kit gate --strict --markdown --out gate-summary.md

      - name: Attach Gate Summary to GitHub Step Summary
        if: always()
        run: |
          if [ -f gate-summary.md ]; then
            cat gate-summary.md >> $GITHUB_STEP_SUMMARY
          fi
`;
  fs.writeFileSync(ghPath, content, 'utf8');
  return { path: ghPath, content, created: true };
}
