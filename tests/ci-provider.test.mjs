import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTmp } from './helpers/tmp.mjs';
import {
  isCi,
  detectCiProvider,
  writeCiEnv,
  CI_PROVIDERS,
} from '../templates/engine/.agents/scripts/ci-provider.mjs';
import {
  FORGE_PROVIDERS,
  getForgeProvider,
} from '../templates/engine/.agents/scripts/forge.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CI_PUSH_BEFORE_SCRIPT = path.join(KIT, 'templates/engine/.agents/scripts/ci-push-before.mjs');

test('isCi correctly identifies CI vs non-CI environments', () => {
  assert.equal(isCi({}), false);
  assert.equal(isCi({ TF_BUILD: 'True' }), true);
  assert.equal(isCi({ GITHUB_ACTIONS: 'true' }), true);
  assert.equal(isCi({ GITLAB_CI: 'true' }), true);
  assert.equal(isCi({ CI: 'true' }), true);
  assert.equal(isCi({ CI: '1' }), true);
  assert.equal(isCi({ CONTINUOUS_INTEGRATION: 'true' }), true);
});

test('detectCiProvider correctly identifies supported CI providers', () => {
  assert.equal(detectCiProvider({ TF_BUILD: 'True' })?.id, 'azure');
  assert.equal(detectCiProvider({ SYSTEM_COLLECTIONURI: 'http://tfs' })?.id, 'azure');
  assert.equal(detectCiProvider({ GITHUB_ACTIONS: 'true' })?.id, 'github');
  assert.equal(detectCiProvider({ GITLAB_CI: 'true' })?.id, 'gitlab');
  assert.equal(detectCiProvider({ CI: 'true' })?.id, 'generic');
  assert.equal(detectCiProvider({}), null);
});

test('writeCiEnv writes to GITHUB_ENV on GitHub Actions', () => {
  const tmp = makeTmp('ci-env-gh-');
  const envFile = path.join(tmp, 'github_env');
  fs.writeFileSync(envFile, '');
  const env = { GITHUB_ACTIONS: 'true', GITHUB_ENV: envFile };
  const ok = writeCiEnv('CI_PUSH_BEFORE', 'abcdef1234567890abcdef1234567890abcdef12', env);
  assert.equal(ok, true);
  assert.equal(fs.readFileSync(envFile, 'utf8'), 'CI_PUSH_BEFORE=abcdef1234567890abcdef1234567890abcdef12\n');
});

test('writeCiEnv writes to GITLAB_ENV on GitLab CI', () => {
  const tmp = makeTmp('ci-env-gl-');
  const envFile = path.join(tmp, 'gitlab_env');
  fs.writeFileSync(envFile, '');
  const env = { GITLAB_CI: 'true', GITLAB_ENV: envFile };
  const ok = writeCiEnv('CI_PUSH_BEFORE', '1234567890abcdef1234567890abcdef12345678', env);
  assert.equal(ok, true);
  assert.equal(fs.readFileSync(envFile, 'utf8'), 'CI_PUSH_BEFORE=1234567890abcdef1234567890abcdef12345678\n');
});

test('GitHub provider resolves base SHA from pull_request event in GITHUB_EVENT_PATH', () => {
  const tmp = makeTmp('gh-event-');
  const eventPath = path.join(tmp, 'event.json');
  const baseSha = '1111111111111111111111111111111111111111';
  fs.writeFileSync(eventPath, JSON.stringify({
    pull_request: {
      base: { sha: baseSha },
    },
  }));
  const res = CI_PROVIDERS.github.resolveBaseSha({
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_PATH: eventPath,
  });
  assert.equal(res.before, baseSha);
});

