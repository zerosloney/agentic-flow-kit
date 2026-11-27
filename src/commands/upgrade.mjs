import { flag } from '../cli/args.mjs';
import { requireManifest } from '../install/manifest.mjs';
import { migrateManifest } from '../install/migrations.mjs';
import { makeT } from '../i18n.mjs';
import { resolveTarget } from '../install/target.mjs';
import { runInstall } from './install.mjs';

export async function upgradeCommand({ args, t, lang }) {
  const target = resolveTarget(args);
  let manifest = requireManifest(target, t);
  const currentLang = args.lang || manifest.language || lang;
  const tt = makeT(currentLang);
  let migration = null;
  try {
    migration = await migrateManifest({ target, manifest, dryRun: flag(args, 'dry-run') });
  } catch (error) {
    const wrapped = new Error(
      error.code === 'MANIFEST_SCHEMA'
        ? t('error.manifestFuture', { version: error.version, current: error.current })
        : t('error.migrationFailed', { file: error.file || '?', message: error.message }),
    );
    wrapped.code = error.code || 'MIGRATION_FAILED';
    throw wrapped;
  }
  manifest = migration.manifest;
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
    // 栈重放：显式 --stack 优先（可多栈）；否则沿用 manifest 多栈；再退单栈主栈。主栈覆盖语义不变。
    stacksOverride: args.stacks?.length
      ? args.stacks
      : (manifest.stacks?.length ? manifest.stacks : [args.stack || args.profile || manifest.stack]),
    migration,
  });
}
