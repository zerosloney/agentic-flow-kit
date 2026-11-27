import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { hashSkillDir } from './lock.mjs';
import { sanitizeHostEnv, executeSandbox } from '../install/sandbox.mjs';
import { validateExecutionSafety } from '../../templates/engine/.agents/scripts/execution-guardrails.mjs';

export const DEFAULT_EVAL_THRESHOLD = 0.8;
export const DEFAULT_EVAL_MAX_AGE_DAYS = 30;
export const DEFAULT_CASE_TIMEOUT_MS = 15000;
export const EVAL_LOG_REL = path.join('.agents', 'evals', 'eval-log.json');
export const EVAL_RESULTS_REL = path.join('.agents', 'evals', 'results.jsonl');

/**
 * 判断文本是否匹配给定的字符串或正则模板（如 "/^abc/i" 或 "abc"）
 */
export function matchPattern(text, pattern) {
  if (pattern instanceof RegExp) return pattern.test(text);
  const s = String(pattern ?? '');
  if (s.startsWith('/') && s.lastIndexOf('/') > 0) {
    const lastSlash = s.lastIndexOf('/');
    const expr = s.slice(1, lastSlash);
    const flags = s.slice(lastSlash + 1);
    try {
      const re = new RegExp(expr, flags);
      return re.test(text);
    } catch {
      // 降级为普通子串匹配
    }
  }
  return text.includes(s);
}

/**
 * 递归深度子集断言（actual 必须完全包含 expected 结构中声明的所有键与值）
 */
export function deepPartialMatch(actual, expected) {
  if (expected === actual) return true;
  if (typeof expected !== 'object' || expected === null) return false;
  if (typeof actual !== 'object' || actual === null) return false;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) return false;
    for (let i = 0; i < expected.length; i += 1) {
      if (!deepPartialMatch(actual[i], expected[i])) return false;
    }
    return true;
  }

  for (const [key, expVal] of Object.entries(expected)) {
    if (!(key in actual)) return false;
    if (!deepPartialMatch(actual[key], expVal)) return false;
  }
  return true;
}

/**
 * 扫描项目中的技能评测数据集定义文件
 */
export function findSkillDatasets(target) {
  const list = [];
  const skillsDir = path.join(target, '.agents', 'skills');
  if (fs.existsSync(skillsDir)) {
    try {
      for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const skill = ent.name;
        const dsPath = path.join(skillsDir, skill, 'evals', 'dataset.json');
        if (fs.existsSync(dsPath)) {
          list.push({ skill, datasetPath: dsPath, relPath: path.relative(target, dsPath).replace(/\\/g, '/') });
        }
      }
    } catch {
      // ignore
    }
  }

  const evalsSkillsDir = path.join(target, '.agents', 'evals', 'skills');
  if (fs.existsSync(evalsSkillsDir)) {
    try {
      for (const ent of fs.readdirSync(evalsSkillsDir, { withFileTypes: true })) {
        if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
        const skill = ent.name.replace(/\.(dataset\.)?json$/i, '');
        if (list.some((item) => item.skill === skill)) continue;
        const dsPath = path.join(evalsSkillsDir, ent.name);
        list.push({ skill, datasetPath: dsPath, relPath: path.relative(target, dsPath).replace(/\\/g, '/') });
      }
    } catch {
      // ignore
    }
  }

  return list.sort((a, b) => a.skill.localeCompare(b.skill));
}

/**
 * 加载技能评测数据集定义
 */
export function loadSkillDataset(target, skillName = null, customDatasetPath = null) {
  let absPath = null;
  if (customDatasetPath) {
    absPath = path.isAbsolute(customDatasetPath) ? customDatasetPath : path.resolve(target, customDatasetPath);
  } else if (skillName) {
    const candidates = [
      path.join(target, '.agents', 'skills', skillName, 'evals', 'dataset.json'),
      path.join(target, '.agents', 'evals', 'skills', `${skillName}.json`),
      path.join(target, '.agents', 'evals', 'skills', `${skillName}.dataset.json`),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        absPath = cand;
        break;
      }
    }
  }

  if (!absPath || !fs.existsSync(absPath)) {
    return { ok: false, error: `Dataset not found for skill: ${skillName || customDatasetPath}` };
  }

  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    const parsed = JSON.parse(raw);
    const cases = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cases) ? parsed.cases : (Array.isArray(parsed.tasks) ? parsed.tasks : []));
    const skill = parsed.skill || skillName || path.basename(absPath, '.json').replace(/\.dataset$/i, '');
    return {
      ok: true,
      path: absPath,
      relPath: path.relative(target, absPath).replace(/\\/g, '/'),
      skill,
      version: parsed.version || 1,
      cases,
    };
  } catch (err) {
    return { ok: false, error: `Failed to parse dataset JSON: ${err.message}` };
  }
}

