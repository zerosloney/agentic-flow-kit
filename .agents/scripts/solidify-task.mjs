#!/usr/bin/env node
// solidify-task: 将 L1 液态草稿一次性固化为正式 workflow 文档（迁移 + 批量确认 + 索引更新）
// 用法：node .agents/scripts/solidify-task.mjs --topic "主题" [--root <仓库根>]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv.includes('--root') ? 
  process.argv[process.argv.indexOf('--root') + 1] : 
  process.cwd();
const DRAFTS_DIR = path.join(ROOT, '.zcode', 'drafts');
const WF_ROOT = path.join(ROOT, 'workflow');

function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

function parseArgs() {
  const topicIdx = process.argv.indexOf('--topic');
  if (topicIdx === -1 || !process.argv[topicIdx + 1]) {
    console.error('用法: node .agents/scripts/solidify-task.mjs --topic "主题"');
    process.exit(1);
  }
  return process.argv[topicIdx + 1];
}

async function run() {
  const topic = parseArgs();
  console.log(`🚀 开始固化 L1 任务: ${topic}...`);

  if (!fs.existsSync(DRAFTS_DIR)) fail('草稿目录 .zcode/drafts/ 不存在');

  // 1. 搜寻草稿
  const files = fs.readdirSync(DRAFTS_DIR).filter(f => f.includes(topic) && f.endsWith('.md'));
  if (!files.length) fail(`在 ${DRAFTS_DIR} 中未找到主题为 ${topic} 的草稿文件`);

  const today = new Date().toISOString().slice(0, 10);
  const solidified = [];

  // 2. 迁移并规范化命名
  for (const file of files) {
    const content = fs.readFileSync(path.join(DRAFTS_DIR, file), 'utf8');
    let targetDir = '';
    
    // 简单启发式判定类型
    if (content.includes('# INTENT')) targetDir = 'intents';
    else if (content.includes('# PLAN')) targetDir = 'plans';
    else if (content.includes('# SPEC')) targetDir = 'specs';
    else if (content.includes('# INCIDENT')) targetDir = 'incidents';
    else continue;

    const targetName = `${today}-${file.replace(/.*-/, '').replace('.md', '.md')}`;
    if (!targetName.startsWith('20')) {
       // 如果文件名没日期前缀，强制加上
       // 假设文件名为 <topic>.md
    }
    
    // 统一处理：强制 YYYY-MM-DD- 前缀
    const finalName = /^\d{4}-\d{2}-\d{2}-/.test(file) ? file : `${today}-${file}`;
    const targetPath = path.join(WF_ROOT, targetDir, finalName);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(path.join(DRAFTS_DIR, file), targetPath);
    
    solidified.push({
      rel: `workflow/${targetDir}/${finalName}`,
      abs: targetPath,
      type: targetDir
    });
    console.log(`  📦 迁移: ${file} -> ${targetKebab(targetDir)}/${finalName}`);
  }

  function targetKebab(dir) { return dir; }

  // 3. 批量确认 (Delegated)
  console.log('🛡️  执行批量确认...');
  for (const item of solidified) {
    const res = spawnSync('node', [
      path.join(SCRIPT_DIR, 'confirm-doc.mjs'), 
      item.rel, 
      '--delegated', 
      `固化 L1 任务 ${topic}：用户确认草稿无误，执行固化归档`
    ], { encoding: 'utf8' });
    
    if (res.status !== 0) {
      console.error(`  ❌ 确认失败 [${item.rel}]: ${res.stderr}`);
      // 此时不 exit，尝试继续其他文件的确认
    } else {
      console.log(`  ✅ 已确认: ${item.rel}`);
    }
  }

  // 4. 更新索引
  console.log('📖 更新工作流索引...');
  spawnSync('node', [path.join(SCRIPT_DIR, 'gen-workflow-index.mjs')], { stdio: 'inherit' });

  console.log(`\n✨ 任务 ${topic} 已成功固化！`);
  console.log(`👉 建议执行: git add workflow/ .agents/confirmations.jsonl && git commit -m "docs(workflow): solidify L1 task ${topic}"`);
}

run();
