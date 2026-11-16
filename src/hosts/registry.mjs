// 宿主注册表：v1 十宿主。dir 为宿主点目录；rootMemory 为项目根记忆文件（仅 Claude 有）。
// 能力字段描述安装器可以写什么、怎么写；探测不到的字段保持 null，不编造目录。
// tracked 仅描述当前本仓的人库政策，不影响安装能力。

export const HOSTS = {
  trae: {
    dir: '.trae',
    label: 'Trae',
    tracked: true,
    commands: { dir: 'commands', ext: '.md' },
    agents: { dir: 'agents', ext: '.md', modelField: null, inheritValue: null },
    skills: { mode: 'index' },
    // Trae 目前只接线命令门禁（无写前门），迁移时保持既有语义。
    hooks: {
      file: 'hooks.json',
      format: 'json',
      events: {
        event: 'PreToolUse',
        container: 'hooks',
        matchers: { shell: 'RunCommand|Bash|Shell|Terminal' },
        tools: ['shell'],
        timeouts: { shell: 600 },
        command: { form: 'cli', template: 'flow-kit hook {hook}' },
      },
    },
    hardening: { level: 'hooks' },
    modelProbe: { configs: [], env: [], cli: [] },
  },
  codebuddy: {
    dir: '.codebuddy',
    label: 'CodeBuddy',
    tracked: true,
    commands: { dir: 'commands', ext: '.md' },
    agents: { dir: 'agents', ext: '.md', modelField: null, inheritValue: null },
    // CodeBuddy 官方文档不可得；本地既有 .codebuddy/skills/<name>/SKILL.md 约定
    skills: { mode: 'native', dir: 'skills', file: 'SKILL.md' },
    hooks: {
      file: 'settings.json',
      format: 'json',
      events: {
        event: 'PreToolUse',
        container: 'hooks',
        matchers: { write: 'Write|Edit|MultiEdit', shell: 'Bash|PowerShell|RunCommand|Shell|Terminal' },
        timeouts: { write: 120, shell: 800 },
        command: { form: 'cli', template: 'flow-kit hook {hook}' },
      },
    },
    hardening: { level: 'hooks' },
    modelProbe: { configs: ['~/.codebuddy/settings.json'], env: ['CODEBUDDY_MODEL'], cli: [] },
  },
  codex: {
    dir: '.codex',
    label: 'Codex / ChatGPT',
    tracked: true,
    // 零项目文件宿主：Codex 原生读根 AGENTS.md，不写宿主点目录（不建 templates/hosts/codex/）。
    commands: null,
    agents: null,
    skills: null,
    hooks: null,
    // 用户级 hook 接线（issue #45 实测）：Codex 的 hooks 在 ~/.codex/hooks.json（不在仓内），
    // 适配脚本随包分发经 `flow-kit hook codex-gate` 调起；编辑 hooks.json 会使条目信任哈希失效，
    // 接线变更后需交互式会话重新信任一次，非交互模式会静默跳过未信任条目。
    userHooks: {
      config: '~/.codex/hooks.json',
      event: 'PreToolUse',
      matcher: '^(exec_command|apply_patch)$',
      command: 'flow-kit hook codex-gate',
      timeout: 60,
    },
    hardening: { level: 'hooks' },
    modelProbe: { configs: [], env: [], cli: [] },
  },
  codeartsdoer: {
    dir: '.codeartsdoer',
    label: 'CodeArtsDoer（华为云码道）',
    tracked: true,
    // 无 commands/agents 项目等价面（issue #48 实测）：治理与命令兜底走根 AGENTS.md 与 git 钩子。
    commands: null,
    agents: null,
    // .codeartsdoer/skills/<name>/SKILL.md 指针壳（宿主标准文件名 SKILL.md，实测）
    skills: { mode: 'native', dir: 'skills', file: 'SKILL.md' },
    hooks: {
      // 宿主真实发现面（VS Code 标准，issue §5.2 的 .codeartsdoer/ 假设按「探测先行」修正，见 issue 评论）
      file: '.github/hooks/flow-kit-gates.json',
      format: 'json',
      events: {
        event: 'PreToolUse',
        container: 'hooks',
        // 宿主本构建忽略 matcher（全量工具触发，适配层按 tool_name 自分派）；仍按既有宿主同构声明
        matchers: { shell: 'execute|edit|search|agent|read|web|todo' },
        tools: ['shell'],
        timeouts: { shell: 60 },
        command: { form: 'cli', template: 'flow-kit hook codeartsdoer-gate' },
      },
    },
    hardening: { level: 'hooks' },
    modelProbe: { configs: [], env: [], cli: [] },
    // hooks 面根锚定：.github/hooks/ 落仓根（与 .github/workflows/ 同存），不进宿主点目录
    rootRels: ['.github/hooks/flow-kit-gates.json'],
  },
  claude: {
    dir: '.claude',
    label: 'Claude Code',
    tracked: false,
    rootMemory: 'CLAUDE.md',
    // 根目录信号：Claude Code 的项目配置与记忆文件
    detect: ['.mcp.json', 'CLAUDE.md'],
    commands: { dir: 'commands', ext: '.md' },
    agents: { dir: 'agents', ext: '.md', modelField: 'model', inheritValue: 'inherit' },
    skills: { mode: 'native', dir: 'skills', file: 'SKILL.md' },
    hooks: {
      file: 'settings.json',
      format: 'json',
      events: {
        // event 数组 = 该宿主支持的多个 hook 事件（编译器按规格条目 event 匹配）。
        // PostToolUse(Agent) 仅接 usage 观测腿（官方 hooks 文档实证：tool_response 含 usage/
        // totalDurationMs/resolvedModel/agentId，只覆盖子代理最后一次 API 请求）；其余宿主无
        // 公开证据，一律不接。
        event: ['PreToolUse', 'PostToolUse'],
        container: 'hooks',
        matchers: { write: 'Write|Edit|MultiEdit', shell: 'Bash', agent: 'Agent' },
        timeouts: { write: 120, shell: 800, agent: 10 },
        command: { form: 'cli', template: 'flow-kit hook {hook}' },
      },
    },
    // Claude Code 项目级 MCP 配置（根目录 .mcp.json，mcpServers 容器）
    permissions: { container: 'permissions', syntax: 'colon', tool: 'Bash', tools: ['shell', 'read', 'web'] },
    // enterprise 档：managed-only 设置模板替换 settings.json，权限数组仍由 gates.json 编译
    hardening: { level: 'managed', settings: 'settings.hardened.json' },
    mcp: { file: '.mcp.json', format: 'claude', scope: 'project' },
    modelProbe: {
      configs: ['~/.claude/settings.json'],
      env: ['ANTHROPIC_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL'],
      cli: [],
    },
  },
  opencode: {
    dir: '.opencode',
    label: 'OpenCode',
    tracked: false,
    detect: ['opencode.json', 'opencode.jsonc'],
    commands: { dir: 'commands', ext: '.md' },
    // 省略 model = 继承父级；不写 inherit 值
    agents: { dir: 'agents', ext: '.md', modelField: 'model', inheritValue: null },
    skills: { mode: 'native', dir: 'skills', file: 'SKILL.md' },
    hooks: null,
    // OpenCode 根配置使用 mcp 容器，local 命令是数组、env 字段名为 environment
    mcp: { file: 'opencode.json', format: 'opencode', scope: 'project' },
    hardening: { level: 'none' },
    modelProbe: { configs: ['~/.config/opencode/opencode.json'], env: ['OPENCODE_MODEL'], cli: [] },
  },
  qwen: {
    dir: '.qwen',
    label: 'Qwen Code',
    tracked: false,
    detect: ['QWEN.md'],
    commands: { dir: 'commands', ext: '.md' },
    agents: { dir: 'agents', ext: '.md', modelField: 'model', inheritValue: 'inherit' },
    // Qwen 原生发现 .agents/skills；不复制宿主技能副本
    skills: { mode: 'shared' },
    hooks: {
      file: 'settings.json',
      format: 'json',
      events: {
        event: 'PreToolUse',
        container: 'hooks',
        matchers: { write: 'write_file|edit|replace|multiedit', shell: 'run_shell_command|shell' },
        timeouts: { write: 120, shell: 800 },
        command: { form: 'cli', template: 'flow-kit hook {hook}' },
      },
    },
    // Qwen Code 在 .qwen/settings.json 使用 mcpServers 容器
    permissions: { container: 'permissions', syntax: 'space', tool: 'Bash', tools: ['shell'], extraAllow: [{ tool: 'shell', pat: 'dir' }] },
    hardening: { level: 'permissions' },
    mcp: { file: '.qwen/settings.json', format: 'claude', scope: 'project' },
    modelProbe: { configs: ['~/.qwen/settings.json'], env: ['QWEN_MODEL'], cli: [] },
  },
  pi: {
    dir: '.pi',
    label: 'PI',
    tracked: false,
    commands: null,
    // PI 的 model 是网关限定 ID，没有 inherit 语义；解析不到时保留模板原值
    agents: { dir: 'agents', ext: '.md', modelField: 'model', inheritValue: null },
    skills: { mode: 'index' },
    hooks: null,
    hardening: { level: 'none' },
    modelProbe: { configs: ['~/.pi/settings.json'], env: ['PI_MODEL'], cli: [] },
  },
  cline: {
    dir: '.cline',
    label: 'Cline',
    tracked: false,
    // Cline 的 workflows 是 Markdown 工作流，用作技能索引入口
    commands: { dir: 'workflows', ext: '.md' },
    agents: { dir: 'agents', ext: '.yml', modelField: null, inheritValue: null },
    skills: { mode: 'index' },
    hooks: null,
    hardening: { level: 'none' },
    modelProbe: { configs: [], env: [], cli: [] },
  },
  commandcode: {
    dir: '.commandcode',
    label: 'Command Code',
    tracked: false,
    commands: { dir: 'commands', ext: '.md' },
    agents: { dir: 'agents', ext: '.md', modelField: 'model', inheritValue: 'inherit' },
    // Command Code 原生发现 .agents/skills；不复制宿主技能副本
    skills: { mode: 'shared' },
    hooks: {
      file: 'settings.json',
      format: 'json',
      events: {
        event: 'PreToolUse',
        container: 'hooks',
        matchers: { write: 'WRITE|EDIT', shell: 'SHELL' },
        timeouts: { write: 120, shell: 600 },
        command: { form: 'cli', template: 'flow-kit hook {hook}' },
      },
    },
    permissions: { container: 'permissions', syntax: 'space', tool: 'Shell', tools: ['shell'], extraAllow: [{ tool: 'shell', pat: 'dir' }] },
    hardening: { level: 'permissions' },
    modelProbe: {
      configs: ['~/.commandcode/settings.json'],
      env: ['COMMANDCODE_MODEL'],
      // cmd --list-models 是唯一已核实的非交互列表命令；Windows 上跳过 cmd（可能是系统 cmd.exe）
      cli: [{ command: 'cmd', args: ['--list-models'] }, { command: 'commandcode', args: ['--list-models'] }],
    },
  },
  qoder: {
    dir: '.qoder',
    label: 'Qoder',
    tracked: false,
    commands: { dir: 'commands', ext: '.md' },
    agents: { dir: 'agents', ext: '.md', modelField: null, inheritValue: null },
    skills: { mode: 'index' },
    hooks: {
      file: 'settings.json',
      format: 'json',
      events: {
        event: 'PreToolUse',
        container: 'hooks',
        matchers: { write: 'Edit|Write|NotebookEdit', shell: 'Bash' },
        timeouts: { write: 120, shell: 600 },
        includeMeta: true,
        command: { form: 'cli-args', template: 'flow-kit hook {hook}' },
      },
    },
    permissions: { container: 'permissions', syntax: 'colon', tool: 'Bash', tools: ['shell'] },
    hardening: { level: 'permissions' },
    modelProbe: { configs: ['~/.qoder/settings.json'], env: [], cli: [] },
  },
  zcode: {
    dir: '.zcode',
    label: 'ZCode',
    tracked: false,
    commands: null,
    agents: { dir: 'agents', ext: '.md', modelField: null, inheritValue: null },
    skills: { mode: 'index' },
    hooks: {
      file: 'config.json',
      format: 'json',
      events: {
        event: 'PreToolUse',
        container: 'hooks.events',
        matchers: { write: 'Edit|Write|MultiEdit', shell: 'Bash|RunCommand|Shell|Terminal|PowerShell' },
        timeouts: { write: 60, shell: 600 },
        rootDefaults: { enabled: true },
        hookExtras: { enabled: true },
        command: { form: 'cli', template: 'flow-kit hook {hook}' },
      },
    },
    hardening: { level: 'hooks' },
    modelProbe: { configs: ['~/.zcode/config.json'], env: [], cli: [] },
  },
};

