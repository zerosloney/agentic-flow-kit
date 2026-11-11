import { readManifest } from '../install/manifest.mjs';
import { makeT } from '../i18n.mjs';
import { resolveTarget, runInstall, resolveHosts } from './install.mjs';

export function addHostCommand({ args, t, lang }) {
  const target = resolveTarget(args);
  const manifest = readManifest(target);
  if (!manifest) {
    const err = new Error(t('error.noManifest'));
    err.code = 'NO_MANIFEST';
    throw err;
  }
  // add-host 支持 `add-host claude` 位置参数，也兼容 `--agent claude`。
  const positional = args._.slice(1);
  const hostArgs = { ...args, agents: args.agents.length ? args.agents : positional };
  const newHosts = resolveHosts(hostArgs, t);
  const currentLang = args.lang || manifest.language || lang;
  const tt = makeT(currentLang);
  return runInstall({
    args: { ...hostArgs, target },
    t: tt,
    lang: currentLang,
    hosts: newHosts,
    planHosts: newHosts,
    categories: ['host'],
    commandLabel: 'add-host',
    stackOverride: manifest.stack,
  });
}
