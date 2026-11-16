#!/usr/bin/env node
// gen-changelog.mjs — 把 CHANGELOG.md 变成从 git tag 区间 Conventional Commits 单源渲染的全派生工件。
// 模式：默认/--check = 内存渲染期望全文与磁盘字节级比对，不一致 exit 1；--write = 写出期望全文（幂等）；
//       --notes [--to <version>] = 只打印一个版本的段（不含文件头），供 gh release create --notes-file 用。
// 纯函数（parseSubject / classify / renderChangelog）export 供 tests/changelog.test.mjs 直接 import；
// 纯函数与 CLI 共用同一渲染路径（renderSection 是段的唯一拼装处），不存在第二条生成路径。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// —— 纯函数层 ——

const SUBJECT_RE = /^(feat|fix|docs|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?!?: (.+)$/;

// 解析 Conventional Commit 主题行；带 `!` 时归入其 type。非匹配行返回 null。
export function parseSubject(line) {
  const m = SUBJECT_RE.exec(line);
  if (!m) return null;
  return { type: m[1], scope: m[2] ? m[2].slice(1, -1) : null, subject: m[3] };
}

// chore(release) 开头的版本提交完全排除（不进任何桶）
const isReleaseCommit = (line) => line.startsWith('chore(release)');

// 四桶有序结构；types 为 null 的兜底桶收其余所有类型 + 未匹配行
const BUCKETS = [
  { title: '新增', types: ['feat'] },
  { title: '修复', types: ['fix'] },
  { title: '文档', types: ['docs'] },
  { title: '其他', types: null },
];

export function classify(subjects) {
  const entries = new Map(BUCKETS.map((b) => [b.title, []]));
  for (const line of subjects) {
    if (isReleaseCommit(line)) continue;
    const parsed = parseSubject(line);
    const bucket = parsed
      ? BUCKETS.find((b) => b.types === null || b.types.includes(parsed.type))
      : BUCKETS.find((b) => b.types === null);
    entries.get(bucket.title).push(line); // 桶内保留原始 subject 全文
  }
  return BUCKETS.map((b) => ({ title: b.title, entries: entries.get(b.title) }));
}

const HEADER_LINES = [
  '# 更新日志',
  '',
  '本文件由 tools/gen-changelog.mjs 从 Conventional Commits 生成，勿手改；重渲染用 --write。',
];

// 单个版本段；空桶不渲染桶标题，全部桶空则只渲染 `## [x.y.z]` 一行
function renderSection(section) {
  const lines = [`## [${section.version}]`];
  for (const bucket of classify(section.subjects)) {
    if (bucket.entries.length === 0) continue;
    lines.push('', `### ${bucket.title}`, '', ...bucket.entries.map((e) => `- ${e}`));
  }
  return lines;
}

// sections：[{version, subjects}]（version 已去 v 前缀、降序），渲染整份 markdown（\n 行尾，文件尾单换行）
export function renderChangelog(sections) {
  const lines = [...HEADER_LINES];
  for (const section of sections) lines.push('', ...renderSection(section));
  return `${lines.join('\n')}\n`;
}

// —— git 层 ——

const SEMVER_TAG_RE = /^v?\d+\.\d+\.\d+$/;
const stripV = (tag) => (tag.startsWith('v') ? tag.slice(1) : tag);

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

function commitSubjects(root, range) {
  const out = git(root, ['log', '--no-merges', '--format=%s', range]);
  return out === '' ? [] : out.split('\n').filter((line) => line !== '');
}

const semverTuple = (version) => version.split('.').map(Number);

// semver tag（可选 v 前缀）按 semver 降序；非 semver tag（如临时 tag）静默忽略
function semverTags(root) {
  const tags = git(root, ['tag', '--merged', 'HEAD'])
    .split('\n')
    .map((line) => line.trim())
    .filter((tag) => SEMVER_TAG_RE.test(tag));
  tags.sort((a, b) => {
    const va = semverTuple(stripV(a));
    const vb = semverTuple(stripV(b));
    return vb[0] - va[0] || vb[1] - va[1] || vb[2] - va[2];
  });
  return tags;
}

// 版本段集：每个 tag 区间 = 前一个（更老的）tag..本 tag，最老 tag 区间起点用空（全部历史）
function collectSections(root) {
  const tags = semverTags(root);
  const sections = tags.map((tag, i) => ({
    version: stripV(tag),
    subjects: commitSubjects(root, i + 1 < tags.length ? `${tags[i + 1]}..${tag}` : tag),
  }));
  return { tags, sections };
}

function packageVersion(root) {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  return typeof version === 'string' ? version : null;
}

// 全量段（含待发版段）：package.json version 无同名 tag（归一化比较）时，
// 在最前面渲染发版窗口期（bump 后、打 tag 前）的段 = 最新 tag..HEAD（无 tag 时为全部历史）。
function buildSections(root) {
  const { tags, sections } = collectSections(root);
  const version = packageVersion(root);
  if (version && !tags.some((tag) => stripV(tag) === version)) {
    const newest = tags[0];
    sections.unshift({ version, subjects: commitSubjects(root, newest ? `${newest}..HEAD` : 'HEAD') });
  }
  return { tags, sections };
}

// —— CLI ——

const USAGE = '用法: node tools/gen-changelog.mjs [--check] | --write | --notes [--to <version>]';

function parseArgs(argv) {
  let mode = 'check';
  let to = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') mode = 'write';
    else if (arg === '--check') mode = 'check';
    else if (arg === '--notes') mode = 'notes';
    else if (arg === '--to') {
      to = argv[++i];
      if (!to) throw new Error(`--to 缺少版本参数\n${USAGE}`);
    } else throw new Error(`未知参数 ${arg}\n${USAGE}`);
  }
  if (to && mode !== 'notes') throw new Error(`--to 只能与 --notes 搭配\n${USAGE}`);
  return { mode, to };
}

// 首处差异行号（1 起）；一致返回 null
function firstDiffLine(expected, actual) {
  const a = expected.split('\n');
  const b = actual.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return i + 1;
  }
  return null;
}

function runMain(argv) {
  const root = process.cwd();
  const changelogPath = path.join(root, 'CHANGELOG.md');
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[changelog] ${error.message}`);
    return 2;
  }
  try {
    const { tags, sections } = buildSections(root);
    if (args.mode === 'notes') {
      const target = args.to ?? tags[0] ?? null; // 默认最新 tag 版本；--to 接受待发版 version（归一化比较）
      const section = target && sections.find((s) => stripV(s.version) === stripV(target));
      if (!section) {
        console.error(`[changelog] 找不到版本 ${target} 的段（无 tag 且无待发版段）`);
        return 1;
      }
      process.stdout.write(`${renderSection(section).join('\n')}\n`);
      return 0;
    }
    const expected = renderChangelog(sections);
    if (args.mode === 'write') {
      fs.writeFileSync(changelogPath, expected, 'utf8');
      console.log(`[changelog] CHANGELOG.md 已重渲染（${sections.length} 段）`);
      return 0;
    }
    const disk = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
    const line = firstDiffLine(expected, disk);
    if (line !== null) {
      console.error(`[changelog] CHANGELOG.md 与期望内容不一致（首个差异在第 ${line} 行）。重跑 node tools/gen-changelog.mjs --write`);
      return 1;
    }
    console.log(`[changelog] CHANGELOG.md 与生成结果一致（${sections.length} 段）`);
    return 0;
  } catch (error) {
    console.error(`[changelog] ${error.message}`); // git/IO 失败：单行干净退出非零（对齐 tools/policy-check.mjs 主流程）
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = runMain(process.argv.slice(2));
}
