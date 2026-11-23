import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STACK_IMAGES, STACK_CONTAINER_USER } from './devcontainer.mjs';
import { readManifest } from './manifest.mjs';

export const SANDBOX_CONFIG_REL = path.join('.agents', 'config', 'sandbox.json');

export const DEFAULT_STRIP_ENV_PATTERNS = [
  '*TOKEN*',
  '*SECRET*',
  '*KEY*',
  '*PASSWORD*',
  '*PASSWD*',
  '*CREDENTIAL*',
  '*AUTH*',
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
];

export const DEFAULT_PASS_ENV_PATTERNS = [
  'PATH',
  'TERM',
  'LANG',
  'LC_*',
  'NODE_ENV',
  'CI',
  'HOME',
  'USER',
  'SHELL',
  'PWD',
  'FLOW_KIT_*',
];

export const DEFAULT_SANDBOX_CONFIG = {
  $schema: 'https://github.com/zerosloney/agentic-flow-kit/schemas/sandbox.schema.json',
  version: 1,
  mode: 'auto',
  engine: 'auto',
  network: 'bridge',
  dropPrivileges: true,
  workdir: '/workspace',
  stripEnv: [...DEFAULT_STRIP_ENV_PATTERNS],
  passEnv: [...DEFAULT_PASS_ENV_PATTERNS],
  rules: {
    safePatterns: [],
    dangerousPatterns: [],
  },
  mounts: [],
};

// 指令高危与安全模式库
export const L3_DANGEROUS_PATTERNS = [
  // 管道直通远程执行
  /(?:curl|wget|fetch)\s+[^\n\r|]+\|\s*(?:bash|sh|zsh|dash|sudo)/i,
  /\b(?:eval|bash|sh|zsh)\s+-c\s+["'].*?(?:curl|wget|base64)/i,
  // 破坏性文件系统操作
  /\brm\s+-(?:rf|fr|r\s+-f|f\s+-r)\b/i,
  /\brmdir\s+\/s(?:\s+\/q)?\b/i,
  /\bdel\s+\/s(?:\s+\/q)?\b/i,
  /\b(?:mkfs|dd\s+if=|fdisk|format\s+[a-z]:)/i,
  // 提权与特权变更
  /\bsudo\s+/i,
  /\bsu\s+(?:-\s+)?(?:root)?/i,
  /\brunas\s+/i,
  /\bchmod\s+(?:-R\s+)?(?:777|a\+rwx|0777)\b/i,
  /\bchown\s+(?:-R\s+)?root\b/i,
  // 系统关键敏感路径访问
  /(?:\/etc\/(?:passwd|shadow|sudoers)|\/root\b|C:\\(?:Windows|System32))/i,
  /(?:~|\$HOME)\/(?:\.ssh|\.aws|\.kube|\.gnupg)/i,
];

// 仅在命令起始位置匹配工具名：字符串开头，或 ; && || | ( 换行 之后（允许前导空白）。
// 避免把提交说明等 prose 里的单词（如 "make it work"）误判为危险命令。
function commandStartPattern(body) {
  return new RegExp(`(?:^|[;&|(\\n]\\s*)${body}`, 'i');
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
  // 纯只读 git 探测
  /^git\s+(?:status|log|diff|branch|show|remote|rev-parse|describe)\b/i,
  // 纯只读文件系统查看
  /^(?:ls|dir|cat|head|tail|wc|grep|rg|find|pwd)\b/i,
  // 工具链版本信息打印
  /^(?:node|npm|python|python3|git|cargo|go|docker|podman|flow-kit)\s+(?:--version|-v|version)\b/i,
  // flow-kit 只读类命令
  /^flow-kit\s+(?:status|diff|explain|list-hosts|doctor|arch\s+graph|metrics\s+report)\b/i,
  // 基础 echo 打印（不带重定向）
  /^echo\s+[^><|&]+$/i,
];

export const L1_SAFE_PATTERNS = [
  // 测试运行器
  /\b(?:npm\s+test|node\s+--test|pytest|python\s+-m\s+(?:unittest|pytest)|cargo\s+test|cargo\s+check|cargo\s+clippy|go\s+test|mvn\s+test|gradle\s+test)\b/i,
  // 本地 Lint / 规范检查
  /\b(?:npm\s+run\s+(?:lint|check|test[a-z0-9_-]*)|eslint|prettier\s+--check)\b/i,
  // flow-kit 质量门禁与审计命令
  /^flow-kit\s+(?:arch\s+check|mcp\s+audit|metrics\s+check)\b/i,
];

export function detectContainerEngine(preferred = 'auto') {
  const candidates = preferred === 'docker' ? ['docker']
    : preferred === 'podman' ? ['podman']
    : ['docker', 'podman'];

  for (const bin of candidates) {
    try {
      const res = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
      if (!res.error && res.status === 0) {
        const rawVersion = (res.stdout || '').trim();
        return {
          available: true,
          engine: bin,
          version: rawVersion,
          binary: bin,
        };
      }
    } catch {
      // ignore
    }
  }

  return {
    available: false,
    engine: null,
    version: null,
    binary: null,
  };
}

export function loadSandboxConfig(target) {
  const file = path.join(target, SANDBOX_CONFIG_REL);
  if (!fs.existsSync(file)) {
    return { exists: false, config: { ...DEFAULT_SANDBOX_CONFIG } };
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      exists: true,
      config: {
        ...DEFAULT_SANDBOX_CONFIG,
        ...parsed,
        rules: {
          ...DEFAULT_SANDBOX_CONFIG.rules,
          ...(parsed.rules || {}),
        },
      },
    };
  } catch (err) {
    return {
      exists: true,
      error: err.message,
      config: { ...DEFAULT_SANDBOX_CONFIG },
    };
  }
}

