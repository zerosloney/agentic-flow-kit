// stack-registry：可选技术栈的单一来源（顺序 = TUI 菜单 = schema enum）。
// 探测标记 / 渲染默认（端口·描述）/ 宿主权限命令 / devcontainer 映射只从这里派生；
// 新增栈 = 改本文件 + 加 templates/profiles/<stack>，其余消费者自动跟随。
// 注：schema 枚举（schemas/install-manifest.schema.json、schemas/project-profile.schema.json）
// 不在 runtime 消费，由 tests/stack-registry.test.mjs 守护一致性。

export const STACK_ORDER = ['dotnet', 'node', 'typescript', 'rust', 'go', 'java', 'python', 'cpp', 'empty'];

export const STACK_REGISTRY = {
  dotnet: {
    description: 'ASP.NET Core 后端服务。',
    descriptionEn: 'ASP.NET Core backend service.',
    ports: { api: 8932, web: 5203 },
    shell: ['dotnet build', 'dotnet run'],
    marker: { label: '.sln / .csproj', anyExt: ['.sln', '.csproj'] },
    devcontainer: {
      image: 'mcr.microsoft.com/devcontainers/dotnet:8.0',
      user: 'vscode',
      provisionsNode: true,
      extensions: ['ms-dotnettools.csharp'],
    },
  },
  node: {
    description: 'Node.js 项目。',
    descriptionEn: 'A Node.js project.',
    ports: { api: 3000, web: 5173 },
    shell: [],
    marker: { label: 'package.json', files: ['package.json'] },
    devcontainer: {
      image: 'mcr.microsoft.com/devcontainers/typescript-node:22',
      user: 'node',
      provisionsNode: false,
      extensions: ['dbaeumer.vscode-eslint'],
    },
  },
  typescript: {
    description: 'TypeScript 项目。',
    descriptionEn: 'A TypeScript project.',
    ports: { api: 3000, web: 5173 },
    shell: [],
    marker: { label: 'tsconfig.json', files: ['tsconfig.json'] },
    devcontainer: {
      image: 'mcr.microsoft.com/devcontainers/typescript-node:22',
      user: 'node',
      provisionsNode: false,
      extensions: ['dbaeumer.vscode-eslint'],
    },
  },
  rust: {
    description: 'Rust 项目（Cargo）。',
    descriptionEn: 'A Rust project (Cargo).',
    ports: { api: 8080, web: 5173 },
    shell: ['cargo build', 'cargo run', 'cargo test', 'cargo check'],
    marker: { label: 'Cargo.toml', files: ['Cargo.toml'] },
    devcontainer: {
      image: 'mcr.microsoft.com/devcontainers/rust:1',
      user: 'vscode',
      provisionsNode: true,
      extensions: ['rust-lang.rust-analyzer'],
    },
  },
  go: {
    description: 'Go 项目（Go modules）。',
    descriptionEn: 'A Go project (Go modules).',
    ports: { api: 8080, web: 5173 },
    shell: ['go build', 'go run', 'go test'],
    marker: { label: 'go.mod', files: ['go.mod'] },
    devcontainer: {
      image: 'mcr.microsoft.com/devcontainers/go:1.23',
      user: 'vscode',
      provisionsNode: true,
      extensions: ['golang.go'],
    },
  },
  java: {
    description: 'Java 项目（Maven 或 Gradle）。',
    descriptionEn: 'A Java project (Maven or Gradle).',
    ports: { api: 8080, web: 5173 },
    shell: ['mvn compile', 'mvn test', 'mvn -q test', 'gradle test', 'gradlew test', 'gradlew.bat test', './gradlew test'],
    marker: { label: 'pom.xml / build.gradle', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
    devcontainer: {
      image: 'mcr.microsoft.com/devcontainers/java:21',
      user: 'vscode',
      provisionsNode: true,
      extensions: ['redhat.java'],
    },
  },
  python: {
    description: 'Python 项目（pyproject.toml 或 requirements.txt）。',
    descriptionEn: 'A Python project (pyproject.toml or requirements.txt).',
    ports: { api: 8000, web: 5173 },
    shell: ['python -m pytest', 'pytest', 'python main.py', 'python -m', 'uv run', 'poetry run'],
    marker: { label: 'pyproject.toml / requirements.txt', files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'] },
    devcontainer: {
      image: 'mcr.microsoft.com/devcontainers/python:3.12',
      user: 'vscode',
      provisionsNode: true,
      extensions: ['ms-python.python'],
    },
  },
  cpp: {
    description: 'C / C++ 项目（CMake 或 Makefile）。',
    descriptionEn: 'A C / C++ project (CMake or Makefile).',
    ports: { api: 8080, web: 5173 },
    shell: ['cmake --build', 'cmake -B', 'ctest', 'make', 'make test', 'ninja', 'clang-tidy', 'clang-format'],
    marker: { label: 'CMakeLists.txt / Makefile', files: ['CMakeLists.txt', 'Makefile', 'configure.ac', 'meson.build'] },
    devcontainer: {
      // cpp:1 是 MCR 上真实存在的 tag（2026-11-23 核对 v2 tags/list；风格对齐 rust:1 的浮动 major tag）。
      image: 'mcr.microsoft.com/devcontainers/cpp:1',
      user: 'vscode',
      provisionsNode: true,
      extensions: ['ms-vscode.cpptools'],
    },
  },
  empty: {
    description: '项目技术栈按实际填写。',
    descriptionEn: 'Fill in the project stack description.',
    ports: { api: 3000, web: 5173 },
    shell: [],
    marker: null,
    devcontainer: {
      image: 'mcr.microsoft.com/devcontainers/base:ubuntu-24.04',
      user: 'vscode',
      provisionsNode: true,
      extensions: [],
    },
  },
};

export function stackNames() {
  return [...STACK_ORDER];
}

/** 渲染默认值（tokens.mjs 的 STACK_DEFAULTS 形状）。 */
export function stackDefaults() {
  const out = {};
  for (const [stack, def] of Object.entries(STACK_REGISTRY)) {
    out[stack] = {
      description: def.description,
      descriptionEn: def.descriptionEn,
      apiPort: def.ports.api,
      webPort: def.ports.web,
    };
  }
  return out;
}

/** 宿主权限白名单里随栈变化的命令（空数组 = 不产生权限片段）。 */
export function stackShell() {
  const out = {};
  for (const [stack, def] of Object.entries(STACK_REGISTRY)) {
    if (def.shell.length) out[stack] = [...def.shell];
  }
  return out;
}

/** 根目录探测标记（优先级顺序独立于菜单顺序：package.json 在最后，避免吞掉其他标记）。 */
const MARKER_ORDER = ['dotnet', 'rust', 'go', 'java', 'python', 'cpp', 'typescript', 'node'];

export function stackMarkers() {
  return MARKER_ORDER.filter((stack) => STACK_REGISTRY[stack]?.marker).map((stack) => {
    const marker = STACK_REGISTRY[stack].marker;
    return {
      stack,
      label: marker.label,
      match: (names) => {
        const list = Array.isArray(names) ? names : [];
        for (const ext of marker.anyExt || []) {
          const hit = list.find((name) => name.endsWith(ext));
          if (hit) return hit;
        }
        for (const file of marker.files || []) {
          if (list.includes(file)) return file;
        }
        return null;
      },
    };
  });
}

/** devcontainer 四张映射（image / user / 镜像是否自带 node / VS Code 扩展）。 */
export function devcontainerMaps() {
  const images = {};
  const users = {};
  const provisionsNode = {};
  const extensions = {};
  for (const [stack, def] of Object.entries(STACK_REGISTRY)) {
    images[stack] = def.devcontainer.image;
    users[stack] = def.devcontainer.user;
    provisionsNode[stack] = def.devcontainer.provisionsNode;
    extensions[stack] = [...def.devcontainer.extensions];
  }
  return { images, users, provisionsNode, extensions };
}
