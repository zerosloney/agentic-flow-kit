#!/usr/bin/env node
// solidify-task: 将 L1 液态草稿固化为正式 workflow 文档（迁移 + 可选确认 + 索引更新）
// 用法：
//   node .agents/scripts/solidify-task.mjs --topic <主题> [--root <仓库根>]
//       # 只迁移 + 更新索引，绝不写确认台账；末尾打印确认指引
//   node .agents/scripts/solidify-task.mjs --topic <主题> --delegated "<用户原话>"
//       # 迁移后，以调用方显式传入的用户原话逐份 confirm-doc --delegated（quote 原样转发）
//   node .agents/scripts/solidify-task.mjs --topic <主题> --auto
//       # 迁移后，逐份 confirm-doc --auto（trust-mode=Trusted 才放行；Strict 下被拒并计数失败）
// 确认门契约（incidents/2026-10-01-v09-review-defects）：--delegated 的 quote 必须来自用户在对话内的
//   明确原话，由调用方显式传入——本脚本永不编造用户话术。无确认来源时只迁移不落账，末尾打印指引。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function parseArgs() {
  const topicIdx = process.argv.indexOf('--topic');
  const topic = topicIdx !== -1 ? process.argv[topicIdx + 1] : '';
  if (!topic) fail('用法: node .agents/scripts/solidify-task.mjs --topic "主题" [--root <仓库根>] [--delegated "<用户原话>" | --auto]');
  let root = process.cwd();
  const rootIdx = process.argv.indexOf('--root');
  if (rootIdx !== -1 && process.argv[rootIdx + 1]) root = process.argv[rootIdx + 1];
  const delegatedIdx = process.argv.indexOf('--delegated');
  const delegated = delegatedIdx !== -1 ? String(process.argv[delegatedIdx + 1] ?? '') : '';
  const auto = process.argv.includes('--auto');
  if (delegated && auto) fail('--delegated 与 --auto 互斥，只能选其一');
  return { topic, root, delegated, auto };
}

const classify = (content) => {
  if (content.includes('# INTENT')) return 'intents';
  if (content.includes('# PLAN')) return 'plans';
  if (content.includes('# SPEC')) return 'specs';
  if (content.includes('# INCIDENT')) return 'incidents';
  return null;
};

function run() {
  const { topic, root, delegated, auto } = parseArgs();
  const draftsDir = path.join(root, '.zcode', 'drafts');
  if (!fs.existsSync(draftsDir)) fail(`草稿目录 ${draftsDir} 不存在`);
  const files = fs.readdirSync(draftsDir).filter((f) => f.includes(topic) && f.endsWith('.md'));
  if (!files.length) fail(`在 ${draftsDir} 中未找到主题为 ${topic} 的草稿文件`);

  const today = new Date().toISOString().slice(0, 10);
  const solidified = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(draftsDir, file), 'utf8');
    const targetDir = classify(content);
    if (!targetDir) continue;
    // 统一强制 YYYY-MM-DD- 前缀；已有前缀的文件名原样保留
    const finalName = /^\d{4}-\d{2}-\d{2}-/.test(file) ? file : `${today}-${file}`;
    const targetPath = path.join(root, 'workflow', targetDir, finalName);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(path.join(draftsDir, file), targetPath);
    solidified.push({ rel: `workflow/${targetDir}/${finalName}`, abs: targetPath, type: targetDir });
    console.log(` 📦 迁移: ${file} -> ${targetDir}/${finalName}`);
  }
  if (!solidified.length) fail(`草稿中未找到可识别的 INTENT/PLAN/SPEC/INCIDENT 文档（主题 ${topic}）`);

  // 确认：仅当调用方显式提供确认来源时执行；否则只迁移，绝不落账。
  let failed = 0;
  if (delegated || auto) {
    console.log('🛡️ 执行逐份确认...');
    for (const item of solidified) {
      const args = [path.join(SCRIPT_DIR, 'confirm-doc.mjs'), item.rel, '--root', root];
      if (delegated) args.push('--delegated', delegated);
      else args.push('--auto');
      const res = spawnSync('node', args, { cwd: root, encoding: 'utf8' });
      if (res.status !== 0) {
        failed++;
        console.error(` ❌ 确认失败 [${item.rel}]: ${(res.stderr || '').trim()}`);
      } else {
        console.log(` ✅ 已确认: ${item.rel}`);
      }
    }
    console.log(`确认汇总：${solidified.length - failed}/${solidified.length} 成功${failed ? `，${failed} 失败` : ''}`);
  } else {
    console.log('⏭️ 未提供确认来源，仅迁移不落账。');
    for (const item of solidified) {
      console.log(`  → 确认指引: node .agents/scripts/confirm-doc.mjs ${item.rel}（TTY 键入「可以」）`);
      console.log(`    或（用户对话内明确确认后）: node .agents/scripts/confirm-doc.mjs ${item.rel} --delegated "<用户原话>"`);
    }
  }

  // 更新索引；失败同样传播退出码。
  console.log('📖 更新工作流索引...');
  const idx = spawnSync('node', [path.join(SCRIPT_DIR, 'gen-workflow-index.mjs')], { cwd: root, stdio: 'inherit' });
  if (idx.status !== 0) {
    console.error(' ❌ 索引更新失败');
    process.exit(1);
  }

  if (failed) process.exit(1);
  console.log(`\n✨ 任务 ${topic} 已成功固化！`);
  console.log(`👉 建议执行: git add workflow/ .agents/confirmations.jsonl && git commit -m "docs(workflow): solidify L1 task ${topic}"`);
}

run();