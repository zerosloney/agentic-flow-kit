import { HOSTS } from '../hosts/registry.mjs';
import { stackDefaults, stackShell } from '../install/stack-registry.mjs';
import { wikiProtocolNames, wikiTokens } from '../install/wiki-names.mjs';

const STACK_DEFAULTS = stackDefaults();

export function stackDescription(stack, language) {
  const d = STACK_DEFAULTS[stack] || STACK_DEFAULTS.empty;
  return language === 'en' ? d.descriptionEn : d.description;
}

// 宿主权限白名单里随栈变化的命令（单源：stack-registry.mjs）。npm / node / git 是引擎运行时，留在各宿主模板的固定项里。
export const STACK_SHELL = stackShell();

function stackAllowFragment(stack, tool, sep) {
  const commands = STACK_SHELL[stack] || [];
  if (!commands.length) return '';
  return commands.map((cmd) => `      "${tool}(${cmd}${sep}*)",`).join('\n') + '\n';
}

// 模板变量：只替换已知 token，未知 {{...}} 原样保留（避免误伤代码模板字符串）。
// stacks 为多栈声明序列（首个为主栈）；{{stack}}、端口与描述恒按主栈，权限片段按各栈声明顺序拼接。
function buildProductNote(product, language, apiPort, webPort) {
  const en = language === 'en';
  if (product === 'api') {
    return en
      ? `API-only service (port ${apiPort}): no frontend dev server; the UI-verification stage does not apply.`
      : `仅 API 服务（端口 ${apiPort}）：无前端 dev 服务，UI 实测阶段不适用。`;
  }
  if (product === 'library') {
    return en
      ? 'Library/package project: no frontend/API port topology; verify via unit tests, examples and public API contracts; the UI-verification stage does not apply.'
      : '库/包项目：无前端/API 端口拓扑；验证以单测、示例与公共 API 契约为主，UI 实测阶段不适用。';
  }
  if (product === 'cli') {
    return en
      ? 'CLI tool project: no frontend/API port topology; verify via unit tests and end-to-end command snapshots; the UI-verification stage does not apply.'
      : 'CLI 工具项目：无前端/API 端口拓扑；验证以单测与端到端命令快照为主，UI 实测阶段不适用。';
  }
  return en
    ? `Frontend dev server ${webPort} → API http://localhost:${apiPort}; the API must listen on ${apiPort}.`
    : `前端 dev ${webPort} 连 API http://localhost:${apiPort}；API 须监听 ${apiPort} 才联通。`;
}

export function buildVars({ target, projectName, stack, language, hosts, kitVersion, installedAt, trackHosts = false, stacks = null, ports = null, product = 'web' }) {
  const d = STACK_DEFAULTS[stack] || STACK_DEFAULTS.empty;
  const description = stackDescription(stack, language);
  const stackList = stacks?.length ? stacks : [stack];
  const apiPort = Number(ports?.api) > 0 ? Number(ports.api) : d.apiPort;
  const webPort = Number(ports?.web) > 0 ? Number(ports.web) : d.webPort;
  const productNote = buildProductNote(product, language, apiPort, webPort);
  const hostIgnores = trackHosts
    ? ''
    : hosts
        .filter((h) => HOSTS[h] && !HOSTS[h].tracked)
        .map((h) => `${HOSTS[h].dir}/`)
        .join('\n');
  // engine.json 的 options.wiki：中文安装不写（保持逐字节不变，引擎缺省即中文）；其他语言追加 JSON 成员。
  const wikiNames = wikiProtocolNames(language);
  const wikiNamesMember = language === 'zh-CN'
    ? ''
    : `,\n    "wiki": {\n      "board": ${JSON.stringify(wikiNames.board)},\n      "maintenance": ${JSON.stringify(wikiNames.maintenance)},\n      "schemaBatch": ${JSON.stringify(wikiNames.schemaBatch)},\n      "dataFixBatch": ${JSON.stringify(wikiNames.dataFixBatch)}\n    }`;
  return {
    projectName: projectName || pathBase(target),
    stack,
    stacksJson: JSON.stringify(stackList),
    stackDescription: description,
    language,
    product,
    productNote,
    apiPort: String(apiPort),
    webPort: String(webPort),
    boardPort: '8933',
    hosts: hosts.join(', '),
    hostsJson: JSON.stringify(hosts),
    stackAllowBashColon: stackList.map((s) => stackAllowFragment(s, 'Bash', ':')).join(''),
    stackAllowBashSpace: stackList.map((s) => stackAllowFragment(s, 'Bash', ' ')).join(''),
    stackAllowShellSpace: stackList.map((s) => stackAllowFragment(s, 'Shell', ' ')).join(''),
    kitVersion,
    installedAt,
    nodeMinimum: '22',
    hostIgnores,
    ...wikiTokens(language),
    wikiNamesMember,
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
