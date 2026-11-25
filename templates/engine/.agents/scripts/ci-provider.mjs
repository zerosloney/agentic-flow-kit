// ci-provider.mjs — 基础设施 CI 提供商抽象与基线探测
// 统一支持 GitHub Actions / GitLab CI / Azure Pipelines / 通用 CI
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ciPushBefore } from './check-lane-surface.mjs';

function defaultParentOf(id, resolveSelf = false) {
  const rev = resolveSelf ? id : `${id}^`;
  const r = spawnSync('git', ['rev-parse', rev], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}

export const CI_PROVIDERS = {
  azure: {
    id: 'azure',
    name: 'Azure Pipelines',
    detect(env = process.env) {
      return !!(env.TF_BUILD || env.SYSTEM_COLLECTIONURI);
    },
    resolveBaseSha(env = process.env, options = {}) {
      const changes = options.changes;
      if (changes) {
        const parentOf = options.parentOf || defaultParentOf;
        return ciPushBefore(changes, parentOf);
      }
      return { before: null, reason: '未提供 changes 数据' };
    },
    writeEnv(name, value) {
      console.log(`##vso[task.setvariable variable=${name}]${value}`);
      return true;
    },
  },
  github: {
    id: 'github',
    name: 'GitHub Actions',
    detect(env = process.env) {
      return env.GITHUB_ACTIONS === 'true';
    },
    resolveBaseSha(env = process.env, options = {}) {
      // 1. 若为 PR，从 GITHUB_EVENT_PATH 读取 pull_request.base.sha
      const eventPath = env.GITHUB_EVENT_PATH;
      if (eventPath && fs.existsSync(eventPath)) {
        try {
          const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
          if (event.pull_request?.base?.sha && /^[0-9a-f]{40}$/i.test(event.pull_request.base.sha)) {
            return { before: event.pull_request.base.sha.toLowerCase(), reason: 'ok (github pr base sha)' };
          }
          if (event.before && /^[0-9a-f]{40}$/i.test(event.before) && !/^0+$/.test(event.before)) {
            return { before: event.before.toLowerCase(), reason: 'ok (github push before)' };
          }
        } catch { /* 容错：文件读取或解析失败 */ }
      }
      // 2. 若有 GITHUB_BASE_REF
      if (env.GITHUB_BASE_REF) {
        const rev = `origin/${env.GITHUB_BASE_REF}`;
        const parentOf = options.parentOf || defaultParentOf;
        const sha = parentOf(rev, true);
        if (sha && /^[0-9a-f]{40}$/i.test(sha)) {
          return { before: sha.toLowerCase(), reason: 'ok (github base ref)' };
        }
      }
      return { before: null, reason: '无法从 GITHUB_EVENT_PATH 或 GITHUB_BASE_REF 中解析 base sha' };
    },
    writeEnv(name, value, env = process.env) {
      if (env.GITHUB_ENV) {
        try {
          fs.appendFileSync(env.GITHUB_ENV, `${name}=${value}\n`, 'utf8');
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
  },
  gitlab: {
    id: 'gitlab',
    name: 'GitLab CI',
    detect(env = process.env) {
      return env.GITLAB_CI === 'true';
    },
    resolveBaseSha(env = process.env, options = {}) {
      // 1. MR 目标分支或 diff base
      const mrBase = env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA || env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
      if (mrBase && /^[0-9a-f]{40}$/i.test(mrBase)) {
        return { before: mrBase.toLowerCase(), reason: 'ok (gitlab mr base sha)' };
      }
      // 2. 推送前 SHA（非全零）
      const pushBefore = env.CI_COMMIT_BEFORE_SHA;
      if (pushBefore && /^[0-9a-f]{40}$/i.test(pushBefore) && !/^0+$/.test(pushBefore)) {
        return { before: pushBefore.toLowerCase(), reason: 'ok (gitlab push before sha)' };
      }
      // 3. MR 目标分支名
      if (env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME) {
        const rev = `origin/${env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME}`;
        const parentOf = options.parentOf || defaultParentOf;
        const sha = parentOf(rev, true);
        if (sha && /^[0-9a-f]{40}$/i.test(sha)) {
          return { before: sha.toLowerCase(), reason: 'ok (gitlab mr target branch)' };
        }
      }
      return { before: null, reason: '无法从 GitLab CI 环境变量中解析 base sha' };
    },
    writeEnv(name, value, env = process.env) {
      // GitLab 无预置环境变量文件：需项目自行定义 GITLAB_ENV 指向一个文件，并用
      // artifacts:reports:dotenv 传给后续作业；未定义时返回 false，ci-push-before 只输出 advisory。
      if (env.GITLAB_ENV) {
        try {
          fs.appendFileSync(env.GITLAB_ENV, `${name}=${value}\n`, 'utf8');
          return true;
        } catch {
          return false;
        }
      }
      return false;
    },
  },
  generic: {
    id: 'generic',
    name: 'Generic CI',
    detect(env = process.env) {
      return !!(env.CI === 'true' || env.CI === '1' || env.CONTINUOUS_INTEGRATION === 'true');
    },
    resolveBaseSha(env = process.env) {
      if (env.CI_PUSH_BEFORE && /^[0-9a-f]{40}$/i.test(env.CI_PUSH_BEFORE)) {
        return { before: env.CI_PUSH_BEFORE.toLowerCase(), reason: 'ok (generic CI_PUSH_BEFORE)' };
      }
      return { before: null, reason: '通用 CI 未配置 CI_PUSH_BEFORE' };
    },
    writeEnv() {
      return false;
    },
  },
};

export function isCi(env = process.env) {
  return !!(
    env.CI === 'true' ||
    env.CI === '1' ||
    env.TF_BUILD ||
    env.GITHUB_ACTIONS === 'true' ||
    env.GITLAB_CI === 'true' ||
    env.CONTINUOUS_INTEGRATION === 'true' ||
    env.SYSTEM_COLLECTIONURI
  );
}

export function detectCiProvider(env = process.env) {
  if (CI_PROVIDERS.azure.detect(env)) return CI_PROVIDERS.azure;
  if (CI_PROVIDERS.github.detect(env)) return CI_PROVIDERS.github;
  if (CI_PROVIDERS.gitlab.detect(env)) return CI_PROVIDERS.gitlab;
  if (CI_PROVIDERS.generic.detect(env)) return CI_PROVIDERS.generic;
  return null;
}

export function writeCiEnv(name, value, env = process.env) {
  const provider = detectCiProvider(env);
  if (provider && provider.writeEnv) {
    return provider.writeEnv(name, value, env);
  }
  return false;
}