export const HOST_NAMES = Object.keys(HOSTS);

// 已知但暂不受支持的宿主探测面（issue #41 C 档）：list-hosts 与 check-local-gates 的机器级探测共用。
// 宿主被正式支持（内置或 external host plugin）后，把对应项从此表移除并在 HOSTS/插件登记。
// Codex 已内置（issue #45），自此表移除。
export const UNMANAGED_HOST_PROBES = [
  { name: 'Gemini CLI', dir: '.gemini', signals: ['settings.json'] },
];

// 来源：builtin / user / project / cli。外部定义由 src/hosts/external.mjs 注册。
export const HOST_SOURCES = new Map(HOST_NAMES.map((name) => [name, 'builtin']));

export function registerHost(name, def, source = 'external') {
  const key = String(name || '').trim().toLowerCase();
  HOSTS[key] = def;
  HOST_SOURCES.set(key, source);
  if (!HOST_NAMES.includes(key)) HOST_NAMES.push(key);
  return key;
}

export function hostSource(name) {
  return HOST_SOURCES.get(String(name || '').trim().toLowerCase()) || 'builtin';
}


export function resolveHost(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!HOSTS[key]) {
    const err = new Error(`unknown host: ${name}`);
    err.code = 'UNKNOWN_HOST';
    throw err;
  }
  return { name: key, ...HOSTS[key] };
}

