// execution-guardrails.mjs — 运行时执行安全护栏与环境脱敏沙箱
// 架构定位：AI 原生工作流引擎的核心执行防护层（零外部依赖，纯 Node.js 原生标准库实现）。
// 职责：
//   1. 环境脱敏 (sanitizeExecEnv)：防止宿主敏感 Token/Password/Secret 泄露至子进程/工具执行流。
//   2. 文本脱敏 (redactSensitiveText)：输出流(stdout/stderr)、事件日志与前端看板敏感词遮蔽。
//   3. 高危指令拦截 (validateExecutionSafety)：识别 L3 毁灭性破坏指令、越界路径穿透与提权命令。
//   4. 安全执行原语 (safeExecFileWithGuardrails / safeExec)：带超时限制、环境净化、敏感词屏蔽与跨平台树杀的子进程安全运行器。

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

// ── 环境变量脱敏与放行模式 ──────────────────────────────────────────────

export const DEFAULT_STRIP_ENV_PATTERNS = [
  '*TOKEN*',
  '*SECRET*',
  '*KEY*',
  '*PASSWORD*',
  '*PASSWD*',
  '*CREDENTIAL*',
  '*AUTH*',
  '*PRIVATE*',
  'AWS_*',
  'GITHUB_*',
  'GH_*',
  'NPM_*',
  'AZURE_*',
  'SSH_*',
  'DOCKER_*',
  'KUBE_*',
  'GCP_*',
  'GOOGLE_*',
  'OPENAI_*',
  'ANTHROPIC_*',
  'GEMINI_*',
  'DATABASE_*',
  'DB_*',
];

export const DEFAULT_PASS_ENV_PATTERNS = [
  'PATH',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'HOME',
  'USERPROFILE',
  'USER',
  'USERNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_*',
  'TZ',
  'NODE_*',
  'CI',
  'FLOW_KIT_*',
  'PIPELINE_RUN_ID',
  'PWD',
  'EDITOR',
  'COLORTERM',
];

function matchPattern(key, pat) {
  if (pat.includes('*')) {
    const escaped = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(key);
  }
  return key.toLowerCase() === pat.toLowerCase();
}

/**
 * 净化环境变量对象，剔除可能包含敏感凭证的键，仅保留安全基准系统变量与明确放行的键。
 * @param {Record<string, string>} [env=process.env]
 * @param {Object} [options={}]
 * @returns {Record<string, string>}
 */
export function sanitizeExecEnv(env = process.env, options = {}) {
  if (options.allowAll) {
    return { ...env };
  }

  const stripPatterns = options.stripEnv || [
    ...DEFAULT_STRIP_ENV_PATTERNS,
    ...(options.extraStrip || []),
  ];
  const passPatterns = options.passEnv || [
    ...DEFAULT_PASS_ENV_PATTERNS,
    ...(options.extraPass || []),
  ];

  const sanitized = {};

  for (const [rawKey, rawValue] of Object.entries(env)) {
    if (rawValue === undefined) continue;

    // 优先判定是否被显式强制放行
    const isExplicitlyAllowed = (options.extraPass || []).some((p) => matchPattern(rawKey, p));
    if (isExplicitlyAllowed) {
      sanitized[rawKey] = rawValue;
      continue;
    }

    // 命中敏感词黑名单则剔除
    const isStripped = stripPatterns.some((p) => matchPattern(rawKey, p));
    if (isStripped) {
      continue;
    }

    // 命中安全白名单则放行
    const isPassed = passPatterns.some((p) => matchPattern(rawKey, p));
    if (isPassed) {
      sanitized[rawKey] = rawValue;
    }
  }

  return sanitized;
}

// ── 文本流与日志敏感词脱敏 ──────────────────────────────────────────────