/**
 * 运行单个评测用例并验证输出与退出状态
 */
export function evaluateSkillCase(caseItem, { target, timeoutMs, sandbox = false, env = {} } = {}) {
  const caseId = caseItem.id || 'unnamed-case';
  const title = caseItem.title || caseId;
  const timeout = caseItem.expect?.maxDurationMs || timeoutMs || DEFAULT_CASE_TIMEOUT_MS;

  let cmd = caseItem.command;
  let args = Array.isArray(caseItem.args) ? [...caseItem.args] : [];
  let fullCommandString = '';

  if (Array.isArray(cmd)) {
    const [exec, ...rest] = cmd;
    cmd = exec;
    args = [...rest, ...args];
    fullCommandString = [cmd, ...args].join(' ');
  } else if (typeof cmd === 'string') {
    fullCommandString = args.length ? `${cmd} ${args.join(' ')}` : cmd;
  } else {
    return {
      id: caseId,
      title,
      ok: false,
      durationMs: 0,
      status: -1,
      stdout: '',
      stderr: '',
      errors: ['Invalid or missing command in case definition'],
    };
  }

  const start = Date.now();
  let status = 0;
  let stdout = '';
  let stderr = '';
  let timedOut = false;

  if (sandbox) {
    try {
      const res = executeSandbox({
        target,
        command: fullCommandString,
        options: { json: true, stdio: 'pipe' },
      });
      status = res.status ?? 1;
      stdout = res.stdout || '';
      stderr = res.stderr || '';
    } catch (err) {
      status = 1;
      stderr = err.message;
    }
  } else {
    // 用例来自技能数据集，和命令写在同一份 JSON 里。数据集里的 allowUnsafe 不能关掉护栏。
    const safety = validateExecutionSafety(fullCommandString, { root: target, allowL2: true });
    if (!safety.safe) {
      status = 1;
      stdout = '';
      stderr = `Command blocked by execution guardrails (${safety.level}): ${safety.reason}`;
    } else {
      const sanitizedBase = sanitizeHostEnv(process.env);
      const runEnv = { ...sanitizedBase, ...env, ...(caseItem.env || {}) };
      const useShell = caseItem.shell === true || (typeof caseItem.command === 'string' && !caseItem.args?.length);

      try {
        let res;
        if (typeof caseItem.command === 'string' && !caseItem.args?.length) {
          res = spawnSync(caseItem.command, {
            cwd: target,
            encoding: 'utf8',
            input: caseItem.stdin ?? '',
            timeout,
            env: runEnv,
            shell: true,
            windowsHide: true,
          });
        } else {
          res = spawnSync(cmd === 'node' ? process.execPath : cmd, args, {
            cwd: target,
            encoding: 'utf8',
            input: caseItem.stdin ?? '',
            timeout,
            env: runEnv,
            shell: useShell,
            windowsHide: true,
          });
        }
        status = res.status ?? 1;
        stdout = res.stdout || '';
        stderr = res.stderr || '';
        if (res.error?.code === 'ETIMEDOUT') {
          timedOut = true;
        }
      } catch (err) {
        status = 1;
        stderr = err.message;
      }
    }
  }

  const durationMs = Date.now() - start;
  const errors = [];

  if (timedOut || (caseItem.expect?.maxDurationMs && durationMs > caseItem.expect.maxDurationMs)) {
    errors.push(`Execution timed out after ${durationMs}ms (maxDurationMs: ${caseItem.expect?.maxDurationMs || timeout})`);
  }

  const expect = caseItem.expect || {};

  if (expect.status !== undefined && status !== expect.status) {
    errors.push(`Expected exit status ${expect.status}, got ${status}`);
  }

  if (expect.stdout !== undefined) {
    const patterns = Array.isArray(expect.stdout) ? expect.stdout : [expect.stdout];
    for (const pat of patterns) {
      if (!matchPattern(stdout, pat)) {
        errors.push(`stdout did not match expected pattern: ${pat}`);
      }
    }
  }

  if (expect.stderr !== undefined) {
    const patterns = Array.isArray(expect.stderr) ? expect.stderr : [expect.stderr];
    for (const pat of patterns) {
      if (!matchPattern(stderr, pat)) {
        errors.push(`stderr did not match expected pattern: ${pat}`);
      }
    }
  }

  if (expect.json !== undefined) {
    try {
      const parsedJson = JSON.parse(stdout.trim());
      if (!deepPartialMatch(parsedJson, expect.json)) {
        errors.push(`stdout JSON does not satisfy expected partial match: ${JSON.stringify(expect.json)}`);
      }
    } catch (err) {
      errors.push(`Failed to parse stdout as JSON: ${err.message}`);
    }
  }

  return {
    id: caseId,
    title,
    ok: errors.length === 0,
    durationMs,
    status,
    stdout,
    stderr,
    errors,
  };
}