// 宿主模板相对路径 -> 目标相对路径。rootMemory / rootRels 文件放项目根，其余放宿主点目录。
export function hostTargetRel(name, rel) {
  const h = HOSTS[name];
  if (!h) {
    const err = new Error(`unknown host: ${name}`);
    err.code = 'UNKNOWN_HOST';
    throw err;
  }
  const normalized = String(rel).replace(/\\/g, '/');
  if (h.rootMemory && normalized === h.rootMemory) return h.rootMemory;
  if (Array.isArray(h.rootRels) && h.rootRels.includes(normalized)) return normalized;
  return `${h.dir}/${normalized}`;
}

// 子代理文件名 -> 引擎模型角色。未知角色按 judgment 处理（强推理默认更稳）。
const MODEL_ROLE_BY_AGENT = {
  implementer: 'code',
  'independent-reviewer': 'review',
  'pr-verifier': 'review',
  'pr-adjudicator': 'judgment',
  'pr-finder': 'judgment',
  'ui-verifier': 'judgment',
  'wiki-compiler': 'judgment',
  'test-designer': 'judgment',
};

export function modelRoleForAgent(rel) {
  const base = String(rel).split('/').pop().replace(/\.[^.]+$/, '');
  return MODEL_ROLE_BY_AGENT[base] || 'judgment';
}

export function isAgentTemplate(hostName, rel) {
  const h = HOSTS[hostName];
  if (!h?.agents) return false;
  const normalized = String(rel).replace(/\\/g, '/');
  return normalized.startsWith(`${h.agents.dir}/`) && normalized.endsWith(h.agents.ext);
}
