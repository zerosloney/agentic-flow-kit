// 极简参数解析：--key value / --flag / --key=value；--agent 可重复。
export function parseArgs(argv) {
  const args = { _: [], agents: [], flags: new Set() };
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
      else args[key] = value;
      continue;
    }
    const key = raw.slice(2);
    const value = takeValue(i);
    if (value != null) {
      if (key === 'agent') args.agents.push(value);
      else args[key] = value;
      i += 1;
    } else {
      args.flags.add(key);
    }
  }
  // --agents a,b,c
  if (typeof args.agents === 'string') args.agents = args.agents.split(',');
  args.agents = args.agents.flatMap((a) => String(a).split(',')).map((a) => a.trim()).filter(Boolean);
  return args;
}

export function flag(args, name) {
  return args.flags.has(name) || args[name] === true || args[name] === 'true';
}
