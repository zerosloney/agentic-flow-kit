#!/usr/bin/env node
// 生成 en 宿主指针壳：frontmatter 保留，description 英文化，正文只保留英文指针。
// 非指针类宿主文件（settings/hooks/扩展代码）不生成覆盖，回退中文模板即可。
import fs from 'node:fs';
import path from 'node:path';

const KIT = path.resolve(import.meta.dirname, '..');
const T = path.join(KIT, 'templates', 'hosts');
const OUT = path.join(KIT, 'locales', 'en', 'overrides');

const HOST_DIRS = {
  trae: '.trae',
  codebuddy: '.codebuddy',
  claude: '.claude',
  opencode: '.opencode',
  qwen: '.qwen',
  pi: '.pi',
  cline: '.cline',
  commandcode: '.commandcode',
  qoder: '.qoder',
  zcode: '.zcode',
};

const COMMAND_DESC = {
  'wf-new-task': 'New Task: closed-loop entry — classify first, then route (L0/L1 fast lane; L2/L3 → wf-stages)',
  'wf-stages': 'L2/L3 staged flow: Plan intent → Design spec → Build plan + implementation → Test static gates + UI verification + independent review + closeout (L1 → wf-new-task)',
  'wf-review': 'Code review standard: risk-graded machine gates + AI self-review checklist; user decides severity and merge',
  'wf-deploy': 'Deploy: merge checklist (static gates + pair checks + regression + DB + authorization + PR review/merge)',
  'wf-maintain': 'Maintain: incident record + retrospective trio (fix / prevention / rule entries)',
  'wf-pipeline-run': 'pipeline-run automation entry: single command drives the six-stage loop (experimental; state machine unverified)',
  'wf-pr-review': 'PR panel review: multi-agent finders + independent votes + ledger',
};

const SKILL_DESC = {
  'tfs-pr': 'Internal self-hosted TFS / Azure DevOps Server PR skill, project-agnostic — auto-detects the git repository and remote to derive collection/project/repo, guides creation and saves an env var when PAT is missing; query PR / create PR (context pulls diff to distill title and description) / update PR description / conflict pre-check and worktree-isolated resolution, via REST API + PAT (the az devops extension rejects http organization URLs, so az is unavailable). Command entry .agents/skills/tfs-pr/scripts/tfs-pr.mjs.',
};

const AGENT_DESC = {
  implementer: 'Implements an approved, tightly scoped code change or test when the task includes owned files and executable acceptance criteria',
  'independent-reviewer': 'Independently reviews a fixed spec, plan, or code diff for correctness and project-rule violations without modifying files',
  'ui-verifier': 'Runs browser-based verification for an implemented UI change and returns reproducible evidence without editing repository files',
  'wiki-compiler': 'Translates a code commit into strict JSON describing what business capability the system gained, written for non-coding readers (product/customer service); read-only analysis, never edits files',
  'pr-adjudicator': 'Read-only adjudicator for PR panel review; handles escalated candidates and returns verdicts',
  'pr-finder': 'Read-only finder for PR panel review; finds bugs independently per lens and returns candidate JSON',
  'pr-verifier': 'Read-only verifier for PR panel review; independently verifies a candidate and returns a vote JSON',
  'tfs-pr': 'Self-hosted TFS / Azure DevOps Server PR skill, project-agnostic: detects the git repo/remote, derives collection/project/repo, guides PAT setup when missing; supports querying PRs, creating PRs (pull diff context to draft title/description), updating PR descriptions, conflict pre-checks and worktree-isolated resolution via REST API + PAT.',
};

const AGENT_TITLE = {
  implementer: 'Implementer',
  'independent-reviewer': 'Independent Reviewer',
  'ui-verifier': 'UI Verifier',
  'wiki-compiler': 'Wiki Compiler',
  'pr-adjudicator': 'PR Adjudicator',
  'pr-finder': 'PR Finder',
  'pr-verifier': 'PR Verifier',
};

function walk(dir, rel = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const childAbs = path.join(dir, ent.name);
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...walk(childAbs, childRel));
    else if (ent.isFile()) out.push(childRel);
  }
  return out;
}

function splitFrontmatter(text) {
  if (!/^---\r?\n/.test(text)) return null;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return null;
  const fmEnd = end + 4;
  return { fm: text.slice(0, fmEnd), body: text.slice(fmEnd) };
}

function setDescription(fm, desc) {
  // YAML：描述含 ": " 时必须引号包裹，否则 frontmatter 解析失败。
  return fm.replace(/^description:.*$/m, `description: ${JSON.stringify(desc)}`);
}

function targetRel(host, rel) {
  if (host === 'claude' && rel === 'CLAUDE.md') return 'CLAUDE.md';
  return `${HOST_DIRS[host]}/${rel}`;
}