export const SENSITIVE_PATTERNS = [
  // 1. 私钥证书块 (BEGIN ... PRIVATE KEY ... END)
  {
    id: 'private-key-block',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    replace: () => '-----BEGIN PRIVATE KEY-----\n[REDACTED_PRIVATE_KEY]\n-----END PRIVATE KEY-----',
  },
  // 2. AWS 凭证 ID
  {
    id: 'aws-access-key-id',
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: () => '[REDACTED_AWS_KEY]',
  },
  // 3. GitHub Tokens (经典与 Fine-grained)
  {
    id: 'github-token',
    re: /\b(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
    replace: () => '[REDACTED_GH_TOKEN]',
  },
  // 4. Slack 凭据
  {
    id: 'slack-token',
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replace: () => '[REDACTED_SLACK_TOKEN]',
  },
  // 5. Stripe 生产密钥
  {
    id: 'stripe-live-key',
    re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g,
    replace: () => '[REDACTED_STRIPE_KEY]',
  },
  // 6. Google API Key
  {
    id: 'google-api-key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: () => '[REDACTED_GOOGLE_KEY]',
  },
  // 7. Bearer Authorization 请求头（优先于普通裸 JWT 匹配，避免前缀残余）
  {
    id: 'bearer-token',
    re: /\b(Bearer\s+)([A-Za-z0-9_\-\.]{20,})\b/gi,
    replace: (_m, p1) => `${p1}[REDACTED_BEARER_TOKEN]`,
  },
  // 8. 独立 JWT 格式令牌
  {
    id: 'jwt-token',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: () => '[REDACTED_JWT]',
  },
  // 9. 数据库连接串口令 (Password=xxx / pwd=xxx)
  {
    id: 'connection-string-password',
    re: /(\b(?:password|pwd)\s*=\s*)(?!\*|\$|<|\{)[A-Za-z0-9_\-+/=]{8,}(?![A-Za-z0-9_.])/gi,
    replace: (_m, p1) => `${p1}[REDACTED_PASSWORD]`,
  },
  // 10. 赋值语句中的通用密钥 / 密码 (key=value, "token": "xxx")
  {
    id: 'generic-secret-kv',
    re: /(["']?(?:api[_-]?key|apikey|access[_-]?key|client[_-]?secret|private[_-]?key|secret|token|passwd|password|pwd|_auth|authorization)["']?\s*[:=]\s*["']?)([A-Za-z0-9+/=_-]{16,})(["']?)/gi,
    replace: (_m, p1, _p2, p3) => `${p1}[REDACTED_SECRET]${p3 || ''}`,
  },
];

/**
 * 对输出文本、标准错误或运行日志进行敏感凭据掩码脱敏
 * @param {string} text
 * @param {Object} [options={}]
 * @returns {string}
 */
export function redactSensitiveText(text, options = {}) {
  if (!text || typeof text !== 'string') return text || '';
  let result = text;
  const mask = options.mask;

  for (const item of SENSITIVE_PATTERNS) {
    if (mask) {
      result = result.replace(item.re, mask);
    } else {
      result = result.replace(item.re, item.replace);
    }
  }

  return result;
}

// ── 高危指令与越界路径安全校验 ──────────────────────────────────────────

export const L3_DANGEROUS_PATTERNS = [
  // 管道直通远程执行 (curl | bash, wget | sh)
  /(?:curl|wget|fetch)\s+[^\n\r|]+\|\s*(?:bash|sh|zsh|dash|sudo)/i,
  /\b(?:eval|bash|sh|zsh)\s+-c\s+["'].*?(?:curl|wget|base64)/i,
  // 破坏性整盘/根目录文件系统操作
  /\brm\s+-(?:rf|fr|r\s+-f|f\s+-r)\s+(?:\/|\/\*|~|\$HOME|\.\.\/|\*)\b/i,
  /\brm\s+-(?:rf|fr|r\s+-f|f\s+-r)\b(?:\s+["']?(?:\/|C:\\))/i,
  /\brmdir\s+\/s(?:\s+\/q)?\s+(?:[a-z]:\\|\/|\\)\b/i,
  /\bdel\s+\/s(?:\s+\/q)?\s+(?:[a-z]:\\|\/|\\|\*.*)\b/i,
  // 格式化与磁盘直写
  /\b(?:mkfs|dd\s+if=|fdisk|format\s+[a-z]:)/i,
  // 提权与特权变更
  /\bsudo\s+/i,
  /\bsu\s+(?:-\s+)?(?:root)?/i,
  /\brunas\s+/i,
  // 越权赋予全系统全局权限
  /\bchmod\s+(?:-R\s+)?(?:777|a\+rwx|0777)\s+(?:\/|\/etc|\/usr|\/var|C:\\)/i,
  /\bchown\s+(?:-R\s+)?root\s+(?:\/|\/etc|\/usr|\/var|C:\\)/i,
  // 系统核心敏感路径访问
  /(?:\/etc\/(?:passwd|shadow|sudoers)|\/root\b|C:\\(?:Windows|System32))/i,
  /(?:~|\$HOME)\/(?:\.ssh|\.aws|\.kube|\.gnupg)/i,
  // Fork 炸弹阻断
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

const WRAPPER_PREFIX_SOURCE = '(?:(?:sudo|doas|nohup|nice|time|xargs|env|timeout)(?:\\s+[^\\s;&|()]+)*\\s+)*';

function commandStartPattern(body) {
  return new RegExp(`(?:^|[;&|(\\n]\\s*)${WRAPPER_PREFIX_SOURCE}${body}`, 'i');
}

export const L2_DANGEROUS_PATTERNS = [
  // 包管理器全局/外部依赖安装与升级
  commandStartPattern('(?:npm|pnpm|yarn|bun)\\s+(?:install|i|add|update)\\b'),
  commandStartPattern('(?:pip|pip3|poetry|pipenv)\\s+(?:install|add)\\b'),
  commandStartPattern('(?:cargo)\\s+(?:install|add)\\b'),
  commandStartPattern('(?:go)\\s+(?:get|install)\\b'),
  commandStartPattern('(?:gem)\\s+install\\b'),
  commandStartPattern('(?:apt|apt-get|apk|yum|dnf|pacman|brew)\\s+install\\b'),
  // 外部网络数据拉取工具
  commandStartPattern('(?:curl|wget|scp|sftp|rsync|nc|netcat|telnet|ftp)\\b'),
  // 外部编译构建
  commandStartPattern('(?:make|cmake\\s+--build|ninja|gcc|g\\+\\+|clang)\\b'),
];

export const L0_SAFE_PATTERNS = [
  /^git\s+(?:status|log|diff|branch|show|remote|rev-parse|describe)\b/i,
  /^(?:ls|dir|cat|head|tail|wc|grep|rg|find|pwd)\b/i,
  /^(?:node|npm|python|python3|git|cargo|go|docker|podman|flow-kit)\s+(?:--version|-v|version)\b/i,
  /^flow-kit\s+(?:status|diff|explain|list-hosts|doctor|arch\s+graph|metrics\s+report)\b/i,
  /^echo\s+[^><|&]+$/i,
];

export const L1_SAFE_PATTERNS = [
  /\b(?:npm\s+test|node\s+--test|pytest|python\s+-m\s+(?:unittest|pytest)|cargo\s+test|cargo\s+check|cargo\s+clippy|go\s+test|mvn\s+test|gradle\s+test)\b/i,
  /\b(?:npm\s+run\s+(?:lint|check|test[a-z0-9_-]*)|eslint|prettier\s+--check)\b/i,
  /^flow-kit\s+(?:arch\s+check|mcp\s+audit|metrics\s+check)\b/i,
];

/**
 * 校验执行命令是否越过项目根目录尝试非法路径逃逸
 * @param {string} cmdStr
 * @param {string} [root]
 * @returns {{ escaped: boolean, reason?: string }}
 */
export function checkPathTraversalEscape(cmdStr, root = process.cwd()) {
  const normalizedRoot = path.resolve(root);

  // 1. 检查是否存在危险的重定向写入至上级或系统盘根目录，如 > ../../foo 或 > /etc/
  const redirectMatch = /(?:>{1,2})\s*([^\s;&|()]+)/.exec(cmdStr);
  if (redirectMatch) {
    const targetFile = redirectMatch[1].replace(/["']/g, '');
    const resolvedTarget = path.resolve(normalizedRoot, targetFile);
    const rel = path.relative(normalizedRoot, resolvedTarget);
    if (rel.startsWith('..') || path.isAbsolute(targetFile) && !resolvedTarget.startsWith(normalizedRoot)) {
      return {
        escaped: true,
        reason: `Disallowed write redirection escaping workspace root: ${targetFile}`,
      };
    }
  }

  // 2. 检查多层级回退穿越模式 (如 ../../../..)
  const traversalDepthMatch = cmdStr.match(/\.\.[\\/]/g);
  if (traversalDepthMatch && traversalDepthMatch.length >= 3) {
    return {
      escaped: true,
      reason: `Deep path traversal sequence detected (depth: ${traversalDepthMatch.length})`,
    };
  }

  return { escaped: false };
}

/**
 * 判定命令执行的风险等级与护栏检查结论
 * @param {string|string[]} cmd
 * @param {Object} [options={}]
 * @returns {{ safe: boolean, level: 'L0'|'L1'|'L2'|'L3', dangerous: boolean, reason: string, matchedPattern: string|null, traversalDetected: boolean }}
 */
export function validateExecutionSafety(cmd, options = {}) {
  const cmdStr = Array.isArray(cmd) ? cmd.join(' ').trim() : String(cmd || '').trim();
  if (!cmdStr) {
    return {
      safe: true,
      level: 'L0',
      dangerous: false,
      reason: 'Empty command',
      matchedPattern: null,
      traversalDetected: false,
    };
  }

  // 1. 自定义高危规则先行检测
  const customDangerous = options.customRules?.dangerousPatterns || [];
  for (const pat of customDangerous) {
    const rx = pat instanceof RegExp ? pat : new RegExp(pat, 'i');
    if (rx.test(cmdStr)) {
      return {
        safe: false,
        level: 'L3',
        dangerous: true,
        reason: `Matched custom dangerous rule: ${pat}`,
        matchedPattern: String(pat),
        traversalDetected: false,
      };
    }
  }

  // 2. 路径穿越检查
  const traversalCheck = checkPathTraversalEscape(cmdStr, options.root);
  if (traversalCheck.escaped) {
    return {
      safe: false,
      level: 'L3',
      dangerous: true,
      reason: traversalCheck.reason,
      matchedPattern: 'path-traversal-escape',
      traversalDetected: true,
    };
  }

  // 3. 内置 L3 严重危险规则（特权破坏/Shell注入/毁灭性删除）
  for (const rx of L3_DANGEROUS_PATTERNS) {
    if (rx.test(cmdStr)) {
      return {
        safe: false,
        level: 'L3',
        dangerous: true,
        reason: `Matched critical security pattern: ${rx.source}`,
        matchedPattern: rx.source,
        traversalDetected: false,
      };
    }
  }

  // 4. 自定义安全白名单规则
  const customSafe = options.customRules?.safePatterns || [];
  for (const pat of customSafe) {
    const rx = pat instanceof RegExp ? pat : new RegExp(pat, 'i');
    if (rx.test(cmdStr)) {
      return {
        safe: true,
        level: 'L1',
        dangerous: false,
        reason: `Matched custom safe rule: ${pat}`,
        matchedPattern: String(pat),
        traversalDetected: false,
      };
    }
  }

  // 5. 内置 L2 外部依赖与网络安装规则
  for (const rx of L2_DANGEROUS_PATTERNS) {
    if (rx.test(cmdStr)) {
      return {
        safe: options.allowL2 !== false,
        level: 'L2',
        dangerous: true,
        reason: `Matched external dependency or network pattern: ${rx.source}`,
        matchedPattern: rx.source,
        traversalDetected: false,
      };
    }
  }

  // 6. 内置 L0 纯只读规则
  for (const rx of L0_SAFE_PATTERNS) {
    if (rx.test(cmdStr)) {
      return {
        safe: true,
        level: 'L0',
        dangerous: false,
        reason: 'Read-only safe command',
        matchedPattern: rx.source,
        traversalDetected: false,
      };
    }
  }

  // 7. 内置 L1 测试与门禁规则
  for (const rx of L1_SAFE_PATTERNS) {
    if (rx.test(cmdStr)) {
      return {
        safe: true,
        level: 'L1',
        dangerous: false,
        reason: 'Standard test, lint, or audit gate command',
        matchedPattern: rx.source,
        traversalDetected: false,
      };
    }
  }

  // 默认兜底：常规本地指令
  return {
    safe: true,
    level: 'L1',
    dangerous: false,
    reason: 'Standard local command without dangerous markers',
    matchedPattern: null,
    traversalDetected: false,
  };
}

// ── 安全执行错误类 ──────────────────────────────────────────────────────

export class ExecutionSafetyError extends Error {
  constructor(message, safety) {
    super(message);
    this.name = 'ExecutionSafetyError';
    this.safety = safety;
    this.level = safety?.level || 'L3';
    this.reason = safety?.reason || message;
    this.matchedPattern = safety?.matchedPattern || null;
  }
}

// ── 跨平台进程树终结器 ──────────────────────────────────────────────────

export function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    // 进程可能已在被杀前自行退出，忽略错误
  }
}

// ── 带护栏的安全子进程执行原语 ──────────────────────────────────────────

/**
 * 具有环境脱敏、高危指令拦截、硬超时终结与输出敏感词掩码的子进程执行器
 * @param {string} file
 * @param {string[]} args
 * @param {Object} [options={}]
 * @returns {Promise<{ status: number, exitCode: number, stdout: string, stderr: string, timedOut: boolean, durMs: number, sanitized: boolean, safety: Object }>}
 */
export function safeExecFileWithGuardrails(file, args = [], options = {}) {
  const fullCmd = [file, ...args];
  const safety = validateExecutionSafety(fullCmd, options);

  if (options.enforceSafety !== false && !safety.safe) {
    return Promise.reject(new ExecutionSafetyError(`Command blocked by execution guardrails: ${safety.reason}`, safety));
  }

  const sanitizedEnv = options.rawEnv ? (options.env || process.env) : sanitizeExecEnv(options.env || process.env, options.envOptions);
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 30000;
  const maxBuffer = options.maxBuffer || 4 * 1024 * 1024;
  const cwd = options.cwd || process.cwd();

  return new Promise((resolve) => {
    const t0 = performance.now();
    let timedOut = false;
    let stdoutBuf = '';
    let stderrBuf = '';
    let timer = null;

    const child = spawn(file, args, {
      cwd,
      env: sanitizedEnv,
      windowsHide: options.windowsHide !== false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child.pid);
      }, timeoutMs);
    }

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (stdoutBuf.length < maxBuffer) {
          stdoutBuf += chunk;
        }
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        if (stderrBuf.length < maxBuffer) {
          stderrBuf += chunk;
        }
      });
    }

    const onExit = (code, signal) => {
      if (timer) clearTimeout(timer);
      const durMs = Math.round(performance.now() - t0);
      const finalCode = timedOut ? 124 : (code ?? (signal ? 1 : 0));

      const rawStdout = stdoutBuf;
      const rawStderr = stderrBuf;

      const stdout = options.redactOutput !== false ? redactSensitiveText(rawStdout) : rawStdout;
      const stderr = options.redactOutput !== false ? redactSensitiveText(rawStderr) : rawStderr;

      resolve({
        status: finalCode,
        exitCode: finalCode,
        stdout,
        stderr,
        timedOut,
        durMs,
        sanitized: !options.rawEnv,
        safety,
      });
    };

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      const durMs = Math.round(performance.now() - t0);
      resolve({
        status: 1,
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        timedOut: false,
        durMs,
        sanitized: !options.rawEnv,
        safety,
      });
    });

    child.on('close', onExit);
  });
}

/**
 * Shell 模式的护栏执行器
 * @param {string} commandString
 * @param {Object} [options={}]
 */
export function safeExec(commandString, options = {}) {
  const safety = validateExecutionSafety(commandString, options);

  if (options.enforceSafety !== false && !safety.safe) {
    return Promise.reject(new ExecutionSafetyError(`Command blocked by execution guardrails: ${safety.reason}`, safety));
  }

  const sanitizedEnv = options.rawEnv ? (options.env || process.env) : sanitizeExecEnv(options.env || process.env, options.envOptions);
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 30000;
  const maxBuffer = options.maxBuffer || 4 * 1024 * 1024;
  const cwd = options.cwd || process.cwd();

  return new Promise((resolve) => {
    const t0 = performance.now();
    let timedOut = false;
    let stdoutBuf = '';
    let stderrBuf = '';
    let timer = null;

    const child = spawn(commandString, {
      shell: true,
      cwd,
      env: sanitizedEnv,
      windowsHide: options.windowsHide !== false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child.pid);
      }, timeoutMs);
    }

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (stdoutBuf.length < maxBuffer) {
          stdoutBuf += chunk;
        }
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        if (stderrBuf.length < maxBuffer) {
          stderrBuf += chunk;
        }
      });
    }

    const onExit = (code, signal) => {
      if (timer) clearTimeout(timer);
      const durMs = Math.round(performance.now() - t0);
      const finalCode = timedOut ? 124 : (code ?? (signal ? 1 : 0));

      const rawStdout = stdoutBuf;
      const rawStderr = stderrBuf;

      const stdout = options.redactOutput !== false ? redactSensitiveText(rawStdout) : rawStdout;
      const stderr = options.redactOutput !== false ? redactSensitiveText(rawStderr) : rawStderr;

      resolve({
        status: finalCode,
        exitCode: finalCode,
        stdout,
        stderr,
        timedOut,
        durMs,
        sanitized: !options.rawEnv,
        safety,
      });
    };

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      const durMs = Math.round(performance.now() - t0);
      resolve({
        status: 1,
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        timedOut: false,
        durMs,
        sanitized: !options.rawEnv,
        safety,
      });
    });

    child.on('close', onExit);
  });
}