export function initSandboxConfig(target, options = {}) {
  const file = path.join(target, SANDBOX_CONFIG_REL);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const manifest = readManifest(target);
  const stack = options.stack || manifest?.stack || 'node';
  const defaultImage = STACK_IMAGES[stack] || STACK_IMAGES.empty;
  const defaultUser = STACK_CONTAINER_USER[stack] || 'vscode';

  const config = {
    $schema: 'https://github.com/zerosloney/agentic-flow-kit/schemas/sandbox.schema.json',
    version: 1,
    mode: options.mode || 'auto',
    engine: options.engine || 'auto',
    image: options.image || defaultImage,
    network: options.network || 'bridge',
    dropPrivileges: options.dropPrivileges !== false,
    containerUser: options.user || defaultUser,
    workdir: options.workdir || '/workspace',
    stripEnv: [...DEFAULT_STRIP_ENV_PATTERNS],
    passEnv: [...DEFAULT_PASS_ENV_PATTERNS],
    rules: {
      safePatterns: [],
      dangerousPatterns: [],
    },
    mounts: [],
  };

  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { file, config };
}

export function classifyCommandRisk(cmd, customRules = {}) {
  const cmdStr = Array.isArray(cmd) ? cmd.join(' ').trim() : String(cmd || '').trim();
  if (!cmdStr) {
    return {
      level: 'L0',
      dangerous: false,
      reason: 'Empty command',
      matchedPattern: null,
    };
  }

  // 1. 自定义高危规则先行检测
  const customDangerous = customRules.dangerousPatterns || [];
  for (const pat of customDangerous) {
    const rx = pat instanceof RegExp ? pat : new RegExp(pat, 'i');
    if (rx.test(cmdStr)) {
      return {
        level: 'L3',
        dangerous: true,
        reason: `Matched custom dangerous rule: ${pat}`,
        matchedPattern: String(pat),
      };
    }
  }

  // 2. 内置 L3 严重危险规则（特权破坏/Shell注入）
  for (const rx of L3_DANGEROUS_PATTERNS) {
    if (rx.test(cmdStr)) {
      return {
        level: 'L3',
        dangerous: true,
        reason: `Matched critical security pattern: ${rx.source}`,
        matchedPattern: rx.source,
      };
    }
  }

  // 3. 自定义安全白名单规则
  const customSafe = customRules.safePatterns || [];
  for (const pat of customSafe) {
    const rx = pat instanceof RegExp ? pat : new RegExp(pat, 'i');
    if (rx.test(cmdStr)) {
      return {
        level: 'L1',
        dangerous: false,
        reason: `Matched custom safe rule: ${pat}`,
        matchedPattern: String(pat),
      };
    }
  }

  // 4. 内置 L2 外部依赖与网络安装规则
  for (const rx of L2_DANGEROUS_PATTERNS) {
    if (rx.test(cmdStr)) {
      return {
        level: 'L2',
        dangerous: true,
        reason: `Matched external dependency or network pattern: ${rx.source}`,
        matchedPattern: rx.source,
      };
    }
  }

  // 5. 内置 L0 纯只读规则
  for (const rx of L0_SAFE_PATTERNS) {
    if (rx.test(cmdStr)) {
      return {
        level: 'L0',
        dangerous: false,
        reason: 'Read-only safe command',
        matchedPattern: rx.source,
      };
    }
  }

  // 6. 内置 L1 测试与门禁规则
  for (const rx of L1_SAFE_PATTERNS) {
    if (rx.test(cmdStr)) {
      return {
        level: 'L1',
        dangerous: false,
        reason: 'Standard test, lint, or audit gate command',
        matchedPattern: rx.source,
      };
    }
  }

  // 默认兜底：常规本地指令（auto 下放行宿主，strict 下需进沙箱）
  return {
    level: 'L1',
    dangerous: false,
    reason: 'Standard local command without dangerous markers',
    matchedPattern: null,
  };
}