const overrides = new Map();
// 生成与检查都按 LF 归一：Windows 检出可能带 CRLF，不能因此判为漂移。
const normalize = (text) => text.replace(/\r\n/g, '\n');
for (const host of Object.keys(HOST_DIRS)) {
  const dir = path.join(T, host);
  for (const rel of walk(dir)) {
    const base = path.basename(rel).replace(/\.(md|yml|yaml)$/i, '');
    const skill = rel.match(/^skills\/([^/]+)\/SKILL\.md$/);
    const desc = COMMAND_DESC[base] || AGENT_DESC[base] || (skill ? SKILL_DESC[skill[1]] : undefined);
    const abs = path.join(dir, rel);
    const text = normalize(fs.readFileSync(abs, 'utf8'));
    const parts = splitFrontmatter(text);
    const outRel = targetRel(host, rel);

    if (base === 'CODEBUDDY' && rel === 'CODEBUDDY.md') {
      overrides.set(outRel, `# Project Memory

Single source of truth: root \`AGENTS.md\` (read it fully before starting). Host surface: this directory's \`commands/\`, \`agents/\`, \`rules/\`; hooks are wired via this directory's \`settings.json\` to \`.agents/hooks/\` — the host layer does not own scripts.

- Before touching \`backend/\` or \`frontend/\`, read the corresponding \`AGENTS.md\` (lazy load).
- **Do not** place \`CODEBUDDY.md\` at the repository root (it takes precedence over \`AGENTS.md\` without merging and would override the authority).
- English is the language for this generated pack; commits follow Conventional Commits.
`);
      continue;
    }

    // 规则文件：两条固定规则，直接生成英文。
    if (rel.startsWith('rules/') && /\.md$/i.test(rel)) {
      const isBackend = rel.includes('backend');
      const scope = isBackend ? 'backend' : 'frontend';
      const name = isBackend ? 'backend/AGENTS.md' : 'frontend/AGENTS.md';
      const detail = isBackend
        ? 'including §6 data integrity / API contract / database operation hard constraints'
        : 'including the BC/G gates and Never rules';
      overrides.set(outRel, `---
description: Read ${name} before changing ${scope} files
alwaysApply: true
---
Before modifying or reviewing any file under \`${scope}/\`, read and follow \`${name}\` (${detail}).
`);
      continue;
    }

    if (!parts) continue;
    let fm = parts.fm;
    const body = parts.body;
    if (desc) fm = setDescription(fm, desc);

    const authCmd = body.match(/权威命令[：:]\s*`([^`]+)`/);
    const authSkill = body.match(/权威技能[：:]\s*`([^`]+)`/);
    const role = body.match(/公共角色契约[：:]\s*`([^`]+)`/);

    let newBody = '';
    if (authCmd) {
      newBody = `\nAuthoritative command: \`${authCmd[1]}\`\n\nThis file is a pointer shell. Read the authoritative source at execution time; do not copy the body here.\n`;
    } else if (authSkill) {
      newBody = `\nAuthoritative skill: \`${authSkill[1]}\`. This file is a pointer shell; read the authoritative source at execution time and do not copy the body here.\n`;
    } else if (role) {
      const title = AGENT_TITLE[base] || base;
      newBody = `\n# ${title}\n\nShared role contract: \`${role[1]}\`. This file keeps only the host frontmatter.\n`;
    } else if (/指针壳|执行时读取权威源/.test(body)) {
      newBody = '\nThis file is a pointer shell. Read the authoritative source at execution time; do not copy the body here.\n';
    }

    if (newBody) {
      overrides.set(outRel, `${fm}\n${newBody}`);
    }
  }
}

// 检查只覆盖本工具负责的宿主面；.agents/wiki/workflow 的英文覆盖不归它管。
// 孤儿 = 覆盖存在但对应模板已删除；手写覆盖（如 CLAUDE.md）只要模板还在就不算孤儿。
function sourceOf(rel) {
  if (rel === 'CLAUDE.md') return path.join(T, 'claude', 'CLAUDE.md');
  for (const [host, dir] of Object.entries(HOST_DIRS)) {
    if (rel === `${dir}` || rel.startsWith(`${dir}/`)) {
      return path.join(T, host, rel.slice(dir.length + 1));
    }
  }
  return null;
}

function scopeFiles() {
  const out = [];
  for (const dir of new Set(Object.values(HOST_DIRS))) {
    for (const file of walk(path.join(OUT, dir))) out.push(`${dir}/${file}`);
  }
  if (fs.existsSync(path.join(OUT, 'CLAUDE.md'))) out.push('CLAUDE.md');
  return out;
}

function checkOverrides() {
  const missing = [];
  const stale = [];
  const orphan = [];
  for (const [rel, content] of overrides) {
    const abs = path.join(OUT, rel);
    if (!fs.existsSync(abs)) missing.push(rel);
    else if (normalize(fs.readFileSync(abs, 'utf8')) !== content) stale.push(rel);
  }
  for (const rel of scopeFiles()) {
    const src = sourceOf(rel);
    if (!src || !fs.existsSync(src)) orphan.push(rel);
  }
  missing.sort();
  stale.sort();
  orphan.sort();
  return { ok: !missing.length && !stale.length && !orphan.length, expected: overrides.size, missing, stale, orphan };
}

function writeOverrides() {
  for (const [rel, content] of overrides) {
    const abs = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return overrides.size;
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
if (args.includes('--check')) {
  const result = checkOverrides();
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const rel of result.missing) console.log(`missing ${rel}`);
    for (const rel of result.stale) console.log(`stale   ${rel}`);
    for (const rel of result.orphan) console.log(`orphan  ${rel}`);
    console.log(result.ok
      ? `[en] overrides are up to date (${result.expected} files)`
      : `[en] overrides drift: ${result.missing.length} missing / ${result.stale.length} stale / ${result.orphan.length} orphan`);
  }
  process.exitCode = result.ok ? 0 : 1;
} else {
  const count = writeOverrides();
  if (asJson) console.log(JSON.stringify({ written: count }, null, 2));
  else console.log(`[en] generated ${count} host override files`);
}
