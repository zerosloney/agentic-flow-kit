// 极简参数解析：--key value / --flag / --key=value；--agent / --stack 可重复。
export function parseArgs(argv) {
  const args = { _: [], agents: [], models: [], hostManifests: [], surfaces: [], stacks: [], repos: [], flags: new Set() };
  const takeValue = (i) => {
    const next = argv[i + 1];
    if (next == null || (next.startsWith('--') && next !== '-')) return null;
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) {
      args._.push(raw);
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq >= 0) {
      const key = raw.slice(2, eq);
      const value = raw.slice(eq + 1);
      if (key === 'agent') args.agents.push(value);
      else if (key === 'model') args.models.push(value);
      else if (key === 'host-manifest') args.hostManifests.push(value);
      else if (key === 'surface') args.surfaces.push(value);
      else if (key === 'stack') args.stacks.push(value);
      else if (key === 'repos') args.repos.push(value);
      else args[key] = value;
      continue;
    }
    const key = raw.slice(2);
    const value = takeValue(i);
    if (value != null) {
      if (key === 'agent') args.agents.push(value);
      else if (key === 'model') args.models.push(value);
      else if (key === 'host-manifest') args.hostManifests.push(value);
      else if (key === 'surface') args.surfaces.push(value);
      else if (key === 'stack') args.stacks.push(value);
      else if (key === 'repos') args.repos.push(value);
      else args[key] = value;
      i += 1;
      // --repos ./api ./web：收集到下一个 --flag 为止
      if (key === 'repos') {
        while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          args.repos.push(argv[i + 1]);
          i += 1;
        }
      }
    } else {
      args.flags.add(key);
    }
  }
  // --agents a,b,c
  if (typeof args.agents === 'string') args.agents = args.agents.split(',');
  args.agents = args.agents.flatMap((a) => String(a).split(',')).map((a) => a.trim()).filter(Boolean);
  args.surfaces = (Array.isArray(args.surfaces) ? args.surfaces : [])
    .flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
  // --stack a,b / --stack a --stack b：收集为保序数组；主栈 = 首个声明值（旧消费点 args.stack 继续可用）
  args.stacks = (Array.isArray(args.stacks) ? args.stacks : [args.stacks].filter(Boolean))
    .flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
  args.stack = args.stacks[0];
  return args;
}

export function flag(args, name) {
  return args.flags.has(name) || args[name] === true || args[name] === 'true';
}
