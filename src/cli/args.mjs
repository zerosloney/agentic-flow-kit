// 极简参数解析：--key value / --flag / --key=value；--agent / --stack 可重复。
// 带值旗标缺值是用法错误，不能降级为布尔旗标（否则 --target 会把引擎装进当前目录）。
const VALUE_FLAGS = new Set([
  'agent', 'agents', 'model', 'host-manifest', 'surface', 'stack', 'repos',
  'target', 'lang', 'tier', 'ci', 'product', 'scaffold', 'profile', 'preset', 'bundle',
  'model-mode', 'api-port', 'web-port', 'name', 'out', 'format', 'days',
  'since', 'algorithm', 'sbom', 'file', 'key', 'pubkey', 'sig', 'root',
  'rules', 'ref', 'remote', 'provider', 'server', 'role', 'tool', 'decision', 'limit',
  'tokens', 'type', 'mode', 'engine', 'network', 'image', 'user', 'skill',
  'subdir', 'inherit', 'mcp', 'enforce', 'dataset', 'threshold', 'range',
  'range-old', 'range-new', 'files', 'face', 'phase', 'prefix', 'run',
  'export-html', 'step', 'task', 'max-steps', 'timeout', 'interval',
  'args', 'artifacts', 'assumptions', 'from', 'to', 'settings', 'hook-event',
  'write-matcher', 'shell-matcher', 'shell-tool', 'model-field', 'root-memory',
  'badge-out', 'badge-format', 'max-cfr', 'max-mttr', 'max-rework', 'min-pass-rate',
]);
// 解析结果不得覆盖解析器自身字段：--flags=x 会让 flag() 在字符串上调用 .has 抛 TypeError。
// agents / repos 是文档化旗标（解析时另行处理），其余内部数组字段不接受同名旗标。
const RESERVED_KEYS = new Set(['_', 'flags', 'models', 'hostManifests', 'surfaces', 'stacks']);

function argError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function parseArgs(argv) {
  const args = { _: [], agents: [], models: [], hostManifests: [], surfaces: [], stacks: [], repos: [], flags: new Set() };
  const takeValue = (i, key) => {
    const next = argv[i + 1];
    if (next == null || (next.startsWith('--') && next !== '-')) {
      if (VALUE_FLAGS.has(key)) throw argError('MISSING_ARG', `flag --${key} requires a value`);
      return null;
    }
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
      if (RESERVED_KEYS.has(key)) throw argError('BAD_ARGS', `flag --${key} is reserved`);
      const value = raw.slice(eq + 1);
      if (VALUE_FLAGS.has(key) && value === '') throw argError('MISSING_ARG', `flag --${key} requires a value`);
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
    if (RESERVED_KEYS.has(key)) throw argError('BAD_ARGS', `flag --${key} is reserved`);
    const value = takeValue(i, key);
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
