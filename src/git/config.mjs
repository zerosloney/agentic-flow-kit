import { execFileSync } from 'node:child_process';

export const HOOKS_PATH = '.githooks';
export const JSONL_UNION_DRIVER = 'flow-kit run git-merge-jsonl %O %A %B';

export function isGitRepo(target) {
  try {
    execFileSync('git', ['-C', target, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function getConfig(target, key) {
  try {
    return execFileSync('git', ['-C', target, 'config', '--get', key], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function setConfig(target, key, value) {
  execFileSync('git', ['-C', target, 'config', key, value], { stdio: 'ignore' });
}

export function configureGit(target) {
  setConfig(target, 'core.hooksPath', HOOKS_PATH);
  setConfig(target, 'merge.ours.driver', 'true');
  setConfig(target, 'merge.jsonl-union.driver', JSONL_UNION_DRIVER);
}

export function doctorGit(target) {
  const checks = [];
  if (!isGitRepo(target)) {
    checks.push({ ok: false, name: 'git repository', detail: '目标不是 git 仓库，无法配置/校验 git 门禁' });
    return checks;
  }
  const hooks = getConfig(target, 'core.hooksPath');
  checks.push({
    ok: hooks === HOOKS_PATH,
    name: 'core.hooksPath',
    detail: hooks || '未配置',
    fix: `git -C "${target}" config core.hooksPath ${HOOKS_PATH}`,
  });
  const ours = getConfig(target, 'merge.ours.driver');
  checks.push({
    ok: ours === 'true',
    name: 'merge.ours.driver',
    detail: ours || '未配置',
    fix: `git -C "${target}" config merge.ours.driver true`,
  });
  const jsonl = getConfig(target, 'merge.jsonl-union.driver');
  checks.push({
    ok: jsonl === JSONL_UNION_DRIVER,
    name: 'merge.jsonl-union.driver',
    detail: jsonl || '未配置',
    fix: `git -C "${target}" config merge.jsonl-union.driver "${JSONL_UNION_DRIVER}"`,
  });
  return checks;
}
