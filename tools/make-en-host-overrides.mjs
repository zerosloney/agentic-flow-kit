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

function writeOverride(rel, content) {
  const abs = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

let count = 0;
for (const host of Object.keys(HOST_DIRS)) {
  const dir = path.join(T, host);
  for (const rel of walk(dir)) {
    const base = path.basename(rel).replace(/\.(md|yml|yaml)$/i, '');
    const desc = COMMAND_DESC[base] || AGENT_DESC[base];
    const abs = path.join(dir, rel);
    const text = fs.readFileSync(abs, 'utf8');
    const parts = splitFrontmatter(text);
    const outRel = targetRel(host, rel);

    if (base === 'CODEBUDDY' && rel === 'CODEBUDDY.md') {
      writeOverride(outRel, `# Project Memory

Single source of truth: root \`AGENTS.md\` (read it fully before starting). Host surface: this directory's \`commands/\`, \`agents/\`, \`rules/\`; hooks are wired via this directory's \`settings.json\` to \`.agents/hooks/\` — the host layer does not own scripts.

- Before touching \`backend/\` or \`frontend/\`, read the corresponding \`AGENTS.md\` (lazy load).
- **Do not** place \`CODEBUDDY.md\` at the repository root (it takes precedence over \`AGENTS.md\` without merging and would override the authority).
- English is the language for this generated pack; commits follow Conventional Commits.
`);
      count += 1;
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
      writeOverride(outRel, `---
description: Read ${name} before changing ${scope} files
alwaysApply: true
---
Before modifying or reviewing any file under \`${scope}/\`, read and follow \`${name}\` (${detail}).
`);
      count += 1;
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
      writeOverride(outRel, `${fm}\n${newBody}`);
      count += 1;
    }
  }
}

console.log(`[en] generated ${count} host override files`);
