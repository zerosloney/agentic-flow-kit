import { readManifest } from '../install/manifest.mjs';
import { makeT } from '../i18n.mjs';
import { resolveTarget, runInstall } from './install.mjs';

export function upgradeCommand({ args, t, lang }) {
  const target = resolveTarget(args);
  const manifest = readManifest(target);
  if (!manifest) {
    const err = new Error(t('error.noManifest'));
    err.code = 'NO_MANIFEST';
    throw err;
  }
  const currentLang = args.lang || manifest.language || lang;
  const tt = makeT(currentLang);
  const hosts = manifest.hosts || [];
  if (!hosts.length) {
    const err = new Error(t('error.noHostsInManifest'));
    err.code = 'NO_HOSTS_IN_MANIFEST';
    throw err;
  }
  return runInstall({
    args: { ...args, target },
    t: tt,
    lang: currentLang,
    hosts,
    planHosts: hosts,
    commandLabel: 'upgrade',
    stackOverride: args.stack || args.profile || manifest.stack,
  });
}
