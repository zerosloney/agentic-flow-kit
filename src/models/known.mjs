// 仅收录已核实的推荐别名。没有可靠来源的宿主不合成模型列表；探测不到就 inherit/手填。
export const KNOWN_MODELS = {
  // Claude Code 子代理 model 接受 alias / full name；alias 随主模型档位走
  claude: [
    { id: 'sonnet', roles: ['code'], note: 'balanced' },
    { id: 'haiku', roles: ['code'], note: 'fast/cheap' },
    { id: 'opus', roles: ['judgment', 'review'], note: 'strong reasoning' },
  ],
};

export function knownFor(host, role) {
  return (KNOWN_MODELS[host] || []).filter((m) => m.roles.includes(role)).map((m) => m.id);
}
