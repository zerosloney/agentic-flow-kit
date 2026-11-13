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
    hooks: { file: 'hooks.json', format: 'json' },
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
    hooks: { file: 'settings.json', format: 'json' },
    modelProbe: { configs: ['~/.codebuddy/settings.json'], env: ['CODEBUDDY_MODEL'], cli: [] },
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
    hooks: { file: 'settings.json', format: 'json' },
    // Claude Code 项目级 MCP 配置（根目录 .mcp.json，mcpServers 容器）
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
    hooks: { file: 'settings.json', format: 'json' },
    // Qwen Code 在 .qwen/settings.json 使用 mcpServers 容器
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
    hooks: { file: 'settings.json', format: 'json' },
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
    hooks: { file: 'settings.json', format: 'json' },
    modelProbe: { configs: ['~/.qoder/settings.json'], env: [], cli: [] },
  },
  zcode: {
    dir: '.zcode',
    label: 'ZCode',
    tracked: false,
    commands: null,
    agents: { dir: 'agents', ext: '.md', modelField: null, inheritValue: null },
    skills: { mode: 'index' },
    hooks: { file: 'config.json', format: 'json' },
    modelProbe: { configs: ['~/.zcode/config.json'], env: [], cli: [] },
  },
};

export const HOST_NAMES = Object.keys(HOSTS);

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

// 宿主模板相对路径 -> 目标相对路径。rootMemory 文件放项目根，其余放宿主点目录。
export function hostTargetRel(name, rel) {
  const h = HOSTS[name];
  if (!h) {
    const err = new Error(`unknown host: ${name}`);
    err.code = 'UNKNOWN_HOST';
    throw err;
  }
  const normalized = String(rel).replace(/\\/g, '/');
  if (h.rootMemory && normalized === h.rootMemory) return h.rootMemory;
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
