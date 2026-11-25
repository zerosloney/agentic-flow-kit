#!/usr/bin/env node
// 在 CI 环境（GitHub Actions / GitLab CI / Azure Pipelines）上解析本次构建关联提交或推送前基准，
// 写入 CI_PUSH_BEFORE 环境变量供 check-lane-surface --ci 与 ci-commit-hygiene 做整段 push diff。
// 任何失败都 exit 0：缺令牌、HTTP 非 200、空列表、第一父不是 sha → stderr advisory，
// 泳道门退回 HEAD~1。不在这里访问网络以外的副作用。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ciPushBefore } from './check-lane-surface.mjs';
import { detectCiProvider, writeCiEnv, CI_PROVIDERS } from './ci-provider.mjs';

const advisory = (msg) => {
  console.error(`ci-push-before: advisory: ${msg}——泳道 CI 退回 HEAD~1`);
};

const argOf = (k) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : '';
};

const parentOf = (id, resolveSelf = false) => {
  const rev = resolveSelf ? id : `${id}^`;
  const r = spawnSync('git', ['rev-parse', rev], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
};

const loadAzureChanges = async () => {
  const file = argOf('--changes-file');
  if (file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      advisory(`读取 --changes-file 失败：${e.message}`);
      return null;
    }
  }
  const token = process.env.SYSTEM_ACCESSTOKEN || '';
  const collection = process.env.SYSTEM_COLLECTIONURI || '';
  const project = process.env.SYSTEM_TEAMPROJECT || '';
  const buildId = process.env.BUILD_BUILDID || '';
  if (!token || !collection || !project || !buildId) {
    advisory('缺少 SYSTEM_ACCESSTOKEN / SYSTEM_COLLECTIONURI / SYSTEM_TEAMPROJECT / BUILD_BUILDID');
    return null;
  }
  const url = `${collection.replace(/\/?$/, '/')}${encodeURIComponent(project)}/_apis/build/builds/${encodeURIComponent(buildId)}/changes?api-version=7.1`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      advisory(`changes API HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    advisory(`请求 changes API 异常：${e.message}`);
    return null;
  }
};

const changesFile = argOf('--changes-file');
const provider = detectCiProvider(process.env);

if (changesFile || (provider && provider.id === 'azure')) {
  const changes = await loadAzureChanges();
  if (changes) {
    const { before, reason } = ciPushBefore(changes, parentOf);
    if (!before) {
      advisory(reason);
    } else {
      const ok = writeCiEnv('CI_PUSH_BEFORE', before, process.env);
      if (ok) {
        console.log(`ci-push-before: CI_PUSH_BEFORE=${before}（Azure Pipelines）`);
      } else {
        advisory('写入 CI 环境变量失败（未检测到可写环境变量文件）');
      }
    }
  }
} else if (provider && (provider.id === 'github' || provider.id === 'gitlab')) {
  const { before, reason } = provider.resolveBaseSha(process.env, { parentOf });
  if (!before) {
    advisory(reason);
  } else {
    const ok = writeCiEnv('CI_PUSH_BEFORE', before, process.env);
    if (ok) {
      console.log(`ci-push-before: CI_PUSH_BEFORE=${before}（${provider.name}）`);
    } else {
      advisory(`写入 CI 环境变量失败（${provider.name} 未提供环境变量文件）`);
    }
  }
} else if (process.env.CI_PUSH_BEFORE) {
  console.log(`ci-push-before: CI_PUSH_BEFORE=${process.env.CI_PUSH_BEFORE}（已存在于环境变量）`);
} else {
  advisory(provider ? `${provider.name} 未能解析推送基准` : '未检测到支持的 CI Provider 环境');
}

process.exit(0);
