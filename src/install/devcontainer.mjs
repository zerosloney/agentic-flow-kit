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
// 口径（每条都核对过 MCR registry 的 manifest / config blob，2026-11-14）：
//   - tag 必须是**真实存在**的 tag。上游没有 `dotnet:8` 这种短 tag，只有 `8.0` / `8.0-bookworm`
//     等 —— 少一位就 404，整个容器构建直接崩。
//   - 镜像里的非 root 用户随栈而变：javascript-node 系建的是 `node`（UID 1000），
//     其余经 common-utils 建的是 `vscode`。写死 `USER vscode` 会让 node 系镜像构建时报
//     「unable to find user vscode: no matching entries in passwd file」。
//   - 镜像里**是否预装 node**也随栈而变（见 STACK_PROVISIONS_NODE）。
export const STACK_IMAGES = {
  dotnet: 'mcr.microsoft.com/devcontainers/dotnet:8.0',
  node: 'mcr.microsoft.com/devcontainers/typescript-node:22',
  typescript: 'mcr.microsoft.com/devcontainers/typescript-node:22',
  rust: 'mcr.microsoft.com/devcontainers/rust:1',
  go: 'mcr.microsoft.com/devcontainers/go:1.23',
  java: 'mcr.microsoft.com/devcontainers/java:21',
  empty: 'mcr.microsoft.com/devcontainers/base:ubuntu-24.04',
};

// 容器内跑 flow-kit 的身份：与镜像自带的非 root 用户对齐，不新造用户。
export const STACK_CONTAINER_USER = {
  dotnet: 'vscode',
  node: 'node',
  typescript: 'node',
  rust: 'vscode',
  go: 'vscode',
  java: 'vscode',
  empty: 'vscode',
};

// rust / base 镜像只烘焙了 rust、common-utils、git，**没有 node**（node 的 tar 包也不在
// 镜像里），而 flow-kit 是 Node ≥ 22 的 CLI。这两个栈必须显式装 node，否则 npm 无从谈起。
// 版本与官方镜像 typescript-node:22 烘焙的 NODE_VERSION 对齐（同源事实，不是拍脑袋）。
export const NODE_VERSION = '22.23.5';