function matchPattern(key, pat) {
  if (pat.includes('*')) {
    const escaped = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(key);
  }
  return key.toLowerCase() === pat.toLowerCase();
}

export function sanitizeHostEnv(env = process.env, config = {}) {
  const stripPatterns = config.stripEnv || DEFAULT_SANDBOX_CONFIG.stripEnv;
  const passPatterns = config.passEnv || DEFAULT_SANDBOX_CONFIG.passEnv;
  const sanitized = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;

    // 命中脱敏过滤规则
    const isStripped = stripPatterns.some((p) => matchPattern(key, p));
    if (isStripped) {
      continue;
    }

    // 命中放行白名单
    const isPassed = passPatterns.some((p) => matchPattern(key, p));
    if (isPassed) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function buildContainerRunArgs({
  target,
  command,
  config = {},
  stack = 'node',
  imageOverride = null,
  networkOverride = null,
  userOverride = null,
  env = process.env,
}) {
  const cfg = { ...DEFAULT_SANDBOX_CONFIG, ...config };
  const image = imageOverride || cfg.image || STACK_IMAGES[stack] || STACK_IMAGES.empty;
  const user = userOverride || cfg.containerUser || (cfg.dropPrivileges ? (STACK_CONTAINER_USER[stack] || 'vscode') : null);
  const network = networkOverride || cfg.network || 'bridge';
  const workdir = cfg.workdir || '/workspace';

  const absTarget = path.resolve(target);
  const mountTarget = absTarget.replace(/\\/g, '/');

  const args = [
    'run',
    '--rm',
    '-i',
    '-v',
    `${mountTarget}:${workdir}`,
    '-w',
    workdir,
    '--network',
    network,
  ];

  if (user) {
    args.push('--user', user);
  }

  const sanitizedEnv = sanitizeHostEnv(env, cfg);
  for (const [k, v] of Object.entries(sanitizedEnv)) {
    args.push('-e', `${k}=${v}`);
  }

  if (Array.isArray(cfg.mounts)) {
    for (const m of cfg.mounts) {
      if (m?.source && m?.target) {
        const src = path.resolve(target, m.source).replace(/\\/g, '/');
        const ro = m.readonly ? ':ro' : '';
        args.push('-v', `${src}:${m.target}${ro}`);
      }
    }
  }

  args.push(image);

  if (Array.isArray(command)) {
    args.push(...command);
  } else if (typeof command === 'string' && command.trim()) {
    args.push('sh', '-c', command.trim());
  }

  return args;
}

export function routeCommand({
  target,
  command,
  strict = false,
  configOverride = null,
  preferredEngine = 'auto',
}) {
  const { config } = configOverride ? { config: configOverride } : loadSandboxConfig(target);
  const engineInfo = detectContainerEngine(config.engine || preferredEngine);
  const classification = classifyCommandRisk(command, config.rules || {});

  const mode = config.mode || 'auto';
  let route = 'host';
  let canExecute = true;
  let reason = classification.reason;

  if (mode === 'disabled') {
    route = 'host';
    canExecute = true;
  } else if (mode === 'always') {
    route = 'sandbox';
    if (!engineInfo.available) {
      canExecute = false;
      reason = 'Sandbox engine (docker/podman) is required in always mode but not available';
    }
  } else if (mode === 'strict' || strict) {
    if (classification.level === 'L0') {
      route = 'host';
      canExecute = true;
    } else {
      route = 'sandbox';
      if (!engineInfo.available) {
        canExecute = false;
        reason = `Strict mode: command risk ${classification.level} requires sandbox isolation, but no container engine is available`;
      }
    }
  } else {
    // auto 模式
    if (classification.dangerous) {
      route = 'sandbox';
      if (!engineInfo.available) {
        canExecute = false;
        reason = `Dangerous command (risk ${classification.level}) requires sandbox isolation, but no container engine is available`;
      }
    } else {
      route = 'host';
    }
  }

  return {
    route,
    level: classification.level,
    dangerous: classification.dangerous,
    reason,
    canExecute,
    engine: engineInfo,
  };
}

export function executeSandbox({
  target,
  command,
  options = {},
}) {
  const { config } = loadSandboxConfig(target);
  const manifest = readManifest(target);
  const stack = options.stack || manifest?.stack || 'node';
  const engineInfo = detectContainerEngine(config.engine || options.engine || 'auto');

  if (!engineInfo.available && !options.dryRun) {
    const err = new Error('No container engine (docker or podman) available in PATH');
    err.code = 'NO_ENGINE';
    throw err;
  }

  const binary = engineInfo.binary || 'docker';
  const network = options.offline ? 'none' : (options.network || config.network);

  const args = buildContainerRunArgs({
    target,
    command,
    config,
    stack,
    imageOverride: options.image,
    networkOverride: network,
    userOverride: options.user,
    env: options.env || process.env,
  });

  const fullCommand = `${binary} ${args.map((a) => (a.includes(' ') || a.includes('\t') ? `"${a}"` : a)).join(' ')}`;

  if (options.dryRun) {
    return {
      dryRun: true,
      engine: binary,
      args,
      fullCommand,
      status: 0,
    };
  }

  const res = spawnSync(binary, args, {
    cwd: target,
    stdio: options.stdio || (options.json ? 'pipe' : 'inherit'),
    encoding: 'utf8',
    windowsHide: true,
  });

  return {
    dryRun: false,
    engine: binary,
    args,
    status: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    fullCommand,
  };
}

export function checkSandboxHealth(target, t) {
  const configFile = path.join(target, SANDBOX_CONFIG_REL);
  if (!fs.existsSync(configFile)) return null;

  try {
    const raw = fs.readFileSync(configFile, 'utf8');
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== 'object') {
      return {
        ok: false,
        name: 'sandbox isolation',
        detail: t('doctor.sandboxConfigInvalid'),
      };
    }

    const engine = detectContainerEngine(cfg.engine || 'auto');
    const mode = cfg.mode || 'auto';
    const network = cfg.network || 'bridge';

    if (mode === 'strict' || mode === 'always') {
      if (!engine.available) {
        return {
          ok: false,
          name: 'sandbox isolation',
          detail: t('doctor.sandboxEngineMissing', { mode }),
          fix: t('doctor.sandboxEngineFix'),
        };
      }
      return {
        ok: true,
        name: 'sandbox isolation',
        detail: t('doctor.sandboxOk', {
          engine: `${engine.engine} (${engine.version || 'detected'})`,
          mode,
          network,
        }),
      };
    }

    if (mode === 'auto') {
      if (!engine.available) {
        return {
          ok: true,
          name: 'sandbox isolation',
          detail: t('doctor.sandboxDegraded', { mode: 'auto' }),
          warn: true,
          fix: t('doctor.sandboxEngineFix'),
        };
      }
      return {
        ok: true,
        name: 'sandbox isolation',
        detail: t('doctor.sandboxOk', {
          engine: `${engine.engine} (${engine.version || 'detected'})`,
          mode,
          network,
        }),
      };
    }

    // mode === 'disabled'
    return {
      ok: true,
      name: 'sandbox isolation',
      detail: `mode: disabled`,
    };
  } catch {
    return {
      ok: false,
      name: 'sandbox isolation',
      detail: t('doctor.sandboxConfigInvalid'),
    };
  }
}
