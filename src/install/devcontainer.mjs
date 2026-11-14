// 开发容器（R3-8 沙箱面）：devcontainer.json + Dockerfile 的生成与校验。
// 动机：R3-8「沙箱与供应链」——AI 干活要有可审计的隔离环境：镜像来源受白名单约束（供应链）、
//   工具链随栈钉版本、flow-kit 随镜像安装（宿主接线在容器内照常可用）。
// 单源约定：
//   - 本文件是「栈 → 官方基础镜像 / 扩展」映射与渲染规则的单源；
//   - 白名单（允许的镜像前缀、禁用的浮动 tag、flow-kit 必须钉版本）落在项目内的
//     .agents/config/devcontainer-policy.json（schema schemas/devcontainer-policy.schema.json），
//     运行时门（check-devcontainer.mjs）与 doctor 共读这一份，避免两处策略各说各话。
import fs from 'node:fs';
import path from 'node:path';

export const DEVCONTAINER_DIR = '.devcontainer';
export const DEVCONTAINER_JSON_REL = '.devcontainer/devcontainer.json';
export const DEVCONTAINER_DOCKERFILE_REL = '.devcontainer/Dockerfile';
export const DEVCONTAINER_POLICY_REL = '.agents/config/devcontainer-policy.json';

// 官方 devcontainer 镜像：已内置对应工具链，免去容器内二次安装。
export const STACK_IMAGES = {
  dotnet: 'mcr.microsoft.com/devcontainers/dotnet:8',
  node: 'mcr.microsoft.com/devcontainers/typescript-node:22',
  typescript: 'mcr.microsoft.com/devcontainers/typescript-node:22',
  rust: 'mcr.microsoft.com/devcontainers/rust:1',
  go: 'mcr.microsoft.com/devcontainers/go:1.23',
  java: 'mcr.microsoft.com/devcontainers/java:21',
  empty: 'mcr.microsoft.com/devcontainers/base:ubuntu-24.04',
};

export const STACK_EXTENSIONS = {
  dotnet: ['ms-dotnettools.csharp'],
  node: ['dbaeumer.vscode-eslint'],
  typescript: ['dbaeumer.vscode-eslint'],
  rust: ['rust-lang.rust-analyzer'],
  go: ['golang.go'],
  java: ['redhat.java'],
  empty: [],
};

export const DEFAULT_POLICY = {
  version: 1,
  allowedImagePrefixes: ['mcr.microsoft.com/devcontainers/'],
  forbiddenTags: ['latest'],
  requirePinnedFlowKit: true,
};

export function devcontainerImage(stack) {
  return STACK_IMAGES[stack] || STACK_IMAGES.empty;
}

function portList(apiPort, webPort) {
  const ports = [];
  for (const raw of [apiPort, webPort]) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && !ports.includes(n)) ports.push(n);
  }
  return ports;
}

