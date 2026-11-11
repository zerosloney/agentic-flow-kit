// 宿主注册表：v1 十宿主。dir 为宿主点目录；rootMemory 为项目根记忆文件（仅 Claude 有）。
// tracked 仅描述当前本仓的人库政策，不影响安装能力。
export const HOSTS = {
  trae: { dir: '.trae', label: 'Trae', tracked: true },
  codebuddy: { dir: '.codebuddy', label: 'CodeBuddy', tracked: true },
  claude: { dir: '.claude', label: 'Claude Code', tracked: false, rootMemory: 'CLAUDE.md' },
  opencode: { dir: '.opencode', label: 'OpenCode', tracked: false },
  qwen: { dir: '.qwen', label: 'Qwen Code', tracked: false },
  pi: { dir: '.pi', label: 'PI', tracked: false },
  cline: { dir: '.cline', label: 'Cline', tracked: false },
  commandcode: { dir: '.commandcode', label: 'Command Code', tracked: false },
  qoder: { dir: '.qoder', label: 'Qoder', tracked: false },
  zcode: { dir: '.zcode', label: 'ZCode', tracked: false },
};

export const HOST_NAMES = Object.keys(HOSTS);

export function resolveHost(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!HOSTS[key]) {
    const err = new Error(`unknown host: ${name}`);
    err.code = 'UNKNOWN_HOST';
    throw err;
  }
  return { name: key, ...HOSTS[key] };
}
