// 技能准入检查（R3-4）：frontmatter 必填、name 唯一且与目录一致、描述预算、
// 触发词冲突、evalTasks 引用存在、lockfile 漂移。
// #24 正文写作准入（BODY_* 规则 ID）：祈使句 / 每步可验证 / 单源（禁复制他处正文）/
// 长度预算——存量技能（lockfile/manifest 已登记）只出 advisory，新技能硬拦。
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, splitFrontmatter } from '../install/frontmatter.mjs';
import { readManifest } from '../install/manifest.mjs';
import { SKILLS_REL, diffAgainstLock, readLock } from './lock.mjs';

export const DESCRIPTION_BUDGET = 300;
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
// #24 正文长度预算（去 frontmatter 后的正文行数）：取约两倍余量给合理增长留空间。
export const BODY_BUDGET_LINES = 400;
// 单源判定口径：正文长句（去标点/空白归一后 ≥20 字）在不同技能间重复 ≥3 处视为复制正文。
const BODY_DUP_MIN_SENTENCES = 3;
const BODY_DUP_MIN_CHARS = 20;

export function readEvalTaskIds(target) {
  const file = path.join(target, '.agents', 'evals', 'tasks.tsv');
  try {
    return new Set(
      fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.split('\t')[0].trim())
        .filter((id) => id && id !== 'task'),
    );
  } catch {
    return null; // 无 tasks.tsv：不校验 evalTasks 引用
  }
}

