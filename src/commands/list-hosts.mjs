import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { flag } from '../cli/args.mjs';
import { HOST_NAMES, resolveHost, hostSource, UNMANAGED_HOST_PROBES } from '../hosts/registry.mjs';

export function listHostsCommand({ args, t, lang }) {
  // 宿主能力来自注册表；--json 只输出数组，人类表格保持原样。
  const hosts = HOST_NAMES.map((name) => {
    const h = resolveHost(name);
    return {
      name,
      label: h.label,
      dir: h.dir,
      source: hostSource(name),
      tracked: Boolean(h.tracked),
      commands: Boolean(h.commands),
      agents: Boolean(h.agents),
      skills: h.skills ? h.skills.mode : null,
      hooks: Boolean(h.hooks),
      permissions: Boolean(h.permissions),
      mcp: Boolean(h.mcp),
      modelField: h.agents?.modelField || null,
    };
  });
  if (flag(args, 'json')) {
    console.log(JSON.stringify(hosts, null, 2));
    return 0;
  }
  for (const h of hosts) {
    console.log(`${h.name}\t${h.label}\t${h.dir}${h.tracked ? '\ttracked' : ''}`);
  }
  // issue #41 C 档：已探测到但暂不受支持的宿主，逐项只读存在性检查；检出几行输出几行，无检出不加尾行。
  for (const probe of UNMANAGED_HOST_PROBES) {
    const detected = probe.signals.some((sig) => fs.existsSync(path.join(os.homedir(), probe.dir, sig)));
    if (detected) {
      console.log(t('listHosts.unmanagedProbe', { name: probe.name, dir: probe.dir }));
    }
  }
  return 0;
}