export const STACK_PROVISIONS_NODE = {
  dotnet: false,
  node: false,
  typescript: false,
  rust: true,
  go: false,
  java: false,
  empty: true,
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

// 容器内身份：未知栈回落到 empty 的用户（镜像自带的那个）。
export function containerUser(stack) {
  return STACK_CONTAINER_USER[stack] || STACK_CONTAINER_USER.empty;
}

// node 是否不在镜像里（缺了就得在 Dockerfile 里补装）。
export function stackNeedsNode(stack) {
  return Boolean(STACK_PROVISIONS_NODE[stack]);
}

// 官方 node tar 包的 sha256（nodejs.org/dist/v<version>/SHASUMS256.txt）——钉死而不是
// 「latest」，避免镜像内容随时间漂移。
const NODE_TARBALL_SHA256 = {
  x64: 'c54118104acc524633b5abe106bbf44a53126ec8b4e5fa105cb92b5d7de8a1a1',
  arm64: '8bd3dc69eee8f3f226315a80d7d1d4faccf217a4c8fae500168ac2e38f3bdba3',
};

function nodeTarball(platform) {
  const arch = platform === 'arm64' ? 'arm64' : 'x64';
  return {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.gz`,
    sha256: NODE_TARBALL_SHA256[arch],
  };
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
    remoteUser: containerUser(stack),
    postCreateCommand: 'flow-kit run check-local-gates --fix',
    containerEnv: { FLOW_KIT_PROJECT_ROOT: '${containerWorkspaceFolder}' },
    forwardPorts: portList(apiPort, webPort),
    customizations: { vscode: { extensions: STACK_EXTENSIONS[stack] || [] } },
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// 生成 Dockerfile。产物分两种形态：
//   - 镜像自带 node（node / typescript / dotnet / go / java）：直接以镜像的非 root 用户
//     `npm install -g`。这些镜像的 PATH 已含 node 与 npm 全局目录。
//   - 镜像没有 node（rust / empty）：先以 root 装 node（钉死版本 + 校验 sha256），再切到
//     镜像自带的非 root 用户装 flow-kit。
// 两处都以「镜像自带用户」为准，不新造用户：新造用户需要 UID/GID/家目录全对齐，
// 而上游镜像已经建好了对应身份。
export function renderDevcontainerDockerfile({ stack, kitVersion }) {
  const image = devcontainerImage(stack);
  const user = containerUser(stack);
  const version = kitVersion || 'latest';
  const lines = [
    '# 由 agentic-flow-kit 生成（R3-8 开发容器）——请勿手改；改栈请用 CLI 参数后重跑 flow-kit upgrade。',
    `# 镜像来源受 ${DEVCONTAINER_POLICY_REL} 白名单约束（供应链门：flow-kit run check-devcontainer.mjs）。`,
    `FROM ${image}`,
    '',
    `ARG FLOW_KIT_VERSION=${version}`,
  ];

  if (stackNeedsNode(stack)) {
    const x64 = nodeTarball('x64');
    const arm64 = nodeTarball('arm64');
    lines.push(
      '',
      `# 该栈的官方镜像不烘焙 node，而 flow-kit 是 Node >= 22 的 CLI：先钉版本补装 node。`,
      `ARG NODE_VERSION=${NODE_VERSION}`,
      'RUN set -eu; \\',
      '  arch="$(dpkg --print-architecture)"; \\',
      `  case "$arch" in amd64) url="${x64.url}"; sum="${x64.sha256}" ;; \\`,
      `    arm64) url="${arm64.url}"; sum="${arm64.sha256}" ;; \\`,
      '    *) echo "不支持的架构：$arch" >&2; exit 1 ;; \\',
      '  esac; \\',
      '  tmp="$(mktemp)"; \\',
      '  apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils; \\',
      '  curl -fsSL -o "$tmp" "$url"; \\',
      '  echo "$sum  $tmp" | sha256sum -c -; \\',
      `  mkdir -p /usr/local/lib/nodejs/node-v${NODE_VERSION}; \\`,
      `  tar -xzf "$tmp" -C /usr/local/lib/nodejs/node-v${NODE_VERSION} --strip-components=1; \\`,
      '  rm -f "$tmp"; \\',
      `  ln -sf /usr/local/lib/nodejs/node-v${NODE_VERSION}/bin/node /usr/local/bin/node; \\`,
      `  ln -sf /usr/local/lib/nodejs/node-v${NODE_VERSION}/bin/npm /usr/local/bin/npm; \\`,
      `  ln -sf /usr/local/lib/nodejs/node-v${NODE_VERSION}/bin/npx /usr/local/bin/npx; \\`,
      '  hash -r; \\',
      `  su "${user}" -c "umask 0002 && node --version && npm --version"`,
    );
  }

  lines.push(
    '',
    `USER ${user}`,
    'RUN sudo npm install -g "agentic-flow-kit@${FLOW_KIT_VERSION}" \\',
    ' && flow-kit --version',
    '',
  );
  return lines.join('\n');
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
    // 容器身份是构建前提：镜像里没有的用户，`docker build` 会直接失败。
    const userLine = /^\s*USER\s+(\S+)/m.exec(state.dockerfile);
    if (stack) {
      if (!userLine) problems.push(`${DEVCONTAINER_DOCKERFILE_REL} 缺少 USER 指令（容器以 root 运行不安全）`);
      else if (userLine[1] !== containerUser(stack)) {
        problems.push(`USER 与镜像不符：${userLine[1]} ≠ ${containerUser(stack)}（stack=${stack}）`);
      }
    }
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
    // 身份与 node 供给是「镜像自带」的事实，不是项目自选：写错容器根本起不来。
    // 只在文档解析成功时核对，否则这里会把解析失败重复报成身份漂移。
    if (doc && stack) {
      if (doc.remoteUser && doc.remoteUser !== containerUser(stack)) {
        problems.push(`remoteUser 与镜像不符：${doc.remoteUser} ≠ ${containerUser(stack)}（stack=${stack}）`);
      }
      const hasNodeProvision = /ARG\s+NODE_VERSION=/m.test(state.dockerfile);
      if (stackNeedsNode(stack) && !hasNodeProvision) {
        problems.push(`镜像 ${image} 未烘焙 node，但 Dockerfile 未补装（缺 ARG NODE_VERSION）`);
      }
      if (!stackNeedsNode(stack) && hasNodeProvision) {
        problems.push(`镜像 ${image} 已烘焙 node，Dockerfile 不应再补装（多余 ARG NODE_VERSION）`);
      }
    }
    kitVersion = parseDockerfileKitVersion(state.dockerfile);
    if (policy.requirePinnedFlowKit && !isConcreteVersion(kitVersion)) {
      problems.push(`${DEVCONTAINER_DOCKERFILE_REL} 未钉定 flow-kit 版本`);
    }
  }

  return { ok: problems.length === 0, problems, missing: false, image, kitVersion, policy };
}
