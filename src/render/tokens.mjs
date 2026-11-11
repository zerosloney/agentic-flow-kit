import { HOSTS } from '../hosts/registry.mjs';

// 模板变量：只替换已知 token，未知 {{...}} 原样保留（避免误伤代码模板字符串）。
export function buildVars({ target, projectName, stack, language, hosts, kitVersion, installedAt, trackHosts = false }) {
  const stackDefaults = {
    dotnet: {
      description: 'ASP.NET Core 后端 + Vue 3 前端 + SQL Server。',
      descriptionEn: 'ASP.NET Core backend + Vue 3 frontend + SQL Server.',
      apiPort: 8932,
      webPort: 5203,
    },
    node: {
      description: 'Node.js / TypeScript 项目。',
      descriptionEn: 'A Node.js / TypeScript project.',
      apiPort: 3000,
      webPort: 5173,
    },
    empty: {
      description: '项目技术栈按实际填写。',
      descriptionEn: 'Fill in the project stack description.',
      apiPort: 3000,
      webPort: 5173,
    },
  };
  const d = stackDefaults[stack] || stackDefaults.empty;
  const stackDescription = language === 'en' ? d.descriptionEn : d.description;
  const hostIgnores = trackHosts
    ? ''
    : hosts
        .filter((h) => HOSTS[h] && !HOSTS[h].tracked)
        .map((h) => `${HOSTS[h].dir}/`)
        .join('\n');
  return {
    projectName: projectName || pathBase(target),
    stack,
    stackDescription,
    language,
    apiPort: String(d.apiPort),
    webPort: String(d.webPort),
    boardPort: '8933',
    hosts: hosts.join(', '),
    hostsJson: JSON.stringify(hosts),
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
