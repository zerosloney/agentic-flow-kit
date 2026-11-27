import fs from 'node:fs';
import path from 'node:path';
import { makeT } from '../i18n.mjs';

export function resolveTarget(args = {}) {
  const target = path.resolve(args.target || process.cwd());
  if (!fs.existsSync(target)) {
    const err = new Error(`target not found: ${target}`);
    err.code = 'TARGET_MISSING';
    throw err;
  }
  if (!fs.statSync(target).isDirectory()) {
    // 复用 TARGET_MISSING 让退出码落在目标类（3）；专用映射需改 src/cli/exit.mjs。
    const t = makeT(args.lang || 'zh-CN');
    const err = new Error(t('error.targetNotDirectory', { target }));
    err.code = 'TARGET_MISSING';
    throw err;
  }
  return target;
}