function splitList(value) {
  return String(value || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---- #24 正文写作准入（启发式，确定性：同输入同输出） ----

const STEP_LINE_RE = /^\s*(?:[-*+]|\d+[.、)])\s+/;
const CHECKBOX_RE = /^\[(?: |x|X)\]\s*/;
// 主语化填充 / 商榷语气清单：祈使句应以动词开头，不带「我们/你」类主语、
// 不用「需要注意的是」类填充、不用疑问与商量口吻。
const SUBJECT_FILLER_RE = /^(?:我们|我|你|您|大家|请注意|需要注意的是|值得注意的是|值得一提的是|需要说明的是|简而言之|总的来说|综上所述|总之|we\b|you\b|let's\b|please note\b|note that\b|it is worth\b)/i;
const HEDGE_RE = /^(?:是否|要不要|能不能|可不可以|或许|也许|可以考虑|建议考虑|不妨|maybe\b|perhaps\b|should we\b|could we\b|what if\b)/i;
const QUESTION_RE = /[？?]/;
const TAIL_SOFT_RE = /(?:吧|吗|呢|嘛)\s*[。！!]?\s*$/;
// 可核对要素：行内代码 / 路径式 token / 工件扩展名 / 常见命令 / 数字指标 / 可观察判据词。
const HAS_CODE_RE = /`[^`\n]+`/;
const PATH_TOKEN_RE = /[\w.@-]+(?:\/[\w.@-]+)+/;
const EXT_TOKEN_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx|json|md|txt|yaml|yml|sh|ps1|py|toml|lock|csv|sql|html|css|env)\b/i;
const CMD_TOKEN_RE = /\b(?:npm|pnpm|yarn|node|npx|git|make|cargo|pip3?|python3?|docker|kubectl|curl|wget|rg|grep|bash)\b/;
const CRITERION_RE = /(?:退出码|exit ?code|通过率|应输出|应返回|应显示|应得到|输出为|结果为|状态为|预期|expected|\bpass\b|\bfail\b)/i;
// 工件指针词：指向台账 / 清单 / 评审工件或验收判据的步骤视为可核对。
const ARTIFACT_RE = /(?:判据|验收|证据|台账|清单|表格|checklist|scorecard)/i;
const HAS_DIGIT_RE = /\d/;

function truncateText(s, max = 32) {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// 正文 → 归一化长句集合：去围栏代码与行内代码后按句读切分，
// 仅保留 ≥BODY_DUP_MIN_CHARS 字的句子（供跨技能单源比对）。
function bodySentences(body) {
  const cleaned = String(body || '')
    .replace(/```[\s\S]*?(?:```|$)/g, '\n')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, '\n')
    .replace(/`[^`\n]*`/g, ' ');
  return new Set(
    cleaned
      .split(/[。！？!?；;\n]+/)
      .map((s) => s.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase())
      .filter((s) => s.length >= BODY_DUP_MIN_CHARS),
  );
}

// 正文规则：祈使句 / 每步可验证 / 长度预算。只对步骤行（编号/列表步骤）做祈使与
// 可验证检查，跳过围栏代码块；单源检查需要整棵目标树正文，在 lintSkills 里跨技能做。
function lintSkillBody(body) {
  const findings = [];
  const lines = String(body || '').split(/\r?\n/);
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  const lineCount = end - start;
  if (lineCount > BODY_BUDGET_LINES) {
    findings.push({ rule: 'BODY_LENGTH', message: `正文 ${lineCount} 行超出预算 ${BODY_BUDGET_LINES} 行` });
  }
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const fenceMark = raw.match(/^\s*(```|~~~)/);
    if (fenceMark) {
      if (!fence) fence = fenceMark[1];
      else if (fence === fenceMark[1]) fence = null;
      continue;
    }
    if (fence || !STEP_LINE_RE.test(raw)) continue;
    const text = raw.replace(STEP_LINE_RE, '').replace(CHECKBOX_RE, '').replace(/\*\*/g, '').trim();
    if (!text) continue;
    // 疑问/商榷判定基于剥掉行内代码与链接后的文本，避免 URL 参数误报。
    const plain = text.replace(/`[^`\n]*`/g, ' ').replace(/\[[^\]]*\]\([^)]*\)/g, ' ');
    if (SUBJECT_FILLER_RE.test(plain) || HEDGE_RE.test(plain) || QUESTION_RE.test(plain) || TAIL_SOFT_RE.test(plain)) {
      findings.push({ rule: 'BODY_IMPERATIVE', message: `正文第 ${i + 1} 行步骤应祈使（动词开头，去主语化填充与商榷语气）：「${truncateText(text)}」` });
    }
    const verifiable = HAS_CODE_RE.test(text) || PATH_TOKEN_RE.test(text) || EXT_TOKEN_RE.test(text)
      || CMD_TOKEN_RE.test(text) || CRITERION_RE.test(text) || ARTIFACT_RE.test(text) || HAS_DIGIT_RE.test(text);
    if (!verifiable) {
      findings.push({ rule: 'BODY_STEP_VERIFIABLE', message: `正文第 ${i + 1} 行步骤缺可核对要素（命令/路径/工件/判据）：「${truncateText(text)}」` });
    }
  }
  return findings;
}

