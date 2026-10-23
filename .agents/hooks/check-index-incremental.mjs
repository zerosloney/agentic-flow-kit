#!/usr/bin/env node
// workflow/INDEX.md 漂移（增量硬拦，2026-10-12，Shipyard.Material 参考实现回灌）。
// 检查 11 只在 check-loop --hygiene 里 WARN。关单提交不跑卫生段，索引会继续把已 closed/done 的文档列成在跑。
// 本脚本：暂存触及 workflow 四目录、归档或 INDEX.md 时，跑生成器 --check；不一致即拒提交。
// 未触及这些路径则跳过（引擎面提交不因陈旧索引被拦）。修复：node .agents/scripts/gen-workflow-index.mjs 后把 INDEX.md 一并暂存。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const INDEX_SRC = /^(?:workflow\/(?:intents|specs|plans|incidents|archive)\/.+\.md|workflow\/INDEX\.md)$/;

export function stagedTouchesIndex(files) {
  return files.some((f) => INDEX_SRC.test(String(f).replace(/\\/g, '/')));
}

function main() {
  const git = (args) => {
    const r = spawnSync('git', args, { encoding: 'utf8' });
    return { ok: !r.error && r.status === 0, out: (r.stdout || '').replace(/\r/g, '') };
  };
  const root = git(['rev-parse', '--show-toplevel']);
  if (!root.ok || !root.out.trim()) {
    console.error('索引漂移（增量）: 无法定位仓库根，提交已阻止');
    process.exit(1);
  }
  const top = root.out.trim();
  process.chdir(top);
  const touched = git(['-c', 'core.quotepath=off', 'diff', '--cached', '--name-only']);
  if (!touched.ok) {
    console.error('索引漂移（增量）: 读暂存列表失败，提交已阻止');
    process.exit(1);
  }
  const files = touched.out.split('\n').filter(Boolean);
  if (!stagedTouchesIndex(files)) process.exit(0);

  const gen = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'gen-workflow-index.mjs');
  const r = spawnSync(process.execPath, [gen, '--check'], { cwd: top, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('索引漂移（增量）— BLOCK:');
    console.error('  先跑 node .agents/scripts/gen-workflow-index.mjs，把 workflow/INDEX.md 一并暂存，再提交');
    process.exit(r.status === null ? 1 : r.status);
  }
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