export function renderDevcontainerJson({ projectName, stack, apiPort, webPort }) {
  const doc = {
    name: projectName || 'flow-kit-project',
    build: { dockerfile: 'Dockerfile', context: '..' },
    remoteUser: 'vscode',
    postCreateCommand: 'flow-kit run check-local-gates --fix',
    containerEnv: { FLOW_KIT_PROJECT_ROOT: '${containerWorkspaceFolder}' },
    forwardPorts: portList(apiPort, webPort),
    customizations: { vscode: { extensions: STACK_EXTENSIONS[stack] || [] } },
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function renderDevcontainerDockerfile({ stack, kitVersion }) {
  const image = devcontainerImage(stack);
  const version = kitVersion || 'latest';
  return [
    '# 由 agentic-flow-kit 生成（R3-8 开发容器）——请勿手改；改栈请用 CLI 参数后重跑 flow-kit upgrade。',
    `# 镜像来源受 ${DEVCONTAINER_POLICY_REL} 白名单约束（供应链门：flow-kit run check-devcontainer.mjs）。`,
    `FROM ${image}`,
    '',
    `ARG FLOW_KIT_VERSION=${version}`,
    'USER vscode',
    'RUN sudo npm install -g "agentic-flow-kit@${FLOW_KIT_VERSION}" \\',
    ' && flow-kit --version',
    '',
  ].join('\n');
}

// 解析项目内的容器策略；缺失或损坏时回落到默认白名单（策略文件是可选面，不因它缺失而失守）。
export function readDevcontainerPolicy(target) {
  const abs = path.join(target, DEVCONTAINER_POLICY_REL);
  let raw = null;
  try {
    if (fs.existsSync(abs)) raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_POLICY };
  return {
    version: Number(raw.version) || DEFAULT_POLICY.version,
    allowedImagePrefixes: Array.isArray(raw.allowedImagePrefixes)
      ? raw.allowedImagePrefixes.map(String)
      : DEFAULT_POLICY.allowedImagePrefixes,
    forbiddenTags: Array.isArray(raw.forbiddenTags)
      ? raw.forbiddenTags.map(String)
      : DEFAULT_POLICY.forbiddenTags,
    requirePinnedFlowKit: raw.requirePinnedFlowKit !== false,
  };
}

export function parseDockerfileImage(text) {
  const m = /^FROM\s+(\S+)/im.exec(String(text || ''));
  return m ? m[1] : null;
}

// 钉定版本优先读 Dockerfile 的 ARG 默认值（生成器就是这么写的：ARG FLOW_KIT_VERSION=2.1.0），
// 没有 ARG 时退回安装目标上的字面版本。返回 null = 没钉版本；返回 latest/* 之类 = 钉了但不具体。
export function parseDockerfileKitVersion(text) {
  const s = String(text || '');
  const arg = /^\s*ARG\s+FLOW_KIT_VERSION=(\S+)/im.exec(s);
  if (arg) return arg[1].trim();
  const m = /agentic-flow-kit@([^\s"'\\]+)/.exec(s);
  return m ? m[1] : null;
}

export function isConcreteVersion(version) {
  return /^\d+\.\d+\.\d+/.test(String(version || ''));
}

export function imageTag(image) {
  const s = String(image || '');
  const slash = s.lastIndexOf('/');
  const colon = s.lastIndexOf(':');
  if (colon <= slash || colon < 0) return null;
  return s.slice(colon + 1);
}

export function readDevcontainerState(target) {
  const jsonAbs = path.join(target, DEVCONTAINER_JSON_REL);
  const dockerAbs = path.join(target, DEVCONTAINER_DOCKERFILE_REL);
  const state = {
    jsonRel: DEVCONTAINER_JSON_REL,
    dockerfileRel: DEVCONTAINER_DOCKERFILE_REL,
    exists: fs.existsSync(jsonAbs),
    json: null,
    dockerfile: null,
    errors: [],
  };
  if (state.exists) {
    try {
      state.json = JSON.parse(fs.readFileSync(jsonAbs, 'utf8'));
    } catch (err) {
      state.errors.push(`${DEVCONTAINER_JSON_REL}: ${err.message}`);
    }
  }
  if (fs.existsSync(dockerAbs)) {
    try {
      state.dockerfile = fs.readFileSync(dockerAbs, 'utf8');
    } catch (err) {
      state.errors.push(`${DEVCONTAINER_DOCKERFILE_REL}: ${err.message}`);
    }
  }
  return state;
}

// 校验项目里的开发容器声明。返回 { ok, problems, image, kitVersion, ... }。
// stack 已知时额外核对「镜像与栈匹配」——换栈不改容器是最常见的静默漂移。
export function checkDevcontainer({ target, stack = null }) {
  const problems = [];
  const state = readDevcontainerState(target);
  const policy = readDevcontainerPolicy(target);
  if (!state.exists) {
    problems.push(`${DEVCONTAINER_JSON_REL} 缺失`);
    return { ok: false, problems, missing: true, image: null, kitVersion: null, policy };
  }
  problems.push(...state.errors);
  const doc = state.json && typeof state.json === 'object' ? state.json : null;
  if (!doc) {
    problems.push(`${DEVCONTAINER_JSON_REL} 不是合法 JSON 对象`);
  } else {
    if (!doc.name || typeof doc.name !== 'string') problems.push('devcontainer.json 缺少 name');
    if (!doc.build || typeof doc.build !== 'object' || !doc.build.dockerfile) {
      problems.push('devcontainer.json 缺少 build.dockerfile');
    }
    if (doc.forwardPorts != null) {
      const ports = Array.isArray(doc.forwardPorts) ? doc.forwardPorts : [];
      if (!ports.every((p) => Number.isInteger(p) && p > 0)) problems.push('devcontainer.json 的 forwardPorts 非法');
    }
  }

  let image = null;
  let kitVersion = null;
  if (!state.dockerfile) {
    problems.push(`${DEVCONTAINER_DOCKERFILE_REL} 缺失`);
  } else {
    image = parseDockerfileImage(state.dockerfile);
    if (!image) {
      problems.push(`${DEVCONTAINER_DOCKERFILE_REL} 缺少 FROM 指令`);
    } else {
      const allowed = policy.allowedImagePrefixes.some((prefix) => image.startsWith(prefix));
      if (!allowed) problems.push(`镜像不在白名单内：${image}`);
      const tag = imageTag(image);
      if (!tag) problems.push(`镜像未钉版本：${image}`);
      else if (policy.forbiddenTags.includes(tag)) problems.push(`镜像使用了浮动 tag「${tag}」：${image}`);
      if (stack && image !== devcontainerImage(stack)) {
        problems.push(`镜像与栈不符：${image} ≠ ${devcontainerImage(stack)}（stack=${stack}）`);
      }
    }
    kitVersion = parseDockerfileKitVersion(state.dockerfile);
    if (policy.requirePinnedFlowKit && !isConcreteVersion(kitVersion)) {
      problems.push(`${DEVCONTAINER_DOCKERFILE_REL} 未钉定 flow-kit 版本`);
    }
  }

  return { ok: problems.length === 0, problems, missing: false, image, kitVersion, policy };
}