export function lintSkillDir(dir, { expectName, evalTaskIds = null, existing = false } = {}) {
  const errors = [];
  const warnings = [];
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) {
    return { ok: false, errors: ['缺少 SKILL.md'], warnings, meta: {} };
  }
  const text = fs.readFileSync(file, 'utf8');
  const { has, body } = splitFrontmatter(text);
  if (!has) {
    return { ok: false, errors: ['SKILL.md 缺少 frontmatter'], warnings, meta: {} };
  }
  const meta = parseFrontmatter(text);
  if (!meta.name) errors.push('frontmatter 缺少 name');
  else if (!SKILL_NAME_RE.test(meta.name)) errors.push(`name 须为 kebab-case：${meta.name}`);
  if (expectName && meta.name && meta.name !== expectName) {
    errors.push(`name「${meta.name}」与目录「${expectName}」不一致`);
  }
  if (!meta.description) errors.push('frontmatter 缺少 description');
  else if (meta.description.length > DESCRIPTION_BUDGET) {
    errors.push(`description 超出预算 ${DESCRIPTION_BUDGET} 字符（现 ${meta.description.length}）`);
  }
  if (!String(body || '').trim()) warnings.push('SKILL.md 正文为空');
  else {
    // #24 分级：存量技能正文违规只出 advisory（warnings），新技能硬拦（errors）。
    for (const f of lintSkillBody(body)) {
      (existing ? warnings : errors).push(`[${f.rule}] ${f.message}`);
    }
  }
  if (meta.evalTasks && evalTaskIds) {
    for (const id of splitList(meta.evalTasks)) {
      if (!evalTaskIds.has(id)) errors.push(`evalTasks 引用不存在的任务「${id}」`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, meta, body };
}

export function lintSkills(target, { skillsRoot = SKILLS_REL, verifyLock = true } = {}) {
  const errors = [];
  const warnings = [];
  const skills = [];
  const byName = new Map();
  const byTrigger = new Map();
  const bodySets = [];
  const root = path.join(target, skillsRoot);
  const lock = verifyLock ? readLock(target) : null;
  const manifestFiles = readManifest(target)?.files || {};
  // #24 存量判定（依据既有登记机制）：add-skill 把技能登记进 lock.skills 并逐文件
  // 哈希进 manifest.files；install 把模板技能逐文件哈希进 manifest.files。
  // 两者任一命中即存量（正文违规只 advisory）；都未命中视为新技能（硬拦）。
  const isRegistered = (dirName) => Boolean(lock?.skills?.[dirName])
    || Object.keys(manifestFiles).some((k) => k.startsWith(`${skillsRoot}/${dirName}/`));

  if (!fs.existsSync(root)) {
    return { ok: false, errors: [`技能目录不存在：${skillsRoot}`], warnings, skills };
  }

  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
  const evalTaskIds = readEvalTaskIds(target);

  for (const dirName of dirs) {
    const rel = `${skillsRoot}/${dirName}`;
    const registered = isRegistered(dirName);
    const res = lintSkillDir(path.join(root, dirName), { expectName: dirName, evalTaskIds, existing: registered });
    bodySets.push({ rel, registered, sentences: res.body ? bodySentences(res.body) : new Set() });
    for (const e of res.errors) errors.push(`${rel}: ${e}`);
    for (const w of res.warnings) warnings.push(`${rel}: ${w}`);
    const name = res.meta.name || dirName;
    if (byName.has(name)) errors.push(`${rel}: name「${name}」与 ${byName.get(name)} 重复`);
    else byName.set(name, rel);

    for (const trigger of splitList(res.meta.triggers)) {
      if (byTrigger.has(trigger)) {
        errors.push(`${rel}: 触发词「${trigger}」与 ${byTrigger.get(trigger)} 冲突`);
      } else byTrigger.set(trigger, rel);
    }

    if (verifyLock) {
      const entry = lock.skills?.[dirName];
      if (!entry) warnings.push(`${rel}: 未登记 lockfile（内置或手工技能，不校验完整性）`);
      else {
        for (const p of diffAgainstLock(target, dirName, entry)) {
          errors.push(`${rel}/${p.rel}: 与 lockfile 不一致（${p.reason}）`);
        }
      }
    }

    skills.push({ name, dir: rel, description: res.meta.description || '' });
  }

  // #24 单源：同一次 lint 的目标树内，不同技能正文大段重复 → 应引用指针而非复制正文。
  // 分级：任一新技能 → error（落在新技能侧）；双存量 → advisory（落在排序靠后者）。
  for (let i = 0; i < bodySets.length; i += 1) {
    for (let j = i + 1; j < bodySets.length; j += 1) {
      const a = bodySets[i];
      const b = bodySets[j];
      const shared = [...b.sentences].filter((s) => a.sentences.has(s));
      if (shared.length < BODY_DUP_MIN_SENTENCES) continue;
      const detail = `与 ${a.rel} 正文重复 ${shared.length} 处长句，应引用指针而非复制正文（如「${truncateText(shared[0])}」）`;
      if (a.registered && b.registered) warnings.push(`${b.rel}: [BODY_DUPLICATED] ${detail}`);
      else errors.push(`${a.registered ? b.rel : a.rel}: [BODY_DUPLICATED] ${detail}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, skills };
}