test('GitHub provider resolves base SHA from push event before in GITHUB_EVENT_PATH', () => {
  const tmp = makeTmp('gh-push-');
  const eventPath = path.join(tmp, 'event.json');
  const beforeSha = '2222222222222222222222222222222222222222';
  fs.writeFileSync(eventPath, JSON.stringify({
    before: beforeSha,
  }));
  const res = CI_PROVIDERS.github.resolveBaseSha({
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_PATH: eventPath,
  });
  assert.equal(res.before, beforeSha);
});

test('GitLab provider resolves base SHA from CI_MERGE_REQUEST_TARGET_BRANCH_SHA', () => {
  const mrSha = '3333333333333333333333333333333333333333';
  const res = CI_PROVIDERS.gitlab.resolveBaseSha({
    GITLAB_CI: 'true',
    CI_MERGE_REQUEST_TARGET_BRANCH_SHA: mrSha,
  });
  assert.equal(res.before, mrSha);
});

test('GitLab provider resolves base SHA from CI_COMMIT_BEFORE_SHA', () => {
  const commitSha = '4444444444444444444444444444444444444444';
  const res = CI_PROVIDERS.gitlab.resolveBaseSha({
    GITLAB_CI: 'true',
    CI_COMMIT_BEFORE_SHA: commitSha,
  });
  assert.equal(res.before, commitSha);
});

test('ci-push-before script under GitHub Actions populates GITHUB_ENV and exits 0', () => {
  const tmp = makeTmp('ci-push-before-gh-');
  const eventPath = path.join(tmp, 'event.json');
  const envFile = path.join(tmp, 'github_env');
  const baseSha = '5555555555555555555555555555555555555555';
  fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: baseSha } } }));
  fs.writeFileSync(envFile, '');

  const r = spawnSync(process.execPath, [CI_PUSH_BEFORE_SCRIPT], {
    cwd: tmp,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_ENV: envFile,
    },
  });

  assert.equal(r.status, 0);
  assert.match(r.stdout, /GitHub Actions/);
  assert.equal(fs.readFileSync(envFile, 'utf8'), `CI_PUSH_BEFORE=${baseSha}\n`);
});

test('FORGE_PROVIDERS provides adapters for github, gitlab, and azure', () => {
  const gh = getForgeProvider('github');
  assert.equal(gh?.id, 'github');
  assert.equal(gh?.cli, 'gh');
  assert.deepEqual(
    gh?.buildPrArgs({ source: 'feat', target: 'main', title: 'test', bodyFile: 'f.md' }),
    ['pr', 'create', '--head', 'feat', '--base', 'main', '--title', 'test', '--body-file', 'f.md'],
  );
  assert.deepEqual(
    gh?.parsePrResponse('https://github.com/foo/bar/pull/123\n'),
    { ok: true, url: 'https://github.com/foo/bar/pull/123', number: 123 },
  );

  const gl = getForgeProvider('gitlab');
  assert.equal(gl?.id, 'gitlab');
  assert.equal(gl?.cli, 'glab');
  assert.deepEqual(
    gl?.buildPrArgs({ source: 'feat', target: 'main', title: 'test', bodyFile: 'f.md', dryRun: true }),
    ['mr', 'create', '--source-branch', 'feat', '--target-branch', 'main', '--title', 'test', '--description', '"$(cat f.md)"'],
  );
  assert.deepEqual(
    gl?.parsePrResponse('https://gitlab.com/foo/bar/-/merge_requests/456\n'),
    { ok: true, url: 'https://gitlab.com/foo/bar/-/merge_requests/456', number: 456 },
  );

  const az = getForgeProvider('azure');
  assert.equal(az?.id, 'azure');
  assert.equal(az?.cli, 'tfs-pr');
  assert.deepEqual(
    az?.buildPrArgs({ rawArgs: ['create', '--title', 'x'] }),
    ['create', '--title', 'x'],
  );
  assert.deepEqual(
    az?.parsePrResponse('https://dev.azure.com/org/proj/_git/repo/pullrequest/789\n'),
    { ok: true, url: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/789', number: 789 },
  );
});