/**
 * 记录技能评测证据凭证至 .agents/evals/eval-log.json 和 .agents/evals/results.jsonl
 */
export function recordSkillEvalLog(target, suiteResult, options = {}) {
  const skillName = suiteResult.skill;
  const skillDir = path.join(target, '.agents', 'skills', skillName);

  let signature = '';
  if (fs.existsSync(skillDir)) {
    try {
      signature = hashSkillDir(skillDir).checksum;
    } catch {
      signature = '';
    }
  }
  if (!signature) {
    if (suiteResult.dataset && fs.existsSync(path.join(target, suiteResult.dataset))) {
      try {
        const raw = fs.readFileSync(path.join(target, suiteResult.dataset));
        signature = crypto.createHash('sha256').update(raw).digest('hex');
      } catch {
        signature = '0'.repeat(64);
      }
    } else {
      signature = '0'.repeat(64);
    }
  }

  const now = new Date();
  const entry = {
    ts: now.toISOString(),
    signature,
    skill: skillName,
    passRate: suiteResult.passRate,
    tasks: suiteResult.total,
    model: options.model || 'eval-harness',
    note: options.note || `skill eval: ${suiteResult.passed}/${suiteResult.total} passed`,
    threshold: suiteResult.threshold ?? DEFAULT_EVAL_THRESHOLD,
    outcome: suiteResult.outcome,
  };

  const logFile = path.join(target, EVAL_LOG_REL);
  let logData = { version: 1, updatedAt: now.toISOString(), entries: [] };
  if (fs.existsSync(logFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      if (parsed && Array.isArray(parsed.entries)) {
        logData = {
          version: 1,
          updatedAt: now.toISOString(),
          entries: parsed.entries.slice(-199),
        };
      }
    } catch {
      // ignore
    }
  }

  logData.entries.push(entry);
  logData.updatedAt = now.toISOString();

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const tmp = `${logFile}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(logData, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, logFile);

  const resultsFile = path.join(target, EVAL_RESULTS_REL);
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
  fs.appendFileSync(resultsFile, `${JSON.stringify(entry)}\n`, 'utf8');

  return { logFile, entry };
}

/**
 * 运行技能评测套件
 */
export function runSkillEvalSuite(target, options = {}) {
  const {
    skill,
    dataset,
    threshold = DEFAULT_EVAL_THRESHOLD,
    sandbox = false,
    strict = false,
    record = false,
    env = {},
    model = 'eval-harness',
    note = '',
  } = options;

  let datasets = [];
  if (dataset || skill) {
    const ds = loadSkillDataset(target, skill, dataset);
    if (!ds.ok) {
      return {
        ok: false,
        error: ds.error,
        suites: [],
      };
    }
    datasets = [ds];
  } else {
    const found = findSkillDatasets(target);
    for (const f of found) {
      const ds = loadSkillDataset(target, f.skill, f.datasetPath);
      if (ds.ok) datasets.push(ds);
    }
  }

  if (!datasets.length) {
    return {
      ok: false,
      error: '未发现任何可用的技能评测数据集定义',
      suites: [],
    };
  }

  const suites = [];
  let allPass = true;

  for (const ds of datasets) {
    const caseResults = [];
    for (const c of ds.cases) {
      const res = evaluateSkillCase(c, { target, sandbox, env });
      caseResults.push(res);
    }

    const total = caseResults.length;
    const passed = caseResults.filter((r) => r.ok).length;
    const failed = total - passed;
    const passRate = total > 0 ? passed / total : 0;
    const outcome = passRate >= threshold ? 'pass' : 'fail';
    if (outcome === 'fail') allPass = false;

    const suiteRes = {
      skill: ds.skill,
      dataset: ds.relPath,
      version: ds.version,
      total,
      passed,
      failed,
      passRate: Number(passRate.toFixed(4)),
      threshold,
      outcome,
      cases: caseResults,
    };

    if (record) {
      const recordInfo = recordSkillEvalLog(target, suiteRes, { model, note, threshold });
      suiteRes.recorded = recordInfo;
    }

    suites.push(suiteRes);
  }

  return {
    ok: allPass,
    threshold,
    strict,
    suites,
  };
}

/**
 * Doctor 技能评测健康状态体检
 */
export function checkSkillsEvalHealth(target, t) {
  const skillsDir = path.join(target, '.agents', 'skills');
  if (!fs.existsSync(skillsDir)) return null;

  let skillDirs = [];
  try {
    skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return null;
  }

  if (!skillDirs.length) return null;

  const logFile = path.join(target, EVAL_LOG_REL);
  let evalEntries = [];
  if (fs.existsSync(logFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      if (Array.isArray(parsed?.entries)) {
        evalEntries = parsed.entries;
      }
    } catch {
      return {
        ok: false,
        name: 'skills eval',
        detail: t('doctor.skillsEvalLogInvalid'),
      };
    }
  }

  const datasets = findSkillDatasets(target);
  if (!datasets.length) {
    if (evalEntries.length) {
      return {
        ok: true,
        name: 'skills eval',
        detail: t('doctor.skillsEvalOk', { count: evalEntries.length }),
      };
    }
    return {
      ok: true,
      name: 'skills eval',
      detail: t('doctor.skillsEvalNoDatasets', { count: skillDirs.length }),
      warn: true,
    };
  }

  const problems = [];
  let hasFailing = false;
  const now = Date.now();
  const maxAgeMs = DEFAULT_EVAL_MAX_AGE_DAYS * 24 * 3600 * 1000;

  for (const ds of datasets) {
    const entries = evalEntries.filter((e) => e.skill === ds.skill);
    if (!entries.length) {
      problems.push(t('doctor.skillsEvalMissing', { skill: ds.skill }));
      continue;
    }
    // 最新条 = 时间戳最大者；同毫秒并列时取文件内后记条目（记录序即时间序——
    // 纯 sort 在并列时按稳定序取先记者，快机器上连续两次落账会取错，CI 偶发红，2026-11-23）。
    const latest = entries.reduce((best, e) => (
      !best || Date.parse(e.ts) >= Date.parse(best.ts) ? e : best
    ), null);
    if (latest.outcome !== 'pass') {
      hasFailing = true;
      problems.push(t('doctor.skillsEvalFailed', {
        skill: ds.skill,
        passRate: `${(latest.passRate * 100).toFixed(0)}%`,
        threshold: `${(latest.threshold * 100).toFixed(0)}%`,
      }));
      continue;
    }
    const age = now - Date.parse(latest.ts);
    if (age > maxAgeMs) {
      problems.push(t('doctor.skillsEvalStale', { skill: ds.skill, days: Math.floor(age / (24 * 3600 * 1000)) }));
    }
  }

  if (problems.length) {
    return {
      ok: !hasFailing,
      name: 'skills eval',
      detail: problems.join('; '),
      fix: t('doctor.skillsEvalFixHint'),
      warn: !hasFailing,
    };
  }

  return {
    ok: true,
    name: 'skills eval',
    detail: t('doctor.skillsEvalOk', { count: datasets.length }),
  };
}
