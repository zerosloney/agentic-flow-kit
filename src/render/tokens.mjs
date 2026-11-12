import { HOSTS } from '../hosts/registry.mjs';

const STACK_DEFAULTS = {
    dotnet: {
      description: 'ASP.NET Core 后端 + Vue 3 前端 + SQL Server。',
      descriptionEn: 'ASP.NET Core backend + Vue 3 frontend + SQL Server.',
      apiPort: 8932,
      webPort: 5203,
    },
    node: {
      description: 'Node.js 项目。',
      descriptionEn: 'A Node.js project.',
      apiPort: 3000,
      webPort: 5173,
    },
    typescript: {
      description: 'TypeScript 项目。',
      descriptionEn: 'A TypeScript project.',
      apiPort: 3000,
      webPort: 5173,
    },
    rust: {
      description: 'Rust 项目（Cargo）。',
      descriptionEn: 'A Rust project (Cargo).',
      apiPort: 8080,
      webPort: 5173,
    },
    go: {
      description: 'Go 项目（Go modules）。',
      descriptionEn: 'A Go project (Go modules).',
      apiPort: 8080,
      webPort: 5173,
    },
    java: {
      description: 'Java 项目（Maven 或 Gradle）。',
      descriptionEn: 'A Java project (Maven or Gradle).',
      apiPort: 8080,
      webPort: 5173,
    },
    empty: {
      description: '项目技术栈按实际填写。',
      descriptionEn: 'Fill in the project stack description.',
      apiPort: 3000,
      webPort: 5173,
    },
};

export function stackDescription(stack, language) {
  const d = STACK_DEFAULTS[stack] || STACK_DEFAULTS.empty;
  return language === 'en' ? d.descriptionEn : d.description;
}

// 宿主权限白名单里随栈变化的命令。npm / node / git 是引擎运行时，留在各宿主模板的固定项里。
const STACK_SHELL = {
  dotnet: ['dotnet build', 'dotnet run'],
  rust: ['cargo build', 'cargo run', 'cargo test', 'cargo check'],
  go: ['go build', 'go run', 'go test'],
  java: ['mvn compile', 'mvn test', 'mvn -q test', 'gradle test', 'gradlew test', 'gradlew.bat test', './gradlew test'],
};

function stackAllowFragment(stack, tool, sep) {
  const commands = STACK_SHELL[stack] || [];
  if (!commands.length) return '';
  return commands.map((cmd) => `      "${tool}(${cmd}${sep}*)",`).join('\n') + '\n';
}

// 模板变量：只替换已知 token，未知 {{...}} 原样保留（避免误伤代码模板字符串）。
export function buildVars({ target, projectName, stack, language, hosts, kitVersion, installedAt, trackHosts = false }) {
  const d = STACK_DEFAULTS[stack] || STACK_DEFAULTS.empty;
  const description = stackDescription(stack, language);
  const hostIgnores = trackHosts
    ? ''
    : hosts
        .filter((h) => HOSTS[h] && !HOSTS[h].tracked)
        .map((h) => `${HOSTS[h].dir}/`)
        .join('\n');
  return {
    projectName: projectName || pathBase(target),
    stack,
    stackDescription: description,
    language,
    apiPort: String(d.apiPort),
    webPort: String(d.webPort),
    boardPort: '8933',
    hosts: hosts.join(', '),
    hostsJson: JSON.stringify(hosts),
    stackAllowBashColon: stackAllowFragment(stack, 'Bash', ':'),
    stackAllowBashSpace: stackAllowFragment(stack, 'Bash', ' '),
    stackAllowShellSpace: stackAllowFragment(stack, 'Shell', ' '),
    kitVersion,
    installedAt,
    nodeMinimum: '22',
    hostIgnores,
  };
}

function pathBase(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

export function render(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m));
}
